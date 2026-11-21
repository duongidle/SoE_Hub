import { sql } from "drizzle-orm";
import { newId, type Executor } from "@soe/db";
import { parseChart } from "../metrics/dashboard-ops";

/**
 * The default Deals dashboard (design module4 13), declared as data: every number is a metric on the Deals table that points at a column by ROLE
 * (`role:<key>`) or by the name of a template column, so it follows the column when the Manager moves the role (module4 3.7).
 * The dashboard has `as_viewer`: every number is computed with the viewer's own rights, so each person sees their own revenue, deals and commission.
 * Not here yet: forecast of two parts (query `deal.forecast`, not a metric), the KPI progress (Probation KPI per person), cohort winrate, boxplots.
 */
export const DEAL_DASHBOARD_NAME = "Deals";

const DEALS = "Deals";
const sum = (field: string) => ({ name: field, source: DEALS, measure: { agg: "sum", field } });
const kpi = (title: string, field: string, format: "money" | "number" = "money") => ({ type: "kpi", title, series: [{ metric: sum(field) }], options: { format } });

export const DEAL_DASHBOARD_CHARTS: Record<string, unknown>[] = [
  kpi("Doanh thu tính cho tôi", "role:doanh_thu_duoc_tinh"),
  {
    type: "kpi",
    title: "Số deal của tôi",
    series: [{ metric: { name: "Số deal", source: DEALS, measure: { agg: "count" } }, filter: { field: "Tính vào số deal của tôi", op: "eq", value: true } }],
    options: { format: "number" },
  },
  kpi("Com đã nhận của tôi", "Com đã nhận của tôi"),
  kpi("Com tạm tính của tôi", "Com tạm tính của tôi"),
  kpi("Com chờ nhận của tôi", "Com chờ nhận của tôi"),
  // Forecast of two parts (module4 11) for the current quarter, the viewer's own share: signed = unpaid instalments due in the quarter, unsigned = open deals without a schedule expected to close in it.
  {
    type: "kpi",
    title: "Forecast đã ký (quý này)",
    series: [{ metric: { name: "Forecast đã ký", source: "Đợt thanh toán", measure: { agg: "sum", field: "Chờ về tính cho tôi" }, time: { field: "role:han", range: "this_quarter" } } }],
    options: { format: "money" },
  },
  {
    type: "kpi",
    title: "Forecast chưa ký (quý này)",
    series: [{ metric: { name: "Forecast chưa ký", source: DEALS, measure: { agg: "sum", field: "Dự kiến chưa ký tính cho tôi" }, time: { field: "role:ngay_du_kien_chot", range: "this_quarter" } } }],
    options: { format: "money" },
  },
  // CR1 and CR2 by cohort (module4 10.1-10.2): deals grouped by the month they were received, counted whenever they closed. Derived (formula) over the saved metrics below.
  { type: "line", title: "CR1 theo cohort (tháng nhận)", series: [{ metric: { name: "CR1 cohort", formula: "=[Cohort gặp khách]/[Cohort nhận]", format: "percent", time: { bucket: "month" } } }], options: { format: "percent" } },
  { type: "line", title: "CR2 (Winrate) theo cohort (tháng nhận)", series: [{ metric: { name: "CR2 cohort", formula: "=[Cohort Won]/[Cohort gặp khách]", format: "percent", time: { bucket: "month" } } }], options: { format: "percent" } },
  { type: "bar", title: "Doanh thu theo loại deal", series: [{ metric: sum("role:doanh_thu_duoc_tinh"), group_by: ["role:loai_deal"] }], options: { format: "compact" } },
];

/** Saved metrics the cohort charts read (the derived chart metrics name them). A cohort is the month of `Start date`; the count never waits for a deal to close. */
const COHORT_TIME = { field: "role:ngay_bat_dau", bucket: "month" };
export const DEAL_DASHBOARD_METRICS: Record<string, unknown>[] = [
  { name: "Cohort nhận", source: DEALS, measure: { agg: "count" }, time: COHORT_TIME },
  { name: "Cohort gặp khách", source: DEALS, measure: { agg: "count" }, filter: { field: "Status", op: "neq", value: "Disqualified" }, time: COHORT_TIME },
  { name: "Cohort Won", source: DEALS, measure: { agg: "count" }, filter: { field: "Status", op: "eq", value: "Won" }, time: COHORT_TIME },
];

type Exec = (operation: string, input: Record<string, unknown>) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Makes the dashboard in the datahub of the Manager's template tables (once: a dashboard with the same name is left alone). `exec` runs a command as the Manager.
 * Returns the id of the dashboard.
 */
