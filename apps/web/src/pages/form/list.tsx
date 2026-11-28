import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ClipboardCheck, Copy, FilePlus2, RotateCcw, Table2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass, ConfirmDialog, ErrorText, Field, Input, Modal, PageTitle, Select } from "@/components/ui/form";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { api, fmtTime } from "@/lib/api";
import { type FormBrief, formKeys, listForms } from "./model";

export const STATUS_LABEL: Record<string, string> = { draft: "Nháp", open: "Đang nhận", paused: "Tạm dừng", closed: "Đã đóng", not_started: "Chưa mở" };
/** Colors by meaning: green = receiving, amber = paused, blue = not open yet, grey = draft or closed. */
export const STATUS_TONE: Record<string, "ok" | "warn" | "info" | "muted"> = { open: "ok", paused: "warn", not_started: "info", draft: "muted", closed: "muted" };
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

const linkBtn = buttonClass({ variant: "secondary" });

export function FormListPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"live" | "trash">("live");
  const trashQ = useQuery({ queryKey: formKeys.list(true), queryFn: () => listForms(true) });
  const trashN = trashQ.data?.length ?? 0;
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<FormBrief | null>(null);
  const q = useQuery({ queryKey: formKeys.list(tab === "trash"), queryFn: () => listForms(tab === "trash") });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["forms"] });
  const clone = useMutation({ mutationFn: (f: FormBrief) => api("POST", `/forms/${f.id}/clone`, {}), onSuccess: () => { notify.ok("Đã nhân bản form"); refresh(); } });
  const rm = useMutation({ mutationFn: (f: FormBrief) => api("DELETE", `/forms/${f.id}`), onSuccess: () => { setDel(null); notify.ok("Đã chuyển vào thùng rác"); refresh(); } });
  const restore = useMutation({ mutationFn: (f: FormBrief) => api("POST", `/forms/${f.id}/restore`, {}), onSuccess: () => { notify.ok("Đã khôi phục form"); refresh(); } });
  return (
    <div>
      <PageTitle actions={<><Tip label="Thùng rác"><button type="button" onClick={() => setTab(tab === "trash" ? "live" : "trash")} aria-label={`Thùng rác${trashN ? `, ${trashN} form` : ""}`} aria-pressed={tab === "trash"} data-testid="form-trash" className={`relative inline-flex size-11 sm:size-8 shrink-0 items-center justify-center rounded-md text-bad hover:bg-bad-bg ${tab === "trash" ? "bg-bad-bg" : ""}`}><Trash2 size={16} aria-hidden />{trashN > 0 && <span className="num absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-bad px-1 text-center text-[10px] font-semibold leading-4 text-white">{trashN}</span>}</button></Tip><Link to="/form/cham-bai" className={linkBtn}><ClipboardCheck size={14} aria-hidden />Chấm bài</Link><Button onClick={() => setCreating(true)} data-testid="new-form"><FilePlus2 size={14} aria-hidden />Tạo form</Button></>}>Dynamic Form</PageTitle>
      {tab === "trash" && (
        <div className="mb-3 flex items-center gap-2" data-testid="form-trash-head">
          <Button variant="ghost" onClick={() => setTab("live")}><ArrowLeft size={16} aria-hidden /> Quay lại</Button>
          <h2 className="text-[15px] font-semibold">Thùng rác</h2>
        </div>
      )}
      <ErrorText error={clone.error ?? rm.error ?? restore.error} />
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data?.length === 0 ? (
        <EmptyState title={tab === "trash" ? "Thùng rác trống" : "Chưa có form nào"} hint={tab === "trash" ? undefined : "Tạo form đầu tiên để thu phản hồi vào một bảng Datahub."} cta={tab === "trash" ? undefined : { label: "Tạo form", onClick: () => setCreating(true), icon: <FilePlus2 size={16} aria-hidden /> }} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="form-list">
          {q.data?.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 hover:border-primary-border" data-testid="form-row">
              <div className="min-w-0 flex-1 basis-60 [overflow-wrap:anywhere]">
                {tab === "live" ? <Link to="/form/$id" params={{ id: f.id }} className="font-medium text-foreground hover:text-primary [overflow-wrap:anywhere]">{f.name}</Link> : <span className="font-medium">{f.name}</span>}
                <p className="mt-0.5 text-xs text-muted-foreground"><span className="tabular-nums">{f.response_count}</span> phản hồi{f.last_response_at ? `, mới nhất ${fmtTime(f.last_response_at)}` : ""}{f.table_name ? ` · bảng ${f.table_name}` : ""}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={STATUS_TONE[f.state]}>{STATUS_LABEL[f.state] ?? f.state}</Badge>
                {f.has_unpublished && f.published_version > 0 && <Badge tone="warn">Có thay đổi chưa xuất bản</Badge>}
              </div>
              <div className="flex items-center gap-1">
                {tab === "live" ? (
                  <>
                    {f.table_id && f.datahub_id && <Link to="/datahub/$datahubId/$tableId" params={{ datahubId: f.datahub_id, tableId: f.table_id }} className={linkBtn} aria-label={`Mở bảng phản hồi của ${f.name}`} data-testid="open-responses"><Table2 size={14} aria-hidden />Mở bảng phản hồi</Link>}
                    <Button variant="ghost" onClick={() => clone.mutate(f)} aria-label={`Nhân bản ${f.name}`} title="Nhân bản"><Copy size={16} aria-hidden /></Button>
                    <Button variant="ghost" onClick={() => setDel(f)} aria-label={`Xoá ${f.name}`} title="Xoá"><Trash2 size={16} aria-hidden /></Button>
                  </>
                ) : <Button variant="secondary" onClick={() => restore.mutate(f)}><RotateCcw size={16} aria-hidden /> Khôi phục</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
      {del && <ConfirmDialog title="Xoá form" message={`Chuyển "${del.name}" vào thùng rác? Phản hồi vẫn giữ trong bảng.`} confirmLabel="Xoá" busy={rm.isPending} onConfirm={() => rm.mutate(del)} onClose={() => setDel(null)} />}
    </div>
  );
}
