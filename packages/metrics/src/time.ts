import { sql, type SQL } from "drizzle-orm";
import { resolveTimeRange, type DateRange } from "@soe/shared";
import type { Bucket, Range } from "./schema";

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
