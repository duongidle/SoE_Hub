import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { BarChart3, CalendarCheck, Check, ChevronDown, MoreHorizontal, Pencil, Plus, Settings2, Table2, Trash2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Menu, MenuCheckItem, MenuItem } from "@/components/ui/dropdown";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, Input, PageTitle } from "@/components/ui/form";
import { Popover } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, NoAccessState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { createTable, deleteTable, updateTable } from "@/lib/datahub/api";
import { dealKeys, getDealHome, getPrefs, setPrefs, type DealTable } from "@/lib/datahub/deal-api";
import { can, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ScrollStrip, segCls, tabCls, TableNameDialog } from "../datahub/detail";
import { TableView } from "../datahub/table-view";
import { SharedPeriodContext, SharedPeriodControlContext, TableMenuExtraContext, useSharedPeriodState } from "@/lib/datahub/deal-view";
import { PeriodButton, type PeriodScope } from "./period-bar";
import { DealDashboard } from "./dashboard";

/** The three pages next to the tables, as quiet buttons in the top bar (the page has no main button of its own: the table brings "Thêm dòng"). */
const LINK_BTN = "inline-flex min-h-8 items-center gap-1.5 rounded-control border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted";

/** `/quan-ly-deal/:tableId`: the tables of the menu Quản lý Deal (template tables first, then your own) and the open one. Module 4 mục 1.1, 16. */
export function DealHomePage({ dashboard = false }: { dashboard?: boolean } = {}) {
  const { tableId } = useParams({ strict: false }) as { tableId?: string };
  const nav = useNavigate();
  const q = useQuery({ queryKey: dealKeys.home, queryFn: getDealHome });
  const home = q.data;

  useEffect(() => {
    if (home && !dashboard && !tableId && home.tables[0]) void nav({ to: "/quan-ly-deal/$tableId", params: { tableId: home.tables[0].id }, replace: true });
  }, [home, tableId, nav, dashboard]);

  if (q.isLoading) return <div className="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải"><Skeleton className="h-8 w-64" /><Skeleton className="h-9 w-full max-w-xl" /><Skeleton className="h-64 w-full" /></div>;
  if (q.error || !home) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được Quản lý Deal" />;
  return <DealBody home={home} tableId={tableId} dashboard={dashboard} />;
}

/** `/quan-ly-deal/dashboard`: the default Deals dashboard in the menu of Quản lý Deal. */
export const DealDashboardPage = () => <DealHomePage dashboard />;

function DealBody({ home, tableId, dashboard }: { home: { datahub_id: string | null; tables: DealTable[] }; tableId?: string; dashboard: boolean }) {
  const meQ = useMe();
  const me = meQ.data;
  const current = home.tables.find((t) => t.id === tableId);
  const canTemplate = can(me, "datahub:template:write");
  const roles = me?.user.roles ?? [];
  // "Cho phép leader sửa deal của tôi" matters to someone who has a Leader (a User, or a Leader with a Manager).
  const hasLeader = !!me?.user.leader_id || !!me?.user.manager_id;
  const isDealTable = (current?.template_kind ?? null) === "shared";
  const period = useSharedPeriodState();
  const role = current?.role_set;
  const scope: PeriodScope = dashboard ? "dashboard" : role === "deals" || role === "index" || role === "kpi" ? role : "other";
  return (
    <SharedPeriodContext.Provider value={period.value}>
    <SharedPeriodControlContext.Provider value={period}>
    <TableMenuExtraContext.Provider value={isDealTable && hasLeader && !roles.includes("manager") ? <LeaderEditMenuItem /> : null}>
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageTitle
        actions={
          <>
            {home.tables.some((t) => t.role_set === "payments") && (
              <Link to="/quan-ly-deal/thanh-toan" data-testid="open-payments-page" className={LINK_BTN}>
                <Wallet size={16} aria-hidden /> Thanh toán và com
              </Link>
            )}
            {can(me, "deal:payment:write") && (
              <Link to="/quan-ly-deal/chot-ky" data-testid="open-period-page" className={LINK_BTN}>
                <CalendarCheck size={16} aria-hidden /> Chốt kỳ
              </Link>
            )}
            {canTemplate && (
              <Link to="/quan-ly-deal/template" data-testid="open-template-page" className={LINK_BTN}>
                <Settings2 size={16} aria-hidden /> Template
              </Link>
            )}
          </>
        }
      >
        Quản lý Deal
      </PageTitle>
      <DealTabs home={home} currentId={dashboard ? undefined : tableId} dashboard={dashboard} extra={dashboard ? <PeriodButton state={period} scope={scope} showRule={false} /> : null} />
      {dashboard ? (
        period.loading ? <Skeleton className="h-64 w-full" /> : <DealDashboard home={home} period={period} />
      ) : home.tables.length === 0 ? (
        <EmptyState title="Chưa có bảng nào" hint="Bảng mặc định (Deals, Index...) do Manager của cây dựng ở trang Template. Bạn vẫn tạo được bảng riêng của mình." />
      ) : !current ? (
        tableId ? <NoAccessState title="Không mở được bảng" hint="Bảng này không tồn tại, đã bị lưu trữ, hoặc không còn trong phạm vi của bạn." /> : <Skeleton className="h-64 w-full" />
      ) : (
        // Wait for the period so the table is read once, with the period already in its query.
        period.loading ? <Skeleton className="h-64 w-full" /> : <TableView key={current.id} tableId={current.id} />
      )}
    </div>
    </TableMenuExtraContext.Provider>
    </SharedPeriodControlContext.Provider>
    </SharedPeriodContext.Provider>
  );
}

