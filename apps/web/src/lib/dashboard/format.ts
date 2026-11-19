import { formatCurrency, formatNumber, formatPercent } from "@soe/shared";
import type { FormatName } from "./types";

/** "1,2 tỷ", "350 tr", "12,5 nghìn". Below a thousand the whole number. Used for axes and cards that ask for it; the tooltip always shows the exact number. */
export function formatCompact(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  const one = (x: number) => formatNumber(Math.round(x * 10) / 10, { decimals: Number.isInteger(Math.round(x * 10) / 10) ? 0 : 1 });
  if (a >= 1e9) return `${sign}${one(a / 1e9)} tỷ`;
  if (a >= 1e6) return `${sign}${one(a / 1e6)} tr`;
  return formatNumber(v);
}

/** One value as the screens show it. `format` is the chart's choice, else the metric's own, else a plain number. */
export function formatValue(v: number | string | null | undefined, format: FormatName | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  switch (format) {
    case "money":
      return formatCurrency(n);
    case "percent":
      return formatPercent(n);
    case "days":
      return `${formatNumber(n)} ngày`;
    case "compact":
      return formatCompact(n);
    default:
      return formatNumber(n);
  }
}
