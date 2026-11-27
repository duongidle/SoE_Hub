import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PersonChip } from "@/components/ui/person";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, ChevronLeft, ChevronRight, Layers, MoreHorizontal, Pencil, Plus, Share2, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SHARE_PERMISSION_LABELS } from "@soe/shared";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, Field, Input, Modal } from "@/components/ui/form";
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to="/datahub" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground sm:min-h-9 hover:text-foreground" aria-label="Về danh sách datahub">
          <ArrowLeft size={16} aria-hidden /> Datahub
        </Link>
        <h1 className="min-w-0 text-xl font-semibold [overflow-wrap:anywhere] sm:text-2xl">{dh.name}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {importTables.length > 0 && (
            <Button variant="secondary" onClick={() => setImporting(true)}><Upload size={16} aria-hidden /> Nhập dữ liệu</Button>
          )}
          {dh.access === "owner" && (
            <Button variant="secondary" onClick={() => setSharing(true)}><Share2 size={16} aria-hidden /> Chia sẻ</Button>
          )}
        </div>
        {dh.access !== "owner" && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            Chủ: <span className="[overflow-wrap:anywhere]">{dh.owner_name ? <PersonChip person={{ id: dh.owner_id, full_name: dh.owner_name }} /> : "—"}</span>
            <Badge tone="muted">{SHARE_PERMISSION_LABELS[dh.access === "view" ? "view" : "edit_data"]}</Badge>
          </span>
        )}
      </div>
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
      <div role="tablist" aria-label="Các bảng" className="flex items-center gap-1 overflow-x-auto border-b border-border">
        {dh.tables.map((t, i) => {
          const on = t.id === currentId;
          return (
            <div key={t.id} className={cn("flex shrink-0 items-center border-b-2", on ? "border-primary" : "border-transparent")}>
              <Link to="/datahub/$datahubId/$tableId" params={{ datahubId: dh.id, tableId: t.id }} role="tab" aria-selected={on} className={cn("max-w-48 truncate px-3 py-3 text-sm sm:py-2", on ? "font-medium" : "text-muted-foreground hover:text-foreground")} title={t.name}>
                {t.kind === "merged" && <Layers size={14} aria-label="Bảng gộp" className="mr-1 inline align-[-2px]" />}
                {t.name}
              </Link>
              {owner && on && (
                <Menu trigger={<Button variant="ghost" aria-label={`Tuỳ chọn bảng ${t.name}`} className="!px-1.5"><MoreHorizontal size={16} aria-hidden /></Button>} align="start">
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
        {owner && (
          <Link to="/datahub/$datahubId/dashboard" params={{ datahubId: dh.id }} role="tab" aria-selected={dashboardOn} data-testid="dashboard-tab" className={cn("ml-2 inline-flex shrink-0 items-center gap-1 border-b-2 px-3 py-3 text-sm sm:py-2", dashboardOn ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <BarChart3 size={14} aria-hidden /> Dashboard
          </Link>
        )}
        {owner && (
          <Button variant="ghost" className="shrink-0" onClick={() => setDialog({ kind: "add" })}>
            <Plus size={16} aria-hidden /> Thêm bảng
          </Button>
        )}
        {owner && (
          <Button variant="ghost" className="shrink-0" onClick={() => setDialog({ kind: "merge" })} data-testid="add-merged-table">
            <Layers size={16} aria-hidden /> Tạo bảng gộp
          </Button>
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
