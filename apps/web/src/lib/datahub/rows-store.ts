import { fetchRows, fetchRowsByIds, type RowQuery } from "./api";
import type { Row } from "./types";

/** Rows are read in blocks of this many rows (one request each). */
export const CHUNK = 200;
/** Blocks kept in memory (about 8.000 rows); the ones farthest from the screen are dropped first. */
const MAX_CHUNKS = 40;
/** Requests at once. A person dragging the scroll bar leaves requests behind; only the ones near the screen are still wanted. */
const MAX_INFLIGHT = 2;
/** Most rows of a list the web keeps for a conflict check after "sync". */
const SYNC_IDS = 100;

export type StoreQuery = Omit<RowQuery, "cursor" | "limit" | "includeTotal" | "offset" | "reverse">;

/**
 * The rows of one table as the grid sees them: the whole (filtered, sorted) list is `total` positions long and only the
 * blocks near the screen are loaded. A block is one request by position (`offset`, counted from the end when the block is
 * in the second half, so the server never skips a long way), which is what lets the scroll bar jump to any place of a table of
 * 100.000 rows at once. Edits patch rows in place; the server stays the only place that computes values.
 */
export class RowsStore {
  /** Sparse: a position holds its row once its block is loaded. */
  rows: (Row | undefined)[] = [];
  /** Rows of the table under the current query, as the server counted them (null until the first answer). */
  total: number | null = null;
  status: "loading" | "ready" | "error" = "loading";
  error: unknown = null;
  /** Increments on every change; React reads it through `useSyncExternalStore`. */
  version = 0;

  private loaded = new Set<number>();
  private stale = new Set<number>();
  private inflight = new Map<number, Promise<void>>();
  private failed = new Set<number>();
  private wanted: [number, number][] = [[0, 59]];
  private index = new Map<string, number>();
  private orphans = new Map<string, Row>();
  private listeners = new Set<() => void>();
  private disposed = false;
  /** The next block read also asks for the total (first read, and after a change of the table). */
  private recount = true;
  private generation = 0;

