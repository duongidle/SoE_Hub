import { sql } from "drizzle-orm";
import { AppError } from "@soe/shared";
import { DashboardConfigSchema, MetricDefSchema, parseJson, type ChartDef, type DashboardConfig, type MetricDef } from "@soe/metrics";
import { guestCanAccess } from "../guest";
import { resolveSource, type Ctx } from "./context";

type Raw = Record<string, unknown>;

/**
 * Who may look at a dashboard, and with whose rights its numbers are computed (design module3 section 9).
 * - `owner`: the owner of the datahub.
 * - `shared`: a person the owner shared this dashboard with.
 * - `guest`: a Guest whose data grant (type `dashboard`, channel web) covers the owner's place, for a dashboard the owner opened to Guests.
 * Anyone else gets `not_found`. The numbers are always computed as the OWNER (`computeCtx`); the rows behind a number are read as the viewer.
 */
export type DashRole = "owner" | "shared" | "guest";

export interface ViewedDash {
  row: Raw;
  role: DashRole;
  ownerId: string;
  ownerName: string | null;
  datahubId: string;
  datahubName: string;
  config: DashboardConfig;
}

export const GUEST_DATA_TYPE = "dashboard";

export async function viewDash(ctx: Ctx, id: string): Promise<ViewedDash> {
  const me = ctx.actor.userId;
  const res = await ctx.db.execute(sql`SELECT d.id, d.datahub_id, d.name, d.position, d.version, d.updated_at, d.config, h.owner_id, h.name AS datahub_name, u.full_name AS owner_name,
      EXISTS (SELECT 1 FROM mt_dashboard_shares s WHERE /*scope*/ s.dashboard_id = d.id AND s.grantee_id = ${me}::uuid) AS shared
    FROM mt_dashboards d JOIN dh_datahubs h ON h.id = d.datahub_id LEFT JOIN users u ON u.id = h.owner_id
    WHERE /*scope*/ d.id = ${id}::uuid AND d.deleted_at IS NULL AND h.deleted_at IS NULL`);
  const row = res.rows[0] as Raw | undefined;
  if (!row) throw new AppError("not_found", "Không tìm thấy dashboard.");
  const ownerId = row.owner_id as string;
  const config = parseJson(DashboardConfigSchema, row.config ?? {}, "Cấu hình dashboard");
  let role: DashRole | null = null;
  if (ownerId === me) role = "owner";
  else if (row.shared) role = "shared";
  else if (config.guest_visible && (await guestCanAccess(ctx.db as never, { guestUserId: me, dataType: GUEST_DATA_TYPE, channel: "web", ownerUserId: ownerId }))) role = "guest";
  if (!role) throw new AppError("not_found", "Không tìm thấy dashboard.");
  return { row, role, ownerId, ownerName: (row.owner_name as string | null) ?? null, datahubId: row.datahub_id as string, datahubName: row.datahub_name as string, config };
}

/** The context numbers are computed in: the owner's rights (for the owner it is the caller's own). */
export function computeCtx(ctx: Ctx, v: Pick<ViewedDash, "role" | "ownerId">): Ctx {
  return v.role === "owner" ? ctx : { db: ctx.db, actor: { ...ctx.actor, userId: v.ownerId } };
}

export async function chartRowsOf(ctx: Ctx, dashboardId: string): Promise<{ id: string; config: ChartDef }[]> {
  const res = await ctx.db.execute(sql`SELECT id, config FROM mt_charts WHERE /*scope*/ dashboard_id = ${dashboardId}::uuid AND deleted_at IS NULL ORDER BY position, id`);
  return (res.rows as Raw[]).map((r) => ({ id: r.id as string, config: r.config as ChartDef }));
}

