import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Copy, FileDown, FileUp, MoreHorizontal, Pencil, Plus, RotateCcw, Share2, Trash, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ConfirmDialog, ErrorText, Field, Input, Modal, Textarea } from "@/components/ui/form";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/dropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { createDashboard, dashKeys, deleteDashboard, duplicateDashboard, exportDashboard, importDashboard, listDashboardTrash, listDashboards, renameDashboard, reorderDashboards, restoreDashboard } from "@/lib/dashboard/api";
import type { DashboardBrief } from "@/lib/dashboard/types";
import type { DatahubBrief } from "@/lib/datahub/types";
import { cn } from "@/lib/utils";
import { DashboardView } from "./dashboard-view";
import { downloadText } from "./rows-dialog";
import { DashboardShareDialog } from "./share-dialog";

/** Datahubs whose first dashboard was already made in this session: one visit never makes it twice. */
const autoMade = new Set<string>();

const taken = (e: unknown) => e instanceof ApiError && e.code === "conflict" && e.details?.reason === "duplicate_name";

function NameDialog({ title, submit, initial = "", save, onClose }: { title: string; submit: string; initial?: string; save: (name: string) => Promise<unknown>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const m = useMutation({ mutationFn: () => save(name.trim()), onSuccess: onClose });
  const bad = !name.trim() ? "Tên dashboard không được để trống." : name.trim().length > 100 ? "Tên dashboard tối đa 100 ký tự." : null;
  return (
    <Modal title={title} open onClose={onClose} dirty={name !== initial && !m.isPending}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!bad) m.mutate(); }}>
        <Field label="Tên dashboard *" hint="Tối đa 100 ký tự. Không trùng dashboard khác trong datahub này.">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" aria-invalid={!!m.error} />
        </Field>
        <ErrorText error={m.error} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={m.isPending} disabled={!!bad}>{submit}</Button>
        </div>
      </form>
    </Modal>
  );
}

function TrashDialog({ dhId, onClose }: { dhId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: dashKeys.trash(dhId), queryFn: () => listDashboardTrash(dhId) });
  const [asking, setAsking] = useState<DashboardBrief | null>(null);
  const done = () => {
    void qc.invalidateQueries({ queryKey: dashKeys.trash(dhId) });
    void qc.invalidateQueries({ queryKey: dashKeys.list(dhId) });
  };
  const restore = useMutation({
    mutationFn: ({ d, name }: { d: DashboardBrief; name?: string }) => restoreDashboard(d.id, name),
    onSuccess: (_r, v) => {
      notify.ok(`Đã khôi phục dashboard "${v.name ?? v.d.name}"`);
      setAsking(null);
      done();
    },
    onError: (e, v) => {
      if (taken(e)) setAsking(v.d);
    },
  });
  return (
    <Modal title="Thùng rác dashboard" open onClose={onClose}>
      {q.isLoading ? <Skeleton className="h-20 w-full" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? <p className="text-sm text-muted-foreground">Thùng rác trống. Dashboard đã xoá được giữ 7 ngày.</p> : (
        <ul className="flex flex-col gap-2">
          {q.data!.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
              <span className="min-w-0 text-sm [overflow-wrap:anywhere]">{d.name}</span>
              <Button variant="secondary" loading={restore.isPending && restore.variables?.d.id === d.id} onClick={() => restore.mutate({ d })} aria-label={`Khôi phục dashboard ${d.name}`}><RotateCcw size={16} aria-hidden /> Khôi phục</Button>
            </li>
          ))}
        </ul>
      )}
      {restore.error && !taken(restore.error) && <ErrorText error={restore.error} />}
      {asking && <AskName d={asking} busy={restore.isPending} onClose={() => setAsking(null)} onSubmit={(n) => restore.mutate({ d: asking, name: n })} />}
    </Modal>
  );
}

function AskName({ d, busy, onClose, onSubmit }: { d: DashboardBrief; busy: boolean; onClose: () => void; onSubmit: (n: string) => void }) {
  const [v, setV] = useState(d.name);
  return (
    <Modal title="Tên dashboard đã bị dùng" open onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSubmit(v.trim()); }}>
        <p className="text-sm">Tên "{d.name}" đang được dashboard khác dùng. Đặt tên mới để khôi phục.</p>
        <Field label="Tên mới *"><Input value={v} onChange={(e) => setV(e.target.value)} autoFocus autoComplete="off" /></Field>
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={busy}>Khôi phục với tên này</Button>
        </div>
      </form>
    </Modal>
  );
}

