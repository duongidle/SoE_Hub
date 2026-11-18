/** Date serials, like Excel: days since 1899-12-30 (Vietnam has no daylight saving; time zone +07:00 is fixed). */

const MS_DAY = 86_400_000;
/** Serial of 1970-01-01. */
const UNIX_EPOCH_SERIAL = 25_569;
export const VN_OFFSET_MS = 7 * 3_600_000;

export function ymdToSerial(y: number, m: number, d: number): number {
  // Date.UTC normalises overflowing months and days, which is what DATE() needs.
  return Date.UTC(y, m - 1, d) / MS_DAY + UNIX_EPOCH_SERIAL;
}

export function serialToYmd(serial: number): { y: number; m: number; d: number } {
  const dt = new Date(Math.floor(serial) * MS_DAY - UNIX_EPOCH_SERIAL * MS_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Day of week of a serial: 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(serial: number): number {
  return (((Math.floor(serial) - 1) % 7) + 7) % 7;
}

export function isoToSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const s = ymdToSerial(y, mo, d);
  const back = serialToYmd(s);
  return back.y === y && back.m === mo && back.d === d ? s : null;
}

export function serialToIso(serial: number): string {
  const { y, m, d } = serialToYmd(serial);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** An instant (UTC milliseconds) to a Vietnam-time serial with a time-of-day fraction. */
export function instantToSerial(ms: number): number {
  return (ms + VN_OFFSET_MS) / MS_DAY + UNIX_EPOCH_SERIAL;
}

export function serialToInstant(serial: number): number {
  return Math.round((serial - UNIX_EPOCH_SERIAL) * MS_DAY) - VN_OFFSET_MS;
}

/** Today in Vietnam as an integer serial. */
export function todaySerial(now: Date): number {
  return Math.floor(instantToSerial(now.getTime()));
}

/** Datetime stored as ISO text (UTC) to a serial in Vietnam time, or null when unreadable. */
export function isoDateTimeToSerial(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : instantToSerial(ms);
}

export function serialToIsoDateTime(serial: number): string {
  return new Date(serialToInstant(serial)).toISOString();
}

/** `dd/mm/yyyy`, `dd-mm-yyyy` or `yyyy-mm-dd` to a serial. */
export function parseDateText(text: string): number | null {
  const t = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return ymdToSerial(y, mo, d);
}
