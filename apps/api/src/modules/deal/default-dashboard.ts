import { sql } from "drizzle-orm";
import type { Executor } from "@soe/db";

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
  { type: "bar", title: "Doanh thu theo loại deal", series: [{ metric: sum("role:doanh_thu_duoc_tinh"), group_by: ["role:loai_deal"] }], options: { format: "compact" } },
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
