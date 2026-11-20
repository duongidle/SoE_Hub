import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, DhNameSchema } from "@soe/shared";
import { newId, type Executor } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import { LEVEL_SQL, loadDatahubAccess, loadReader, loadTableAccess } from "./access";
import { getLimits, quotaExceeded } from "./limits";
import { rethrowNameConflict } from "./errors";
import { emitStructure, Id, STRUCTURE_EVENT, Ts } from "./shared";
import { columnFromDb } from "./table-schema";
import { isComputedType } from "./cell-values";
import { displayConfig, OwnerIndex } from "./computed";
import { columnTypeDef } from "./column-types";
import { assertColumnKey } from "./types";

const LevelOut = z.enum(["owner", "edit_data", "view"]);

const TableBrief = z.object({
  id: Id,
  name: z.string(),
  position: z.number().int(),
  row_count: z.number().int(),
  access: LevelOut,
  /** `merged` = merged table (read-only, filled by the worker). */
  kind: z.enum(["normal", "merged"]),
  members_bulk_create: z.boolean().describe("Thành viên không phải chủ có được nhập file / dán sinh dòng mới ở bảng này không."),
});

export const DatahubOut = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  owner_id: Id,
  owner_name: z.string().nullable(),
  /** Your level on this datahub. For a person who got only some tables it is the best level among them. */
  access: LevelOut,
  version: z.number().int(),
  created_at: Ts,
  updated_at: Ts,
  tables: z.array(TableBrief),
});

type Raw = Record<string, unknown>;

async function tablesOf(db: Executor, userId: string, datahubIds: string[]): Promise<Map<string, z.infer<typeof TableBrief>[]>> {
  const out = new Map<string, z.infer<typeof TableBrief>[]>();
  if (datahubIds.length === 0) return out;
  const res = await db.execute(sql`SELECT * FROM (
      SELECT t.id, t.datahub_id, t.name, t.position, t.row_count, t.kind, t.key_split, t.key_columns, t.members_bulk_create, ${LEVEL_SQL(userId)} AS level, t.created_at
      FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id
      WHERE /*scope*/ t.datahub_id = ANY(${`{${datahubIds.join(",")}}`}::uuid[]) AND t.deleted_at IS NULL AND d.deleted_at IS NULL
    ) x WHERE level IS NOT NULL ORDER BY position, created_at`);
  let reader: Awaited<ReturnType<typeof loadReader>> | null = null;
  for (const r of res.rows as Raw[]) {
    const list = out.get(r.datahub_id as string) ?? [];
    let rowCount = r.row_count as number;
    // A table under the split lock tells a member only how many rows THEY see.
    if (r.key_split && r.level !== "owner") {
      const rd = (reader ??= await loadReader(db, userId));
      const keys = (r.key_columns as string[]) ?? [];
      const cond = keys.length ? sql.join(keys.map((k) => sql`((data->>${sql.raw(`'${assertColumnKey(k)}'`)})::uuid = ANY(${`{${rd.ids.join(",")}}`}::uuid[]))`), sql` OR `) : sql`false`;
      rowCount = ((await db.execute(sql`SELECT count(*)::int AS n FROM dh_rows WHERE /*scope*/ table_id = ${r.id as string}::uuid AND deleted_at IS NULL AND (${cond})`)).rows[0] as { n: number }).n;
    }
    list.push({ id: r.id as string, name: r.name as string, position: r.position as number, row_count: rowCount, access: r.level as "owner" | "edit_data" | "view", kind: r.kind === "merged" ? "merged" : "normal", members_bulk_create: r.members_bulk_create !== false });
    out.set(r.datahub_id as string, list);
  }
  return out;
}

