import { sql, type SQL } from "drizzle-orm";
import { AppError } from "@soe/shared";
import type { Executor } from "@soe/db";
import type { HandlerCtx } from "../../core/types";

/**
 * Who may do what with a datahub (design module2 section 10, module1 section 4.2). Datahubs are private to their owner:
 * Leader, Manager and Admin get no extra access. The only other way in is a share from the owner.
 * `owner` > `edit_data` > `view`. Only the owner changes structure.
 */
export type Level = "owner" | "edit_data" | "view";
const RANK: Record<Level, number> = { view: 1, edit_data: 2, owner: 3 };

export const atLeast = (have: Level, need: Level) => RANK[have] >= RANK[need];

type Ctx = Pick<HandlerCtx, "db" | "actor">;

export interface TableInfo {
  id: string;
  datahubId: string;
  name: string;
  nextRowNo: number;
  rowCount: number;
  version: number;
  deleted: boolean;
}

/**
 * Proof that the actor may use one table, at this level. Row and column queries take their table condition from
 * `scope()`, so a row of another table can never be reached with a row id from the request, and the query guard
 * (auth/query-guard.ts) sees the scope marker.
 */
export class TableAccess {
  constructor(
    readonly table: TableInfo,
    readonly datahub: { id: string; ownerId: string; name: string; deleted: boolean },
    readonly level: Level,
    readonly actorId: string,
  ) {}

  get tableId() {
    return this.table.id;
  }

  /** `table_id = <this table>` with the scope marker. Use it in every query on rows, columns, views of this table. */
  scope(alias?: string): SQL {
    const col = alias ? sql.raw(`${alias}.table_id`) : sql.raw("table_id");
    return sql`/*scope*/ ${col} = ${this.table.id}::uuid`;
  }

  require(need: Level): void {
    if (atLeast(this.level, need)) return;
    throw new AppError("forbidden", need === "owner" ? "Chỉ chủ datahub được đổi cấu trúc." : "Bạn chỉ có quyền xem bảng này.");
  }
}

/**
 * The ONE place that says which rows of a table a reader sees, as a string: two readers with the same key see the same rows of that
 * table, so they may share a cached answer; different keys never do. Today: the table and the level (the owner and people it is shared
 * with see every row). When the split lock (module2 section 10) is on, rows depend on the person: Stage 4.1 changes ONLY this function
 * (add the reader and the columns of the lock), and every cache (metrics, later others) follows. Callers never build their own key.
 */
export function scopeKey(a: TableAccess): string {
  return `${a.tableId}:${a.level}`;
}

export interface LoadOptions {
  /** `alive` (default): table and datahub both live. `trashed`: the table itself is in the trash (restore flows). */
  state?: "alive" | "trashed";
}

export const LEVEL_SQL = (u: string) => sql`CASE
  WHEN d.owner_id = ${u}::uuid THEN 'owner'
  WHEN EXISTS (SELECT 1 FROM dh_shares s WHERE s.grantee_id = ${u}::uuid AND s.datahub_id = d.id AND (s.table_id IS NULL OR s.table_id = t.id) AND s.permission = 'edit_data') THEN 'edit_data'
  WHEN EXISTS (SELECT 1 FROM dh_shares s WHERE s.grantee_id = ${u}::uuid AND s.datahub_id = d.id AND (s.table_id IS NULL OR s.table_id = t.id)) THEN 'view'
END`;

/**
 * Loads a table with the actor's level. A table the actor cannot see is `not_found` (its existence is not revealed);
 * one the actor can see but not use at `need` is `forbidden`.
 */
export async function loadTableAccess(ctx: Ctx, tableId: string, need: Level = "view", opts: LoadOptions = {}): Promise<TableAccess> {
  const u = ctx.actor.userId;
  const res = await ctx.db.execute(sql`
    SELECT t.id, t.datahub_id, t.name, t.next_row_no, t.row_count, t.version, t.deleted_at AS t_deleted,
           d.owner_id, d.name AS datahub_name, d.deleted_at AS d_deleted, ${LEVEL_SQL(u)} AS level
    FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id
    WHERE /*scope*/ t.id = ${tableId}::uuid`);
  const r = res.rows[0] as Record<string, unknown> | undefined;
  const state = opts.state ?? "alive";
  const level = r?.level as Level | null | undefined;
  const ok = r && level && (state === "alive" ? !r.t_deleted && !r.d_deleted : !!r.t_deleted && !r.d_deleted);
  if (!r || !level || !ok) throw new AppError("not_found", "Không tìm thấy bảng.");
  const acc = new TableAccess(
    { id: r.id as string, datahubId: r.datahub_id as string, name: r.name as string, nextRowNo: r.next_row_no as number, rowCount: r.row_count as number, version: r.version as number, deleted: !!r.t_deleted },
    { id: r.datahub_id as string, ownerId: r.owner_id as string, name: r.datahub_name as string, deleted: !!r.d_deleted },
    level,
    u,
  );
  acc.require(need);
  return acc;
}

