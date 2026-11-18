import { ApiError } from "@/lib/api";
import { batchRows, fetchRowsByIds, restoreRowsBatch } from "./api";
import { sameValue } from "./cells";
import { LabelCache } from "./labels";
import { RowsStore } from "./rows-store";
import type { Column, Row, TableDetail } from "./types";
import { UndoStack, type UndoEntry } from "./undo";

export interface CellEdit {
  rowId: string;
  key: string;
  value: unknown;
}

const BATCH = 500;

/** A refusal of the server turned into a sentence for the person. A conflict names the cell. */
export class EditRefused extends Error {}

/**
 * Everything that happens to the rows of one open table: the loaded rows, names of ids, undo and redo, and the writes.
 * A write is sent with `base` (the value the person saw), so the server merges edits of different cells of one row and
 * refuses only when the SAME cell changed meanwhile. The screen never computes a value: after a write it shows what the
 * server answered.
 */
export class TableSession {
  readonly store: RowsStore;
  readonly labels: LabelCache;
  readonly undo = new UndoStack();
  private byKey: Map<string, Column>;
  /** Writes in flight (for the "Đang lưu" mark). */
  saving = 0;
  private savingListeners = new Set<() => void>();

  constructor(
    readonly table: TableDetail,
    query: ConstructorParameters<typeof RowsStore>[1] = {},
  ) {
    this.store = new RowsStore(table.id, query);
    this.labels = new LabelCache(table.id);
    this.byKey = new Map(table.columns.map((c) => [c.key, c]));
  }

  start(): void {
    this.store.start();
  }
  stop(): void {
    this.store.stop();
  }

  onSaving = (fn: () => void): (() => void) => {
    this.savingListeners.add(fn);
    return () => this.savingListeners.delete(fn);
  };
  private track<T>(p: Promise<T>): Promise<T> {
    this.saving++;
    this.savingListeners.forEach((f) => f());
    return p.finally(() => {
      this.saving--;
      this.savingListeners.forEach((f) => f());
    });
  }

  private columnName(key: string): string {
    return this.byKey.get(key)?.name ?? key;
  }

  /** Sentence for an API failure of a write. Reloads the rows that conflicted so the next try starts from what the server holds. */
  async explain(e: unknown): Promise<string> {
    if (e instanceof EditRefused) return e.message;
    if (e instanceof ApiError) {
      const d = e.details as { reason?: string; conflicts?: { row_id: string; column: string; name: string }[]; versions?: { row_id: string }[]; issues?: { row: number; column: string; message: string }[] } | undefined;
      if (e.code === "conflict" && (d?.reason === "cell_conflict" || d?.reason === "version_conflict")) {
        const ids = [...new Set([...(d.conflicts ?? []).map((c) => c.row_id), ...(d.versions ?? []).map((v) => v.row_id)])];
        if (ids.length) this.store.patch(await fetchRowsByIds(this.table.id, ids.slice(0, 100)).catch(() => []));
        const first = d.conflicts?.[0];
        const rowNo = first ? this.store.rowAt(this.store.indexOf(first.row_id))?.row_no : undefined;
        return first ? `Ô "${first.name}"${rowNo ? ` ở dòng #${rowNo}` : ""} vừa được người khác sửa. Đã tải giá trị mới, hãy sửa lại.` : "Dòng vừa được người khác sửa. Đã tải giá trị mới, hãy sửa lại.";
      }
      if (e.code === "validation_error" && d?.issues?.length) {
        const i = d.issues[0]!;
        return d.issues.length === 1 ? i.message : `${i.message} (và ${d.issues.length - 1} lỗi khác)`;
      }
      if (e.code === "forbidden") return "Bạn chỉ có quyền xem bảng này.";
      return e.message;
    }
    return e instanceof Error ? e.message : String(e);
  }

  // ------------------------------------------------------------------------------------------------ edits

