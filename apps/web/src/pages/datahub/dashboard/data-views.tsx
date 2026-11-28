import { formatPercent } from "@soe/shared";
import { toPivot } from "@/lib/dashboard/chart-data";
import { heatLevel } from "@/lib/dashboard/chart-data";
import { formatValue } from "@/lib/dashboard/format";
import type { FormatName, MetricRow, QueryResult } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";

/** Table and pivot charts: real HTML tables, numbers right-aligned and never cut. */

const num = "whitespace-nowrap text-right tabular-nums";

export function DataTable({ result, format }: { result: QueryResult; format: FormatName | null }) {
  const hasPrev = result.rows.some((r) => r.previous !== undefined);
  const hasTarget = result.rows.some((r) => r.target !== undefined && r.target !== null);
  const head = result.columns.length ? result.columns.map((c) => c.column) : ["Chỉ số"];
  return (
    <div className="contain-scroll h-full overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            {head.map((h) => (
              <th key={h} scope="col" className="px-2 py-1.5 font-medium [overflow-wrap:anywhere]">{h}</th>
            ))}
            <th scope="col" className={cn("px-2 py-1.5 font-medium", num)}>{result.metric.name ?? "Giá trị"}</th>
            {hasPrev && <th scope="col" className={cn("px-2 py-1.5 font-medium", num)}>Kỳ trước</th>}
            {hasPrev && <th scope="col" className={cn("px-2 py-1.5 font-medium", num)}>Thay đổi</th>}
            {hasTarget && <th scope="col" className={cn("px-2 py-1.5 font-medium", num)}>Mục tiêu</th>}
            {hasTarget && <th scope="col" className={cn("px-2 py-1.5 font-medium", num)}>Đạt</th>}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {result.columns.length === 0 ? <td className="px-2 py-1.5">Tổng</td> : r.groups.map((g, k) => <td key={k} className="px-2 py-1.5 [overflow-wrap:anywhere]">{g.label}</td>)}
              <td className={cn("px-2 py-1.5", num)}>{formatValue(r.value, format)}</td>
              {hasPrev && <td className={cn("px-2 py-1.5", num)}>{formatValue(r.previous ?? null, format)}</td>}
              {hasPrev && <td className={cn("px-2 py-1.5", num)}>{r.change_pct === null || r.change_pct === undefined ? "—" : `${r.change_pct > 0 ? "+" : ""}${formatPercent(r.change_pct, { decimals: 1 })}`}</td>}
              {hasTarget && <td className={cn("px-2 py-1.5", num)}>{formatValue(r.target ?? null, format)}</td>}
              {hasTarget && <td className={cn("px-2 py-1.5", num)}>{r.achieved === null || r.achieved === undefined ? "—" : formatPercent(r.achieved, { decimals: 1 })}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated && <p className="px-2 py-2 text-xs text-muted-foreground">Còn nhiều nhóm hơn số hiển thị. Thu hẹp bộ lọc hoặc khoảng thời gian.</p>}
    </div>
  );
}

export function PivotTable({ result, format, heat, totals }: { result: QueryResult; format: FormatName | null; heat: boolean; totals: boolean }) {
  const p = toPivot(result);
  const values = p.cells.flat().map((c: MetricRow | null) => (typeof c?.value === "number" ? c.value : null)).filter((v): v is number => v !== null);
  const showTotals = totals && p.rowTotals !== null;
  const rowHead = result.columns[0]?.column ?? "";
  return (
    <div className="contain-scroll h-full overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-2 py-1.5 text-left font-medium">{rowHead}</th>
            {p.colLabels.map((c) => (
              <th key={c} scope="col" className={cn("px-2 py-1.5 font-medium", num)}>{c}</th>
            ))}
            {showTotals && <th scope="col" className={cn("px-2 py-1.5 font-medium", num)}>Tổng</th>}
          </tr>
        </thead>
        <tbody>
          {p.rowLabels.map((rl, i) => (
            <tr key={rl} className="border-b border-border/60">
              <th scope="row" className="px-2 py-1.5 text-left font-medium [overflow-wrap:anywhere]">{rl}</th>
              {p.cells[i]!.map((c, j) => {
                const v = typeof c?.value === "number" ? c.value : null;
                const level = heat ? heatLevel(v, values) : 0;
                return (
                  <td key={j} className={cn("px-2 py-1.5", num)} style={heat && v !== null ? { background: `color-mix(in oklab, var(--primary) ${Math.round(level * 35)}%, transparent)` } : undefined}>
                    {formatValue(c?.value ?? null, format)}
                  </td>
                );
              })}
              {showTotals && <td className={cn("px-2 py-1.5 font-medium", num)}>{formatValue(p.rowTotals![i]!, format)}</td>}
            </tr>
          ))}
        </tbody>
        {showTotals && (
          <tfoot>
            <tr className="border-t-2 border-border font-medium">
              <th scope="row" className="px-2 py-1.5 text-left">Tổng</th>
              {p.colTotals!.map((v, j) => (
                <td key={j} className={cn("px-2 py-1.5", num)}>{formatValue(v, format)}</td>
              ))}
              <td className={cn("px-2 py-1.5", num)}>{formatValue(p.grand, format)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      {result.truncated && <p className="px-2 py-2 text-xs text-muted-foreground">Còn nhiều nhóm hơn số hiển thị. Thu hẹp bộ lọc hoặc khoảng thời gian.</p>}
    </div>
  );
}