/** A chart of a dashboard the person may view (its dashboard is checked with `viewDash`). */
export async function viewChart(ctx: Ctx, chartId: string): Promise<{ chart: ChartDef; dash: ViewedDash; version: number }> {
  const res = await ctx.db.execute(sql`SELECT c.config, c.version, c.dashboard_id FROM mt_charts c WHERE /*scope*/ c.id = ${chartId}::uuid AND c.deleted_at IS NULL`);
  const row = res.rows[0] as Raw | undefined;
  if (!row) throw new AppError("not_found", "Không tìm thấy biểu đồ.");
  const dash = await viewDash(ctx, row.dashboard_id as string);
  return { chart: row.config as ChartDef, dash, version: row.version as number };
}

/** Definitions of the saved metrics the series of these charts name (by id), read with the owner's rights. */
export async function savedMetricDefs(cctx: Ctx, datahubId: string, charts: ChartDef[]): Promise<Map<string, { name: string; def: MetricDef }>> {
  const ids = [...new Set(charts.flatMap((c) => c.series.map((s) => s.metric_id).filter((x): x is string => !!x)))];
  const out = new Map<string, { name: string; def: MetricDef }>();
  if (!ids.length) return out;
  const res = await cctx.db.execute(sql`SELECT id, name, config FROM mt_metrics WHERE /*scope*/ datahub_id = ${datahubId}::uuid AND id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND deleted_at IS NULL`);
  for (const r of res.rows as Raw[]) out.set(r.id as string, { name: r.name as string, def: parseJson(MetricDefSchema, r.config, `Chỉ số "${r.name as string}"`) });
  return out;
}

export interface FilterField {
  name: string;
  kind: "enum" | "text" | "boolean";
  options?: string[];
}

const MAX_FIELDS = 40;

/**
 * Columns a viewer may filter the whole dashboard by: the Một lựa chọn, văn bản and checkbox columns of the tables the charts read (merged by
 * name, so a filter on "Loại" reaches every chart whose table has a column of that name). Read with the owner's rights.
 */
export async function dashFields(cctx: Ctx, datahubId: string, charts: ChartDef[]): Promise<FilterField[]> {
  const saved = await savedMetricDefs(cctx, datahubId, charts);
  const byName = new Map<string, FilterField>();
  const doneTables = new Set<string>();
  for (const c of charts) {
    for (const s of c.series) {
      const def = s.metric ?? (s.metric_id ? saved.get(s.metric_id)?.def : undefined);
      if (!def || def.formula !== undefined || def.source === undefined) continue;
      let rs;
      try {
        rs = await resolveSource(cctx, def.source, datahubId);
      } catch (e) {
        if (e instanceof AppError) continue; // a source that cannot be read here shows up as that chart's own error
        throw e;
      }
      if (doneTables.has(rs.base.id)) continue;
      doneTables.add(rs.base.id);
      for (const col of rs.base.columns) {
        if (col.meta || (col.kind !== "enum" && col.kind !== "text" && col.kind !== "boolean")) continue;
        const key = col.name.toLowerCase();
        const have = byName.get(key);
        if (!have) byName.set(key, { name: col.name, kind: col.kind, ...(col.kind === "enum" ? { options: (col.options ?? []).map((o) => o.name) } : {}) });
        else if (have.kind === "enum" && col.kind === "enum") have.options = [...new Set([...(have.options ?? []), ...(col.options ?? []).map((o) => o.name)])];
        else if (have.kind !== col.kind) byName.set(key, { name: have.name, kind: "text" });
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "vi")).slice(0, MAX_FIELDS);
}

/** What a person who only views a dashboard gets of a chart: how it is drawn, not how it is computed (no metric definitions, tables or filters). */
export function viewerChart(chart: ChartDef): ChartDef {
  return {
    type: chart.type,
    ...(chart.title ? { title: chart.title } : {}),
    series: chart.series.map((s) => ({ ...(s.label ? { label: s.label } : {}), ...(s.axis ? { axis: s.axis } : {}), ...(s.kind ? { kind: s.kind } : {}), ...(s.step ? { step: s.step } : {}), ...(s.compare ? { compare: s.compare } : {}) })) as ChartDef["series"],
    ...(chart.text ? { text: chart.text } : {}),
    ...(chart.options ? { options: chart.options } : {}),
    ...(chart.layout ? { layout: chart.layout } : {}),
  };
}
