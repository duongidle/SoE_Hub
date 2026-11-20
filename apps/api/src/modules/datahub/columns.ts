import { refreshReaderScoped } from "./reader-scope";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, COLUMN_TYPES, DhNameSchema, toActorRef } from "@soe/shared";
import { newId, rowHistory, type Executor, type FieldChange } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { loadTableAccess, type TableAccess } from "./access";
import { buildSearchText, columnTypeDef, convertValue, listColumnTypes, newColumnKey, newOptionId, normalizeConfig, normalizeDisplay, normalizeOptions } from "./column-types";
import { DH_REASON, pgError, rethrowNameConflict } from "./errors";
import { getLimits, quotaExceeded } from "./limits";
import { emitStructure, Id, STRUCTURE_EVENT } from "./shared";
import { columnOut, ColumnOut, indexFor } from "./structure";
import { isComputedType } from "./cell-values";
import { resolveLinkTarget } from "./link-targets";
import { OwnerIndex, prepareComputed, type DepRow, type PreparedComputed } from "./computed";
import { markPending } from "./recalc";
import { columnFromDb, rowFromDb, TableSchema } from "./table-schema";
import { CellError, type DhColumn, type SelectOption, type Stored } from "./types";

type Raw = Record<string, unknown>;
type Ctx = Pick<HandlerCtx, "db" | "actor" | "emit" | "audit" | "requestId">;

const ColumnRef = z.string().min(1).max(100).describe("Mã cột hoặc tên cột.");

async function loadColumn(db: Executor, access: TableAccess, ref: string, state: "alive" | "trashed" = "alive"): Promise<{ schema: TableSchema; col: DhColumn }> {
  const schema = await TableSchema.load(db, access);
  const col = schema.tryResolve(ref);
  const ok = col && (state === "alive" ? !col.deletedAt : !!col.deletedAt);
  if (!col || !ok) throw new AppError("not_found", `Không tìm thấy cột "${ref}".`);
  return { schema, col };
}

async function reload(db: Executor, access: TableAccess, id: string): Promise<DhColumn> {
  const res = await db.execute(sql`SELECT * FROM dh_columns WHERE ${access.scope()} AND id = ${id}::uuid`);
  return columnFromDb(res.rows[0] as Raw);
}

/** Validates a default value against the column type (stored form). */
function parseDefault(type: string, config: Record<string, unknown>, name: string, key: string, raw: unknown): Stored | null {
  if (raw === null || raw === undefined) return null;
  const def = columnTypeDef(type);
  if (!def.writable) throw new AppError("validation_error", `Cột kiểu "${def.label}" không có giá trị mặc định.`);
  try {
    return def.parse(raw, { key, name, config });
  } catch (e) {
    if (e instanceof CellError) throw new AppError("validation_error", `Giá trị mặc định không hợp lệ: ${e.message}`);
    throw e;
  }
}

/** Index for "unique" columns: a unique partial index on the cell text. */
async function ensureUnique(ctx: Ctx, access: TableAccess, col: { key: string; name: string }): Promise<void> {
  try {
    await ctx.db.execute(sql`SELECT soe_dh_ensure_index(${access.tableId}::uuid, ${col.key}, 'uniq')`);
  } catch (e) {
    if (pgError(e).code === "23505") {
      throw new AppError("conflict", `Cột "${col.name}" đang có giá trị trùng nhau nên chưa đặt được "duy nhất". Sửa các giá trị trùng rồi thử lại.`, { reason: "duplicate_values", column: col.name });
    }
    throw e;
  }
}

async function nextPosition(db: Executor, access: TableAccess): Promise<number> {
  const res = await db.execute(sql`SELECT coalesce(max(position), -1) + 1 AS next FROM dh_columns WHERE ${access.scope()} AND deleted_at IS NULL`);
  return (res.rows[0] as { next: number }).next;
}

/** Stores the dependencies and schedule of a computed column and queues its whole-column recalculation (design module2 section 6.5). */
async function saveComputed(ctx: Ctx, acc: TableAccess, columnId: string, p: PreparedComputed): Promise<void> {
  await ctx.db.execute(sql`DELETE FROM dh_formula_deps WHERE ${acc.scope()} AND column_id = ${columnId}::uuid`);
  await insertDeps(ctx, acc.tableId, columnId, p.deps);
  await ctx.db.execute(sql`UPDATE dh_columns SET calc_volatile = ${p.volatile} WHERE ${acc.scope()} AND id = ${columnId}::uuid`);
  // The new dependencies may make this column (and the columns that read it) reader-scoped, or no longer so (design module2 section 10).
  const flips = await refreshReaderScoped(ctx.db, acc.datahub.ownerId);
  await markPending(ctx.db, [columnId, ...flips.became, ...flips.stopped]);
}

