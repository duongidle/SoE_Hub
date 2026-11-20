import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { AppError } from "@soe/shared";
import type { Executor } from "@soe/db";
import type { HandlerCtx } from "../../core/types";
import { assertColumnKey, type DhColumn } from "./types";
import { overlayRel } from "./reader-scope";
import { userIdsOf } from "./user-values";

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
  /** `merged` = a merged table (design module3 section 4): read-only for everyone, its rows come from the worker. */
  kind: "normal" | "merged";
  /** Split lock (design module2 section 10). `enabled` off keeps `keys` so the lock can be turned on again. */
  split: { enabled: boolean; keys: string[]; primary: string | null };
  /** May members who are not the owner create more than one row at a time (import, paste, batch)? */
  membersBulkCreate: boolean;
  /** Template table (design module4 3.5, Stage 4.1c): protected from the table commands. `templateId` set = a template table (shared, or one person's copy). */
  protected: boolean;
  templateId: string | null;
  roleSet: string | null;
}

/** What decides which template columns a person sees: their roles and their Leader (design module4 3.1). Loaded only for template tables. */
export interface Viewer {
  roles: string[];
  leaderId: string | null;
}

/**
 * Who a non-owner member of a split-lock table is, for row decisions: `ids` = the rows they see are those that hold one of these ids in a key
 * column (themselves and every person they manage in the CURRENT organization tree). `manager` / `leader` = the managed people whose rows they
 * may also EDIT: all of a Manager's tree, and the people whose Leader they are AND who switched on "Cho phép leader sửa" (module1 section 4.1).
 */
export interface ReaderScope {
  self: string;
  ids: string[];
  editIds: Set<string>;
}

/** Condition "a key column of this row holds one of `ids`", one comparison per key column (design module2 section 10: OR over the key columns). */
export function keyMatch(keys: string[], ids: string[], alias?: string): SQL {
  if (keys.length === 0 || ids.length === 0) return sql`false`;
  const arr = `{${ids.join(",")}}`;
  const data = alias ? `${alias}.data` : "data";
  // `soe_dh_ids` reads the people of a cell of either shape (one uuid, or a list with attributes); the partial GIN index of the column (kind `ids`) serves `&&`.
  return sql`(${sql.join(keys.map((k) => sql`(soe_dh_ids(${sql.raw(data)}->${sql.raw(`'${assertColumnKey(k)}'`)}) && ${arr}::text[])`), sql` OR `)})`;
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
    /** Set only for a non-owner reader of a table whose split lock is on. Null = this reader sees every row. */
    readonly reader: ReaderScope | null = null,
    /** Keys of the reader-scoped computed columns of this table (design module2 section 10). Non-empty: a reader who is not the owner reads their own values of them. */
    readonly scopedKeys: string[] = [],
    /** The table has columns with one value per person (`storage = 'person'`): every read lays the reader's own values over `data`, the owner's too. */
    readonly hasPersonCells: boolean = false,
    /** Set for a template table. Null = every column of the table is seen by everyone who sees the table. */
    readonly viewer: Viewer | null = null,
  ) {}

  /**
   * Does this person see this column? An ordinary table: every column. A template table (module4 3.1): `basic` everyone; `role` those who hold one of
   * the roles; `team` the Leader and the members of that team (and the table's owner); `custom` ONLY the person who made it, the owner included.
   */
  canSeeColumn(c: Pick<DhColumn, "layer" | "layerRef" | "layerRoles">): boolean {
    if (c.layer === null || c.layer === "basic") return true;
    if (c.layer === "custom") return c.layerRef === this.actorId;
    if (c.layer === "role") return this.level === "owner" || (c.layerRoles ?? []).some((r) => this.viewer?.roles.includes(r));
    return this.level === "owner" || c.layerRef === this.actorId || (!!c.layerRef && this.viewer?.leaderId === c.layerRef);
  }

  /**
   * What to put after `FROM` for every read of this table's rows made for a person (use `FROM ${access.rel()} <alias>`). For the owner, and for a table
   * without reader-scoped columns, it is `dh_rows`. Otherwise it is `dh_rows` with the reader's own values of the reader-scoped columns laid over
   * `data` (the owner's values are removed, so nobody sees a total computed over rows they may not see); under the split lock it also keeps only
   * the reader's rows, inside the subquery, so key indexes still apply.
   */
  rel(): SQL {
    if (!this.hasPersonCells && (this.level === "owner" || this.scopedKeys.length === 0)) return sql`dh_rows`;
    return overlayRel(this.table.id, this.actorId, this.scopedKeys, this.reader ? keyMatch(this.table.split.keys, this.reader.ids, "r") : null, this.hasPersonCells);
  }

  /** The table is split-locked for this reader: their rows depend on who they are. */
  get restricted(): boolean {
    return this.reader !== null;
  }

  /**
   * `scope()` plus, for a reader under the split lock, "a key column holds me or someone I manage". THE condition for every query on
   * `dh_rows` made for a person (list, one row, groups, totals, export, duplicates, trash, labels, attachments, metrics, the merged table's source).
   * Writes use it too, so a row that is not theirs cannot be reached with its id. `scope()` alone stays for columns, views and other table data.
   */
  rows(alias?: string): SQL {
    const base = this.scope(alias, "rows");
    if (!this.reader) return base;
    return sql`${base} AND ${keyMatch(this.table.split.keys, this.reader.ids, alias)}`;
  }

  /** In JS: does this reader see a row with these cells? (Same rule as `rows()`.) */
  seesRow(data: Record<string, unknown>): boolean {
    if (!this.reader) return true;
    const ids = this.table.split.keys.flatMap((k) => userIdsOf(data[k]));
    return ids.some((id) => this.reader!.ids.includes(id));
  }

  /**
   * May this reader edit a row they see? The owner and a table without the split lock: yes (the Edit permission was checked by `require`).
   * Under the split lock: a row that names the reader, or a person the reader may edit for (a Manager for their whole tree, a Leader
   * for the people who allowed it).
   */
  canEditRow(data: Record<string, unknown>): boolean {
    if (!this.reader) return true;
    const ids = this.table.split.keys.flatMap((k) => userIdsOf(data[k]));
    return ids.some((id) => id === this.reader!.self || this.reader!.editIds.has(id));
  }

  /** More than one new row in one go is the owner's, or a member's when the owner allowed it (module2 section 10). */
  bulkCreateAllowed(): boolean {
    return this.level === "owner" || this.table.membersBulkCreate;
  }

  get tableId() {
    return this.table.id;
  }

  /** `table_id = <this table>` with the scope marker. Use it in every query on rows, columns, views of this table. */
  scope(alias?: string, marker: "rows" | "table" = "table"): SQL {
    const col = alias ? sql.raw(`${alias}.table_id`) : sql.raw("table_id");
    return marker === "rows" ? sql`/*scope:rows*/ ${col} = ${this.table.id}::uuid` : sql`/*scope*/ ${col} = ${this.table.id}::uuid`;
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
  // A member's own values of the reader-scoped columns (design module2 section 10), or anyone's values of the person-stored columns (module4 3.4),
  // make the answer personal, even without the split lock.
  const personal = a.hasPersonCells || (a.scopedKeys.length > 0 && a.level !== "owner");
  if (personal && !a.reader) return `${a.tableId}:${a.level}:u:${a.actorId}`;
  if (!a.reader) return `${a.tableId}:${a.level}`;
  // Under the split lock the rows depend on the reader: the key is the key columns and the ids the reader sees, so two readers who see the same
  // rows share an answer, and a change in the tree (other people to manage) changes the key by itself.
  const h = createHash("sha256").update(JSON.stringify([a.table.split.keys, [...a.reader.ids].sort(), personal ? a.actorId : null])).digest("hex").slice(0, 24);
  return `${a.tableId}:${a.level}:s:${h}`;
}

