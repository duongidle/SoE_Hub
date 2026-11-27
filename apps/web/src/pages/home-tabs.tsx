import { closestCenter, DndContext, MouseSensor, type DragEndEvent, useSensor, useSensors } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, LayoutDashboard, MoreHorizontal, Pin, PinOff, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/form";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/dropdown";
import { Popover } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { listSharedDashboards } from "@/lib/dashboard/api";
import { homeKeys, listMyDashboards, listTabs, saveTabs, type PinnedTab } from "@/lib/home";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";
import { can, useMe } from "@/lib/session";
import { DashboardView } from "@/pages/datahub/dashboard/dashboard-view";

/** The most dashboards one person can pin (same limit as the server). */
const TABS_MAX = 20;
const SHARED = "shared";
const tabClass = (on: boolean) => cn("flex h-10 max-w-52 -mb-px items-center gap-1.5 whitespace-nowrap rounded-t-control border-b-2 px-3 text-sm transition-colors", on ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground");

function PinnedTabButton({ tab, on, pos, onSelect }: { tab: PinnedTab; on: boolean; pos: number; onSelect: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  // The open tab always comes into view (a phone shows two or three tabs at a time).
  useEffect(() => {
    if (!on) return;
    // After the reorder animation of the strip has settled, so the position it measures is the final one.
    const id = window.setTimeout(() => btn.current?.scrollIntoView({ block: "nearest", inline: "nearest" }), 260);
    return () => window.clearTimeout(id);
  }, [on, pos]); // a reorder moves the open tab too, so it comes back into view
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  // Only the mouse drags (the strip scrolls with touch); the menu of the open tab has "Chuyển sang trái / phải" for the keyboard and the phone.
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("shrink-0", isDragging && "z-10 opacity-80")} {...attributes} {...listeners} tabIndex={-1} role="presentation">
      <button ref={btn} type="button" role="tab" aria-selected={on} onClick={onSelect} title={tab.name} data-testid="home-tab" className={tabClass(on)}>
        <LayoutDashboard size={14} aria-hidden className="shrink-0" />
        <span className="truncate">{tab.name}</span>
      </button>
    </div>
  );
}

