import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SHARE_PERMISSIONS, SHARE_PERMISSION_LABELS, type SharePermission } from "@soe/shared";
import { UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ErrorText, Field, Input, Modal, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { listShares, lookupPeople, removeShare, setShare, type Share } from "@/lib/datahub/api";
import type { DatahubBrief, Person } from "@/lib/datahub/types";

const keyOf = (datahubId: string) => ["dh-shares", datahubId] as const;

/** Share a whole datahub or one table with a person, as Xem or Sửa dữ liệu (design module2 section 10). Only the owner opens it. */
export function ShareDialog({ dh, onClose }: { dh: DatahubBrief; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keyOf(dh.id), queryFn: () => listShares(dh.id) });
  const tableName = (id: string | null) => (id === null ? "Cả datahub" : (dh.tables.find((t) => t.id === id)?.name ?? "Bảng đã xoá"));
  const change = useMutation({
    mutationFn: (v: { s: Share; permission: SharePermission }) => setShare(dh.id, { grantee_id: v.s.grantee_id, table_id: v.s.table_id, permission: v.permission }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keyOf(dh.id) });
      notify.ok("Đã đổi quyền");
    },
  });
  const revoke = useMutation({
    mutationFn: (s: Share) => removeShare(dh.id, s.id),
    onSuccess: (_r, s) => {
      void qc.invalidateQueries({ queryKey: keyOf(dh.id) });
      notify.ok(`Đã thu hồi quyền của ${s.grantee_name ?? "người này"}`);
    },
  });

  return (
    <Modal title={`Chia sẻ "${dh.name}"`} open onClose={onClose} wide>
      <div className="flex flex-col gap-5">
        <AddShare dh={dh} />
        <section aria-label="Người đang được chia sẻ" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Đang chia sẻ</h3>
          {q.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : q.error ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được danh sách chia sẻ" />
          ) : (q.data ?? []).length === 0 ? (
            <EmptyState title="Chưa chia sẻ cho ai" hint="Chọn một người ở trên để chia sẻ." />
          ) : (
            <ul className="flex flex-col gap-2" data-testid="share-list">
              {q.data!.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2" data-testid="share-row">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium [overflow-wrap:anywhere]">{s.grantee_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{s.grantee_email} · {tableName(s.table_id)}</div>
                  </div>
                  <Select value={s.permission} onChange={(e) => change.mutate({ s, permission: e.target.value as SharePermission })} aria-label={`Quyền của ${s.grantee_name ?? "người này"} với ${tableName(s.table_id)}`} disabled={change.isPending} className="w-auto">
                    {SHARE_PERMISSIONS.map((p) => (
                      <option key={p} value={p}>{SHARE_PERMISSION_LABELS[p]}</option>
                    ))}
                  </Select>
                  <Button variant="secondary" onClick={() => revoke.mutate(s)} loading={revoke.isPending && revoke.variables?.id === s.id} aria-label={`Thu hồi quyền của ${s.grantee_name ?? "người này"} với ${tableName(s.table_id)}`}>
                    <X size={16} aria-hidden /> Thu hồi
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <ErrorText error={change.error ?? revoke.error} />
        </section>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Đóng</Button>
        </div>
      </div>
    </Modal>
  );
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function AddShare({ dh }: { dh: DatahubBrief }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [scope, setScope] = useState<string>("");
  const [permission, setPermission] = useState<SharePermission>("view");
  const term = useDebounced(text.trim(), 250);
  const found = useQuery({ queryKey: ["dh-share-people", term], queryFn: () => lookupPeople({ q: term }), enabled: term.length > 0 && !person });
  const m = useMutation({
    mutationFn: () => setShare(dh.id, { grantee_id: person!.id, table_id: scope || null, permission }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keyOf(dh.id) });
      notify.ok(`Đã chia sẻ cho ${person!.full_name}`);
      setPerson(null);
      setText("");
    },
  });
  const results = (found.data ?? []).filter((p) => p.id !== dh.owner_id);
  return (
    <section aria-label="Thêm người" className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Thêm người</h3>
      {person ? (
        <div className="flex items-center gap-2 rounded-md bg-muted p-2 text-sm" data-testid="share-picked">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{person.full_name}{person.email ? ` · ${person.email}` : ""}</span>
          <Button variant="ghost" onClick={() => setPerson(null)} aria-label="Bỏ chọn người này" className="!px-2"><X size={16} aria-hidden /></Button>
        </div>
      ) : (
        <Field label="Tìm người *" hint="Gõ tên hoặc email, rồi chọn một người trong danh sách.">
          <Input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" role="combobox" aria-expanded={results.length > 0} aria-controls="share-people" />
        </Field>
      )}
      {!person && term.length > 0 && (
        found.isLoading ? <Skeleton className="h-10 w-full" /> : results.length === 0 ? (
          <p className="text-sm text-muted-foreground">Không tìm thấy người nào.</p>
        ) : (
          <ul id="share-people" role="listbox" aria-label="Kết quả tìm người" className="max-h-48 overflow-y-auto rounded-md border border-border">
            {results.map((p) => (
              <li key={p.id} role="option" aria-selected={false}>
                <button type="button" onClick={() => setPerson(p)} className="flex min-h-11 w-full flex-col items-start justify-center px-3 text-left text-sm hover:bg-muted sm:min-h-9">
                  <span className="[overflow-wrap:anywhere]">{p.full_name}</span>
                  <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{p.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phạm vi">
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Cả datahub (kể cả bảng tạo sau)</option>
            {dh.tables.map((t) => (
              <option key={t.id} value={t.id}>Chỉ bảng: {t.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Quyền">
          <Select value={permission} onChange={(e) => setPermission(e.target.value as SharePermission)}>
            {SHARE_PERMISSIONS.map((p) => (
              <option key={p} value={p}>{SHARE_PERMISSION_LABELS[p]}</option>
            ))}
          </Select>
        </Field>
      </div>
      <ErrorText error={m.error} />
      <div>
        <Button onClick={() => m.mutate()} disabled={!person} loading={m.isPending}><UserPlus size={16} aria-hidden /> Chia sẻ</Button>
      </div>
    </section>
  );
}
