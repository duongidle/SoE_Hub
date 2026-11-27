import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@soe/shared";
import { newId } from "@soe/db";
import { ChartDefSchema, DashFiltersSchema, GRID_COLUMNS, LayoutSchema, MAX_GRID_ROWS, parseJson, type ChartDef } from "@soe/metrics";
import { defineCommand, defineQuery } from "../../core/registry";
import { loadDatahubAccess } from "../datahub/access";
import { rethrowNameConflict } from "../datahub/errors";
import { Id, Ts } from "../datahub/shared";
import { readSetting, type SettingDef } from "../system/settings-catalog";
import { validateDefinition } from "./engine";
import { dashFields } from "./dashboard-access";
import { noteOpened } from "../home/recent";
import type { Ctx } from "./context";

export type Raw = Record<string, unknown>;

export const MT_SETTINGS = {
  maxDashboards: {
    key: "metrics.max_dashboards",
    label: "Dashboard tối đa mỗi datahub",
    description: "Số dashboard trong một datahub (không tính dashboard trong thùng rác).",
    schema: z.number().int().min(1).max(200),
    default: 20,
  } satisfies SettingDef<number>,
  maxCharts: {
    key: "metrics.max_charts",
    label: "Biểu đồ tối đa mỗi dashboard",
    description: "Số biểu đồ trong một dashboard.",
    schema: z.number().int().min(1).max(100),
    default: 30,
  } satisfies SettingDef<number>,
} as const;

export const DashOut = z.object({
  id: Id,
  datahub_id: Id,
  name: z.string(),
  position: z.number().int(),
  chart_count: z.number().int().optional(),
  version: z.number().int(),
  deleted_at: Ts.nullable().optional(),
  updated_at: Ts,
});
export const ChartOut = z.object({ id: Id, dashboard_id: Id, position: z.number().int(), version: z.number().int(), chart: z.record(z.string(), z.unknown()).describe("JSON của biểu đồ (ChartDef)."), updated_at: Ts });
export const FilterFieldOut = z.object({ name: z.string(), kind: z.enum(["enum", "text", "boolean"]), options: z.array(z.string()).optional() });
export const DashExtras = {
  role: z.enum(["owner", "shared", "guest"]).describe("Vai trò của người xem: chủ, được chia sẻ, hay Guest được cấp."),
  guest_visible: z.boolean().describe("Chủ cho phép Guest được cấp dashboard xem dashboard này."),
  default_filters: z.record(z.string(), z.unknown()).describe("Bộ lọc chung mặc định do chủ đặt (`range`, `conditions`)."),
  my_filters: z.record(z.string(), z.unknown()).nullable().describe("Bản bộ lọc riêng của người xem; null = đang dùng mặc định."),
  fields: z.array(FilterFieldOut).describe("Các cột lọc được cho cả dashboard (gộp theo tên từ các bảng mà biểu đồ đọc)."),
  owner_name: z.string().nullable(),
  datahub_name: z.string(),
};
export const DashFull = DashOut.extend({ charts: z.array(ChartOut), ...DashExtras });

export const dashOut = (r: Raw) => ({
  id: r.id as string,
  datahub_id: r.datahub_id as string,
  name: r.name as string,
  position: r.position as number,
  ...(r.chart_count !== undefined ? { chart_count: Number(r.chart_count) } : {}),
  version: r.version as number,
  deleted_at: (r.deleted_at as Date | null) ?? null,
  updated_at: r.updated_at as Date,
});
export const chartOut = (r: Raw) => ({ id: r.id as string, dashboard_id: r.dashboard_id as string, position: r.position as number, version: r.version as number, chart: r.config as Record<string, unknown>, updated_at: r.updated_at as Date });

export const NameSchema = z.string().normalize("NFC").trim().min(1, "Tên dashboard không được để trống.").max(100, "Tên dashboard tối đa 100 ký tự.");

