import { AppError, businessDate, businessMidnight, resolveTimeRange, TimeFilterSchema, type FilterCondition, type FilterNode, type TimeFilter } from "@soe/shared";
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
    if (type === "date") {
      if (range.from && range.to) return { field: ref, op: "between", value: [range.from, range.to] };
      if (range.from) return { field: ref, op: "gte", value: range.from };
      if (range.to) return { field: ref, op: "lte", value: range.to };
      return { field: ref, op: "is_not_empty" };
    }
    // A moment belongs to the day it falls on in Vietnam time: [midnight of the first day, midnight after the last day).
    const lo: FilterCondition | null = range.from ? { field: ref, op: "gte", value: businessMidnight(range.from) } : null;
    const hi: FilterCondition | null = range.to ? { field: ref, op: "lt", value: businessMidnight(addDay(range.to)) } : null;
    const parts = [lo, hi].filter((x): x is FilterCondition => !!x);
    return parts.length === 0 ? { field: ref, op: "is_not_empty" } : parts.length === 1 ? parts[0]! : { and: parts };
  });
  return nodes.length === 1 ? nodes[0]! : { or: nodes };
}

function addDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** `filter AND time filter`, without making the tree one level deeper when the filter already is an AND. */
export function andFilter(filter: FilterNode | undefined, extra: FilterNode | undefined): FilterNode | undefined {
  if (!filter) return extra;
  if (!extra) return filter;
  if ("and" in filter) return { and: [...filter.and, extra] };
  return { and: [filter, extra] };
}
