import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, DhNameSchema } from "@soe/shared";
import { newId, type Executor } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import { LEVEL_SQL, loadDatahubAccess, loadTableAccess } from "./access";
import { getLimits, quotaExceeded } from "./limits";
import { rethrowNameConflict } from "./errors";
import { emitStructure, Id, STRUCTURE_EVENT, Ts } from "./shared";
import { columnFromDb } from "./table-schema";
import { isComputedType } from "./cell-values";
import { displayConfig, OwnerIndex } from "./computed";
import { columnTypeDef } from "./column-types";

const LevelOut = z.enum(["owner", "edit_data", "view"]);

const TableBrief = z.object({
  id: Id,
  name: z.string(),
  position: z.number().int(),
  row_count: z.number().int(),
  access: LevelOut,
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
      SELECT t.id, t.datahub_id, t.name, t.position, t.row_count, ${LEVEL_SQL(userId)} AS level, t.created_at
      FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id
      WHERE /*scope*/ t.datahub_id = ANY(${`{${datahubIds.join(",")}}`}::uuid[]) AND t.deleted_at IS NULL AND d.deleted_at IS NULL
    ) x WHERE level IS NOT NULL ORDER BY position, created_at`);
  for (const r of res.rows as Raw[]) {
    const list = out.get(r.datahub_id as string) ?? [];
    list.push({ id: r.id as string, name: r.name as string, position: r.position as number, row_count: r.row_count as number, access: r.level as "owner" | "edit_data" | "view" });
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
});

export const ColumnOut = z.object({
  id: Id,
  key: z.string(),
  name: z.string(),
  type: z.string(),
  config: z.record(z.string(), z.unknown()),
  position: z.number().int(),
  required: z.boolean(),
  unique: z.boolean(),
  default_value: z.unknown(),
  description: z.string().nullable(),
  display: z.record(z.string(), z.unknown()),
  version: z.number().int(),
  /** Recalculation state of a formula, lookup or rollup column (null for other columns). `pending` / `running` cells show the "calculating" icon. */
  calc: z.object({ status: z.enum(["ready", "pending", "running"]), done: z.number().int().nullable(), total: z.number().int().nullable(), at: Ts.nullable() }).nullable(),
});

/**
 * Column in API shape. A formula is shown with the CURRENT names (`ix` = the owner's tables); the stored form uses keys, so
 * renaming a column or table never breaks a formula.
 */
export function columnOut(c: ReturnType<typeof columnFromDb>, ix: OwnerIndex | null = null): z.infer<typeof ColumnOut> {
  const def = columnTypeDef(c.type);
  let config = { ...c.config };
  delete config.__source;
  // The auto-number counter is internal.
  if (def.type === "auto_number") delete config.seq;
  if (isComputedType(c.type) || c.type === "relation") config = displayConfig({ type: c.type, config, tableId: c.tableId }, ix);
  const calc = isComputedType(c.type) ? { status: c.calcStatus as "ready" | "pending" | "running", done: c.calcDone, total: c.calcTotal, at: c.calcAt } : null;
  return { id: c.id, key: c.key, name: c.name, type: c.type, config, position: c.position, required: c.required, unique: c.isUnique, default_value: c.defaultValue, description: c.description, display: c.display, version: c.version, calc };
}

/** Index of the owner's tables, loaded only when a column needs names of other objects. */
export async function indexFor(db: Executor, ownerId: string, cols: { type: string }[]): Promise<OwnerIndex | null> {
  return cols.some((c) => isComputedType(c.type) || c.type === "relation") ? OwnerIndex.load(db, ownerId) : null;
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
      const cnt = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_datahubs WHERE /*scope*/ owner_id = ${me}::uuid AND deleted_at IS NULL`);
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
      const cnt = await ctx.db.execute(sql`SELECT count(*)::int AS n, coalesce(max(position), -1) + 1 AS next FROM dh_tables WHERE /*scope*/ datahub_id = ${dh.id}::uuid AND deleted_at IS NULL`);
      const { n, next } = cnt.rows[0] as { n: number; next: number };
      if (n >= limits.tables) quotaExceeded("bảng trong một datahub", limits.tables);
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
        const list = (cols.rows as Raw[]).map(columnFromDb);
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
      const limits = await getLimits(ctx.db, ctx.actor.userId);
      const cnt = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_tables WHERE /*scope*/ datahub_id = ${acc.datahub.id}::uuid AND deleted_at IS NULL`);
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

async function tableOut(db: Executor, acc: Awaited<ReturnType<typeof loadTableAccess>>): Promise<z.infer<typeof TableOut>> {
  const res = await db.execute(sql`SELECT id, datahub_id, name, description, position, row_count, version, sql_view FROM dh_tables WHERE ${sql`/*scope*/ id = ${acc.tableId}::uuid`}`);
  const r = res.rows[0] as Raw;
  return {
    id: r.id as string,
    datahub_id: r.datahub_id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    position: r.position as number,
    row_count: r.row_count as number,
    access: acc.level,
    version: r.version as number,
    sql_view: (r.sql_view as string | null) ?? null,
  };
}

export { TableOut };