export async function ensureDealDashboard(exec: Exec, db: Executor, datahubId: string): Promise<string> {
  const have = ((await exec("metrics.dashboard.list", { datahub_id: datahubId })) as { id: string; name: string }[] | { items: { id: string; name: string }[] }) ?? [];
  const items = Array.isArray(have) ? have : have.items;
  const found = items.find((d) => d.name === DEAL_DASHBOARD_NAME);
  if (found) return found.id;
  const made = await exec("metrics.dashboard.import", { datahub_id: datahubId, dashboard: { format: "soe-dashboard", version: 1, name: DEAL_DASHBOARD_NAME, charts: DEAL_DASHBOARD_CHARTS } });
  const id = (made.id ?? made.dashboard?.id) as string;
  // `as_viewer` is not part of the import JSON: set it here (system write; the dashboard stays the Manager's).
  await db.execute(sql`UPDATE mt_dashboards SET config = config || '{"as_viewer": true}'::jsonb WHERE /*scope:system*/ id = ${id}::uuid`);
  return id;
}

/**
 * The default dashboard for the tree of one Manager, written as the system (no command executor): the loop of the default tables calls it, so a new tree has it.
 * Idempotent (a live dashboard of that name is left alone). Returns its id, or `null` when the tree has no Deals table yet.
 */
export async function ensureDealDashboardForTree(db: Executor, managerId: string): Promise<string | null> {
  const t = await db.execute(sql`SELECT t.master_table_id AS table_id, m.datahub_id FROM dh_templates t JOIN dh_tables m ON m.id = t.master_table_id
    WHERE /*scope:system*/ t.manager_id = ${managerId}::uuid AND t.scope = 'tree' AND t.deleted_at IS NULL AND t.role_set = 'deals' LIMIT 1`);
  const dh = t.rows[0] as { table_id: string; datahub_id: string } | undefined;
  if (!dh) return null;
  const have = await db.execute(sql`SELECT id FROM mt_dashboards WHERE /*scope:system*/ datahub_id = ${dh.datahub_id}::uuid AND name_norm = ${DEAL_DASHBOARD_NAME.toLowerCase()} AND deleted_at IS NULL`);
  const found = (have.rows[0] as { id: string } | undefined)?.id;
  if (found) return found;
  const id = newId();
  await db.execute(sql`INSERT INTO mt_dashboards (id, datahub_id, name, position, config, created_by, updated_by)
    VALUES (${id}::uuid, ${dh.datahub_id}::uuid, ${DEAL_DASHBOARD_NAME}, (SELECT coalesce(max(position) + 1, 0) FROM mt_dashboards WHERE /*scope:system*/ datahub_id = ${dh.datahub_id}::uuid AND deleted_at IS NULL),
      '{"as_viewer": true}'::jsonb, ${managerId}::uuid, ${managerId}::uuid)`);
  const tables = [dh.table_id];
  for (const m of DEAL_DASHBOARD_METRICS) {
    const exists = await db.execute(sql`SELECT 1 FROM mt_metrics WHERE /*scope:system*/ datahub_id = ${dh.datahub_id}::uuid AND name = ${m.name as string} AND deleted_at IS NULL`);
    if (exists.rows.length) continue;
    await db.execute(sql`INSERT INTO mt_metrics (id, datahub_id, name, config, table_ids, created_by, updated_by)
      VALUES (${newId()}::uuid, ${dh.datahub_id}::uuid, ${m.name as string}, ${JSON.stringify(m)}::jsonb, ${`{${tables.join(",")}}`}::uuid[], ${managerId}::uuid, ${managerId}::uuid)`);
  }
  let y = 0;
  for (const [pos, raw] of DEAL_DASHBOARD_CHARTS.entries()) {
    const chart = parseChart(raw);
    const kpiCard = chart.type === "kpi";
    const layout = { x: kpiCard ? (pos % 4) * 3 : (pos % 2) * 6, y, w: kpiCard ? 3 : 6, h: kpiCard ? 3 : 5 };
    await db.execute(sql`INSERT INTO mt_charts (id, dashboard_id, position, config, created_by, updated_by)
      VALUES (${newId()}::uuid, ${id}::uuid, ${pos}, ${JSON.stringify({ ...chart, layout })}::jsonb, ${managerId}::uuid, ${managerId}::uuid)`);
    y += kpiCard && pos % 4 !== 3 ? 0 : layout.h;
  }
  return id;
}
