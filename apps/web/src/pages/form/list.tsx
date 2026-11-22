import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Copy, FilePlus2, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, Field, Input, Modal, PageTitle, Select, Tabs } from "@/components/ui/form";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, fmtTime } from "@/lib/api";
import { type FormBrief, formKeys, listForms } from "./model";

export const STATUS_LABEL: Record<string, string> = { draft: "Nháp", open: "Đang nhận", paused: "Tạm dừng", closed: "Đã đóng", not_started: "Chưa mở" };
interface Targets { datahub_id: string; datahub_name: string; tables: { id: string; name: string }[] }

/** Create: a new table in a datahub (default), or an existing table. The list is made by the server and has no table a form may not write to. */
function CreateDialog({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const targets = useQuery({ queryKey: formKeys.targets, queryFn: () => api<Targets[]>("GET", "/forms/target-tables") });
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [dh, setDh] = useState("");
  const [table, setTable] = useState("");
  const dhId = dh || targets.data?.[0]?.datahub_id || "";
  const allTables = (targets.data ?? []).flatMap((d) => d.tables.map((t) => ({ ...t, dh: d.datahub_name })));
  const tableId = table || allTables[0]?.id || "";
  const m = useMutation({
    mutationFn: () => api<FormBrief>("POST", "/forms", { name: name.trim(), ...(mode === "new" ? { datahub_id: dhId } : { table_id: tableId }) }),
    onSuccess: (f) => { onClose(); void nav({ to: "/form/$id", params: { id: f.id } }); },
  });
  const ready = name.trim() && (mode === "new" ? dhId : tableId);
  return (
    <Modal title="Tạo form" open onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }}>
        <Field label="Tên form" required><Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="form-name" autoFocus /></Field>
        <Field label="Phản hồi ghi vào">
          <Select value={mode} onChange={(e) => setMode(e.target.value as "new" | "existing")} data-testid="form-target-mode">
            <option value="new">Bảng mới trong datahub</option>
            <option value="existing" disabled={allTables.length === 0}>Bảng có sẵn</option>
          </Select>
        </Field>
        {mode === "new" ? (
          <Field label="Datahub" hint="Bảng mới lấy tên của form.">
            <Select value={dhId} onChange={(e) => setDh(e.target.value)} data-testid="form-target-datahub">{(targets.data ?? []).map((d) => <option key={d.datahub_id} value={d.datahub_id}>{d.datahub_name}</option>)}</Select>
          </Field>
        ) : (
          <Field label="Bảng"><Select value={tableId} onChange={(e) => setTable(e.target.value)}>{allTables.map((t) => <option key={t.id} value={t.id}>{t.dh} / {t.name}</option>)}</Select></Field>
        )}
        {targets.data?.length === 0 && <p className="text-sm text-muted-foreground">Bạn chưa có datahub nào. Tạo datahub ở mục Datahub trước.</p>}
        <ErrorText error={m.error ?? targets.error} />
        <div><Button type="submit" loading={m.isPending} disabled={!ready} data-testid="form-create-submit">Tạo form</Button></div>
      </form>
    </Modal>
  );
}

export function FormListPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"live" | "trash">("live");
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<FormBrief | null>(null);
  const q = useQuery({ queryKey: formKeys.list(tab === "trash"), queryFn: () => listForms(tab === "trash") });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["forms"] });
  const clone = useMutation({ mutationFn: (f: FormBrief) => api("POST", `/forms/${f.id}/clone`, {}), onSuccess: () => { notify.ok("Đã nhân bản form"); refresh(); } });
  const rm = useMutation({ mutationFn: (f: FormBrief) => api("DELETE", `/forms/${f.id}`), onSuccess: () => { setDel(null); notify.ok("Đã chuyển vào thùng rác"); refresh(); } });
  const restore = useMutation({ mutationFn: (f: FormBrief) => api("POST", `/forms/${f.id}/restore`, {}), onSuccess: () => { notify.ok("Đã khôi phục form"); refresh(); } });
  return (
    <div>
      <PageTitle actions={<><Link to="/form/cham-bai" className="inline-flex min-h-11 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted sm:min-h-9">Chấm bài</Link><Button onClick={() => setCreating(true)} data-testid="new-form"><FilePlus2 size={16} aria-hidden /> Tạo form</Button></>}>Form</PageTitle>
      <Tabs value={tab} onChange={setTab} items={[{ value: "live", label: "Form của tôi" }, { value: "trash", label: "Thùng rác" }]} />
      <ErrorText error={clone.error ?? rm.error ?? restore.error} />
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data?.length === 0 ? <EmptyState title={tab === "trash" ? "Thùng rác trống" : "Chưa có form"} hint={tab === "trash" ? undefined : "Bấm Tạo form để bắt đầu."} /> : (
        <ul className="flex flex-col gap-2" data-testid="form-list">
          {q.data?.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3" data-testid="form-row">
              <div className="min-w-0 flex-1">
                {tab === "live" ? <Link to="/form/$id" params={{ id: f.id }} className="font-medium text-primary underline [overflow-wrap:anywhere]">{f.name}</Link> : <span className="font-medium">{f.name}</span>}
                <p className="text-xs text-muted-foreground">{f.response_count} phản hồi{f.last_response_at ? `, mới nhất ${fmtTime(f.last_response_at)}` : ""}{f.table_name ? ` · bảng ${f.table_name}` : ""}</p>
              </div>
              <Badge>{STATUS_LABEL[f.state] ?? f.state}</Badge>
              {f.has_unpublished && f.published_version > 0 && <Badge>Có thay đổi chưa xuất bản</Badge>}
              {tab === "live" ? (
                <>
                  <Button variant="secondary" onClick={() => clone.mutate(f)} aria-label={`Nhân bản ${f.name}`}><Copy size={16} aria-hidden /> Nhân bản</Button>
                  <Button variant="ghost" onClick={() => setDel(f)} aria-label={`Xoá ${f.name}`}><Trash2 size={16} aria-hidden /></Button>
                </>
              ) : <Button variant="secondary" onClick={() => restore.mutate(f)}><RotateCcw size={16} aria-hidden /> Khôi phục</Button>}
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
      {del && <ConfirmDialog title="Xoá form" message={`Chuyển "${del.name}" vào thùng rác? Phản hồi vẫn giữ trong bảng.`} confirmLabel="Xoá" busy={rm.isPending} onConfirm={() => rm.mutate(del)} onClose={() => setDel(null)} />}
    </div>
  );
}