function datahubOut(r: Raw, tables: z.infer<typeof TableBrief>[], me: string): z.infer<typeof DatahubOut> {
  const rank = { view: 1, edit_data: 2, owner: 3 } as const;
  const access = r.owner_id === me ? "owner" : tables.reduce<"view" | "edit_data">((best, t) => (rank[t.access as "view" | "edit_data"] > rank[best] ? (t.access as "view" | "edit_data") : best), "view");
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    owner_id: r.owner_id as string,
    owner_name: (r.owner_name as string | null) ?? null,
    access,
    version: r.version as number,
    created_at: r.created_at as Date,
    updated_at: r.updated_at as Date,
    tables,
  };
}

const TableOut = z.object({
  id: Id,
  datahub_id: Id,
  name: z.string(),
  description: z.string().nullable(),
  position: z.number().int(),
  row_count: z.number().int(),
  access: LevelOut,
  version: z.number().int(),
  sql_view: z.string().nullable(),
  kind: z.enum(["normal", "merged"]),
  /** Split lock (design module2 section 10). `key_columns` keeps its list while the lock is off. Row count is what YOU see when the lock is on and you are not the owner. */
  key_split: z.object({ enabled: z.boolean(), key_columns: z.array(z.object({ key: z.string(), name: z.string() })), primary: z.string().nullable() }),
  members_bulk_create: z.boolean().describe("Thành viên không phải chủ có được thêm nhiều dòng một lúc (nhập file, dán, API hàng loạt) không."),
  protected: z.boolean().describe("Bảng template: không đổi tên, không xoá từ lệnh bảng thường; chỉ thêm được cột riêng."),
  template_id: Id.nullable(),
  role_set: z.string().nullable().describe("Bộ vai trò cột của bảng (Module 4 mục 3.7), null = không dùng vai trò."),
});

export const ColumnOut = z.object({
  id: Id,
  key: z.string(),
  name: z.string(),
  type: z.string(),
  config: z.record(z.string(), z.unknown()),
  position: z.number().int(),
  required: z.boolean(),
  allow_edit: z.boolean().describe("Thành viên có quyền Sửa có được sửa ô của cột này không."),
  /** Template layer (module4 3.1): null = a column of an ordinary table. `custom` = yours alone: nobody else sees it. */
  layer: z.enum(["basic", "role", "team", "custom"]).nullable(),
  layer_ref: Id.nullable().describe("Lớp `team`: Leader của team thấy cột. Lớp `custom`: người tạo cột."),
  layer_roles: z.array(z.string()).nullable().describe("Lớp `role`: các vai trò thấy cột."),
  storage: z.enum(["shared", "person"]).describe("`shared`: một giá trị mỗi dòng. `person`: mỗi người một giá trị."),
  role: z.string().nullable().describe("Vai trò cột (Module 4 mục 3.7) nếu cột đang giữ vai trò."),
  protected: z.boolean().describe("Cột của bảng template: không đổi tên, xoá, đổi kiểu từ lệnh cột thường."),
  unique: z.boolean(),
  default_value: z.unknown(),
  description: z.string().nullable(),
  display: z.record(z.string(), z.unknown()),
  version: z.number().int(),
  /** Recalculation state of a formula, lookup or rollup column (null for other columns). `pending` / `running` cells show the "calculating" icon. */
  calc: z.object({ status: z.enum(["ready", "pending", "running"]), done: z.number().int().nullable(), total: z.number().int().nullable(), at: Ts.nullable(), seq: z.number().int().describe("Số thứ tự thay đổi cột đã tính tới.") }).nullable(),
});

/**
 * Column in API shape. A formula is shown with the CURRENT names (`ix` = the owner's tables); the stored form uses keys, so
 * renaming a column or table never breaks a formula.
 */
