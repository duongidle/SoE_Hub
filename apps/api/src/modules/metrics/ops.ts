import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, jsonParam, filterParam } from "@soe/shared";
import { newId } from "@soe/db";
import {
  COMPARES,
  GroupSchema,
  MAX_GROUPS,
  MetricDefSchema,
  OutliersSchema,
  QueryOverridesSchema,
  SourceDefSchema,
  TargetSchema,
  TimeSpecSchema,
  parseJson,
  type MetricDef,
  type SourceDef,
} from "@soe/metrics";
import { defineCommand, defineQuery } from "../../core/registry";
import { loadDatahubAccess } from "../datahub/access";
import { rethrowNameConflict } from "../datahub/errors";
import { Id, Ts } from "../datahub/shared";
import { diagnoseJoins, runDefinition, unmatchedRows, validateDefinition } from "./engine";
import { resolveSource, type Ctx, type ResolvedSource } from "./context";

type Raw = Record<string, unknown>;

const MetricOut = z.object({
  id: Id,
  datahub_id: Id,
  name: z.string(),
  definition: z.record(z.string(), z.unknown()).describe("JSON của chỉ số (mục 5 thiết kế Module 3)."),
  table_ids: z.array(Id).describe("Các bảng chỉ số đọc."),
  version: z.number().int(),
  created_at: Ts,
  updated_at: Ts,
});
const SourceOut = MetricOut.omit({ definition: true }).extend({ definition: z.record(z.string(), z.unknown()).describe("JSON của nguồn dữ liệu (mục 3 thiết kế Module 3).") });

const out = (r: Raw) => ({
  id: r.id as string,
  datahub_id: r.datahub_id as string,
  name: r.name as string,
  definition: r.config as Record<string, unknown>,
  table_ids: r.table_ids as string[],
  version: r.version as number,
  created_at: r.created_at as Date,
  updated_at: r.updated_at as Date,
});

const COLS = sql`id, datahub_id, name, config, table_ids, version, created_at, updated_at`;

/** True when the person may see every table the definition reads (a person given only some tables sees only those definitions). */
const visible = (tableIds: string[] | null, ids: string[]) => tableIds === null || ids.every((t) => tableIds.includes(t));

type Kind = "metric" | "source";
const KIND = {
  metric: { table: sql.raw("mt_metrics"), type: "metric", label: "chỉ số", Label: "Chỉ số" },
  source: { table: sql.raw("mt_sources"), type: "metric_source", label: "nguồn dữ liệu", Label: "Nguồn dữ liệu" },
} as const;

async function loadRow(ctx: Ctx, kind: Kind, id: string, need: "view" | "owner") {
  const k = KIND[kind];
  const res = await ctx.db.execute(sql`SELECT ${COLS} FROM ${k.table} WHERE /*scope*/ id = ${id}::uuid AND deleted_at IS NULL`);
  const row = res.rows[0] as Raw | undefined;
  if (!row) throw new AppError("not_found", `Không tìm thấy ${k.label}.`);
  const acc = await loadDatahubAccess(ctx, row.datahub_id as string, need);
  if (!visible(acc.tableIds, row.table_ids as string[])) throw new AppError("not_found", `Không tìm thấy ${k.label}.`);
  return row;
}

async function listRows(ctx: Ctx, kind: Kind, datahubId: string) {
  const acc = await loadDatahubAccess(ctx, datahubId, "view");
  const res = await ctx.db.execute(sql`SELECT ${COLS} FROM ${KIND[kind].table} WHERE /*scope*/ datahub_id = ${datahubId}::uuid AND deleted_at IS NULL ORDER BY name_norm, id`);
  return (res.rows as Raw[]).filter((r) => visible(acc.tableIds, r.table_ids as string[])).map(out);
}

/** Checks a metric definition end to end (JSON shape, source, tables, columns, options, joins) and returns what it reads. */
async function checkMetric(ctx: Ctx, datahubId: string, def: MetricDef): Promise<{ tableIds: string[] }> {
  return { tableIds: await validateDefinition(ctx, datahubId, def) };
}

async function checkSource(ctx: Ctx, datahubId: string, def: SourceDef): Promise<ResolvedSource> {
  if (!def.name?.trim()) throw new AppError("validation_error", "Nguồn dữ liệu cần có tên (name).", { reason: "name_required" });
  const rs = await resolveSource(ctx, def, datahubId);
  if (rs.datahubId !== datahubId) throw new AppError("validation_error", "Bảng của nguồn thuộc datahub khác.", { reason: "cross_datahub" });
  await diagnoseJoins(ctx, rs); // validates every join definition against the columns
  return rs;
}

