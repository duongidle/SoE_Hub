import { useQuery } from "@tanstack/react-query";
import { BarChart3, Hash, LineChart as LineIcon, Sigma } from "lucide-react";
import { getTable } from "@/lib/datahub/api";
import { TYPE_LABELS } from "@/lib/dashboard/config";
import type { ChartType } from "@/lib/dashboard/types";
import type { DatahubBrief } from "@/lib/datahub/types";

interface Idea {
  type: ChartType;
  title: string;
  hint: string;
  icon: React.ReactNode;
}

const NUMBER_TYPES = new Set(["number", "currency", "percent"]);
const DATE_TYPES = new Set(["date", "datetime"]);

/**
 * Empty dashboard: a few chart ideas read from the columns of the first table of the datahub. They only suggest. A click opens the
 * chart panel with the type already chosen; the table and columns are still chosen there (no prefilled settings, no new API).
 */
export function EmptyDashboard({ owner, dh, onPick }: { owner: boolean; dh?: DatahubBrief; onPick: (type: ChartType) => void }) {
  const table = dh?.tables.find((t) => t.row_count > 0) ?? dh?.tables[0];
  const q = useQuery({ queryKey: ["dh-empty-ideas", table?.id], queryFn: () => getTable(table!.id), enabled: owner && !!table, staleTime: 60_000 });
  const cols = q.data?.columns ?? [];
  const ideas: Idea[] = [];
  if (table) {
    ideas.push({ type: "kpi", title: "Số dòng", hint: `Đếm dòng của bảng "${table.name}".`, icon: <Hash size={18} aria-hidden /> });
    const pick = cols.find((c) => c.type === "single_select");
    if (pick) ideas.push({ type: "column", title: `Số dòng theo ${pick.name}`, hint: `Cột đếm theo từng giá trị của "${pick.name}".`, icon: <BarChart3 size={18} aria-hidden /> });
    const date = cols.find((c) => DATE_TYPES.has(c.type));
    if (date) ideas.push({ type: "line", title: `Số dòng theo ${date.name}`, hint: "Đường theo thời gian, nhóm theo tháng.", icon: <LineIcon size={18} aria-hidden /> });
    const num = cols.find((c) => NUMBER_TYPES.has(c.type));
    if (num) ideas.push({ type: "kpi", title: `Tổng ${num.name}`, hint: "Thẻ số lớn, có thể so với kỳ trước.", icon: <Sigma size={18} aria-hidden /> });
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-10 text-center" data-testid="dashboard-empty">
      <span aria-hidden className="inline-flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
        <BarChart3 size={20} />
      </span>
      <div>
        <h2 className="text-base font-semibold">Dashboard chưa có biểu đồ</h2>
        <p className="mt-1 text-sm text-muted-foreground">{owner ? "Bấm Thêm biểu đồ, chọn loại, rồi chọn bảng và cách tính. Hoặc bắt đầu từ một gợi ý bên dưới." : "Chủ dashboard chưa thêm biểu đồ nào."}</p>
      </div>
      {owner && ideas.length > 0 && (
        <ul className="grid w-full gap-3 text-left sm:grid-cols-2" aria-label="Gợi ý biểu đồ từ bảng đang có">
          {ideas.map((i) => (
            <li key={i.title}>
              <button type="button" onClick={() => onPick(i.type)} className="flex min-h-11 w-full items-start gap-3 rounded-card border border-border-soft bg-card p-4 text-left shadow-sm transition-colors hover:border-primary-border hover:bg-primary-soft focus-visible:outline-2">
                <span aria-hidden className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">{i.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium [overflow-wrap:anywhere]">{i.title}</span>
                  <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{TYPE_LABELS[i.type]}. {i.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
