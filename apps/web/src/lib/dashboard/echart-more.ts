import { formatPercent } from "@soe/shared";
import { token, FONT_STACK } from "@/lib/theme";
import { toPivot } from "./chart-data";
import { PALETTE, escapeHtml } from "./echart-options";
import { formatValue } from "./format";
import type { BoxplotView, ChartDef, CohortView, FormatName, FunnelView, HistogramView, PickInfo, QueryResult, RankingView, ScatterView, WaterfallView } from "./types";

/**
 * ECharts options for the 3C-2 chart types. Everything drawn is a number the server computed (`metrics.chart.data`: bins, quartiles, running
 * totals, conversion rates, quadrants, ranks, cohort shares); this file only turns them into marks. The only arithmetic here is scaling
 * for display (a ratio times 100 for a gauge, the axis range of a colour scale).
 */

const fmt = (v: number | null | undefined, f: FormatName | null) => formatValue(v ?? null, f === "compact" ? "number" : f);
const axisFmt = (f: FormatName | null): FormatName => (f === "percent" || f === "days" ? f : "compact");

function base() {
  const text = token("--foreground");
  const muted = token("--muted-foreground");
  const line = token("--border");
  return { text, muted, line, textStyle: { fontFamily: FONT_STACK, color: text } };
}

// ---- funnel ----
export function funnelOption(v: FunnelView, format: FormatName | null, picks: (PickInfo | undefined)[]): Record<string, unknown> {
  const t = base();
  return {
    textStyle: t.textStyle,
    color: PALETTE,
    animation: false,
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (p: { dataIndex?: number }) => {
        const s = v.steps[p.dataIndex ?? 0]!;
        return `<div style="font-weight:600">${escapeHtml(s.label)}</div><div>Số lượng: <b>${escapeHtml(fmt(s.value, format))}</b></div>` +
          `<div>So với bước đầu: <b>${s.pct_of_first === null ? "—" : escapeHtml(formatPercent(s.pct_of_first, { decimals: 1 }))}</b></div>` +
          `<div>So với bước trước: <b>${s.pct_of_prev === null ? "—" : escapeHtml(formatPercent(s.pct_of_prev, { decimals: 1 }))}</b></div>`;
      },
    },
    series: [
      {
        type: "funnel",
        sort: "none",
        left: "4%",
        width: "52%",
        top: 8,
        bottom: 8,
        minSize: "6%",
        gap: 2,
        itemStyle: { borderColor: token("--card"), borderWidth: 1 },
        label: {
          show: true,
          position: "right",
          color: t.text,
          fontSize: 12,
          formatter: (p: { dataIndex?: number }) => {
            const s = v.steps[p.dataIndex ?? 0]!;
            return `${s.label}\n${fmt(s.value, format)}${s.pct_of_first !== null && p.dataIndex ? ` · ${formatPercent(s.pct_of_first, { decimals: 1 })}` : ""}`;
          },
        },
        labelLine: { show: true, lineStyle: { color: t.line } },
        data: v.steps.map((s, i) => ({ name: s.label, value: Math.max(0, s.value ?? 0), pick: picks[i] })),
      },
    ],
  };
}