async function insertDeps(ctx: Ctx, tableId: string, columnId: string, deps: DepRow[]): Promise<void> {
  if (deps.length === 0) return;
  await ctx.db.execute(sql`INSERT INTO dh_formula_deps (column_id, table_id, src_table_id, src_key, kind)
    SELECT ${columnId}::uuid, ${tableId}::uuid, d.src_table_id, d.src_key, d.kind
    FROM jsonb_to_recordset(${JSON.stringify(deps.map((d) => ({ src_table_id: d.srcTableId, src_key: d.srcKey, kind: d.kind })))}::jsonb) AS d(src_table_id uuid, src_key text, kind text)
    ON CONFLICT DO NOTHING`);
}

/** Queues the columns that read the given columns of a table. */
async function markDependents(ctx: Ctx, tableId: string, keys: string[]): Promise<void> {
  const res = await ctx.db.execute(sql`SELECT DISTINCT c.id FROM dh_formula_deps f JOIN dh_columns c ON c.id = f.column_id
    WHERE /*scope*/ c.deleted_at IS NULL AND f.src_table_id = ${tableId}::uuid AND f.src_key = ANY(${`{${keys.join(",")}}`}::text[])`);
  await markPending(ctx.db, (res.rows as { id: string }[]).map((r) => r.id));
}


/** What a template adds to a column on top of the column commands' input (design module4 3.1, 3.4, 3.7). */
/** A column name another live column of the table already uses (a custom column also may not take the name of a template column: module4 3.1). */
async function assertNameFree(db: Executor, acc: TableAccess, name: string): Promise<void> {
  const res = await db.execute(sql`SELECT 1 FROM dh_columns WHERE ${acc.scope()} AND deleted_at IS NULL AND layer IS DISTINCT FROM 'custom' AND name_norm = lower(btrim(${name}))`);
  if (res.rows.length) throw new AppError("conflict", "Bảng này đã có một cột mẫu tên này. Hãy đặt tên khác cho cột riêng.", { reason: "duplicate_name" });
}

export interface ColumnExtra {
  /** A column of the caller's own on a template table: custom layer, one value per person, nobody else sees it. */
  custom?: boolean;
  layer?: "basic" | "role" | "team";
  layerRef?: string | null;
  layerRoles?: string[] | null;
  storage?: "shared" | "person";
  role?: string | null;
  templateColumnId?: string | null;
  /** Created by the template commands: protected from the column commands. */
  protectedColumn?: boolean;
}

type ColumnInput = z.output<z.ZodObject<typeof ColumnBody>>;

/** Types a person can keep as their own column on a template table: plain cells, no computation, no files, no uniqueness (nobody can check it across people). */
function assertCustomType(type: string, i: { unique?: boolean; required?: boolean }): void {
  const def = columnTypeDef(type);
  if (!def.writable || def.virtual || isComputedType(type) || type === "relation" || type === "attachment" || type === "auto_number") {
    throw new AppError("validation_error", `Cột riêng trên bảng template không dùng kiểu "${def.label}". Dùng kiểu nhập tay: chữ, số, ngày, chọn, người dùng...`, { reason: "custom_column_type" });
  }
  if (i.unique) throw new AppError("validation_error", "Cột riêng không đặt được \"duy nhất\" (mỗi người một giá trị, không so với người khác).", { reason: "custom_column_type" });
  if (i.required) throw new AppError("validation_error", "Cột riêng không đặt được \"bắt buộc\".", { reason: "custom_column_type" });
}

/**
 * Adds a column (design module2 section 4; module4 3.1 for the template layers). Authorisation is the caller's: the column command (owner, or anyone
 * for a custom column of a template table) and the template commands (the people allowed to edit the template). `acc` is the table as the caller sees it.
 */
