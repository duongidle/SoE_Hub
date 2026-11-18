import { fetchRows, fetchRowsByIds, type RowQuery } from "./api";
import type { Row } from "./types";

/** Rows loaded so far above this count are dropped on a full reload (the grid fetches them again when the person scrolls back). */
const RELOAD_CAP = 2000;
const PAGE = 200;

/**
 * The rows of one table as the grid sees them: the first `rows.length` rows of the (filtered, sorted) table, loaded page by page
 * from the server (keyset cursor), plus the total count. The grid only asks for the rows it is about to draw, so a table of
 * 100.000 rows never travels whole. Edits patch rows in place; the server stays the only place that computes values.
 */
export class RowsStore {
  rows: Row[] = [];
  /** Total rows of the table under the current query, as the server counted them (null until the first answer). */
  total: number | null = null;
  done = false;
  status: "loading" | "ready" | "error" = "loading";
  error: unknown = null;
  /** Increments on every change; React reads it through `useSyncExternalStore`. */
  version = 0;
  private cursor: string | null = null;
  private inflight: Promise<void> | null = null;
  private index = new Map<string, number>();
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(
    readonly tableId: string,
    private query: Omit<RowQuery, "cursor" | "limit" | "includeTotal"> = {},
  ) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;

  /** Starts reading (also again after `stop`, which React StrictMode forces in development). */
  start(): void {
    this.disposed = false;
    if (this.rows.length === 0 && this.status !== "error") void this.loadMore().catch(() => undefined);
  }

  /** The screen is gone: answers still on their way are dropped. */
  stop(): void {
    this.disposed = true;
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  private reindex(): void {
    this.index = new Map(this.rows.map((r, i) => [r.id, i]));
  }

  /** Number of rows the grid should have room for. */
  get count(): number {
    return Math.max(this.total ?? 0, this.rows.length);
  }
  rowAt = (i: number): Row | undefined => this.rows[i];
  /** Rows that are not in the loaded part but are open somewhere (the detail panel of a row created far below). Kept up to date like the others. */
  private orphans = new Map<string, Row>();
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

  /** Loads the next page. Resolves when it is in. One request at a time. */
  loadMore(pageSize: number = PAGE): Promise<void> {
    if (this.done) return Promise.resolve();
    if (this.inflight) return this.inflight;
    const first = this.cursor === null && this.rows.length === 0;
    this.inflight = (async () => {
      try {
        const page = await fetchRows(this.tableId, { ...this.query, limit: first ? 100 : pageSize, cursor: this.cursor, includeTotal: first });
        if (this.disposed) return;
        const known = new Set(this.rows.map((r) => r.id));
        this.rows.push(...page.data.filter((r) => !known.has(r.id)));
        if (page.total !== undefined) this.total = page.total;
        this.cursor = page.next_cursor;
        if (!page.next_cursor) {
          this.done = true;
          this.total = this.rows.length;
        }
        this.status = "ready";
        this.error = null;
        this.reindex();
      } catch (e) {
        if (!this.disposed) {
          this.error = e;
          if (this.rows.length === 0) this.status = "error";
        }
        throw e;
      } finally {
        this.inflight = null;
        if (!this.disposed) this.bump();
      }
    })();
    return this.inflight;
  }

  /** Loads pages until row `index` (plus a screenful of margin) is in. */
  async ensure(index: number): Promise<void> {
    const want = index + 60;
    // Far from what is loaded (the person dragged the scroll bar): the biggest pages the API allows, fewer round trips.
    while (!this.done && this.rows.length < want && !this.disposed) await this.loadMore(want - this.rows.length > 1000 ? 500 : PAGE);
  }

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

  /** Puts new rows at the end of the table (a row created in the grid sits after the last row). */
  append(rows: Row[]): void {
    const known = new Set(this.rows.map((r) => r.id));
    const fresh = rows.filter((r) => !known.has(r.id));
    if (!fresh.length) return;
    if (this.done) {
      this.rows.push(...fresh);
      this.total = this.rows.length;
    } else this.total = (this.total ?? this.rows.length) + fresh.length;
    this.reindex();
    this.bump();
  }

  /** Puts rows back at the indexes they had (undo of a delete). An index past the end appends. */
  insertAt(items: { row: Row; index: number }[]): void {
    const known = new Set(this.rows.map((r) => r.id));
    for (const it of [...items].sort((a, b) => a.index - b.index)) {
      if (known.has(it.row.id)) continue;
      this.rows.splice(Math.min(it.index, this.rows.length), 0, it.row);
      known.add(it.row.id);
    }
    if (this.done) this.total = this.rows.length;
    else this.total = (this.total ?? 0) + items.length;
    this.reindex();
    this.bump();
  }

  remove(ids: string[]): void {
    const gone = new Set(ids);
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !gone.has(r.id));
    const removed = before - this.rows.length;
    if (this.total !== null) this.total = Math.max(this.rows.length, this.total - removed);
    this.reindex();
    this.bump();
  }

  /** Marks a loaded row as changed by someone else, or reloads when we cannot tell. */
  async reload(): Promise<void> {
    const keep = Math.min(Math.max(this.rows.length, 1), RELOAD_CAP);
    this.rows = [];
    this.cursor = null;
    this.done = false;
    this.index.clear();
    this.status = "loading";
    this.bump();
    await this.loadMore();
    while (!this.done && this.rows.length < keep && !this.disposed) await this.loadMore();
  }

  private syncing: Promise<void> = Promise.resolve();

  /**
   * Brings the rows the person can see (and their total) up to date after a change by someone else or after the server
   * recalculated a formula. Fetches only those rows by id plus one count, never the whole table. When the count changed
   * (rows added or removed elsewhere) the loaded part is read again from the top, at most `RELOAD_CAP` rows.
   * Calls queue up: one runs at a time.
   */
  sync(from: number, to: number): Promise<void> {
    const run = async (): Promise<void> => {
      if (this.disposed || this.rows.length === 0) return;
      const ids = this.rows.slice(Math.max(0, from - 10), Math.min(this.rows.length, to + 10)).map((r) => r.id).slice(0, 100);
      const [head, fresh] = await Promise.all([fetchRows(this.tableId, { ...this.query, limit: 1, includeTotal: true }), ids.length ? fetchRowsByIds(this.tableId, ids) : Promise.resolve([] as Row[])]);
      if (this.disposed) return;
      const seen = new Set(fresh.map((r) => r.id));
      const missing = ids.some((id) => !seen.has(id));
      this.patch(fresh.filter((r) => JSON.stringify(r) !== JSON.stringify(this.rows[this.indexOf(r.id)])));
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
}
