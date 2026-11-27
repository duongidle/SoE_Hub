import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PersonChip } from "@/components/ui/person";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, ConfirmDialog, ErrorText, Field, Input, Modal, PageTitle, Select, Tabs } from "@/components/ui/form";
import { PeopleField } from "@/components/ui/people-field";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, apiList } from "@/lib/api";
import { disambiguate } from "@/lib/people";
import { useMe } from "@/lib/session";
import { Chip, OnbNav, PLAN_STATUS, addDays, usePlans, type PlanFull } from "./common";

interface Member { id: string; full_name: string; roles: string[]; leader_id: string | null }

const nextMonday = () => {
  const d = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(d, wd === 1 ? 0 : (8 - wd) % 7);
};
const isMonday = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).getUTCDay() === 1;

function AssignDialog({ plan, onClose }: { plan: PlanFull; onClose: () => void }) {
  const me = useMe().data;
  const nav = useNavigate();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ["onb", "members"], queryFn: () => apiList<Member>("/org/members?limit=200") });
  const people = (members.data?.data ?? []).filter((m) => m.id !== me?.user.id && m.roles.includes("user"));
  const [staff, setStaff] = useState("");
  const [start, setStart] = useState(nextMonday());
  const [followers, setFollowers] = useState<string[]>([]);
  const staffNames = disambiguate(people);
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api<PlanFull>("POST", `/onboarding/plans/${plan.id}/assign`, { staff_id: staff, start_date: start, ...(followers.length ? { followers } : {}) }),
    onSuccess: async (p) => { await qc.invalidateQueries({ queryKey: ["onb"] }); notify.ok("Đã gắn lộ trình."); onClose(); await nav({ to: "/onboarding/nhan-su/$planId", params: { planId: p.id } }); },
  });
  const go = () => {
    if (!staff) { setErr("Chọn nhân sự."); return; }
    if (!isMonday(start)) { setErr("Ngày bắt đầu phải là thứ Hai."); return; }
    setErr(null); m.mutate();
  };
  return (
    <Modal title={`Gắn lộ trình: ${plan.name}`} open onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Nhân sự" required><Select value={staff} onChange={(e) => setStaff(e.target.value)} data-testid="assign-staff"><option value="">Chọn người trong team</option>{people.map((p) => <option key={p.id} value={p.id}>{staffNames.get(p.id)}</option>)}</Select></Field>
        <Field label="Ngày bắt đầu (thứ Hai)" required><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="assign-start" /></Field>
        <Field label="Người theo dõi (tuỳ chọn)"><PeopleField label="Người theo dõi" value={followers} onChange={setFollowers} teams={false} excludeIds={me ? [me.user.id, staff].filter(Boolean) : staff ? [staff] : []} accept={(p) => !p.roles || p.roles.some((r) => r === "leader" || r === "manager")} testid="assign-followers" /></Field>
        {err && <p className="text-sm text-bad" role="alert">{err}</p>}
        <ErrorText error={m.error} />
        <div className="flex justify-between gap-2"><Button variant="secondary" onClick={onClose}>Huỷ</Button><Button loading={m.isPending} onClick={go} data-testid="assign-ok">Gắn</Button></div>
      </div>
    </Modal>
  );
}

function CreateDialog({ onClose, template }: { onClose: () => void; template: boolean }) {
  const [name, setName] = useState("");
  const nav = useNavigate();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api<PlanFull>("POST", "/onboarding/plans", { name: name.trim(), is_template: template, structure: { stages: [{ name: "Giai đoạn 1", weeks: [{ name: "Tuần 1", items: [] }] }] } }),
    onSuccess: async (p) => { await qc.invalidateQueries({ queryKey: ["onb"] }); onClose(); await nav({ to: "/onboarding/lo-trinh/$planId", params: { planId: p.id } }); },
  });
  return (
    <Modal title={template ? "Tạo lộ trình mẫu" : "Tạo lộ trình"} open onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Tên lộ trình" required><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="plan-name" /></Field>
        <ErrorText error={m.error} />
        <div className="flex justify-between gap-2"><Button variant="secondary" onClick={onClose}>Huỷ</Button><Button disabled={!name.trim()} loading={m.isPending} onClick={() => m.mutate()} data-testid="plan-create-ok">Tạo</Button></div>
      </div>
    </Modal>
  );
}