export async function createColumn(ctx: Ctx, acc: TableAccess, i: ColumnInput, extra: ColumnExtra = {}): Promise<z.infer<typeof ColumnOut>> {
  if (acc.table.kind === "merged" && !isComputedType(i.type)) throw new AppError("forbidden", "Bảng gộp chỉ thêm được cột công thức. Cột dữ liệu do cấu hình ghép cột quyết định.", { reason: "merged_table_columns" });
  const def = columnTypeDef(i.type);
  if (!def.available) throw new AppError("validation_error", `Kiểu cột "${def.label}" chưa dùng được.`);
  if (extra.custom) {
    assertCustomType(i.type, i);
    await assertNameFree(ctx.db, acc, i.name);
  }
  const limits = await getLimits(ctx.db, extra.custom ? ctx.actor.userId : acc.datahub.ownerId);
  const cnt = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_columns WHERE ${acc.scope()} AND deleted_at IS NULL AND (layer IS DISTINCT FROM 'custom' OR layer_ref = ${ctx.actor.userId}::uuid)`);
  if ((cnt.rows[0] as { n: number }).n >= limits.columns) quotaExceeded("cột trong một bảng", limits.columns);
  const layer = extra.custom ? "custom" : (extra.layer ?? null);
  const storage = extra.custom ? "person" : (extra.storage ?? "shared");
  const layerRef = extra.custom ? ctx.actor.userId : (extra.layerRef ?? null);
  const key = newColumnKey();
  const id = newId();
  // Formula, relation, lookup, rollup: checked against the owner's tables (same owner only, no cycle, scan size).
  const linked = isComputedType(i.type) || i.type === "relation";
  let prepared: PreparedComputed | null = null;
  if (linked) {
    const ix = await OwnerIndex.load(ctx.db, acc.datahub.ownerId);
    await allowTemplateTarget(ctx, ix, acc.datahub.ownerId, i.type, i.config);
    prepared = await prepareComputed(ctx.db, ix, await TableSchema.load(ctx.db, acc), { id, key, tableId: acc.tableId, datahubId: acc.datahub.id, type: i.type as "formula" }, i.config ?? {});
  }
  const config = prepared ? prepared.config : normalizeConfig(i.type, i.config);
  const display = normalizeDisplay(i.display);
  if (i.unique && !def.uniqueable) throw new AppError("validation_error", `Cột kiểu "${def.label}" không đặt được "duy nhất".`);
  const dflt = parseDefault(i.type, config, i.name, key, i.default_value);
  const position = i.position ?? (await nextPosition(ctx.db, acc));
  try {
    await ctx.db.execute(sql`INSERT INTO dh_columns (id, table_id, key, name, type, config, position, required, allow_edit, is_unique, default_value, description, display, layer, layer_ref, layer_roles, storage, role, template_column_id, protected, created_by, updated_by)
      VALUES (${id}::uuid, ${acc.tableId}::uuid, ${key}, ${i.name}, ${i.type}, ${JSON.stringify(config)}::jsonb, ${position}::int, ${i.required ?? false}, ${extra.custom ? true : (i.allow_edit ?? (layer ? false : true))}, ${i.unique ?? false}, ${dflt === null ? null : JSON.stringify(dflt)}::jsonb, ${i.description ?? null}, ${JSON.stringify(display)}::jsonb,
        ${layer}, ${layerRef}::uuid, ${extra.layerRoles ? `{${extra.layerRoles.join(",")}}` : null}::text[], ${storage}, ${extra.role ?? null}, ${extra.templateColumnId ?? null}::uuid, ${extra.protectedColumn ?? false}, ${ctx.actor.userId}::uuid, ${ctx.actor.userId}::uuid)`);
  } catch (e) {
    rethrowNameConflict(e);
  }
  // Auto number on a table that already has rows: number the existing rows by row number (system fill, no history).
  if (i.type === "auto_number") {
    const start = (config.start as number | undefined) ?? 1;
    await ctx.db.execute(sql`UPDATE dh_rows r SET data = r.data || jsonb_build_object(${key}::text, ${start - 1}::int + n.rn)
      FROM (SELECT id, row_number() OVER (ORDER BY row_no) AS rn FROM dh_rows WHERE ${acc.scope()}) n WHERE ${acc.scope("r")} AND r.id = n.id`);
    const c = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_rows WHERE ${acc.scope()}`);
    await ctx.db.execute(sql`UPDATE dh_columns SET config = jsonb_set(config, '{seq}', to_jsonb(${start - 1 + (c.rows[0] as { n: number }).n}::int)) WHERE ${acc.scope()} AND id = ${id}::uuid`);
  }
  if (i.unique) await ensureUnique(ctx, acc, { key, name: i.name });
  // Reverse lookup of links ("which rows link to row X") uses this index; there is no link table (design module2 section 6.7).
  if (i.type === "relation") await ctx.db.execute(sql`SELECT soe_dh_ensure_index(${acc.tableId}::uuid, ${key}, 'rel')`);
  if (prepared && isComputedType(i.type)) await saveComputed(ctx, acc, id, prepared);
  ctx.audit({ type: "datahub_column", id, details: { table_id: acc.tableId, name: i.name, type: i.type } });
  await emitStructure(ctx, acc.datahub.id, acc.tableId, "column_created");
  const created = await reload(ctx.db, acc, id);
  return columnOut(created, await indexFor(ctx.db, acc.datahub.ownerId, [created]));
}


/** The reason a template column is not changed from the column commands (design module4 1.3): only the template commands change it. */
function templateProtected(col: DhColumn, what: string): never {
  throw new AppError("forbidden", `Cột "${col.name}" là cột của bảng template, không ${what} ở đây. Chỉ người sửa template làm được, ở trang Template.`, { reason: "template_protected", column: col.name });
}

/**
 * Loads a column for a change made through the column commands. Owner only, except a custom column of a template table: the person who made it
 * changes it (design module4 3.1). A template column (protected) is never changed from here.
 */