export const metricOperations = [
  defineQuery({
    name: "metrics.query",
    summary: "Tính một chỉ số: trả một bảng số nhỏ (một con số, hoặc một con số cho mỗi nhóm) kèm chẩn đoán ghép bảng.",
    description:
      "Truyền `metric_id` (chỉ số đã lưu) hoặc `metric` (JSON chỉ số tại chỗ: source, measure, filter, time, group_by). Các tham số `time`, `group_by`, `filter` đè lên chỉ số: `time` đè từng khoá (`field`, `bucket`, `range`), `group_by` thay hẳn, `filter` được AND thêm. " +
      "Phép tổng hợp: count, count_distinct, sum, avg, min, max, median, percentile (p), trimmed_mean (trim), stddev, stddev_pop. Nhóm thời gian: day, week (từ thứ Hai), month, quarter, year, theo giờ Việt Nam; quý và năm theo tháng bắt đầu năm tài chính của hệ thống. " +
      "Khoảng thời gian (`time.range`): preset (today, this_week, last_week, this_month, last_month, this_quarter, last_quarter, this_year, last_year, last_n_days + n), kỳ cụ thể (period), khoảng ngày (between) hoặc `{kind:\"last_n_months\", n}`. " +
      "Số được tính trong phạm vi dữ liệu của người gọi. Bảng ghép: mỗi dòng của bảng chính được ghép với đúng một giá trị gom của bảng kia nên không bao giờ đếm đôi; 0 dòng ghép được thì báo lỗi `join_no_match` kèm cách sửa. " +
      "Trả `diagnostics.joins` (số dòng ghép được, không khớp, khoá trùng) và `diagnostics.range` (ngày thật của khoảng thời gian). `truncated` = true khi nhiều nhóm hơn `limit`. " +
      "Chỉ số phái sinh: `metric` có `formula` (ví dụ `=[Doanh thu] / [Số deal]`, `[Tên chỉ số]` là chỉ số đã lưu cùng datahub) thay cho `source`/`measure`; cần `datahub_id` khi gửi tại chỗ. " +
      "`compare` (previous_period | year_ago) thêm `previous`, `change`, `change_pct` cho mỗi dòng. `cumulative=true` cộng dồn theo thời gian (count, sum; cần time.field và time.bucket). " +
      "`target` thêm `target`, `achieved`, `gap` (hằng số hoặc bảng mục tiêu). `outliers` loại hoặc tách giá trị ngoài khoảng IQR (`diagnostics.outliers` cho biên). Chỉ số có `cohort` trả thêm `cohort_sizes`. " +
      "Chịu tải: kết quả được cache theo câu truy vấn + phạm vi dữ liệu của người gọi cho đến khi dữ liệu nguồn đổi (lời gọi trùng đang chạy được gộp, `ms` = 0 khi lấy từ cache); mỗi người tối đa 6 câu chạy cùng lúc; mỗi câu tối đa 10 giây, quá thì lỗi `validation_error` với `details.reason = \"query_too_heavy\"` kèm gợi ý thu hẹp khoảng thời gian hoặc bộ lọc.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({
      metric_id: Id.optional(),
      metric: jsonParam(MetricDefSchema).describe("JSON chỉ số tại chỗ (thay cho metric_id)."),
      datahub_id: Id.optional().describe("Cần khi gọi bảng hoặc nguồn bằng tên."),
      time: jsonParam(TimeSpecSchema),
      group_by: jsonParam(z.array(GroupSchema).max(3)),
      filter: filterParam,
      order: z.enum(["group", "value_desc", "value_asc"]).optional(),
      limit: z.coerce.number().int().min(1).max(MAX_GROUPS).optional(),
      compare: z.enum([...COMPARES, "none"]).optional().describe("So với kỳ trước (previous_period) hoặc cùng kỳ năm trước (year_ago); `none` tắt phép so sánh đã lưu trong chỉ số. Cần time.range."),
      cumulative: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")).describe("Cộng dồn theo thời gian (chỉ count và sum; cần time.bucket)."),
      target: jsonParam(TargetSchema).describe("Mục tiêu: {value} hằng số, hoặc {table, value_field, period_field?, by?} lấy từ bảng mục tiêu."),
      outliers: jsonParam(OutliersSchema).describe("Giá trị ngoại lai theo IQR: {mode: include|exclude|separate, k?}."),
      top: z.coerce.number().int().min(2).max(50).optional().describe("Giữ N nhóm lớn nhất (theo giá trị) và gộp phần còn lại thành một dòng \"Khác\" (`other: true`) mà phép tổng hợp được tính lại trên các dòng còn lại (đúng cho mọi phép: sum, avg, median, count_distinct...). Đúng một cột nhóm. `other_groups` = số nhóm đã gộp."),
      totals: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")).describe("Thêm `totals` cho bảng có cột nhóm: `by_first` (mỗi nhóm thứ nhất), `by_rest` (mỗi tổ hợp các nhóm còn lại), `grand` (tất cả), mỗi giá trị tính bằng chính phép tổng hợp trên các dòng tương ứng, không cộng kết quả nhóm."),
    }),
    http: { method: "GET", path: "/metric-query" },
    handler: async (ctx, i) => {
      if (!!i.metric_id === !!i.metric) throw new AppError("validation_error", "Truyền đúng một trong `metric_id` hoặc `metric`.", { reason: "metric_required" });
      const ov = parseJson(
        QueryOverridesSchema,
        { time: i.time, group_by: i.group_by, filter: i.filter, order: i.order, limit: i.limit, compare: i.compare === "none" ? null : i.compare, cumulative: i.cumulative, target: i.target, outliers: i.outliers, top: i.top, totals: i.totals },
        "Tham số truy vấn",
      );
      let def: MetricDef;
      let dh = i.datahub_id;
      let name = i.metric?.name ?? null;
      if (i.metric_id) {
        const row = await loadRow(ctx, "metric", i.metric_id, "view");
        def = parseJson(MetricDefSchema, row.config, "Chỉ số đã lưu");
        dh = row.datahub_id as string;
        name = row.name as string;
      } else {
        def = i.metric!;
      }
      const a = await runDefinition(ctx, def, ov, dh ? { datahubId: dh } : {});
      return { metric: { id: i.metric_id ?? null, name, agg: def.measure?.agg ?? null, field: def.measure?.field ?? null, formula: def.formula ?? null, format: def.format ?? null }, ...a };
    },
  }),

  defineQuery({
    name: "metrics.metric.list",
    summary: "Danh sách chỉ số đã lưu của một datahub.",
    description: "Người được chia sẻ chỉ thấy các chỉ số chỉ đọc những bảng họ được xem.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    list: true,
    input: z.object({ datahub_id: Id }),
    output: MetricOut,
    http: { method: "GET", path: "/datahubs/:datahub_id/metrics" },
    handler: async (ctx, i) => ({ items: await listRows(ctx, "metric", i.datahub_id), nextCursor: null }),
  }),

  defineQuery({
    name: "metrics.metric.get",
    summary: "Xem một chỉ số đã lưu (JSON).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ metric_id: Id }),
    output: MetricOut,
    http: { method: "GET", path: "/metrics/:metric_id" },
    handler: async (ctx, i) => out(await loadRow(ctx, "metric", i.metric_id, "view")),
  }),

  defineCommand({
    name: "metrics.metric.create",
    summary: "Lưu một chỉ số (JSON). Chỉ chủ datahub.",
    description:
      "`metric` = {name, source, measure:{agg, field?, p?, trim?}, filter?, time?:{field, bucket?, range?}, group_by?, format?}. `source` là tên hoặc mã của một nguồn đã lưu, của một bảng, hoặc một nguồn viết tại chỗ {table, joins}. " +
      "Server kiểm tra mọi cột, lựa chọn và phép ghép; sai thì trả lỗi `validation_error` kèm `details.reason` và danh sách cột có thể dùng để tự sửa. Tên chỉ số không trùng trong datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ datahub_id: Id, metric: MetricDefSchema }),
    output: MetricOut,
    http: { method: "POST", path: "/datahubs/:datahub_id/metrics", status: 201 },
    handler: async (ctx, i) => {
      await loadDatahubAccess(ctx, i.datahub_id, "owner");
      const rs = await checkMetric(ctx, i.datahub_id, i.metric);
      const id = newId();
      const me = ctx.actor.userId;
      try {
        await ctx.db.execute(sql`INSERT INTO mt_metrics (id, datahub_id, name, config, table_ids, created_by, updated_by)
          VALUES (${id}::uuid, ${i.datahub_id}::uuid, ${i.metric.name}, ${JSON.stringify(i.metric)}::jsonb, ${`{${rs.tableIds.join(",")}}`}::uuid[], ${me}::uuid, ${me}::uuid)`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      ctx.audit({ type: "metric", id, details: { datahub_id: i.datahub_id, name: i.metric.name } });
      return out(await loadRow(ctx, "metric", id, "owner"));
    },
  }),

  defineCommand({
    name: "metrics.metric.update",
    summary: "Sửa chỉ số (gửi lại cả JSON mới và `version` đang thấy). Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ metric_id: Id, version: z.number().int().min(1), metric: MetricDefSchema }),
    output: MetricOut,
    http: { method: "PATCH", path: "/metrics/:metric_id" },
    handler: async (ctx, i) => {
      const row = await loadRow(ctx, "metric", i.metric_id, "owner");
      const rs = await checkMetric(ctx, row.datahub_id as string, i.metric);
      let n;
      try {
        n = await ctx.db.execute(sql`UPDATE mt_metrics SET name = ${i.metric.name}, config = ${JSON.stringify(i.metric)}::jsonb, table_ids = ${`{${rs.tableIds.join(",")}}`}::uuid[],
          version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid
          WHERE /*scope*/ id = ${i.metric_id}::uuid AND version = ${i.version} AND deleted_at IS NULL RETURNING id`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      if (!n.rows.length) throw new AppError("conflict");
      ctx.audit({ type: "metric", id: i.metric_id, details: { datahub_id: row.datahub_id, name: i.metric.name } });
      return out(await loadRow(ctx, "metric", i.metric_id, "owner"));
    },
  }),

  defineCommand({
    name: "metrics.metric.delete",
    summary: "Xoá chỉ số (xoá mềm). Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ metric_id: Id }),
    output: z.object({ id: Id }),
    http: { method: "DELETE", path: "/metrics/:metric_id" },
    handler: async (ctx, i) => {
      const row = await loadRow(ctx, "metric", i.metric_id, "owner");
      await ctx.db.execute(sql`UPDATE mt_metrics SET deleted_at = now(), deleted_by = ${ctx.actor.userId}::uuid, version = version + 1 WHERE /*scope*/ id = ${i.metric_id}::uuid`);
      ctx.audit({ type: "metric", id: i.metric_id, details: { datahub_id: row.datahub_id, name: row.name } });
      return { id: i.metric_id };
    },
  }),

  defineQuery({
    name: "metrics.source.list",
    summary: "Danh sách nguồn dữ liệu đã lưu của một datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    list: true,
    input: z.object({ datahub_id: Id }),
    output: SourceOut,
    http: { method: "GET", path: "/datahubs/:datahub_id/metric-sources" },
    handler: async (ctx, i) => ({ items: await listRows(ctx, "source", i.datahub_id), nextCursor: null }),
  }),

  defineQuery({
    name: "metrics.source.get",
    summary: "Xem một nguồn dữ liệu đã lưu (JSON).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ source_id: Id }),
    output: SourceOut,
    http: { method: "GET", path: "/metric-sources/:source_id" },
    handler: async (ctx, i) => out(await loadRow(ctx, "source", i.source_id, "view")),
  }),

  defineCommand({
    name: "metrics.source.create",
    summary: "Lưu một nguồn dữ liệu: một bảng, hoặc một bảng ghép với các bảng khác cùng datahub. Chỉ chủ datahub.",
    description:
      "`source` = {name, table, joins?:[{table, as?, link | on:[{left,right}], collapse?}]}. Ghép theo cột Liên kết (`link`, ưu tiên) hoặc cặp cột khoá (`on`). Mỗi cột của bảng ghép luôn được gom về MỘT giá trị cho mỗi dòng của bảng chính trước khi ghép (mặc định: cộng với cột số, \"có\" với checkbox, nhỏ nhất với cột khác; đổi bằng `collapse`: {\"Tên cột\": sum|avg|min|max|count|first|last}), nên bảng nhiều dòng không làm số liệu bị nhân đôi. " +
      "Dùng trong chỉ số bằng `Tên bảng ghép.Tên cột`.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ datahub_id: Id, source: SourceDefSchema }),
    output: SourceOut,
    http: { method: "POST", path: "/datahubs/:datahub_id/metric-sources", status: 201 },
    handler: async (ctx, i) => {
      await loadDatahubAccess(ctx, i.datahub_id, "owner");
      const rs = await checkSource(ctx, i.datahub_id, i.source);
      const id = newId();
      const me = ctx.actor.userId;
      try {
        await ctx.db.execute(sql`INSERT INTO mt_sources (id, datahub_id, name, config, table_ids, created_by, updated_by)
          VALUES (${id}::uuid, ${i.datahub_id}::uuid, ${i.source.name!}, ${JSON.stringify(i.source)}::jsonb, ${`{${rs.tableIds.join(",")}}`}::uuid[], ${me}::uuid, ${me}::uuid)`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      ctx.audit({ type: "metric_source", id, details: { datahub_id: i.datahub_id, name: i.source.name } });
      return out(await loadRow(ctx, "source", id, "owner"));
    },
  }),

  defineCommand({
    name: "metrics.source.update",
    summary: "Sửa nguồn dữ liệu (gửi lại cả JSON mới và `version`). Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ source_id: Id, version: z.number().int().min(1), source: SourceDefSchema }),
    output: SourceOut,
    http: { method: "PATCH", path: "/metric-sources/:source_id" },
    handler: async (ctx, i) => {
      const row = await loadRow(ctx, "source", i.source_id, "owner");
      const rs = await checkSource(ctx, row.datahub_id as string, i.source);
      let n;
      try {
        n = await ctx.db.execute(sql`UPDATE mt_sources SET name = ${i.source.name!}, config = ${JSON.stringify(i.source)}::jsonb, table_ids = ${`{${rs.tableIds.join(",")}}`}::uuid[],
          version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid
          WHERE /*scope*/ id = ${i.source_id}::uuid AND version = ${i.version} AND deleted_at IS NULL RETURNING id`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      if (!n.rows.length) throw new AppError("conflict");
      ctx.audit({ type: "metric_source", id: i.source_id, details: { datahub_id: row.datahub_id, name: i.source.name } });
      return out(await loadRow(ctx, "source", i.source_id, "owner"));
    },
  }),

  defineCommand({
    name: "metrics.source.delete",
    summary: "Xoá nguồn dữ liệu (xoá mềm). Chỉ chủ datahub.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ source_id: Id }),
    output: z.object({ id: Id }),
    http: { method: "DELETE", path: "/metric-sources/:source_id" },
    handler: async (ctx, i) => {
      const row = await loadRow(ctx, "source", i.source_id, "owner");
      await ctx.db.execute(sql`UPDATE mt_sources SET deleted_at = now(), deleted_by = ${ctx.actor.userId}::uuid, version = version + 1 WHERE /*scope*/ id = ${i.source_id}::uuid`);
      ctx.audit({ type: "metric_source", id: i.source_id, details: { datahub_id: row.datahub_id, name: row.name } });
      return { id: i.source_id };
    },
  }),

  defineQuery({
    name: "metrics.source.diagnose",
    summary: "Chẩn đoán một nguồn dữ liệu: mỗi phép ghép ghép được bao nhiêu dòng, bao nhiêu dòng không khớp, khoá nào trùng.",
    description: "Truyền `source_id` (nguồn đã lưu) hoặc `source` (JSON tại chỗ, bảng gọi bằng tên thì kèm `datahub_id`). Danh sách dòng không khớp: `metrics.source.unmatched`.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ source_id: Id.optional(), source: jsonParam(SourceDefSchema), datahub_id: Id.optional() }),
    http: { method: "GET", path: "/metric-source-diagnosis" },
    handler: async (ctx, i) => {
      if (!!i.source_id === !!i.source) throw new AppError("validation_error", "Truyền đúng một trong `source_id` hoặc `source`.", { reason: "source_required" });
      const rs = await resolveSource(ctx, i.source_id ?? i.source!, i.datahub_id);
      return { base: rs.base.name, joins: await diagnoseJoins(ctx, rs) };
    },
  }),

  defineQuery({
    name: "metrics.source.unmatched",
    summary: "Danh sách các dòng của bảng chính không ghép được trong một phép ghép (mã dòng, số dòng).",
    description: "`join` = thứ tự phép ghép trong nguồn (0 là phép đầu). Đọc nội dung dòng bằng `datahub.row.list` với bộ lọc `_id in [...]`.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({
      source_id: Id.optional(),
      source: jsonParam(SourceDefSchema),
      datahub_id: Id.optional(),
      join: z.coerce.number().int().min(0).max(4).default(0),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    }),
    http: { method: "GET", path: "/metric-source-unmatched" },
    handler: async (ctx, i) => {
      if (!!i.source_id === !!i.source) throw new AppError("validation_error", "Truyền đúng một trong `source_id` hoặc `source`.", { reason: "source_required" });
      const rs = await resolveSource(ctx, i.source_id ?? i.source!, i.datahub_id);
      return unmatchedRows(ctx, rs, i.join, i.limit, i.offset);
    },
  }),
];

