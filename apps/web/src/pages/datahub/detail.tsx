import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PersonChip } from "@/components/ui/person";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, Check, ChevronDown, ChevronLeft, ChevronRight, Layers, MoreHorizontal, Pencil, Plus, Share2, Table2, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatCount, SHARE_PERMISSION_LABELS } from "@soe/shared";
import { Popover } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, Field, Input, Modal, PageTitle } from "@/components/ui/form";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/dropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, NoAccessState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { createTable, deleteTable, dhKeys, getDatahub, restoreTable, updateTable } from "@/lib/datahub/api";
import type { DatahubBrief, TableBrief } from "@/lib/datahub/types";
import { cn } from "@/lib/utils";
import { nameError } from "./list";
import { DashboardArea } from "./dashboard/dashboard-area";
import { ImportDialog } from "./import-dialog";
import { MergeDialog } from "./merge-dialog";
import { ShareDialog } from "./share-dialog";
import { TableView } from "./table-view";

/** `/datahub/:datahubId/:tableId` — the tabs of the tables of one datahub, and the open table below them. */
export function DatahubPage() {
  const { datahubId, tableId, dashboardId } = useParams({ strict: false }) as { datahubId: string; tableId?: string; dashboardId?: string };
  const onDashboard = useRouterState({ select: (s) => /\/dashboard(\/|$)/.test(s.location.pathname) });
  const nav = useNavigate();
  const q = useQuery({ queryKey: dhKeys.datahub(datahubId), queryFn: () => getDatahub(datahubId), retry: (n, e) => !(e instanceof ApiError) && n < 2 });
  const dh = q.data;

  // No table in the address: open the first one (the address then holds the table, so the link can be sent).
  useEffect(() => {
    if (dh && !tableId && !onDashboard && dh.tables[0]) void nav({ to: "/datahub/$datahubId/$tableId", params: { datahubId, tableId: dh.tables[0].id }, replace: true });
  }, [dh, tableId, onDashboard, datahubId, nav]);

  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải datahub">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-9 w-full max-w-xl" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404)) {
    return <NoAccessState title="Không mở được datahub" hint="Datahub này không tồn tại, đã bị xoá, hoặc bạn không được chia sẻ." />;
  }
  if (q.error || !dh) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được datahub" />;

  const current = dh.tables.find((t) => t.id === tableId);
  return <DatahubBody dh={dh} tableId={tableId} current={current} dashboard={onDashboard ? { id: dashboardId } : null} />;
}

function DatahubBody({ dh, tableId, current, dashboard }: { dh: DatahubBrief; tableId?: string; current?: TableBrief; dashboard: { id?: string } | null }) {
  const [sharing, setSharing] = useState(false);
  const [importing, setImporting] = useState(false);
  // What a person may import into: the owner any normal table; a member only tables they edit and where the owner allows adding rows in bulk.
  const importTables = dh.tables.filter((t) => t.kind !== "merged" && (dh.access === "owner" || (t.access === "edit_data" && t.members_bulk_create !== false)));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* The name is the last breadcrumb; "Nhập dữ liệu" and "Chia sẻ" sit in the top bar, both secondary: the one main button of the screen is "Thêm dòng". */}
      <PageTitle
        actions={
          <>
            {importTables.length > 0 && (
              <Button variant="secondary" onClick={() => setImporting(true)}><Upload size={16} aria-hidden /> <span className="max-md:hidden">Nhập dữ liệu</span></Button>
            )}
            {dh.access === "owner" && (
              <Button variant="secondary" onClick={() => setSharing(true)}><Share2 size={16} aria-hidden /> <span className="max-md:hidden">Chia sẻ</span></Button>
            )}
          </>
        }
      >
        {dh.name}
      </PageTitle>
      {sharing && <ShareDialog dh={dh} onClose={() => setSharing(false)} />}
      {importing && <ImportDialog target={{ datahub: { id: dh.id, name: dh.name, access: dh.access, tables: importTables.map((t) => ({ id: t.id, name: t.name })) } }} onClose={() => setImporting(false)} />}
      <TableTabs dh={dh} currentId={dashboard ? undefined : tableId} dashboardOn={!!dashboard} />
      {dashboard ? (
        dh.access === "owner" ? <DashboardArea dh={dh} dashboardId={dashboard.id} /> : <NoAccessState title="Không mở được dashboard" hint="Chỉ chủ datahub dựng và sửa dashboard. Dashboard được chia sẻ cho bạn nằm ở mục Dashboard chia sẻ." />
      ) : dh.tables.length === 0 ? (
        <EmptyState title="Datahub chưa có bảng nào" hint={dh.access === "owner" ? "Tạo bảng đầu tiên để thêm dữ liệu." : "Chủ datahub chưa chia sẻ bảng nào cho bạn."} />
      ) : !current ? (
        tableId ? <NoAccessState title="Không mở được bảng" hint="Bảng này không tồn tại, đã bị xoá, hoặc không được chia sẻ cho bạn." /> : <Skeleton className="h-64 w-full" />
      ) : (
        <TableView key={current.id} tableId={current.id} />
      )}
    </div>
  );
}

