import { sql } from "drizzle-orm";
import { AppError, DH_BATCH_MAX, toActorRef } from "@soe/shared";
import { newId, rowHistory, type Executor, type FieldChange } from "@soe/db";
import type { HandlerCtx } from "../../core/types";
import { ownedBy } from "../../auth/access";
import { files } from "@soe/db";
import { and, eq, isNull } from "drizzle-orm";
import type { TableAccess } from "./access";
import { sourceOf, type CellWrite, type LoadedRow } from "./column-source";
import { isComputedType } from "./cell-values";
import { buildSearchText, columnTypeDef } from "./column-types";
import { bulkCreateOff, columnNotEditable, pgError, rowNotEditable, rowOutsideScope } from "./errors";
import { nextChangeSeq } from "./change-queue";
import { recordChanges, type RowChange } from "./partial";
import { RowFormulas } from "./row-formulas";
import { rowFromDb, toApiRow, type ApiRow, type TableSchema } from "./table-schema";
import { CellError, type DhColumn, type Stored } from "./types";

/** A merged table is read-only for everyone, its owner included: its rows are written only by the worker (design module3 section 4.3). */
export function assertWritable(access: TableAccess): void {
  if (access.table.kind === "merged") throw new AppError("forbidden", "Bảng gộp chỉ đọc. Muốn sửa dữ liệu, hãy sửa ở bảng nguồn (mở dòng gốc từ cột \"Mã dòng gốc\").", { reason: "merged_table_read_only" });
}

/** One operation of a row write (single calls are batches of one). */
export type RowOp =
  | { op: "create"; data: Record<string, unknown> }
  | { op: "update"; id: string; data: Record<string, unknown>; base?: Record<string, unknown>; version?: number }
  | { op: "delete"; id: string; version?: number }
  | { op: "upsert"; key: string; data: Record<string, unknown> };

export interface OpResult {
  op: RowOp["op"];
  /** `created` / `updated` / `unchanged` (an update that changed nothing) / `deleted`. */
  outcome: "created" | "updated" | "unchanged" | "deleted";
  id: string;
  row: ApiRow | null;
  /** Change sequence of this write (design module2 section 6.7): wait for it with `consistent_after` before reading computed columns. */
  seq: number;
}

type Ctx = Pick<HandlerCtx, "db" | "actor" | "emit" | "audit" | "requestId">;

