import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTouchRecent } from "@/lib/home";
import { Copy, Download, Image as ImageIcon, MoreHorizontal, Pencil, Plus, Rows3, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog } from "@/components/ui/form";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/dropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { createChart, dashKeys, deleteChart, getChartCsv, getDashboard, resetMyFilters, saveLayout, saveMyFilters, updateDashboard, viewDashboard } from "@/lib/dashboard/api";
import { crossFiltersOf } from "@/lib/dashboard/chart-data";
import { TYPE_LABELS, chartTitle } from "@/lib/dashboard/config";
import { bottom, defaultSizeOf, minSizeOf, type Item } from "@/lib/dashboard/layout";
import { CHART_TYPES, type ChartRecord, type ChartType, type DashFilters, type DashboardFull, type PickInfo, type ViewFilters } from "@/lib/dashboard/types";
import type { DatahubBrief } from "@/lib/datahub/types";
import { liveBus, type LiveSignal } from "@/lib/session";
import { ChartBody, useChartData } from "./chart-body";
import { ChartConfigPanel } from "./chart-config";
import { EmptyDashboard } from "./empty-dashboard";
import { FilterBar } from "./filter-bar";
import { DashboardGrid, type GridCard } from "./grid";
import type { ChartExport } from "./echart";
import { RowsDialog, downloadText } from "./rows-dialog";

const DEFAULT_LAYOUT = { x: 0, y: 0, w: 6, h: 5 };
/** Types drawn on an ECharts canvas: they can be saved as a picture. */
const CANVAS_TYPES = new Set<ChartType>(["column", "bar", "line", "area", "combo", "pie", "donut", "bullet", "gauge", "funnel", "boxplot", "histogram", "scatter", "matrix", "heatmap", "waterfall", "ranking", "cohort"]);

/** The tables a chart reads, for the small line under its title (only sources named by a table id or table; saved metrics say nothing). */
function sourceNames(chart: ChartRecord["chart"], dh: DatahubBrief | undefined): string {
  if (!dh) return "";
  const names = new Set<string>();
  for (const s of chart.series) {
    const src = s.metric?.source;
    const id = typeof src === "string" ? src : src?.table;
    const t = id ? dh.tables.find((x) => x.id === id) : undefined;
    if (t) names.add(t.name);
  }
  return [...names].join(", ");
}

interface RowsTarget {
  chartId: string;
  title: string;
  series: number;
  group: (string | number | boolean | null)[];
}