// ---- waterfall ----
export function waterfallOption(v: WaterfallView, format: FormatName | null, labels: boolean): Record<string, unknown> {
  const t = base();
  const ok = token("--ok");
  const bad = token("--bad");
  const colorOf = (k: string) => (k === "add" ? ok : k === "subtract" ? bad : PALETTE[0]!);
  return {
    textStyle: t.textStyle,
    animation: false,
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (p: { dataIndex?: number }) => {
        const s = v.steps[p.dataIndex ?? 0]!;
        const what = s.kind === "start" ? "Giá trị đầu" : s.kind === "total" ? "Tổng cuối" : s.kind === "add" ? "Cộng thêm" : "Trừ đi";
        return `<div style="font-weight:600">${escapeHtml(s.label)}</div><div>${what}: <b>${escapeHtml(fmt(s.delta, format))}</b></div><div>Luỹ kế sau bước: <b>${escapeHtml(fmt(s.end, format))}</b></div>`;
      },
    },
    xAxis: { type: "category", data: v.steps.map((s) => s.label), axisLabel: { color: t.muted, hideOverlap: true }, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false } },
    yAxis: { type: "value", scale: false, splitLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted, formatter: (x: number) => formatValue(x, axisFmt(format)) }, axisLine: { show: false } },
    series: [
      {
        type: "custom",
        encode: { x: 0, y: [1, 2] },
        data: v.steps.map((s, i) => ({ value: [i, s.start, s.end], itemStyle: { color: colorOf(s.kind) } })),
        renderItem: (_p: unknown, api: { value(i: number): number; coord(v: number[]): number[]; size(v: number[]): number[]; style(): Record<string, unknown> }) => {
          const x = api.value(0);
          const a = api.coord([x, api.value(1)]);
          const b = api.coord([x, api.value(2)]);
          const w = Math.min(60, (api.size([1, 0])[0] ?? 40) * 0.6);
          return { type: "rect", shape: { x: a[0]! - w / 2, y: Math.min(a[1]!, b[1]!), width: w, height: Math.max(1, Math.abs(b[1]! - a[1]!)) }, style: api.style() };
        },
      },
      {
        type: "scatter",
        symbolSize: 0,
        silent: true,
        data: v.steps.map((s, i) => [i, Math.max(s.start, s.end)]),
        label: { show: labels, position: "top", color: t.text, fontSize: 11, formatter: (p: { dataIndex?: number }) => { const s = v.steps[p.dataIndex ?? 0]!; return s.kind === "add" ? `+${fmt(s.delta, format)}` : fmt(s.delta, format); } },
      },
    ],
  };
}

// ---- histogram ----
export function histogramOption(v: HistogramView, format: FormatName | null, labels: boolean): Record<string, unknown> {
  const t = base();
  const name = (b: { from: number; to: number }) => (b.from === b.to ? fmt(b.from, format) : `${fmt(b.from, format)} – ${fmt(b.to, format)}`);
  return {
    textStyle: t.textStyle,
    animation: false,
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (p: { dataIndex?: number }) => {
        const b = v.bins[p.dataIndex ?? 0]!;
        return `<div style="font-weight:600">${escapeHtml(name(b))}</div><div>Số dòng: <b>${escapeHtml(formatValue(b.count, "number"))}</b></div>`;
      },
    },
    xAxis: { type: "category", data: v.bins.map(name), axisLabel: { color: t.muted, hideOverlap: true }, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false } },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted, formatter: (x: number) => formatValue(x, "number") }, axisLine: { show: false } },
    series: [{ type: "bar", barCategoryGap: "6%", itemStyle: { color: PALETTE[0] }, data: v.bins.map((b) => b.count), label: { show: labels, position: "top", color: t.text, fontSize: 11 } }],
  };
}

// ---- box plot ----
export function boxplotOption(v: BoxplotView, format: FormatName | null): Record<string, unknown> {
  const t = base();
  return {
    textStyle: t.textStyle,
    animation: false,
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (p: { seriesType?: string; dataIndex?: number; value?: number[] }) => {
        if (p.seriesType === "scatter") return `Ngoại lai: <b>${escapeHtml(fmt(p.value?.[1] ?? null, format))}</b>`;
        const g = v.groups[p.dataIndex ?? 0]!;
        const row = (k: string, x: number) => `<div>${k}: <b>${escapeHtml(fmt(x, format))}</b></div>`;
        return `<div style="font-weight:600">${escapeHtml(g.label)} (${formatValue(g.n, "number")} giá trị)</div>${row("Lớn nhất", g.max)}${row("Râu trên", g.upper_whisker)}${row("Q3", g.q3)}${row("Trung vị", g.median)}${row("Q1", g.q1)}${row("Râu dưới", g.lower_whisker)}${row("Nhỏ nhất", g.min)}<div>Ngoại lai: <b>${g.outlier_count}</b></div>`;
      },
    },
    xAxis: { type: "category", data: v.groups.map((g) => g.label), axisLabel: { color: t.muted, hideOverlap: true }, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false } },
    yAxis: { type: "value", scale: true, splitLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted, formatter: (x: number) => formatValue(x, axisFmt(format)) }, axisLine: { show: false } },
    series: [
      { type: "boxplot", boxWidth: [12, 48], itemStyle: { color: "transparent", borderColor: PALETTE[0], borderWidth: 2 }, data: v.groups.map((g) => [g.lower_whisker, g.q1, g.median, g.q3, g.upper_whisker]) },
      { type: "scatter", symbolSize: 7, itemStyle: { color: PALETTE[5] }, data: v.groups.flatMap((g, i) => g.outliers.map((o) => [i, o])) },
    ],
  };
}

