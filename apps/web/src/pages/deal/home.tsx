import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { CalendarCheck, MoreHorizontal, Pencil, Plus, Settings2, Trash2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Menu, MenuItem } from "@/components/ui/dropdown";
import { Button, ConfirmDialog, ErrorText } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, NoAccessState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { createTable, deleteTable, updateTable } from "@/lib/datahub/api";
import { dealKeys, getDealHome, getPrefs, setPrefs, type DealTable } from "@/lib/datahub/deal-api";
import { can, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { TableNameDialog } from "../datahub/detail";
import { TableView } from "../datahub/table-view";
import { SharedPeriodContext, useSharedPeriodState } from "@/lib/datahub/deal-view";
import { SharedPeriodBar } from "./period-bar";
import { DealDashboard } from "./dashboard";

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
  return (
    <SharedPeriodContext.Provider value={period.value}>
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0 text-xl font-semibold sm:text-2xl">Quản lý Deal</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {isDealTable && hasLeader && !roles.includes("manager") && <LeaderEditToggle />}
          {home.tables.some((t) => t.role_set === "payments") && (
            <Link to="/quan-ly-deal/thanh-toan" data-testid="open-payments-page" className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border bg-card px-3 text-sm hover:bg-muted">
              <Wallet size={16} aria-hidden /> Thanh toán và com
            </Link>
          )}
          {can(me, "deal:payment:write") && (
            <Link to="/quan-ly-deal/chot-ky" data-testid="open-period-page" className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border bg-card px-3 text-sm hover:bg-muted">
              <CalendarCheck size={16} aria-hidden /> Chốt kỳ
            </Link>
          )}
          {canTemplate && (
            <Link to="/quan-ly-deal/template" data-testid="open-template-page" className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border bg-card px-3 text-sm hover:bg-muted">
              <Settings2 size={16} aria-hidden /> Template
            </Link>
          )}
        </div>
      </div>
      <SharedPeriodBar state={period} showRule={!dashboard && current?.role_set === "deals"} />
      <DealTabs home={home} currentId={dashboard ? undefined : tableId} dashboard={dashboard} />
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
    </SharedPeriodContext.Provider>
  );
}

/** Module 4 mục 4.3: a Leader edits the deals of the team only for people who switched this on (a per-person setting, stored by `datahub.prefs.set`). */
function LeaderEditToggle() {
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
    <label className="flex min-h-9 items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4" data-testid="leader-can-edit" disabled={q.isLoading || m.isPending} checked={q.data?.leader_can_edit === true} onChange={(e) => m.mutate(e.target.checked)} />
      Cho phép leader sửa deal của tôi
    </label>
  );
}

function DealTabs({ home, currentId, dashboard }: { home: { datahub_id: string | null; tables: DealTable[] }; currentId?: string; dashboard: boolean }) {
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
  return (
    <>
      <div role="tablist" aria-label="Các bảng Quản lý Deal" className="flex items-center gap-1 overflow-x-auto border-b border-border">
        {home.tables.some((t) => t.role_set === "deals") && (
          <div className={cn("flex shrink-0 items-center border-b-2", dashboard ? "border-primary" : "border-transparent")}>
            <Link to="/quan-ly-deal/dashboard" role="tab" aria-selected={dashboard} data-testid="deal-dashboard-tab" className={cn("px-3 py-3 text-sm sm:py-2", dashboard ? "font-medium" : "text-muted-foreground hover:text-foreground")}>
              Dashboard
            </Link>
          </div>
        )}
        {home.tables.map((t) => {
          const on = t.id === currentId;
          const mine = t.template_id === null;
          return (
            <div key={t.id} className={cn("flex shrink-0 items-center border-b-2", on ? "border-primary" : "border-transparent")}>
              <Link to="/quan-ly-deal/$tableId" params={{ tableId: t.id }} role="tab" aria-selected={on} title={t.name} className={cn("max-w-48 truncate px-3 py-3 text-sm sm:py-2", on ? "font-medium" : "text-muted-foreground hover:text-foreground")}>
                {t.name}
              </Link>
              {mine && on && (
                <Menu trigger={<Button variant="ghost" aria-label={`Tuỳ chọn bảng ${t.name}`} className="!px-1.5"><MoreHorizontal size={16} aria-hidden /></Button>} align="start">
                  <MenuItem onSelect={() => setDialog({ kind: "rename", t })}><Pencil size={16} aria-hidden /> Đổi tên bảng</MenuItem>
                  <MenuItem danger onSelect={() => setDialog({ kind: "delete", t })}><Trash2 size={16} aria-hidden /> Xoá bảng</MenuItem>
                </Menu>
              )}
            </div>
          );
        })}
        {home.datahub_id && (
          <Button variant="ghost" className="shrink-0" onClick={() => setDialog({ kind: "add" })}>
            <Plus size={16} aria-hidden /> Thêm bảng
          </Button>
        )}
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
