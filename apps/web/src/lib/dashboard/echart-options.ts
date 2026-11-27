import { token, FONT_STACK } from "@/lib/theme";
import { formatPercent } from "@soe/shared";
import { toShares, type Cartesian, type Slices } from "./chart-data";
import { formatCompact, formatValue } from "./format";
import type { ChartDef, FormatName, PickInfo } from "./types";

/** ECharts options for the cartesian and pie charts. Pure apart from reading the design tokens; the numbers are the server's. */

/** Categorical palette: distinguishable by lightness as well as hue (not a red/green pair), readable on the card background. */
export const PALETTE = ["#4f46e5", "#10b981", "#f59e0b", "#3b82f6", "#8b5cf6", "#f43f5e", "#14b8a6", "#94a3b8"];

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const axisFormat = (fmt: FormatName | null): FormatName => (fmt === "percent" || fmt === "days" ? fmt : "compact");

/**
 * A column of a value so small that it is under one pixel high cannot be clicked, so cross filtering would skip it. Giving the series a
 * minimum bar size keeps every column a target. A zero stays flat (no bar is drawn for a real zero), so a series with a zero keeps its
 * natural size. Only the picture changes: the value and the tooltip are the server's.
 */
function hitArea(values: (number | null)[]): Record<string, unknown> {
  return values.some((v) => v === 0) ? {} : { barMinHeight: 4, barMinWidth: 4 };
}

function base() {
  const text = token("--foreground");
  const muted = token("--muted-foreground");
  const line = token("--border");
  return { text, muted, line, textStyle: { fontFamily: FONT_STACK, color: text } };
}

export interface CartesianArgs {
  chart: ChartDef;
  data: Cartesian;
  format: FormatName | null;
  /** Per series (same order as `data.series`): draw the earlier period / the target too. */
  compare: boolean[];
  /** Per series and category: where a click lands (for cross filtering). */
  picks?: (PickInfo | undefined)[][];
  /** Cohort charts of deals: the last day of the last mature month (from `deal.cycle`); the categories after it are drawn pale and called "tạm tính". */
  matureThrough?: string | null;
}

/** Which categories start after the cut-off: the date of each group comes from the server (the group value), nothing is computed from the numbers. */
export function immatureCategories(picks: CartesianArgs["picks"], count: number, through: string | null | undefined): boolean[] {
  if (!through) return [];
  return Array.from({ length: count }, (_, k) => {
    const v = picks?.[0]?.[k]?.groups?.[0]?.value;
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && v.slice(0, 10) > through;
  });
}

export function cartesianOption({ chart, data, format, compare, picks, matureThrough }: CartesianArgs): Record<string, unknown> {
  const t = base();
  const o = chart.options ?? {};
  const horizontal = chart.type === "bar";
  const percent = o.stack === "percent";
  const stackName = o.stack === "stack" || percent ? "total" : undefined;
  const shares = percent ? toShares(data) : null;
  const rightAxis = chart.type === "combo" && data.series.some((s) => s.axis === "right");
  const showLegend = o.legend ?? (data.series.length > 1 || compare.some(Boolean));

  const pale = immatureCategories(picks, data.categories.length, matureThrough);
  const firstPale = pale.indexOf(true);
  const series: Record<string, unknown>[] = [];
  const colors: string[] = [];
  data.series.forEach((s, i) => {
    const color = PALETTE[i % PALETTE.length]!;
    const isLine = chart.type === "line" || chart.type === "area" || (chart.type === "combo" && s.kind === "line");
    const real = (k: number) => s.data[k];
    const values = shares ? shares[i]! : s.data;
    colors.push(color);
    series.push({
      name: s.name,
      type: isLine ? "line" : "bar",
      ...(chart.type === "combo" ? { yAxisIndex: s.axis === "right" ? 1 : 0 } : {}),
      ...(stackName ? { stack: stackName } : {}),
      ...(isLine ? { smooth: !!o.smooth, symbolSize: 6, ...(chart.type === "area" ? { areaStyle: { opacity: 0.25 } } : {}) } : { barMaxWidth: 40, ...hitArea(values) }),
      data: values.map((v, k) => (v === null ? null : { value: v, real: real(k), pick: picks?.[i]?.[k], ...(pale[k] ? { itemStyle: { color, opacity: 0.35 } } : {}) })),
      ...(i === 0 && firstPale >= 0 && !horizontal
        ? { markArea: { silent: true, itemStyle: { color: t.muted, opacity: 0.12 }, label: { show: true, position: "insideTop", color: t.muted, fontSize: 11 }, data: [[{ name: "Tạm tính, chưa chín", xAxis: data.categories[firstPale] }, { xAxis: data.categories[data.categories.length - 1] }]] } }
        : {}),
      itemStyle: { color },
      lineStyle: { color, width: 2 },
      label: { show: !!o.labels, position: horizontal ? "right" : stackName ? "inside" : "top", color: t.text, fontSize: 11, formatter: (p: { data?: { real?: number | null } }) => formatValue(p.data?.real ?? null, format === "percent" ? "percent" : "compact") },
      emphasis: { focus: "series" },
    });
    if (compare[i]) {
      series.push({
        name: `${s.name} (kỳ trước)`,
        type: isLine ? "line" : "bar",
        ...(chart.type === "combo" ? { yAxisIndex: s.axis === "right" ? 1 : 0 } : {}),
        data: s.rows.map((r) => (r && typeof r.previous === "number" ? { value: r.previous, real: r.previous } : null)),
        itemStyle: { color, opacity: 0.45 },
        lineStyle: { color, width: 2, type: "dashed", opacity: 0.7 },
        ...(isLine ? { symbolSize: 4 } : { barMaxWidth: 40 }),
      });
    }
    if (s.rows.some((r) => r && typeof r.target === "number")) {
      series.push({
        name: `${s.name} (mục tiêu)`,
        type: "line",
        ...(chart.type === "combo" ? { yAxisIndex: s.axis === "right" ? 1 : 0 } : {}),
        data: s.rows.map((r) => (r && typeof r.target === "number" ? { value: r.target, real: r.target } : null)),
        itemStyle: { color: t.text },
        lineStyle: { color: t.text, width: 1.5, type: "dotted" },
        symbol: "none",
      });
    }
  });

  const valueAxis = (right: boolean) => ({
    type: o.log && !percent ? "log" : "value",
    ...(percent ? { max: 100 } : {}),
    position: right ? "right" : "left",
    splitLine: { show: !right, lineStyle: { color: t.line } },
    axisLabel: { color: t.muted, formatter: (v: number) => (percent ? `${formatValue(v, "number")}%` : formatValue(v, axisFormat(format))) },
    axisLine: { show: false },
    ...(right ? { alignTicks: true } : {}),
  });
  const categoryAxis = {
    type: "category",
    data: data.categories,
    axisLabel: { color: t.muted, hideOverlap: true, ...(horizontal ? {} : { interval: "auto" }) },
    axisLine: { lineStyle: { color: t.line } },
    axisTick: { show: false },
    ...(horizontal ? { inverse: true } : {}),
  };

  return {
    textStyle: t.textStyle,
    color: colors.length ? [...new Set([...colors, ...PALETTE])] : PALETTE,
    animation: false,
    grid: { left: 8, right: rightAxis ? 8 : 16, top: showLegend ? 36 : 16, bottom: 8, containLabel: true },
    legend: { show: showLegend, top: 0, type: "scroll", textStyle: { color: t.text }, icon: "roundRect" },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: horizontal ? "shadow" : "line" },
      formatter: (params: unknown) => {
        const list = (Array.isArray(params) ? params : [params]) as { axisValueLabel?: string; dataIndex?: number; marker?: string; seriesName?: string; data?: { real?: number | null } | null }[];
        const tentative = pale[list[0]?.dataIndex ?? -1] ? " (tạm tính, chưa chín)" : "";
        const head = `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(String(list[0]?.axisValueLabel ?? "") + tentative)}</div>`;
        return head + list.map((p) => `<div>${p.marker ?? ""} ${escapeHtml(String(p.seriesName ?? ""))}: <b>${escapeHtml(formatValue(p.data?.real ?? null, format === "compact" ? "number" : format))}</b></div>`).join("");
      },
    },
    ...(horizontal ? { xAxis: valueAxis(false), yAxis: categoryAxis } : { xAxis: categoryAxis, yAxis: rightAxis ? [valueAxis(false), valueAxis(true)] : valueAxis(false) }),
    series,
  };
}