const uuidArray = (ids: string[]) => `{${ids.join(",")}}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const ROW_COLS = sql.raw("id, row_no, version, data, created_at, created_by, updated_at, updated_by");

/** Validates the cells of one op. Errors are collected so the caller sees every bad column at once. */
function parseCells(schema: TableSchema, input: Record<string, unknown>, issues: { row: number; column: string; message: string }[], rowIndex: number, access: TableAccess): Map<string, Stored> {
  const out = new Map<string, Stored>();
  for (const [ref, raw] of Object.entries(input)) {
    const col = schema.resolve(ref);
    const def = columnTypeDef(col.type);
    if (!def.writable) {
      issues.push({ row: rowIndex, column: col.name, message: `Cột "${col.name}" (${def.label}) không sửa được.` });
      continue;
    }
    // Linking rows reveals and changes how another table is read, so only the owner of the datahub does it.
    if (col.type === "relation" && access.level !== "owner") {
      issues.push({ row: rowIndex, column: col.name, message: `Chỉ chủ datahub được sửa cột liên kết "${col.name}".` });
      continue;
    }
    if (out.has(col.key)) {
      issues.push({ row: rowIndex, column: col.name, message: `Cột "${col.name}" bị gửi hai lần (cả mã lẫn tên).` });
      continue;
    }
    try {
      out.set(col.key, def.parse(raw, col));
    } catch (e) {
      if (!(e instanceof CellError)) throw e;
      issues.push({ row: rowIndex, column: col.name, message: e.message });
    }
  }
  return out;
}

/** Users and linked rows named by a cell must exist. (Files are checked by `checkFiles`, once the rows being changed are known.) */
async function checkRefs(db: Executor, actorId: string, ownerId: string, cells: Map<string, Stored>[], schema: TableSchema, issues: { row: number; column: string; message: string }[]): Promise<void> {
  const users = new Set<string>();
  cells.forEach((m) => {
    for (const [k, v] of m) {
      const col = schema.tryResolve(k);
      const refs = col && v !== null ? columnTypeDef(col.type).refs?.(v) : undefined;
      refs?.users?.forEach((x) => users.add(x));
    }
  });
  const okUsers = new Set<string>();
  if (users.size) {
    const res = await db.execute(sql`SELECT id FROM users WHERE kind = 'person' AND id = ANY(${uuidArray([...users])}::uuid[])`);
    (res.rows as { id: string }[]).forEach((r) => okUsers.add(r.id));
  }
  // Linked rows must be live rows of the target table, which must belong to the same owner.
  const links = new Map<string, Set<string>>();
  cells.forEach((m) => {
    for (const [k, v] of m) {
      const col = schema.tryResolve(k);
      if (col?.type === "relation" && Array.isArray(v)) {
        const target = col.config.target_table_id as string;
        links.set(target, new Set([...(links.get(target) ?? []), ...v]));
      }
    }
  });
  const okRows = new Set<string>();
  for (const [target, rowIds] of links) {
    const res = await db.execute(sql`SELECT r.id FROM dh_rows r JOIN dh_tables t ON t.id = r.table_id JOIN dh_datahubs d ON d.id = t.datahub_id
      WHERE /*scope*/ r.table_id = ${target}::uuid AND r.deleted_at IS NULL AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND d.owner_id = ${ownerId}::uuid
        AND r.id = ANY(${uuidArray([...rowIds])}::uuid[])`);
    (res.rows as { id: string }[]).forEach((r) => okRows.add(r.id));
  }
  cells.forEach((m, i) => {
    for (const [k, v] of m) {
      const col = schema.tryResolve(k);
      if (col?.type === "relation" && Array.isArray(v) && v.some((x) => !okRows.has(x))) issues.push({ row: i, column: col.name, message: `Cột "${col.name}" liên kết tới dòng không tồn tại hoặc không thuộc bảng đích.` });
      const refs = col && v !== null ? columnTypeDef(col.type).refs?.(v) : undefined;
      if (refs?.users?.some((x) => !okUsers.has(x))) issues.push({ row: i, column: col!.name, message: `Người dùng ở cột "${col!.name}" không tồn tại.` });
    }
  });
}

/**
 * A file id may be put into an attachment cell only by the person who uploaded it. Ids already in the cell stay (an editor adds a file to a cell
 * that holds the owner's, the owner removes the editor's file): only ids that are NEW for that row are checked, so a file id of someone else
 * cannot be copied in, but nobody is refused for what was already there. A new row has only new ids.
 */
async function checkFiles(db: Executor, actorId: string, plans: { kind: string; id: string; indexes: number[]; cells: Map<string, Stored> }[], loaded: Map<string, LoadedRow>, schema: TableSchema, issues: { row: number; column: string; message: string }[]): Promise<void> {
  const fresh: { row: number; column: string; ids: string[] }[] = [];
  for (const p of plans) {
    if (p.kind === "delete") continue;
    for (const [k, v] of p.cells) {
      const col = schema.tryResolve(k);
      if (!col || col.type !== "attachment" || !Array.isArray(v)) continue;
      const had = new Set(p.kind === "update" ? ((loaded.get(p.id)?.data[col.key] as string[] | undefined) ?? []) : []);
      const ids = (v as string[]).filter((x) => !had.has(x));
      if (ids.length) fresh.push({ row: p.indexes[0]!, column: col.name, ids });
    }
  }
  if (fresh.length === 0) return;
  const all = [...new Set(fresh.flatMap((f) => f.ids))];
  const rows = await db.select({ id: files.id }).from(files).where(and(ownedBy(files.ownerId, actorId), eq(files.status, "ready"), isNull(files.deletedAt), sql`${files.id} = ANY(${uuidArray(all)}::uuid[])`));
  const ok = new Set(rows.map((r) => r.id));
  for (const f of fresh) if (f.ids.some((x) => !ok.has(x))) issues.push({ row: f.row, column: f.column, message: `File ở cột "${f.column}" không tồn tại hoặc không phải file của bạn.` });
}

/**
 * A user cell may name only a member of the table: its owner, or someone it is shared with (design module2 section 10). Checked for every
 * value that is NEW in a row (a new row, or a cell that changed); what is already stored stays, even when that person was removed later.
 */
async function checkMembers(db: Executor, access: TableAccess, uses: { row: number; column: string; id: string }[], issues: { row: number; column: string; message: string }[]): Promise<void> {
  if (uses.length === 0) return;
  const ids = [...new Set(uses.map((u) => u.id))];
  const res = await db.execute(sql`SELECT s.grantee_id AS id FROM dh_shares s WHERE /*scope*/ s.datahub_id = ${access.datahub.id}::uuid AND (s.table_id IS NULL OR s.table_id = ${access.tableId}::uuid) AND s.grantee_id = ANY(${uuidArray(ids)}::uuid[])`);
  const ok = new Set((res.rows as { id: string }[]).map((r) => r.id));
  ok.add(access.datahub.ownerId);
  for (const u of uses) if (!ok.has(u.id)) issues.push({ row: u.row, column: u.column, message: `Người ở cột "${u.column}" chưa là thành viên của bảng. Chia sẻ bảng cho người đó trước.` });
}

/** Every op changes cells of person-stored columns only (and none creates or deletes a row): a person's own values, which need no right to edit the table. */
function onlyOwnCells(schema: TableSchema, ops: RowOp[]): boolean {
  return ops.length > 0 && ops.every((o) => {
    if (o.op !== "update") return false;
    const keys = Object.keys(o.data);
    return keys.length > 0 && keys.every((k) => schema.tryResolve(k)?.storage === "person");
  });
}

function throwIssues(issues: { row: number; column: string; message: string }[]): void {
  if (issues.length) throw new AppError("validation_error", issues.length === 1 ? issues[0]!.message : `Dữ liệu có ${issues.length} lỗi.`, { issues });
}

/** Applies the cell writes of one row to its `data` (only the JSONB source exists in Stage 2A). */
function applyWrites(data: Record<string, Stored>, writes: CellWrite[]): Record<string, Stored> {
  const next = { ...data };
  for (const w of writes) {
    if (w.source === "jsonb") {
      if (w.value === null) delete next[w.key];
      else next[w.key] = w.value;
    }
  }
  return next;
}

function duplicateError(e: unknown, schema: TableSchema): never {
  const p = pgError(e);
  const m = p.code === "23505" && p.constraint ? /^dh_ix_[0-9a-f]{12}_(.+)_uniq$/.exec(p.constraint) : null;
  if (m) {
    const col = schema.tryResolve(m[1]!);
    throw new AppError("conflict", `Giá trị của cột "${col?.name ?? m[1]}" đã có ở một dòng khác. Cột này không cho phép trùng.`, { reason: "duplicate_value", column: col?.name ?? m[1] });
  }
  throw e;
}

interface Plan {
  kind: "create" | "update" | "delete";
  indexes: number[];
  id: string;
  cells: Map<string, Stored>;
  base?: Record<string, unknown>;
  version?: number;
}

/**
 * The one writer of rows (design module2 sections 7, 12): create, update, delete, upsert, one call or up to 500, in the
 * caller's transaction. Cells are validated per column type; updates merge per cell (a conflict only when the SAME cell
 * changed since the client read it); history records input data only; the audit entry never holds values.
 */
export async function applyRowOps(ctx: Ctx, access: TableAccess, schema: TableSchema, ops: RowOp[], opts: { labels?: boolean } = {}): Promise<OpResult[]> {
  // A person writes THEIR OWN values (custom columns, one-value-per-person columns) with no more than the right to see the table (module4 3.6).
  access.require(onlyOwnCells(schema, ops) ? "view" : "edit_data");
  assertWritable(access);
  if (ops.length === 0) throw new AppError("validation_error", "Cần ít nhất một thao tác.");
  if (ops.length > DH_BATCH_MAX) throw new AppError("validation_error", `Một lần gửi tối đa ${DH_BATCH_MAX} thao tác.`);
  const db = ctx.db;
  const actorId = ctx.actor.userId;
  const actorRef = toActorRef(ctx.actor);
  // Set before anything can fail, so a failed call is audited as private rows too (values stay out of the log).
  ctx.audit({ type: "datahub_row", id: access.tableId, details: { table_id: access.tableId, operations: ops.length } });

  // ---- 1. validate cells --------------------------------------------------------------------------
  const issues: { row: number; column: string; message: string }[] = [];
  const cellsOf = ops.map((o, i) => (o.op === "delete" ? new Map<string, Stored>() : parseCells(schema, o.data, issues, i, access)));
  await checkRefs(db, actorId, access.datahub.ownerId, cellsOf, schema, issues);
  const formulas = RowFormulas.for(schema);
  const now = new Date();
  throwIssues(issues);

  // ---- 2. turn ops into plans (upsert becomes create or update) --------------------------------------
  const plans: Plan[] = [];
  const planOf: Plan[] = new Array(ops.length);
  const targets = new Set<string>();
  const addTarget = (id: string, i: number) => {
    if (targets.has(id)) throw new AppError("validation_error", "Một lần gửi không sửa hoặc xoá cùng một dòng hai lần.", { row: i, row_id: id });
    targets.add(id);
  };

  const upsertIdx = ops.map((o, i) => (o.op === "upsert" ? i : -1)).filter((i) => i >= 0);
  const existingByKey = new Map<string, string>();
  let keyCol: DhColumn | null = null;
  if (upsertIdx.length) {
    const refs = new Set(upsertIdx.map((i) => (ops[i] as { key: string }).key));
    if (refs.size > 1) throw new AppError("validation_error", "Một lần upsert chỉ dùng một cột khoá.");
    keyCol = schema.resolve([...refs][0]!);
    if (!keyCol.isUnique) throw new AppError("validation_error", `Cột "${keyCol.name}" phải có thuộc tính "duy nhất" mới dùng làm khoá upsert.`);
    const vals = upsertIdx.map((i) => {
      const v = cellsOf[i]!.get(keyCol!.key);
      if (v === undefined || v === null || Array.isArray(v)) throw new AppError("validation_error", `Dòng upsert thiếu giá trị ở cột khoá "${keyCol!.name}".`, { row: i });
      return String(v);
    });
    const keyExpr = sql.raw(`data->>'${keyCol.key}'`);
    const res = await db.execute(sql`SELECT id, ${keyExpr} AS v FROM dh_rows WHERE ${access.rows()} AND deleted_at IS NULL AND ${keyExpr} = ANY(${`{${vals.map((v) => `"${v.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`}::text[])`);
    for (const r of res.rows as { id: string; v: string }[]) existingByKey.set(r.v, r.id);
  }

  const planByKey = new Map<string, Plan>();
  ops.forEach((o, i) => {
    if (o.op === "create") {
      const p: Plan = { kind: "create", indexes: [i], id: newId(), cells: cellsOf[i]! };
      plans.push(p);
      planOf[i] = p;
    } else if (o.op === "update") {
      addTarget(o.id, i);
      const p: Plan = { kind: "update", indexes: [i], id: o.id, cells: cellsOf[i]!, base: o.base, version: o.version };
      plans.push(p);
      planOf[i] = p;
    } else if (o.op === "delete") {
      addTarget(o.id, i);
      const p: Plan = { kind: "delete", indexes: [i], id: o.id, cells: new Map(), version: o.version };
      plans.push(p);
      planOf[i] = p;
    } else {
      const k = String(cellsOf[i]!.get(keyCol!.key));
      const earlier = planByKey.get(k);
      if (earlier) {
        // The same key twice in one batch: the later cells win, one row results.
        for (const [ck, cv] of cellsOf[i]!) earlier.cells.set(ck, cv);
        earlier.indexes.push(i);
        planOf[i] = earlier;
        return;
      }
      const existing = existingByKey.get(k);
      if (existing) addTarget(existing, i);
      const p: Plan = existing ? { kind: "update", indexes: [i], id: existing, cells: cellsOf[i]! } : { kind: "create", indexes: [i], id: newId(), cells: cellsOf[i]! };
      planByKey.set(k, p);
      plans.push(p);
      planOf[i] = p;
    }
  });

  // ---- 3. load and lock the rows to change (ordered by id: no deadlocks between batches) ---------------
  const loaded = new Map<string, LoadedRow>();
  const targetIds = plans.filter((p) => p.kind !== "create").map((p) => p.id);
  if (targetIds.length) {
    const res = await db.execute(sql`SELECT ${ROW_COLS} FROM dh_rows WHERE ${access.rows()} AND deleted_at IS NULL AND id = ANY(${uuidArray(targetIds)}::uuid[]) ORDER BY id FOR UPDATE`);
    for (const r of res.rows as Record<string, unknown>[]) loaded.set(r.id as string, rowFromDb(r));
    for (const id of targetIds) if (!loaded.has(id)) throw new AppError("not_found", "Không tìm thấy dòng (có thể đã bị xoá).", { row_id: id });
  }

  // The actor's own values of the person-stored columns (module4 3.4): where an update compares with what they had, and what is written back.
  const ownBefore = new Map<string, Record<string, Stored>>();
  if (access.hasPersonCells && targetIds.length) {
    const res = await db.execute(sql`SELECT row_id, data FROM dh_person_cells WHERE /*scope*/ table_id = ${access.tableId}::uuid AND user_id = ${actorId}::uuid AND row_id = ANY(${uuidArray(targetIds)}::uuid[])`);
    for (const r of res.rows as { row_id: string; data: Record<string, Stored> }[]) ownBefore.set(r.row_id, r.data);
  }
  const ownWrites = new Map<string, Record<string, Stored>>();

  // Under the split lock a reader may see a row they cannot edit (a Leader's view of a team member's deal): editing and deleting need the right to edit THAT row.
  const ownOnly = onlyOwnCells(schema, ops);
  if (access.restricted && !ownOnly) for (const p of plans) if (p.kind !== "create" && !access.canEditRow(loaded.get(p.id)!.data)) rowNotEditable(p.id);
  await checkFiles(db, actorId, plans, loaded, schema, issues);
  const userUses: { row: number; column: string; id: string }[] = [];
  const lockedColumns = new Set<string>();
  const changedColumns = new Set<string>();
  const computedKeys = new Set(schema.all.filter((c) => isComputedType(c.type)).map((c) => c.key));
  const history: { rowId: string; version: number; op: "create" | "update" | "delete"; changes: FieldChange[] }[] = [];
  const insertRows: { id: string; row_no: number; data: Record<string, Stored>; search: string }[] = [];
  const updateRows: { id: string; data: Record<string, Stored>; search: string }[] = [];
  const deleteIds: string[] = [];
  const outcome = new Map<Plan, OpResult["outcome"]>();
  const newData = new Map<string, Record<string, Stored>>();
  const conflicts: { row_id: string; column: string; name: string; current: Stored }[] = [];
  const versionConflicts: { row_id: string; current_version: number; sent_version: number | undefined }[] = [];

  // ---- 4. updates and deletes ------------------------------------------------------------------------
  for (const p of plans) {
    if (p.kind === "create") continue;
    const row = loaded.get(p.id)!;
    if (p.kind === "delete") {
      if (p.version !== undefined && p.version !== row.version) versionConflicts.push({ row_id: p.id, current_version: row.version, sent_version: p.version });
      deleteIds.push(p.id);
      outcome.set(p, "deleted");
      continue;
    }
    const isUpsert = ops[p.indexes[0]!]!.op === "upsert";
    // Cells of person-stored columns are the actor's own: no conflict with anyone, never in the row's version, history or events.
    const sharedCells = new Map([...p.cells].filter(([k]) => schema.resolve(k).storage !== "person"));
    const ownCells = new Map([...p.cells].filter(([k]) => schema.resolve(k).storage === "person"));
    if (!isUpsert) {
      if (p.base) {
        // Cell-level merge (design section 7): a cell conflicts only when it changed since the client read it.
        for (const [k, v] of sharedCells) {
          const col = schema.resolve(k);
          let base: Stored = null;
          if (k in p.base || col.name in p.base) {
            const rawBase = k in p.base ? p.base[k] : p.base[col.name];
            try {
              base = columnTypeDef(col.type).parse(rawBase, col);
            } catch {
              base = (rawBase ?? null) as Stored;
            }
          }
          const current = row.data[k] ?? null;
          if (!same(current, base) && !same(current, v)) conflicts.push({ row_id: p.id, column: k, name: col.name, current });
        }
      } else if (p.version === undefined) {
        throw new AppError("validation_error", "Sửa dòng cần gửi `base` (giá trị các ô bạn đã đọc) hoặc `version`.", { row_id: p.id });
      } else if (p.version !== row.version && sharedCells.size > 0) {
        versionConflicts.push({ row_id: p.id, current_version: row.version, sent_version: p.version });
      }
    }
    const writes = [...sharedCells].map(([k, v]) => sourceOf(schema.resolve(k)).planWrite(schema.resolve(k), v));
    const next = applyWrites(row.data, writes);
    const changes: FieldChange[] = [];
    for (const [k, v] of sharedCells) {
      const was = row.data[k] ?? null;
      if (!same(was, v)) {
        const col = schema.resolve(k);
        if (v === null && col.required) issues.push({ row: p.indexes[0]!, column: col.name, message: `Cột "${col.name}" là bắt buộc, không để trống được.` });
        if (access.level !== "owner" && !col.allowEdit) lockedColumns.add(col.name);
        if (col.type === "user" && typeof v === "string") userUses.push({ row: p.indexes[0]!, column: col.name, id: v });
        changes.push({ field: k, old: was, new: v });
        changedColumns.add(k);
      }
    }
    // The actor's own cells: changed ones go to `dh_person_cells` (a column the actor made is theirs to write whatever `allow_edit` says).
    const ownBeforeRow = ownBefore.get(p.id) ?? {};
    let ownChanged = false;
    for (const [k, v] of ownCells) {
      const was = ownBeforeRow[k] ?? null;
      if (same(was, v)) continue;
      const col = schema.resolve(k);
      if (v === null && col.required) issues.push({ row: p.indexes[0]!, column: col.name, message: `Cột "${col.name}" là bắt buộc, không để trống được.` });
      if (access.level !== "owner" && !col.allowEdit && col.layer !== "custom") lockedColumns.add(col.name);
      if (col.type === "user" && typeof v === "string") userUses.push({ row: p.indexes[0]!, column: col.name, id: v });
      ownWrites.set(p.id, { ...(ownWrites.get(p.id) ?? {}), [k]: v });
      ownChanged = true;
    }
    if (changes.length === 0) {
      outcome.set(p, ownChanged ? "updated" : "unchanged");
      continue;
    }
    // Same-row formulas: computed here, in the transaction that saves the row. They never enter the history.
    formulas?.compute(next, { id: row.id, rowNo: row.rowNo, createdAt: row.createdAt, updatedAt: now, createdBy: row.createdBy, updatedBy: actorId }, now).forEach((k) => changedColumns.add(k));
    newData.set(p.id, next);
    updateRows.push({ id: p.id, data: next, search: buildSearchText(next, schema.aliveAll) });
    history.push({ rowId: p.id, version: row.version + 1, op: "update", changes });
    outcome.set(p, "updated");
  }
  throwIssues(issues);
  if (lockedColumns.size) columnNotEditable([...lockedColumns]);
  if (conflicts.length || versionConflicts.length) {
    throw new AppError(
      "conflict",
      conflicts.length ? "Có ô đã bị người khác sửa sau lúc bạn đọc. Tải lại giá trị mới rồi sửa tiếp." : "Dòng đã bị người khác sửa. Tải lại rồi sửa tiếp.",
      conflicts.length ? { reason: "cell_conflict", conflicts, ...(versionConflicts.length ? { versions: versionConflicts } : {}) } : { reason: "version_conflict", versions: versionConflicts },
    );
  }

  // ---- 5. creates ------------------------------------------------------------------------------------
  const creates = plans.filter((p) => p.kind === "create");
  if (creates.length > 1 && !access.bulkCreateAllowed()) bulkCreateOff();
  if (creates.length && access.level !== "owner") {
    const locked = new Set<string>();
    for (const p of creates) for (const k of p.cells.keys()) if (!schema.resolve(k).allowEdit && schema.resolve(k).layer !== "custom") locked.add(schema.resolve(k).name);
    if (locked.size) columnNotEditable([...locked]);
  }
  if (creates.length) {
    const requiredCols = schema.alive.filter((c) => c.required && columnTypeDef(c.type).writable);
    const autoCols = schema.alive.filter((c) => c.type === "auto_number");
    // Auto numbers: take the next block for each auto-number column.
    const autoStart = new Map<string, number>();
    for (const c of autoCols) {
      const res = await db.execute(sql`UPDATE dh_columns SET config = jsonb_set(config, '{seq}', to_jsonb(coalesce((config->>'seq')::int, coalesce((config->>'start')::int, 1) - 1) + ${creates.length}::int)) WHERE ${access.scope()} AND id = ${c.id}::uuid RETURNING (config->>'seq')::int AS last`);
      autoStart.set(c.key, (res.rows[0] as { last: number }).last - creates.length + 1);
    }
    // Row numbers: one statement per batch; it also serialises concurrent inserts into this table.
    const res = await db.execute(sql`UPDATE dh_tables SET next_row_no = next_row_no + ${creates.length}::int, row_count = row_count + ${creates.length}::int WHERE /*scope*/ id = ${access.tableId}::uuid RETURNING next_row_no - ${creates.length}::int AS first_no`);
    const firstNo = (res.rows[0] as { first_no: number }).first_no;
    creates.forEach((p, n) => {
      const data: Record<string, Stored> = {};
      // The creator's own cells (person-stored columns) are kept apart: they never enter the row (module4 3.4).
      const own: Record<string, Stored> = {};
      for (const c of schema.alive) {
        const def = columnTypeDef(c.type);
        if (!def.writable) continue;
        if (!p.cells.has(c.key) && c.defaultValue !== null && c.defaultValue !== undefined) (c.storage === "person" ? own : data)[c.key] = c.defaultValue as Stored;
      }
      for (const [k, v] of p.cells) {
        const target = schema.resolve(k).storage === "person" ? own : data;
        if (v === null) delete target[k];
        else target[k] = v;
      }
      if (Object.keys(own).length) ownWrites.set(p.id, own);
      // A member's new row carries their name in the main key column, so they see it (design module2 section 10).
      const primary = access.reader ? access.table.split.primary : null;
      if (primary && data[primary] === undefined) data[primary] = actorId;
      if (access.reader && !access.seesRow(data)) rowOutsideScope();
      for (const c of schema.alive) {
        const v = c.storage === "person" ? own[c.key] : data[c.key];
        if (c.type === "user" && typeof v === "string") userUses.push({ row: p.indexes[0]!, column: c.name, id: v });
      }
      for (const c of autoCols) data[c.key] = autoStart.get(c.key)! + n;
      for (const c of requiredCols) {
        if ((c.storage === "person" ? own[c.key] : data[c.key]) === undefined) issues.push({ row: p.indexes[0]!, column: c.name, message: `Cột "${c.name}" là bắt buộc.` });
      }
      // History records what people entered; the formulas computed below never enter it.
      history.push({ rowId: p.id, version: 1, op: "create", changes: Object.entries(data).map(([field, v]) => ({ field, old: null, new: v })) });
      for (const k of Object.keys(data)) changedColumns.add(k);
      formulas?.compute(data, { id: p.id, rowNo: firstNo + n, createdAt: now, updatedAt: now, createdBy: actorId, updatedBy: actorId }, now).forEach((k) => changedColumns.add(k));
      newData.set(p.id, data);
      insertRows.push({ id: p.id, row_no: firstNo + n, data, search: buildSearchText(data, schema.aliveAll) });
      outcome.set(p, "created");
    });
    throwIssues(issues);
  }
  await checkMembers(db, access, userUses, issues);
  throwIssues(issues);

  // ---- 6. write ----------------------------------------------------------------------------------------
  const out = new Map<string, LoadedRow>();
  try {
    if (insertRows.length) {
      const res = await db.execute(sql`INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
        SELECT v.id, ${access.tableId}::uuid, v.row_no, v.data, v.search, ${actorId}::uuid, ${actorId}::uuid
        FROM jsonb_to_recordset(${JSON.stringify(insertRows)}::jsonb) AS v(id uuid, row_no int, data jsonb, search text)
        RETURNING ${ROW_COLS}`);
      for (const r of res.rows as Record<string, unknown>[]) out.set(r.id as string, rowFromDb(r));
    }
    if (updateRows.length) {
      const res = await db.execute(sql`UPDATE dh_rows r SET data = v.data, search = v.search, version = r.version + 1, updated_at = now(), updated_by = ${actorId}::uuid
        FROM jsonb_to_recordset(${JSON.stringify(updateRows)}::jsonb) AS v(id uuid, data jsonb, search text)
        WHERE ${access.rows("r")} AND r.id = v.id AND r.deleted_at IS NULL
        RETURNING r.id, r.row_no, r.version, r.data, r.created_at, r.created_by, r.updated_at, r.updated_by`);
      for (const r of res.rows as Record<string, unknown>[]) out.set(r.id as string, rowFromDb(r));
    }
  } catch (e) {
    duplicateError(e, schema);
  }
  // The actor's own cells (module4 3.4): merged into their row of values; an empty cell removes its key. No history, no version, no event: nobody else can see them.
  if (ownWrites.size) {
    const entries = [...ownWrites].map(([row_id, data]) => ({ row_id, set: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)), unset: Object.entries(data).filter(([, v]) => v === null).map(([k]) => k) }));
    const json = JSON.stringify(entries);
    await db.execute(sql`INSERT INTO dh_person_cells (row_id, user_id, table_id, data)
      SELECT v.row_id, ${actorId}::uuid, ${access.tableId}::uuid, v.set FROM jsonb_to_recordset(${json}::jsonb) AS v(row_id uuid, set jsonb, unset jsonb)
      ON CONFLICT (row_id, user_id) DO UPDATE SET data = dh_person_cells.data || EXCLUDED.data`);
    if (entries.some((e) => e.unset.length)) {
      await db.execute(sql`UPDATE dh_person_cells c SET data = c.data - ARRAY(SELECT jsonb_array_elements_text(v.unset))
        FROM jsonb_to_recordset(${json}::jsonb) AS v(row_id uuid, set jsonb, unset jsonb) WHERE /*scope*/ c.table_id = ${access.tableId}::uuid AND c.user_id = ${actorId}::uuid AND c.row_id = v.row_id AND jsonb_array_length(v.unset) > 0`);
    }
  }
  if (deleteIds.length) {
    const res = await db.execute(sql`UPDATE dh_rows SET deleted_at = now(), deleted_by = ${actorId}::uuid, version = version + 1, updated_at = now(), updated_by = ${actorId}::uuid
      WHERE ${access.rows()} AND deleted_at IS NULL AND id = ANY(${uuidArray(deleteIds)}::uuid[])
      RETURNING ${ROW_COLS}`);
    for (const r of res.rows as Record<string, unknown>[]) {
      const row = rowFromDb(r);
      out.set(row.id, row);
      history.push({ rowId: row.id, version: row.version, op: "delete", changes: Object.entries(row.data).filter(([field]) => !field.startsWith("!") && !computedKeys.has(field)).map(([field, v]) => ({ field, old: v, new: null })) });
    }
    await db.execute(sql`UPDATE dh_tables SET row_count = row_count - ${deleteIds.length}::int WHERE /*scope*/ id = ${access.tableId}::uuid`);
  }

  // ---- 7. history, audit, events -------------------------------------------------------------------------
  if (history.length) {
    await db.insert(rowHistory).values(history.map((h) => ({ tableId: access.tableId, rowId: h.rowId, version: h.version, op: h.op, changes: h.changes, actor: actorRef })));
  }
  const ids = (kind: OpResult["outcome"]) => plans.filter((p) => outcome.get(p) === kind).map((p) => p.id);
  const created = ids("created");
  const updated = ids("updated");
  const deleted = ids("deleted");
  const columns = [...changedColumns];
  // What this write changed, with the OLD and NEW cells known right here, is queued for every computed column that reads the table.
  const rowChanges: RowChange[] = [
    ...created.map((id): RowChange => ({ rowId: id, kind: "insert", old: null, new: newData.get(id)! })),
    ...updated.map((id): RowChange => ({ rowId: id, kind: "update", old: loaded.get(id)!.data, new: newData.get(id)! })),
    ...deleted.map((id): RowChange => ({ rowId: id, kind: "delete", old: out.get(id)?.data ?? loaded.get(id)!.data, new: null })),
  ];
  const seq = await nextChangeSeq(db);
  if (rowChanges.length) await recordChanges(db, access.tableId, rowChanges, seq);
  ctx.audit({ type: "datahub_row", id: access.tableId, details: { table_id: access.tableId, created: created.length, updated: updated.length, deleted: deleted.length, fields: columns } });
  // Who held the key columns before and after: the worker needs it to tell people a row left or joined their view (split lock).
  const keyUsers: string[] | undefined = access.table.split.enabled
    ? [...new Set([...loaded.values(), ...[...newData.values()].map((data) => ({ data }))].flatMap((r) => access.table.split.keys.map((k) => r.data[k]).filter((v): v is string => typeof v === "string")))].slice(0, 2000)
    : undefined;
  const emit = async (event: string, rowIds: string[]) => {
    if (rowIds.length) await ctx.emit(event, { aggregateType: "datahub_table", aggregateId: access.tableId, payload: { table_id: access.tableId, row_ids: rowIds, columns, seq, ...(keyUsers ? { key_users: keyUsers } : {}) } });
  };
  await emit("datahub.row.created", created);
  await emit("datahub.row.updated", updated);
  await emit("datahub.row.deleted", deleted);

  // What the actor gets back is their row as they see it: their own values of the person-stored columns on top of the row.
  const ownNow = new Map<string, Record<string, Stored>>();
  if (access.hasPersonCells) {
    const want = [...new Set(plans.filter((p) => outcome.get(p) !== "deleted").map((p) => p.id))];
    if (want.length) {
      const res = await db.execute(sql`SELECT row_id, data FROM dh_person_cells WHERE /*scope*/ table_id = ${access.tableId}::uuid AND user_id = ${actorId}::uuid AND row_id = ANY(${uuidArray(want)}::uuid[])`);
      for (const r of res.rows as { row_id: string; data: Record<string, Stored> }[]) ownNow.set(r.row_id, r.data);
    }
  }
  return ops.map((o, i) => {
    const p = planOf[i]!;
    const oc = outcome.get(p)!;
    const base = out.get(p.id) ?? loaded.get(p.id) ?? null;
    const row = base && ownNow.has(p.id) ? { ...base, data: { ...base.data, ...ownNow.get(p.id) } } : base;
    return { op: o.op, outcome: oc, id: p.id, row: oc === "deleted" || !row ? null : toApiRow(row, schema, opts.labels), seq };
  });
}

