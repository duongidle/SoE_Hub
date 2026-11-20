import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { isAppError } from "@soe/shared";
import { MeasureSchema, MetricDefSchema, bucketLabel, buildMetricQuery, resolveRange, type MTable, type PlanInput } from "../src";

/** Pure tests of the metric planner: no database. The numbers themselves are checked against Postgres in apps/api/test/metrics-*.test.ts. */
const table: MTable = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Deals",
  scope: (a) => sql`/*scope*/ ${sql.raw(a)}.table_id = '11111111-1111-4111-8111-111111111111'::uuid`,
  columns: [
    { key: "c_money", name: "Tiền", kind: "number" },
    { key: "c_kind", name: "Loại", kind: "enum", options: [{ id: "o1", name: "POD" }] },
    { key: "c_day", name: "Ngày", kind: "date" },
    { key: "c_ts", name: "Giờ", kind: "datetime" },
    { key: "c_name", name: "Tên", kind: "text" },
    { key: "c_tags", name: "Nhãn", kind: "set" },
  ],
};
const plan = (o: Partial<PlanInput>): PlanInput => ({ base: table, joins: [], measure: { agg: "count" }, limit: 100, fiscalStartMonth: 1, today: "2026-11-19", ...o });
const text = (o: Partial<PlanInput>) => new PgDialect().sqlToQuery(buildMetricQuery(plan(o)).sql);
const reason = (o: Partial<PlanInput>): unknown => {
  try {
    buildMetricQuery(plan(o));
  } catch (e) {
    if (isAppError(e)) return (e.details as { reason?: string } | undefined)?.reason;
    throw e;
  }
  return "no error";
};

describe("JSON of a metric", () => {
  it("accepts p90 as a short form and refuses what does not fit", () => {
    expect(MeasureSchema.parse({ agg: "p90", field: "x" })).toEqual({ agg: "percentile", p: 90, field: "x" });
    expect(MeasureSchema.safeParse({ agg: "sum" }).success).toBe(false);
    expect(MeasureSchema.safeParse({ agg: "percentile", field: "x" }).success).toBe(false);
    expect(MeasureSchema.safeParse({ agg: "sum", field: "x", trim: 0.1 }).success).toBe(false);
    expect(MeasureSchema.safeParse({ agg: "trimmed_mean", field: "x", trim: 0.6 }).success).toBe(false);
    expect(MetricDefSchema.safeParse({ name: "a[b]", source: "t", measure: { agg: "count" } }).success).toBe(false);
    expect(MetricDefSchema.safeParse({ name: "a", source: "t", measure: { agg: "count" }, formula: "=1" }).success).toBe(false);
    expect(MetricDefSchema.parse({ name: "a", source: "t", measure: { agg: "count" }, time: { field: "d", range: "this_month" }, group_by: ["x", { field: "d", bucket: "week" }] }).time?.range).toEqual({ kind: "preset", preset: "this_month" });
  });
});

describe("planner", () => {
  it("makes one grouped statement with the scope marker, deleted rows excluded, and bound values", () => {
    const q = text({ measure: { agg: "sum", field: "Tiền" }, time: { field: "Ngày", bucket: "month" }, group_by: [{ field: "Loại" }], filter: { field: "Loại", op: "eq", value: "pod" } });
    expect(q.sql.match(/\bGROUP BY\b/g)).toHaveLength(1);
    expect(q.sql).toContain("/*scope*/");
    expect(q.sql).toContain("b.deleted_at IS NULL");
    expect(q.sql).toContain("GROUP BY 1, 2");
    expect(q.params).toContain("o1"); // the option name became its id, as a bind parameter
    expect(q.params).not.toContain("pod");
  });
  it("never writes a value into the SQL text", () => {
    const q = text({ measure: { agg: "count" }, filter: { field: "Tên", op: "contains", value: "'; DROP TABLE dh_rows; --" } });
    expect(q.sql).not.toContain("DROP");
    expect(q.params.some((p) => String(p).includes("DROP"))).toBe(true);
  });
  it("trimmed mean uses window functions in one statement", () => {
    const q = text({ measure: { agg: "trimmed_mean", field: "Tiền", trim: 0.2 }, group_by: [{ field: "Loại" }] });
    expect(q.sql).toContain("row_number() OVER");
    expect(q.sql).toContain("floor(0.2 * nn)");
  });
  it.each([
    ["sum on text", { measure: { agg: "sum" as const, field: "Tên" } }, "bad_measure"],
    ["median on a date", { measure: { agg: "median" as const, field: "Ngày" } }, "bad_measure"],
    ["count_distinct on a set", { measure: { agg: "count_distinct" as const, field: "Nhãn" } }, "bad_measure"],
    ["unknown column", { measure: { agg: "sum" as const, field: "Không có" } }, "unknown_column"],
    ["group by a set", { group_by: [{ field: "Nhãn" }] }, "bad_group"],
    ["bucket on a number", { group_by: [{ field: "Tiền", bucket: "day" as const }] }, "bad_group"],
    ["range without a field", { time: { range: { kind: "preset" as const, preset: "this_month" as const } } }, "bad_time"],
    ["time on text", { time: { field: "Tên", bucket: "day" as const } }, "bad_time"],
    ["unknown option in a filter", { filter: { field: "Loại", op: "eq" as const, value: "XYZ" } }, "unknown_option"],
    ["join to a missing column", { joins: [{ alias: "X", table, on: [{ left: "Không", right: "Tên" }] }] }, "bad_join"],
    ["duplicate join alias", { joins: [{ alias: "X", table, on: [{ left: "Tên", right: "Tên" }] }, { alias: "x", table, on: [{ left: "Tên", right: "Tên" }] }] }, "bad_join"],
  ])("refuses %s with a reason", (_n, o, r) => {
    expect(reason(o as Partial<PlanInput>)).toBe(r);
  });
  it("an inverted between range is refused", () => {
    expect(reason({ time: { field: "Ngày", range: { kind: "between", from: "2026-12-01", to: "2026-01-01" } } })).toBe("bad_time");
  });
});