/**
 * The ONE place that says which LIVE rows of a table this reader may copy out of it (used by the merged table, design module3 section 4.1):
 * the rows of `access.scope()` that are not in the trash. When the split lock arrives (Stage 4.1) `scope()` (and `scopeKey` above) change
 * to add the reader's rows; this helper follows, so the merged table never copies a row its owner does not see.
 */
export function readableRows(a: TableAccess, alias?: string): SQL {
  const del = alias ? sql.raw(`${alias}.deleted_at`) : sql.raw("deleted_at");
  return sql`${a.rows(alias)} AND ${del} IS NULL`;
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
    SELECT t.id, t.datahub_id, t.name, t.next_row_no, t.row_count, t.version, t.deleted_at AS t_deleted, t.kind,
           t.key_split, t.key_columns, t.key_primary, t.members_bulk_create, t.protected, t.template_id, t.role_set,
           (SELECT coalesce(array_agg(c.key), '{}') FROM dh_columns c WHERE /*scope*/ c.table_id = t.id AND c.reader_scoped AND c.deleted_at IS NULL) AS scoped_keys,
           EXISTS (SELECT 1 FROM dh_columns c WHERE /*scope*/ c.table_id = t.id AND c.storage = 'person' AND c.deleted_at IS NULL) AS has_person,
           d.owner_id, d.name AS datahub_name, d.deleted_at AS d_deleted, ${LEVEL_SQL(u)} AS level
    FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id
    WHERE /*scope*/ t.id = ${tableId}::uuid`);
  const r = res.rows[0] as Record<string, unknown> | undefined;
  const state = opts.state ?? "alive";
  // A merged table is read-only for everyone it is shared with (only the owner may configure it; no one writes its rows through the row API).
  const level = (r?.kind === "merged" && r.level === "edit_data" ? "view" : r?.level) as Level | null | undefined;
  const ok = r && level && (state === "alive" ? !r.t_deleted && !r.d_deleted : !!r.t_deleted && !r.d_deleted);
  if (!r || !level || !ok) throw new AppError("not_found", "Không tìm thấy bảng.");
  const split = { enabled: !!r.key_split, keys: (r.key_columns as string[] | null) ?? [], primary: (r.key_primary as string | null) ?? null };
  const reader = split.enabled && level !== "owner" ? await loadReader(ctx.db, u) : null;
  const viewer = r.template_id ? await loadViewer(ctx.db, u) : null;
  const acc = new TableAccess(
    { id: r.id as string, datahubId: r.datahub_id as string, name: r.name as string, nextRowNo: r.next_row_no as number, rowCount: r.row_count as number, version: r.version as number, deleted: !!r.t_deleted, kind: r.kind === "merged" ? "merged" : "normal", split, membersBulkCreate: !!r.members_bulk_create, protected: !!r.protected, templateId: (r.template_id as string | null) ?? null, roleSet: (r.role_set as string | null) ?? null },
    { id: r.datahub_id as string, ownerId: r.owner_id as string, name: r.datahub_name as string, deleted: !!r.d_deleted },
    level,
    u,
    reader,
    level === "owner" ? [] : ((r.scoped_keys as string[] | null) ?? []),
    !!r.has_person,
    viewer,
  );
  acc.require(need);
  return acc;
}

/** Roles and Leader of a person (system read of the org chart): decides which template columns they see. */
export async function loadViewer(db: Executor, userId: string): Promise<Viewer> {
  const res = await db.execute(sql`SELECT u.roles, m.leader_id FROM users u LEFT JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL WHERE u.id = ${userId}::uuid`);
  const r = res.rows[0] as { roles: string[]; leader_id: string | null } | undefined;
  return { roles: r?.roles ?? [], leaderId: r?.leader_id ?? null };
}

export interface DatahubAccess {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  version: number;
  deleted: boolean;
  /** `deal` = the protected datahub "Quản lý Deal" (module4 1.1): no rename, no delete. */
  systemKey: string | null;
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
    SELECT d.id, d.owner_id, d.name, d.description, d.version, d.deleted_at, d.created_at, d.updated_at, d.system_key,
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
    systemKey: (r.system_key as string | null) ?? null,
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

/**
 * The people a person manages in the CURRENT tree (design module1 section 2.3): a Manager manages everyone whose `manager_id` is theirs, a Leader
 * the people whose `leader_id` is theirs. `editIds` = those the person may also edit for: a Manager's whole tree, a Leader's people who switched on
 * "Cho phép leader sửa" (`dh_user_prefs.leader_can_edit`). A person with no one under them sees and edits only themselves.
 */
export async function loadReader(db: Executor, userId: string): Promise<ReaderScope> {
  const res = await db.execute(sql`SELECT m.user_id, (m.manager_id = ${userId}::uuid) AS as_manager, coalesce(p.leader_can_edit, false) AS lce
    FROM org_memberships m LEFT JOIN dh_user_prefs p ON p.user_id = m.user_id
    WHERE m.valid_to IS NULL AND m.user_id <> ${userId}::uuid AND (m.manager_id = ${userId}::uuid OR m.leader_id = ${userId}::uuid)`);
  const ids = [userId];
  const editIds = new Set<string>();
  for (const r of res.rows as { user_id: string; as_manager: boolean; lce: boolean }[]) {
    ids.push(r.user_id);
    if (r.as_manager || r.lce) editIds.add(r.user_id);
  }
  return { self: userId, ids, editIds };
}

/**
 * SSE audience of an event about some ROWS of a table (design module2 section 10). Without the split lock it is everyone who can see the table.
 * Under the lock it is the owner and the members who see at least one of the rows: those that name them or someone they manage in a key column.
 * `extraKeyUsers` = the ids the rows held BEFORE the change (a row whose key moved leaves the old holder's view, so they must hear of it too).
 * Runs in the worker (system scope).
 */
export async function rowAudience(db: Executor, tableId: string, rowIds: string[], extraKeyUsers: string[] = []): Promise<string[]> {
  const t = await db.execute(sql`SELECT t.key_split, t.key_columns, d.owner_id FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ t.id = ${tableId}::uuid`);
  const info = t.rows[0] as { key_split: boolean; key_columns: string[]; owner_id: string } | undefined;
  const everyone = await tableAudience(db, tableId);
  if (!info || !info.key_split) return everyone;
  const holders = new Set<string>(extraKeyUsers);
  if (rowIds.length) {
    const res = await db.execute(sql`SELECT data FROM dh_rows WHERE /*scope:system*/ table_id = ${tableId}::uuid AND id = ANY(${`{${rowIds.join(",")}}`}::uuid[])`);
    for (const r of res.rows as { data: Record<string, unknown> }[]) for (const k of info.key_columns) for (const id of userIdsOf(r.data[k])) holders.add(id);
  }
  const members = everyone.filter((id) => id !== info.owner_id);
  if (members.length === 0 || holders.size === 0) return [info.owner_id];
  const hold = `{${[...holders].join(",")}}`;
  const res = await db.execute(sql`SELECT x.id FROM unnest(${`{${members.join(",")}}`}::uuid[]) AS x(id)
    WHERE x.id = ANY(${hold}::uuid[]) OR EXISTS (SELECT 1 FROM org_memberships o WHERE o.valid_to IS NULL AND o.user_id = ANY(${hold}::uuid[]) AND (o.manager_id = x.id OR o.leader_id = x.id))`);
  return [info.owner_id, ...(res.rows as { id: string }[]).map((r) => r.id)];
}
