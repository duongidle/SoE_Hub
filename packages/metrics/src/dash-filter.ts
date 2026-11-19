import { z } from "zod";
import { dateRangeNode, type FilterNode } from "@soe/shared";
import { BUCKETS, RangeSchema, type Bucket, type Range } from "./schema";

/**
 * Filters a viewer puts on a whole dashboard (design module3 section 8): the common bar (a date range and conditions on columns) and the
 * cross filters made by clicking a chart. The server turns them into the `soft_filter` / `soft_range` of each chart's queries, so a
 * condition on a column a chart's table does not have is left out for that chart instead of breaking it.
 */
const Ref = z.string().min(1).max(200);
const scalar = z.union([z.string().max(500), z.number(), z.boolean()]);

export const DashConditionSchema = z.strictObject({
  field: Ref,
  op: z.enum(["eq", "neq", "contains", "in"]),
  value: z.union([scalar, z.array(z.union([z.string().max(500), z.number()])).min(1).max(50)]),
});
export type DashCondition = z.output<typeof DashConditionSchema>;

export const DashFiltersSchema = z.strictObject({
  range: RangeSchema.optional(),
  conditions: z.array(DashConditionSchema).max(10).optional(),
});
export type DashFilters = z.output<typeof DashFiltersSchema>;

/** A click on a chart: "this group of this column" (a period when the chart groups by time). */
export const CrossFilterSchema = z.strictObject({
  /** The chart that was clicked: it does not filter itself. */
  chart_id: z.uuid().optional(),
  field: Ref,
  kind: z.enum(["number", "date", "datetime", "text", "enum", "boolean", "uuid", "set"]),
  bucket: z.enum(BUCKETS).optional(),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
});
export type CrossFilter = z.output<typeof CrossFilterSchema>;

export const ViewFiltersSchema = z.strictObject({
  range: RangeSchema.optional(),
  conditions: z.array(DashConditionSchema).max(10).optional(),
  cross: z.array(CrossFilterSchema).max(10).optional(),
});
export type ViewFilters = z.output<typeof ViewFiltersSchema>;

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Last day of the period that starts on `start` (a day, a week from Monday, a month, a quarter, a year). */
export function periodEnd(start: string, bucket: Bucket): string {
  const y = Number(start.slice(0, 4));
  const m0 = Number(start.slice(5, 7)) - 1;
  const d = Number(start.slice(8, 10));
  switch (bucket) {
    case "day": return start;
    case "week": return iso(Date.UTC(y, m0, d + 6));
    case "month": return iso(Date.UTC(y, m0 + 1, 0));
    case "quarter": return iso(Date.UTC(y, m0 + 3, 0));
    case "year": return iso(Date.UTC(y + 1, m0, 0));
  }
}

function crossNode(c: CrossFilter): FilterNode | null {
  if (c.value === null) return { field: c.field, op: "is_empty" };
  if ((c.kind === "date" || c.kind === "datetime") && c.bucket && typeof c.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.value)) {
    return dateRangeNode(c.field, c.kind, { from: c.value, to: periodEnd(c.value, c.bucket) });
  }
  if (c.kind === "set") return null; // a many-valued column has no single value to match
  return { field: c.field, op: "eq", value: c.value };
}

function conditionNode(c: DashCondition): FilterNode {
  return { field: c.field, op: c.op, value: c.value as never };
}

export interface ChartFilterFlags {
  ignore_filters?: boolean;
  ignore_cross?: boolean;
}

/** What one chart's queries get from the dashboard's filters: AND of every condition, and the date range (soft: see `QueryOverrides`). */
export function overridesFromFilters(f: ViewFilters | undefined, chartId: string | undefined, flags: ChartFilterFlags = {}): { soft_filter?: FilterNode; soft_range?: Range } {
  if (!f) return {};
  const nodes: FilterNode[] = [];
  if (!flags.ignore_filters) for (const c of f.conditions ?? []) nodes.push(conditionNode(c));
  if (!flags.ignore_cross) {
    for (const c of f.cross ?? []) {
      if (chartId && c.chart_id === chartId) continue;
      const n = crossNode(c);
      if (n) nodes.push(n);
    }
  }
  return {
    ...(nodes.length ? { soft_filter: nodes.length === 1 ? nodes[0]! : { and: nodes } } : {}),
    ...(!flags.ignore_filters && f.range ? { soft_range: f.range } : {}),
  };
}
