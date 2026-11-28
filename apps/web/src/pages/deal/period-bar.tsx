import { useQuery } from "@tanstack/react-query";
import { DEAL_PERIOD_RULES, type DealPeriodRule } from "@soe/shared";
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Select } from "@/components/ui/form";
import { Popover } from "@/components/ui/popover";
import { dhKeys, resolveTimeRange } from "@/lib/datahub/api";
import { type PeriodUnit, type SharedPeriodState } from "@/lib/datahub/deal-view";
import { currentPeriod, PERIOD_UNIT_LABELS, rangeDates, rangeName, stepPeriod } from "@/lib/datahub/time-ui";
import { cn } from "@/lib/utils";

const RULE_LABEL: Record<DealPeriodRule, string> = {
  related: "Liên quan đến kỳ",
  received: "Nhận trong kỳ",
  closed: "Đóng trong kỳ",
  expected: "Dự kiến chốt trong kỳ",
};
/** One line that says which deals the period keeps, per way of reading "a deal belongs to the period" (Module 4 mục 11a). */
const RULE_INFO: Record<DealPeriodRule, string> = {
  related: "Deal liên quan đến kỳ (theo ngày bắt đầu và ngày đóng)",
  received: "Deal nhận trong kỳ (theo Start date)",
  closed: "Deal đã đóng trong kỳ (theo Closing date)",
  expected: "Deal dự kiến chốt trong kỳ (theo ngày dự kiến chốt và hạn đợt thanh toán)",
};

/** What the period filters on the screen below the button: the table the person looks at, or the dashboard. */
export type PeriodScope = "deals" | "index" | "kpi" | "dashboard" | "other";

function infoLine(scope: PeriodScope, rule: DealPeriodRule): string {
  switch (scope) {
    case "deals": return RULE_INFO[rule];
    case "index": return "Lọc theo cột Tháng";
    case "kpi": return "Lọc theo năm của kỳ";
    case "dashboard": return "Khoảng thời gian chung của mọi biểu đồ";
    default: return "Bảng này không theo kỳ";
  }
}

/**
 * The period of Quản lý Deal as ONE button of the toolbar (design module12, 12H quyết định 1): "📅 Quý 4/2026 ▾". The panel holds the unit, the steps,
 * "Toàn bộ thời gian", the way a deal belongs to the period (Deals only), "Theo kỳ chung" (the table's own switch) and one line that says what is cut.
 * One period for Deals, Index, Probation KPI and the dashboard; a table may leave it ("Theo kỳ chung" off).
 */
export function PeriodButton({ state, scope, showRule, follow }: { state: SharedPeriodState; scope: PeriodScope; showRule: boolean; follow?: { checked: boolean; onChange: (v: boolean) => void } }) {
  const v = state.value;
  const info = useQuery({ queryKey: dhKeys.timeRange(v?.range), queryFn: () => resolveTimeRange(v!.range), enabled: !!v, staleTime: 60_000 });
  const today = useQuery({ queryKey: dhKeys.timeRange({ kind: "preset", preset: "today" }), queryFn: () => resolveTimeRange({ kind: "preset", preset: "today" }), staleTime: 60_000 });
  if (!v) return null;
  const all = v.all;
  const set = (unit: PeriodUnit) => { if (today.data) { const p = currentPeriod(unit, today.data); state.setChoice({ unit, year: p.year, index: p.index }); } };
  const step = (by: 1 | -1) => { const p = stepPeriod(v.range, by); state.setChoice({ unit: p.unit, year: p.year, index: p.index }); };
  const name = rangeName(v.range, info.data?.fiscal_start_month);
  const off = follow ? !follow.checked : false;
  return (
    <Popover
      label="Kỳ chung"
      width="w-[21rem]"
      trigger={
        <Button variant="secondary" data-testid="period-button" title="Kỳ chung của Quản lý Deal" className={cn("shrink-0 sm:!min-h-7 !px-2.5 !text-xs", !state.isDefault && "!border-primary-border !bg-primary-soft !text-primary")}>
          <CalendarRange size={14} aria-hidden />
          <span data-testid="period-name">{all ? "Toàn bộ thời gian" : name}</span>
          <ChevronDown size={14} aria-hidden />
        </Button>
      }
    >
      <div className="flex flex-col gap-3 p-1" data-testid="shared-period">
        <div className="flex items-center gap-2">
          <Select aria-label="Loại kỳ" data-testid="period-unit" className="!w-24" value={v.range.unit} onChange={(e) => set(e.target.value as PeriodUnit)}>
            {(Object.keys(PERIOD_UNIT_LABELS) as PeriodUnit[]).map((u) => <option key={u} value={u}>{PERIOD_UNIT_LABELS[u]}</option>)}
          </Select>
          <Button variant="secondary" className="!px-2" aria-label="Kỳ trước" data-testid="period-prev" onClick={() => step(-1)}><ChevronLeft size={16} aria-hidden /></Button>
          <span className={cn("min-w-0 flex-1 text-center text-[13px] font-semibold tabular-nums", all && "text-muted-foreground")} data-testid="period-pop-name">{name}</span>
          <Button variant="secondary" className="!px-2" aria-label="Kỳ sau" data-testid="period-next" onClick={() => step(1)}><ChevronRight size={16} aria-hidden /></Button>
        </div>
        <p className="-mt-1 text-center text-xs tabular-nums text-muted-foreground">{all ? "Không lọc theo kỳ" : rangeDates(info.data)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={all ? "primary" : "secondary"} aria-pressed={all} data-testid="period-all" onClick={() => state.setAll(!all)}>Toàn bộ thời gian</Button>
          {!state.isDefault && <Button variant="ghost" data-testid="period-reset" onClick={state.reset}>Quý này</Button>}
        </div>
        {showRule && !all && (
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
            Deal thuộc kỳ khi
            <Select aria-label="Deal thuộc kỳ khi" data-testid="period-rule" value={v.rule} onChange={(e) => state.setRule(e.target.value as DealPeriodRule)}>
              {DEAL_PERIOD_RULES.map((r) => <option key={r} value={r}>{RULE_LABEL[r]}</option>)}
            </Select>
          </label>
        )}
        {follow && (
          <label className="flex items-center gap-2 text-[13px]" title="Bỏ chọn để view này giữ khoảng thời gian riêng (nút Thời gian)">
            <input type="checkbox" className="size-4" data-testid="follow-period" checked={follow.checked} onChange={(e) => follow.onChange(e.target.checked)} />
            Theo kỳ chung
          </label>
        )}
        <p className="border-t border-border-soft pt-2 text-xs leading-relaxed text-muted-foreground" data-testid="period-sub">
          {off ? "View này đang giữ khoảng thời gian riêng, không theo kỳ chung." : all ? "Không lọc theo kỳ: hiện toàn bộ dữ liệu." : infoLine(scope, v.rule)}
        </p>
      </div>
    </Popover>
  );
}
