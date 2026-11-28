import { useQuery } from "@tanstack/react-query";
import { DEAL_PERIOD_RULES, type DealPeriodRule } from "@soe/shared";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Select } from "@/components/ui/form";
import { dhKeys, resolveTimeRange } from "@/lib/datahub/api";
import { type PeriodUnit, type useSharedPeriodState } from "@/lib/datahub/deal-view";
import { currentPeriod, PERIOD_UNIT_LABELS, rangeDates, rangeName, stepPeriod } from "@/lib/datahub/time-ui";

const RULE_LABEL: Record<DealPeriodRule, string> = {
  related: "Liên quan đến kỳ",
  received: "Nhận trong kỳ",
  closed: "Đóng trong kỳ",
  expected: "Dự kiến chốt trong kỳ",
};
const RULE_HINT: Record<DealPeriodRule, string> = {
  related: "Deal nhận trong kỳ, đóng trong kỳ và deal còn chạy trong kỳ.",
  received: "Start date nằm trong kỳ.",
  closed: "Deal đã đóng, Closing date nằm trong kỳ.",
  expected: "Deal đang mở có Ngày dự kiến chốt hoặc đợt chưa về có hạn trong kỳ.",
};
/** Which column the list is cut on, per way of reading "a deal belongs to the period" (Module 4 mục 11a). */
const RULE_COLUMNS: Record<DealPeriodRule, string> = {
  related: "Start date và Closing date",
  received: "Start date",
  closed: "Closing date",
  expected: "Ngày dự kiến chốt và hạn đợt thanh toán",
};

/** What the bar filters on the page below it: the table the person looks at, or the dashboard. */
export type PeriodScope = "deals" | "index" | "kpi" | "dashboard" | "other";

function label(scope: PeriodScope, rule: DealPeriodRule): { title: string; sub: string } {
  switch (scope) {
    case "deals": return { title: "Kỳ của danh sách deal", sub: `Lọc theo cột ${RULE_COLUMNS[rule]}` };
    case "index": return { title: "Kỳ của danh sách deal", sub: "Lọc theo cột Tháng" };
    case "kpi": return { title: "Kỳ của danh sách deal", sub: "Lọc theo năm của kỳ" };
    case "dashboard": return { title: "Kỳ của dashboard Deals", sub: "Khoảng thời gian chung của mọi biểu đồ" };
    default: return { title: "Kỳ của danh sách deal", sub: "Bảng này không theo kỳ" };
  }
}

/**
 * The bar at the top of Quản lý Deal (Module 4 mục 11a): one period for Deals, Index and Probation KPI and the dashboard. A table may leave it ("Theo kỳ chung" off).
 * It is a tinted strip with its own label that says which column the list is cut on, so nobody mistakes it for the "Thời gian" filter of a grid or a dashboard.
 */
export function SharedPeriodBar({ state, showRule, scope = "deals" }: { state: ReturnType<typeof useSharedPeriodState>; showRule: boolean; scope?: PeriodScope }) {
  const v = state.value;
  const info = useQuery({ queryKey: dhKeys.timeRange(v?.range), queryFn: () => resolveTimeRange(v!.range), enabled: !!v, staleTime: 60_000 });
  const today = useQuery({ queryKey: dhKeys.timeRange({ kind: "preset", preset: "today" }), queryFn: () => resolveTimeRange({ kind: "preset", preset: "today" }), staleTime: 60_000 });
  if (!v) return null;
  const set = (unit: PeriodUnit) => { if (today.data) { const p = currentPeriod(unit, today.data); state.setChoice({ unit, year: p.year, index: p.index }); } };
  const step = (by: 1 | -1) => { const p = stepPeriod(v.range, by); state.setChoice({ unit: p.unit, year: p.year, index: p.index }); };
  const text = label(scope, v.rule);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-primary-border bg-primary-soft/60 px-3 py-2" role="group" aria-label="Kỳ chung" data-testid="shared-period">
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-card text-primary shadow-card"><CalendarRange size={16} /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight text-foreground" data-testid="period-title">{text.title}</p>
          <p className="text-xs leading-snug text-muted-foreground" data-testid="period-sub">{text.sub}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Loại kỳ" data-testid="period-unit" className="!w-24" value={v.range.unit} onChange={(e) => set(e.target.value as PeriodUnit)}>
          {(Object.keys(PERIOD_UNIT_LABELS) as PeriodUnit[]).map((u) => <option key={u} value={u}>{PERIOD_UNIT_LABELS[u]}</option>)}
        </Select>
        <Button variant="secondary" className="!px-2" aria-label="Kỳ trước" data-testid="period-prev" onClick={() => step(-1)}><ChevronLeft size={16} aria-hidden /></Button>
        <span className="min-w-24 text-center text-sm font-semibold tabular-nums" data-testid="period-name">{rangeName(v.range, info.data?.fiscal_start_month)}</span>
        <Button variant="secondary" className="!px-2" aria-label="Kỳ sau" data-testid="period-next" onClick={() => step(1)}><ChevronRight size={16} aria-hidden /></Button>
        {!state.isDefault && <Button variant="ghost" data-testid="period-reset" onClick={state.reset}>Quý này</Button>}
        <span className="text-xs tabular-nums text-muted-foreground">{rangeDates(info.data)}</span>
      </div>
      {showRule && (
        <label className="flex items-center gap-2 text-sm sm:ml-auto" title={RULE_HINT[v.rule]}>
          <span className="text-muted-foreground">Deal thuộc kỳ khi</span>
          <Select aria-label="Deal thuộc kỳ khi" data-testid="period-rule" className="!w-auto" value={v.rule} onChange={(e) => state.setRule(e.target.value as DealPeriodRule)}>
            {DEAL_PERIOD_RULES.map((r) => <option key={r} value={r}>{RULE_LABEL[r]}</option>)}
          </Select>
        </label>
      )}
    </div>
  );
}
