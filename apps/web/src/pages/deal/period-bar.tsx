import { useQuery } from "@tanstack/react-query";
import { DEAL_PERIOD_RULES, type DealPeriodRule } from "@soe/shared";
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/form";
import { Popover } from "@/components/ui/popover";
import { dhKeys, resolveTimeRange } from "@/lib/datahub/api";
import { type PeriodUnit, type SharedPeriodState } from "@/lib/datahub/deal-view";
import { currentPeriod, rangeDates, rangeName, stepPeriod } from "@/lib/datahub/time-ui";
import { cn } from "@/lib/utils";

const RULE_LABEL: Record<DealPeriodRule, string> = {
  related: "Liên quan đến kỳ",
  received: "Nhận trong kỳ",
  closed: "Đóng trong kỳ",
  expected: "Dự kiến chốt trong kỳ",
};
/** One line under each way of reading "a deal belongs to the period" (Module 4 mục 11a). */
const RULE_INFO: Record<DealPeriodRule, string> = {
  related: "Nhận, đóng hoặc còn chạy trong kỳ",
  received: "Ngày bắt đầu (Start date) nằm trong kỳ",
  closed: "Ngày đóng (Closing date) nằm trong kỳ",
  expected: "Ngày dự kiến chốt hoặc hạn đợt thanh toán nằm trong kỳ",
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
 * The period of Quản lý Deal as ONE button of the toolbar (design module12, 12H quyết định 1 and 10): "📅 Quý 4/2026 ▾". The panel reads from top to bottom:
 * (1) "Hiện deal trong": quick buttons Quý này / Tháng này / Năm nay / Toàn bộ, and under them the step "‹ Quý 1/2021 ›" with its days (only on a period; the unit is the quick button last chosen);
 * (2) "Tính deal vào kỳ khi": the four ways a deal belongs to the period (Deals only; the other tables get one line saying what is cut);
 * (3) at the end, apart: the switch "Áp dụng cho cả trang Deal" (the table's own switch; off = the table keeps its own range).
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
  const label = all ? "Toàn bộ thời gian" : name;
  const quick: { id: string; text: string; unit?: PeriodUnit }[] = [
    { id: "quarter", text: "Quý này", unit: "quarter" },
    { id: "month", text: "Tháng này", unit: "month" },
    { id: "year", text: "Năm nay", unit: "year" },
    { id: "all", text: "Toàn bộ" },
  ];
  const sectionTitle = "text-xs font-semibold text-muted-foreground";
  return (
    <Popover
      label="Chọn kỳ"
      width="w-[22rem]"
      trigger={
        <Button variant="secondary" data-testid="period-button" title="Kỳ của Quản lý Deal" className={cn("shrink-0 sm:!min-h-7 !px-2.5 !text-xs", !state.isDefault && "!border-primary-border !bg-primary-soft !text-primary")}>
          <CalendarRange size={14} aria-hidden />
          <span data-testid="period-name">{off ? `${label} · riêng bảng này` : label}</span>
          <ChevronDown size={14} aria-hidden />
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-testid="shared-period">
        <div className="flex flex-col gap-2">
          <p className={sectionTitle}>Hiện deal trong</p>
          <div className="flex flex-wrap gap-1.5">
            {quick.map((q) => {
              const on = q.unit ? !all && v.range.unit === q.unit : all;
              return (
                <Button key={q.id} variant="secondary" aria-pressed={on} data-testid={q.unit ? `period-quick-${q.id}` : "period-all"} className={cn("!px-2.5 !text-xs sm:!min-h-7", on && "!border-primary-border !bg-primary-soft !text-primary")} onClick={() => (q.unit ? set(q.unit) : state.setAll(!all))}>{q.text}</Button>
              );
            })}
          </div>
          {!all && (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <Button variant="ghost" className="!px-1.5" aria-label="Kỳ trước" data-testid="period-prev" onClick={() => step(-1)}><ChevronLeft size={16} aria-hidden /></Button>
                <span className="min-w-0 flex-1 text-center text-[13px] font-medium tabular-nums" data-testid="period-pop-name">{name}</span>
                <Button variant="ghost" className="!px-1.5" aria-label="Kỳ sau" data-testid="period-next" onClick={() => step(1)}><ChevronRight size={16} aria-hidden /></Button>
              </div>
              <p className="text-center text-xs tabular-nums text-muted-foreground">{rangeDates(info.data)}</p>
            </div>
          )}
        </div>
        {showRule && !all ? (
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Tính deal vào kỳ khi" data-testid="period-rule">
            <p className={sectionTitle}>Tính deal vào kỳ khi</p>
            {DEAL_PERIOD_RULES.map((r) => (
              <label key={r} className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1 hover:bg-muted/50">
                <input type="radio" name="period-rule" className="mt-0.5 size-4 accent-[var(--primary)]" data-testid={`period-rule-${r}`} checked={v.rule === r} onChange={() => state.setRule(r)} />
                <span className="flex flex-col"><span className="text-[13px] font-medium text-foreground">{RULE_LABEL[r]}</span><span className="text-xs text-muted-foreground">{RULE_INFO[r]}</span></span>
              </label>
            ))}
          </div>
        ) : (
          (!showRule || all) && (
            <p className="text-xs leading-relaxed text-muted-foreground" data-testid="period-sub">
              {all ? "Không lọc theo kỳ: hiện toàn bộ dữ liệu." : infoLine(scope, v.rule)}
            </p>
          )
        )}
        {follow && (
          <div className="flex items-start gap-3 border-t border-border-soft pt-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px] font-medium text-foreground">Áp dụng cho cả trang Deal</span>
              <span className="text-xs leading-relaxed text-muted-foreground">Bật: đổi kỳ ở đây thì Deals, Index, Dashboard cùng đổi. Tắt: chỉ bảng này.</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={follow.checked}
              aria-label="Áp dụng cho cả trang Deal"
              data-testid="follow-period"
              onClick={() => follow.onChange(!follow.checked)}
              className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", follow.checked ? "bg-primary" : "bg-border")}
            >
              <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left]", follow.checked ? "left-[18px]" : "left-0.5")} />
            </button>
          </div>
        )}
      </div>
    </Popover>
  );
}