async function loadColumnForWrite(ctx: Ctx, tableId: string, ref: string, state: "alive" | "trashed", what: string): Promise<{ acc: TableAccess; schema: TableSchema; col: DhColumn; mine: boolean }> {
  const acc = await loadTableAccess(ctx, tableId, "view");
  const { schema, col } = await loadColumn(ctx.db, acc, ref, state);
  if (acc.table.templateId && col.layer === "custom" && col.layerRef === ctx.actor.userId) return { acc, schema, col, mine: true };
  acc.require("owner");
  if (col.protected) templateProtected(col, what);
  return { acc, schema, col, mine: false };
}

async function loadColumnForTypeChange(ctx: Ctx, tableId: string, ref: string): Promise<{ acc: TableAccess; schema: TableSchema; col: DhColumn }> {
  const acc = await loadTableAccess(ctx, tableId, "view");
  if (acc.table.templateId) {
    const { schema, col } = await loadColumn(ctx.db, acc, ref);
    if (col.layer === "custom") throw new AppError("forbidden", "Cột riêng không đổi kiểu được. Xoá cột rồi tạo lại với kiểu mới.", { reason: "custom_column_type" });
    acc.require("owner");
    if (col.protected) templateProtected(col, "đổi kiểu");
    return { acc, schema, col };
  }
  acc.require("owner");
  if (acc.table.kind === "merged") throw new AppError("forbidden", "Không đổi kiểu cột của bảng gộp.", { reason: "merged_table_columns" });
  const { schema, col } = await loadColumn(ctx.db, acc, ref);
  return { acc, schema, col };
}

type UpdateInput = { name?: string; config?: Record<string, unknown>; required?: boolean; allow_edit?: boolean; unique?: boolean; default_value?: unknown; description?: string | null; display?: Record<string, unknown>; position?: number; version?: number };

/** Changes a column (same rules for the column command and the template command; authorisation is the caller's). */
/** A Relation may point to a template table the owner reads (design module4 1.1): let `prepareComputed` accept it. */
async function allowTemplateTarget(ctx: Ctx, ix: OwnerIndex, ownerId: string, type: string, config: Record<string, unknown> | undefined): Promise<void> {
  const target = type === "relation" ? config?.target_table_id : undefined;
  if (typeof target !== "string" || ix.tableById.has(target)) return;
  if (/^[0-9a-f-]{36}$/i.test(target) && (await resolveLinkTarget(ctx, ownerId, target))) ix.linkable.add(target);
}

export async function updateColumn(ctx: Ctx, acc: TableAccess, col: DhColumn, i: UpdateInput): Promise<z.infer<typeof ColumnOut>> {
      if (i.version !== undefined && i.version !== col.version) throw new AppError("conflict", undefined, { current_version: col.version, sent_version: i.version });
  if (acc.table.kind === "merged" && !isComputedType(col.type) && (i.config !== undefined || i.required !== undefined || i.unique !== undefined || i.default_value !== undefined)) {
    throw new AppError("forbidden", "Cột của bảng gộp chỉ đổi được tên, mô tả, định dạng hiển thị và vị trí. Đổi cách ghép ở phần cấu hình bảng gộp.", { reason: "merged_table_columns" });
  }
  const def = columnTypeDef(col.type);
  const linked = isComputedType(col.type) || col.type === "relation";
  let prepared: PreparedComputed | null = null;
  if (linked && i.config !== undefined) {
    const ix = await OwnerIndex.load(ctx.db, acc.datahub.ownerId);
    prepared = await prepareComputed(ctx.db, ix, await TableSchema.load(ctx.db, acc), { id: col.id, key: col.key, tableId: acc.tableId, datahubId: acc.datahub.id, type: col.type as "formula", current: col }, { ...i.config });
  }
  const config = prepared ? prepared.config : i.config !== undefined ? normalizeConfig(col.type, { ...i.config }) : col.config;
  // Keep the internal counter of an auto-number column.
  if (col.type === "auto_number" && i.config !== undefined && col.config.seq !== undefined) config.seq = col.config.seq;
  const display = i.display !== undefined ? normalizeDisplay(i.display) : col.display;
  const name = i.name ?? col.name;
  const unique = i.unique ?? col.isUnique;
  if (unique && !def.uniqueable) throw new AppError("validation_error", `Cột kiểu "${def.label}" không đặt được "duy nhất".`);
  let dflt: Stored | null = col.defaultValue as Stored | null;
  if (i.default_value !== undefined || i.config !== undefined) dflt = parseDefault(col.type, config, name, col.key, i.default_value !== undefined ? i.default_value : col.defaultValue);
  try {
    await ctx.db.execute(sql`UPDATE dh_columns SET name = ${name}, config = ${JSON.stringify(config)}::jsonb, required = ${i.required ?? col.required}, allow_edit = ${i.allow_edit ?? col.allowEdit}, is_unique = ${unique},
      default_value = ${dflt === null ? null : JSON.stringify(dflt)}::jsonb, description = ${i.description === undefined ? col.description : i.description}, display = ${JSON.stringify(display)}::jsonb,
      position = ${i.position ?? col.position}::int, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE ${acc.scope()} AND id = ${col.id}::uuid`);
  } catch (e) {
    rethrowNameConflict(e);
  }
  if (unique && !col.isUnique) await ensureUnique(ctx, acc, { key: col.key, name });
  if (!unique && col.isUnique) await ctx.db.execute(sql`SELECT soe_dh_drop_indexes(${acc.tableId}::uuid, ${col.key}, ARRAY['uniq'])`);
  if (prepared && isComputedType(col.type)) await saveComputed(ctx, acc, col.id, prepared);
  // A relation that changed (single/multiple) changes what lookups and rollups on it return.
  if (prepared && col.type === "relation") await markDependents(ctx, acc.tableId, [col.key]);
  ctx.audit({ type: "datahub_column", id: col.id, details: { table_id: acc.tableId, name } });
  await emitStructure(ctx, acc.datahub.id, acc.tableId, "column_updated");
  const updated = await reload(ctx.db, acc, col.id);
  return columnOut(updated, await indexFor(ctx.db, acc.datahub.ownerId, [updated]));
}