function ImportDialog({ dhId, onDone, onClose }: { dhId: string; onDone: (d: { id: string; name: string }) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const m = useMutation({
    mutationFn: () => {
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error("Nội dung không phải JSON hợp lệ.");
      }
      return importDashboard(dhId, json);
    },
    onSuccess: (d) => {
      notify.ok(`Đã nhập dashboard "${d.name}"`);
      onDone(d);
    },
  });
  const pick = async (f: File | undefined) => {
    if (f) setText(await f.text());
  };
  return (
    <Modal title="Nhập dashboard từ JSON" open onClose={onClose} wide dirty={text.trim() !== "" && !m.isPending}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (text.trim()) m.mutate(); }}>
        <p className="text-sm text-muted-foreground">Dán JSON xuất từ một dashboard (hoặc do AI dựng), hoặc chọn file. Bảng và cột nêu trong JSON phải có trong datahub này.</p>
        <Field label="File JSON"><Input type="file" accept="application/json,.json" onChange={(e) => void pick(e.target.files?.[0])} data-testid="import-file" /></Field>
        <Field label="JSON dashboard *"><Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="font-mono text-xs" data-testid="import-text" /></Field>
        <ErrorText error={m.error} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={m.isPending} disabled={!text.trim()}>Nhập dashboard</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Dashboard tab of a datahub: the list of dashboards (tabs) and the open one. Owner only. */