export function columnOut(c: ReturnType<typeof columnFromDb>, ix: OwnerIndex | null = null): z.infer<typeof ColumnOut> {
  const def = columnTypeDef(c.type);
  let config = { ...c.config };
  delete config.__source;
  delete config.__merged;
  // The auto-number counter is internal.
  if (def.type === "auto_number") delete config.seq;
  if (isComputedType(c.type) || c.type === "relation") config = displayConfig({ type: c.type, config, tableId: c.tableId }, ix);
  const calc = isComputedType(c.type) ? { status: c.calcStatus as "ready" | "pending" | "running", done: c.calcDone, total: c.calcTotal, at: c.calcAt, seq: c.calcSeq } : null;
  return { id: c.id, key: c.key, name: c.name, type: c.type, config, position: c.position, required: c.required, allow_edit: c.allowEdit, layer: c.layer, layer_ref: c.layerRef, layer_roles: c.layerRoles, storage: c.storage, role: c.role, protected: c.protected, unique: c.isUnique, default_value: c.defaultValue, description: c.description, display: c.display, version: c.version, calc };
}

/** Index of the owner's tables, loaded only when a column needs names of other objects. */
export async function indexFor(db: Executor, ownerId: string, cols: { type: string }[]): Promise<OwnerIndex | null> {
  return cols.some((c) => isComputedType(c.type) || c.type === "relation") ? OwnerIndex.load(db, ownerId) : null;
}

/** Datahub "Quản lý Deal" (and its protected tables) is not renamed or deleted from the ordinary commands (design module4 1.3). */
function protectedDatahub(what: string): AppError {
  return new AppError("forbidden", `Datahub "Quản lý Deal" là datahub của hệ thống, không ${what} được.`, { reason: "template_protected" });
}

function protectedTable(name: string, what: string): AppError {
  return new AppError("forbidden", `Bảng "${name}" là bảng template, không ${what} ở đây. Chỉ người sửa template làm được, ở trang Template.`, { reason: "template_protected" });
}

