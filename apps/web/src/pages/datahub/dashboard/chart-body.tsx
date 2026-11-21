import { formatPercent } from "@soe/shared";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { cartesianPicks, pickOf, toCartesian, toPivot, toSlices, type SeriesInput } from "@/lib/dashboard/chart-data";
import { chartKey, runChartData, type ChartRef } from "@/lib/dashboard/api";
import { cartesianOption, immatureCategories, pieOption, sparklineOption } from "@/lib/dashboard/echart-options";
import { boxplotOption, bulletOption, cohortOption, funnelOption, gaugeOption, heatmapOption, histogramOption, QUADRANT_LABEL, rankingOption, scatterOption, waterfallOption } from "@/lib/dashboard/echart-more";
import { formatValue } from "@/lib/dashboard/format";
import type { ChartDataResult, ChartDef, FormatName, PickInfo, QueryResult, SeriesDef, ViewFilters } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import type { ChartExport } from "./echart";
import { DataTable, PivotTable } from "./data-views";

const EChart = lazy(() => import("./echart"));

/** What a chart shows while it has no numbers: it never draws an empty frame, and says why. */
/** Axis end of a percent gauge: the next round step above the value (1.000 -> 1.000, 2.000.000.000.040 -> 3.000.000.000.000), so the ticks are round numbers. */
function gaugeMax(value: number): number {
  if (value <= 100) return 100;
  if (value < 1000) return Math.ceil(value / 10) * 10;
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / step) * step;
}

export function ChartMessage({ tone = "muted", title, hint }: { tone?: "muted" | "bad"; title: string; hint?: string }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center">
      <p className={cn("text-sm font-medium [overflow-wrap:anywhere]", tone === "bad" && "text-bad")}>{title}</p>
      {hint && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{hint}</p>}
    </div>
  );
}

function errorView(e: unknown) {
  if (e instanceof ApiError) {
    const hint = typeof e.details?.hint === "string" ? e.details.hint : undefined;
    if (e.details?.reason === "query_too_heavy") return <ChartMessage tone="bad" title="Truy vấn quá nặng" hint={hint ?? "Thu hẹp khoảng thời gian hoặc thêm bộ lọc."} />;
    return <ChartMessage tone="bad" title={e.message} hint={hint} />;
  }
  return <ChartMessage tone="bad" title="Không tải được số liệu" hint="Mở lại dashboard để thử lại." />;
}

const seriesLabel = (s: SeriesDef | undefined, r: QueryResult | undefined, i: number) => s?.label?.trim() || r?.metric.name || s?.metric?.name || `Chuỗi ${i + 1}`;

/** Numbers of a chart: ONE call to `metrics.chart.data`, which computes everything the chart type needs. The screen only draws. */
export function useChartData(chart: ChartDef, ref: Omit<ChartRef, "chart">): UseQueryResult<ChartDataResult> {
  const full: ChartRef = { ...ref, chart };
  return useQuery({
    queryKey: chartKey(full),
    queryFn: () => runChartData(full),
    enabled: chart.type !== "note",
    staleTime: 30_000,
    retry: false,
    placeholderData: (prev: ChartDataResult | undefined) => prev,
  });
}

export interface ChartBodyProps {
  chart: ChartDef;
  datahubId: string;
  /** Saved chart (the server reads its stored JSON; numbers use the dashboard owner's rights). Without it the chart is a draft being configured. */
  chartId?: string;
  version?: number;
  filters?: ViewFilters;
  onPick?: (pick: PickInfo) => void;
  exportRef?: { current: ChartExport | null };
  /** KPI card: the number opens the rows behind it. */
  onOpenRows?: () => void;
  /** Cohort chart of deals (`options.mature_cohort`): the last day of the last mature month; later months are drawn pale. */
  matureThrough?: string | null;
}