/** "Bảng ▾ (n)": every table of the datahub in one searchable list, for when the strip cannot show them all. */
function TableList({ dh, currentId }: { dh: DatahubBrief; currentId?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = dh.tables.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }} label="Danh sách bảng" width="w-80" className="p-2"
      trigger={<Button variant="secondary" aria-label={`Danh sách bảng, ${dh.tables.length} bảng`} className="shrink-0 !px-2.5"><Table2 size={16} aria-hidden /> Bảng <ChevronDown size={14} aria-hidden /> <span className="rounded-full bg-muted px-1.5 text-xs leading-5 text-muted-foreground">{dh.tables.length}</span></Button>}>
      {dh.tables.length > 6 && <Input aria-label="Tìm bảng" placeholder="Tìm bảng" value={q} onChange={(ev) => setQ(ev.target.value)} className="mb-2" autoComplete="off" />}
      <ul className="flex flex-col gap-0.5">
        {list.map((t) => (
          <li key={t.id}>
            <Link to="/datahub/$datahubId/$tableId" params={{ datahubId: dh.id, tableId: t.id }} onClick={() => setOpen(false)} title={t.name} aria-current={t.id === currentId ? "page" : undefined} className={cn("flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-primary-soft sm:min-h-9", t.id === currentId && "bg-primary-soft font-medium")}>
              {t.kind === "merged" ? <Layers size={16} aria-hidden className="shrink-0 text-primary" /> : <Table2 size={16} aria-hidden className="shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {t.kind === "merged" && <Badge tone="muted">Gộp</Badge>}
              {dh.access !== "owner" && <Badge tone="muted">{SHARE_PERMISSION_LABELS[t.access === "view" ? "view" : "edit_data"]}</Badge>}
              <span className="shrink-0 text-xs text-muted-foreground">{formatCount(t.row_count, "dòng")}</span>
              {t.id === currentId && <Check size={14} aria-hidden className="shrink-0 text-primary" />}
            </Link>
          </li>
        ))}
        {list.length === 0 && <li className="px-2 py-3 text-muted-foreground">Không có bảng nào khớp.</li>}
      </ul>
    </Popover>
  );
}

/** The scrolling part of the strip: the open tab scrolls into view, a fade and an arrow on an edge show that tabs are hidden there. */
export function ScrollStrip({ children, activeKey }: { children: React.ReactNode; activeKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = () => {
    const el = ref.current;
    if (el) setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeKey, children]);
  const by = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * 240, behavior: "smooth" });
  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <div ref={ref} onScroll={measure} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
      {edge.left && <button type="button" aria-label="Cuộn tab sang trái" onClick={() => by(-1)} className="absolute left-0 top-0 flex h-full w-9 cursor-pointer items-center justify-start bg-gradient-to-r from-workspace via-workspace/90 to-transparent pl-0.5 text-muted-foreground hover:text-foreground"><ChevronLeft size={16} aria-hidden /></button>}
      {edge.right && <button type="button" aria-label="Cuộn tab sang phải" onClick={() => by(1)} className="absolute right-0 top-0 flex h-full w-9 cursor-pointer items-center justify-end bg-gradient-to-l from-workspace via-workspace/90 to-transparent pr-0.5 text-muted-foreground hover:text-foreground"><ChevronRight size={16} aria-hidden /></button>}
    </div>
  );
}

