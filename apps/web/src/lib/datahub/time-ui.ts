import { formatDate, TIME_PRESET_LABELS, type TimeFilter, type TimeRange, type TimePreset } from "@soe/shared";
import type { TimeRangeInfo } from "./types";

/** Words and small steps for the time filter. The dates themselves always come from the server (`datahub.time_filter.resolve`). */

export const PERIOD_UNIT_LABELS = { month: "Tháng", quarter: "Quý", year: "Năm" } as const;

/** The name of a range as the person chose it ("Tháng này", "Quý 4/2026", "30 ngày qua", "Từ 01/11/2026 đến 15/11/2026"). */
export function rangeName(range: TimeRange, fiscalStartMonth = 1): string {
  if (range.kind === "preset") return range.preset === "last_n_days" ? `${range.n ?? 1} ngày qua` : TIME_PRESET_LABELS[range.preset as TimePreset];
  if (range.kind === "period") {
    if (range.unit === "month") return `Tháng ${range.index ?? 1}/${range.year}`;
    if (range.unit === "quarter") return `Quý ${range.index ?? 1}/${range.year}${fiscalStartMonth !== 1 ? " (năm tài chính)" : ""}`;
    return `Năm ${range.year}${fiscalStartMonth !== 1 ? " (năm tài chính)" : ""}`;
  }
  if (range.from && range.to) return `Từ ${formatDate(range.from)} đến ${formatDate(range.to)}`;
  if (range.from) return `Từ ${formatDate(range.from)}`;
  if (range.to) return `Đến ${formatDate(range.to)}`;
  return "Mọi ngày";
}

/** "01/11/2026 – 30/11/2026" (the days the range covers), or "" when it is open on both sides. */
export function rangeDates(info: Pick<TimeRangeInfo, "from" | "to"> | undefined): string {
  if (!info || (!info.from && !info.to)) return "";
  return `${info.from ? formatDate(info.from) : "…"} – ${info.to ? formatDate(info.to) : "…"}`;
}

/** One period back or forward (`-1` / `1`): a month goes into the next year after December, a quarter after the 4th. */
export function stepPeriod(range: Extract<TimeRange, { kind: "period" }>, by: 1 | -1): Extract<TimeRange, { kind: "period" }> {
  if (range.unit === "year") return { ...range, year: range.year + by };
  const size = range.unit === "month" ? 12 : 4;
  const zero = (range.index ?? 1) - 1 + by;
  const year = range.year + Math.floor(zero / size);
  return { ...range, year, index: ((zero % size) + size) % size + 1 };
}

/** A specific period that holds today, taken from the server's answer (calendar months, fiscal quarters and years). */
export function currentPeriod(unit: "month" | "quarter" | "year", info: Pick<TimeRangeInfo, "year" | "month" | "fiscal_year" | "fiscal_quarter">): Extract<TimeRange, { kind: "period" }> {
  if (unit === "month") return { kind: "period", unit, year: info.year, index: info.month };
  if (unit === "quarter") return { kind: "period", unit, year: info.fiscal_year, index: info.fiscal_quarter };
  return { kind: "period", unit, year: info.fiscal_year };
}

export const sameTimeFilter = (a: TimeFilter | undefined, b: TimeFilter | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