export interface DatahubAccess {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  version: number;
  deleted: boolean;
  level: Level;
  /** For a person who was given only some tables: those table ids. Null = the whole datahub (or the owner). */
  tableIds: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Loads a datahub with the actor's level; `tableIds` is set when the actor sees only the tables shared with them. */
export async function loadDatahubAccess(ctx: Ctx, datahubId: string, need: Level = "view", opts: LoadOptions = {}): Promise<DatahubAccess> {
  const u = ctx.actor.userId;
  const res = await ctx.db.execute(sql`
    SELECT d.id, d.owner_id, d.name, d.description, d.version, d.deleted_at, d.created_at, d.updated_at,
      CASE
        WHEN d.owner_id = ${u}::uuid THEN 'owner'
        WHEN EXISTS (SELECT 1 FROM dh_shares s WHERE s.grantee_id = ${u}::uuid AND s.datahub_id = d.id AND s.table_id IS NULL AND s.permission = 'edit_data') THEN 'edit_data'
        WHEN EXISTS (SELECT 1 FROM dh_shares s WHERE s.grantee_id = ${u}::uuid AND s.datahub_id = d.id AND s.table_id IS NULL) THEN 'view'
        WHEN EXISTS (SELECT 1 FROM dh_shares s WHERE s.grantee_id = ${u}::uuid AND s.datahub_id = d.id) THEN 'view'
      END AS level,
      (SELECT coalesce(array_agg(s.table_id), '{}') FROM dh_shares s WHERE s.grantee_id = ${u}::uuid AND s.datahub_id = d.id AND s.table_id IS NOT NULL) AS shared_tables,
      EXISTS (SELECT 1 FROM dh_shares s WHERE s.grantee_id = ${u}::uuid AND s.datahub_id = d.id AND s.table_id IS NULL) AS whole
    FROM dh_datahubs d
    WHERE /*scope*/ d.id = ${datahubId}::uuid`);
  const r = res.rows[0] as Record<string, unknown> | undefined;
  const state = opts.state ?? "alive";
  const level = r?.level as Level | null | undefined;
  const ok = r && level && (state === "alive" ? !r.deleted_at : !!r.deleted_at);
  if (!r || !level || !ok) throw new AppError("not_found", "Không tìm thấy datahub.");
  const isOwner = r.owner_id === u;
  const acc: DatahubAccess = {
    id: r.id as string,
    ownerId: r.owner_id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    version: r.version as number,
    deleted: !!r.deleted_at,
    level,
    tableIds: isOwner || r.whole ? null : (r.shared_tables as string[]),
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
  if (!atLeast(acc.level, need)) throw new AppError("forbidden", need === "owner" ? "Chỉ chủ datahub được làm việc này." : "Bạn chỉ có quyền xem datahub này.");
  return acc;
}

/** Every user who can see a table (owner + shares), for SSE audiences. System scope: runs in the worker. */
export async function tableAudience(db: Executor, tableId: string): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT d.owner_id AS id FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ t.id = ${tableId}::uuid
    UNION
    SELECT s.grantee_id FROM dh_tables t JOIN dh_shares s ON s.datahub_id = t.datahub_id AND (s.table_id IS NULL OR s.table_id = t.id) WHERE /*scope:system*/ t.id = ${tableId}::uuid`);
  return (res.rows as { id: string }[]).map((r) => r.id);
}

/** Every user who can see something in a datahub (owner + any share). */
export async function datahubAudience(db: Executor, datahubId: string): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT owner_id AS id FROM dh_datahubs WHERE /*scope:system*/ id = ${datahubId}::uuid
    UNION
    SELECT grantee_id FROM dh_shares WHERE /*scope:system*/ datahub_id = ${datahubId}::uuid`);
  return (res.rows as { id: string }[]).map((r) => r.id);
}