export interface PieArgs {
  chart: ChartDef;
  slices: Slices;
  format: FormatName | null;
  picks?: (PickInfo | undefined)[];
}

export function pieOption({ chart, slices, format, picks }: PieArgs): Record<string, unknown> {
  const t = base();
  const donut = chart.type === "donut";
  const o = chart.options ?? {};
  return {
    textStyle: t.textStyle,
    color: PALETTE,
    animation: false,
    legend: { show: o.legend ?? true, bottom: 0, type: "scroll", textStyle: { color: t.text }, icon: "roundRect" },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (p: { marker?: string; name?: string; value?: number; percent?: number }) =>
        `${p.marker ?? ""} ${escapeHtml(String(p.name ?? ""))}: <b>${escapeHtml(formatValue(p.value ?? null, format === "compact" ? "number" : format))}</b> (${escapeHtml(formatPercent((p.percent ?? 0) / 100, { decimals: 1 }))})`,
    },
    series: [
      {
        type: "pie",
        radius: donut ? ["48%", "72%"] : ["0%", "72%"],
        center: ["50%", o.legend === false ? "50%" : "46%"],
        data: slices.slices.map((s, i) => ({ name: s.name, value: s.value, pick: picks?.[i] })),
        itemStyle: { borderColor: token("--card"), borderWidth: 2 },
        label: { show: !!o.labels, color: t.text, formatter: (p: { name?: string; value?: number }) => `${p.name ?? ""}: ${formatValue(p.value ?? null, format === "percent" ? "percent" : "compact")}` },
        labelLine: { show: !!o.labels },
      },
    ],
  };
}

/** Small trend line of a KPI card: no axes, no legend. */
export function sparklineOption(values: (number | null)[], labels: string[], format: FormatName | null): Record<string, unknown> {
  const color = PALETTE[0]!;
  return {
    animation: false,
    grid: { left: 2, right: 2, top: 4, bottom: 2 },
    xAxis: { type: "category", show: false, data: labels, boundaryGap: false },
    yAxis: { type: "value", show: false, scale: true },
    tooltip: { trigger: "axis", confine: true, formatter: (p: unknown) => {
      const x = (Array.isArray(p) ? p[0] : p) as { axisValueLabel?: string; value?: number | null };
      return `${escapeHtml(String(x.axisValueLabel ?? ""))}: <b>${escapeHtml(formatValue(x.value ?? null, format === "compact" ? "number" : format))}</b>`;
    } },
    series: [{ type: "line", data: values, showSymbol: false, smooth: true, lineStyle: { color, width: 2 }, areaStyle: { color, opacity: 0.12 } }],
  };
}

export { formatCompact };
