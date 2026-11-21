import { api, apiList, qs } from "@/lib/api";
import type { ColumnBody } from "./api";
import type { ConversionReport } from "./column-config";
import type { Column } from "./types";

/** Calls of the Quản lý Deal screens (templates, menu). The server decides; nothing is computed here. */

export interface DealTable {
  id: string;
  datahub_id: string;
  name: string;
  row_count: number;
  access: "owner" | "edit_data" | "view";
  kind: "normal" | "merged";
  template_id: string | null;
  template_kind: "shared" | "personal" | null;
  template_scope: "tree" | "team" | null;
  /** Column role set of the table (Module 4 mục 3.7): `deals`, `payments`, `receipts`, `ledger`... null for a table without roles. */
  role_set: string | null;
}
export interface DealHome { datahub_id: string | null; tables: DealTable[] }

export interface Template {
  id: string;
  name: string;
  kind: "shared" | "personal";
  scope: "tree" | "team";
  manager_id: string;
  leader_id: string | null;
  master_table_id: string | null;
  my_table_id: string | null;
  member_permission: "view" | "edit_data";
  leader_can_add_columns: boolean;
  role_set: string | null;
  can_edit: boolean;
  archived: boolean;
  members: number;
}
export interface TemplateRole { key: string; label: string; types: string[]; required: boolean; used_by: string[]; column: string | null }
export interface TemplateDetail { template: Template; columns: Column[]; members: { id: string; full_name: string; view_only: boolean }[]; roles: TemplateRole[] }
export interface Impact { count: number; names: string[] }
export interface ColumnUsage {
  role: { key: string; label: string; used_by: string[] } | null;
  formulas: { table_id: string; table_name: string; column_id: string; column_name: string }[];
  views: { view_id: string; view_name: string }[];
  metrics: { metric_id: string; metric_name: string }[];
  dashboards: { dashboard_id: string; dashboard_name: string }[];
  key_column: boolean;
}

export const dealKeys = { home: ["deal-home"] as const, templates: ["deal-templates"] as const, template: (id: string) => ["deal-template", id] as const, prefs: ["dh-prefs"] as const };

export const getDealHome = () => api<DealHome>("GET", "/datahub/deal-home");
export const listTemplates = (includeArchived = false) => api<Template[]>("GET", `/datahub/templates${qs({ include_archived: includeArchived ? true : undefined })}`);
export const getTemplate = (id: string) => api<TemplateDetail>("GET", `/datahub/templates/${id}`);
export const templateImpact = (id: string, o: { layer?: string; layer_roles?: string[]; team_leader_id?: string } = {}) =>
  api<Impact>("GET", `/datahub/templates/${id}/impact${qs({ layer: o.layer, layer_roles: o.layer_roles, team_leader_id: o.team_leader_id })}`);
export const createTemplate = (body: { name: string; kind: "shared" | "personal"; scope?: "tree" | "team"; leader_id?: string; member_permission: "view" | "edit_data" }) => api<Template>("POST", "/datahub/templates", body);
/** The active Leaders a Manager can make a team table for (the org list is already limited to the Manager's tree). */
export const listLeaders = async () =>
  (await apiList<{ id: string; full_name: string }>(`/org/members${qs({ limit: 200, filter: { and: [{ field: "roles", op: "contains", value: "leader" }, { field: "status", op: "eq", value: "active" }] } })}`)).data;
export const updateTemplate = (id: string, body: { name?: string; member_permission?: "view" | "edit_data"; leader_can_add_columns?: boolean }) => api<Template>("PATCH", `/datahub/templates/${id}`, body);
export const archiveTemplate = (id: string) => api("POST", `/datahub/templates/${id}/archive`, {});
export const restoreTemplate = (id: string) => api("POST", `/datahub/templates/${id}/restore`, {});
export const columnUsage = (tableId: string, column: string) => api<ColumnUsage>("GET", `/tables/${tableId}/columns/${encodeURIComponent(column)}/usage`);
export const setColumnRole = (templateId: string, column: string, role: string | null) => api<{ column: Column; previous: Column | null; usage: ColumnUsage }>("PUT", `/datahub/templates/${templateId}/columns/${encodeURIComponent(column)}/role`, { role });
export const getPrefs = () => api<{ leader_can_edit: boolean }>("GET", "/datahub/prefs");
export const setPrefs = (leaderCanEdit: boolean) => api<{ leader_can_edit: boolean }>("PUT", "/datahub/prefs", { leader_can_edit: leaderCanEdit });
export const setShareOptions = (tableId: string, body: { key_split?: boolean; key_columns?: string[]; key_primary?: string | null; members_bulk_create?: boolean }) => api("PUT", `/tables/${tableId}/share-options`, body);

// ---- columns of a template (each save reaches every person of the template at once)
const tc = (id: string, key?: string) => `/datahub/templates/${id}/columns${key ? `/${encodeURIComponent(key)}` : ""}`;
export interface NewTemplateColumn { layer: "basic" | "role" | "team"; layer_roles?: string[]; team_leader_id?: string; storage: "shared" | "person"; role?: string; autofill?: { column: string; attr: string; sum?: "team" | "tree" } }
export const createTemplateColumn = (id: string, body: ColumnBody & NewTemplateColumn) => api<Column>("POST", tc(id), body);
export const updateTemplateColumn = (id: string, key: string, body: ColumnBody) => api<{ column: Column; usage: ColumnUsage }>("PATCH", tc(id, key), body);
export const changeTemplateColumnType = (id: string, key: string, type: string, config: Record<string, unknown> | undefined, acceptDataLoss: boolean) =>
  api<{ column: Column; report: ConversionReport }>("POST", `${tc(id, key)}/type`, { type, config, accept_data_loss: acceptDataLoss });
export const deleteTemplateColumn = (id: string, key: string) => api("DELETE", tc(id, key));
export const restoreTemplateColumn = (id: string, key: string) => api<Column>("POST", `${tc(id, key)}/restore`, {});

// ---- cycle and forecast (the numbers are the server's: `deal.cycle`, `deal.forecast`) ------------------------------------------

export const CYCLE_MILESTONES = [
  { value: "median", label: "Trung vị" },
  { value: "mean", label: "Trung bình" },
  { value: "p75", label: "P75" },
  { value: "p90", label: "P90" },
  { value: "none", label: "Không chờ" },
] as const;
export type CycleMilestone = (typeof CYCLE_MILESTONES)[number]["value"];
export interface DealCycle {
  milestone: CycleMilestone;
  today: string;
  won_count: number;
  stats: { median: number; mean: number; p75: number; p90: number } | null;
  days: number;
  defaulted: boolean;
  cutoff: string;
  mature_through: string | null;
  mature_month: string | null;
}
export interface DealForecast {
  from: string;
  to: string;
  signed: number;
  unsigned: number;
  by_type: { type: string; signed: number; unsigned: number }[];
}
export const dealCycleKeys = { cycle: (m: string) => ["deal-cycle", m] as const, forecast: (from: string, to: string) => ["deal-forecast", from, to] as const };
export const getCycle = (milestone: CycleMilestone) => api<DealCycle>("GET", `/deal/cycle${qs({ milestone })}`);
export const getForecast = (from: string, to: string) => api<DealForecast>("GET", `/deal/forecast${qs({ from, to })}`);
