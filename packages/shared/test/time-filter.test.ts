import { describe, expect, it } from "vitest";
import { businessDate, resolveTimeRange, TimeFilterSchema, type TimeRange } from "../src/time-filter";

const r = (range: TimeRange, today: string, fy = 1) => resolveTimeRange(range, today, fy);
const preset = (p: Extract<TimeRange, { kind: "preset" }>["preset"], n?: number): TimeRange => ({ kind: "preset", preset: p, ...(n ? { n } : {}) });

describe("resolveTimeRange (Vietnam dates, Monday weeks, fiscal quarters)", () => {
  // 2026-11-19 is a Thursday.
  const today = "2026-11-19";
  it("day and week ranges", () => {
    expect(r(preset("today"), today)).toEqual({ from: "2026-11-19", to: "2026-11-19" });
    expect(r(preset("this_week"), today)).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(r(preset("last_week"), today)).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    // On a Monday the week starts that very day; on a Sunday it started six days before.
    expect(r(preset("this_week"), "2026-11-16").from).toBe("2026-11-16");
    expect(r(preset("this_week"), "2026-11-22").from).toBe("2026-11-16");
    expect(r(preset("last_n_days", 7), today)).toEqual({ from: "2026-11-13", to: "2026-11-19" });
    expect(r(preset("last_n_days", 1), today)).toEqual({ from: today, to: today });
  });
  it("months, with year boundaries and leap February", () => {
    expect(r(preset("this_month"), today)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(r(preset("last_month"), "2027-01-05")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(r(preset("this_month"), "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(r({ kind: "period", unit: "month", year: 2026, index: 2 }, today)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("calendar quarters and years by default", () => {
    expect(r(preset("this_quarter"), today)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(r(preset("last_quarter"), today)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(r(preset("last_quarter"), "2026-02-01")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(r(preset("this_year"), today)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(r(preset("last_year"), today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(r({ kind: "period", unit: "quarter", year: 2026, index: 3 }, today)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(r({ kind: "period", unit: "year", year: 2024 }, today)).toEqual({ from: "2024-01-01", to: "2024-12-31" });
  });
  it("fiscal year starting in April (FY2026 = Apr 2026 - Mar 2027)", () => {
    expect(r(preset("this_quarter"), today, 4)).toEqual({ from: "2026-10-01", to: "2026-12-31" }); // Q3 of FY2026
    expect(r(preset("this_quarter"), "2026-11-19", 5)).toEqual({ from: "2026-11-01", to: "2027-01-31" });
    expect(r(preset("this_quarter"), "2026-02-10", 4)).toEqual({ from: "2026-01-01", to: "2026-03-31" }); // Q4 of FY2025
    expect(r(preset("last_quarter"), "2026-04-02", 4)).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(r(preset("this_year"), "2026-02-10", 4)).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(r(preset("this_year"), today, 4)).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(r(preset("last_year"), today, 4)).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(r({ kind: "period", unit: "quarter", year: 2026, index: 4 }, today, 4)).toEqual({ from: "2027-01-01", to: "2027-03-31" });
    expect(r({ kind: "period", unit: "year", year: 2026 }, today, 4)).toEqual({ from: "2026-04-01", to: "2027-03-31" });
  });
  it("from-to ranges may be open", () => {
    expect(r({ kind: "between", from: "2026-01-05", to: "2026-02-01" }, today)).toEqual({ from: "2026-01-05", to: "2026-02-01" });
    expect(r({ kind: "between", from: "2026-01-05" }, today)).toEqual({ from: "2026-01-05", to: null });
  });
  it("businessDate follows Vietnam time at the midnight boundary", () => {
    expect(businessDate(new Date("2026-11-18T16:59:59Z"))).toBe("2026-11-18");
    expect(businessDate(new Date("2026-11-18T17:00:00Z"))).toBe("2026-11-19");
  });
  it("schema rejects impossible dates and unknown keys", () => {
    expect(TimeFilterSchema.safeParse({ columns: ["a"], range: { kind: "between", from: "2026-02-30" } }).success).toBe(false);
    expect(TimeFilterSchema.safeParse({ columns: [], range: { kind: "preset", preset: "today" } }).success).toBe(false);
    expect(TimeFilterSchema.safeParse({ columns: ["a"], range: { kind: "preset", preset: "today" }, x: 1 }).success).toBe(false);
  });
});