/** Moves a column to the trash (a template column: archived, same thing). Data is kept. */
export async function deleteColumn(ctx: Ctx, acc: TableAccess, col: DhColumn): Promise<{ id: string; deleted: true }> {
      if (acc.table.kind === "merged" && !isComputedType(col.type)) throw new AppError("forbidden", "Không xoá được cột dữ liệu của bảng gộp. Bỏ cột ở phần cấu hình ghép cột.", { reason: "merged_table_columns" });
  assertNotKeyColumn(acc, col, "xoá");
  await ctx.db.execute(sql`UPDATE dh_columns SET deleted_at = now(), deleted_by = ${ctx.actor.userId}::uuid, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE ${acc.scope()} AND id = ${col.id}::uuid`);
  ctx.audit({ type: "datahub_column", id: col.id, details: { table_id: acc.tableId, name: col.name } });
  await emitStructure(ctx, acc.datahub.id, acc.tableId, "column_deleted");
  return { id: col.id, deleted: true as const };
}

/** Brings a column back from the trash; `name` replaces a name that was taken in the meantime. */
export async function restoreColumn(ctx: Ctx, acc: TableAccess, col: DhColumn, name: string | undefined): Promise<z.infer<typeof ColumnOut>> {
      if (acc.table.kind === "merged" && !isComputedType(col.type)) throw new AppError("forbidden", "Không khôi phục cột dữ liệu của bảng gộp. Thêm lại cột ở phần cấu hình ghép cột.", { reason: "merged_table_columns" });
  const limits = await getLimits(ctx.db, ctx.actor.userId);
  const cnt = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_columns WHERE ${acc.scope()} AND deleted_at IS NULL`);
  if ((cnt.rows[0] as { n: number }).n >= limits.columns) quotaExceeded("cột trong một bảng", limits.columns);
  try {
    await ctx.db.execute(sql`UPDATE dh_columns SET deleted_at = NULL, deleted_by = NULL, name = ${name ?? col.name}, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE ${acc.scope()} AND id = ${col.id}::uuid`);
  } catch (e) {
    rethrowNameConflict(e);
  }
  ctx.audit({ type: "datahub_column", id: col.id, details: { table_id: acc.tableId, name: name ?? col.name } });
  await emitStructure(ctx, acc.datahub.id, acc.tableId, "column_restored");
  const restored = await reload(ctx.db, acc, col.id);
  return columnOut(restored, await indexFor(ctx.db, acc.datahub.ownerId, [restored]));
}

/** Converts a column to another type: scans the rows, reports what cannot be converted, writes values and history (authorisation is the caller's). */
export async function changeColumnType(ctx: Ctx, acc: TableAccess, schema: TableSchema, col: DhColumn, i: { type: string; config?: Record<string, unknown>; accept_data_loss: boolean }): Promise<{ column: z.infer<typeof ColumnOut>; report: ConversionReport }> {
  assertNotKeyColumn(acc, col, "đổi kiểu");
  checkTypeChange(col, i.type);
  const cfg = await targetConfig(ctx.db, acc, col, i.type, i.config);
  const dry = await convertColumn(ctx, acc, schema, col, i.type, cfg, false);
  if (dry.cannot_convert > 0 && !i.accept_data_loss) {
    throw new AppError("validation_error", `${dry.cannot_convert} giá trị không chuyển được sang kiểu mới. Xem trước rồi gửi accept_data_loss: true nếu đồng ý xoá các ô đó (giá trị cũ vẫn nằm trong lịch sử).`, { cannot_convert: dry.cannot_convert, samples: dry.samples });
  }
  ctx.audit({ type: "datahub_column", id: col.id, details: { table_id: acc.tableId, from: col.type, to: i.type, cannot_convert: dry.cannot_convert } });
  const report = await convertColumn(ctx, acc, schema, col, i.type, cfg, true);
  const nextDef = columnTypeDef(i.type);
  const keepUnique = col.isUnique && nextDef.uniqueable;
  await ctx.db.execute(sql`UPDATE dh_columns SET type = ${i.type}, config = ${JSON.stringify(cfg)}::jsonb, display = '{}'::jsonb, default_value = NULL, is_unique = ${keepUnique},
    version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE ${acc.scope()} AND id = ${col.id}::uuid`);
  // The old indexes were built for the old value form: drop them and rebuild the unique one.
  await ctx.db.execute(sql`SELECT soe_dh_drop_indexes(${acc.tableId}::uuid, ${col.key})`);
  await ctx.db.execute(sql`DELETE FROM dh_index_requests WHERE ${acc.scope()} AND column_key = ${col.key}`);
  if (keepUnique) await ensureUnique(ctx, acc, col);
  await emitStructure(ctx, acc.datahub.id, acc.tableId, "column_type_changed");
  return { column: columnOut(await reload(ctx.db, acc, col.id), null), report };
}

const ColumnBody = {
  name: DhNameSchema,
  type: z.enum(COLUMN_TYPES),
  config: z.record(z.string(), z.unknown()).optional(),
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  default_value: z.unknown().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  display: z.record(z.string(), z.unknown()).optional(),
  position: z.number().int().min(0).max(1000).optional(),
  allow_edit: z.boolean().optional().describe("Thành viên có quyền Sửa có được sửa ô của cột này không (mặc định có). Chủ bảng luôn sửa được; cột công thức không ai sửa ô."),
};

// ------------------------------------------------------------------------------------------------
// type change
// ------------------------------------------------------------------------------------------------

export interface ConversionReport {
  total_rows: number;
  with_value: number;
  unchanged: number;
  converted: number;
  cannot_convert: number;
  /** First rows whose value cannot be converted (value shown so the owner can decide). */
  samples: { row_id: string; row_no: number; value: unknown; reason: string }[];
}

/** Target config for a type change; text-like values turn into options of a select when none were given. */
async function targetConfig(db: Executor, access: TableAccess, col: DhColumn, type: string, raw: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
  const cfg = normalizeConfig(type, raw ?? columnTypeDef(type).defaultConfig());
  if ((type === "single_select" || type === "multi_select") && (cfg.options as SelectOption[]).length === 0 && col.type !== "single_select" && col.type !== "multi_select") {
    const key = col.key;
    const res = await db.execute(sql`SELECT DISTINCT ${sql.raw(`data->>'${key}'`)} AS v FROM dh_rows WHERE ${access.scope()} AND deleted_at IS NULL AND data ? ${key} ORDER BY 1 LIMIT 201`);
    const vals = (res.rows as { v: string | null }[]).map((r) => r.v).filter((v): v is string => !!v && v.trim() !== "" && v.length <= 100);
    if (vals.length > 0 && vals.length <= 200) cfg.options = normalizeOptions(vals.map((name) => ({ name, id: newOptionId() })));
  }
  return cfg;
}

const SCAN_BATCH = 2000;

/** Scans every live row that has a value in the column and converts it. With `apply`, writes rows and their history. */
async function convertColumn(ctx: Ctx, access: TableAccess, schema: TableSchema, col: DhColumn, toType: string, toConfig: Record<string, unknown>, apply: boolean): Promise<ConversionReport> {
  const to = { key: col.key, name: col.name, config: toConfig, type: toType as DhColumn["type"] };
  const report: ConversionReport = { total_rows: 0, with_value: 0, unchanged: 0, converted: 0, cannot_convert: 0, samples: [] };
  const totalRes = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_rows WHERE ${access.scope()} AND deleted_at IS NULL`);
  report.total_rows = (totalRes.rows[0] as { n: number }).n;
  const newCols = schema.alive.map((c) => (c.id === col.id ? { ...c, type: toType as DhColumn["type"], config: toConfig } : c));
  const actorRef = toActorRef(ctx.actor);
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const res = await ctx.db.execute(sql`SELECT id, row_no, version, data FROM dh_rows WHERE ${access.scope()} AND deleted_at IS NULL AND id > ${last}::uuid AND data ? ${col.key} ORDER BY id LIMIT ${SCAN_BATCH}`);
    const rows = res.rows as Raw[];
    if (rows.length === 0) break;
    last = rows[rows.length - 1]!.id as string;
    const updates: { id: string; data: Record<string, Stored>; search: string }[] = [];
    const history: { rowId: string; version: number; changes: FieldChange[] }[] = [];
    for (const r of rows) {
      const row = rowFromDb(r);
      const old = row.data[col.key] ?? null;
      report.with_value++;
      const conv = convertValue(col, to, old);
      if (!conv.ok) {
        report.cannot_convert++;
        if (report.samples.length < 20) report.samples.push({ row_id: row.id, row_no: row.rowNo, value: old, reason: `Không chuyển được sang kiểu "${columnTypeDef(toType).label}".` });
      } else if (JSON.stringify(conv.value) === JSON.stringify(old)) {
        report.unchanged++;
        continue;
      } else {
        report.converted++;
      }
      if (!apply) continue;
      const next = { ...row.data };
      const nv = conv.ok ? conv.value : null;
      if (nv === null) delete next[col.key];
      else next[col.key] = nv;
      // The old value stays in the row history, so a cleared value can be read back and restored by hand.
      updates.push({ id: row.id, data: next, search: buildSearchText(next, newCols) });
      history.push({ rowId: row.id, version: row.version + 1, changes: [{ field: col.key, old, new: nv }] });
    }
    if (apply && updates.length) {
      await ctx.db.execute(sql`UPDATE dh_rows r SET data = v.data, search = v.search, version = r.version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid
        FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS v(id uuid, data jsonb, search text)
        WHERE ${access.scope("r")} AND r.id = v.id`);
      await ctx.db.insert(rowHistory).values(history.map((h) => ({ tableId: access.tableId, rowId: h.rowId, version: h.version, op: "update", changes: h.changes, actor: actorRef })));
    }
  }
  return report;
}