/** Restores rows from the trash (design section 12). Needs `edit_data`. Returns the restored rows. */
export async function restoreRows(ctx: Ctx, access: TableAccess, schema: TableSchema, rowIds: string[]): Promise<{ rows: ApiRow[]; seq: number }> {
  access.require("edit_data");
  assertWritable(access);
  const actorId = ctx.actor.userId;
  ctx.audit({ type: "datahub_row", id: access.tableId, details: { table_id: access.tableId, restored: rowIds.length } });
  const res = await ctx.db.execute(sql`UPDATE dh_rows SET deleted_at = NULL, deleted_by = NULL, version = version + 1, updated_at = now(), updated_by = ${actorId}::uuid
    WHERE ${access.rows()} AND deleted_at IS NOT NULL AND id = ANY(${uuidArray(rowIds)}::uuid[])
    RETURNING ${ROW_COLS}`);
  const rows = (res.rows as Record<string, unknown>[]).map(rowFromDb);
  if (rows.length !== rowIds.length) throw new AppError("not_found", "Có dòng không nằm trong thùng rác (hoặc đã bị xoá hẳn).");
  // Same right as deleting it: a row the reader may not edit cannot be brought back by them either (the whole call is rolled back).
  if (access.restricted) for (const r of rows) if (!access.canEditRow(r.data)) rowNotEditable(r.id);
  await ctx.db.execute(sql`UPDATE dh_tables SET row_count = row_count + ${rows.length}::int WHERE /*scope*/ id = ${access.tableId}::uuid`);
  await ctx.db.insert(rowHistory).values(rows.map((r) => ({ tableId: access.tableId, rowId: r.id, version: r.version, op: "restore", changes: [] as FieldChange[], actor: toActorRef(ctx.actor) })));
  const seq = await nextChangeSeq(ctx.db);
  await recordChanges(ctx.db, access.tableId, rows.map((r): RowChange => ({ rowId: r.id, kind: "restore", old: null, new: r.data })), seq);
  await ctx.emit("datahub.row.restored", { aggregateType: "datahub_table", aggregateId: access.tableId, payload: { table_id: access.tableId, row_ids: rows.map((r) => r.id), columns: [], seq } });
  return { rows: rows.map((r) => toApiRow(r, schema)), seq };
}
