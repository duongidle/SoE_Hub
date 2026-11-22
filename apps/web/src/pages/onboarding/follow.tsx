import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorText, Input, PageTitle, Select, Table } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { GROUP_LABEL, OnbNav, PLAN_STATUS } from "./common";
import { PlanView } from "./plan-view";

interface Row {
  plan_id: string; plan_name: string; status: string; staff_id: string; staff_name: string; leader_id: string | null; leader_name: string | null; current_week: number; total_weeks: number;
  progress_pct: number; overdue: number; checkpoints_passed: number; checkpoints_total: number; groups: Record<string, { passed: number; total: number; state: string | null }>; final_result: string | null;
}
const GROUPS = ["test", "mockup", "on_job", "qna", "daily", "other"];
const CELL: Record<string, string> = { passed: "bg-ok/20", failed: "bg-bad/15", running: "bg-primary/10", not_yet: "bg-muted" };

export function FollowPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [leader, setLeader] = useState("");
  const [plan, setPlan] = useState("");
  const nav = useNavigate();
  const res = useQuery({ queryKey: ["onb", "overview", status, q], queryFn: () => api<Row[]>("GET", `/onboarding/overview?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`) });
  const all = res.data ?? [];
  const leaders = [...new Map(all.filter((r) => r.leader_id).map((r) => [r.leader_id!, r.leader_name ?? ""])).entries()];
  const plans = [...new Set(all.map((r) => r.plan_name))];
  const rows = all.filter((r) => (!leader || r.leader_id === leader) && (!plan || r.plan_name === plan));
  return (
    <div>
      <PageTitle>Theo dõi onboarding</PageTitle>
      <OnbNav active="follow" />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="min-w-40 flex-1" aria-label="Tìm" placeholder="Tìm tên hoặc lộ trình" value={q} onChange={(e) => setQ(e.target.value)} data-testid="onb-q" />
        <Select aria-label="Team" value={leader} onChange={(e) => setLeader(e.target.value)}><option value="">Mọi team</option>{leaders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
        <Select aria-label="Lộ trình" value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">Mọi lộ trình</option>{plans.map((n) => <option key={n} value={n}>{n}</option>)}</Select>
        <Select aria-label="Trạng thái" value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Đang chạy</option><option value="completed">Hoàn thành</option><option value="stopped">Đã dừng</option><option value="all">Tất cả</option></Select>
      </div>
      <ErrorText error={res.error} />
      {res.isLoading ? <p className="text-sm text-muted-foreground">Đang tải...</p> : rows.length === 0 ? <EmptyState title="Chưa có nhân sự nào đang onboard" hint="Gắn một lộ trình cho nhân sự ở mục Lộ trình." /> : (
        <Table>
          <thead><tr><th>Nhân sự</th><th>Lộ trình</th><th>Tuần</th><th>Tiến độ</th><th>Checkpoint</th>{GROUPS.map((g) => <th key={g}>{GROUP_LABEL[g]}</th>)}<th>Trễ</th><th>Kết quả</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.plan_id} className="cursor-pointer hover:bg-muted/50" data-testid="onb-row" tabIndex={0} onClick={() => void nav({ to: "/onboarding/nhan-su/$planId", params: { planId: r.plan_id } })} onKeyDown={(e) => { if (e.key === "Enter") void nav({ to: "/onboarding/nhan-su/$planId", params: { planId: r.plan_id } }); }}>
                <td className="font-medium"><Link to="/onboarding/nhan-su/$planId" params={{ planId: r.plan_id }} className="text-primary underline" onClick={(e) => e.stopPropagation()}>{r.staff_name}</Link></td>
                <td>{r.plan_name}{r.status !== "active" && <span className="text-xs text-muted-foreground"> ({PLAN_STATUS[r.status]})</span>}</td>
                <td>{r.current_week}/{r.total_weeks}</td>
                <td data-testid="onb-row-progress">{r.progress_pct}%</td>
                <td>{r.checkpoints_passed}/{r.checkpoints_total}</td>
                {GROUPS.map((g) => { const c = r.groups[g]; return <td key={g} className={cn("text-center", c?.state && CELL[c.state])}>{c ? `${c.passed}/${c.total}` : ""}</td>; })}
                <td className={r.overdue > 0 ? "font-medium text-bad" : ""}>{r.overdue}</td>
                <td>{r.final_result === "passed" ? "Đạt" : r.final_result === "failed" ? "Không đạt" : ""}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

/** The page of one person for a Leader or Manager: the same as the person sees, plus confirm, week break, stop and the final result. */
export function StaffPage() {
  const { planId } = useParams({ strict: false }) as { planId: string };
  return (
    <div>
      <PageTitle actions={<Link to="/onboarding/theo-doi" className="inline-flex min-h-9 items-center px-3 text-sm text-primary underline">Về Theo dõi</Link>}>Nhân sự onboarding</PageTitle>
      <PlanView planId={planId} manage />
    </div>
  );
}
