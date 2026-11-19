import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, formatNumber, jsonParam } from "@soe/shared";
import { newId } from "@soe/db";
import {
  ChartDefSchema,
  DashFiltersSchema,
  ViewFiltersSchema,
  parseJson,
  type ChartDef,
  type MetricDef,
  type SourceDef,
} from "@soe/metrics";
import { defineCommand, defineQuery } from "../../core/registry";
import { guestCanAccess } from "../guest";
import { loadDatahubAccess, loadTableAccess } from "../datahub/access";
import { listRows } from "../datahub/rows-read";
import { TableSchema } from "../datahub/table-schema";
import { rethrowNameConflict } from "../datahub/errors";
import { Id, Ts } from "../datahub/shared";
import { readSetting } from "../system/settings-catalog";
import { resolveSource, isUuid, type Ctx } from "./context";
import { GUEST_DATA_TYPE, checkViewerFilters, chartRowsOf, computeCtx, dashFields, savedMetricDefs, viewChart, viewDash, viewerChart, type ViewedDash } from "./dashboard-access";
import {
  DashFull,
  MT_SETTINGS,
  checkChart,
  checkDashboardQuota,
  chartOut,
  chartsOf,
  dashOut,
  freeName,
  insertChart,
  loadDash,
  NameSchema,
  parseChart,
  type Raw,
} from "./dashboard-ops";
import { resolveSeries, runChart, seriesOverrides, specOf } from "./chart-run";
import { runRowIds } from "./engine";

const BOM = String.fromCharCode(0xfeff);
const MAX_CSV_ROWS = 5000;
const ROWS_PAGE = 500;

/** Applies the dashboard's `view` of a chart row for the people who only look: no metric definitions. */
const forViewer = (c: ReturnType<typeof chartOut>, role: ViewedDash["role"]) => (role === "owner" ? c : { ...c, chart: viewerChart(c.chart as unknown as ChartDef) as unknown as Record<string, unknown> });

const ChartDataOut = z.object({
  type: z.string(),
  can_view_rows: z.boolean().describe("Người xem được xem các dòng tạo nên số liệu (đọc được các bảng nguồn)."),
  series: z.array(z.record(z.string(), z.unknown())).describe("Kết quả của từng chuỗi số liệu (cùng dạng `metrics.query`)."),
  spark: z.record(z.string(), z.unknown()).nullable().describe("Thẻ KPI: xu hướng nhỏ theo `options.sparkline`."),
  view: z.record(z.string(), z.unknown()).nullable().describe("Số liệu đã tính sẵn cho loại biểu đồ: phễu, waterfall, histogram, box plot, scatter/matrix, xếp hạng, cohort (`view.kind`)."),
  notes: z.array(z.string()).describe("Bộ lọc chung không áp dụng cho biểu đồ này."),
  rows_series: z.number().int().nullable().describe("Chuỗi số liệu có thể xem dòng (null = loại biểu đồ này không có)."),
  ms: z.number(),
});

const RowsOut = z.object({
  columns: z.array(z.object({ key: z.string(), name: z.string(), type: z.string() })),
  items: z.array(z.object({ id: Id, row_no: z.number().int(), data: z.record(z.string(), z.unknown()) })),
  total_visible: z.number().int().describe("Số dòng người xem thấy trong con số này."),
  total_owner: z.number().int().describe("Số dòng tạo nên con số (theo quyền của chủ dashboard)."),
  note: z.string().describe('Ví dụ "Bạn thấy 12/40 dòng tạo nên con số này."'),
});