/** The menu of a chart card: viewing actions for everyone who may see the dashboard, editing actions for its owner. */
function CardMenu({ record, index, datahubId, filters, pick, owner, onEdit, onDuplicate, onRemove, onRows, onClearPick, exportRef }: {
  record: ChartRecord;
  index: number;
  datahubId: string;
  filters: ViewFilters;
  pick: PickInfo | undefined;
  owner: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onRows: (t: RowsTarget) => void;
  onClearPick: () => void;
  exportRef: { current: ChartExport | null };
}) {
  const chart = record.chart;
  const title = chartTitle(chart, index);
  const q = useChartData(chart, { datahubId, chartId: record.id, version: record.version, filters });
  const canRows = !!q.data?.can_view_rows;
  const series = pick?.series ?? q.data?.rows_series ?? 0;
  const group = pick ? pick.groups.map((g) => g.value) : [];
  const csv = useMutation({
    mutationFn: () => getChartCsv(record.id, series, group, filters),
    onSuccess: (r) => {
      downloadText(r.filename, r.csv, "text/csv;charset=utf-8");
      notify.ok(`Đã xuất ${r.rows} dòng. ${r.note}${r.truncated ? " File dừng ở 5.000 dòng đầu." : ""}`);
    },
    onError: (e) => notify.error(e instanceof Error ? e.message : "Không xuất được CSV."),
  });
  const png = () => {
    const x = exportRef.current;
    if (!x) {
      notify.error("Biểu đồ chưa vẽ xong, thử lại sau một chút.");
      return;
    }
    const a = document.createElement("a");
    a.href = x.png();
    a.download = `${title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "bieu-do"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  return (
    <Menu trigger={<Button variant="ghost" aria-label={`Tuỳ chọn biểu đồ ${title}`} className="!px-1.5"><MoreHorizontal size={16} aria-hidden /></Button>}>
      {canRows && <MenuItem onSelect={() => onRows({ chartId: record.id, title, series, group })}><Rows3 size={16} aria-hidden /> Xem các dòng{pick ? " của phần đang chọn" : ""}</MenuItem>}
      {canRows && <MenuItem onSelect={() => csv.mutate()}><Download size={16} aria-hidden /> Xuất CSV</MenuItem>}
      {CANVAS_TYPES.has(chart.type) && <MenuItem onSelect={png}><ImageIcon size={16} aria-hidden /> Xuất PNG</MenuItem>}
      {pick && <MenuItem onSelect={onClearPick}><X size={16} aria-hidden /> Bỏ lọc chéo từ biểu đồ này</MenuItem>}
      {owner && (canRows || CANVAS_TYPES.has(chart.type) || pick) && <MenuSeparator />}
      {owner && <MenuItem onSelect={onEdit}><Pencil size={16} aria-hidden /> Sửa biểu đồ</MenuItem>}
      {owner && <MenuItem onSelect={onDuplicate}><Copy size={16} aria-hidden /> Nhân bản</MenuItem>}
      {owner && <MenuSeparator />}
      {owner && <MenuItem danger onSelect={onRemove}><Trash2 size={16} aria-hidden /> Xoá biểu đồ</MenuItem>}
      {!owner && !canRows && !CANVAS_TYPES.has(chart.type) && !pick && <MenuItem disabled>Không có thao tác</MenuItem>}
    </Menu>
  );
}

/**
 * One dashboard: the grid of charts, the common filters, cross filtering, the rows behind a number, and (for the owner) editing.
 * `mode = "viewer"` is for a person it was shared with, or a Guest: the same page without any editing.
 */
export function DashboardView({ dh, dashboardId, mode = "owner", period, mature, recent = true, header = true }: {
  dh?: DatahubBrief;
  dashboardId: string;
  mode?: "owner" | "viewer";
  /** Quản lý Deal: the shared period replaces the date range of the filter bar (module4 11a). `from`/`to` are the dates the server resolved for it. */
  period?: { range: unknown; from: string | null; to: string | null } | null;
  /** Cohort charts of deals (`options.mature_cohort`): months after `through` are drawn pale; with `cut` the range stops at `through`. */
  mature?: { through: string | null; cut: boolean } | null;
  /** Record this dashboard in the person's "Mở gần đây" when it is shown (off where it is only a preview, like the home page). */
  recent?: boolean;
  /** The viewer's title line ("Của ...; số liệu tính theo quyền của họ"); a host that prints its own header turns it off. */
  header?: boolean;
}) {
  const qc = useQueryClient();
  useTouchRecent("dashboard", recent ? dashboardId : null);
  const owner = mode === "owner";
  const q = useQuery({ queryKey: owner ? dashKeys.one(dashboardId) : ["mt-dashboard-view", dashboardId], queryFn: () => (owner ? getDashboard(dashboardId) : viewDashboard(dashboardId)) });
  const [editing, setEditing] = useState<{ record: ChartRecord | null; type: ChartType; key: number } | null>(null);
  const [removing, setRemoving] = useState<ChartRecord | null>(null);
  const [rows, setRows] = useState<RowsTarget | null>(null);
  const datahubId = q.data?.datahub_id ?? dh?.id ?? "";

  // ---- the common filters: the viewer's own copy when there is one, else the default of the owner ----
  const [filters, setFilters] = useState<DashFilters | null>(null);
  const [custom, setCustom] = useState(false);
  const [picks, setPicks] = useState<Record<string, PickInfo>>({});
  const d0 = q.data;
  useEffect(() => {
    if (!d0) return;
    setFilters(d0.my_filters ?? d0.default_filters ?? {});
    setCustom(d0.my_filters !== null);
    // the filters are read once per dashboard (and again after "Về mặc định"); later answers must not overwrite what the person is typing
  }, [dashboardId, d0?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeFilters = (next: DashFilters) => {
    setFilters(next);
    setCustom(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveMyFilters(dashboardId, next).catch(() => notify.error("Không lưu được bộ lọc của bạn.")), 500);
  };
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  const reset = useMutation({
    mutationFn: async () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await resetMyFilters(dashboardId);
    },
    onSuccess: () => {
      setFilters(d0?.default_filters ?? {});
      setCustom(false);
      void qc.invalidateQueries({ queryKey: owner ? dashKeys.one(dashboardId) : ["mt-dashboard-view", dashboardId] });
    },
  });
  const saveDefault = useMutation({
    mutationFn: async () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const fresh = await getDashboard(dashboardId);
      await updateDashboard(dashboardId, fresh.version, { filters: (filters && (filters.range || filters.conditions?.length) ? filters : null) as DashFilters | null });
      await resetMyFilters(dashboardId);
    },
    onSuccess: () => {
      setCustom(false);
      notify.ok("Đã lưu làm bộ lọc mặc định");
      void qc.invalidateQueries({ queryKey: dashKeys.one(dashboardId) });
    },
    onError: (e) => notify.error(e instanceof Error ? e.message : "Không lưu được."),
  });

  const cross = useMemo(() => Object.entries(picks).flatMap(([chartId, p]) => crossFiltersOf(p, chartId)), [picks]);
  const range = period?.range ?? filters?.range;
  const viewFilters: ViewFilters = useMemo(() => ({ ...(range ? { range } : {}), ...(filters?.conditions?.length ? { conditions: filters.conditions } : {}), ...(cross.length ? { cross } : {}) }), [filters, cross, range]);
  // A cohort chart that cuts at the mature month: the range of the period, ended at the cut-off the server gave (dates only compared, nothing computed).
  const filtersFor = useCallback(
    (chart: ChartRecord["chart"]): ViewFilters | null => {
      if (!mature?.cut || !mature.through || !chart.options?.mature_cohort) return viewFilters;
      // The whole period is after the cut-off: no cohort of it is mature, so there is nothing to ask for.
      if (period?.from && period.from > mature.through) return null;
      const to = period?.to && period.to < mature.through ? period.to : mature.through;
      return { ...viewFilters, range: { kind: "between", ...(period?.from ? { from: period.from } : {}), to } };
    },
    [viewFilters, mature, period],
  );
  const pickChart = useCallback((chartId: string) => (pick: PickInfo) => {
    setPicks((p) => {
      const cur = p[chartId];
      // a second click on the same element lifts the filter
      if (cur && JSON.stringify(cur.groups) === JSON.stringify(pick.groups) && cur.series === pick.series) {
        const { [chartId]: _gone, ...rest } = p;
        void _gone;
        return rest;
      }
      return { ...p, [chartId]: pick };
    });
  }, []);

  // The numbers change when rows, formulas, sharing or the tree change: the worker clears the cache and signals. One import sends many
  // signals, so reload once after they stop.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const on = (e: Event) => {
      if ((e as CustomEvent<LiveSignal>).detail.event !== "metrics.data.changed") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void qc.invalidateQueries({ queryKey: dashKeys.query }), 600);
    };
    liveBus.addEventListener("signal", on);
    return () => {
      liveBus.removeEventListener("signal", on);
      if (timer) clearTimeout(timer);
    };
  }, [qc]);

  // Layout (owner): the screen shows the new layout at once (cache), and one save follows when the moves stop.
  const pending = useRef<Item[] | null>(null);
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    const items = pending.current;
    pending.current = null;
    if (!items) return;
    void saveLayout(dashboardId, items.map((i) => ({ chart_id: i.id, layout: { x: i.x, y: i.y, w: i.w, h: i.h } }))).catch(() => {
      notify.error("Không lưu được vị trí biểu đồ. Tải lại trang để lấy bố cục đã lưu.");
      void qc.invalidateQueries({ queryKey: dashKeys.one(dashboardId) });
    });
  }, [dashboardId, qc]);
  useEffect(() => () => {
    if (layoutTimer.current) clearTimeout(layoutTimer.current);
    flush();
  }, [flush]);
  const commit = (items: Item[]) => {
    const by = new Map(items.map((i) => [i.id, i]));
    qc.setQueryData<DashboardFull>(dashKeys.one(dashboardId), (d) => (d ? { ...d, charts: d.charts.map((c) => ({ ...c, chart: { ...c.chart, layout: by.has(c.id) ? { x: by.get(c.id)!.x, y: by.get(c.id)!.y, w: by.get(c.id)!.w, h: by.get(c.id)!.h } : c.chart.layout } })) } : d));
    pending.current = items;
    if (layoutTimer.current) clearTimeout(layoutTimer.current);
    layoutTimer.current = setTimeout(flush, 400);
  };

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: dashKeys.one(dashboardId) });
    if (dh) void qc.invalidateQueries({ queryKey: dashKeys.list(dh.id) });
  };
  const dup = useMutation({
    mutationFn: async (r: ChartRecord) => {
      const items = (q.data?.charts ?? []).map((c) => ({ id: c.id, ...(c.chart.layout ?? DEFAULT_LAYOUT) }));
      const size = r.chart.layout ?? { ...DEFAULT_LAYOUT, ...defaultSizeOf(r.chart.type) };
      await createChart(dashboardId, { ...r.chart, layout: { x: 0, y: bottom(items), w: size.w, h: size.h } });
    },
    onSuccess: () => {
      notify.ok("Đã nhân bản biểu đồ");
      refresh();
    },
    onError: (e) => notify.error(e instanceof Error ? e.message : "Không nhân bản được biểu đồ."),
  });
  const del = useMutation({
    mutationFn: (r: ChartRecord) => deleteChart(r.id),
    onSuccess: (_r, r) => {
      notify.ok("Đã xoá biểu đồ");
      setRemoving(null);
      setPicks((p) => {
        const { [r.id]: _gone, ...rest } = p;
        void _gone;
        return rest;
      });
      refresh();
    },
  });

  const exportRefs = useRef(new Map<string, { current: ChartExport | null }>());
  const refOf = (id: string) => {
    let r = exportRefs.current.get(id);
    if (!r) exportRefs.current.set(id, (r = { current: null }));
    return r;
  };

  const cards: GridCard[] = useMemo(
    () =>
      (q.data?.charts ?? []).map((r, i) => ({
        id: r.id,
        layout: r.chart.layout ?? DEFAULT_LAYOUT,
        min: minSizeOf(r.chart.type),
        title: chartTitle(r.chart, i),
        subtitle: sourceNames(r.chart, dh),
        menu: (
          <CardMenu
            record={r}
            index={i}
            datahubId={datahubId}
            filters={filtersFor(r.chart) ?? viewFilters}
            pick={picks[r.id]}
            owner={owner}
            exportRef={refOf(r.id)}
            onEdit={() => setEditing({ record: r, type: r.chart.type, key: Date.now() })}
            onDuplicate={() => dup.mutate(r)}
            onRemove={() => setRemoving(r)}
            onRows={setRows}
            onClearPick={() => setPicks((p) => { const { [r.id]: _g, ...rest } = p; void _g; return rest; })}
          />
        ),
        body: filtersFor(r.chart) === null ? (
          <p className="px-1 text-sm text-muted-foreground" data-testid="no-mature-cohort">Chưa có cohort nào của kỳ này đã chín theo mốc đang chọn. Bỏ chọn "Chỉ tính cohort đã chín" để xem số tạm tính.</p>
        ) : (
          <ChartBody
            chart={r.chart}
            datahubId={datahubId}
            chartId={r.id}
            version={r.version}
            filters={filtersFor(r.chart) ?? undefined}
            matureThrough={mature?.through ?? null}
            onPick={r.chart.options?.ignore_cross === true ? undefined : pickChart(r.id)}
            exportRef={refOf(r.id)}
            onOpenRows={() => setRows({ chartId: r.id, title: chartTitle(r.chart, i), series: 0, group: [] })}
          />
        ),
      })),
    [q.data, datahubId, filtersFor, viewFilters, mature, picks, owner, dup, pickChart, dh],
  );

  if (q.isLoading) return <Skeleton className="h-64 w-full" aria-busy="true" aria-label="Đang tải dashboard" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được dashboard" />;
  const d = q.data;
  const pickList = Object.entries(picks).flatMap(([chartId, pick]) => {
    const i = d.charts.findIndex((c) => c.id === chartId);
    return i < 0 ? [] : [{ chartId, title: chartTitle(d.charts[i]!.chart, i), pick }];
  });
  const defaults = d.default_filters ?? {};
  const trailing = (
    <>
      <span className="text-sm text-muted-foreground">{d.charts.length} biểu đồ</span>
      {owner && (
        <Menu trigger={<Button data-testid="add-chart"><Plus size={16} aria-hidden /> Thêm biểu đồ</Button>}>
          {CHART_TYPES.map((t) => (
            <MenuItem key={t} onSelect={() => setEditing({ record: null, type: t as ChartType, key: Date.now() })}>{TYPE_LABELS[t]}</MenuItem>
          ))}
        </Menu>
      )}
    </>
  );

  return (
    <div className={editing ? "shrink-0 lg:pr-[30rem]" : "shrink-0"}>
      {!owner && header && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{d.name}</h2>
          <span className="text-sm text-muted-foreground" data-testid="dash-owner">Của {d.owner_name ?? "người khác"} · {d.datahub_name}. Số liệu tính theo quyền của họ.</span>
        </div>
      )}
      {owner && <h2 className="sr-only">{d.name}</h2>}
      {d.charts.length > 0 ? (
        <FilterBar
          fields={d.fields}
          value={filters ?? defaults}
          onChange={changeFilters}
          custom={custom}
          onReset={() => reset.mutate()}
          onSaveDefault={owner ? () => saveDefault.mutate() : undefined}
          exactText={!owner}
          rangeLocked={!!period}
          picks={pickList}
          onClearPick={(id) => setPicks((p) => { const { [id]: _g, ...rest } = p; void _g; return rest; })}
          onClearPicks={() => setPicks({})}
          trailing={trailing}
        />
      ) : (
        owner && <div className="mb-4 flex items-center justify-end gap-3 rounded-card border border-border-soft bg-card p-2.5 shadow-sm">{trailing}</div>
      )}
      {d.charts.length === 0 ? (
        <EmptyDashboard owner={owner} dh={dh} onPick={(t) => setEditing({ record: null, type: t, key: Date.now() })} />
      ) : (
        <>
          <h2 className="sr-only">Các biểu đồ</h2>
          <DashboardGrid cards={cards} onCommit={commit} readOnly={!owner} />
        </>
      )}
      {owner && editing && dh && <ChartConfigPanel key={editing.key} dh={dh} dashboardId={dashboardId} record={editing.record} startType={editing.type} siblings={d.charts} onClose={() => { setEditing(null); refresh(); }} />}
      {removing && <ConfirmDialog title="Xoá biểu đồ?" message={<>Biểu đồ "{chartTitle(removing.chart)}" sẽ bị xoá khỏi dashboard này.</>} confirmLabel="Xoá biểu đồ" busy={del.isPending} onConfirm={() => del.mutate(removing)} onClose={() => setRemoving(null)} />}
      {rows && <RowsDialog chartId={rows.chartId} title={rows.title} series={rows.series} group={rows.group} filters={viewFilters} onClose={() => setRows(null)} />}
    </div>
  );
}
