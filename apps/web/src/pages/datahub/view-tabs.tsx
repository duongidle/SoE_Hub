import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Copy, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/dropdown";
import { Button, ConfirmDialog, ErrorText, Field, Input, Modal } from "@/components/ui/form";
import { notify } from "@/components/ui/toast";
import { createView, deleteView, dhKeys, resetView, updateView } from "@/lib/datahub/api";
import type { Level } from "@/lib/datahub/types";
import type { ViewConfig, ViewDto } from "@/lib/datahub/view-config";
import { cn } from "@/lib/utils";

type Views = { views: ViewDto[]; last_view_id: string | null };

/** The views of a table as tabs: pick one, add, rename, copy, move, reset to the shared setting, delete. */
export function ViewTabs({ tableId, views, currentId, access, onSelect, currentConfig }: { tableId: string; views: ViewDto[]; currentId: string; access: Level; onSelect: (id: string) => void; currentConfig: ViewConfig }) {
  const qc = useQueryClient();
  const owner = access === "owner";
  const [dialog, setDialog] = useState<{ kind: "add" } | { kind: "rename"; v: ViewDto } | { kind: "delete"; v: ViewDto } | { kind: "copy"; v: ViewDto } | null>(null);
  const cur = views.find((v) => v.id === currentId);

  const refresh = () => qc.invalidateQueries({ queryKey: dhKeys.views(tableId) });
  const put = (v: ViewDto) => qc.setQueryData<Views>(dhKeys.views(tableId), (old) => (old ? { ...old, views: old.views.map((x) => (x.id === v.id ? v : x)) } : old));

  const canMove = (v: ViewDto) => (v.shared ? owner : true);
  const neighbour = (v: ViewDto, by: -1 | 1) => {
    const same = views.filter((x) => x.shared === v.shared);
    return same[same.indexOf(v) + by];
  };
  const move = useMutation({
    mutationFn: async ({ v, by }: { v: ViewDto; by: -1 | 1 }) => {
      const other = neighbour(v, by);
      if (!other) return;
      // Positions are plain numbers: swap the two. When they are equal, spread them first.
      const a = v.position === other.position ? other.position + by : other.position;
      await updateView(v.id, { position: Math.max(0, a) });
      if (v.position !== other.position) await updateView(other.id, { position: v.position });
    },
    onSettled: () => void refresh(),
    onError: () => notify.error("Không đổi được thứ tự view. Thử lại."),
  });
  const reset = useMutation({
    mutationFn: (v: ViewDto) => resetView(v.id),
    onSuccess: (v) => {
      put(v);
      notify.ok("Đã về thiết lập mặc định của chủ bảng");
    },
    onError: () => notify.error("Không về mặc định được. Thử lại."),
  });

  return (
    <>
      <div role="tablist" aria-label="Các view" className="flex items-center gap-1 overflow-x-auto border-b border-border">
        {views.map((v) => {
          const on = v.id === currentId;
          return (
            <div key={v.id} className={cn("flex shrink-0 items-center border-b-2", on ? "border-primary" : "border-transparent")}>
              <button type="button" role="tab" aria-selected={on} title={v.name} onClick={() => onSelect(v.id)} className={cn("flex max-w-48 items-center gap-2 px-3 py-3 text-sm sm:py-2", on ? "font-medium" : "text-muted-foreground hover:text-foreground")}>
                <span className="truncate">{v.name}</span>
                {!v.shared && <Badge tone="muted">Riêng</Badge>}
              </button>
              {on && (
                <Menu trigger={<Button variant="ghost" aria-label={`Tuỳ chọn view ${v.name}`} className="!px-1.5"><MoreHorizontal size={16} aria-hidden /></Button>} align="start">
                  {(owner || !v.shared) && <MenuItem onSelect={() => setDialog({ kind: "rename", v })}><Pencil size={16} aria-hidden /> Đổi tên view</MenuItem>}
                  <MenuItem onSelect={() => setDialog({ kind: "copy", v })}><Copy size={16} aria-hidden /> Sao chép view</MenuItem>
                  {v.has_override && <MenuItem onSelect={() => reset.mutate(v)}><RotateCcw size={16} aria-hidden /> Về mặc định</MenuItem>}
                  {canMove(v) && (
                    <>
                      <MenuItem disabled={!neighbour(v, -1)} onSelect={() => move.mutate({ v, by: -1 })}><ChevronLeft size={16} aria-hidden /> Chuyển sang trái</MenuItem>
                      <MenuItem disabled={!neighbour(v, 1)} onSelect={() => move.mutate({ v, by: 1 })}><ChevronRight size={16} aria-hidden /> Chuyển sang phải</MenuItem>
                    </>
                  )}
                  {(owner || !v.shared) && views.length > 1 && (
                    <>
                      <MenuSeparator />
                      <MenuItem danger onSelect={() => setDialog({ kind: "delete", v })}><Trash2 size={16} aria-hidden /> Xoá view</MenuItem>
                    </>
                  )}
                </Menu>
              )}
            </div>
          );
        })}
        <Button variant="ghost" className="shrink-0" onClick={() => setDialog({ kind: "add" })}>
          <Plus size={16} aria-hidden /> Thêm view
        </Button>
      </div>
      {cur && cur.shared && !owner && cur.has_override && (
        <p className="text-xs text-muted-foreground">Bạn đang xem bản riêng của view này; thay đổi của bạn không ảnh hưởng người khác. Chọn "Về mặc định" trong menu view để bỏ.</p>
      )}
      {dialog && (dialog.kind === "add" || dialog.kind === "copy") && (
        <NameDialog
          title={dialog.kind === "add" ? "Thêm view" : "Sao chép view"}
          submit={dialog.kind === "add" ? "Thêm view" : "Sao chép"}
          initial={dialog.kind === "copy" ? `${dialog.v.name} (bản sao)`.slice(0, 100) : ""}
          offerShared={owner}
          onClose={() => setDialog(null)}
          save={async (name, shared) => {
            const v = await createView(tableId, { name, shared, config: dialog.kind === "copy" ? dialog.v.config : currentConfig });
            await refresh();
            onSelect(v.id);
            notify.ok(`Đã thêm view "${name}"`);
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          title="Đổi tên view"
          submit="Lưu"
          initial={dialog.v.name}
          onClose={() => setDialog(null)}
          save={async (name) => {
            put(await updateView(dialog.v.id, { name }));
            notify.ok("Đã lưu");
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteView
          v={dialog.v}
          onClose={() => setDialog(null)}
          onDone={async () => {
            await refresh();
            const rest = views.filter((x) => x.id !== dialog.v.id);
            if (dialog.v.id === currentId && rest[0]) onSelect(rest[0].id);
          }}
        />
      )}
    </>
  );
}

function nameProblem(name: string): string | null {
  const t = name.trim();
  if (!t) return "Nhập tên view.";
  if (t.length > 100) return "Tên view tối đa 100 ký tự.";
  return null;
}

function NameDialog({ title, submit, initial = "", offerShared, save, onClose }: { title: string; submit: string; initial?: string; offerShared?: boolean; save: (name: string, shared: boolean) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [shared, setShared] = useState(false);
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const m = useMutation({ mutationFn: () => save(name.trim(), shared), onSuccess: onClose });
  const err = touched ? nameProblem(name) : null;
  useEffect(() => {
    if (m.error) input.current?.focus();
  }, [m.error]);
  return (
    <Modal title={title} open onClose={onClose} dirty={name !== initial && !m.isPending}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (nameProblem(name)) input.current?.focus(); else m.mutate(); }}>
        <Field label="Tên view *" hint="Tối đa 100 ký tự.">
          <Input ref={input} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={!!err || !!m.error} autoFocus autoComplete="off" maxLength={100} />
        </Field>
        {err && <p role="alert" className="-mt-3 text-xs text-bad">{err}</p>}
        {offerShared && (
          <label className="flex min-h-9 items-center gap-2">
            <input type="checkbox" className="h-5 w-5" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            View chung: mọi người có quyền xem bảng đều thấy
          </label>
        )}
        <ErrorText error={m.error} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={m.isPending}>{submit}</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteView({ v, onClose, onDone }: { v: ViewDto; onClose: () => void; onDone: () => Promise<void> }) {
  const m = useMutation({
    mutationFn: () => deleteView(v.id),
    onSuccess: async () => {
      await onDone();
      notify.ok(`Đã xoá view "${v.name}"`);
      onClose();
    },
  });
  return (
    <>
      <ConfirmDialog title="Xoá view?" message={<>View "{v.name}" sẽ bị xoá. {v.shared ? "Mọi người trong bảng này không còn thấy nó. " : ""}Dữ liệu của bảng không đổi.</>} confirmLabel="Xoá view" busy={m.isPending} onConfirm={() => m.mutate()} onClose={onClose} />
      {m.error && <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2"><ErrorText error={m.error} /></div>}
    </>
  );
}