/** The rows behind a number, in the reader's own scope, plus how many of the owner's rows make it up. */
async function rowsOf(ctx: Ctx, chartId: string, seriesIndex: number, group: (string | number | boolean | null)[], filters: z.output<typeof ViewFiltersSchema> | undefined, limit: number, offset: number) {
  const { chart: raw, dash } = await viewChart(ctx, chartId);
  const chart = parseChart(raw);
  const cctx = computeCtx(ctx, dash);
  await checkViewerFilters(cctx, dash, filters);
  const rs = (await resolveSeries(cctx, dash.datahubId, chart))[seriesIndex];
  if (!rs) throw new AppError("validation_error", `Biểu đồ không có chuỗi số liệu thứ ${seriesIndex + 1}.`, { reason: "bad_series" });
  if (rs.def.formula !== undefined) throw new AppError("validation_error", "Chỉ số phái sinh (công thức của các chỉ số khác) không có dòng riêng: xem các dòng của từng chỉ số thành phần.", { reason: "no_rows_for_derived" });
  const ov = seriesOverrides(rs.series, filters, chartId, chart.options);
  const spec = specOf(rs.def);
  let viewerSource;
  if (dash.role === "owner") viewerSource = await resolveSource(ctx, rs.def.source!, dash.datahubId);
  else {
    try {
      viewerSource = await resolveSource(ctx, rs.def.source!, dash.datahubId);
    } catch (e) {
      if (e instanceof AppError && (e.code === "not_found" || e.code === "forbidden")) {
        throw new AppError("forbidden", "Bạn xem được các con số của dashboard này nhưng chưa có quyền xem bảng dữ liệu nguồn, nên không xem được các dòng tạo nên chúng.", { reason: "no_source_access" });
      }
      throw e;
    }
  }
  const mine = await runRowIds(ctx, viewerSource, spec, ov, group, limit, offset);
  const owner = dash.role === "owner" ? mine : await runRowIds(cctx, await resolveSource(cctx, rs.def.source!, dash.datahubId), spec, ov, group, 1, 0);
  const access = await loadTableAccess(ctx, viewerSource.base.id);
  const schema = await TableSchema.load(ctx.db, access);
  const ids = mine.items.map((x) => x.id);
  const items = ids.length ? (await listRows(ctx.db, access, schema, { filter: { field: "_id", op: "in", value: ids }, labels: true, limit: ids.length })).items : [];
  const visible = mine.total < 0 ? ids.length : mine.total;
  return {
    dash,
    access,
    columns: schema.alive.map((c) => ({ key: c.key, name: c.name, type: c.type })),
    items: items.map((r) => ({ id: r.id as string, row_no: Number(r.row_no), data: r.data })),
    total_visible: visible,
    total_owner: owner.total < 0 ? visible : owner.total,
    ids,
    spec,
    ov,
    viewerSource,
    ownerCtx: cctx,
  };
}

