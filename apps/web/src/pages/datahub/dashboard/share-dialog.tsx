import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ErrorText, Field, Input, Modal } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { addDashShare, dashKeys, getDashboard, listDashShares, removeDashShare, updateDashboard } from "@/lib/dashboard/api";
import type { DashboardBrief } from "@/lib/dashboard/types";
import { lookupPeople } from "@/lib/datahub/api";
import type { Person } from "@/lib/datahub/types";

const keyOf = (id: string) => ["mt-dash-shares", id] as const;

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Share a dashboard: the person sees its numbers (computed with your rights) without any right on the tables. Owner only. */
export function DashboardShareDialog({ dashboard, ownerId, datahubId, onClose }: { dashboard: DashboardBrief; ownerId: string | null; datahubId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keyOf(dashboard.id), queryFn: () => listDashShares(dashboard.id) });
  const cur = useQuery({ queryKey: dashKeys.one(dashboard.id), queryFn: () => getDashboard(dashboard.id) });
  const guestVisible = !!cur.data?.guest_visible;
  const [text, setText] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const term = useDebounced(text.trim(), 250);
  const found = useQuery({ queryKey: ["dh-share-people", term], queryFn: () => lookupPeople({ q: term }), enabled: term.length > 0 && !person });
  const add = useMutation({
    mutationFn: () => addDashShare(dashboard.id, person!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keyOf(dashboard.id) });
      notify.ok(`Đã chia sẻ cho ${person!.full_name}`);
      setPerson(null);
      setText("");
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => removeDashShare(dashboard.id, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keyOf(dashboard.id) });
      notify.ok("Đã bỏ chia sẻ");
    },
  });
  const guest = useMutation({
    mutationFn: async (on: boolean) => {
      const fresh = await getDashboard(dashboard.id);
      return updateDashboard(dashboard.id, fresh.version, { guest_visible: on });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dashKeys.one(dashboard.id) });
      void qc.invalidateQueries({ queryKey: dashKeys.list(datahubId) });
    },
  });
  const results = (found.data ?? []).filter((p) => p.id !== ownerId);

  return (
    <Modal title={`Chia sẻ dashboard "${dashboard.name}"`} open onClose={onClose} wide>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">Người được chia sẻ xem được các con số, tính bằng quyền của bạn. Họ không xem được bảng dữ liệu nguồn, trừ khi bạn chia sẻ cả datahub.</p>
        <section aria-label="Thêm người" className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Thêm người</h3>
          {person ? (
            <div className="flex items-center gap-2 rounded-md bg-muted p-2 text-sm" data-testid="dshare-picked">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{person.full_name}{person.email ? ` · ${person.email}` : ""}</span>
              <Button variant="ghost" onClick={() => setPerson(null)} aria-label="Bỏ chọn người này" className="!px-2"><X size={16} aria-hidden /></Button>
            </div>
          ) : (
            <Field label="Tìm người *" hint="Gõ tên hoặc email, rồi chọn một người trong danh sách.">
              <Input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" role="combobox" aria-expanded={results.length > 0} aria-controls="dshare-people" />
            </Field>
          )}
          {!person && term.length > 0 && (found.isLoading ? <Skeleton className="h-10 w-full" /> : results.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không tìm thấy người nào.</p>
          ) : (
            <ul id="dshare-people" role="listbox" aria-label="Kết quả tìm người" className="max-h-48 overflow-y-auto rounded-md border border-border">
              {results.map((p) => (
                <li key={p.id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => setPerson(p)} className="flex min-h-11 w-full flex-col items-start justify-center px-3 text-left text-sm hover:bg-muted sm:min-h-9">
                    <span className="[overflow-wrap:anywhere]">{p.full_name}</span>
                    <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{p.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
          <div><Button onClick={() => add.mutate()} disabled={!person} loading={add.isPending} data-testid="dshare-add"><UserPlus size={16} aria-hidden /> Chia sẻ</Button></div>
          <ErrorText error={add.error} />
        </section>
        <section aria-label="Người đang được chia sẻ" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Đang chia sẻ</h3>
          {q.isLoading ? <Skeleton className="h-16 w-full" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được danh sách chia sẻ" /> : (q.data ?? []).length === 0 ? (
            <EmptyState title="Chưa chia sẻ cho ai" hint="Chọn một người ở trên để chia sẻ." />
          ) : (
            <ul className="flex flex-col gap-2" data-testid="dshare-list">
              {q.data!.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2" data-testid="dshare-row">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium [overflow-wrap:anywhere]">{s.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{s.email}</div>
                  </div>
                  <Button variant="secondary" onClick={() => revoke.mutate(s.id)} loading={revoke.isPending && revoke.variables === s.id} aria-label={`Bỏ chia sẻ với ${s.full_name ?? "người này"}`}><X size={16} aria-hidden /> Bỏ chia sẻ</Button>
                </li>
              ))}
            </ul>
          )}
          <ErrorText error={revoke.error} />
        </section>
        <section aria-label="Guest" className="flex flex-col gap-1">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={guestVisible} disabled={guest.isPending || !cur.data} onChange={(e) => guest.mutate(e.target.checked)} data-testid="dshare-guest" />
            Cho Guest được cấp dữ liệu Dashboard xem dashboard này
          </label>
          <span className="text-xs text-muted-foreground">Manager cấp loại dữ liệu “Dashboard” cho Guest ở mục Cấp dữ liệu Guest; Guest chỉ thấy các dashboard bạn đã mở ở đây.</span>
          <ErrorText error={guest.error} />
        </section>
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Đóng</Button></div>
      </div>
    </Modal>
  );
}
