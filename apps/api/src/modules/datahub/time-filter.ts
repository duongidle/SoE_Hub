import { sql } from "drizzle-orm";
import { AppError, businessDate, currentPeriods, dateRangeNode, resolveTimeRange, TimeFilterSchema, type DealPeriodRule, type FilterNode, type TimeFilter, type TimeRange } from "@soe/shared";
import type { Executor } from "@soe/db";
import { readSetting } from "../system/settings-catalog";
import { DH_SETTINGS } from "./limits";
import type { TableSchema } from "./table-schema";

/**
 * The time filter of a table (design module2 section 5.4) as a filter tree of Module 0. The one place that turns "Tháng này" or
 * "Quý 3/2026" into dates: Vietnam time, weeks from Monday, quarters from the fiscal start month setting. A row matches when
 * ANY of the chosen date columns falls in the range. A relative range is resolved at the moment of the call, so it drifts with the day.
 */
export async function timeFilterNode(db: Executor, schema: TableSchema, raw: unknown, now: Date = new Date()): Promise<FilterNode> {
  const parsed = TimeFilterSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("invalid_filter", "Bộ lọc thời gian không hợp lệ.", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const tf: TimeFilter = parsed.data;
  const range = resolveTimeRange(tf.range, businessDate(now), await readSetting(db, DH_SETTINGS.fiscalStartMonth));
  if (range.from && range.to && range.from > range.to) throw new AppError("invalid_filter", "Ngày bắt đầu phải trước hoặc cùng ngày kết thúc.");
  if (tf.deal_rule) return dealPeriodNode(db, schema, tf.deal_rule, range);
  const fields = schema.fieldMap();
  const nodes: FilterNode[] = tf.columns.map((ref) => {
    const key = schema.fieldFor(ref);
    const type = fields[key]?.type;
    if (type !== "date" && type !== "datetime") throw new AppError("invalid_filter", `Cột "${ref}" không phải cột ngày nên không lọc theo thời gian được.`, { column: ref });
    return dateRangeNode(ref, type, range);
  });
  return nodes.length === 1 ? nodes[0]! : { or: nodes };
}

/** A range as dates plus where today falls (for the toolbar). Same resolver as the filter, so the label can never disagree with the rows. */
export async function describeRange(db: Executor, range: TimeRange, now: Date = new Date()) {
  const fiscal = await readSetting(db, DH_SETTINGS.fiscalStartMonth);
  const today = businessDate(now);
  const r = resolveTimeRange(range, today, fiscal);
  const cur = currentPeriods(today, fiscal);
  return { from: r.from, to: r.to, today, fiscal_start_month: fiscal, year: cur.year, month: cur.month, fiscal_year: cur.fiscalYear, fiscal_quarter: cur.fiscalQuarter };
}

/** `filter AND time filter`, without making the tree one level deeper when the filter already is an AND. */
export function andFilter(filter: FilterNode | undefined, extra: FilterNode | undefined): FilterNode | undefined {
  if (!filter) return extra;
  if (!extra) return filter;
  if ("and" in filter) return { and: [...filter.and, extra] };
  return { and: [filter, extra] };
}

/** The deal rules of `TimeFilterSchema.deal_rule` as a filter tree, with columns found by ROLE (module4 11a). */
async function dealPeriodNode(db: Executor, schema: TableSchema, rule: DealPeriodRule, range: { from: string | null; to: string | null }): Promise<FilterNode> {
  const col = (role: string) => {
    const c = schema.alive.find((x) => x.role === role);
    if (!c) throw new AppError("invalid_filter", `Bảng chưa có cột giữ vai trò "${role}" nên không lọc theo kỳ của deal được.`, { role });
    return c;
  };
  const status = col("trang_thai");
  const options = (status.config.options as { id: string; meaning?: string }[] | undefined) ?? [];
  const openIds = options.filter((o) => (o.meaning ?? "open") === "open").map((o) => o.id);
  const isOpen: FilterNode = openIds.length ? { field: status.key, op: "in", value: openIds } : { field: status.key, op: "is_empty" };
  const isClosed: FilterNode = openIds.length ? { field: status.key, op: "nin", value: openIds } : { field: status.key, op: "is_not_empty" };
  const within = (role: string, r: { from: string | null; to: string | null } = range) => dateRangeNode(col(role).key, "date", r);
  switch (rule) {
    case "received":
      return within("ngay_bat_dau");
    case "closed":
      return { and: [isClosed, within("ngay_chot")] };
    case "related": {
      const parts: FilterNode[] = [];
      if (range.to) parts.push(within("ngay_bat_dau", { from: null, to: range.to }));
      if (range.from) parts.push({ or: [isOpen, within("ngay_chot", { from: range.from, to: null })] });
      if (!parts.length) parts.push(within("ngay_bat_dau"));
      return parts.length === 1 ? parts[0]! : { and: parts };
    }
    case "expected": {
      const dealIds = await dealsWithDueInstalment(db, schema.tableId, range);
      const dates = within("ngay_du_kien_chot");
      return { and: [isOpen, dealIds.length ? { or: [dates, { field: "_id", op: "in", value: dealIds }] } : dates] };
    }
  }
}

/** Ids of the deals (rows of `dealTableId`) that have an instalment not yet paid and due in the range: the Đợt thanh toán table of the same tree, found by role set. */
async function dealsWithDueInstalment(db: Executor, dealTableId: string, range: { from: string | null; to: string | null }): Promise<string[]> {
  const t = await db.execute(sql`SELECT p.master_table_id AS dots FROM dh_templates d JOIN dh_templates p ON p.manager_id = d.manager_id AND p.scope = 'tree' AND p.role_set = 'payments' AND p.deleted_at IS NULL
    WHERE /*scope:system*/ d.master_table_id = ${dealTableId}::uuid LIMIT 1`);
  const dots = (t.rows[0] as { dots: string | null } | undefined)?.dots;
  if (!dots) return [];
  const keys = await db.execute(sql`SELECT role, key FROM dh_columns WHERE /*scope:system*/ table_id = ${dots}::uuid AND role IN ('deal', 'han', 'ngay_tien_ve') AND deleted_at IS NULL`);
  const k = Object.fromEntries((keys.rows as { role: string; key: string }[]).map((r) => [r.role, r.key]));
  if (!k.deal || !k.han) return [];
  const unpaid = k.ngay_tien_ve ? sql`(data->>${k.ngay_tien_ve} IS NULL OR data->>${k.ngay_tien_ve} = '')` : sql`true`;
  const res = await db.execute(sql`SELECT DISTINCT data->${k.deal}->>0 AS deal FROM dh_rows WHERE /*scope:system*/ table_id = ${dots}::uuid AND deleted_at IS NULL AND ${unpaid}
    AND substr(data->>${k.han}, 1, 10) >= ${range.from ?? "0000-01-01"} AND substr(data->>${k.han}, 1, 10) <= ${range.to ?? "9999-12-31"} LIMIT 20000`);
  return (res.rows as { deal: string | null }[]).flatMap((r) => (r.deal ? [r.deal] : []));
}
