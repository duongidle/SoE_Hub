import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DhNameSchema, formatCount, formatRelative, SHARE_PERMISSION_LABELS } from "@soe/shared";
import { Database, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, Field, Input, Modal, PageTitle, Tabs, Textarea } from "@/components/ui/form";
import { Menu, MenuItem } from "@/components/ui/dropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { createDatahub, deleteDatahub, dhKeys, getLimits, listDatahubs, restoreDatahub, updateDatahub } from "@/lib/datahub/api";
import type { DatahubBrief } from "@/lib/datahub/types";
import { can, useMe } from "@/lib/session";

type Tab = "mine" | "shared";

/** Name rule of the design (module 2, section 2), checked here so the message appears under the field before the server is asked. */
export function nameError(v: string): string | null {
  const r = DhNameSchema.safeParse(v);
  return r.success ? null : (r.error.issues[0]?.message ?? "Tên không hợp lệ.");
}

export function DatahubListPage() {
  const me = useMe().data;
  const [tab, setTab] = useState<Tab>("mine");
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "rename"; dh: DatahubBrief } | { kind: "delete"; dh: DatahubBrief } | null>(null);
  const q = useQuery({ queryKey: dhKeys.list, queryFn: () => listDatahubs("all") });
  const limits = useQuery({ queryKey: dhKeys.limits, queryFn: getLimits });

  const mine = (q.data ?? []).filter((d) => d.owner_id === me?.user.id);
  const shared = (q.data ?? []).filter((d) => d.owner_id !== me?.user.id);
  const shown = tab === "mine" ? mine : shared;
  const canCreate = can(me, "datahub:datahub:create");
  const full = limits.data ? limits.data.used.datahubs >= limits.data.limits.datahubs : false;

  return (
    <>
      <PageTitle
        actions={
          canCreate && (
            <Button onClick={() => setDialog({ kind: "create" })} disabled={full} title={full ? "Bạn đã dùng hết số datahub được tạo." : undefined}>
              <Plus size={16} aria-hidden /> Tạo datahub
            </Button>
          )
        }
      >
        Datahub
      </PageTitle>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "mine", label: `Của tôi${q.data ? ` (${mine.length})` : ""}` },
          { value: "shared", label: `Được chia sẻ với tôi${q.data ? ` (${shared.length})` : ""}` },
        ]}
      />
      {tab === "mine" && limits.data && <p className="-mt-2 mb-3 text-sm text-muted-foreground">{limits.data.used.datahubs} / {limits.data.limits.datahubs} datahub{full ? ". Xoá bớt hoặc nhờ Admin tăng giới hạn để tạo thêm." : ""}</p>}

      {q.isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3" aria-busy="true" aria-label="Đang tải danh sách datahub">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được danh sách datahub" />
      ) : shown.length === 0 ? (
        tab === "mine" ? (
          <EmptyState
            title="Bạn chưa có datahub nào"
            hint="Datahub là nơi bạn gom các bảng dữ liệu của mình, như một file Google Sheets."
            action={canCreate && <Button onClick={() => setDialog({ kind: "create" })}><Plus size={16} aria-hidden /> Tạo datahub đầu tiên</Button>}
          />
        ) : (
          <EmptyState title="Chưa có datahub nào được chia sẻ với bạn" hint="Khi ai đó chia sẻ datahub hoặc một bảng cho bạn, nó sẽ hiện ở đây." />
        )
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3">
          {shown.map((d) => (
            <li key={d.id}>
              <DatahubCard dh={d} mine={tab === "mine"} onRename={() => setDialog({ kind: "rename", dh: d })} onDelete={() => setDialog({ kind: "delete", dh: d })} />
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === "create" && <NameDialog title="Tạo datahub" submit="Tạo datahub" onClose={() => setDialog(null)} />}
      {dialog?.kind === "rename" && <NameDialog title="Đổi tên datahub" submit="Lưu" dh={dialog.dh} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && <DeleteDialog dh={dialog.dh} onClose={() => setDialog(null)} />}
    </>
  );
}

function DatahubCard({ dh, mine, onRename, onDelete }: { dh: DatahubBrief; mine: boolean; onRename: () => void; onDelete: () => void }) {
  const first = dh.tables[0];
  return (
    <div className="relative flex h-full flex-col gap-2 rounded-lg border border-border bg-card p-4 hover:bg-muted/40">
      <Link to="/datahub/$datahubId" params={{ datahubId: dh.id }} className="flex min-w-0 flex-1 flex-col gap-2 after:absolute after:inset-0" aria-label={`Mở datahub ${dh.name}`}>
        <span className="flex items-start gap-2">
          <Database size={20} aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{dh.name}</span>
        </span>
        {dh.description && <span className="line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{dh.description}</span>}
      </Link>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{formatCount(dh.tables.length, "bảng")}</span>
        {first && <span>{formatCount(dh.tables.reduce((n, t) => n + t.row_count, 0), "dòng")}</span>}
        <span>Sửa {formatRelative(dh.updated_at)}</span>
      </div>
      {!mine && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 [overflow-wrap:anywhere]">Chủ: {dh.owner_name ?? "—"}</span>
          <Badge tone="muted">{dh.access === "view" ? SHARE_PERMISSION_LABELS.view : SHARE_PERMISSION_LABELS.edit_data}</Badge>
        </div>
      )}
      {mine && (
        <div className="absolute right-2 top-2 z-10">
          <Menu trigger={<Button variant="ghost" aria-label={`Tuỳ chọn cho ${dh.name}`} className="!px-2"><MoreHorizontal size={20} aria-hidden /></Button>}>
            <MenuItem onSelect={onRename}><Pencil size={16} aria-hidden /> Đổi tên</MenuItem>
            <MenuItem danger onSelect={onDelete}><Trash2 size={16} aria-hidden /> Xoá datahub</MenuItem>
          </Menu>
        </div>
      )}
    </div>
  );
}

function NameDialog({ title, submit, dh, onClose }: { title: string; submit: string; dh?: DatahubBrief; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(dh?.name ?? "");
  const [description, setDescription] = useState(dh?.description ?? "");
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const clientError = touched ? nameError(name) : null;
  const m = useMutation({
    mutationFn: () => (dh ? updateDatahub(dh.id, { name: name.trim(), description: description.trim() || null, version: dh.version }) : createDatahub(name.trim(), description.trim())),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dhKeys.list });
      void qc.invalidateQueries({ queryKey: dhKeys.limits });
      notify.ok(dh ? "Đã lưu" : `Đã tạo datahub "${name.trim()}"`);
      onClose();
    },
  });
  // A refused save (for example a name already taken) returns the focus to the name field.
  useEffect(() => {
    if (m.error) input.current?.focus();
  }, [m.error]);
  const dirty = name !== (dh?.name ?? "") || description !== (dh?.description ?? "");
  return (
    <Modal title={title} open onClose={onClose} dirty={dirty && !m.isPending}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (nameError(name)) return input.current?.focus();
          m.mutate();
        }}
      >
        <Field label="Tên *" hint="Tối đa 100 ký tự, không chứa dấu [ hoặc ]. Không trùng với datahub khác của bạn.">
          <Input ref={input} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={!!clientError || !!m.error} aria-describedby="dh-name-error" maxLength={200} autoFocus autoComplete="off" />
        </Field>
        <div id="dh-name-error" className="-mt-3">
          {clientError && <p role="alert" className="text-xs text-bad">{clientError}</p>}
        </div>
        <Field label="Mô tả">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} />
        </Field>
        <ErrorText error={m.error} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={m.isPending}>{submit}</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ dh, onClose }: { dh: DatahubBrief; onClose: () => void }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => deleteDatahub(dh.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dhKeys.list });
      void qc.invalidateQueries({ queryKey: dhKeys.limits });
      notify.ok(`Đã xoá datahub "${dh.name}"`, {
        label: "Hoàn tác",
        onClick: () =>
          void restoreDatahub(dh.id)
            .then(() => {
              void qc.invalidateQueries({ queryKey: dhKeys.list });
              void qc.invalidateQueries({ queryKey: dhKeys.limits });
              notify.ok(`Đã khôi phục datahub "${dh.name}"`);
            })
            .catch(() => notify.error("Không khôi phục được. Tên có thể đã bị datahub khác dùng.")),
      });
      onClose();
    },
  });
  return (
    <>
      <ConfirmDialog title="Xoá datahub?" message={<>Datahub "{dh.name}" và {formatCount(dh.tables.length, "bảng")} của nó sẽ vào thùng rác. Bạn khôi phục được trong 7 ngày.</>} confirmLabel="Xoá datahub" busy={m.isPending} onConfirm={() => m.mutate()} onClose={onClose} />
      {m.error && <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2"><ErrorText error={m.error} /></div>}
    </>
  );
}