const ReportOut = z.object({
  total_rows: z.number().int(),
  with_value: z.number().int(),
  unchanged: z.number().int(),
  converted: z.number().int(),
  cannot_convert: z.number().int(),
  samples: z.array(z.object({ row_id: Id, row_no: z.number().int(), value: z.unknown(), reason: z.string() })),
});

/** A key column of the split lock keeps its type and stays (design module2 section 10): take it out of the keys first. */
function assertNotKeyColumn(acc: TableAccess, col: DhColumn, what: string): void {
  if (acc.table.split.keys.includes(col.key)) {
    throw new AppError("forbidden", `Cột "${col.name}" đang là cột khoá phân chia, không ${what} được. Bỏ cột khỏi danh sách khoá trước.`, { reason: DH_REASON.keyColumn, column: col.name });
  }
}

function checkTypeChange(col: DhColumn, type: string): void {
  const from = columnTypeDef(col.type);
  const to = columnTypeDef(type);
  if (!from.writable || from.virtual || !from.available) throw new AppError("validation_error", `Không đổi kiểu cột "${from.label}".`);
  if (!to.writable || to.virtual || !to.available || type === "attachment") throw new AppError("validation_error", `Không đổi sang kiểu "${to.label}".`);
  if (type === col.type) throw new AppError("validation_error", "Cột đã có kiểu này. Dùng sửa cột để đổi cấu hình.");
}