export function DashboardArea({ dh, dashboardId }: { dh: DatahubBrief; dashboardId?: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: dashKeys.list(dh.id), queryFn: () => listDashboards(dh.id) });
  const trash = useQuery({ queryKey: dashKeys.trash(dh.id), queryFn: () => listDashboardTrash(dh.id) });
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "rename"; d: DashboardBrief } | { kind: "delete"; d: DashboardBrief } | { kind: "share"; d: DashboardBrief } | { kind: "trash" } | { kind: "import" } | null>(null);
  const list = q.data ?? [];
  const current = list.find((d) => d.id === dashboardId);

  const go = (id: string, replace = false) => void nav({ to: "/datahub/$datahubId/dashboard/$dashboardId", params: { datahubId: dh.id, dashboardId: id }, replace });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: dashKeys.list(dh.id) });
    void qc.invalidateQueries({ queryKey: dashKeys.trash(dh.id) });
  };

  // The first visit has one empty dashboard ready; later, the address always names one dashboard.
  const first = useMutation({ mutationFn: () => createDashboard(dh.id, "Dashboard 1"), onSuccess: (d) => { refresh(); go(d.id, true); } });
  useEffect(() => {
    // Only from fresh answers (this component is mounted again when the address changes, with the old answer still cached).
    if (!q.data || !trash.data || q.isFetching || trash.isFetching) return;
    if (q.data.length === 0 && trash.data.length === 0 && !autoMade.has(dh.id)) {
      autoMade.add(dh.id);
      first.mutate();
    } else if (q.data.length > 0 && !current) go(q.data[0]!.id, true);
  }, [q.data, trash.data, q.isFetching, trash.isFetching, current]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = useMutation({
    mutationFn: ({ d, to }: { d: DashboardBrief; to: number }) => {
      const ids = list.filter((x) => x.id !== d.id).map((x) => x.id);
      ids.splice(to, 0, d.id);
      return reorderDashboards(dh.id, ids);
    },
    onSettled: refresh,
    onError: () => notify.error("Không đổi được thứ tự dashboard. Thử lại."),
  });
  const dup = useMutation({
    mutationFn: (d: DashboardBrief) => duplicateDashboard(d.id),
    onSuccess: (n) => {
      notify.ok(`Đã nhân bản thành "${n.name}"`);
      refresh();
      go(n.id);
    },
    onError: (e) => notify.error(e instanceof Error ? e.message : "Không nhân bản được dashboard."),
  });
  const exp = useMutation({
    mutationFn: async (d: DashboardBrief) => ({ d, json: await exportDashboard(d.id) }),
    onSuccess: ({ d, json }) => {
      downloadText(`${d.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "dashboard"}.json`, JSON.stringify(json, null, 2), "application/json");
      notify.ok("Đã xuất JSON");
    },
    onError: (e) => notify.error(e instanceof Error ? e.message : "Không xuất được JSON."),
  });
  const del = useMutation({
    mutationFn: (d: DashboardBrief) => deleteDashboard(d.id),
    onSuccess: (_r, d) => {
      notify.ok(`Đã xoá dashboard "${d.name}". Khôi phục được trong 7 ngày ở Thùng rác.`);
      setDialog(null);
      refresh();
      const rest = list.filter((x) => x.id !== d.id);
      if (d.id === dashboardId) {
        if (rest[0]) go(rest[0].id, true);
        else void nav({ to: "/datahub/$datahubId/dashboard", params: { datahubId: dh.id }, replace: true });
      }
    },
  });

  if (q.isLoading) return <Skeleton className="h-64 w-full" aria-busy="true" aria-label="Đang tải dashboard" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được danh sách dashboard" />;

  return (
    <div className="flex shrink-0 flex-col gap-3 rounded-card border border-border-soft bg-workspace p-4 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px]" data-testid="dashboard-canvas">
      <div role="tablist" aria-label="Dashboard" className="flex shrink-0 items-center gap-1 overflow-x-auto pb-1">
        {list.map((d, i) => {
          const on = d.id === dashboardId;
          return (
            <div key={d.id} className={cn("flex shrink-0 items-center rounded-lg", on ? "bg-primary-soft" : "hover:bg-card")}>
              <Link to="/datahub/$datahubId/dashboard/$dashboardId" params={{ datahubId: dh.id, dashboardId: d.id }} role="tab" aria-selected={on} className={cn("max-w-48 truncate px-3 py-3 text-sm sm:py-1.5", on ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground")} title={d.name}>{d.name}</Link>
              {on && (
                <Menu trigger={<Button variant="ghost" aria-label={`Tuỳ chọn dashboard ${d.name}`} className="!px-1.5"><MoreHorizontal size={16} aria-hidden /></Button>} align="start">
                  <MenuItem onSelect={() => setDialog({ kind: "rename", d })}><Pencil size={16} aria-hidden /> Đổi tên</MenuItem>
                  <MenuItem onSelect={() => dup.mutate(d)}><Copy size={16} aria-hidden /> Nhân bản</MenuItem>
                  <MenuItem onSelect={() => setDialog({ kind: "share", d })}><Share2 size={16} aria-hidden /> Chia sẻ…</MenuItem>
                  <MenuItem onSelect={() => exp.mutate(d)}><FileDown size={16} aria-hidden /> Xuất JSON</MenuItem>
                  <MenuItem disabled={i === 0} onSelect={() => move.mutate({ d, to: i - 1 })}><ChevronLeft size={16} aria-hidden /> Chuyển sang trái</MenuItem>
                  <MenuItem disabled={i === list.length - 1} onSelect={() => move.mutate({ d, to: i + 1 })}><ChevronRight size={16} aria-hidden /> Chuyển sang phải</MenuItem>
                  <MenuSeparator />
                  <MenuItem danger onSelect={() => setDialog({ kind: "delete", d })}><Trash2 size={16} aria-hidden /> Xoá dashboard</MenuItem>
                </Menu>
              )}
            </div>
          );
        })}
        <Tip label="Dashboard mới"><Button variant="ghost" className="shrink-0 !px-2" aria-label="Dashboard mới" onClick={() => setDialog({ kind: "new" })}><Plus size={16} aria-hidden /></Button></Tip>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Tip label="Nhập dashboard từ JSON"><Button variant="ghost" className="!px-2" aria-label="Nhập JSON" onClick={() => setDialog({ kind: "import" })} data-testid="import-json"><FileUp size={16} aria-hidden /></Button></Tip>
          <Tip label="Thùng rác dashboard"><Button variant="ghost" className="!px-2" aria-label={`Thùng rác${trash.data?.length ? ` (${trash.data.length})` : ""}`} onClick={() => setDialog({ kind: "trash" })}><Trash size={16} aria-hidden />{trash.data?.length ? <span className="text-xs">{trash.data.length}</span> : null}</Button></Tip>
        </span>
      </div>

      {list.length === 0 ? (
        first.isPending || (!trash.data && !trash.error) ? <Skeleton className="h-64 w-full" /> : <EmptyState title="Chưa có dashboard" hint="Tạo dashboard để vẽ biểu đồ từ dữ liệu của datahub này." action={<Button onClick={() => setDialog({ kind: "new" })}><Plus size={16} aria-hidden /> Dashboard mới</Button>} />
      ) : current ? (
        <DashboardView key={current.id} dh={dh} dashboardId={current.id} />
      ) : (
        <Skeleton className="h-64 w-full" />
      )}

      {dialog?.kind === "new" && (
        <NameDialog title="Dashboard mới" submit="Tạo dashboard" save={async (name) => { const d = await createDashboard(dh.id, name); refresh(); go(d.id); }} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog title="Đổi tên dashboard" submit="Lưu" initial={dialog.d.name} save={async (name) => { await renameDashboard(dialog.d.id, dialog.d.version, name); refresh(); void qc.invalidateQueries({ queryKey: dashKeys.one(dialog.d.id) }); notify.ok("Đã lưu"); }} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "delete" && <ConfirmDialog title="Xoá dashboard?" message={<>Dashboard "{dialog.d.name}" cùng các biểu đồ của nó sẽ vào thùng rác. Bạn khôi phục được trong 7 ngày.</>} confirmLabel="Xoá dashboard" busy={del.isPending} onConfirm={() => del.mutate(dialog.d)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "share" && <DashboardShareDialog dashboard={dialog.d} ownerId={dh.owner_id} datahubId={dh.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === "import" && <ImportDialog dhId={dh.id} onClose={() => setDialog(null)} onDone={(d) => { setDialog(null); refresh(); go(d.id); }} />}
      {dialog?.kind === "trash" && <TrashDialog dhId={dh.id} onClose={() => setDialog(null)} />}
    </div>
  );
}