export function ChartBody({ chart, datahubId, chartId, version, filters, onPick, exportRef, onOpenRows, matureThrough }: ChartBodyProps) {
  const q = useChartData(chart, { datahubId, chartId, version, filters });
  if (chart.type === "note") return <p className="contain-scroll h-full overflow-auto whitespace-pre-wrap px-1 text-sm [overflow-wrap:anywhere]">{chart.text?.trim() || "Ô ghi chú trống."}</p>;
  if (!chart.series.length) return <ChartMessage title="Chưa chọn số liệu" hint="Mở cấu hình để chọn bảng, cột và cách tính." />;
  if (q.isError && !q.data) return errorView(q.error);
  if (q.isPending || !q.data) return <Skeleton className="h-full w-full" aria-busy="true" aria-label="Đang tải biểu đồ" />;
  return <Loaded chart={chart} data={q.data} onPick={onPick} exportRef={exportRef} onOpenRows={onOpenRows} matureThrough={chart.options?.mature_cohort ? matureThrough : null} />;
}

const EMPTY = <ChartMessage title="Chưa có dữ liệu" hint="Không có dòng nào khớp bộ lọc và khoảng thời gian của biểu đồ này." />;

function Loaded({ chart, data, onPick, exportRef, onOpenRows, matureThrough }: { chart: ChartDef; data: ChartDataResult; onPick?: (pick: PickInfo) => void; exportRef?: { current: ChartExport | null }; onOpenRows?: () => void; matureThrough?: string | null }) {
  const o = chart.options ?? {};
  const results = data.series;
  const first = results[0];
  const format: FormatName | null = o.format ?? first?.metric.format ?? null;
  const inputs: SeriesInput[] = useMemo(
    () => results.map((r, i) => ({ label: seriesLabel(chart.series[i], r, i), kind: chart.series[i]?.kind ?? (chart.type === "combo" && i > 0 ? "line" : "bar"), axis: chart.series[i]?.axis ?? "left", result: r })),
    [chart, results],
  );
  const diag = results.flatMap((r) => r.diagnostics?.joins ?? []).filter((j) => j.unmatched > 0);
  const notes = [...data.notes, ...(diag.length ? [`Ghép bảng "${diag[0]!.alias}": ${diag[0]!.matched}/${diag[0]!.base_total} dòng ghép được.`] : [])];
  const noteText = notes.length ? notes.join(" ") : null;
  const wrap = (body: React.ReactNode, extra?: string | null) => (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">{body}</div>
      {(noteText || extra) && <p className="shrink-0 pt-1 text-xs text-muted-foreground" data-testid="chart-note">{[extra, noteText].filter(Boolean).join(" ")}</p>}
    </div>
  );
  const canvas = (option: Record<string, unknown>, label: string, picks = true) => (
    <Suspense fallback={<Skeleton className="h-full w-full" />}>
      <EChart option={option} onPick={picks ? onPick : undefined} label={label} exportRef={exportRef} />
    </Suspense>
  );
  const view = data.view;
  const title = chart.title ?? TITLES[chart.type] ?? "Biểu đồ";

  switch (chart.type) {
    case "kpi":
      return wrap(<KpiCard chart={chart} result={first!} spark={data.spark} format={format} onOpenRows={data.can_view_rows ? onOpenRows : undefined} />);
    case "table":
      return first!.rows.length === 0 ? EMPTY : wrap(<DataTable result={first!} format={format} />);
    case "pivot":
      return first!.rows.length === 0 ? EMPTY : wrap(<PivotTable result={first!} format={format} heat={!!o.heat} totals={o.totals !== false} />);
    case "pie":
    case "donut": {
      const sl = toSlices(first!);
      if (!sl.slices.length) return <ChartMessage title="Chưa có dữ liệu" hint={sl.skipped ? "Mọi nhóm có giá trị bằng 0 hoặc âm, không vẽ được tỉ trọng." : "Không có dòng nào khớp bộ lọc và khoảng thời gian của biểu đồ này."} />;
      const note = [sl.skipped ? `${sl.skipped} nhóm bằng 0 hoặc âm không hiện.` : "", sl.folded ? `"Khác" gộp ${sl.folded} nhóm nhỏ hơn.` : ""].filter(Boolean).join(" ");
      const rows = first!.rows.filter((r) => typeof r.value === "number" && r.value > 0);
      const picks = rows.map((r) => pickOf(0, first!.columns, r));
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">{canvas(pieOption({ chart, slices: sl, format, picks }), `${title}: ${sl.slices.length} phần`)}</div>
          {(note || noteText) && <p className="shrink-0 pt-1 text-xs text-muted-foreground">{[note, noteText].filter(Boolean).join(" ")}</p>}
          <A11yTable caption={title} head={["Phần", "Giá trị"]} rows={sl.slices.map((s) => [s.name, formatValue(s.value, format === "compact" ? "number" : format)])} />
        </div>
      );
    }
    case "gauge": {
      const row = first!.rows[0];
      if (!row || row.value === null) return EMPTY;
      const hasTarget = row.target !== null && row.target !== undefined;
      const percent = hasTarget || format === "percent";
      let value: number;
      let min = 0;
      let max = 100;
      if (hasTarget) {
        value = (row.achieved ?? 0) * 100; // the share reached is the server's; ×100 only to read it as a percent
        max = gaugeMax(value);
      } else if (format === "percent") {
        value = Number(row.value) * 100;
        max = gaugeMax(value);
      } else if (o.gauge_max !== undefined) {
        value = Number(row.value);
        min = o.gauge_min ?? 0;
        max = o.gauge_max;
      } else return <ChartMessage title="Chưa có thang đo" hint="Đặt mục tiêu, hoặc mốc tối đa của đồng hồ ở phần Hiển thị." />;
      const cap = hasTarget ? `Giá trị ${formatValue(row.value, format === "compact" ? "number" : format)} trên mục tiêu ${formatValue(row.target ?? null, format === "compact" ? "number" : format)}` : null;
      const f = (x: number | string | null | undefined) => formatValue(x ?? null, format === "compact" ? "number" : format);
      return wrap(
        <>
          {canvas(gaugeOption({ value, min, max, percent, format }), `${title}: ${formatValue(value, "number")}${percent ? "%" : ""}`, false)}
          <A11yTable caption={title} head={["Chỉ số", "Giá trị", "Mục tiêu", "Đạt"]} rows={[[seriesLabel(chart.series[0], first, 0), f(row.value), hasTarget ? f(row.target) : "—", row.achieved === null || row.achieved === undefined ? "—" : formatPercent(row.achieved, { decimals: 1 })]]} />
        </>,
        cap,
      );
    }
    case "bullet": {
      const rows = first!.rows.filter((r) => typeof r.value === "number");
      if (!rows.length) return EMPTY;
      const label = (r: (typeof rows)[number]) => r.groups.map((g) => g.label).join(" · ") || seriesLabel(chart.series[0], first, 0);
      const br = rows.map((r) => ({ label: label(r), value: typeof r.value === "number" ? r.value : null, target: r.target ?? null, pick: pickOf(0, first!.columns, r) }));
      return wrap(
        <>
          {canvas(bulletOption({ chart, rows: br, format }), `${title}: ${rows.length} dòng`)}
          <A11yTable caption={title} head={["Nhóm", "Thực tế", "Mục tiêu", "Đạt"]} rows={rows.map((r, i) => [br[i]!.label, formatValue(r.value, format === "compact" ? "number" : format), r.target === null || r.target === undefined ? "—" : formatValue(r.target, format === "compact" ? "number" : format), r.achieved === null || r.achieved === undefined ? "—" : formatPercent(r.achieved, { decimals: 1 })])} />
        </>,
      );
    }
    case "funnel": {
      if (view?.kind !== "funnel" || !view.steps.length) return EMPTY;
      const picks = results.length === 1 ? first!.rows.map((r) => pickOf(0, first!.columns, r)) : [];
      return wrap(
        <>
          {canvas(funnelOption(view, format, picks), `${title}: ${view.steps.length} bước`, results.length === 1)}
          <A11yTable caption={title} head={["Bước", "Số lượng", "So với bước đầu", "So với bước trước"]} rows={view.steps.map((s) => [s.label, formatValue(s.value, format === "compact" ? "number" : format), s.pct_of_first === null ? "—" : formatPercent(s.pct_of_first, { decimals: 1 }), s.pct_of_prev === null ? "—" : formatPercent(s.pct_of_prev, { decimals: 1 })])} />
        </>,
        view.truncated ? "Còn nhiều nhóm hơn số hiển thị." : null,
      );
    }
    case "waterfall": {
      if (view?.kind !== "waterfall" || !view.steps.length) return EMPTY;
      return wrap(
        <>
          {canvas(waterfallOption(view, format, !!o.labels), `${title}: ${view.steps.length} bước`, false)}
          <A11yTable caption={title} head={["Bước", "Thay đổi", "Luỹ kế"]} rows={view.steps.map((s) => [s.label, formatValue(s.delta, format === "compact" ? "number" : format), formatValue(s.end, format === "compact" ? "number" : format)])} />
        </>,
      );
    }
    case "histogram": {
      if (view?.kind !== "histogram" || !view.bins.length) return EMPTY;
      const nm = (b: { from: number; to: number }) => (b.from === b.to ? formatValue(b.from, format === "compact" ? "number" : format) : `${formatValue(b.from, format === "compact" ? "number" : format)} – ${formatValue(b.to, format === "compact" ? "number" : format)}`);
      return wrap(
        <>
          {canvas(histogramOption(view, format, !!o.labels), `${title}: ${view.bins.length} khoảng`, false)}
          <A11yTable caption={title} head={["Khoảng", "Số dòng"]} rows={view.bins.map((b) => [nm(b), formatValue(b.count, "number")])} />
        </>,
        `${formatValue(view.total, "number")} giá trị.`,
      );
    }
    case "boxplot": {
      if (view?.kind !== "boxplot" || !view.groups.length) return EMPTY;
      const f = (x: number) => formatValue(x, format === "compact" ? "number" : format);
      return wrap(
        <>
          {canvas(boxplotOption(view, format), `${title}: ${view.groups.length} nhóm`, false)}
          <A11yTable caption={title} head={["Nhóm", "Số giá trị", "Nhỏ nhất", "Q1", "Trung vị", "Q3", "Lớn nhất", "Ngoại lai"]} rows={view.groups.map((g) => [g.label, formatValue(g.n, "number"), f(g.min), f(g.q1), f(g.median), f(g.q3), f(g.max), String(g.outlier_count)])} />
        </>,
        view.truncated ? "Còn nhiều nhóm hơn số hiển thị." : null,
      );
    }
    case "scatter":
    case "matrix": {
      if (view?.kind !== "scatter" && view?.kind !== "matrix") return EMPTY;
      if (!view.points.length) return <ChartMessage title="Chưa có điểm nào" hint={view.dropped ? `${view.dropped} nhóm thiếu một trong hai số liệu.` : "Không có dòng nào khớp bộ lọc và khoảng thời gian của biểu đồ này."} />;
      const xf = o.format ?? results[0]?.metric.format ?? null;
      const yf = o.format ?? results[1]?.metric.format ?? null;
      const q = view.quadrants;
      const extra = [
        view.dropped ? `${view.dropped} nhóm thiếu số liệu không hiện.` : "",
        view.truncated ? "Còn nhiều điểm hơn số hiển thị." : "",
        view.split ? `Mốc chia: ${view.x_label} ${view.split.x === null ? "—" : formatValue(view.split.x, "number")}${view.split.x_median ? " (trung vị)" : ""}, ${view.y_label} ${view.split.y === null ? "—" : formatValue(view.split.y, "number")}${view.split.y_median ? " (trung vị)" : ""}.` : "",
      ].filter(Boolean).join(" ");
      return wrap(
        <>
          {canvas(scatterOption(view, xf, yf, !!o.labels), `${title}: ${view.points.length} điểm`, false)}
          <A11yTable caption={title} head={["Điểm", view.x_label, view.y_label, ...(view.kind === "matrix" ? ["Góc"] : [])]} rows={view.points.map((p) => [p.label, formatValue(p.x, "number"), formatValue(p.y, "number"), ...(view.kind === "matrix" ? [p.quadrant ? QUADRANT_LABEL[p.quadrant]!(view.x_label, view.y_label) : ""] : [])])} />
        </>,
        [extra, q ? (["hh", "hl", "lh", "ll"] as const).map((k) => `${QUADRANT_LABEL[k]!(view.x_label, view.y_label)}: ${q[k]}`).join("; ") + "." : ""].filter(Boolean).join(" "),
      );
    }
    case "heatmap": {
      if (!first || first.rows.length === 0) return EMPTY;
      if (first.columns.length < 2) return <ChartMessage title="Cần hai cột nhóm" hint="Chọn cột nhóm thứ nhất cho dòng và cột nhóm thứ hai (hoặc nhóm theo thời gian) cho cột." />;
      const p = toPivot(first);
      const picks = new Map(first.rows.map((r) => [`${r.groups[0]?.label}\u0000${r.groups.slice(1).map((g) => g.label).join(" · ")}`, pickOf(0, first.columns, r)!] as const));
      return wrap(
        <>
          {canvas(heatmapOption(first, format, !!o.labels, picks), `${title}: ${p.rowLabels.length} × ${p.colLabels.length}`)}
          <A11yTable caption={title} head={["", ...p.colLabels]} rows={p.rowLabels.map((rl, ri) => [rl, ...p.colLabels.map((_, ci) => formatValue(p.cells[ri]![ci]?.value ?? null, format === "compact" ? "number" : format))])} />
        </>,
      );
    }
    case "ranking": {
      if (view?.kind !== "ranking" || !view.items.length) return EMPTY;
      const picks = view.items.map((it) => (it.groups.length ? ({ series: 0, columns: first!.columns, groups: it.groups } as PickInfo) : undefined));
      return wrap(
        <>
          {canvas(rankingOption(view, format, picks, o.labels !== false), `${title}: ${view.items.length} vị trí`)}
          <A11yTable caption={title} head={["Hạng", "Nhóm", "Giá trị"]} rows={view.items.map((it) => [String(it.rank), it.label, formatValue(it.value, format === "compact" ? "number" : format)])} />
        </>,
        view.truncated ? "Còn nhóm xếp sau vị trí cuối." : null,
      );
    }
    case "cohort": {
      if (view?.kind !== "cohort" || !view.rows.length) return EMPTY;
      return wrap(
        <>
          {canvas(cohortOption(view, format), `${title}: ${view.rows.length} cohort`, false)}
          <A11yTable caption={title} head={["Cohort", "Quy mô", ...view.offsets.map((x) => `+${x}`)]} rows={view.rows.map((r) => [r.label, formatValue(r.size, "number"), ...r.cells.map((c) => (c.pending ? "" : view.rates && c.rate !== null ? formatPercent(c.rate, { decimals: 1 }) : formatValue(c.value, "number")))])} />
        </>,
        view.truncated ? "Còn nhiều kỳ hơn số hiển thị." : null,
      );
    }
    default: {
      const cart = toCartesian(inputs);
      const empty = cart.series.every((s) => s.data.every((v) => v === null));
      if (!cart.categories.length || empty) return EMPTY;
      const compare = cart.series.map((_, i) => !!chart.series[Math.min(i, chart.series.length - 1)]?.compare && chart.series.length === cart.series.length);
      const picks = cartesianPicks(inputs, cart);
      const nPale = immatureCategories(picks, cart.categories.length, matureThrough).filter(Boolean).length;
      return wrap(
        <>
          {canvas(cartesianOption({ chart, data: cart, format, compare, picks, matureThrough }), `${title}: ${cart.series.length} chuỗi, ${cart.categories.length} nhóm`)}
          <A11yTable caption={title} head={["Nhóm", ...cart.series.map((s) => s.name)]} rows={cart.categories.map((c, k) => [c, ...cart.series.map((s) => formatValue(s.data[k] ?? null, format === "compact" ? "number" : format))])} />
        </>,
        nPale > 0 ? `${nPale} tháng cuối là tạm tính: cohort chưa chín, còn deal đang mở.` : null,
      );
    }
  }
}

