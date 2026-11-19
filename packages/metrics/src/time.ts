import { sql, type SQL } from "drizzle-orm";
import { AppError, resolveTimeRange, type DateRange } from "@soe/shared";
import type { Bucket, CompareKind, Range } from "./schema";

/** First and last day of a range. `today` is a Vietnam-time date; `fiscalStartMonth` is 1 for the calendar year. */
export function resolveRange(range: Range, today: string, fiscalStartMonth: number): DateRange {
  if (range.kind === "last_n_months") {
    const y = Number(today.slice(0, 4));
    const m0 = Number(today.slice(5, 7)) - 1;
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    return { from: iso(Date.UTC(y, m0 - (range.n - 1), 1)), to: iso(Date.UTC(y, m0 + 1, 0)) };
  }
  return resolveTimeRange(range, today, fiscalStartMonth);
}

const TZ = sql.raw("'Asia/Ho_Chi_Minh'");

/** The Vietnam-time day of a `date` or `datetime` value expression. */
export function dayOf(expr: SQL, kind: "date" | "datetime"): SQL {
  return kind === "date" ? expr : sql`((${expr}) AT TIME ZONE ${TZ})::date`;
}

/**
 * First day of the period (day, week from Monday, month, fiscal quarter, fiscal year) that a `date` expression falls in.
 * `startMonth` is the first month of the fiscal year (1 = calendar year); a fiscal year is named by the year it starts in.
 */
export function bucketStart(day: SQL, bucket: Bucket, startMonth: number): SQL {
  const sm = Math.trunc(startMonth);
  const shift = sql.raw(`make_interval(months => ${sm - 1})`);
  switch (bucket) {
    case "day": return day;
    case "week": return sql`date_trunc('week', ${day})::date`;
    case "month": return sql`date_trunc('month', ${day})::date`;
    case "quarter": return sql`(date_trunc('quarter', ${day} - ${shift})::date + ${shift})::date`;
    case "year": return sql`make_date(extract(year FROM ${day})::int - (CASE WHEN extract(month FROM ${day})::int < ${sql.raw(String(sm))} THEN 1 ELSE 0 END), ${sql.raw(String(sm))}, 1)`;
  }
}

/** Readable name of a bucket from its first day (`2026-11-16`): "Q4/2026" for a quarter of the fiscal year, "2026-11" for a month... */
export function bucketLabel(start: string, bucket: Bucket, startMonth: number): string {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7));
  switch (bucket) {
    case "day":
    case "week": return start;
    case "month": return start.slice(0, 7);
    case "quarter": return `Q${Math.floor(((m - startMonth + 12) % 12) / 3) + 1}/${m >= startMonth ? y : y - 1}`;
    case "year": return String(m >= startMonth ? y : y - 1);
  }
}

/** Integer index of the period (day, week from Monday, month, fiscal quarter, fiscal year) a `date` expression falls in; consecutive periods differ by 1. */
export function periodIndex(day: SQL, bucket: Bucket, startMonth: number): SQL {
  const sm = Math.trunc(startMonth);
  const y = sql`extract(year FROM ${day})::int`;
  const m = sql`extract(month FROM ${day})::int`;
  switch (bucket) {
    case "day": return sql`((${day})::date - DATE '1970-01-01')`;
    case "week": return sql`((date_trunc('week', ${day})::date - DATE '1970-01-05') / 7)`;
    case "month": return sql`(${y} * 12 + ${m} - 1)`;
    case "quarter": return sql`floor((${y} * 12 + ${m} - 1 - ${sql.raw(String(sm - 1))}) / 3.0)::int`;
    case "year": return sql`(${y} - (CASE WHEN ${m} < ${sql.raw(String(sm))} THEN 1 ELSE 0 END))`;
  }
}

/**
 * An earlier period to compare with: `from`/`to` are the days to read; `interval` (a Postgres interval text such as `12 months`)
 * moves a day of the earlier period onto the matching day of the current one, so the buckets of both series line up.
 */
export interface Shift {
  from: string;
  to: string;
  interval: string;
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
function addMonths(day: string, n: number): string {
  const y = Number(day.slice(0, 4));
  const m0 = Number(day.slice(5, 7)) - 1;
  const d = Number(day.slice(8, 10));
  const t = Date.UTC(y, m0 + n, 1);
  const last = new Date(Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 0)).getUTCDate();
  return iso(Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), Math.min(d, last)));
}
const dayNumber = (day: string) => Math.round(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000);

/**
 * The earlier period of a range. `year_ago`: the same days one year earlier. `previous_period`: the range just before it; a range
 * of whole months moves back by that many months (this month -> last month, a quarter -> the quarter before), any other range by its
 * length in days.
 */
export function shiftRange(kind: CompareKind, r: DateRange): Shift {
  if (!r.from || !r.to) throw new AppError("validation_error", "So sánh với kỳ khác cần khoảng thời gian có cả ngày bắt đầu và ngày kết thúc.", { reason: "bad_compare" });
  if (kind === "year_ago") return { from: addMonths(r.from, -12), to: addMonths(r.to, -12), interval: "12 months" };
  const lastOfMonth = (d: string) => iso(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0));
  if (r.from.endsWith("-01") && r.to === lastOfMonth(r.to)) {
    const n = (Number(r.to.slice(0, 4)) - Number(r.from.slice(0, 4))) * 12 + Number(r.to.slice(5, 7)) - Number(r.from.slice(5, 7)) + 1;
    return { from: addMonths(r.from, -n), to: lastOfMonth(addMonths(r.to, -n)), interval: `${n} months` };
  }
  const len = dayNumber(r.to) - dayNumber(r.from) + 1;
  return { from: iso((dayNumber(r.from) - len) * 86_400_000), to: iso((dayNumber(r.to) - len) * 86_400_000), interval: `${len} days` };
}