export const columnOperations = [
  defineQuery({
    name: "datahub.column.types",
    summary: "Danh mục kiểu cột và cấu hình mặc định của từng kiểu.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({}),
    output: z.array(z.object({ type: z.string(), label: z.string(), group: z.string(), available: z.boolean(), writable: z.boolean(), default_config: z.record(z.string(), z.unknown()), can_be_unique: z.boolean(), filterable: z.boolean(), sortable: z.boolean() })),
    http: { method: "GET", path: "/datahub/column-types" },
    handler: async () =>
      listColumnTypes().map((d) => ({ type: d.type, label: d.label, group: d.group, available: d.available, writable: d.writable, default_config: d.defaultConfig(), can_be_unique: d.uniqueable, filterable: d.fieldType !== null, sortable: d.sortable })),
  }),

  defineCommand({
    name: "datahub.column.create",
    summary: "Thêm cột vào bảng (mặc định tối đa 70 cột, trần 200). Tên cột không trùng trong bảng.",
    description:
      "Mã cột (`key`) do hệ thống sinh, không đổi dù đổi tên. Cột tính toán: `formula` (`config: {formula: \"=...\", result_type?}`), `relation` (`config: {target_table_id, multiple?}` liên kết tới bảng khác của cùng chủ), `lookup` (`config: {relation, target_column}`), `rollup` (`config: {relation, target_column, fn}`). Giá trị công thức do hệ thống tính và lưu; ô đang chờ tính có `calc.status` khác `ready`.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ table_id: Id, ...ColumnBody }),
    output: ColumnOut,
    http: { method: "POST", path: "/tables/:table_id/columns", status: 201 },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "view");
      // A template table (design module4 3.5): everyone who sees it adds columns of their own, and only those. Anywhere else only the owner adds columns.
      if (acc.table.templateId) return createColumn(ctx, acc, i, { custom: true });
      acc.require("owner");
      return createColumn(ctx, acc, i);
    },
  }),

  defineCommand({
    name: "datahub.column.update",
    summary: "Sửa cột: tên, mô tả, bắt buộc, duy nhất, mặc định, cấu hình (lựa chọn), định dạng hiển thị, vị trí. Không đổi kiểu ở đây.",
    description: "Cột gọi bằng mã hoặc tên. Đổi kiểu dùng `datahub.column.type_change` (có xem trước).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({
      table_id: Id,
      column: ColumnRef,
      name: DhNameSchema.optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      required: z.boolean().optional(),
      allow_edit: z.boolean().optional().describe("Thành viên có quyền Sửa có được sửa ô của cột này không."),
      unique: z.boolean().optional(),
      default_value: z.unknown().optional(),
      description: z.string().trim().max(1000).nullable().optional(),
      display: z.record(z.string(), z.unknown()).optional(),
      position: z.number().int().min(0).max(1000).optional(),
      version: z.number().int().min(1).optional(),
    }),
    output: ColumnOut,
    http: { method: "PATCH", path: "/tables/:table_id/columns/:column" },
    handler: async (ctx, i) => {
      const { acc, col, mine } = await loadColumnForWrite(ctx, i.table_id, i.column, "alive", "sửa");
      if (mine && (i.required !== undefined || i.unique !== undefined || i.allow_edit !== undefined || (i.config !== undefined && col.type !== "single_select" && col.type !== "multi_select"))) {
        throw new AppError("validation_error", "Cột riêng chỉ đổi được tên, mô tả, lựa chọn, giá trị mặc định, định dạng và vị trí.", { reason: "custom_column_type" });
      }
      if (mine && i.name !== undefined && i.name.trim() !== col.name) await assertNameFree(ctx.db, acc, i.name);
      return updateColumn(ctx, acc, col, i);
    },
  }),

  defineCommand({
    name: "datahub.column.delete",
    summary: "Xoá cột vào thùng rác (dữ liệu của cột được giữ để khôi phục trong 7 ngày).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ table_id: Id, column: ColumnRef }),
    output: z.object({ id: Id, deleted: z.literal(true) }),
    http: { method: "DELETE", path: "/tables/:table_id/columns/:column" },
    handler: async (ctx, i) => {
      const { acc, col } = await loadColumnForWrite(ctx, i.table_id, i.column, "alive", "xoá");
      return deleteColumn(ctx, acc, col);
    },
  }),

  defineCommand({
    name: "datahub.column.restore",
    summary: "Khôi phục cột từ thùng rác. Tên đã bị dùng thì gửi `name` mới.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ table_id: Id, column: ColumnRef, name: DhNameSchema.optional() }),
    output: ColumnOut,
    http: { method: "POST", path: "/tables/:table_id/columns/:column/restore" },
    handler: async (ctx, i) => {
      const { acc, col } = await loadColumnForWrite(ctx, i.table_id, i.column, "trashed", "khôi phục");
      return restoreColumn(ctx, acc, col, i.name);
    },
  }),

  defineCommand({
    name: "datahub.column.type_preview",
    summary: "Xem trước đổi kiểu cột: bao nhiêu giá trị chuyển được, bao nhiêu không. Không ghi gì.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    audit: "none",
    input: z.object({ table_id: Id, column: ColumnRef, type: z.enum(COLUMN_TYPES), config: z.record(z.string(), z.unknown()).optional() }),
    output: ReportOut.extend({ new_config: z.record(z.string(), z.unknown()) }),
    http: { method: "POST", path: "/tables/:table_id/columns/:column/type-preview" },
    handler: async (ctx, i) => {
      const { acc, schema, col } = await loadColumnForTypeChange(ctx, i.table_id, i.column);
      assertNotKeyColumn(acc, col, "đổi kiểu");
      checkTypeChange(col, i.type);
      const cfg = await targetConfig(ctx.db, acc, col, i.type, i.config);
      const report = await convertColumn(ctx, acc, schema, col, i.type, cfg, false);
      return { ...report, new_config: cfg };
    },
  }),

  defineCommand({
    name: "datahub.column.type_change",
    summary: "Đổi kiểu cột. Giá trị không chuyển được bị xoá khỏi ô nhưng giá trị cũ nằm trong lịch sử dòng.",
    description: "Có giá trị không chuyển được thì phải gửi `accept_data_loss: true` (xem trước bằng `type_preview`). Mọi dòng bị đổi đều có bản lịch sử cũ → mới.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ table_id: Id, column: ColumnRef, type: z.enum(COLUMN_TYPES), config: z.record(z.string(), z.unknown()).optional(), accept_data_loss: z.boolean().default(false) }),
    output: z.object({ column: ColumnOut, report: ReportOut }),
    http: { method: "POST", path: "/tables/:table_id/columns/:column/type" },
    handler: async (ctx, i) => {
      const { acc, schema, col } = await loadColumnForTypeChange(ctx, i.table_id, i.column);
      return changeColumnType(ctx, acc, schema, col, i);
    },
  }),
];
