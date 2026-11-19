import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog } from "@/components/ui/form";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/dropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { createChart, dashKeys, deleteChart, getDashboard, saveLayout } from "@/lib/dashboard/api";
import { TYPE_LABELS, chartTitle } from "@/lib/dashboard/config";
import { bottom, defaultSizeOf, minSizeOf, type Item } from "@/lib/dashboard/layout";
import { CHART_TYPES, type ChartRecord, type ChartType, type DashboardFull } from "@/lib/dashboard/types";
import type { DatahubBrief } from "@/lib/datahub/types";
import { liveBus, type LiveSignal } from "@/lib/session";
import { ChartBody } from "./chart-body";
import { ChartConfigPanel } from "./chart-config";
import { DashboardGrid, type GridCard } from "./grid";

const DEFAULT_LAYOUT = { x: 0, y: 0, w: 6, h: 5 };

/** One dashboard: the grid of charts, the panel that configures one, and the reload when the numbers change. */
export function DashboardView({ dh, dashboardId }: { dh: DatahubBrief; dashboardId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: dashKeys.one(dashboardId), queryFn: () => getDashboard(dashboardId) });
  const [editing, setEditing] = useState<{ record: ChartRecord | null; type: ChartType; key: number } | null>(null);
  const [removing, setRemoving] = useState<ChartRecord | null>(null);

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

  // Layout: the screen shows the new layout at once (cache), and one save follows when the moves stop.
  const pending = useRef<Item[] | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    flush();
  }, [flush]);
  const commit = (items: Item[]) => {
    const by = new Map(items.map((i) => [i.id, i]));
    qc.setQueryData<DashboardFull>(dashKeys.one(dashboardId), (d) => (d ? { ...d, charts: d.charts.map((c) => ({ ...c, chart: { ...c.chart, layout: by.has(c.id) ? { x: by.get(c.id)!.x, y: by.get(c.id)!.y, w: by.get(c.id)!.w, h: by.get(c.id)!.h } : c.chart.layout } })) } : d));
    pending.current = items;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 400);
  };

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: dashKeys.one(dashboardId) });
    void qc.invalidateQueries({ queryKey: dashKeys.list(dh.id) });
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
    onSuccess: () => {
      notify.ok("Đã xoá biểu đồ");
      setRemoving(null);
      refresh();
    },
  });

  const cards: GridCard[] = useMemo(
    () =>
      (q.data?.charts ?? []).map((r, i) => ({
        id: r.id,
        layout: r.chart.layout ?? DEFAULT_LAYOUT,
        min: minSizeOf(r.chart.type),
        title: chartTitle(r.chart, i),
        menu: (
          <Menu trigger={<Button variant="ghost" aria-label={`Tuỳ chọn biểu đồ ${chartTitle(r.chart, i)}`} className="!px-1.5"><MoreHorizontal size={16} aria-hidden /></Button>}>
            <MenuItem onSelect={() => setEditing({ record: r, type: r.chart.type, key: Date.now() })}><Pencil size={16} aria-hidden /> Sửa biểu đồ</MenuItem>
            <MenuItem onSelect={() => dup.mutate(r)}><Copy size={16} aria-hidden /> Nhân bản</MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={() => setRemoving(r)}><Trash2 size={16} aria-hidden /> Xoá biểu đồ</MenuItem>
          </Menu>
        ),
        body: <ChartBody chart={r.chart} datahubId={dh.id} />,
      })),
    [q.data, dh.id, dup],
  );

  if (q.isLoading) return <Skeleton className="h-64 w-full" aria-busy="true" aria-label="Đang tải dashboard" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được dashboard" />;
  const d = q.data;

  return (
    <div className={editing ? "shrink-0 lg:pr-[30rem]" : "shrink-0"}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{d.name}</h2>
        <span className="text-sm text-muted-foreground">{d.charts.length} biểu đồ</span>
        <Menu trigger={<Button className="ml-auto" data-testid="add-chart"><Plus size={16} aria-hidden /> Thêm biểu đồ</Button>}>
          {CHART_TYPES.map((t) => (
            <MenuItem key={t} onSelect={() => setEditing({ record: null, type: t as ChartType, key: Date.now() })}>{TYPE_LABELS[t]}</MenuItem>
          ))}
        </Menu>
      </div>
      {d.charts.length === 0 ? (
        <EmptyState title="Dashboard chưa có biểu đồ" hint="Bấm Thêm biểu đồ, chọn loại, rồi chọn bảng và cách tính." />
      ) : (
        <>
          <h2 className="sr-only">Các biểu đồ</h2>
          <DashboardGrid cards={cards} onCommit={commit} />
        </>
      )}
      {editing && <ChartConfigPanel key={editing.key} dh={dh} dashboardId={dashboardId} record={editing.record} startType={editing.type} siblings={d.charts} onClose={() => { setEditing(null); refresh(); }} />}
      {removing && <ConfirmDialog title="Xoá biểu đồ?" message={<>Biểu đồ "{chartTitle(removing.chart)}" sẽ bị xoá khỏi dashboard này.</>} confirmLabel="Xoá biểu đồ" busy={del.isPending} onConfirm={() => del.mutate(removing)} onClose={() => setRemoving(null)} />}
    </div>
  );
}