/** Module 4 mục 4.3: a Leader edits the deals of the team only for people who switched this on (a per-person setting, stored by `datahub.prefs.set`). */
function LeaderEditMenuItem() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: dealKeys.prefs, queryFn: getPrefs });
  const m = useMutation({
    mutationFn: (v: boolean) => setPrefs(v),
    onSuccess: (r) => {
      qc.setQueryData(dealKeys.prefs, r);
      notify.ok(r.leader_can_edit ? "Leader của bạn sửa được deal của bạn" : "Leader của bạn chỉ xem deal của bạn");
    },
    onError: () => notify.error("Không lưu được. Thử lại."),
  });
  return (
    <MenuCheckItem data-testid="leader-can-edit" disabled={q.isLoading || m.isPending} checked={q.data?.leader_can_edit === true} onCheckedChange={(v) => m.mutate(v === true)}>
      Cho phép leader sửa deal của tôi
    </MenuCheckItem>
  );
}

function DealTabs({ home, currentId, dashboard, extra }: { home: { datahub_id: string | null; tables: DealTable[] }; currentId?: string; dashboard: boolean; extra?: React.ReactNode }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [dialog, setDialog] = useState<{ kind: "add" } | { kind: "rename"; t: DealTable } | { kind: "delete"; t: DealTable } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: dealKeys.home });
  const del = useMutation({
    mutationFn: (t: DealTable) => deleteTable(t.id),
    onSuccess: async (_r, t) => {
      await refresh();
      setDialog(null);
      notify.ok(`Đã xoá bảng "${t.name}"`);
      if (t.id === currentId) void nav({ to: "/quan-ly-deal" });
    },
  });
  const hasDeals = home.tables.some((t) => t.role_set === "deals");
  return (
    <>
      {/* The same strip as a datahub (12C): the "Dữ liệu | Dashboard" switch, "Bảng ▾ (n)", "+", then the tables as tabs that scroll sideways. */}
      <div className="flex min-w-0 flex-wrap items-center gap-1 sm:flex-nowrap">
        {hasDeals && (
          <div role="group" aria-label="Chế độ xem" className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
            <Link to="/quan-ly-deal" aria-current={dashboard ? undefined : "page"} className={segCls(!dashboard)}>
              <Table2 size={14} aria-hidden /> Dữ liệu
            </Link>
            <Link to="/quan-ly-deal/dashboard" aria-current={dashboard ? "page" : undefined} data-testid="deal-dashboard-tab" className={segCls(dashboard)}>
              <BarChart3 size={14} aria-hidden /> Dashboard
            </Link>
          </div>
        )}
        {!dashboard && (
          <div role="tablist" aria-label="Các bảng Quản lý Deal" className="flex min-w-0 basis-full items-center gap-1 sm:flex-1 sm:basis-0">
            {home.datahub_id && (
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" aria-label="Thêm bảng" title="Thêm bảng" className="!px-2" onClick={() => setDialog({ kind: "add" })}><Plus size={16} aria-hidden /></Button>
                <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
              </div>
            )}
            <DealTableList home={home} currentId={currentId} />
            <ScrollStrip activeKey={currentId}>
              {home.tables.map((t) => {
                const on = t.id === currentId;
                const mine = t.template_id === null;
                return (
                  <div key={t.id} className={cn("flex shrink-0 items-center rounded-lg", on && "bg-primary-soft")}>
                    <Link to="/quan-ly-deal/$tableId" params={{ tableId: t.id }} role="tab" aria-selected={on} title={t.name} className={cn(tabCls(on), "max-w-48 truncate bg-transparent", on && mine && "pr-1")}>
                      <span className="truncate">{t.name}</span>
                    </Link>
                    {mine && on && (
                      <Menu trigger={<Button variant="ghost" aria-label={`Tuỳ chọn bảng ${t.name}`} className="!min-h-8 !px-1.5"><MoreHorizontal size={16} aria-hidden /></Button>} align="start">
                        <MenuItem onSelect={() => setDialog({ kind: "rename", t })}><Pencil size={16} aria-hidden /> Đổi tên bảng</MenuItem>
                        <MenuItem danger onSelect={() => setDialog({ kind: "delete", t })}><Trash2 size={16} aria-hidden /> Xoá bảng</MenuItem>
                      </Menu>
                    )}
                  </div>
                );
              })}
            </ScrollStrip>
          </div>
        )}
        {extra && <div className={cn("shrink-0", dashboard && "ml-auto")}>{extra}</div>}
      </div>
      {dialog?.kind === "add" && home.datahub_id && (
        <TableNameDialog
          title="Thêm bảng"
          submit="Thêm bảng"
          onClose={() => setDialog(null)}
          save={async (name) => {
            const t = await createTable(home.datahub_id!, name);
            await refresh();
            void nav({ to: "/quan-ly-deal/$tableId", params: { tableId: t.id } });
            notify.ok(`Đã thêm bảng "${name}"`);
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <TableNameDialog
          title="Đổi tên bảng"
          submit="Lưu"
          initial={dialog.t.name}
          onClose={() => setDialog(null)}
          save={async (name) => {
            await updateTable(dialog.t.id, { name });
            await refresh();
            notify.ok("Đã lưu");
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <>
          <ConfirmDialog title="Xoá bảng?" message={<>Bảng "{dialog.t.name}" cùng toàn bộ dòng của nó sẽ vào thùng rác. Bạn khôi phục được trong 7 ngày.</>} confirmLabel="Xoá bảng" busy={del.isPending} onConfirm={() => del.mutate(dialog.t)} onClose={() => setDialog(null)} />
          {del.error && <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2"><ErrorText error={del.error} /></div>}
        </>
      )}
    </>
  );
}

/** "Bảng ▾ (n)": every table of the tree in one list (search when there are many), the open one marked; template tables carry the "Chung" chip. */
function DealTableList({ home, currentId }: { home: { tables: DealTable[] }; currentId?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = home.tables.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }} label="Danh sách bảng" width="w-80" className="p-2"
      trigger={<Button variant="secondary" aria-label={`Danh sách bảng, ${home.tables.length} bảng`} className="shrink-0 !px-2.5"><Table2 size={16} aria-hidden /> Bảng <ChevronDown size={14} aria-hidden /> <span className="rounded-full bg-muted px-1.5 text-xs leading-5 text-muted-foreground">{home.tables.length}</span></Button>}>
      {home.tables.length > 6 && <Input aria-label="Tìm bảng" placeholder="Tìm bảng" value={q} onChange={(ev) => setQ(ev.target.value)} className="mb-2" autoComplete="off" />}
      <ul className="flex flex-col gap-0.5">
        {list.map((t) => (
          <li key={t.id}>
            <Link to="/quan-ly-deal/$tableId" params={{ tableId: t.id }} onClick={() => setOpen(false)} title={t.name} aria-current={t.id === currentId ? "page" : undefined} className={cn("flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-primary-soft sm:min-h-9", t.id === currentId && "bg-primary-soft font-medium")}>
              <Table2 size={16} aria-hidden className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <Badge tone={t.template_id === null ? "muted" : "ok"}>{t.template_id === null ? "Riêng" : "Chung"}</Badge>
              {t.id === currentId && <Check size={14} aria-hidden className="shrink-0 text-primary" />}
            </Link>
          </li>
        ))}
        {list.length === 0 && <li className="px-2 py-3 text-muted-foreground">Không có bảng nào khớp.</li>}
      </ul>
    </Popover>
  );
}