// ---- scatter and 2x2 matrix ----
export const QUADRANT_LABEL: Record<string, (x: string, y: string) => string> = {
  hh: (x, y) => `${x} cao, ${y} cao`,
  hl: (x, y) => `${x} cao, ${y} thấp`,
  lh: (x, y) => `${x} thấp, ${y} cao`,
  ll: (x, y) => `${x} thấp, ${y} thấp`,
};

export function scatterOption(v: ScatterView, xFormat: FormatName | null, yFormat: FormatName | null, labelsOn: boolean): Record<string, unknown> {
  const t = base();
  const colors = [...new Set(v.points.map((p) => p.color))];
  const matrix = v.kind === "matrix";
  const series = colors.map((c, i) => ({
    type: "scatter",
    name: c ?? v.y_label,
    symbolSize: 10,
    itemStyle: { color: PALETTE[i % PALETTE.length], opacity: 0.85 },
    label: { show: labelsOn, position: "top", color: t.text, fontSize: 11, formatter: (p: { data?: { label?: string } }) => p.data?.label ?? "" },
    data: v.points.filter((p) => p.color === c).map((p) => ({ value: [p.x, p.y], label: p.label, quadrant: p.quadrant })),
    ...(matrix && i === 0 && v.split
      ? {
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: t.muted, type: "dashed" },
            label: { show: false },
            data: [...(v.split.x !== null ? [{ xAxis: v.split.x }] : []), ...(v.split.y !== null ? [{ yAxis: v.split.y }] : [])],
          },
        }
      : {}),
  }));
  return {
    textStyle: t.textStyle,
    animation: false,
    color: PALETTE,
    grid: { left: 8, right: 24, top: colors.length > 1 ? 36 : 16, bottom: 28, containLabel: true },
    legend: { show: colors.length > 1, top: 0, type: "scroll", textStyle: { color: t.text }, icon: "circle" },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (p: { seriesName?: string; data?: { value?: number[]; label?: string; quadrant?: string } }) => {
        const d = p.data;
        const q = d?.quadrant ? `<div>${escapeHtml(QUADRANT_LABEL[d.quadrant]!(v.x_label, v.y_label))}</div>` : "";
        return `<div style="font-weight:600">${escapeHtml(String(d?.label ?? ""))}</div><div>${escapeHtml(v.x_label)}: <b>${escapeHtml(fmt(d?.value?.[0] ?? null, xFormat))}</b></div><div>${escapeHtml(v.y_label)}: <b>${escapeHtml(fmt(d?.value?.[1] ?? null, yFormat))}</b></div>${q}`;
      },
    },
    xAxis: { type: "value", scale: true, name: v.x_label, nameLocation: "middle", nameGap: 24, nameTextStyle: { color: t.muted }, splitLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted, formatter: (x: number) => formatValue(x, axisFmt(xFormat)) } },
    yAxis: { type: "value", scale: true, name: v.y_label, nameTextStyle: { color: t.muted }, splitLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted, formatter: (x: number) => formatValue(x, axisFmt(yFormat)) } },
    series,
  };
}

// ---- ranking ----
export function rankingOption(v: RankingView, format: FormatName | null, picks: (PickInfo | undefined)[], labels: boolean): Record<string, unknown> {
  const t = base();
  return {
    textStyle: t.textStyle,
    animation: false,
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (p: { dataIndex?: number }) => {
        const r = v.items[p.dataIndex ?? 0]!;
        return `<div style="font-weight:600">#${r.rank} ${escapeHtml(r.label)}</div><div>Giá trị: <b>${escapeHtml(fmt(r.value, format))}</b></div>`;
      },
    },
    xAxis: { type: "value", splitLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted, formatter: (x: number) => formatValue(x, axisFmt(format)) }, axisLine: { show: false } },
    yAxis: { type: "category", inverse: true, data: v.items.map((r) => `${r.rank}. ${r.label}`), axisLabel: { color: t.text, width: 140, overflow: "truncate" }, axisTick: { show: false }, axisLine: { lineStyle: { color: t.line } } },
    series: [{ type: "bar", barMaxWidth: 22, itemStyle: { color: PALETTE[0] }, label: { show: labels !== false, position: "right", color: t.text, fontSize: 11, formatter: (p: { dataIndex?: number }) => fmt(v.items[p.dataIndex ?? 0]!.value, format) }, data: v.items.map((r, i) => ({ value: r.value ?? 0, pick: picks[i] })) }],
  };
}

