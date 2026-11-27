import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { Button, ErrorText, Field, Modal } from "@/components/ui/form";
import { PeoplePicker } from "@/components/ui/people-picker";
import { PersonChip, type PersonInfo } from "@/components/ui/person";
import { Popover } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { addDashShare, dashKeys, getDashboard, listDashShares, removeDashShare, updateDashboard } from "@/lib/dashboard/api";
import type { DashboardBrief } from "@/lib/dashboard/types";

const keyOf = (id: string) => ["mt-dash-shares", id] as const;

/** Share a dashboard: the person sees its numbers (computed with your rights) without any right on the tables. Owner only. */
export function DashboardShareDialog({ dashboard, ownerId, datahubId, onClose }: { dashboard: DashboardBrief; ownerId: string | null; datahubId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keyOf(dashboard.id), queryFn: () => listDashShares(dashboard.id) });
  const cur = useQuery({ queryKey: dashKeys.one(dashboard.id), queryFn: () => getDashboard(dashboard.id) });
  const guestVisible = !!cur.data?.guest_visible;
  const [people, setPeople] = useState<PersonInfo[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const add = useMutation({
    mutationFn: async () => {
      const failed: PersonInfo[] = [];
      let first: unknown = null;
      for (const p of people) {
        try {
          await addDashShare(dashboard.id, p.id);
        } catch (e) {
          failed.push(p);
          first ??= e;
        }
      }
      return { failed, first };
    },
    onSuccess: ({ failed, first }) => {
      void qc.invalidateQueries({ queryKey: keyOf(dashboard.id) });
      const done = people.length - failed.length;
      if (done > 0) notify.ok(done === 1 ? `Đã chia sẻ cho ${people.find((p) => !failed.includes(p))!.full_name}` : `Đã chia sẻ cho ${done} người`);
      setPeople(failed);
      setFailure(failed.length ? first : null);
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

  return (
    <Modal title={`Chia sẻ dashboard "${dashboard.name}"`} open onClose={onClose} wide>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">Người được chia sẻ xem được các con số, tính bằng quyền của bạn. Họ không xem được bảng dữ liệu nguồn, trừ khi bạn chia sẻ cả datahub.</p>
        <section aria-label="Thêm người" className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Thêm người</h3>
          <Field label="Người nhận *" hint="Chọn một hay nhiều người, hoặc cả team, trong một lần.">
            <Popover
              label="Chọn người để chia sẻ"
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              modal
              width="w-auto"
              trigger={
                <Button variant="secondary" aria-label="Chọn người" className="w-full justify-start sm:w-auto">
                  <UserPlus size={16} aria-hidden /> {people.length ? `Đã chọn ${people.length} người, sửa danh sách` : "Chọn người"}
                </Button>
              }
            >
              <PeoplePicker
                value={people}
                excludeIds={ownerId ? [ownerId, ...(q.data ?? []).map((x) => x.grantee_id)] : (q.data ?? []).map((x) => x.grantee_id)}
                onDone={(list) => {
                  setPeople(list);
                  setPickerOpen(false);
                }}
                onCancel={() => setPickerOpen(false)}
              />
            </Popover>
          </Field>
          {people.length > 0 && (
            <ul aria-label="Người sẽ được chia sẻ" className="flex flex-col gap-1" data-testid="dshare-picked">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-md bg-muted p-1.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <PersonChip person={p} />
                    {p.email && <div className="pl-7 text-xs text-muted-foreground [overflow-wrap:anywhere]">{p.email}</div>}
                  </div>
                  <Button variant="ghost" onClick={() => setPeople((l) => l.filter((x) => x.id !== p.id))} aria-label={`Bỏ ${p.full_name}`} className="!px-2"><X size={16} aria-hidden /></Button>
                </li>
              ))}
            </ul>
          )}
          <div><Button onClick={() => add.mutate()} disabled={people.length === 0} loading={add.isPending} data-testid="dshare-add"><UserPlus size={16} aria-hidden /> {people.length > 1 ? `Chia sẻ cho ${people.length} người` : "Chia sẻ"}</Button></div>
          <ErrorText error={failure ?? add.error} />
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
                    <div className="text-sm font-medium [overflow-wrap:anywhere]">{s.full_name ? <PersonChip person={{ id: s.grantee_id, full_name: s.full_name, email: s.email }} /> : "—"}</div>
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