export const structureOperations = [
  // ============================================================================ datahub
  defineCommand({
    name: "datahub.datahub.create",
    summary: "Tạo datahub (mỗi người tối đa 5 mặc định). Tên không trùng trong các datahub của bạn.",
    permission: "datahub:datahub:create",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ name: DhNameSchema, description: z.string().trim().max(1000).optional() }),
    output: DatahubOut,
    http: { method: "POST", path: "/datahubs", status: 201 },
    handler: async (ctx, i) => {
      const me = ctx.actor.userId;
      const limits = await getLimits(ctx.db, me);
      const cnt = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_datahubs WHERE /*scope*/ owner_id = ${me}::uuid AND deleted_at IS NULL AND system_key IS NULL`);
      if ((cnt.rows[0] as { n: number }).n >= limits.datahubs) quotaExceeded("datahub", limits.datahubs);
      const id = newId();
      try {
        await ctx.db.execute(sql`INSERT INTO dh_datahubs (id, owner_id, name, description, created_by, updated_by) VALUES (${id}::uuid, ${me}::uuid, ${i.name}, ${i.description ?? null}, ${me}::uuid, ${me}::uuid)`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      ctx.audit({ type: "datahub", id, details: { name: i.name } });
      await emitStructure(ctx, id, null, "datahub_created");
      const res = await ctx.db.execute(sql`SELECT d.*, u.full_name AS owner_name FROM dh_datahubs d JOIN users u ON u.id = d.owner_id WHERE /*scope*/ d.id = ${id}::uuid`);
      return datahubOut(res.rows[0] as Raw, [], me);
    },
  }),

  defineQuery({
    name: "datahub.datahub.list",
    summary: "Danh sách datahub: của tôi, được chia sẻ với tôi.",
    description: "`scope=mine` (mặc định), `shared` hoặc `all`. Datahub được chia sẻ từng bảng chỉ hiện các bảng được chia sẻ.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ scope: z.enum(["mine", "shared", "all"]).default("mine") }),
    output: z.array(DatahubOut),
    http: { method: "GET", path: "/datahubs" },
    handler: async (ctx, i) => {
      const me = ctx.actor.userId;
      const parts = [];
      if (i.scope !== "shared") parts.push(sql`SELECT d.*, u.full_name AS owner_name FROM dh_datahubs d JOIN users u ON u.id = d.owner_id WHERE /*scope*/ d.owner_id = ${me}::uuid AND d.deleted_at IS NULL`);
      if (i.scope !== "mine") {
        parts.push(sql`SELECT d.*, u.full_name AS owner_name FROM dh_datahubs d JOIN users u ON u.id = d.owner_id
          WHERE /*scope*/ d.owner_id <> ${me}::uuid AND d.deleted_at IS NULL AND EXISTS (SELECT 1 FROM dh_shares s WHERE s.datahub_id = d.id AND s.grantee_id = ${me}::uuid)`);
      }
      const res = await ctx.db.execute(sql`${sql.join(parts.map((p) => sql`(${p})`), sql` UNION ALL `)} ORDER BY created_at`);
      const rows = res.rows as Raw[];
      const tables = await tablesOf(ctx.db, me, rows.map((r) => r.id as string));
      return rows.map((r) => datahubOut(r, tables.get(r.id as string) ?? [], me));
    },
  }),

  defineQuery({
    name: "datahub.datahub.get",
    summary: "Chi tiết một datahub và các bảng bạn thấy.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ datahub_id: Id }),
    output: DatahubOut,
    http: { method: "GET", path: "/datahubs/:datahub_id" },
    handler: async (ctx, i) => {
      const acc = await loadDatahubAccess(ctx, i.datahub_id);
      const res = await ctx.db.execute(sql`SELECT d.*, u.full_name AS owner_name FROM dh_datahubs d JOIN users u ON u.id = d.owner_id WHERE /*scope*/ d.id = ${acc.id}::uuid`);
      const tables = await tablesOf(ctx.db, ctx.actor.userId, [acc.id]);
      return datahubOut(res.rows[0] as Raw, tables.get(acc.id) ?? [], ctx.actor.userId);
    },
  }),

  defineCommand({
    name: "datahub.datahub.update",
    summary: "Đổi tên hoặc mô tả datahub (chỉ chủ).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ datahub_id: Id, name: DhNameSchema.optional(), description: z.string().trim().max(1000).nullable().optional(), version: z.number().int().min(1).optional() }),
    output: DatahubOut,
    http: { method: "PATCH", path: "/datahubs/:datahub_id" },
    handler: async (ctx, i) => {
      const acc = await loadDatahubAccess(ctx, i.datahub_id, "owner");
      if (acc.systemKey && i.name !== undefined && i.name !== acc.name) throw protectedDatahub("đổi tên");
      if (i.version !== undefined && i.version !== acc.version) throw new AppError("conflict", undefined, { current_version: acc.version, sent_version: i.version });
      try {
        await ctx.db.execute(sql`UPDATE dh_datahubs SET name = coalesce(${i.name ?? null}, name), description = ${i.description === undefined ? sql`description` : sql`${i.description}`},
          version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE /*scope*/ id = ${acc.id}::uuid AND version = ${acc.version}`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      ctx.audit({ type: "datahub", id: acc.id, details: { name: i.name, description_changed: i.description !== undefined } });
      await emitStructure(ctx, acc.id, null, "datahub_updated");
      const res = await ctx.db.execute(sql`SELECT d.*, u.full_name AS owner_name FROM dh_datahubs d JOIN users u ON u.id = d.owner_id WHERE /*scope*/ d.id = ${acc.id}::uuid`);
      const tables = await tablesOf(ctx.db, ctx.actor.userId, [acc.id]);
      return datahubOut(res.rows[0] as Raw, tables.get(acc.id) ?? [], ctx.actor.userId);
    },
  }),

  defineCommand({
    name: "datahub.datahub.delete",
    summary: "Xoá datahub vào thùng rác (cả datahub, khôi phục nguyên vẹn trong 7 ngày).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ datahub_id: Id }),
    output: z.object({ id: Id, deleted: z.literal(true) }),
    http: { method: "DELETE", path: "/datahubs/:datahub_id" },
    handler: async (ctx, i) => {
      const acc = await loadDatahubAccess(ctx, i.datahub_id, "owner");
      if (acc.systemKey) throw protectedDatahub("xoá");
      await ctx.db.execute(sql`UPDATE dh_datahubs SET deleted_at = now(), deleted_by = ${ctx.actor.userId}::uuid, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE /*scope*/ id = ${acc.id}::uuid`);
      ctx.audit({ type: "datahub", id: acc.id, details: { name: acc.name } });
      await emitStructure(ctx, acc.id, null, "datahub_deleted");
      return { id: acc.id, deleted: true as const };
    },
  }),

  defineCommand({
    name: "datahub.datahub.restore",
    summary: "Khôi phục datahub từ thùng rác. Tên đã bị dùng thì gửi `name` mới.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ datahub_id: Id, name: DhNameSchema.optional() }),
    output: z.object({ id: Id, restored: z.literal(true) }),
    http: { method: "POST", path: "/datahubs/:datahub_id/restore" },
    handler: async (ctx, i) => {
      const acc = await loadDatahubAccess(ctx, i.datahub_id, "owner", { state: "trashed" });
      const limits = await getLimits(ctx.db, ctx.actor.userId);
      const cnt = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_datahubs WHERE /*scope*/ owner_id = ${ctx.actor.userId}::uuid AND deleted_at IS NULL`);
      if ((cnt.rows[0] as { n: number }).n >= limits.datahubs) quotaExceeded("datahub", limits.datahubs);
      try {
        await ctx.db.execute(sql`UPDATE dh_datahubs SET deleted_at = NULL, deleted_by = NULL, name = coalesce(${i.name ?? null}, name), version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE /*scope*/ id = ${acc.id}::uuid`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      ctx.audit({ type: "datahub", id: acc.id, details: { name: i.name ?? acc.name } });
      await emitStructure(ctx, acc.id, null, "datahub_restored");
      return { id: acc.id, restored: true as const };
    },
  }),

  // ============================================================================ table
  defineCommand({
    name: "datahub.table.create",
    summary: "Tạo bảng trong datahub (tối đa 10 mặc định). Tên không trùng trong datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ datahub_id: Id, name: DhNameSchema, description: z.string().trim().max(1000).optional() }),
    output: TableOut,
    http: { method: "POST", path: "/datahubs/:datahub_id/tables", status: 201 },
    handler: async (ctx, i) => {
      const dh = await loadDatahubAccess(ctx, i.datahub_id, "owner");
      const limits = await getLimits(ctx.db, ctx.actor.userId);
      const cnt = await ctx.db.execute(sql`SELECT count(*) FILTER (WHERE template_id IS NULL)::int AS n, coalesce(max(position), -1) + 1 AS next FROM dh_tables WHERE /*scope*/ datahub_id = ${dh.id}::uuid AND deleted_at IS NULL`);
      const { n, next } = cnt.rows[0] as { n: number; next: number };
      if (n >= limits.tables) quotaExceeded("bảng trong một datahub", limits.tables);
      // In the datahub "Quản lý Deal" a template table of the same name (yours or shared with you) already holds the name (module4 3.5).
      if (dh.systemKey) {
        const clash = await ctx.db.execute(sql`SELECT 1 FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id
          WHERE /*scope*/ t.template_id IS NOT NULL AND t.deleted_at IS NULL AND t.name_norm = lower(btrim(${i.name})) AND (t.datahub_id = ${dh.id}::uuid OR EXISTS (SELECT 1 FROM dh_shares s WHERE s.grantee_id = ${ctx.actor.userId}::uuid AND s.datahub_id = t.datahub_id AND (s.table_id IS NULL OR s.table_id = t.id)))`);
        if (clash.rows.length) throw new AppError("conflict", "Đã có một bảng template tên này. Hãy đặt tên khác.", { reason: "duplicate_name" });
      }
      const id = newId();
      try {
        await ctx.db.execute(sql`INSERT INTO dh_tables (id, datahub_id, name, description, position, created_by, updated_by) VALUES (${id}::uuid, ${dh.id}::uuid, ${i.name}, ${i.description ?? null}, ${next}::int, ${ctx.actor.userId}::uuid, ${ctx.actor.userId}::uuid)`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      // Every table starts with one shared grid view, so there is always something to open.
      await ctx.db.execute(sql`INSERT INTO dh_views (id, table_id, owner_id, name, kind, position, config, created_by, updated_by) VALUES (${newId()}::uuid, ${id}::uuid, NULL, 'Dạng bảng', 'grid', 0, '{}'::jsonb, ${ctx.actor.userId}::uuid, ${ctx.actor.userId}::uuid)`);
      ctx.audit({ type: "datahub_table", id, details: { datahub_id: dh.id, name: i.name } });
      await emitStructure(ctx, dh.id, id, "table_created");
      const acc = await loadTableAccess(ctx, id);
      return tableOut(ctx.db, acc);
    },
  }),

  defineQuery({
    name: "datahub.table.get",
    summary: "Chi tiết một bảng, kèm danh sách cột.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ table_id: Id }),
    output: TableOut.extend({ datahub_name: z.string(), owner_id: Id, columns: z.array(ColumnOut), max_columns: z.number().int() }),
    http: { method: "GET", path: "/tables/:table_id" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id);
      const cols = await ctx.db.execute(sql`SELECT * FROM dh_columns WHERE ${acc.scope()} AND deleted_at IS NULL ORDER BY position, created_at, id`);
      const limits = await getLimits(ctx.db, acc.datahub.ownerId);
      return { ...(await tableOut(ctx.db, acc)), datahub_name: acc.datahub.name, owner_id: acc.datahub.ownerId, columns: await (async () => {
        const list = (cols.rows as Raw[]).map(columnFromDb).filter((c) => acc.canSeeColumn(c));
        // Only the owner sees names of other tables inside formulas; people the table is shared with see values only.
        const ix = acc.level === "owner" ? await indexFor(ctx.db, acc.datahub.ownerId, list) : null;
        return list.map((c) => columnOut(c, ix));
      })(), max_columns: limits.columns };
    },
  }),

  defineCommand({
    name: "datahub.table.update",
    summary: "Đổi tên, mô tả hoặc vị trí bảng (chỉ chủ).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ table_id: Id, name: DhNameSchema.optional(), description: z.string().trim().max(1000).nullable().optional(), position: z.number().int().min(0).max(1000).optional(), version: z.number().int().min(1).optional() }),
    output: TableOut,
    http: { method: "PATCH", path: "/tables/:table_id" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "owner");
      if (acc.table.protected && i.name !== undefined && i.name !== acc.table.name) throw protectedTable(acc.table.name, "đổi tên");
      if (i.version !== undefined && i.version !== acc.table.version) throw new AppError("conflict", undefined, { current_version: acc.table.version, sent_version: i.version });
      try {
        await ctx.db.execute(sql`UPDATE dh_tables SET name = coalesce(${i.name ?? null}, name), description = ${i.description === undefined ? sql`description` : sql`${i.description}`}, position = coalesce(${i.position ?? null}::int, position),
          version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE /*scope*/ id = ${acc.tableId}::uuid`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      ctx.audit({ type: "datahub_table", id: acc.tableId, details: { name: i.name, position: i.position } });
      await emitStructure(ctx, acc.datahub.id, acc.tableId, "table_updated");
      return tableOut(ctx.db, await loadTableAccess(ctx, acc.tableId));
    },
  }),

  defineCommand({
    name: "datahub.table.delete",
    summary: "Xoá bảng vào thùng rác (cả bảng với cột và dòng, khôi phục nguyên vẹn trong 7 ngày).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ table_id: Id }),
    output: z.object({ id: Id, deleted: z.literal(true) }),
    http: { method: "DELETE", path: "/tables/:table_id" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "owner");
      if (acc.table.protected) throw protectedTable(acc.table.name, "xoá");
      await ctx.db.execute(sql`UPDATE dh_tables SET deleted_at = now(), deleted_by = ${ctx.actor.userId}::uuid, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE /*scope*/ id = ${acc.tableId}::uuid`);
      ctx.audit({ type: "datahub_table", id: acc.tableId, details: { name: acc.table.name } });
      await emitStructure(ctx, acc.datahub.id, acc.tableId, "table_deleted");
      return { id: acc.tableId, deleted: true as const };
    },
  }),

  defineCommand({
    name: "datahub.table.restore",
    summary: "Khôi phục bảng từ thùng rác (datahub phải còn). Tên đã bị dùng thì gửi `name` mới.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ table_id: Id, name: DhNameSchema.optional() }),
    output: TableOut,
    http: { method: "POST", path: "/tables/:table_id/restore" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "owner", { state: "trashed" });
      if (acc.table.protected) throw protectedTable(acc.table.name, "khôi phục");
      const limits = await getLimits(ctx.db, ctx.actor.userId);
      const cnt = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_tables WHERE /*scope*/ datahub_id = ${acc.datahub.id}::uuid AND deleted_at IS NULL AND template_id IS NULL`);
      if ((cnt.rows[0] as { n: number }).n >= limits.tables) quotaExceeded("bảng trong một datahub", limits.tables);
      try {
        await ctx.db.execute(sql`UPDATE dh_tables SET deleted_at = NULL, deleted_by = NULL, name = coalesce(${i.name ?? null}, name), version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE /*scope*/ id = ${acc.tableId}::uuid`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      ctx.audit({ type: "datahub_table", id: acc.tableId, details: { name: i.name ?? acc.table.name } });
      await emitStructure(ctx, acc.datahub.id, acc.tableId, "table_restored");
      return tableOut(ctx.db, await loadTableAccess(ctx, acc.tableId));
    },
  }),
];

export async function tableOut(db: Executor, acc: Awaited<ReturnType<typeof loadTableAccess>>): Promise<z.infer<typeof TableOut>> {
  const res = await db.execute(sql`SELECT id, datahub_id, name, description, position, row_count, version, sql_view, kind FROM dh_tables WHERE ${sql`/*scope*/ id = ${acc.tableId}::uuid`}`);
  const r = res.rows[0] as Raw;
  const split = acc.table.split;
  const names = split.keys.length ? await db.execute(sql`SELECT key, name FROM dh_columns WHERE ${acc.scope()} AND deleted_at IS NULL AND key = ANY(${`{${split.keys.join(",")}}`}::text[])`) : { rows: [] };
  const nameOf = new Map((names.rows as { key: string; name: string }[]).map((c) => [c.key, c.name]));
  // Under the split lock the count is the rows THIS reader sees, never the size of the whole table.
  const rowCount = acc.restricted ? ((await db.execute(sql`SELECT count(*)::int AS n FROM dh_rows WHERE ${acc.rows()} AND deleted_at IS NULL`)).rows[0] as { n: number }).n : (r.row_count as number);
  return {
    id: r.id as string,
    datahub_id: r.datahub_id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    position: r.position as number,
    row_count: rowCount,
    access: acc.level,
    version: r.version as number,
    sql_view: (r.sql_view as string | null) ?? null,
    kind: r.kind === "merged" ? "merged" : "normal",
    key_split: { enabled: split.enabled, key_columns: split.keys.map((k) => ({ key: k, name: nameOf.get(k) ?? k })), primary: split.primary },
    members_bulk_create: acc.table.membersBulkCreate,
    protected: acc.table.protected,
    template_id: acc.table.templateId,
    role_set: acc.table.roleSet,
  };
}

export { TableOut };
