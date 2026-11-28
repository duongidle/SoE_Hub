import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlarmClock, Bell, BookOpen, Bot, ClipboardList, Database, GraduationCap, Handshake, Megaphone, MessageSquare, Sunrise, UserRound, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonClass, ErrorText, Input, Notice, PageTitle, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { can, useMe } from "@/lib/session";
import { CATEGORY_LABEL } from "./inbox";

interface TypeRow { type: string; category: string; label: string; description: string; mandatory: boolean; enabled: boolean }
interface Settings { morning_digest: boolean; types: TypeRow[] }

/** Nhóm theo mảng: tên, icon, thứ tự hiện (loại không có trong danh sách rơi xuống cuối với tên mã nhóm). */
const GROUPS: Record<string, { label: string; icon: LucideIcon }> = {
  account: { label: "Tài khoản", icon: UserRound },
  datahub: { label: "Datahub", icon: Database },
  deal: { label: "Quản lý Deal", icon: Handshake },
  ai: { label: "Kết nối AI", icon: Bot },
  form: { label: "Dynamic Form", icon: ClipboardList },
  library: { label: "Knowledge và AI Hub", icon: BookOpen },
  onboarding: { label: "Onboarding", icon: GraduationCap },
  reminder: { label: "Nhắc hẹn", icon: AlarmClock },
  announcement: { label: "Thông báo chung", icon: Megaphone },
  feedback: { label: "Góp ý", icon: MessageSquare },
};

function TypeSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notification-settings"], queryFn: () => api<Settings>("GET", "/notifications/settings") });
  const save = useMutation({
    mutationFn: (body: { disabled_types?: string[]; morning_digest?: boolean }) => api("PUT", "/notifications/settings", body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notification-settings"] }); notify.ok("Đã lưu"); },
  });
  const data = q.data;
  const disabledAfter = (type: string, on: boolean) => data!.types.filter((t) => !t.mandatory && (t.type === type ? !on : !t.enabled)).map((t) => t.type);
  const cats = [...new Set(data?.types.map((t) => t.category) ?? [])].sort((x, y) => {
    const order = Object.keys(GROUPS);
    return (order.indexOf(x) + 1 || 99) - (order.indexOf(y) + 1 || 99);
  });
  return (
    <>
      <ErrorText error={q.error ?? save.error} />
      {data && (
        <>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Sunrise className="size-[18px]" aria-hidden /></span>
              <Switch
                className="flex-1"
                label={<span className="text-[13px] font-medium">Bản tin buổi sáng</span>}
                hint={<span className="text-xs">Mỗi sáng 08:00 tóm tắt việc cần làm hôm nay của bạn.</span>}
                checked={data.morning_digest}
                onChange={(v) => save.mutate({ morning_digest: v })}
                testid="digest-toggle"
              />
            </CardContent>
          </Card>
          {cats.map((c) => {
            const g = GROUPS[c];
            const Icon = g?.icon ?? Bell;
            const rows = data.types.filter((t) => t.category === c);
            const optional = rows.filter((t) => !t.mandatory);
            const always = rows.filter((t) => t.mandatory);
            return (
              <Card key={c} data-testid={`group-${c}`}>
                <CardHeader className="flex-row items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <CardTitle>{g?.label ?? CATEGORY_LABEL[c] ?? c}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col divide-y divide-border">
                  {optional.map((t) => (
                    <Switch
                      key={t.type}
                      label={<span className="text-[13px] font-medium" title={t.type}>{t.label}</span>}
                      hint={<span className="text-xs [overflow-wrap:anywhere]">{t.description}</span>}
                      checked={t.enabled}
                      onChange={(v) => save.mutate({ disabled_types: disabledAfter(t.type, v) })}
                      testid={`type-${t.type}`}
                    />
                  ))}
                  {always.length > 0 && (
                    <p className="py-2 text-xs text-muted-foreground [overflow-wrap:anywhere]" data-testid={`always-${c}`}>
                      <span className="font-medium text-foreground">Luôn nhận:</span> {always.map((t) => t.label).join(", ")}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </>
  );
}

interface Milestone { kind: "before" | "on" | "after"; days: number; to: string[] }
interface Rule { key: "deal_expected_close" | "payment_due"; enabled: boolean; milestones: Milestone[] }
const RULE_NAME = { deal_expected_close: "Deal quá ngày dự kiến chốt", payment_due: "Đợt thanh toán đến hạn" } as const;
const KIND = { before: "Trước", on: "Đúng ngày", after: "Quá" } as const;
const WHO = { leading: "Leading", participants: "Người tham gia", leader: "Leader", manager: "Manager" } as const;

function DueRules() {
  const qc = useQueryClient();
  const me = useMe().data;
  const q = useQuery({ queryKey: ["due-rules"], enabled: can(me, "deal:deal:read"), queryFn: () => api<{ rules: Rule[]; can_edit: boolean }>("GET", "/deals/due-rules") });
  const [draft, setRules] = useState<Rule[] | null>(null);
  const rules = draft ?? q.data?.rules ?? [];
  const save = useMutation({
    mutationFn: () => api("PUT", "/deals/due-rules", { rules }),
    onSuccess: () => { setRules(null); void qc.invalidateQueries({ queryKey: ["due-rules"] }); notify.ok("Đã lưu quy tắc nhắc hạn"); },
  });
  if (!q.data?.can_edit) return null;
  const setRule = (i: number, f: (r: Rule) => Rule) => setRules(rules.map((r, j) => (j === i ? f(r) : r)));
  const setMs = (i: number, k: number, f: (m: Milestone) => Milestone) => setRule(i, (r) => ({ ...r, milestones: r.milestones.map((m, j) => (j === k ? f(m) : m)) }));
  return (
    <Card>
      <CardHeader><CardTitle>Nhắc hạn của cây</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <Notice>Chạy 08:30 mỗi ngày. Người nhận chỉ nghe về deal họ được thấy.</Notice>
        {rules.map((r, i) => (
          <div key={r.key} className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid={`rule-${r.key}`}>
            <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={r.enabled} onChange={(e) => setRule(i, (x) => ({ ...x, enabled: e.target.checked }))} />{RULE_NAME[r.key]}</label>
            {r.milestones.map((m, k) => (
              <div key={k} className="flex flex-wrap items-center gap-2">
                <Select aria-label="Mốc" className="!w-32" value={m.kind} onChange={(e) => setMs(i, k, (x) => ({ ...x, kind: e.target.value as Milestone["kind"], days: e.target.value === "on" ? 0 : Math.max(1, x.days) }))}>
                  {Object.entries(KIND).map(([a, b]) => <option key={a} value={a}>{b}</option>)}
                </Select>
                <Input aria-label="Số ngày" type="number" min={0} max={365} className="!w-20" disabled={m.kind === "on"} value={m.days} onChange={(e) => setMs(i, k, (x) => ({ ...x, days: Math.max(0, Number(e.target.value) || 0) }))} />
                <span>ngày</span>
                {Object.entries(WHO).map(([w, label]) => (
                  <label key={w} className="flex items-center gap-1"><input type="checkbox" checked={m.to.includes(w)} onChange={(e) => setMs(i, k, (x) => ({ ...x, to: e.target.checked ? [...x.to, w] : x.to.filter((y) => y !== w) }))} />{label}</label>
                ))}
                <Button variant="ghost" onClick={() => setRule(i, (x) => ({ ...x, milestones: x.milestones.filter((_, j) => j !== k) }))}>Bỏ mốc</Button>
              </div>
            ))}
            {r.milestones.length < 5 && <div><Button variant="secondary" onClick={() => setRule(i, (x) => ({ ...x, milestones: [...x.milestones, { kind: "before", days: 1, to: ["leading"] }] }))}>Thêm mốc</Button></div>}
          </div>
        ))}
        <ErrorText error={save.error} />
        <div><Button loading={save.isPending} onClick={() => save.mutate()}>Lưu quy tắc</Button></div>
      </CardContent>
    </Card>
  );
}

export function NotificationSettingsPage() {
  const me = useMe().data;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle actions={<Link to="/thong-bao" className={buttonClass({ variant: "secondary" })}><Bell size={14} aria-hidden />Thông báo</Link>}>Cài đặt thông báo</PageTitle>
      <TypeSettings />
      {me && <DueRules />}
    </div>
  );
}