/** Dashboards and their charts belong to the owner of the datahub (design module3 section 9); sharing them is Stage 3C-2. */
export async function loadDash(ctx: Ctx, id: string, opts: { deleted?: boolean } = {}): Promise<Raw> {
  const res = await ctx.db.execute(sql`SELECT id, datahub_id, name, position, version, deleted_at, updated_at, config FROM mt_dashboards WHERE /*scope*/ id = ${id}::uuid AND (deleted_at IS NOT NULL) = ${!!opts.deleted}`);
  const row = res.rows[0] as Raw | undefined;
  if (!row) throw new AppError("not_found", "Không tìm thấy dashboard.");
  await loadDatahubAccess(ctx, row.datahub_id as string, "owner");
  return row;
}

async function loadChart(ctx: Ctx, id: string): Promise<Raw> {
  const res = await ctx.db.execute(sql`SELECT c.id, c.dashboard_id, c.position, c.version, c.config, c.updated_at, d.datahub_id
    FROM mt_charts c JOIN mt_dashboards d ON d.id = c.dashboard_id WHERE /*scope*/ c.id = ${id}::uuid AND c.deleted_at IS NULL AND d.deleted_at IS NULL`);
  const row = res.rows[0] as Raw | undefined;
  if (!row) throw new AppError("not_found", "Không tìm thấy biểu đồ.");
  await loadDatahubAccess(ctx, row.datahub_id as string, "owner");
  return row;
}

export async function chartsOf(ctx: Ctx, dashboardId: string): Promise<Raw[]> {
  const res = await ctx.db.execute(sql`SELECT id, dashboard_id, position, version, config, updated_at FROM mt_charts WHERE /*scope*/ dashboard_id = ${dashboardId}::uuid AND deleted_at IS NULL ORDER BY position, id`);
  return res.rows as Raw[];
}

async function countDashboards(ctx: Ctx, datahubId: string): Promise<number> {
  const res = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM mt_dashboards WHERE /*scope*/ datahub_id = ${datahubId}::uuid AND deleted_at IS NULL`);
  return (res.rows[0] as { n: number }).n;
}

export async function checkDashboardQuota(ctx: Ctx, datahubId: string, adding = 1): Promise<void> {
  const max = await readSetting(ctx.db, MT_SETTINGS.maxDashboards);
  if ((await countDashboards(ctx, datahubId)) + adding > max) throw new AppError("quota_exceeded", `Đã đạt giới hạn ${max} dashboard mỗi datahub. Xoá bớt hoặc liên hệ Admin.`, { limit: max });
}

export async function checkChartQuota(ctx: Ctx, dashboardId: string, adding = 1): Promise<void> {
  const max = await readSetting(ctx.db, MT_SETTINGS.maxCharts);
  const res = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM mt_charts WHERE /*scope*/ dashboard_id = ${dashboardId}::uuid AND deleted_at IS NULL`);
  if ((res.rows[0] as { n: number }).n + adding > max) throw new AppError("quota_exceeded", `Đã đạt giới hạn ${max} biểu đồ mỗi dashboard.`, { limit: max });
}

/** Every series reads a metric that exists in the datahub (saved) or is a valid definition (written in place). */
export async function checkChart(ctx: Ctx, datahubId: string, chart: ChartDef): Promise<void> {
  for (const [i, s] of chart.series.entries()) {
    try {
      if (s.metric_id) {
        const r = await ctx.db.execute(sql`SELECT id FROM mt_metrics WHERE /*scope*/ id = ${s.metric_id}::uuid AND datahub_id = ${datahubId}::uuid AND deleted_at IS NULL`);
        if (!r.rows.length) throw new AppError("not_found", "Không tìm thấy chỉ số.");
      } else {
        await validateDefinition(ctx, datahubId, s.metric!);
      }
    } catch (e) {
      if (e instanceof AppError) throw new AppError(e.code, `Chuỗi số liệu thứ ${i + 1}: ${e.message}`, { ...(e.details ?? {}), series: i });
      throw e;
    }
  }
}

export const parseChart = (raw: unknown) => parseJson(ChartDefSchema, raw, "Biểu đồ");

/** First free place at the bottom of the grid for a new chart. */
export function bottomLayout(charts: Raw[], w = 6, h = 5) {
  let y = 0;
  for (const c of charts) {
    const l = (c.config as { layout?: { y: number; h: number } }).layout;
    if (l) y = Math.max(y, l.y + l.h);
  }
  return { x: 0, y, w, h };
}

