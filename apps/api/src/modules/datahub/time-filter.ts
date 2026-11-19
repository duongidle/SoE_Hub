import { AppError, businessDate, currentPeriods, dateRangeNode, resolveTimeRange, TimeFilterSchema, type FilterNode, type TimeFilter, type TimeRange } from "@soe/shared";
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
