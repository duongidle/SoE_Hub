import { sql } from "drizzle-orm";
import { AppError } from "@soe/shared";
import type { Executor } from "@soe/db";
import { registerGrantDataType, type GrantChannel } from "../guest";

/**
 * A Guest reads ONE table of a Manager's tree through a data grant (design module1 section 5.2, Stage 4.7). A general mechanism: no rule of its own for Deals.
 * The grant says which columns the Guest may read (`options.columns`, column keys) and, with a team scope, whose rows: a Leader's team (like that Leader sees them)
 * instead of the whole tree. Everything a Guest reads goes through `TableAccess` (access.ts): columns not chosen are out of the schema, so out of every grid,
 * filter, sort, group, export and API answer. The grant is only usable while its table still belongs to the Manager who gave it.
 */
export const GUEST_TABLE_TYPE = "datahub_table";
/** The user agent of the actor a background job (export, import) runs as: for a Guest, such a job is the grant's `export` channel. */
export const JOB_AGENT = "soe-worker-job";

export interface GuestTableView {
  /** Keys of the columns the Guest may read (the union of their active grants of this table through this channel). */
  columns: Set<string>;
  /** null = the whole tree (the Manager's own rows). Otherwise the Leaders whose team the Guest sees. */
  leaderIds: string[] | null;
}

/** The grants that let this Guest read this table through this channel; null when there is none. */
export async function guestTableView(db: Executor, guestId: string, tableId: string, channel: GrantChannel): Promise<GuestTableView | null> {
  const res = await db.execute(sql`SELECT g.scope_leader_id, g.options FROM data_grants g
    JOIN users u ON u.id = g.guest_user_id
    JOIN dh_tables t ON t.id = ${tableId}::uuid AND t.deleted_at IS NULL
    JOIN dh_datahubs d ON d.id = t.datahub_id AND d.deleted_at IS NULL AND d.owner_id = g.scope_manager_id
    WHERE /*scope:system*/ g.guest_user_id = ${guestId}::uuid AND g.data_type = ${GUEST_TABLE_TYPE} AND g.options ->> 'table_id' = ${tableId}
      AND g.revoked_at IS NULL AND g.deleted_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
      AND ${channel} = ANY(g.channels) AND 'guest' = ANY(u.roles) AND u.status <> 'locked'`);
  const rows = res.rows as { scope_leader_id: string | null; options: { columns?: string[] } }[];
  if (rows.length === 0) return null;
  const columns = new Set(rows.flatMap((r) => r.options.columns ?? []));
  const leaders = rows.map((r) => r.scope_leader_id);
  return { columns, leaderIds: leaders.some((l) => l === null) ? null : (leaders as string[]) };
}

interface Col {
  key: string;
  name: string;
  type: string;
  storage: string;
  layer: string | null;
}

/** Checks the options of a grant and returns them normalized: the table is the Manager's, the columns are real and may be given to a Guest. */
async function validateOptions(ctx: { db: Executor }, managerId: string, options: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
  const tableId = options?.table_id;
  const refs = options?.columns;
  if (typeof tableId !== "string" || !/^[0-9a-f-]{36}$/i.test(tableId)) throw new AppError("validation_error", "Cấp bảng cho Guest cần `options.table_id` (mã bảng).", { reason: "grant_options" });
  if (!Array.isArray(refs) || refs.length === 0 || refs.length > 300 || refs.some((x) => typeof x !== "string")) throw new AppError("validation_error", "Cấp bảng cho Guest cần `options.columns`: danh sách cột Guest được thấy (ít nhất một).", { reason: "grant_options" });
  const t = await ctx.db.execute(sql`SELECT t.id FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ t.id = ${tableId}::uuid AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND d.owner_id = ${managerId}::uuid`);
  if (t.rows.length === 0) throw new AppError("validation_error", "Chỉ cấp được bảng của chính bạn.", { reason: "grant_table_not_yours" });
  const cols = (await ctx.db.execute(sql`SELECT key, name, type, storage, layer FROM dh_columns WHERE /*scope*/ table_id = ${tableId}::uuid AND deleted_at IS NULL`)).rows as unknown as Col[];
  const keys: string[] = [];
  for (const ref of refs as string[]) {
    const want = ref.normalize("NFC").trim().toLowerCase();
    const c = cols.find((x) => x.key === ref || x.name.normalize("NFC").trim().toLowerCase() === want);
    if (!c) throw new AppError("validation_error", `Không có cột "${ref}" trong bảng.`, { reason: "grant_column_unknown", column: ref });
    if (c.storage === "person" || c.layer === "custom") throw new AppError("validation_error", `Cột "${c.name}" là cột cá nhân, không cấp cho Guest được.`, { reason: "grant_column_personal", column: c.name });
    if (c.type === "attachment") throw new AppError("validation_error", `Cột "${c.name}" là cột đính kèm, không cấp cho Guest được.`, { reason: "grant_column_attachment", column: c.name });
    if (!keys.includes(c.key)) keys.push(c.key);
  }
  return { table_id: tableId, columns: keys };
}

registerGrantDataType({ key: GUEST_TABLE_TYPE, label: "Bảng Datahub (chọn cột được thấy)", channels: ["web", "export", "api"], validateOptions });