const TITLES: Record<string, string> = { pie: "Biểu đồ tròn", donut: "Biểu đồ donut", gauge: "Đồng hồ", bullet: "Bullet", funnel: "Phễu", waterfall: "Waterfall", histogram: "Histogram", boxplot: "Box plot", scatter: "Scatter", matrix: "Ma trận 2×2", heatmap: "Heatmap", ranking: "Bảng xếp hạng", cohort: "Cohort" };

/** The numbers of a canvas chart as a table for screen readers (and for tests): same formatted values as the tooltip. */
function A11yTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <table className="sr-only" data-testid="chart-data">
      <caption>{caption}</caption>
      <thead>
        <tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, k) => (k === 0 ? <th key={k} scope="row">{c}</th> : <td key={k}>{c}</td>))}</tr>
        ))}
      </tbody>
    </table>
  );
}

function KpiCard({ chart, result, spark, format, onOpenRows }: { chart: ChartDef; result: QueryResult; spark: QueryResult | null; format: FormatName | null; onOpenRows?: () => void }) {
  void chart;
  const row = result.rows[0];
  if (!row) return <ChartMessage title="—" />;
  const text = formatValue(row.value, format === "compact" ? "compact" : format);
  const change = row.change_pct;
  const sp = spark?.rows ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col justify-center gap-1 px-1">
      {onOpenRows ? (
        <button type="button" onClick={onOpenRows} className="w-full rounded text-left hover:bg-muted focus-visible:outline-2" aria-label={`${text}: xem các dòng tạo nên con số này`} data-testid="kpi-rows">
          <FitText text={text} />
        </button>
      ) : (
        <FitText text={text} />
      )}
      {result.rows.length > 1 && <p className="text-xs text-muted-foreground">Nhóm đầu tiên: {row.groups.map((g) => g.label).join(" · ")} (còn {result.rows.length - 1} nhóm)</p>}
      {row.previous !== undefined && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {change === null || change === undefined ? <Minus size={14} aria-hidden /> : change >= 0 ? <ArrowUpRight size={14} className="text-ok" aria-hidden /> : <ArrowDownRight size={14} className="text-bad" aria-hidden />}
          <span data-testid="kpi-change">{change === null || change === undefined ? "Không so sánh được" : `${change > 0 ? "+" : ""}${formatPercent(change, { decimals: 1 })}`}</span>
          <span>so với kỳ trước ({formatValue(row.previous, format === "compact" ? "number" : format)})</span>
        </p>
      )}
      {row.target !== undefined && row.target !== null && (
        <div className="flex flex-col gap-0.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Tỉ lệ đạt mục tiêu" aria-valuenow={Math.round((row.achieved ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, (row.achieved ?? 0) * 100))}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">Đạt {row.achieved === null || row.achieved === undefined ? "—" : formatPercent(row.achieved, { decimals: 1 })} của mục tiêu {formatValue(row.target, format === "compact" ? "number" : format)}</p>
        </div>
      )}
      {sp.length > 1 && (
        <div className="h-10 min-h-0 w-full">
          <Suspense fallback={null}>
            <EChart option={sparklineOption(sp.map((r) => (typeof r.value === "number" ? r.value : null)), sp.map((r) => r.groups[0]?.label ?? ""), format)} label="Xu hướng" />
          </Suspense>
        </div>
      )}
    </div>
  );
}

const FIT_SIZES = [32, 28, 24, 21, 18, 16, 14];

/** The big number of a KPI card: the largest size at which the whole number fits on one line (a number is never cut or broken). */
function FitText({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const span = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(FIT_SIZES[0]!);
  useLayoutEffect(() => {
    const el = box.current!;
    const fit = () => {
      const s = span.current!;
      const room = el.clientWidth;
      if (!room) return;
      let pick = FIT_SIZES[FIT_SIZES.length - 1]!;
      for (const px of FIT_SIZES) {
        s.style.fontSize = `${px}px`;
        if (s.scrollWidth <= room) {
          pick = px;
          break;
        }
      }
      s.style.fontSize = "";
      setSize(pick);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <div ref={box} className="w-full overflow-x-auto">
      <span ref={span} className="inline-block whitespace-nowrap font-semibold leading-tight" style={{ fontSize: size }} data-testid="kpi-value">{text}</span>
    </div>
  );
}