// ---- heatmap (two group columns) ----
export function heatmapOption(result: QueryResult, format: FormatName | null, labels: boolean, picks: Map<string, PickInfo>): Record<string, unknown> {
  const t = base();
  const p = toPivot(result);
  const cells: { value: [number, number, number]; pick?: PickInfo }[] = [];
  p.cells.forEach((row, ri) =>
    row.forEach((c, ci) => {
      if (c && typeof c.value === "number") cells.push({ value: [ci, ri, c.value], pick: picks.get(`${p.rowLabels[ri]}\u0000${p.colLabels[ci]}`) });
    }),
  );
  const values = cells.map((c) => c.value[2]);
  return {
    textStyle: t.textStyle,
    animation: false,
    grid: { left: 8, right: 16, top: 8, bottom: 48, containLabel: true },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (x: { data?: { value?: number[] } }) => {
        const d = x.data?.value;
        return d ? `<div style="font-weight:600">${escapeHtml(p.rowLabels[d[1]!]!)} · ${escapeHtml(p.colLabels[d[0]!]!)}</div><div>Giá trị: <b>${escapeHtml(fmt(d[2]!, format))}</b></div>` : "";
      },
    },
    xAxis: { type: "category", data: p.colLabels, splitArea: { show: false }, axisLabel: { color: t.muted, hideOverlap: true }, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false } },
    yAxis: { type: "category", inverse: true, data: p.rowLabels, axisLabel: { color: t.muted, width: 120, overflow: "truncate" }, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false } },
    visualMap: { show: true, type: "continuous", min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 1, orient: "horizontal", left: "center", bottom: 0, calculable: false, itemWidth: 12, itemHeight: 120, textStyle: { color: t.muted }, inRange: { color: [token("--muted"), PALETTE[0]!] }, formatter: (x: number) => formatValue(x, axisFmt(format)) },
    series: [{ type: "heatmap", data: cells, label: { show: labels, color: t.text, fontSize: 11, formatter: (x: { data?: { value?: number[] } }) => fmt(x.data?.value?.[2] ?? null, format) }, itemStyle: { borderColor: token("--card"), borderWidth: 1 } }],
  };
}

// ---- cohort triangle ----
export function cohortOption(v: CohortView, format: FormatName | null): Record<string, unknown> {
  const t = base();
  const shown = (c: CohortView["rows"][number]["cells"][number]) => (v.rates ? c.rate : c.value);
  const data: { value: [number, number, number] }[] = [];
  v.rows.forEach((r, ri) => r.cells.forEach((c, ci) => { const x = shown(c); if (!c.pending && x !== null) data.push({ value: [ci, ri, x] }); }));
  const vals = data.map((d) => d.value[2]);
  const text = (x: number) => (v.rates ? formatPercent(x, { decimals: 0 }) : fmt(x, format));
  return {
    textStyle: t.textStyle,
    animation: false,
    grid: { left: 8, right: 16, top: 24, bottom: 48, containLabel: true },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (x: { data?: { value?: number[] } }) => {
        const d = x.data?.value;
        if (!d) return "";
        const row = v.rows[d[1]!]!;
        const cell = row.cells[d[0]!]!;
        return `<div style="font-weight:600">${escapeHtml(row.label)} · sau ${cell.offset} kỳ</div><div>Số lượng: <b>${escapeHtml(fmt(cell.value, format))}</b></div>${v.rates ? `<div>Trên ${escapeHtml(formatValue(row.size, "number"))} của cohort: <b>${escapeHtml(cell.rate === null ? "—" : formatPercent(cell.rate, { decimals: 1 }))}</b></div>` : ""}`;
      },
    },
    xAxis: { type: "category", position: "top", data: v.offsets.map((o) => `+${o}`), axisLabel: { color: t.muted }, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false } },
    yAxis: { type: "category", inverse: true, data: v.rows.map((r) => `${r.label} (${formatValue(r.size, "number")})`), axisLabel: { color: t.muted, width: 140, overflow: "truncate" }, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false } },
    visualMap: { show: true, type: "continuous", min: v.rates ? 0 : vals.length ? Math.min(...vals) : 0, max: v.rates ? 1 : vals.length ? Math.max(...vals) : 1, orient: "horizontal", left: "center", bottom: 0, calculable: false, itemWidth: 12, itemHeight: 120, textStyle: { color: t.muted }, inRange: { color: [token("--muted"), PALETTE[0]!] }, formatter: (x: number) => (v.rates ? formatPercent(x, { decimals: 0 }) : formatValue(x, "compact")) },
    series: [{ type: "heatmap", data, label: { show: true, color: t.text, fontSize: 11, formatter: (x: { data?: { value?: number[] } }) => text(x.data?.value?.[2] ?? 0) }, itemStyle: { borderColor: token("--card"), borderWidth: 1 } }],
  };
}

