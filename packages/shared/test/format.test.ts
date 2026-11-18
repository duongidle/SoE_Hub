import { describe, expect, it } from "vitest";
import { EMPTY, formatCount, formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent, formatRelative, parseLocaleDate, parseLocaleDateTime, parseLocaleNumber } from "../src/format";

describe("formatNumber", () => {
  it("groups with dots and uses a decimal comma", () => {
    expect(formatNumber(1284)).toBe("1.284");
    expect(formatNumber(12_345_678_900)).toBe("12.345.678.900");
    expect(formatNumber(12.5)).toBe("12,5");
    expect(formatNumber(-1234567.5)).toBe("-1.234.567,5");
    expect(formatNumber(0)).toBe("0");
  });
  it("removes float noise: 0,1 + 0,2 shows 0,3", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0,3");
    expect(formatNumber(1.005 * 3)).toBe("3,015");
  });
  it("fixed decimals round half away from zero and never show -0", () => {
    expect(formatNumber(2.5, { decimals: 0 })).toBe("3");
    expect(formatNumber(-2.5, { decimals: 0 })).toBe("-3");
    expect(formatNumber(1.005, { decimals: 2 })).toBe("1,01");
    expect(formatNumber(-0.001, { decimals: 1 })).toBe("0,0");
    expect(formatNumber(3, { decimals: 2 })).toBe("3,00");
    expect(formatNumber(1234.5, { thousands: false })).toBe("1234,5");
  });
  it("shows a dash for empty values", () => {
    for (const v of [null, undefined, NaN, Infinity]) expect(formatNumber(v as number)).toBe(EMPTY);
  });
});

describe("money, percent, count", () => {
  it("formats VND and percent", () => {
    expect(formatCurrency(1234567)).toBe("1.234.567 ₫");
    expect(formatCurrency(-5000)).toBe("-5.000 ₫");
    expect(formatCurrency(null)).toBe("—");
    expect(formatPercent(0.125)).toBe("12,5%");
    expect(formatPercent(0.07)).toBe("7%");
    expect(formatPercent(0.1 + 0.2, { decimals: 1 })).toBe("30,0%");
  });
  it("counts with the right unit", () => {
    expect(formatCount(0, "dòng")).toBe("0 dòng");
    expect(formatCount(1, "dòng")).toBe("1 dòng");
    expect(formatCount(1284, "dòng")).toBe("1.284 dòng");
  });
});

describe("dates", () => {
  it("shows a date-only string as written", () => {
    expect(formatDate("2026-11-18")).toBe("18/11/2026");
  });
  it("shows timestamps in Vietnam time, also around midnight", () => {
    expect(formatDateTime("2026-11-18T17:30:00Z")).toBe("19/11/2026 00:30");
    expect(formatDate("2026-11-18T16:59:00Z")).toBe("18/11/2026");
    expect(formatDate("2026-11-18T17:00:00Z")).toBe("19/11/2026");
  });
  it("reads the Postgres text form of a timestamp", () => {
    expect(formatDateTime("2026-11-19 05:14:52.697576+07")).toBe("19/11/2026 05:14");
    expect(formatDateTime("2026-11-18 22:14:52+00")).toBe("19/11/2026 05:14");
  });
  it("uses a dash for empty or invalid", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime("abc")).toBe("—");
  });
  it("relative time only inside 7 days", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    expect(formatRelative("2026-11-19T09:55:00Z", now)).toBe("5 phút trước");
    expect(formatRelative("2026-11-19T07:00:00Z", now)).toBe("3 giờ trước");
    expect(formatRelative("2026-11-16T10:00:00Z", now)).toBe("3 ngày trước");
    expect(formatRelative("2026-11-01T10:00:00Z", now)).toBe("01/11/2026 17:00");
    expect(formatRelative("2026-12-01T10:00:00Z", now)).toBe("01/12/2026 17:00");
  });
});

describe("reading typed or pasted text", () => {
  it("numbers", () => {
    expect(parseLocaleNumber("156,000,000")).toBe(156_000_000);
    expect(parseLocaleNumber("156.000.000")).toBe(156_000_000);
    expect(parseLocaleNumber("1.234.567,5")).toBe(1234567.5);
    expect(parseLocaleNumber("1,5")).toBe(1.5);
    expect(parseLocaleNumber("12.5")).toBe(12.5);
    expect(parseLocaleNumber("-3")).toBe(-3);
    expect(parseLocaleNumber(" 1 000 ")).toBe(1000);
    expect(parseLocaleNumber("156.000.000 ₫")).toBe(156_000_000);
    expect(parseLocaleNumber("abc")).toBeNull();
    expect(parseLocaleNumber("")).toBeNull();
  });
  it("dates", () => {
    expect(parseLocaleDate("18/11/2026")).toBe("2026-11-18");
    expect(parseLocaleDate("1/2/2026")).toBe("2026-02-01");
    expect(parseLocaleDate("2026-11-18")).toBe("2026-11-18");
    expect(parseLocaleDate("31/02/2026")).toBeNull();
    expect(parseLocaleDate("18/11")).toBeNull();
  });
  it("date and time", () => {
    expect(parseLocaleDateTime("18/11/2026 09:30")).toBe("2026-11-18T02:30:00.000Z");
    expect(parseLocaleDateTime("18/11/2026")).toBe("2026-11-17T17:00:00.000Z");
    expect(parseLocaleDateTime("18/11/2026 25:00")).toBeNull();
  });
});