  constructor(
    readonly tableId: string,
    private query: StoreQuery = {},
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;

  /** Starts reading (also again after `stop`, which React StrictMode forces in development). */
  start(): void {
    this.disposed = false;
    this.pump();
  }

  /** The screen is gone: answers still on their way are dropped. */
  stop(): void {
    this.disposed = true;
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  /** Number of rows the grid should have room for. */
  get count(): number {
    return this.total ?? 0;
  }
  /** True once the total is known. */
  get known(): boolean {
    return this.total !== null;
  }
  rowAt = (i: number): Row | undefined => this.rows[i];

  /** Rows that are not in the loaded part but are open somewhere (the detail panel of a row created far below). Kept up to date like the others. */
  adopt(row: Row): void {
    if (this.index.has(row.id)) return;
    this.orphans.set(row.id, row);
    this.bump();
  }
  /** A row by id, loaded or adopted. */
  get(id: string): Row | undefined {
    const i = this.index.get(id);
    return i === undefined ? this.orphans.get(id) : this.rows[i];
  }
  indexOf(id: string): number {
    return this.index.get(id) ?? -1;
  }

  // ------------------------------------------------------------------------------------------------ what to read

  /** The positions the grid is about to draw (ranges, both ends included). Reading follows the person: older requests are not repeated. */
  want(ranges: [number, number][]): void {
    this.wanted = ranges.length ? ranges.map(([a, b]) => [Math.max(0, a), Math.max(0, b)] as [number, number]) : [[0, 59]];
    this.pump();
  }

  private chunkRange(k: number): [number, number] {
    const start = k * CHUNK;
    const end = this.total === null ? start + CHUNK : Math.min(this.total, start + CHUNK);
    return [start, end];
  }

  private isWanted(k: number): boolean {
    const [a, b] = [k * CHUNK, k * CHUNK + CHUNK - 1];
    return this.wanted.some(([x, y]) => x <= b && y >= a);
  }

  private needed(): number[] {
    const out: number[] = [];
    const last = this.total === null ? 0 : Math.max(0, Math.ceil(this.total / CHUNK) - 1);
    for (const [a, b] of this.wanted) {
      const from = Math.floor(a / CHUNK);
      const to = Math.min(Math.floor(b / CHUNK), this.total === null ? 0 : last);
      for (let k = from; k <= to; k++) {
        if (this.total !== null && k * CHUNK >= this.total && !(this.total === 0 && k === 0)) continue;
        if ((!this.loaded.has(k) || this.stale.has(k)) && !this.inflight.has(k) && !this.failed.has(k) && !out.includes(k)) out.push(k);
      }
    }
    return out;
  }

  private pump(): void {
    if (this.disposed) return;
    for (const k of this.needed()) {
      if (this.inflight.size >= MAX_INFLIGHT) break;
      this.inflight.set(k, this.fetchChunk(k));
    }
  }

  private async fetchChunk(k: number): Promise<void> {
    const gen = this.generation;
    try {
      const wantTotal = this.recount || this.total === null;
      const [start, end] = this.chunkRange(k);
      const len = Math.max(1, end - start);
      const fromEnd = this.total !== null && start > this.total / 2;
      const q: RowQuery = fromEnd ? { ...this.query, offset: Math.max(0, this.total! - end), reverse: true, limit: len } : { ...this.query, offset: start, limit: len };
      if (wantTotal) {
        q.includeTotal = true;
        this.recount = false;
      }
      const page = await fetchRows(this.tableId, q);
      if (this.disposed || gen !== this.generation) return;
      if (page.total !== undefined && page.total !== this.total) {
        const changed = this.total !== null;
        this.total = page.total;
        if (changed) for (const c of this.loaded) if (c !== k) this.stale.add(c);
      }
      this.place(k, page.data);
      this.status = "ready";
      this.error = null;
      this.evict();
    } catch (e) {
      if (!this.disposed && gen === this.generation) {
        this.failed.add(k);
        this.error = e;
        if (this.loaded.size === 0) this.status = "error";
        this.recount = true;
      }
    } finally {
      this.inflight.delete(k);
      if (!this.disposed) {
        this.bump();
        this.pump();
      }
    }
  }

  /** Puts a block's rows at their positions and forgets what the block held before. */
  private place(k: number, data: Row[]): void {
    const [start, end] = this.chunkRange(k);
    for (let p = start; p < Math.max(end, start + data.length); p++) {
      const old = this.rows[p];
      if (old && this.index.get(old.id) === p) this.index.delete(old.id);
    }
    data.forEach((r, i) => {
      this.rows[start + i] = r;
      this.index.set(r.id, start + i);
      this.orphans.delete(r.id);
    });
    for (let p = start + data.length; p < Math.max(end, start + CHUNK); p++) if (p < this.rows.length) this.rows[p] = undefined;
    this.loaded.add(k);
    this.stale.delete(k);
    // Fewer rows than asked and no total to correct it: the list is shorter than we thought.
    if (this.total !== null && data.length < end - start && start + data.length < this.total) this.total = start + data.length;
    if (this.total !== null && this.rows.length > this.total) this.rows.length = this.total;
  }

  private drop(k: number): void {
    const start = k * CHUNK;
    for (let p = start; p < Math.min(this.rows.length, start + CHUNK); p++) {
      const r = this.rows[p];
      if (r && this.index.get(r.id) === p) this.index.delete(r.id);
      this.rows[p] = undefined;
    }
    this.loaded.delete(k);
    this.stale.delete(k);
  }

  /** Keeps memory small: blocks far from the screen go. */
  private evict(): void {
    if (this.loaded.size <= MAX_CHUNKS) return;
    const centre = this.wanted.length ? Math.floor(this.wanted[0]![0] / CHUNK) : 0;
    const far = [...this.loaded].filter((k) => !this.isWanted(k) && !this.inflight.has(k)).sort((a, b) => Math.abs(b - centre) - Math.abs(a - centre));
    for (const k of far) {
      if (this.loaded.size <= MAX_CHUNKS) break;
      this.drop(k);
    }
  }

  // ------------------------------------------------------------------------------------------------ writes by this person

  /** Replaces rows we already have with newer copies (by id). Rows we do not hold are ignored. */
  patch(rows: Row[]): number[] {
    const at: number[] = [];
    let changed = false;
    for (const r of rows) {
      const i = this.index.get(r.id);
      if (i === undefined) {
        if (this.orphans.has(r.id)) {
          this.orphans.set(r.id, r);
          changed = true;
        }
        continue;
      }
      this.rows[i] = r;
      at.push(i);
    }
    if (at.length || changed) this.bump();
    return at;
  }

  private reindex(): void {
    this.index.clear();
    this.rows.forEach((r, i) => {
      if (r) this.index.set(r.id, i);
    });
  }

  /** After rows were added or removed in the middle, positions shifted: every block is read again (the screen keeps its rows until the new ones arrive). */
  private refreshAll(): void {
    this.stale = new Set(this.loaded);
    for (const k of [...this.stale]) if (!this.isWanted(k)) this.drop(k);
    this.generation++;
    this.inflight.clear();
    this.failed.clear();
    this.recount = true;
    this.pump();
  }

  /** Puts new rows at the end of the table (a row created in the grid sits after the last row). */
  append(rows: Row[], opts: { positionKnown?: boolean } = {}): void {
    const fresh = rows.filter((r) => !this.index.has(r.id));
    if (!fresh.length) return;
    const at = this.total ?? this.rows.length;
    fresh.forEach((r, i) => {
      this.rows[at + i] = r;
      this.index.set(r.id, at + i);
      this.orphans.delete(r.id);
    });
    this.total = at + fresh.length;
    // With another sort or a filter the new row may belong elsewhere: the server says where.
    if (opts.positionKnown === false) this.refreshAll();
    this.bump();
  }

  /** Puts rows back at the positions they had (undo of a delete). A position past the end appends. */
  insertAt(items: { row: Row; index: number }[]): void {
    for (const it of [...items].sort((a, b) => a.index - b.index)) {
      if (this.index.has(it.row.id)) continue;
      const at = Math.min(it.index, this.total ?? this.rows.length);
      this.rows.splice(at, 0, it.row);
      this.total = (this.total ?? this.rows.length - 1) + 1;
    }
    this.reindex();
    this.refreshAll();
    this.bump();
  }

  remove(ids: string[]): void {
    const at = ids.map((id) => this.index.get(id)).filter((i): i is number => i !== undefined).sort((a, b) => b - a);
    for (const i of at) this.rows.splice(i, 1);
    for (const id of ids) this.orphans.delete(id);
    if (this.total !== null) this.total = Math.max(0, this.total - ids.length);
    this.reindex();
    this.refreshAll();
    this.bump();
  }

  // ------------------------------------------------------------------------------------------------ reading again

  /** Reads what is on screen again from the server (after a change of structure, or when a read failed). Resolves when the blocks near the screen are in. */
  async reload(): Promise<void> {
    this.failed.clear();
    if (this.loaded.size === 0) this.status = "loading";
    this.refreshAll();
    this.bump();
    await this.settle();
  }

  /** Resolves when nothing wanted is missing or being read. */
  private async settle(): Promise<void> {
    for (let guard = 0; guard < 200 && !this.disposed; guard++) {
      this.pump();
      if (this.inflight.size === 0 && this.needed().length === 0) return;
      if (this.inflight.size === 0) return; // nothing can be read (all failed)
      await Promise.race([...this.inflight.values()]);
    }
  }

  private syncing: Promise<void> = Promise.resolve();

  /**
   * Brings the rows the person can see (and their total) up to date after a change by someone else or after the server
   * recalculated a formula. Fetches only those rows by id plus one count, never the whole table. When the count changed
   * (rows added or removed elsewhere) the blocks near the screen are read again.
   * Calls queue up: one runs at a time.
   */
  sync(from: number, to: number): Promise<void> {
    const run = async (): Promise<void> => {
      if (this.disposed || this.loaded.size === 0) return;
      const ids: string[] = [];
      for (let p = Math.max(0, from - 10); p <= Math.min(this.rows.length - 1, to + 10) && ids.length < SYNC_IDS; p++) {
        const r = this.rows[p];
        if (r) ids.push(r.id);
      }
      const [head, fresh] = await Promise.all([fetchRows(this.tableId, { ...this.query, limit: 1, includeTotal: true }), ids.length ? fetchRowsByIds(this.tableId, ids) : Promise.resolve([] as Row[])]);
      if (this.disposed) return;
      const seen = new Set(fresh.map((r) => r.id));
      const missing = ids.some((id) => !seen.has(id));
      this.patch(fresh.filter((r) => JSON.stringify(r) !== JSON.stringify(this.get(r.id))));
      if (missing || (head.total !== undefined && head.total !== this.total)) await this.reload();
    };
    this.syncing = this.syncing.then(run, run);
    return this.syncing;
  }

  /** Number of loaded rows in `[from, to]` that still wait for a formula to be recalculated. */
  pendingIn(from: number, to: number): number {
    let n = 0;
    for (let i = Math.max(0, from); i <= Math.min(this.rows.length - 1, to); i++) if (this.rows[i]?.pending?.length) n++;
    return n;
  }

  /** The rows with positions in `[from, to]` that are loaded (for the visible region). */
  loadedCount(): number {
    return this.loaded.size;
  }
}
