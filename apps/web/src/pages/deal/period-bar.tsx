import { useQuery } from "@tanstack/react-query";
import { DEAL_PERIOD_RULES, type DealPeriodRule } from "@soe/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

/** The bar at the top of Quản lý Deal (Module 4 mục 11a): one period for Deals, Index and Probation KPI. A table may leave it ("Theo kỳ chung" off). */
export function SharedPeriodBar({ state, showRule }: { state: ReturnType<typeof useSharedPeriodState>; showRule: boolean }) {
  const v = state.value;
  const info = useQuery({ queryKey: dhKeys.timeRange(v?.range), queryFn: () => resolveTimeRange(v!.range), enabled: !!v, staleTime: 60_000 });
  const today = useQuery({ queryKey: dhKeys.timeRange({ kind: "preset", preset: "today" }), queryFn: () => resolveTimeRange({ kind: "preset", preset: "today" }), staleTime: 60_000 });
  if (!v) return null;
  const set = (unit: PeriodUnit) => { if (today.data) { const p = currentPeriod(unit, today.data); state.setChoice({ unit, year: p.year, index: p.index }); } };
  const step = (by: 1 | -1) => { const p = stepPeriod(v.range, by); state.setChoice({ unit: p.unit, year: p.year, index: p.index }); };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2" role="group" aria-label="Kỳ chung" data-testid="shared-period">
      <span className="text-sm font-medium">Kỳ</span>
      <Select aria-label="Loại kỳ" data-testid="period-unit" className="!w-24" value={v.range.unit} onChange={(e) => set(e.target.value as PeriodUnit)}>
        {(Object.keys(PERIOD_UNIT_LABELS) as PeriodUnit[]).map((u) => <option key={u} value={u}>{PERIOD_UNIT_LABELS[u]}</option>)}
      </Select>
      <Button variant="secondary" className="!px-2" aria-label="Kỳ trước" data-testid="period-prev" onClick={() => step(-1)}><ChevronLeft size={16} aria-hidden /></Button>
      <span className="min-w-28 text-center text-sm font-medium" data-testid="period-name">{rangeName(v.range, info.data?.fiscal_start_month)}</span>
      <Button variant="secondary" className="!px-2" aria-label="Kỳ sau" data-testid="period-next" onClick={() => step(1)}><ChevronRight size={16} aria-hidden /></Button>
      {!state.isDefault && <Button variant="ghost" data-testid="period-reset" onClick={state.reset}>Quý này</Button>}
      <span className="text-xs text-muted-foreground">{rangeDates(info.data)}</span>
      {showRule && (
        <label className="ml-auto flex items-center gap-2 text-sm" title={RULE_HINT[v.rule]}>
          Deal thuộc kỳ khi
          <Select aria-label="Deal thuộc kỳ khi" data-testid="period-rule" className="!w-auto" value={v.rule} onChange={(e) => state.setRule(e.target.value as DealPeriodRule)}>
            {DEAL_PERIOD_RULES.map((r) => <option key={r} value={r}>{RULE_LABEL[r]}</option>)}
          </Select>
        </label>
      )}
    </div>
  );
}