export async function insertChart(ctx: Ctx, dashboardId: string, chart: ChartDef, position: number): Promise<string> {
  const id = newId();
  const me = ctx.actor.userId;
  await ctx.db.execute(sql`INSERT INTO mt_charts (id, dashboard_id, position, config, created_by, updated_by) VALUES (${id}::uuid, ${dashboardId}::uuid, ${position}, ${JSON.stringify(chart)}::jsonb, ${me}::uuid, ${me}::uuid)`);
  return id;
}

export async function freeName(ctx: Ctx, datahubId: string, base: string): Promise<string> {
  const res = await ctx.db.execute(sql`SELECT name_norm FROM mt_dashboards WHERE /*scope*/ datahub_id = ${datahubId}::uuid AND deleted_at IS NULL`);
  const used = new Set((res.rows as { name_norm: string }[]).map((r) => r.name_norm));
  const trim = (s: string) => s.slice(0, 100).trim();
  for (let n = 1; n < 1000; n++) {
    const cand = trim(n === 1 ? `${base.slice(0, 85)} (bản sao)` : `${base.slice(0, 80)} (bản sao ${n})`);
    if (!used.has(cand.toLowerCase())) return cand;
  }
  return trim(`${base.slice(0, 60)} ${newId().slice(-6)}`);
}

/** What a dashboard carries besides its charts: the viewer's role and filters, and the columns the common filter bar offers. */
export async function dashExtras(ctx: Ctx, dashboardId: string, d: Raw, charts: ChartDef[]) {
  const me = ctx.actor.userId;
  const cfg = (d.config ?? {}) as { filters?: Record<string, unknown>; guest_visible?: boolean };
  const prefs = await ctx.db.execute(sql`SELECT config FROM mt_dashboard_prefs WHERE /*scope*/ dashboard_id = ${dashboardId}::uuid AND user_id = ${me}::uuid`);
  const hub = await ctx.db.execute(sql`SELECT h.name, h.owner_id, u.full_name FROM dh_datahubs h LEFT JOIN users u ON u.id = h.owner_id WHERE /*scope*/ h.id = ${d.datahub_id as string}::uuid`);
  const h = hub.rows[0] as { name: string; owner_id: string; full_name: string | null };
  return {
    role: "owner" as const,
    guest_visible: !!cfg.guest_visible,
    default_filters: cfg.filters ?? {},
    my_filters: ((prefs.rows[0] as { config: Record<string, unknown> } | undefined)?.config ?? null) as Record<string, unknown> | null,
    fields: await dashFields(ctx, d.datahub_id as string, charts),
    owner_name: h.full_name,
    datahub_name: h.name,
  };
}