  /** Writes cell values. Cells that already hold the value are skipped. Returns the undo entry (null when nothing changed). */
  async doEdits(edits: CellEdit[], label = "Sửa ô"): Promise<UndoEntry | null> {
    const byRow = new Map<string, { data: Record<string, unknown>; base: Record<string, unknown> }>();
    const originals = new Map<string, Row>();
    for (const e of edits) {
      const row = this.store.get(e.rowId);
      if (!row) throw new EditRefused("Dòng này chưa được tải. Cuộn tới dòng đó rồi thử lại.");
      const old = row.data[e.key] ?? null;
      if (sameValue(old, e.value)) continue;
      originals.set(row.id, originals.get(row.id) ?? row);
      const item = byRow.get(row.id) ?? { data: {}, base: {} };
      item.data[e.key] = e.value ?? null;
      item.base[e.key] = old;
      byRow.set(row.id, item);
    }
    if (byRow.size === 0) return null;

    // Show the new values at once; the server's answer replaces them (or the old rows come back when it refuses).
    const optimistic: Row[] = [];
    for (const [id, item] of byRow) {
      const o = originals.get(id)!;
      const data = { ...o.data };
      for (const [k, v] of Object.entries(item.data)) {
        if (v === null || v === undefined) delete data[k];
        else data[k] = v;
      }
      optimistic.push({ ...o, data });
    }
    this.store.patch(optimistic);

    const ops = [...byRow].map(([id, it]) => ({ op: "update", id, data: it.data, base: it.base }));
    const applied: string[] = [];
    try {
      for (let i = 0; i < ops.length; i += BATCH) {
        const chunk = ops.slice(i, i + BATCH);
        const res = await this.track(batchRows(this.table.id, chunk));
        this.store.patch(res.results.map((r) => r.row).filter((r): r is Row => !!r));
        applied.push(...chunk.map((c) => c.id));
      }
    } catch (e) {
      // Whatever was not written goes back to what it was.
      this.store.patch([...originals].filter(([id]) => !applied.includes(id)).map(([, r]) => r));
      throw e;
    }

    const forward = [...byRow].map(([id, it]) => ({ id, data: it.data, base: it.base }));
    const reverse = forward.map((f) => ({ id: f.id, data: f.base, base: f.data }));
    const apply = async (list: typeof forward) => {
      for (let i = 0; i < list.length; i += BATCH) {
        const res = await this.track(batchRows(this.table.id, list.slice(i, i + BATCH).map((x) => ({ op: "update", id: x.id, data: x.data, base: x.base }))));
        this.store.patch(res.results.map((r) => r.row).filter((r): r is Row => !!r));
      }
    };
    const count = forward.reduce((n, f) => n + Object.keys(f.data).length, 0);
    return { label, count, undo: () => apply(reverse), redo: () => apply(forward) };
  }

  /** Writes cells and records the undo step. Returns the number of cells that really changed. */
  async edit(edits: CellEdit[], label?: string): Promise<number> {
    const e = await this.doEdits(edits, label);
    if (e) this.undo.push(e);
    return e?.count ?? 0;
  }

  // ------------------------------------------------------------------------------------------------ create and delete

  async doCreate(values: Record<string, unknown>[], label = "Thêm dòng"): Promise<{ rows: Row[]; entry: UndoEntry }> {
    const created: Row[] = [];
    for (let i = 0; i < values.length; i += BATCH) {
      const res = await this.track(batchRows(this.table.id, values.slice(i, i + BATCH).map((data) => ({ op: "create", data }))));
      const rows = res.results.map((r) => r.row).filter((r): r is Row => !!r);
      this.store.append(rows);
      created.push(...rows);
    }
    const ids = created.map((r) => r.id);
    const entry: UndoEntry = {
      label,
      undo: async () => {
        await this.deleteIds(ids);
      },
      redo: async () => {
        const res = await this.track(restoreRowsBatch(this.table.id, ids));
        this.store.append(res.rows);
      },
    };
    return { rows: created, entry };
  }

  async create(values: Record<string, unknown>[] = [{}], label?: string): Promise<Row[]> {
    const { rows, entry } = await this.doCreate(values, label);
    this.undo.push(entry);
    return rows;
  }

  private async deleteIds(ids: string[]): Promise<{ row: Row; index: number }[]> {
    const memory = ids.map((id) => ({ row: this.store.rowAt(this.store.indexOf(id)), index: this.store.indexOf(id) })).filter((x): x is { row: Row; index: number } => !!x.row && x.index >= 0);
    for (let i = 0; i < ids.length; i += BATCH) await this.track(batchRows(this.table.id, ids.slice(i, i + BATCH).map((id) => ({ op: "delete", id }))));
    this.store.remove(ids);
    return memory;
  }

  /** Deletes rows into the trash. The returned entry restores them where they were. */
  async doDelete(ids: string[], label = "Xoá dòng"): Promise<UndoEntry> {
    let where = await this.deleteIds(ids);
    return {
      label,
      undo: async () => {
        const res = await this.track(restoreRowsBatch(this.table.id, ids));
        const at = new Map(where.map((w) => [w.row.id, w.index]));
        this.store.insertAt(res.rows.map((row) => ({ row, index: at.get(row.id) ?? Number.MAX_SAFE_INTEGER })));
      },
      redo: async () => {
        where = await this.deleteIds(ids);
      },
    };
  }

  async remove(ids: string[]): Promise<void> {
    this.undo.push(await this.doDelete(ids, ids.length === 1 ? "Xoá 1 dòng" : `Xoá ${ids.length} dòng`));
  }

  /** One undo step made of several (for example a paste that creates rows and edits others). */
  push(entries: UndoEntry[], label: string): void {
    const list = entries.filter(Boolean);
    if (list.length === 0) return;
    this.undo.push({
      label,
      undo: async () => {
        for (const e of [...list].reverse()) await e.undo();
      },
      redo: async () => {
        for (const e of list) await e.redo();
      },
    });
  }
}
