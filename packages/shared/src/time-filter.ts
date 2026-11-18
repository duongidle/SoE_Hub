import { z } from "zod";

/**
 * Time filter of a table (design module2 section 5.4): "which of these date columns falls in this period".
 * The range is stored as the person chose it (a relative preset drifts with the calendar, a specific period stays);
 * the server turns it into dates in Vietnam time, Monday-first weeks and fiscal quarters. The web never computes a range.
 */

export const TIME_PRESETS = ["today", "this_week", "last_week", "this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year", "last_n_days"] as const;
export type TimePreset = (typeof TIME_PRESETS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải có dạng YYYY-MM-DD.").refine((s) => !Number.isNaN(Date.parse(s)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "Ngày không tồn tại.");

export const TimeRangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("preset"), preset: z.enum(TIME_PRESETS), n: z.number().int().min(1).max(3660).optional() }),
  z.strictObject({ kind: z.literal("period"), unit: z.enum(["month", "quarter", "year"]), year: z.number().int().min(1900).max(2200), index: z.number().int().min(1).max(12).optional() }),
  z.strictObject({ kind: z.literal("between"), from: isoDate.nullable().optional(), to: isoDate.nullable().optional() }),
]);
export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const TimeFilterSchema = z.strictObject({
  /** Date columns (key, name, or `_created_at` / `_updated_at`). A row matches when ANY of them falls in the range. */
  columns: z.array(z.string().min(1).max(100)).min(1).max(10),
  range: TimeRangeSchema,
});
export type TimeFilter = z.infer<typeof TimeFilterSchema>;

export interface DateRange {
  /** First day, inclusive (null = open). */
  from: string | null;
  /** Last day, inclusive (null = open). */
  to: string | null;
}

/** Days are handled as UTC midnights of `YYYY-MM-DD` strings, so no local timezone leaks into the arithmetic. */
const ms = (s: string): number => Date.parse(`${s}T00:00:00Z`);
const fmt = (t: number): string => new Date(t).toISOString().slice(0, 10);
const DAY = 86_400_000;
const addDays = (s: string, n: number): string => fmt(ms(s) + n * DAY);
const ymd = (y: number, m0: number, d = 1): string => fmt(Date.UTC(y, m0, d)); // m0: 0-based, may overflow into other years

/** The `YYYY-MM-DD` of an instant in Vietnam time. */
export function businessDate(now: Date, timeZone = "Asia/Ho_Chi_Minh"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** First month (1-12) of the fiscal year that `date` falls in, as its start year. */
function fiscalYearStart(date: string, startMonth: number): { year: number } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return { year: m >= startMonth ? y : y - 1 };
}

/** The range of days a time range covers. `today` is a Vietnam-time date; `fiscalStartMonth` is 1 for the calendar year. */
export function resolveTimeRange(range: TimeRange, today: string, fiscalStartMonth = 1): DateRange {
  const sm0 = fiscalStartMonth - 1;
  const month = Number(today.slice(5, 7)) - 1;
  const year = Number(today.slice(0, 4));
  const monthRange = (y: number, m0: number): DateRange => ({ from: ymd(y, m0), to: addDays(ymd(y, m0 + 1), -1) });
  /** Fiscal quarter that starts at (year of fiscal start, quarter index 0-3). */
  const quarterRange = (fy: number, q0: number): DateRange => ({ from: ymd(fy, sm0 + q0 * 3), to: addDays(ymd(fy, sm0 + q0 * 3 + 3), -1) });
  const yearRange = (fy: number): DateRange => ({ from: ymd(fy, sm0), to: addDays(ymd(fy, sm0 + 12), -1) });
  const currentQuarter = (): { fy: number; q0: number } => {
    const fy = fiscalYearStart(today, fiscalStartMonth).year;
    const monthsIn = (year - fy) * 12 + month - sm0;
    return { fy, q0: Math.floor(monthsIn / 3) };
  };

  if (range.kind === "between") return { from: range.from ?? null, to: range.to ?? null };
  if (range.kind === "period") {
    const i = range.index ?? 1;
    if (range.unit === "month") return monthRange(range.year, i - 1);
    if (range.unit === "quarter") return quarterRange(range.year, Math.min(Math.max(i, 1), 4) - 1);
    return yearRange(range.year);
  }
  switch (range.preset) {
    case "today":
      return { from: today, to: today };
    case "this_week":
    case "last_week": {
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
      const monday = addDays(today, -dow - (range.preset === "last_week" ? 7 : 0));
      return { from: monday, to: addDays(monday, 6) };
    }
    case "this_month":
      return monthRange(year, month);
    case "last_month":
      return monthRange(year, month - 1);
    case "this_quarter":
    case "last_quarter": {
      const { fy, q0 } = currentQuarter();
      return quarterRange(fy, q0 - (range.preset === "last_quarter" ? 1 : 0));
    }
    case "this_year":
      return yearRange(fiscalYearStart(today, fiscalStartMonth).year);
    case "last_year":
      return yearRange(fiscalYearStart(today, fiscalStartMonth).year - 1);
    case "last_n_days":
      return { from: addDays(today, -((range.n ?? 1) - 1)), to: today };
  }
}

/** Where `today` falls: calendar month and year, and the fiscal year (named by the year it starts in) and fiscal quarter 1-4. */
export function currentPeriods(today: string, fiscalStartMonth = 1): { year: number; month: number; fiscalYear: number; fiscalQuarter: number } {
  const fy = fiscalYearStart(today, fiscalStartMonth).year;
  const month = Number(today.slice(5, 7));
  const monthsIn = (Number(today.slice(0, 4)) - fy) * 12 + month - fiscalStartMonth;
  return { year: Number(today.slice(0, 4)), month, fiscalYear: fy, fiscalQuarter: Math.floor(monthsIn / 3) + 1 };
}

/** The instant of midnight of a Vietnam-time day (UTC+7, no daylight saving). */
export const businessMidnight = (date: string): string => new Date(`${date}T00:00:00+07:00`).toISOString();

export const TIME_PRESET_LABELS: Record<TimePreset, string> = {
  today: "Hôm nay",
  this_week: "Tuần này",
  last_week: "Tuần trước",
  this_month: "Tháng này",
  last_month: "Tháng trước",
  this_quarter: "Quý này",
  last_quarter: "Quý trước",
  this_year: "Năm nay",
  last_year: "Năm trước",
  last_n_days: "N ngày qua",
};
