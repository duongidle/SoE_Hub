import { formatPercent } from "@soe/shared";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { toCartesian, toSlices, type SeriesInput } from "@/lib/dashboard/chart-data";
import { runQuery, queryKey } from "@/lib/dashboard/api";
import { cartesianOption, pieOption, sparklineOption } from "@/lib/dashboard/echart-options";
import { formatValue } from "@/lib/dashboard/format";
import type { ChartDef, FormatName, QueryResult, SeriesDef } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { DataTable, PivotTable } from "./data-views";

const EChart = lazy(() => import("./echart"));

/** What a chart shows while it has no numbers: it never draws an empty frame, and says why. */
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

const seriesLabel = (s: SeriesDef, r: QueryResult | undefined, i: number) => s.label?.trim() || r?.metric.name || s.metric?.name || `Chuỗi ${i + 1}`;

/** Numbers of a chart: one `metrics.query` per series, in parallel, each with its own loading and error state. */
export function useChartResults(chart: ChartDef, datahubId: string) {
  const qs = useQueries({
    queries: chart.series.map((s) => ({
      queryKey: queryKey(s, datahubId),
      queryFn: () => runQuery(s, datahubId),
      staleTime: 30_000,
      retry: false,
      placeholderData: (prev: QueryResult | undefined) => prev,
    })),
  });
  return qs;
}

export function ChartBody({ chart, datahubId, onPick }: { chart: ChartDef; datahubId: string; onPick?: (name: string) => void }) {
  const qs = useChartResults(chart, datahubId);
  if (chart.type === "note") return <p className="contain-scroll h-full overflow-auto whitespace-pre-wrap px-1 text-sm [overflow-wrap:anywhere]">{chart.text?.trim() || "Ô ghi chú trống."}</p>;
  if (!chart.series.length) return <ChartMessage title="Chưa chọn số liệu" hint="Mở cấu hình để chọn bảng, cột và cách tính." />;
  const bad = qs.find((q) => q.isError && !q.data);
  if (bad) return errorView(bad.error);
  if (qs.some((q) => q.isPending)) return <Skeleton className="h-full w-full" aria-busy="true" aria-label="Đang tải biểu đồ" />;
  const results = qs.map((q) => q.data!) as QueryResult[];
  return <Loaded chart={chart} results={results} datahubId={datahubId} onPick={onPick} />;
}

function Loaded({ chart, results, datahubId, onPick }: { chart: ChartDef; results: QueryResult[]; datahubId: string; onPick?: (name: string) => void }) {
  const o = chart.options ?? {};
  const first = results[0]!;
  const format: FormatName | null = o.format ?? first.metric.format ?? null;
  const inputs: SeriesInput[] = useMemo(
    () => chart.series.map((s, i) => ({ label: seriesLabel(s, results[i], i), kind: s.kind ?? (chart.type === "combo" && i > 0 ? "line" : "bar"), axis: s.axis ?? "left", result: results[i]! })),
    [chart, results],
  );
  const diag = results.flatMap((r) => r.diagnostics?.joins ?? []).filter((j) => j.unmatched > 0);
  const diagText = diag.length ? `Ghép bảng "${diag[0]!.alias}": ${diag[0]!.matched}/${diag[0]!.base_total} dòng ghép được.` : null;
  const wrap = (body: React.ReactNode) => (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">{body}</div>
      {diagText && <p className="shrink-0 pt-1 text-xs text-muted-foreground">{diagText}</p>}
    </div>
  );

  switch (chart.type) {
    case "kpi":
      return wrap(<KpiCard chart={chart} result={first} format={format} datahubId={datahubId} />);
    case "table":
      return first.rows.length === 0 ? <ChartMessage title="Chưa có dữ liệu" hint="Không có dòng nào khớp bộ lọc và khoảng thời gian của biểu đồ này." /> : wrap(<DataTable result={first} format={format} />);
    case "pivot":
      return first.rows.length === 0 ? <ChartMessage title="Chưa có dữ liệu" hint="Không có dòng nào khớp bộ lọc và khoảng thời gian của biểu đồ này." /> : wrap(<PivotTable result={first} format={format} heat={!!o.heat} totals={o.totals !== false} />);
    case "pie":
    case "donut": {
      const sl = toSlices(first, o.max_slices ?? 8);
      if (!sl.slices.length) return <ChartMessage title="Chưa có dữ liệu" hint={sl.skipped ? "Mọi nhóm có giá trị bằng 0 hoặc âm, không vẽ được tỉ trọng." : "Không có dòng nào khớp bộ lọc và khoảng thời gian của biểu đồ này."} />;
      const note = [sl.skipped ? `${sl.skipped} nhóm bằng 0 hoặc âm không hiện.` : "", sl.hidden ? `Còn ${sl.hidden} nhóm nhỏ hơn không hiện (không cộng gộp được với phép tính này).` : ""].filter(Boolean).join(" ");
      return (
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <EChart option={pieOption({ chart, slices: sl, format })} onPick={onPick} label={`${chart.title ?? "Biểu đồ tròn"}: ${sl.slices.length} phần`} />
            </Suspense>
          </div>
          {(note || diagText) && <p className="shrink-0 pt-1 text-xs text-muted-foreground">{[note, diagText].filter(Boolean).join(" ")}</p>}
          <A11yTable caption={chart.title ?? "Biểu đồ tròn"} head={["Phần", "Giá trị"]} rows={sl.slices.map((s) => [s.name, formatValue(s.value, format === "compact" ? "number" : format)])} />
        </div>
      );
    }
    default: {
      const data = toCartesian(inputs);
      const empty = data.series.every((s) => s.data.every((v) => v === null));
      if (!data.categories.length || empty) return <ChartMessage title="Chưa có dữ liệu" hint="Không có dòng nào khớp bộ lọc và khoảng thời gian của biểu đồ này." />;
      const compare = data.series.map((_, i) => !!chart.series[Math.min(i, chart.series.length - 1)]?.compare && chart.series.length === data.series.length);
      return wrap(
        <>
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <EChart option={cartesianOption({ chart, data, format, compare })} onPick={onPick} label={`${chart.title ?? "Biểu đồ"}: ${data.series.length} chuỗi, ${data.categories.length} nhóm`} />
          </Suspense>
          <A11yTable caption={chart.title ?? "Biểu đồ"} head={["Nhóm", ...data.series.map((s) => s.name)]} rows={data.categories.map((c, k) => [c, ...data.series.map((s) => formatValue(s.data[k] ?? null, format === "compact" ? "number" : format))])} />
        </>,
      );
    }
  }
}

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

function KpiCard({ chart, result, format, datahubId }: { chart: ChartDef; result: QueryResult; format: FormatName | null; datahubId: string }) {
  const row = result.rows[0];
  const s = chart.series[0]!;
  const bucket = chart.options?.sparkline;
  const field = s.time?.field ?? s.metric?.time?.field;
  const range = s.time?.range ?? s.metric?.time?.range;
  const spark = useQuery({
    queryKey: queryKey({ ...s, compare: undefined, target: undefined, time: { field, bucket, range } }, datahubId),
    queryFn: () => runQuery({ ...s, compare: undefined, target: undefined, time: { field, bucket, range } }, datahubId),
    enabled: !!bucket && !!field,
    staleTime: 30_000,
    retry: false,
  });
  if (!row) return <ChartMessage title="—" />;
  const text = formatValue(row.value, format === "compact" ? "compact" : format);
  const change = row.change_pct;
  const sp = spark.data?.rows ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col justify-center gap-1 px-1">
      <FitText text={text} />
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