describe("periods", () => {
  it("relative ranges", () => {
    expect(resolveRange({ kind: "last_n_months", n: 1 }, "2026-02-10", 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolveRange({ kind: "last_n_months", n: 14 }, "2026-02-10", 1)).toEqual({ from: "2025-01-01", to: "2026-02-28" });
    expect(resolveRange({ kind: "preset", preset: "this_week" }, "2026-11-15", 1)).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(resolveRange({ kind: "preset", preset: "this_quarter" }, "2026-02-10", 4)).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });
  it("labels", () => {
    expect(bucketLabel("2026-10-01", "quarter", 1)).toBe("Q4/2026");
    expect(bucketLabel("2026-01-01", "quarter", 4)).toBe("Q4/2025");
    expect(bucketLabel("2026-04-01", "quarter", 4)).toBe("Q1/2026");
    expect(bucketLabel("2026-11-01", "month", 1)).toBe("2026-11");
    expect(bucketLabel("2025-04-01", "year", 4)).toBe("2025");
  });
});

describe("reading a column through its source", () => {
  it("uses the read expression the API gives the column instead of data->>key", () => {
    const t: MTable = { ...table, columns: [{ key: "c_money", name: "Tiền", kind: "number", read: (data, as) => sql.raw(`personal_value(${data}, 'c_money', '${as}')`) }] };
    const q = new PgDialect().sqlToQuery(buildMetricQuery(plan({ base: t, measure: { agg: "sum", field: "Tiền" } })).sql);
    expect(q.sql).toContain("personal_value(b.data, 'c_money', 'text')");
    expect(q.sql).not.toContain("b.data->>'c_money'");
  });
});

describe("key join statement (3A-2 section 6: speed)", () => {
  const other: MTable = { ...table, id: "22222222-2222-4222-8222-222222222222", name: "Thanh toán", scope: (a) => sql`/*scope*/ ${sql.raw(a)}.table_id = '22222222-2222-4222-8222-222222222222'::uuid`, columns: [{ key: "p_name", name: "Tên", kind: "text" }, { key: "p_amt", name: "Số tiền", kind: "number" }] };
  const join = { alias: "TT", table: other, on: [{ left: "Tên", right: "Tên" }] };
  it("computes the key of a base row once (fenced subquery) and compares keys with the C collation", () => {
    const q = text({ joins: [join], measure: { agg: "sum", field: "TT.Số tiền" } });
    expect(q.sql).toContain("OFFSET 0) b LEFT JOIN");
    expect(q.sql).toContain("AS jk1");
    expect(q.sql).toContain("ON j1.k = b.jk1");
    expect(q.sql).toContain('COLLATE "C"');
    // the scope marker is inside the fence too: no row of another table can come through it
    expect(q.sql.indexOf("/*scope*/")).toBeLessThan(q.sql.indexOf("OFFSET 0"));
  });
  it("the base scope is applied once (inside the fence), so Postgres does not guess one row for a base narrowed by the split lock", () => {
    const q = text({ joins: [join], measure: { agg: "sum", field: "TT.Số tiền" } });
    const base = "table_id = '11111111-1111-4111-8111-111111111111'";
    expect(q.sql.split("/*scope*/").length - 1).toBe(2); // the fenced base and the joined table, nothing outside the fence
    expect(q.sql.slice(q.sql.indexOf("OFFSET 0"))).not.toContain(base);
  });
  it("a base narrowed by the split lock folds only the keys it holds from the joined table; a whole-table base does not", () => {
    const narrow = text({ base: { ...table, narrow: true }, joins: [join], measure: { agg: "sum", field: "TT.Số tiền" } });
    expect(narrow.sql).toMatch(/IS NOT NULL AND .* IN \(SELECT .* FROM dh_rows b WHERE/);
    expect(text({ joins: [join], measure: { agg: "sum", field: "TT.Số tiền" } }).sql).not.toMatch(/ IN \(SELECT/);
  });
  it("a statement without a key join is unchanged (no fence)", () => {
    const q = text({ measure: { agg: "sum", field: "Tiền" } });
    expect(q.sql).not.toContain("OFFSET 0");
    expect(q.sql).toMatch(/FROM dh_rows b\s+WHERE/);
  });
});
