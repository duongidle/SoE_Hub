import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, ErrorText, Input, Notice, PageTitle, Select } from "@/components/ui/form";
import { notify } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useMe } from "@/lib/session";
import { CATEGORY_LABEL } from "./inbox";

interface Settings {
  morning_digest: boolean;
  types: { type: string; category: string; mandatory: boolean; enabled: boolean }[];
}

function TypeSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notification-settings"], queryFn: () => api<Settings>("GET", "/notifications/settings") });
  const save = useMutation({
    mutationFn: (body: { disabled_types?: string[]; morning_digest?: boolean }) => api("PUT", "/notifications/settings", body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notification-settings"] }); notify.ok("Đã lưu"); },
  });
  const data = q.data;
  const disabledAfter = (type: string, on: boolean) => data!.types.filter((t) => !t.mandatory && (t.type === type ? !on : !t.enabled)).map((t) => t.type);
  const cats = [...new Set(data?.types.map((t) => t.category) ?? [])];
  return (
    <Card>
      <CardHeader><CardTitle>Loại thông báo</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <ErrorText error={q.error ?? save.error} />
        {data && (
          <>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={data.morning_digest} onChange={(e) => save.mutate({ morning_digest: e.target.checked })} data-testid="digest-toggle" />
              Bản tin buổi sáng (08:00, việc cần làm hôm nay)
            </label>
            {cats.map((c) => (
              <div key={c} className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">{CATEGORY_LABEL[c] ?? c}</h3>
                {data.types.filter((t) => t.category === c).map((t) => (
                  <label key={t.type} className="flex items-center gap-2">
                    <input type="checkbox" checked={t.enabled} disabled={t.mandatory} data-testid={`type-${t.type}`} onChange={(e) => save.mutate({ disabled_types: disabledAfter(t.type, e.target.checked) })} />
                    <span className="[overflow-wrap:anywhere]">{t.type}</span>
                    {t.mandatory && <span className="text-xs text-muted-foreground">Không tắt được</span>}
                  </label>
                ))}
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface Milestone { kind: "before" | "on" | "after"; days: number; to: string[] }
interface Rule { key: "deal_expected_close" | "payment_due"; enabled: boolean; milestones: Milestone[] }
const RULE_NAME = { deal_expected_close: "Deal quá ngày dự kiến chốt", payment_due: "Đợt thanh toán đến hạn" } as const;
const KIND = { before: "Trước", on: "Đúng ngày", after: "Quá" } as const;
const WHO = { leading: "Leading", participants: "Người tham gia", leader: "Leader", manager: "Manager" } as const;

function DueRules() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["due-rules"], queryFn: () => api<{ rules: Rule[]; can_edit: boolean }>("GET", "/deals/due-rules") });
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
      <PageTitle actions={<Link to="/thong-bao" className="inline-flex min-h-9 items-center px-3 text-sm text-primary underline">Thông báo</Link>}>Cài đặt thông báo</PageTitle>
      <TypeSettings />
      {me && <DueRules />}
    </div>
  );
}