export const rowsNote = (vis: number, own: number) => `Bạn thấy ${formatNumber(vis)}/${formatNumber(own)} dòng tạo nên con số này.`;

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // A cell that starts like a formula would run in a spreadsheet: mark it as text.
  if (/^[=+@\t\r]/.test(s) || /^-(?!\d)/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const GroupParam = jsonParam(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(3));

// ------------------------------------------------------------------------------------------------
// export / import of a dashboard as JSON
// ------------------------------------------------------------------------------------------------

export const DashboardExportSchema = z.strictObject({
  format: z.literal("soe-dashboard"),
  version: z.literal(1),
  name: NameSchema,
  filters: DashFiltersSchema.optional(),
  charts: z.array(z.record(z.string(), z.unknown())).max(100),
});

/** A table or saved source referred to by id becomes its name, so the JSON works in another datahub. */
async function nameOf(ctx: Ctx, datahubId: string, ref: string): Promise<string> {
  if (!isUuid(ref)) return ref;
  const t = await ctx.db.execute(sql`SELECT name FROM dh_tables WHERE /*scope*/ id = ${ref}::uuid AND datahub_id = ${datahubId}::uuid`);
  if (t.rows[0]) return (t.rows[0] as { name: string }).name;
  const s = await ctx.db.execute(sql`SELECT name FROM mt_sources WHERE /*scope*/ id = ${ref}::uuid AND datahub_id = ${datahubId}::uuid AND deleted_at IS NULL`);
  return (s.rows[0] as { name: string } | undefined)?.name ?? ref;
}

async function portableMetric(ctx: Ctx, datahubId: string, m: MetricDef): Promise<MetricDef> {
  const out: MetricDef = { ...m };
  if (typeof m.source === "string") out.source = await nameOf(ctx, datahubId, m.source);
  else if (m.source) {
    const src: SourceDef = { ...m.source, table: await nameOf(ctx, datahubId, m.source.table) };
    if (m.source.joins) src.joins = await Promise.all(m.source.joins.map(async (j) => ({ ...j, table: await nameOf(ctx, datahubId, j.table) })));
    out.source = src;
  }
  if (m.target?.table) out.target = { ...m.target, table: await nameOf(ctx, datahubId, m.target.table) };
  return out;
}

export const chartOperations = [
  // ---- numbers of a chart ----
  defineQuery({
    name: "metrics.chart.data",
    summary: "Số liệu của một biểu đồ (đã tính sẵn mọi thứ biểu đồ cần), kèm bộ lọc chung và lọc chéo.",
    description:
      "Truyền `chart_id` (biểu đồ đã lưu trên dashboard; chủ, người được chia sẻ và Guest được cấp đều gọi được, số tính bằng quyền của CHỦ dashboard) " +
      "hoặc `chart` + `datahub_id` (JSON biểu đồ chưa lưu, chỉ chủ datahub, để xem trước khi cấu hình). " +
      "`filters` = {range?, conditions?:[{field, op: eq|neq|contains|in, value}], cross?:[{chart_id?, field, kind, bucket?, value}]}: bộ lọc chung và lọc chéo; điều kiện nào bảng của biểu đồ không có cột thì bị bỏ qua (nêu trong `notes`). " +
      "Kết quả: `series` (mỗi chuỗi số liệu một kết quả như `metrics.query`) và `view` cho loại biểu đồ cần tính thêm: `funnel` (tỉ lệ chuyển đổi), `waterfall` (cộng dồn), `histogram` (các khoảng), `boxplot` (tứ phân vị, râu, ngoại lai), `scatter`/`matrix` (điểm, ô góc phần tư), `ranking`, `cohort` (tam giác). " +
      "Màn hình chỉ vẽ các số này, không tự cộng hay chia.",
    permission: "system:whoami",
    aiAllowed: true,
    input: z.object({ chart_id: Id.optional(), chart: jsonParam(ChartDefSchema), datahub_id: Id.optional(), filters: jsonParam(ViewFiltersSchema) }),
    output: ChartDataOut,
    http: { method: "GET", path: "/chart-data" },
    handler: async (ctx, i) => {
      if (!!i.chart_id === !!i.chart) throw new AppError("validation_error", "Truyền đúng một trong `chart_id` hoặc `chart` (kèm `datahub_id`).", { reason: "chart_required" });
      if (i.chart_id) {
        const { chart, dash } = await viewChart(ctx, i.chart_id);
        await checkViewerFilters(computeCtx(ctx, dash), dash, i.filters);
        return await runChart(computeCtx(ctx, dash), { chart: parseChart(chart), chartId: i.chart_id, datahubId: dash.datahubId, filters: i.filters, reader: dash.role === "owner" ? undefined : ctx });
      }
      if (!i.datahub_id) throw new AppError("validation_error", "Xem trước biểu đồ chưa lưu cần `datahub_id`.", { reason: "datahub_required" });
      await loadDatahubAccess(ctx, i.datahub_id, "owner");
      return await runChart(ctx, { chart: i.chart!, datahubId: i.datahub_id, filters: i.filters });
    },
  }),

  defineQuery({
    name: "metrics.chart.rows",
    summary: "Xem các dòng tạo nên một con số của biểu đồ, theo quyền của NGƯỜI XEM.",
    description:
      "`series` = chuỗi số liệu (từ 0). `group` = giá trị các cột nhóm của con số đang xem (dòng bấm vào; để trống = cả chuỗi). `filters` như `metrics.chart.data`. " +
      "Con số tính bằng quyền của chủ dashboard, nhưng các dòng chỉ gồm phần người xem được thấy; `total_visible`/`total_owner` cho biết \"bạn thấy x/y dòng\". " +
      "Người xem chưa có quyền xem bảng nguồn thì `forbidden` (`reason: no_source_access`). Chỉ số phái sinh không có dòng riêng. Ghi nhật ký.",
    permission: "system:whoami",
    aiAllowed: true,
    audit: "always",
    input: z.object({
      chart_id: Id,
      series: z.coerce.number().int().min(0).max(5).default(0),
      group: GroupParam,
      filters: jsonParam(ViewFiltersSchema),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    }),
    output: RowsOut,
    http: { method: "GET", path: "/chart-rows" },
    handler: async (ctx, i) => {
      const r = await rowsOf(ctx, i.chart_id, i.series, i.group ?? [], i.filters, i.limit, i.offset);
      ctx.audit({ type: "dashboard", id: r.dash.row.id as string, details: { datahub_id: r.dash.datahubId, chart_id: i.chart_id, viewed_rows: r.items.length, visible: r.total_visible, of: r.total_owner } });
      return { columns: r.columns, items: r.items, total_visible: r.total_visible, total_owner: r.total_owner, note: rowsNote(r.total_visible, r.total_owner) };
    },
  }),

  defineQuery({
    name: "metrics.chart.csv",
    summary: "Xuất CSV các dòng tạo nên số liệu của một biểu đồ, theo quyền của NGƯỜI XEM (tối đa 5.000 dòng).",
    description: "Cùng tham số với `metrics.chart.rows` (không phân trang). Trả nội dung CSV (UTF-8, có BOM để Excel đọc tiếng Việt). Ô bắt đầu bằng `=`, `+`, `@` được đánh dấu là chữ. Ghi nhật ký.",
    permission: "system:whoami",
    aiAllowed: true,
    audit: "always",
    input: z.object({ chart_id: Id, series: z.coerce.number().int().min(0).max(5).default(0), group: GroupParam, filters: jsonParam(ViewFiltersSchema) }),
    output: z.object({ filename: z.string(), csv: z.string(), rows: z.number().int(), total_visible: z.number().int(), total_owner: z.number().int(), truncated: z.boolean(), note: z.string() }),
    http: { method: "GET", path: "/chart-csv" },
    handler: async (ctx, i) => {
      const r = await rowsOf(ctx, i.chart_id, i.series, i.group ?? [], i.filters, MAX_CSV_ROWS, 0);
      const schema = await TableSchema.load(ctx.db, r.access);
      const lines = [r.columns.map((c) => csvCell(c.name)).join(",")];
      // `rowsOf` read the first page; the rest of the ids (up to the cap) are read in pages of ROWS_PAGE.
      const rowsById = new Map(r.items.map((x) => [x.id, x]));
      for (let k = 0; k < r.ids.length; k += ROWS_PAGE) {
        const part = r.ids.slice(k, k + ROWS_PAGE).filter((id) => !rowsById.has(id));
        if (!part.length) continue;
        const page = await listRows(ctx.db, r.access, schema, { filter: { field: "_id", op: "in", value: part }, labels: true, limit: part.length });
        for (const it of page.items) rowsById.set(it.id as string, { id: it.id as string, row_no: Number(it.row_no), data: it.data });
      }
      for (const id of r.ids) {
        const row = rowsById.get(id);
        if (row) lines.push(r.columns.map((c) => csvCell(row.data[c.key])).join(","));
      }
      ctx.audit({ type: "dashboard", id: r.dash.row.id as string, details: { datahub_id: r.dash.datahubId, chart_id: i.chart_id, exported_rows: r.ids.length, visible: r.total_visible, of: r.total_owner } });
      const stamp = new Date().toISOString().slice(0, 10);
      return { filename: `du-lieu-bieu-do-${stamp}.csv`, csv: `${BOM}${lines.join("\r\n")}\r\n`, rows: r.ids.length, total_visible: r.total_visible, total_owner: r.total_owner, truncated: r.total_visible > r.ids.length, note: rowsNote(r.total_visible, r.total_owner) };
    },
  }),

  // ---- looking at a dashboard that is not yours ----
  defineQuery({
    name: "metrics.dashboard.view",
    summary: "Mở dashboard để xem (chủ, người được chia sẻ, hoặc Guest được cấp). Ghi nhật ký mỗi lần mở.",
    description:
      "Trả dashboard cùng biểu đồ như `metrics.dashboard.get`, nhưng người không phải chủ chỉ nhận cách VẼ biểu đồ (loại, tiêu đề, tuỳ chọn, vị trí), không nhận định nghĩa chỉ số, tên bảng hay bộ lọc. " +
      "`role` cho biết bạn là chủ, người được chia sẻ hay Guest được cấp; `my_filters` là bản bộ lọc riêng của bạn (null = dùng `default_filters`). Số liệu lấy bằng `metrics.chart.data`.",
    permission: "system:whoami",
    aiAllowed: true,
    audit: "always",
    input: z.object({ dashboard_id: Id }),
    output: DashFull,
    http: { method: "GET", path: "/dashboards/:dashboard_id/view" },
    handler: async (ctx, i) => {
      const v = await viewDash(ctx, i.dashboard_id);
      const cctx = computeCtx(ctx, v);
      const charts = (await chartsOf(ctx, i.dashboard_id)).map(chartOut);
      const prefs = await ctx.db.execute(sql`SELECT config FROM mt_dashboard_prefs WHERE /*scope*/ dashboard_id = ${i.dashboard_id}::uuid AND user_id = ${ctx.actor.userId}::uuid`);
      ctx.audit({ type: "dashboard", id: i.dashboard_id, details: { datahub_id: v.datahubId, name: v.row.name, role: v.role, viewed: true } });
      return {
        ...dashOut(v.row),
        charts: charts.map((c) => forViewer(c, v.role)),
        role: v.role,
        guest_visible: !!v.config.guest_visible,
        default_filters: (v.config.filters ?? {}) as Record<string, unknown>,
        my_filters: ((prefs.rows[0] as { config: Record<string, unknown> } | undefined)?.config ?? null) as Record<string, unknown> | null,
        fields: await dashFields(cctx, v.datahubId, charts.map((c) => c.chart as unknown as ChartDef)),
        owner_name: v.ownerName,
        datahub_name: v.datahubName,
      } satisfies z.output<typeof DashFull>;
    },
  }),

  defineQuery({
    name: "metrics.dashboard.shared",
    summary: "Các dashboard người khác chia sẻ cho bạn (và, với Guest, các dashboard được cấp).",
    permission: "system:whoami",
    aiAllowed: true,
    list: true,
    input: z.object({}),
    output: z.object({ id: Id, name: z.string(), datahub_id: Id, datahub_name: z.string(), owner_name: z.string().nullable(), role: z.enum(["shared", "guest"]), updated_at: Ts }),
    http: { method: "GET", path: "/dashboards/shared" },
    handler: async (ctx) => {
      const me = ctx.actor.userId;
      const base = sql`SELECT d.id, d.name, d.datahub_id, h.name AS datahub_name, h.owner_id, u.full_name AS owner_name, d.updated_at
        FROM mt_dashboards d JOIN dh_datahubs h ON h.id = d.datahub_id LEFT JOIN users u ON u.id = h.owner_id`;
      const shared = await ctx.db.execute(sql`${base} JOIN mt_dashboard_shares s ON s.dashboard_id = d.id
        WHERE /*scope*/ s.grantee_id = ${me}::uuid AND d.deleted_at IS NULL AND h.deleted_at IS NULL ORDER BY d.name`);
      const items: { id: string; name: string; datahub_id: string; datahub_name: string; owner_name: string | null; role: "shared" | "guest"; updated_at: Date }[] = (shared.rows as Raw[]).map((r) => ({ id: r.id as string, name: r.name as string, datahub_id: r.datahub_id as string, datahub_name: r.datahub_name as string, owner_name: (r.owner_name as string | null) ?? null, role: "shared" as const, updated_at: r.updated_at as Date }));
      const guest = await ctx.db.execute(sql`SELECT 1 FROM users WHERE /*scope:system*/ id = ${me}::uuid AND 'guest' = ANY(roles)`);
      if (guest.rows.length) {
        const open = await ctx.db.execute(sql`${base} WHERE /*scope*/ d.config->>'guest_visible' = 'true' AND d.deleted_at IS NULL AND h.deleted_at IS NULL ORDER BY d.name LIMIT 300`);
        const allowed = new Map<string, boolean>();
        for (const r of open.rows as Raw[]) {
          const owner = r.owner_id as string;
          if (!allowed.has(owner)) allowed.set(owner, await guestCanAccess(ctx.db as never, { guestUserId: me, dataType: GUEST_DATA_TYPE, channel: "web", ownerUserId: owner }));
          if (allowed.get(owner)) items.push({ id: r.id as string, name: r.name as string, datahub_id: r.datahub_id as string, datahub_name: r.datahub_name as string, owner_name: (r.owner_name as string | null) ?? null, role: "guest", updated_at: r.updated_at as Date });
        }
      }
      return { items, nextCursor: null };
    },
  }),

  defineCommand({
    name: "metrics.dashboard.filters.save",
    summary: "Lưu bộ lọc chung thành bản RIÊNG của bạn trên một dashboard (không đổi mặc định của chủ).",
    description: "`filters` = {range?, conditions?:[{field, op, value}]}. Mọi người xem (chủ, được chia sẻ, Guest được cấp) dùng được. Không ghi nhật ký (tự lưu khi đổi).",
    permission: "system:whoami",
    aiAllowed: true,
    audit: "none",
    input: z.object({ dashboard_id: Id, filters: DashFiltersSchema }),
    output: z.object({ saved: z.boolean() }),
    http: { method: "PUT", path: "/dashboards/:dashboard_id/my-filters" },
    handler: async (ctx, i) => {
      const v = await viewDash(ctx, i.dashboard_id);
      await checkViewerFilters(computeCtx(ctx, v), v, i.filters);
      await ctx.db.execute(sql`INSERT INTO mt_dashboard_prefs (dashboard_id, user_id, config) VALUES (${i.dashboard_id}::uuid, ${ctx.actor.userId}::uuid, ${JSON.stringify(i.filters)}::jsonb)
        ON CONFLICT (dashboard_id, user_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`);
      return { saved: true };
    },
  }),

  defineCommand({
    name: "metrics.dashboard.filters.reset",
    summary: "Về mặc định: xoá bản bộ lọc riêng của bạn trên một dashboard.",
    permission: "system:whoami",
    aiAllowed: true,
    audit: "none",
    input: z.object({ dashboard_id: Id }),
    output: z.object({ reset: z.boolean() }),
    http: { method: "DELETE", path: "/dashboards/:dashboard_id/my-filters" },
    handler: async (ctx, i) => {
      await viewDash(ctx, i.dashboard_id);
      await ctx.db.execute(sql`DELETE FROM mt_dashboard_prefs WHERE /*scope*/ dashboard_id = ${i.dashboard_id}::uuid AND user_id = ${ctx.actor.userId}::uuid`);
      return { reset: true };
    },
  }),

  // ---- sharing (owner) ----
  defineQuery({
    name: "metrics.dashboard.share.list",
    summary: "Những người được chia sẻ dashboard này. Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    list: true,
    input: z.object({ dashboard_id: Id }),
    output: z.object({ id: Id, grantee_id: Id, full_name: z.string().nullable(), email: z.string().nullable(), created_at: Ts }),
    http: { method: "GET", path: "/dashboards/:dashboard_id/shares" },
    handler: async (ctx, i) => {
      await loadDash(ctx, i.dashboard_id);
      const res = await ctx.db.execute(sql`SELECT s.id, s.grantee_id, u.full_name, u.email, s.created_at FROM mt_dashboard_shares s JOIN users u ON u.id = s.grantee_id WHERE /*scope*/ s.dashboard_id = ${i.dashboard_id}::uuid ORDER BY s.created_at`);
      return { items: (res.rows as Raw[]).map((r) => ({ id: r.id as string, grantee_id: r.grantee_id as string, full_name: (r.full_name as string | null) ?? null, email: (r.email as string | null) ?? null, created_at: r.created_at as Date })), nextCursor: null };
    },
  }),

  defineCommand({
    name: "metrics.dashboard.share.set",
    summary: "Chia sẻ dashboard cho một người: họ xem được số (tính bằng quyền của bạn), không cần quyền xem bảng nguồn. Chỉ chủ datahub.",
    description: "Người nhận phải là thành viên (không phải Guest; Guest được Manager cấp ở mục cấp dữ liệu, rồi chủ bật `guest_visible` cho dashboard). Chia sẻ lại cho người đã được chia sẻ thì không đổi gì. Ghi nhật ký.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ dashboard_id: Id, grantee_id: Id }),
    output: z.object({ id: Id, grantee_id: Id, full_name: z.string().nullable(), email: z.string().nullable(), created_at: Ts }),
    http: { method: "PUT", path: "/dashboards/:dashboard_id/shares" },
    handler: async (ctx, i) => {
      const d = await loadDash(ctx, i.dashboard_id);
      const acc = await loadDatahubAccess(ctx, d.datahub_id as string, "owner");
      if (i.grantee_id === acc.ownerId) throw new AppError("validation_error", "Không chia sẻ cho chính chủ dashboard.", { reason: "share_self" });
      const u = (await ctx.db.execute(sql`SELECT id, full_name, email, kind, roles, status FROM users WHERE /*scope:system*/ id = ${i.grantee_id}::uuid`)).rows[0] as { id: string; full_name: string | null; email: string | null; kind: string; roles: string[]; status: string } | undefined;
      if (!u || u.kind !== "person") throw new AppError("not_found", "Không tìm thấy người dùng.");
      if (u.status === "locked") throw new AppError("validation_error", "Tài khoản này đã bị khoá.", { reason: "grantee_locked" });
      if (u.roles.includes("guest")) throw new AppError("validation_error", "Guest không nhận chia sẻ trực tiếp. Manager cấp dữ liệu loại Dashboard cho Guest, rồi bạn bật \"Cho Guest được cấp xem\" ở dashboard.", { reason: "grantee_is_guest" });
      const id = newId();
      const ins = await ctx.db.execute(sql`INSERT INTO mt_dashboard_shares (id, dashboard_id, grantee_id, created_by) VALUES (${id}::uuid, ${i.dashboard_id}::uuid, ${i.grantee_id}::uuid, ${ctx.actor.userId}::uuid)
        ON CONFLICT (dashboard_id, grantee_id) DO NOTHING RETURNING id, created_at`);
      const row = (ins.rows[0] ?? (await ctx.db.execute(sql`SELECT id, created_at FROM mt_dashboard_shares WHERE /*scope*/ dashboard_id = ${i.dashboard_id}::uuid AND grantee_id = ${i.grantee_id}::uuid`)).rows[0]) as { id: string; created_at: Date };
      ctx.audit({ type: "dashboard_share", id: row.id, details: { datahub_id: d.datahub_id, dashboard_id: i.dashboard_id, dashboard: d.name, grantee_id: i.grantee_id, shared: !!ins.rows[0] } });
      return { id: row.id, grantee_id: u.id, full_name: u.full_name, email: u.email, created_at: row.created_at };
    },
  }),

  defineCommand({
    name: "metrics.dashboard.share.remove",
    summary: "Bỏ chia sẻ dashboard với một người. Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ dashboard_id: Id, share_id: Id }),
    output: z.object({ id: Id }),
    http: { method: "DELETE", path: "/dashboards/:dashboard_id/shares/:share_id" },
    handler: async (ctx, i) => {
      const d = await loadDash(ctx, i.dashboard_id);
      const r = await ctx.db.execute(sql`DELETE FROM mt_dashboard_shares WHERE /*scope*/ id = ${i.share_id}::uuid AND dashboard_id = ${i.dashboard_id}::uuid RETURNING grantee_id`);
      if (!r.rows.length) throw new AppError("not_found", "Không tìm thấy chia sẻ.");
      await ctx.db.execute(sql`DELETE FROM mt_dashboard_prefs WHERE /*scope*/ dashboard_id = ${i.dashboard_id}::uuid AND user_id = ${(r.rows[0] as { grantee_id: string }).grantee_id}::uuid`);
      ctx.audit({ type: "dashboard_share", id: i.share_id, details: { datahub_id: d.datahub_id, dashboard_id: i.dashboard_id, dashboard: d.name, grantee_id: (r.rows[0] as { grantee_id: string }).grantee_id, removed: true } });
      return { id: i.share_id };
    },
  }),

  // ---- JSON export / import ----
  defineQuery({
    name: "metrics.dashboard.export",
    summary: "Xuất dashboard ra JSON (tên, bộ lọc mặc định, các biểu đồ với chỉ số viết đầy đủ). Chỉ chủ datahub.",
    description: "Chỉ số đã lưu được viết đầy đủ vào từng chuỗi số liệu, bảng và nguồn gọi bằng TÊN, nên nhập được vào datahub khác có bảng cùng tên. AI dựng dashboard bằng JSON này rồi gọi `metrics.dashboard.import`.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    audit: "always",
    input: z.object({ dashboard_id: Id }),
    output: DashboardExportSchema,
    http: { method: "GET", path: "/dashboards/:dashboard_id/export" },
    handler: async (ctx, i) => {
      const d = await loadDash(ctx, i.dashboard_id);
      const dh = d.datahub_id as string;
      const charts = (await chartRowsOf(ctx, i.dashboard_id)).map((c) => c.config);
      const saved = await savedMetricDefs(ctx, dh, charts);
      const out: Record<string, unknown>[] = [];
      for (const c of charts) {
        const series = [];
        for (const s of c.series) {
          const { metric_id, metric, ...rest } = s;
          const def = metric ?? (metric_id ? saved.get(metric_id)?.def : undefined);
          if (!def) throw new AppError("not_found", "Một chuỗi số liệu trỏ tới chỉ số đã bị xoá.", { reason: "metric_missing", metric_id });
          series.push({ ...rest, metric: await portableMetric(ctx, dh, def) });
        }
        const { layout, ...restChart } = c;
        out.push({ ...restChart, series, ...(layout ? { layout } : {}) });
      }
      const cfg = (d.config ?? {}) as { filters?: z.output<typeof DashFiltersSchema> };
      ctx.audit({ type: "dashboard", id: i.dashboard_id, details: { datahub_id: dh, name: d.name, exported: true } });
      return { format: "soe-dashboard" as const, version: 1 as const, name: d.name as string, ...(cfg.filters ? { filters: cfg.filters } : {}), charts: out };
    },
  }),

  defineCommand({
    name: "metrics.dashboard.import",
    summary: "Tạo dashboard mới từ JSON (kết quả của `metrics.dashboard.export`). Chỉ chủ datahub.",
    description: "`dashboard` = {format:\"soe-dashboard\", version:1, name, filters?, charts:[...]}. Mỗi biểu đồ được kiểm như `metrics.chart.create` (bảng, cột, chỉ số phải có trong datahub này); lỗi nêu biểu đồ thứ mấy. Tên trùng thì thêm hậu tố \"(bản sao)\"; gửi `name` để đặt tên khác. Tính vào giới hạn dashboard và biểu đồ.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ datahub_id: Id, dashboard: z.record(z.string(), z.unknown()), name: NameSchema.optional() }),
    output: DashFull,
    http: { method: "POST", path: "/datahubs/:datahub_id/dashboards/import", status: 201 },
    handler: async (ctx, i) => {
      await loadDatahubAccess(ctx, i.datahub_id, "owner");
      const src = parseJson(DashboardExportSchema, i.dashboard, "JSON dashboard");
      const maxCharts = await readSetting(ctx.db, MT_SETTINGS.maxCharts);
      if (src.charts.length > maxCharts) throw new AppError("quota_exceeded", `JSON có ${src.charts.length} biểu đồ, vượt giới hạn ${maxCharts} biểu đồ mỗi dashboard.`, { limit: maxCharts });
      await checkDashboardQuota(ctx, i.datahub_id);
      const charts: ChartDef[] = [];
      for (const [k, raw] of src.charts.entries()) {
        try {
          const c = parseChart(raw);
          await checkChart(ctx, i.datahub_id, c);
          charts.push(c);
        } catch (e) {
          // Whatever is wrong with a chart of the JSON is a problem of the JSON the caller sent (a table that does not exist included).
          if (e instanceof AppError) throw new AppError("validation_error", `Biểu đồ thứ ${k + 1} của JSON: ${e.message}`, { ...(e.details ?? {}), reason: ((e.details as { reason?: string } | undefined)?.reason) ?? "bad_chart", chart: k });
          throw e;
        }
      }
      const wanted = i.name ?? src.name;
      const taken = (await ctx.db.execute(sql`SELECT 1 FROM mt_dashboards WHERE /*scope*/ datahub_id = ${i.datahub_id}::uuid AND name_norm = ${wanted.toLowerCase().trim()} AND deleted_at IS NULL`)).rows.length > 0;
      const name = taken && !i.name ? await freeName(ctx, i.datahub_id, wanted) : wanted;
      const id = newId();
      const me = ctx.actor.userId;
      const cfg = src.filters && (src.filters.range || src.filters.conditions?.length) ? { filters: src.filters } : {};
      try {
        await ctx.db.execute(sql`INSERT INTO mt_dashboards (id, datahub_id, name, position, config, created_by, updated_by)
          VALUES (${id}::uuid, ${i.datahub_id}::uuid, ${name}, (SELECT coalesce(max(position) + 1, 0) FROM mt_dashboards WHERE /*scope*/ datahub_id = ${i.datahub_id}::uuid AND deleted_at IS NULL), ${JSON.stringify(cfg)}::jsonb, ${me}::uuid, ${me}::uuid)`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      for (const [pos, c] of charts.entries()) await insertChart(ctx, id, c, pos);
      ctx.audit({ type: "dashboard", id, details: { datahub_id: i.datahub_id, name, imported: true, charts: charts.length } });
      const d = await loadDash(ctx, id);
      const rows = (await chartsOf(ctx, id)).map(chartOut);
      const extras = { role: "owner" as const, guest_visible: false, default_filters: (cfg as { filters?: Record<string, unknown> }).filters ?? {}, my_filters: null, fields: await dashFields(ctx, i.datahub_id, rows.map((c) => c.chart as unknown as ChartDef)), owner_name: null, datahub_name: "" };
      const hub = (await ctx.db.execute(sql`SELECT h.name, u.full_name FROM dh_datahubs h LEFT JOIN users u ON u.id = h.owner_id WHERE /*scope*/ h.id = ${i.datahub_id}::uuid`)).rows[0] as { name: string; full_name: string | null };
      return { ...dashOut(d), charts: rows, ...extras, owner_name: hub.full_name, datahub_name: hub.name };
    },
  }),
];