// ---- gauge ----
export function gaugeOption(args: { value: number; min: number; max: number; percent: boolean; format: FormatName | null }): Record<string, unknown> {
  const t = base();
  const text = (x: number) => (args.percent ? `${formatValue(x, "number")}%` : fmt(x, args.format));
  return {
    textStyle: t.textStyle,
    animation: false,
    series: [
      {
        type: "gauge",
        min: args.min,
        max: args.max,
        radius: "92%",
        progress: { show: true, width: 14, itemStyle: { color: PALETTE[0] } },
        axisLine: { lineStyle: { width: 14, color: [[1, token("--muted")]] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: t.muted, distance: 22, fontSize: 11, formatter: (x: number) => (args.percent ? `${formatValue(x, "number")}%` : formatValue(x, "compact")) },
        anchor: { show: false },
        detail: { valueAnimation: false, fontSize: 24, fontWeight: 600, offsetCenter: [0, "20%"], color: t.text, formatter: (x: number) => text(x) },
        data: [{ value: args.value }],
      },
    ],
  };
}

// ---- bullet ----
export function bulletOption(args: { chart: ChartDef; rows: { label: string; value: number | null; target: number | null; pick?: PickInfo }[]; format: FormatName | null }): Record<string, unknown> {
  const t = base();
  const bands = [...(args.chart.options?.bands ?? [])].sort((a, b) => b.value - a.value);
  const shades = [token("--muted"), token("--border"), token("--muted"), token("--border")];
  const o = args.chart.options ?? {};
  const bandSeries = bands.map((b, i) => ({ type: "bar", name: b.label, barWidth: "70%", barGap: "-100%", z: 1, silent: true, itemStyle: { color: shades[i % shades.length], opacity: 0.7 + i * 0.05 }, data: args.rows.map(() => b.value) }));
  return {
    textStyle: t.textStyle,
    animation: false,
    grid: { left: 8, right: 24, top: bands.length ? 28 : 12, bottom: 8, containLabel: true },
    legend: { show: bands.length > 0, top: 0, textStyle: { color: t.text }, icon: "roundRect", data: bands.map((b) => b.label) },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (p: { dataIndex?: number }) => {
        const r = args.rows[p.dataIndex ?? 0]!;
        const gap = r.value !== null && r.target !== null ? r.target - r.value : null;
        return `<div style="font-weight:600">${escapeHtml(r.label)}</div><div>Thực tế: <b>${escapeHtml(fmt(r.value, args.format))}</b></div>${r.target !== null ? `<div>Mục tiêu: <b>${escapeHtml(fmt(r.target, args.format))}</b></div><div>Còn thiếu: <b>${escapeHtml(fmt(gap, args.format))}</b></div>` : ""}${bands.map((b) => `<div>${escapeHtml(b.label)}: ${escapeHtml(fmt(b.value, args.format))}</div>`).join("")}`;
      },
    },
    xAxis: { type: "value", splitLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted, formatter: (x: number) => formatValue(x, axisFmt(args.format)) }, axisLine: { show: false } },
    yAxis: { type: "category", inverse: true, data: args.rows.map((r) => r.label), axisLabel: { color: t.text, width: 120, overflow: "truncate" }, axisTick: { show: false }, axisLine: { lineStyle: { color: t.line } } },
    series: [
      ...bandSeries,
      { type: "bar", name: "Thực tế", barWidth: "30%", barGap: "-100%", z: 3, itemStyle: { color: PALETTE[0] }, label: { show: !!o.labels, position: "right", color: t.text, fontSize: 11, formatter: (p: { dataIndex?: number }) => fmt(args.rows[p.dataIndex ?? 0]!.value, args.format) }, data: args.rows.map((r) => ({ value: r.value ?? 0, pick: r.pick })) },
      { type: "scatter", name: "Mục tiêu", z: 4, symbol: "rect", symbolSize: [3, 26], itemStyle: { color: t.text }, data: args.rows.flatMap((r, i) => (r.target === null ? [] : [[r.target, i]])) },
    ],
  };
}