export function PlanListPage() {
  const me = useMe().data;
  const [scope, setScope] = useState<"mine" | "template" | "following">("mine");
  const [dlg, setDlg] = useState<{ kind: "assign" | "delete"; plan: PlanFull } | "create" | null>(null);
  const list = usePlans(scope);
  const qc = useQueryClient();
  const nav = useNavigate();
  const clone = useMutation({
    mutationFn: async (p: PlanFull) => {
      const c = await api<PlanFull>("POST", `/onboarding/plans/${p.id}/clone`, {});
      const full = await api<PlanFull>("GET", `/onboarding/plans/${c.id}`);
      return { full, need: full.stages.flatMap((s) => s.weeks.flatMap((w) => w.items)).filter((i) => i.need_form).length };
    },
    onSuccess: async ({ full, need }) => {
      await qc.invalidateQueries({ queryKey: ["onb"] });
      if (need > 0) notify.info(`Đã nhân bản. ${need} việc cần chọn form của bạn.`); else notify.ok("Đã nhân bản lộ trình.");
      await nav({ to: "/onboarding/lo-trinh/$planId", params: { planId: full.id } });
    },
    onError: (e) => notify.error(e instanceof Error ? e.message : "Không nhân bản được."),
  });
  const del = useMutation({ mutationFn: (p: PlanFull) => api("DELETE", `/onboarding/plans/${p.id}`), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["onb"] }); notify.ok("Đã xoá lộ trình."); setDlg(null); } });
  const rows = (list.data ?? []).filter((p) => scope !== "mine" || p.staff_id !== me?.user.id);
  return (
    <div>
      <PageTitle actions={<Button onClick={() => setDlg("create")} data-testid="plan-new">Tạo lộ trình</Button>}>Lộ trình onboarding</PageTitle>
      <OnbNav active="plans" />
      <Tabs value={scope} onChange={setScope} items={[{ value: "mine", label: "Của tôi" }, { value: "template", label: "Mẫu" }, { value: "following", label: "Tôi theo dõi" }]} />
      {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : list.isLoading ? <p className="text-sm text-muted-foreground">Đang tải...</p> : rows.length === 0 ? <EmptyState title="Chưa có lộ trình" hint="Nhân bản lộ trình mẫu hoặc tạo mới." /> : (
        <ul className="flex flex-col gap-2" data-testid="plan-list">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3" data-testid="plan-row" data-name={p.name}>
              <div className="min-w-0 flex-1">
                <div className="font-medium [overflow-wrap:anywhere]">{p.name}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {p.is_template ? <Chip cls="bg-primary/10 text-primary">Mẫu</Chip> : <Chip cls="bg-muted text-muted-foreground">{PLAN_STATUS[p.status] ?? p.status}</Chip>}
                  {p.staff_name && p.staff_id ? <PersonChip person={{ id: p.staff_id, full_name: p.staff_name }} /> : p.staff_name && <span>{p.staff_name}</span>}
                  <span>{p.weeks ?? 0} tuần</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {p.staff_id && <Link to="/onboarding/nhan-su/$planId" params={{ planId: p.id }} className="inline-flex min-h-9 items-center px-2 text-sm text-primary underline">Xem tiến độ</Link>}
                <Link to="/onboarding/lo-trinh/$planId" params={{ planId: p.id }} className="inline-flex min-h-9 items-center px-2 text-sm text-primary underline" data-testid="plan-edit">Sửa</Link>
                <Button variant="secondary" loading={clone.isPending && clone.variables?.id === p.id} onClick={() => clone.mutate(p)} data-testid="plan-clone">Nhân bản</Button>
                {!p.staff_id && <Button variant="secondary" onClick={() => setDlg({ kind: "assign", plan: p })} data-testid="plan-assign">Gắn cho nhân sự</Button>}
                {p.status !== "active" && <Button variant="ghost" onClick={() => setDlg({ kind: "delete", plan: p })} aria-label={`Xoá ${p.name}`}>Xoá</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {dlg === "create" && <CreateDialog template={scope === "template"} onClose={() => setDlg(null)} />}
      {dlg && dlg !== "create" && dlg.kind === "assign" && <AssignDialog plan={dlg.plan} onClose={() => setDlg(null)} />}
      {dlg && dlg !== "create" && dlg.kind === "delete" && <ConfirmDialog title="Xoá lộ trình" message={`Xoá "${dlg.plan.name}"? Không hoàn tác được.`} confirmLabel="Xoá" busy={del.isPending} onClose={() => setDlg(null)} onConfirm={() => del.mutate(dlg.plan)} />}
    </div>
  );
}