function PinPicker({ pinned, onPin }: { pinned: Set<string>; onPin: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: homeKeys.mine, queryFn: listMyDashboards });
  const free = (q.data ?? []).filter((d) => !pinned.has(d.id));
  const full = pinned.size >= TABS_MAX;
  return (
    <Popover
      label="Ghim dashboard"
      open={open}
      onOpenChange={setOpen}
      width="w-80"
      trigger={
        <Button variant="ghost" aria-label="Ghim dashboard" title="Ghim dashboard" className="ml-1 shrink-0 !text-primary" data-testid="pin-dashboard">
          <Pin size={16} aria-hidden /> <span className="hidden sm:inline">Ghim dashboard</span>
        </Button>
      }
    >
      <div className="max-h-80 overflow-y-auto">
        {q.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : q.error ? (
          <p className="p-2 text-sm text-bad">Không tải được danh sách dashboard của bạn.</p>
        ) : (q.data ?? []).length === 0 ? (
          <div className="flex flex-col items-start gap-2 p-2 text-sm">
            <p className="text-muted-foreground">Bạn chưa có dashboard nào. Tạo dashboard trong một datahub rồi ghim về đây.</p>
            <Link to="/datahub" className="font-medium text-primary hover:underline">Mở Datahub</Link>
          </div>
        ) : free.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">Mọi dashboard của bạn đã được ghim.</p>
        ) : (
          <ul className="flex flex-col" aria-label="Dashboard của tôi">
            {full && <li className="px-2 py-1 text-xs text-muted-foreground">Đã ghim tối đa {TABS_MAX} dashboard. Bỏ ghim bớt để thêm.</li>}
            {free.map((d) => (
              <li key={d.id}>
                <button type="button" disabled={full} onClick={() => { setOpen(false); onPin(d.id); }} className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-primary-soft disabled:opacity-50" data-testid="pin-option">
                  <LayoutDashboard size={16} aria-hidden className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{d.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{d.datahub_name}</span>
                  </span>
                  <Pin size={14} aria-hidden className="shrink-0 text-primary" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}

/** Dashboards other people shared with me (and, for a Guest, the ones opened to the data they hold). */
function SharedPane({ open, onOpen }: { open: string; onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ["mt-shared-dashboards"], queryFn: listSharedDashboards });
  if (open) {
    return (
      <div>
        <button type="button" onClick={() => onOpen("")} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="shared-back">
          <ChevronLeft size={16} aria-hidden /> Dashboard được chia sẻ
        </button>
        <DashboardView key={open} dashboardId={open} mode="viewer" />
      </div>
    );
  }
  if (q.isLoading) return <Skeleton className="h-24 w-full" aria-busy="true" aria-label="Đang tải danh sách" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được danh sách dashboard" />;
  if ((q.data ?? []).length === 0) {
    return <EmptyState title="Chưa có dashboard nào được chia sẻ cho bạn" hint="Khi ai đó chia sẻ dashboard, nó hiện ở đây. Số liệu được tính theo quyền của người chia sẻ." />;
  }
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">Số liệu trên các dashboard này được tính theo quyền của người chia sẻ. Bạn không cần quyền xem các bảng dữ liệu nguồn.</p>
      <ul className="grid gap-2 md:grid-cols-2" data-testid="shared-dashboards">
        {q.data!.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => onOpen(d.id)} className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 text-left hover:border-primary-border hover:bg-primary-soft/40" data-testid="shared-dashboard">
              <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                <LayoutDashboard size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium [overflow-wrap:anywhere]">{d.name}</span>
                <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">Của {d.owner_name ?? "người khác"} · {d.datahub_name}</span>
              </span>
              {d.role === "guest" && <Badge>Được cấp cho Guest</Badge>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One pinned dashboard: its own header (name, where it lives, a link to open and edit it) over the same bento canvas as the datahub's Dashboard mode. */
function PinnedPane({ tab, menu }: { tab: PinnedTab; menu: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold [overflow-wrap:anywhere]">{tab.name}</span>
          <Badge>{tab.datahub_name}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Link to="/datahub/$datahubId/dashboard/$dashboardId" params={{ datahubId: tab.datahub_id, dashboardId: tab.id }} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline" data-testid="home-open-dashboard">
            Mở dashboard <ArrowUpRight size={13} aria-hidden />
          </Link>
          {menu}
        </div>
      </div>
      <div className="rounded-card border border-border-soft bg-workspace p-3 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px] sm:p-4" data-testid="home-dashboard-canvas">
        <DashboardView key={tab.id} dashboardId={tab.id} mode="viewer" header={false} recent={false} />
      </div>
    </div>
  );
}

/** The dashboard area of the home page: "Được chia sẻ" first, then the person's own pinned dashboards (order and pins are saved on the server). */
export function DashboardTabs() {
  const me = useMe().data;
  const qc = useQueryClient();
  const [sp, setSp] = useUrlState({ tab: "", open: "" });
  const tabsQ = useQuery({ queryKey: homeKeys.tabs, queryFn: listTabs });
  const tabs = tabsQ.data ?? [];
  const canPin = can(me, "datahub:datahub:use");

  const save = useMutation({
    mutationFn: (ids: string[]) => saveTabs(ids),
    onError: () => notify.error("Không lưu được các tab đã ghim. Thử lại."),
    onSettled: () => void qc.invalidateQueries({ queryKey: homeKeys.tabs }),
  });
  const commit = (next: PinnedTab[]) => {
    qc.setQueryData(homeKeys.tabs, next);
    save.mutate(next.map((t) => t.id));
  };

  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = tabs.findIndex((t) => t.id === e.active.id);
    const to = tabs.findIndex((t) => t.id === e.over!.id);
    if (from >= 0 && to >= 0) commit(arrayMove(tabs, from, to));
  };

  // Default: the first pinned dashboard when there is one, else the shared list.
  const active = sp.tab === SHARED ? SHARED : tabs.find((t) => t.id === sp.tab)?.id ?? tabs[0]?.id ?? SHARED;
  const current = tabs.find((t) => t.id === active) ?? null;
  const index = current ? tabs.indexOf(current) : -1;
  const select = (id: string) => setSp({ tab: id, open: "" });

  const pin = async (id: string) => {
    const mine = await qc.fetchQuery({ queryKey: homeKeys.mine, queryFn: listMyDashboards });
    const d = mine.find((x) => x.id === id);
    if (!d) return;
    commit([...tabs, { id: d.id, name: d.name, datahub_id: d.datahub_id, datahub_name: d.datahub_name, role: "owner" }]);
    setSp({ tab: id, open: "" });
    notify.ok(`Đã ghim "${d.name}"`);
  };
  const unpin = (t: PinnedTab) => {
    commit(tabs.filter((x) => x.id !== t.id));
    setSp({ tab: SHARED, open: "" });
    notify.ok(`Đã bỏ ghim "${t.name}"`);
  };

  const menu = current && (
    <Menu
      trigger={
        <Button variant="ghost" aria-label={`Tuỳ chọn tab ${current.name}`} className="!px-1.5">
          <MoreHorizontal size={16} aria-hidden />
        </Button>
      }
    >
      <MenuItem disabled={index <= 0} onSelect={() => commit(arrayMove(tabs, index, index - 1))}>
        <ChevronLeft size={16} aria-hidden /> Chuyển sang trái
      </MenuItem>
      <MenuItem disabled={index >= tabs.length - 1} onSelect={() => commit(arrayMove(tabs, index, index + 1))}>
        <ChevronRight size={16} aria-hidden /> Chuyển sang phải
      </MenuItem>
      <MenuSeparator />
      <MenuItem danger onSelect={() => unpin(current)}>
        <PinOff size={16} aria-hidden /> Bỏ ghim
      </MenuItem>
    </Menu>
  );

  return (
    <section className="min-w-0" aria-label="Dashboard" data-testid="home-dashboards">
      <div className="flex items-center gap-1 border-b border-border-soft">
      <div role="tablist" aria-label="Dashboard" className="flex min-w-0 flex-1 items-center gap-1">
        {/* "Được chia sẻ" stays outside the scrolling part, so a long row of pinned tabs can never push it out of sight. */}
        <button type="button" role="tab" aria-selected={active === SHARED} onClick={() => select(SHARED)} className={cn(tabClass(active === SHARED), "shrink-0")} data-testid="home-tab-shared">
          <Users size={14} aria-hidden /> Được chia sẻ
        </button>
        {tabs.length > 0 && <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
            {tabs.map((t, i) => (
              <PinnedTabButton key={t.id} tab={t} on={t.id === active} pos={i} onSelect={() => select(t.id)} />
            ))}
          </SortableContext>
        </DndContext>
        </div>
      </div>
        {canPin && <PinPicker pinned={new Set(tabs.map((t) => t.id))} onPin={(id) => void pin(id)} />}
      </div>
      <div className="pt-4">
        {tabsQ.isLoading ? (
          <Skeleton className="h-64 w-full" aria-busy="true" aria-label="Đang tải dashboard" />
        ) : tabsQ.error ? (
          <ErrorState error={tabsQ.error} onRetry={() => void tabsQ.refetch()} title="Không tải được các tab dashboard" />
        ) : current ? (
          <PinnedPane tab={current} menu={menu} />
        ) : (
          <SharedPane open={sp.open} onOpen={(id) => setSp({ tab: SHARED, open: id })} />
        )}
        {!tabsQ.isLoading && !tabsQ.error && !current && canPin && tabs.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">Muốn thấy dashboard của mình ngay khi vào hệ thống? Bấm "Ghim dashboard" ở trên để thêm tab riêng.</p>
        )}
      </div>
    </section>
  );
}