export const dashboardOperations = [
  defineQuery({
    name: "metrics.dashboard.list",
    summary: "Danh sách dashboard của một datahub (theo thứ tự đã xếp). Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    list: true,
    input: z.object({ datahub_id: Id }),
    output: DashOut,
    http: { method: "GET", path: "/datahubs/:datahub_id/dashboards" },
    handler: async (ctx, i) => {
      await loadDatahubAccess(ctx, i.datahub_id, "owner");
      const res = await ctx.db.execute(sql`SELECT d.id, d.datahub_id, d.name, d.position, d.version, d.updated_at,
          (SELECT count(*) FROM mt_charts c WHERE /*scope*/ c.dashboard_id = d.id AND c.deleted_at IS NULL) AS chart_count
        FROM mt_dashboards d WHERE /*scope*/ d.datahub_id = ${i.datahub_id}::uuid AND d.deleted_at IS NULL ORDER BY d.position, d.id`);
      return { items: (res.rows as Raw[]).map(dashOut), nextCursor: null };
    },
  }),

  defineQuery({
    name: "metrics.dashboard.get",
    summary: "Xem một dashboard cùng các biểu đồ của nó (JSON).",
    description: "`charts[].chart` là JSON biểu đồ: type, title, series (mỗi chuỗi gọi `metrics.query`), options, layout {x,y,w,h} trên lưới 12 cột. Số liệu lấy bằng `metrics.query`, không nằm trong dashboard.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ dashboard_id: Id }),
    output: DashFull,
    http: { method: "GET", path: "/dashboards/:dashboard_id" },
    handler: async (ctx, i) => {
      const d = await loadDash(ctx, i.dashboard_id);
      await noteOpened(ctx, "dashboard", i.dashboard_id);
      const charts = (await chartsOf(ctx, i.dashboard_id)).map(chartOut);
      return { ...dashOut(d), charts, ...(await dashExtras(ctx, i.dashboard_id, d, charts.map((c) => c.chart as unknown as ChartDef))) };
    },
  }),

  defineCommand({
    name: "metrics.dashboard.create",
    summary: "Tạo dashboard trống. Tối đa 20 dashboard mỗi datahub (Admin chỉnh được). Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ datahub_id: Id, name: NameSchema }),
    output: DashOut,
    http: { method: "POST", path: "/datahubs/:datahub_id/dashboards", status: 201 },
    handler: async (ctx, i) => {
      await loadDatahubAccess(ctx, i.datahub_id, "owner");
      await checkDashboardQuota(ctx, i.datahub_id);
      const id = newId();
      const me = ctx.actor.userId;
      try {
        await ctx.db.execute(sql`INSERT INTO mt_dashboards (id, datahub_id, name, position, created_by, updated_by)
          VALUES (${id}::uuid, ${i.datahub_id}::uuid, ${i.name}, (SELECT coalesce(max(position) + 1, 0) FROM mt_dashboards WHERE /*scope*/ datahub_id = ${i.datahub_id}::uuid AND deleted_at IS NULL), ${me}::uuid, ${me}::uuid)`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      ctx.audit({ type: "dashboard", id, details: { datahub_id: i.datahub_id, name: i.name } });
      return dashOut(await loadDash(ctx, id));
    },
  }),

  defineCommand({
    name: "metrics.dashboard.update",
    summary: "Đổi tên dashboard, đặt bộ lọc chung mặc định, hoặc mở/đóng dashboard cho Guest được cấp (gửi `version` đang thấy). Chỉ chủ datahub.",
    description: "Gửi ít nhất một trong `name`, `filters` (`{range?, conditions?}`; `null` xoá bộ lọc mặc định), `guest_visible`. Bộ lọc mặc định là điểm xuất phát; mỗi người xem đổi bộ lọc thì lưu thành bản riêng của họ.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ dashboard_id: Id, version: z.number().int().min(1), name: NameSchema.optional(), filters: z.union([z.record(z.string(), z.unknown()), z.null()]).optional(), guest_visible: z.boolean().optional() }),
    output: DashOut,
    http: { method: "PATCH", path: "/dashboards/:dashboard_id" },
    handler: async (ctx, i) => {
      const d = await loadDash(ctx, i.dashboard_id);
      if (i.name === undefined && i.filters === undefined && i.guest_visible === undefined) throw new AppError("validation_error", "Gửi ít nhất một trong name, filters, guest_visible.", { reason: "nothing_to_update" });
      const filters = i.filters === undefined || i.filters === null ? i.filters : parseJson(DashFiltersSchema, i.filters, "Bộ lọc chung");
      let config = (d.config ?? {}) as Record<string, unknown>;
      if (filters !== undefined) {
        const { filters: _old, ...rest } = config;
        void _old;
        config = filters === null || (!filters.range && !filters.conditions?.length) ? rest : { ...rest, filters };
      }
      if (i.guest_visible !== undefined) {
        const { guest_visible: _g, ...rest } = config;
        void _g;
        config = i.guest_visible ? { ...rest, guest_visible: true } : rest;
      }
      const name = i.name ?? (d.name as string);
      let n;
      try {
        n = await ctx.db.execute(sql`UPDATE mt_dashboards SET name = ${name}, config = ${JSON.stringify(config)}::jsonb, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid
          WHERE /*scope*/ id = ${i.dashboard_id}::uuid AND version = ${i.version} AND deleted_at IS NULL RETURNING id`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      if (!n.rows.length) throw new AppError("conflict");
      ctx.audit({ type: "dashboard", id: i.dashboard_id, details: { datahub_id: d.datahub_id, name, ...(i.filters !== undefined ? { filters_changed: true } : {}), ...(i.guest_visible !== undefined ? { guest_visible: i.guest_visible } : {}) } });
      return dashOut(await loadDash(ctx, i.dashboard_id));
    },
  }),

  defineCommand({
    name: "metrics.dashboard.reorder",
    summary: "Xếp lại thứ tự các dashboard của datahub: gửi danh sách mã theo thứ tự mới. Chỉ chủ datahub.",
    description: "`ids` phải đúng là tập dashboard hiện có (không thiếu, không thừa).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    list: true,
    input: z.object({ datahub_id: Id, ids: z.array(Id).min(1).max(200) }),
    output: DashOut,
    http: { method: "PUT", path: "/datahubs/:datahub_id/dashboards/order" },
    handler: async (ctx, i) => {
      await loadDatahubAccess(ctx, i.datahub_id, "owner");
      const res = await ctx.db.execute(sql`SELECT id FROM mt_dashboards WHERE /*scope*/ datahub_id = ${i.datahub_id}::uuid AND deleted_at IS NULL`);
      const have = (res.rows as { id: string }[]).map((r) => r.id).sort();
      if (JSON.stringify(have) !== JSON.stringify([...new Set(i.ids)].sort())) throw new AppError("validation_error", "Danh sách thứ tự phải gồm đúng các dashboard hiện có.", { reason: "order_mismatch" });
      for (const [pos, id] of i.ids.entries()) {
        await ctx.db.execute(sql`UPDATE mt_dashboards SET position = ${pos} WHERE /*scope*/ id = ${id}::uuid AND datahub_id = ${i.datahub_id}::uuid AND position <> ${pos}`);
      }
      ctx.audit({ type: "dashboard", id: i.datahub_id, details: { datahub_id: i.datahub_id, action: "reorder" } });
      const out = await ctx.db.execute(sql`SELECT id, datahub_id, name, position, version, updated_at FROM mt_dashboards WHERE /*scope*/ datahub_id = ${i.datahub_id}::uuid AND deleted_at IS NULL ORDER BY position, id`);
      return { items: (out.rows as Raw[]).map(dashOut), nextCursor: null };
    },
  }),

  defineCommand({
    name: "metrics.dashboard.duplicate",
    summary: "Nhân bản dashboard cùng mọi biểu đồ. Tên mới mặc định \"<tên> (bản sao)\". Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ dashboard_id: Id, name: NameSchema.optional() }),
    output: DashFull,
    http: { method: "POST", path: "/dashboards/:dashboard_id/duplicate", status: 201 },
    handler: async (ctx, i) => {
      const src = await loadDash(ctx, i.dashboard_id);
      const dh = src.datahub_id as string;
      await checkDashboardQuota(ctx, dh);
      const name = i.name ?? (await freeName(ctx, dh, src.name as string));
      const id = newId();
      const me = ctx.actor.userId;
      try {
        await ctx.db.execute(sql`INSERT INTO mt_dashboards (id, datahub_id, name, position, config, created_by, updated_by)
          VALUES (${id}::uuid, ${dh}::uuid, ${name}, (SELECT coalesce(max(position) + 1, 0) FROM mt_dashboards WHERE /*scope*/ datahub_id = ${dh}::uuid AND deleted_at IS NULL),
            (SELECT config - 'guest_visible' FROM mt_dashboards WHERE /*scope*/ id = ${i.dashboard_id}::uuid), ${me}::uuid, ${me}::uuid)`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      for (const c of await chartsOf(ctx, i.dashboard_id)) await insertChart(ctx, id, c.config as ChartDef, c.position as number);
      ctx.audit({ type: "dashboard", id, details: { datahub_id: dh, name, copied_from: i.dashboard_id } });
      const copied = await loadDash(ctx, id);
      const charts = (await chartsOf(ctx, id)).map(chartOut);
      return { ...dashOut(copied), charts, ...(await dashExtras(ctx, id, copied, charts.map((c) => c.chart as unknown as ChartDef))) };
    },
  }),

  defineCommand({
    name: "metrics.dashboard.delete",
    summary: "Xoá dashboard vào thùng rác (khôi phục trong 7 ngày). Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ dashboard_id: Id }),
    output: z.object({ id: Id }),
    http: { method: "DELETE", path: "/dashboards/:dashboard_id" },
    handler: async (ctx, i) => {
      const d = await loadDash(ctx, i.dashboard_id);
      await ctx.db.execute(sql`UPDATE mt_dashboards SET deleted_at = now(), deleted_by = ${ctx.actor.userId}::uuid, version = version + 1 WHERE /*scope*/ id = ${i.dashboard_id}::uuid`);
      ctx.audit({ type: "dashboard", id: i.dashboard_id, details: { datahub_id: d.datahub_id, name: d.name } });
      return { id: i.dashboard_id };
    },
  }),

  defineQuery({
    name: "metrics.dashboard.trash",
    summary: "Dashboard đã xoá của một datahub (còn khôi phục được). Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    list: true,
    input: z.object({ datahub_id: Id }),
    output: DashOut,
    http: { method: "GET", path: "/datahubs/:datahub_id/dashboards/trash" },
    handler: async (ctx, i) => {
      await loadDatahubAccess(ctx, i.datahub_id, "owner");
      const res = await ctx.db.execute(sql`SELECT id, datahub_id, name, position, version, deleted_at, updated_at FROM mt_dashboards WHERE /*scope*/ datahub_id = ${i.datahub_id}::uuid AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id`);
      return { items: (res.rows as Raw[]).map(dashOut), nextCursor: null };
    },
  }),

  defineCommand({
    name: "metrics.dashboard.restore",
    summary: "Khôi phục dashboard từ thùng rác. Tên đã bị dùng thì trả `conflict` (`reason: duplicate_name`); gửi `name` để khôi phục dưới tên mới. Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ dashboard_id: Id, name: NameSchema.optional() }),
    output: DashOut,
    http: { method: "POST", path: "/dashboards/:dashboard_id/restore" },
    handler: async (ctx, i) => {
      const d = await loadDash(ctx, i.dashboard_id, { deleted: true });
      await checkDashboardQuota(ctx, d.datahub_id as string);
      try {
        await ctx.db.execute(sql`UPDATE mt_dashboards SET deleted_at = NULL, deleted_by = NULL, name = ${i.name ?? (d.name as string)}, version = version + 1,
          position = (SELECT coalesce(max(position) + 1, 0) FROM mt_dashboards WHERE /*scope*/ datahub_id = ${d.datahub_id as string}::uuid AND deleted_at IS NULL)
          WHERE /*scope*/ id = ${i.dashboard_id}::uuid`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      ctx.audit({ type: "dashboard", id: i.dashboard_id, details: { datahub_id: d.datahub_id, name: i.name ?? d.name, restored: true } });
      return dashOut(await loadDash(ctx, i.dashboard_id));
    },
  }),

  defineCommand({
    name: "metrics.chart.create",
    summary: "Thêm biểu đồ vào dashboard. Tối đa 30 biểu đồ mỗi dashboard (Admin chỉnh được). Chỉ chủ datahub.",
    description:
      "`chart` = {type: kpi|column|bar|line|area|combo|pie|donut|table|pivot|note, title?, series:[{metric_id | metric, label?, axis?, kind?, time?, group_by?, filter?, order?, limit?, compare?, cumulative?, target?}], text? (ô ghi chú), options?, layout?:{x,y,w,h}}. " +
      "Không gửi `layout` thì biểu đồ xếp xuống cuối lưới. Server kiểm mọi chỉ số (đã lưu hay viết tại chỗ) của chuỗi số liệu.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ dashboard_id: Id, chart: z.record(z.string(), z.unknown()) }),
    output: ChartOut,
    http: { method: "POST", path: "/dashboards/:dashboard_id/charts", status: 201 },
    handler: async (ctx, i) => {
      const d = await loadDash(ctx, i.dashboard_id);
      const chart = parseChart(i.chart);
      await checkChartQuota(ctx, i.dashboard_id);
      await checkChart(ctx, d.datahub_id as string, chart);
      const existing = await chartsOf(ctx, i.dashboard_id);
      const placed: ChartDef = chart.layout ? chart : { ...chart, layout: bottomLayout(existing, chart.type === "kpi" ? 3 : 6, chart.type === "kpi" ? 3 : 5) };
      const id = await insertChart(ctx, i.dashboard_id, placed, existing.length ? Math.max(...existing.map((c) => c.position as number)) + 1 : 0);
      ctx.audit({ type: "dashboard_chart", id, details: { datahub_id: d.datahub_id, dashboard_id: i.dashboard_id, chart_type: chart.type } });
      return chartOut((await chartsOf(ctx, i.dashboard_id)).find((c) => c.id === id)!);
    },
  }),

  defineCommand({
    name: "metrics.chart.update",
    summary: "Sửa biểu đồ (gửi lại cả JSON mới và `version` đang thấy). Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ chart_id: Id, version: z.number().int().min(1), chart: z.record(z.string(), z.unknown()) }),
    output: ChartOut,
    http: { method: "PATCH", path: "/charts/:chart_id" },
    handler: async (ctx, i) => {
      const row = await loadChart(ctx, i.chart_id);
      const chart = parseChart(i.chart);
      await checkChart(ctx, row.datahub_id as string, chart);
      const keep = chart.layout ? chart : { ...chart, ...((row.config as { layout?: unknown }).layout ? { layout: (row.config as { layout: ChartDef["layout"] }).layout } : {}) };
      const n = await ctx.db.execute(sql`UPDATE mt_charts SET config = ${JSON.stringify(keep)}::jsonb, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid
        WHERE /*scope*/ id = ${i.chart_id}::uuid AND version = ${i.version} AND deleted_at IS NULL RETURNING id`);
      if (!n.rows.length) throw new AppError("conflict");
      ctx.audit({ type: "dashboard_chart", id: i.chart_id, details: { datahub_id: row.datahub_id, dashboard_id: row.dashboard_id, chart_type: chart.type } });
      return chartOut((await chartsOf(ctx, row.dashboard_id as string)).find((c) => c.id === i.chart_id)!);
    },
  }),

  defineCommand({
    name: "metrics.chart.delete",
    summary: "Xoá một biểu đồ khỏi dashboard. Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ chart_id: Id }),
    output: z.object({ id: Id }),
    http: { method: "DELETE", path: "/charts/:chart_id" },
    handler: async (ctx, i) => {
      const row = await loadChart(ctx, i.chart_id);
      await ctx.db.execute(sql`UPDATE mt_charts SET deleted_at = now(), deleted_by = ${ctx.actor.userId}::uuid, version = version + 1 WHERE /*scope*/ id = ${i.chart_id}::uuid`);
      ctx.audit({ type: "dashboard_chart", id: i.chart_id, details: { datahub_id: row.datahub_id, dashboard_id: row.dashboard_id, deleted: true } });
      return { id: i.chart_id };
    },
  }),

  defineCommand({
    name: "metrics.chart.layout",
    summary: "Lưu vị trí và kích thước nhiều biểu đồ cùng lúc (kéo thả, đổi kích thước). Không kiểm `version` (lần ghi sau cùng thắng). Chỉ chủ datahub.",
    description: `Lưới ${GRID_COLUMNS} cột; x từ 0, w từ 1, x + w tối đa ${GRID_COLUMNS}; h tối đa ${MAX_GRID_ROWS}. Không ghi nhật ký (đây là thao tác bố cục tự lưu).`,
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ dashboard_id: Id, items: z.array(z.object({ chart_id: Id, layout: LayoutSchema })).min(1).max(100) }),
    output: z.object({ saved: z.number().int() }),
    http: { method: "PUT", path: "/dashboards/:dashboard_id/layout" },
    handler: async (ctx, i) => {
      await loadDash(ctx, i.dashboard_id);
      for (const it of i.items) {
        if (it.layout.x + it.layout.w > GRID_COLUMNS) throw new AppError("validation_error", `Biểu đồ vượt quá ${GRID_COLUMNS} cột của lưới.`, { reason: "layout_out_of_grid", chart_id: it.chart_id });
      }
      let saved = 0;
      for (const [pos, it] of i.items.entries()) {
        const r = await ctx.db.execute(sql`UPDATE mt_charts SET config = jsonb_set(config, '{layout}', ${JSON.stringify(it.layout)}::jsonb, true), position = ${pos}, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid
          WHERE /*scope*/ id = ${it.chart_id}::uuid AND dashboard_id = ${i.dashboard_id}::uuid AND deleted_at IS NULL RETURNING id`);
        saved += r.rows.length;
      }
      return { saved };
    },
  }),
];
