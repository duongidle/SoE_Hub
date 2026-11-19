import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { isAppError } from "@soe/shared";
import {
  MetricDefSchema,
  attachTarget,
  buildCohortSizes,
  buildMetricQuery,
  buildOutlierBounds,
  combineDerived,
  compareTables,
  cumulate,
  iqrBounds,
  parseDerived,
  shiftRange,
  targetKey,
  type MTable,
  type MetricRow,
  type MetricTable,
  type PlanInput,
} from "../src";

const row = (key: string, value: number | null, count = 1, label = key): MetricRow => ({ groups: [{ value: key, label }], value, count });
const table = (rows: MetricRow[]): MetricTable => ({ columns: [{ column: "g", kind: "text" }], value_type: "number", rows, truncated: false });
const reason = (f: () => unknown): unknown => {
  try {
    f();
  } catch (e) {
    if (isAppError(e)) return (e.details as { reason?: string } | undefined)?.reason;
    throw e;
  }
  return "no error";
};

describe("earlier period of a range", () => {
  it("year_ago moves the same days back one year and the days of the earlier year forward by 12 months", () => {
    expect(shiftRange("year_ago", { from: "2026-02-01", to: "2026-03-31" })).toEqual({ from: "2025-02-01", to: "2025-03-31", interval: "12 months" });
    // 29 February 2024 has no partner in 2023: it lands on the last day of February.
    expect(shiftRange("year_ago", { from: "2024-02-29", to: "2024-02-29" }).from).toBe("2023-02-28");
  });
  it("previous_period of whole months moves back by that many months, of other ranges by their length", () => {
    expect(shiftRange("previous_period", { from: "2026-11-01", to: "2026-11-30" })).toEqual({ from: "2026-10-01", to: "2026-10-31", interval: "1 months" });
    expect(shiftRange("previous_period", { from: "2026-01-01", to: "2026-03-31" })).toEqual({ from: "2025-10-01", to: "2025-12-31", interval: "3 months" });
    expect(shiftRange("previous_period", { from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-02-01", to: "2026-02-28", interval: "1 months" });
    expect(shiftRange("previous_period", { from: "2026-11-10", to: "2026-11-16" })).toEqual({ from: "2026-11-03", to: "2026-11-09", interval: "7 days" });
  });
  it("needs both ends", () => {
    expect(reason(() => shiftRange("year_ago", { from: "2026-01-01", to: null }))).toBe("bad_compare");
  });
});

describe("derived metric", () => {
  it("collects the metric names once and refuses what is not a name", () => {
    expect(parseDerived("=[Won] / ([Won] + [Lost])").names).toEqual(["Won", "Lost"]);
    expect(parseDerived("=[won]+[WON]").names).toEqual(["won"]);
    expect(reason(() => parseDerived("=[Bảng].[Cột]"))).toBe("bad_formula");
    expect(reason(() => parseDerived("=1+2"))).toBe("bad_formula");
    expect(reason(() => parseDerived("=[A] +"))).toBe("bad_formula");
    expect(reason(() => parseDerived("={c_ab12}"))).toBe("bad_formula");
  });
  it("evaluates per group; a group a metric has no row for counts as 0, a zero divisor is an error on that row only", () => {
    const f = parseDerived("=[A] / [B]");
    const t = combineDerived(f, [table([row("x", 10), row("y", 5)]), table([row("x", 4)])], "group", 100, new Date());
    expect(t.rows.map((r) => [r.groups[0]!.value, r.value, r.error])).toEqual([["x", 2.5, undefined], ["y", null, "#DIV/0!"]]);
    const g = combineDerived(parseDerived("=IFERROR([A]/[B],0)"), [table([row("y", 5)]), table([])], "group", 100, new Date());
    expect(g.rows[0]!.value).toBe(0);
  });
  it("sorts by value and cuts at the limit", () => {
    const f = parseDerived("=[A]*1");
    const t = combineDerived(f, [table([row("a", 3), row("b", 9), row("c", 1)])], "value_desc", 2, new Date());
    expect(t.rows.map((r) => r.value)).toEqual([9, 3]);
    expect(t.truncated).toBe(true);
  });
  it("accepts a formula metric and refuses what the schema forbids", () => {
    expect(MetricDefSchema.safeParse({ name: "W", formula: "=[A]/[B]", format: "percent" }).success).toBe(true);
    expect(MetricDefSchema.safeParse({ name: "W", formula: "=[A]", source: "t" }).success).toBe(false);
    expect(MetricDefSchema.safeParse({ name: "W", formula: "=[A]", time: { field: "d" } }).success).toBe(false);
    expect(MetricDefSchema.safeParse({ name: "W", source: "t", measure: { agg: "count" }, cohort: { start: "a", event: "b" }, compare: "year_ago" }).success).toBe(false);
    expect(MetricDefSchema.safeParse({ name: "W" }).success).toBe(false);
  });
});

describe("running total, comparison, target, quartiles", () => {
  const two = (g: string, m: string, v: number): MetricRow => ({ groups: [{ value: m, label: m }, { value: g, label: g }], value: v, count: 1 });
  it("adds up in time order, separately for each other group", () => {
    const t: MetricTable = { ...table([]), rows: [two("b", "2026-02-01", 5), two("a", "2026-02-01", 2), two("a", "2026-01-01", 1), two("b", "2026-01-01", 10)] };
    const c = cumulate(t, 0).rows.map((r) => [r.groups[1]!.value, r.groups[0]!.value, r.value]);
    expect(c).toEqual([["a", "2026-01-01", 1], ["a", "2026-02-01", 3], ["b", "2026-01-01", 10], ["b", "2026-02-01", 15]]);
  });
  it("puts the earlier value next to the current one, and keeps groups that exist only in the earlier period", () => {
    const c = compareTables(table([row("a", 150), row("b", 10)]), table([row("a", 100), row("c", 7), row("b", 0)]));
    expect(c.rows.map((r) => [r.groups[0]!.value, r.value, r.previous, r.change, r.change_pct])).toEqual([
      ["a", 150, 100, 50, 0.5],
      ["b", 10, 0, 10, null],
      ["c", null, 7, null, null],
    ]);
  });
  it("target: share reached and gap, none when the target is missing or zero", () => {
    const t = attachTarget(table([row("a", 85), row("b", 5), row("c", 1)]), (r) => ({ a: 100, b: 0, c: null })[r.groups[0]!.value as string] ?? null);
    expect(t.rows.map((r) => [r.target, r.achieved, r.gap])).toEqual([[100, 0.85, 15], [0, null, -5], [null, null, null]]);
    expect(targetKey([{ value: "2026-02-01", label: "2026-02" }, { value: "x", label: "Đức  Anh" }], 0)).toBe(targetKey([{ value: "2026-02-01", label: "02/2026" }, { value: "y", label: "duc  anh" }], 0));
  });
  it("IQR bounds need at least four values", () => {
    expect(iqrBounds(55, 375, 10)).toEqual({ q1: 55, q3: 375, iqr: 320, k: 1.5, lower: -425, upper: 855, n: 10 });
    expect(iqrBounds(55, 375, 3)).toBeNull();
    expect(iqrBounds(null, null, 0)).toBeNull();
  });
});

describe("SQL of the new options", () => {
  const dialect = new PgDialect();
  const t: MTable = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Deals",
    scope: (a) => sql`/*scope*/ ${sql.raw(a)}.table_id = '11111111-1111-4111-8111-111111111111'::uuid`,
    columns: [
      { key: "c_money", name: "Tiền", kind: "number" },
      { key: "c_day", name: "Ngày chốt", kind: "date" },
      { key: "c_recv", name: "Ngày nhận", kind: "date" },
      { key: "c_name", name: "Tên", kind: "text" },
    ],
  };
  const plan = (o: Partial<PlanInput>): PlanInput => ({ base: t, joins: [], measure: { agg: "count" }, limit: 100, fiscalStartMonth: 1, today: "2026-11-19", ...o });
  it("the earlier period reads the shifted days and moves the bucket forward", () => {
    const q = dialect.sqlToQuery(buildMetricQuery(plan({ measure: { agg: "sum", field: "Tiền" }, time: { field: "Ngày chốt", bucket: "month", range: { kind: "between", from: "2026-02-01", to: "2026-03-31" } }, shift: { from: "2025-12-01", to: "2026-01-31", interval: "2 months" } })).sql);
    expect(q.sql).toContain("interval '2 months'");
    expect(q.params).toContain("2025-12-01");
    expect(q.params).not.toContain("2026-02-01");
  });
  it("cohort groups by the start period and the number of periods to the event", () => {
    const p = plan({ cohort: { start: "Ngày nhận", event: "Ngày chốt", bucket: "month", mature_after: 2, max_offset: 6 } });
    const b = buildMetricQuery(p);
    expect(b.groups.map((g) => g.column)).toEqual(["Ngày nhận", "Kỳ sau Ngày nhận"]);
    const q = dialect.sqlToQuery(b.sql).sql;
    expect(q).toContain("c_recv");
    expect(q).toContain("c_day");
    const sizes = buildCohortSizes(p);
    expect(sizes.groups.map((g) => g.column)).toEqual(["Ngày nhận"]);
    expect(reason(() => buildMetricQuery(plan({ cohort: { start: "Tên", event: "Ngày chốt" } })))).toBe("bad_cohort");
  });
  it("outliers need a number column", () => {
    expect(reason(() => buildOutlierBounds(plan({ measure: { agg: "count" } })))).toBe("bad_outliers");
    expect(reason(() => buildMetricQuery(plan({ measure: { agg: "count" }, outliers: { lower: 0, upper: 1, keep: "inside" } })))).toBe("bad_outliers");
    const q = dialect.sqlToQuery(buildMetricQuery(plan({ measure: { agg: "sum", field: "Tiền" }, outliers: { lower: -425, upper: 855, keep: "inside" } })).sql).sql;
    expect(q).toContain("c_money");
  });
});
