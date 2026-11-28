import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { Button, ConfirmDialog, ErrorText, PageTitle } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PersonChip } from "@/components/ui/person";
import { PeoplePicker } from "@/components/ui/people-picker";
import { Popover } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, fmtTime } from "@/lib/api";
import { roleLabels, type PersonInfo } from "@/lib/people";

interface Holder { user_id: string; full_name: string; email: string | null; roles: string[]; note: string | null; granted_at: string; granted_by_name: string | null; writable: boolean }
interface PermissionRow { permission: string; label: string; grantable_by: string[]; eligible_roles: string[]; by_roles: string[]; can_manage: boolean; holders: Holder[] }

/** One supplementary permission: who has it, a button to add people (only roles that may hold it), a remove button per person. */
function PermissionCard({ row }: { row: PermissionRow }) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removing, setRemoving] = useState<Holder | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["org", "holders"] });
  const grant = useMutation({
    mutationFn: async (people: PersonInfo[]) => {
      const failed: { name: string; error: unknown }[] = [];
      for (const p of people) {
        try {
          await api("POST", `/org/members/${p.id}/permissions`, { permission: row.permission });
        } catch (error) {
          failed.push({ name: p.full_name, error });
        }
      }
      return { done: people.length - failed.length, failed };
    },
    onSuccess: ({ done, failed }) => {
      refresh();
      if (done > 0) notify.ok(done === 1 ? "Đã cấp quyền" : `Đã cấp quyền cho ${done} người`);
      if (failed.length) notify.error(`Không cấp được cho ${failed.map((f) => f.name).join(", ")}`);
    },
  });
  const revoke = useMutation({
    mutationFn: (h: Holder) => api("DELETE", `/org/members/${h.user_id}/permissions/${encodeURIComponent(row.permission)}`),
    onSuccess: () => {
      setRemoving(null);
      refresh();
      notify.ok("Đã gỡ quyền");
    },
    onError: () => setRemoving(null),
  });
  const eligible = (p: PersonInfo) => !p.roles || p.roles.length === 0 || p.roles.some((r) => row.eligible_roles.includes(r));
  return (
    <Card data-testid={`perm-${row.permission}`}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{row.label}</CardTitle>
        {row.can_manage && (
          <Popover
            label={`Thêm người cho quyền ${row.label}`}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            width="w-auto"
            align="end"
            trigger={<Button variant="secondary" aria-label={`Thêm người cho ${row.label}`}><UserPlus size={16} aria-hidden /> Thêm người</Button>}
          >
            <PeoplePicker
              value={[]}
              teams={false}
              excludeIds={row.holders.map((h) => h.user_id)}
              accept={eligible}
              onCancel={() => setPickerOpen(false)}
              onDone={(list) => {
                setPickerOpen(false);
                if (list.length) grant.mutate(list);
              }}
            />
          </Popover>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-[13px]">
        {row.holders.length === 0 ? (
          <p className="text-muted-foreground">Chưa cấp cho ai.</p>
        ) : (
          <ul aria-label={`Người có quyền ${row.label}`} className="flex flex-wrap gap-2">
            {row.holders.map((h) => (
              <li key={h.user_id} data-testid="perm-holder" className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-muted/60 py-0.5 pl-1.5 pr-1">
                <PersonChip person={{ id: h.user_id, full_name: h.full_name, email: h.email, roles: h.roles }} />
                {row.can_manage && h.writable && (
                  <button type="button" aria-label={`Gỡ quyền của ${h.full_name}`} title={`Cấp bởi ${h.granted_by_name ?? "—"}, ${fmtTime(h.granted_at)}`} onClick={() => setRemoving(h)} className="inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-border hover:text-foreground">
                    <X size={14} aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {row.by_roles.length > 0 && <p className="text-xs text-muted-foreground">Có sẵn theo vai trò: {roleLabels(row.by_roles)}</p>}
        <p className="text-xs text-muted-foreground">Vai trò được cấp: {roleLabels(row.eligible_roles)}. {row.can_manage ? "" : `Chỉ ${roleLabels(row.grantable_by)} cấp quyền này.`}</p>
        <ErrorText error={grant.error ?? revoke.error} />
      </CardContent>
      {removing && <ConfirmDialog title="Gỡ quyền?" message={<>Gỡ quyền "{row.label}" của {removing.full_name}?</>} confirmLabel="Gỡ quyền" busy={revoke.isPending} onConfirm={() => revoke.mutate(removing)} onClose={() => setRemoving(null)} />}
    </Card>
  );
}

/** "Phân quyền bổ sung" (/quan-tri/quyen-bo-sung, design module11 4.1): the supplementary permissions and the people who hold each. */
export function ExtraPermissionsPage() {
  const q = useQuery({ queryKey: ["org", "holders"], queryFn: () => api<PermissionRow[]>("GET", "/org/permissions/holders") });
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Phân quyền bổ sung</PageTitle>
      <p className="text-sm text-muted-foreground">Những quyền cấp thêm cho từng người, ngoài quyền theo vai trò.</p>
      {q.isLoading && <Skeleton className="h-32 w-full" />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.data?.map((row) => <PermissionCard key={row.permission} row={row} />)}
    </div>
  );
}
