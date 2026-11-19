import { sql } from "drizzle-orm";
import { AppError } from "@soe/shared";
import { SourceDefSchema, parseJson, type MColumn, type MTable, type PlanJoin, type SourceDef } from "@soe/metrics";
import type { HandlerCtx } from "../../core/types";
import { loadTableAccess, scopeKey, type TableAccess } from "../datahub/access";
import { sourceOf } from "../datahub/column-source";
import { effectiveType } from "../datahub/cell-values";
import { columnTypeDef } from "../datahub/column-types";
import { TableSchema, normName } from "../datahub/table-schema";
import type { DhColumn, SelectOption } from "../datahub/types";

export type Ctx = Pick<HandlerCtx, "db" | "actor">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID_RE.test(s);

/** A Datahub column as the metric engine sees it (a computed column counts as its result type). Null = not usable in a metric. */
export function toMColumn(c: DhColumn): MColumn | null {
  const src = sourceOf(c);
  const base = { key: c.key, name: c.name, typeLabel: columnTypeDef(c.type).label, read: (data: string, as: "text" | "json") => src.cellExpr(c, data, as) };
  switch (effectiveType(c)) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "auto_number": return { ...base, kind: "number" };
    case "date": return { ...base, kind: "date" };
    case "datetime": return { ...base, kind: "datetime" };
    case "created_time": return { ...base, kind: "datetime", meta: "created_at" };
    case "modified_time": return { ...base, kind: "datetime", meta: "updated_at" };
    case "created_by": return { ...base, kind: "uuid", meta: "created_by" };
    case "modified_by": return { ...base, kind: "uuid", meta: "updated_by" };
    case "row_id": return { ...base, kind: "uuid", meta: "id" };
    case "checkbox": return { ...base, kind: "boolean" };
    case "single_select": return { ...base, kind: "enum", options: ((c.config.options as SelectOption[] | undefined) ?? []).map((o) => ({ id: o.id, name: o.name })) };
    case "multi_select":
    case "attachment": return { ...base, kind: "set" };
    case "relation": return { ...base, kind: "set", relationTarget: c.config.target_table_id as string | undefined };
    case "user": return { ...base, kind: "uuid" };
    case "text":
    case "long_text":
    case "email":
    case "phone":
    case "url": return { ...base, kind: "text" };
    default: return null;
  }
}

/** Standard fields of a row, addressable by every metric on the base table. */
const STANDARD: MColumn[] = [
  { key: "_row_no", name: "_row_no", kind: "number", meta: "row_no", typeLabel: "Số dòng" },
  { key: "_created_at", name: "_created_at", kind: "datetime", meta: "created_at", typeLabel: "Ngày tạo" },
  { key: "_updated_at", name: "_updated_at", kind: "datetime", meta: "updated_at", typeLabel: "Ngày sửa" },
];

export async function loadMTable(ctx: Ctx, access: TableAccess): Promise<MTable> {
  const schema = await TableSchema.load(ctx.db, access);
  const cols = schema.alive.map(toMColumn).filter((c): c is MColumn => !!c);
  return { id: access.tableId, name: access.table.name, columns: [...cols, ...STANDARD], scope: (alias) => access.scope(alias), scopeKey: scopeKey(access) };
}

export interface ResolvedSource {
  datahubId: string;
  def: SourceDef;
  base: MTable;
  joins: PlanJoin[];
  /** Every table the source reads (base first). */
  tableIds: string[];
  /** Id of the saved source it came from, when it did. */
  savedId: string | null;
}

async function tableIdByName(ctx: Ctx, datahubId: string, name: string): Promise<string> {
  const r = await ctx.db.execute(sql`SELECT id FROM dh_tables WHERE /*scope*/ datahub_id = ${datahubId}::uuid AND name_norm = ${normName(name)} AND deleted_at IS NULL`);
  const id = (r.rows[0] as { id: string } | undefined)?.id;
  if (!id) throw new AppError("not_found", `Không tìm thấy bảng "${name}" trong datahub này.`, { reason: "table_not_found", table: name });
  return id;
}

/**
 * Turns what a metric or a call names as its `source` into tables the person may read. `source` may be a saved source (id or name),
 * a table (id or name) or an inline source. A name needs `datahubId`. Joined tables must belong to the same datahub as the base
 * table (dashboards use only the data of one datahub, design module3 section 2).
 */
export async function resolveSource(ctx: Ctx, source: string | SourceDef, datahubId?: string): Promise<ResolvedSource> {
  let def: SourceDef;
  let dh = datahubId ?? null;
  let savedId: string | null = null;
  if (typeof source === "string") {
    const ref = source.trim();
    let row: { id: string; datahub_id: string; config: unknown } | undefined;
    if (isUuid(ref)) {
      row = (await ctx.db.execute(sql`SELECT id, datahub_id, config FROM mt_sources WHERE /*scope*/ id = ${ref}::uuid AND deleted_at IS NULL`)).rows[0] as typeof row;
    } else if (dh) {
      row = (await ctx.db.execute(sql`SELECT id, datahub_id, config FROM mt_sources WHERE /*scope*/ datahub_id = ${dh}::uuid AND name_norm = ${normName(ref)} AND deleted_at IS NULL`)).rows[0] as typeof row;
    }
    if (row) {
      // The definition is only readable by someone who can read the datahub; the tables are checked below anyway.
      def = parseJson(SourceDefSchema, row.config, "Nguồn dữ liệu đã lưu");
      dh = row.datahub_id;
      savedId = row.id;
    } else {
      if (!isUuid(ref) && !dh) throw new AppError("validation_error", `Gọi bảng hoặc nguồn "${ref}" bằng tên thì phải kèm datahub_id.`, { reason: "datahub_required" });
      def = { table: ref };
    }
  } else {
    def = source;
  }
  const lookup = async (ref: string): Promise<string> => (isUuid(ref) ? ref : await tableIdByName(ctx, dh ?? "", ref));
  if (!dh && !isUuid(def.table)) throw new AppError("validation_error", `Gọi bảng "${def.table}" bằng tên thì phải kèm datahub_id.`, { reason: "datahub_required" });
  const baseAcc = await loadTableAccess(ctx, await lookup(def.table));
  if (dh && baseAcc.table.datahubId !== dh) throw new AppError("not_found", "Không tìm thấy bảng.");
  dh = baseAcc.table.datahubId;
  const base = await loadMTable(ctx, baseAcc);
  const joins: PlanJoin[] = [];
  for (const j of def.joins ?? []) {
    let acc: TableAccess;
    try {
      acc = await loadTableAccess(ctx, await lookup(j.table));
    } catch (e) {
      if (e instanceof AppError && e.code === "not_found") throw new AppError("not_found", `Không tìm thấy bảng ghép "${j.table}", hoặc bạn không có quyền xem.`, { reason: "join_table_not_found", table: j.table });
      throw e;
    }
    if (acc.table.datahubId !== dh) throw new AppError("validation_error", `Bảng ghép "${acc.table.name}" thuộc datahub khác. Chỉ ghép được các bảng trong cùng datahub.`, { reason: "cross_datahub", table: acc.table.name });
    const t = await loadMTable(ctx, acc);
    joins.push({ alias: j.as ?? acc.table.name, table: t, ...(j.link ? { link: j.link } : {}), ...(j.on ? { on: j.on } : {}), ...(j.collapse ? { collapse: j.collapse } : {}) });
  }
  return { datahubId: dh, def, base, joins, tableIds: [...new Set([base.id, ...joins.map((j) => j.table.id)])], savedId };
}