export const segCls = (on: boolean) => cn("inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm sm:min-h-7", on ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:text-foreground");
export const tabCls = (on: boolean) => cn("inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm sm:min-h-8", on ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground");

/** The strip above a table: the "Dữ liệu | Dashboard" switch pinned on the left (the mode is in the address); in Dữ liệu then "+" and the tables as tabs that scroll sideways. */
function TableTabs({ dh, currentId, dashboardOn }: { dh: DatahubBrief; currentId?: string; dashboardOn: boolean }) {
  const owner = dh.access === "owner";
  const [dialog, setDialog] = useState<{ kind: "add" } | { kind: "merge" } | { kind: "rename"; t: TableBrief } | { kind: "delete"; t: TableBrief } | null>(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  // Positions are plain numbers (not renumbered by the server): rewrite them as 0..n-1 in the new order.
  const move = useMutation({
    mutationFn: async ({ t, to }: { t: TableBrief; to: number }) => {
      const order = dh.tables.filter((x) => x.id !== t.id);
      order.splice(to, 0, t);
      await Promise.all(order.map((x, i) => (x.position === i ? null : updateTable(x.id, { position: i }))));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: dhKeys.datahub(dh.id) }),
    onError: () => notify.error("Không đổi được thứ tự bảng. Thử lại."),
  });

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-1 sm:flex-nowrap">
        <Link to="/datahub" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground sm:min-h-8 sm:min-w-8" aria-label="Về danh sách datahub" title="Về danh sách datahub">
          <ArrowLeft size={16} aria-hidden />
        </Link>
        {owner && (
          <div role="group" aria-label="Chế độ xem" className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
            <Link to="/datahub/$datahubId" params={{ datahubId: dh.id }} aria-current={dashboardOn ? undefined : "page"} className={segCls(!dashboardOn)}>
              <Table2 size={14} aria-hidden /> Dữ liệu
            </Link>
            <Link to="/datahub/$datahubId/dashboard" params={{ datahubId: dh.id }} aria-current={dashboardOn ? "page" : undefined} data-testid="dashboard-tab" className={segCls(dashboardOn)}>
              <BarChart3 size={14} aria-hidden /> Dashboard
            </Link>
          </div>
        )}
        {!dashboardOn && (
        <div role="tablist" aria-label="Các bảng" className="flex min-w-0 basis-full items-center gap-1 sm:flex-1 sm:basis-0">
          {owner && (
            <div className="flex shrink-0 items-center gap-1">
              <Menu trigger={<Button variant="ghost" aria-label="Thêm bảng" title="Thêm bảng" className="!px-2"><Plus size={16} aria-hidden /></Button>} align="start">
                <MenuItem onSelect={() => setDialog({ kind: "add" })}><Plus size={16} aria-hidden /> Thêm bảng</MenuItem>
                <MenuItem data-testid="add-merged-table" onSelect={() => setDialog({ kind: "merge" })}><Layers size={16} aria-hidden /> Tạo bảng gộp</MenuItem>
              </Menu>
              <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />
            </div>
          )}
          <TableList dh={dh} currentId={currentId} />
          <ScrollStrip activeKey={currentId}>
            {dh.tables.map((t, i) => {
              const on = t.id === currentId;
              return (
                <div key={t.id} className={cn("flex shrink-0 items-center rounded-lg", on && "bg-primary-soft")}>
                  <Link to="/datahub/$datahubId/$tableId" params={{ datahubId: dh.id, tableId: t.id }} role="tab" aria-selected={on} className={cn(tabCls(on), "max-w-48 truncate bg-transparent", on && owner && "pr-1")} title={t.name}>
                    {t.kind === "merged" && <Layers size={14} aria-label="Bảng gộp" className="shrink-0" />}
                    <span className="truncate">{t.name}</span>
                  </Link>
                  {owner && on && (
                    <Menu trigger={<Button variant="ghost" aria-label={`Tuỳ chọn bảng ${t.name}`} className="!min-h-8 !px-1.5"><MoreHorizontal size={16} aria-hidden /></Button>} align="start">
                      <MenuItem onSelect={() => setDialog({ kind: "rename", t })}><Pencil size={16} aria-hidden /> Đổi tên bảng</MenuItem>
                      <MenuItem disabled={i === 0} onSelect={() => move.mutate({ t, to: i - 1 })}><ChevronLeft size={16} aria-hidden /> Chuyển sang trái</MenuItem>
                      <MenuItem disabled={i === dh.tables.length - 1} onSelect={() => move.mutate({ t, to: i + 1 })}><ChevronRight size={16} aria-hidden /> Chuyển sang phải</MenuItem>
                      <MenuSeparator />
                      <MenuItem danger onSelect={() => setDialog({ kind: "delete", t })}><Trash2 size={16} aria-hidden /> Xoá bảng</MenuItem>
                    </Menu>
                  )}
                </div>
              );
            })}
          </ScrollStrip>
        </div>
        )}
        {dh.access !== "owner" && (
          <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground max-sm:hidden">
            Chủ: <span className="[overflow-wrap:anywhere]">{dh.owner_name ? <PersonChip person={{ id: dh.owner_id, full_name: dh.owner_name }} /> : "—"}</span>
            <Badge tone="muted">{SHARE_PERMISSION_LABELS[dh.access === "view" ? "view" : "edit_data"]}</Badge>
          </span>
        )}
      </div>
      {dialog?.kind === "add" && (
        <TableNameDialog
          title="Thêm bảng"
          submit="Thêm bảng"
          onClose={() => setDialog(null)}
          save={async (name) => {
            const t = await createTable(dh.id, name);
            await qc.invalidateQueries({ queryKey: dhKeys.datahub(dh.id) });
            await qc.invalidateQueries({ queryKey: dhKeys.list });
            void nav({ to: "/datahub/$datahubId/$tableId", params: { datahubId: dh.id, tableId: t.id } });
            notify.ok(`Đã thêm bảng "${name}"`);
          }}
        />
      )}
      {dialog?.kind === "merge" && <MergeDialog datahubId={dh.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === "rename" && (
        <TableNameDialog
          title="Đổi tên bảng"
          submit="Lưu"
          initial={dialog.t.name}
          onClose={() => setDialog(null)}
          save={async (name) => {
            await updateTable(dialog.t.id, { name });
            await qc.invalidateQueries({ queryKey: dhKeys.datahub(dh.id) });
            await qc.invalidateQueries({ queryKey: dhKeys.table(dialog.t.id) });
            notify.ok("Đã lưu");
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteTable
          dh={dh}
          t={dialog.t}
          onClose={() => setDialog(null)}
          onDone={() => {
            const rest = dh.tables.filter((x) => x.id !== dialog.t.id);
            if (dialog.t.id === currentId) void nav({ to: rest[0] ? "/datahub/$datahubId/$tableId" : "/datahub/$datahubId", params: { datahubId: dh.id, tableId: rest[0]?.id ?? "" } as never, replace: true });
          }}
        />
      )}
    </>
  );
}

export function TableNameDialog({ title, submit, initial = "", save, onClose }: { title: string; submit: string; initial?: string; save: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const m = useMutation({ mutationFn: () => save(name.trim()), onSuccess: onClose });
  const err = touched ? nameError(name) : null;
  // A refused save returns the focus to the field that caused it.
  useEffect(() => {
    if (m.error) input.current?.focus();
  }, [m.error]);
  return (
    <Modal title={title} open onClose={onClose} dirty={name !== initial && !m.isPending}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (nameError(name)) input.current?.focus(); else m.mutate(); }}>
        <Field label="Tên bảng *" hint="Tối đa 100 ký tự, không chứa dấu [ hoặc ]. Không trùng với bảng khác trong datahub này.">
          <Input ref={input} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={!!err || !!m.error} aria-describedby="table-name-error" autoFocus autoComplete="off" />
        </Field>
        <div id="table-name-error" className="-mt-3 flex flex-col gap-2">
          {err && <p role="alert" className="text-xs text-bad">{err}</p>}
          <ErrorText error={m.error} />
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={m.isPending}>{submit}</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteTable({ dh, t, onClose, onDone }: { dh: DatahubBrief; t: TableBrief; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => deleteTable(t.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dhKeys.datahub(dh.id) });
      void qc.invalidateQueries({ queryKey: dhKeys.list });
      notify.ok(`Đã xoá bảng "${t.name}"`, {
        label: "Hoàn tác",
        onClick: () =>
          void restoreTable(t.id)
            .then(() => {
              void qc.invalidateQueries({ queryKey: dhKeys.datahub(dh.id) });
              void qc.invalidateQueries({ queryKey: dhKeys.list });
              notify.ok(`Đã khôi phục bảng "${t.name}"`);
            })
            .catch(() => notify.error("Không khôi phục được. Tên có thể đã bị bảng khác dùng.")),
      });
      onDone();
      onClose();
    },
  });
  return (
    <>
      <ConfirmDialog title="Xoá bảng?" message={<>Bảng "{t.name}" cùng toàn bộ dòng của nó sẽ vào thùng rác. Bạn khôi phục được trong 7 ngày.</>} confirmLabel="Xoá bảng" busy={m.isPending} onConfirm={() => m.mutate()} onClose={onClose} />
      {m.error && <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2"><ErrorText error={m.error} /></div>}
    </>
  );
}
