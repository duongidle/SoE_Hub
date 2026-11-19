import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { Button, ErrorText, Modal } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { getChartCsv, getChartRows } from "@/lib/dashboard/api";
import type { RowsResult, ViewFilters } from "@/lib/dashboard/types";

const PAGE = 50;
const cell = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Triggers a download of text made in the browser (the CSV came from the server as text). */
export function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The rows that make up a number, as the VIEWER may read them. The number is the owner's; the rows are only the part the viewer sees,
 * and the note says how many ("Bạn thấy 12/40 dòng tạo nên con số này.").
 */
export function RowsDialog({ chartId, title, series, group, filters, onClose }: { chartId: string; title: string; series: number; group: (string | number | boolean | null)[]; filters?: ViewFilters; onClose: () => void }) {
  const [pages, setPages] = useState<RowsResult[]>([]);
  const first = useQuery({ queryKey: ["mt-rows", chartId, series, JSON.stringify(group), JSON.stringify(filters ?? {})], queryFn: () => getChartRows(chartId, series, group, filters, 0, PAGE), retry: false });
  const more = useMutation({ mutationFn: () => getChartRows(chartId, series, group, filters, PAGE * (pages.length + 1), PAGE), onSuccess: (r) => setPages((p) => [...p, r]) });
  const csv = useMutation({
    mutationFn: () => getChartCsv(chartId, series, group, filters),
    onSuccess: (r) => {
      downloadText(r.filename, r.csv, "text/csv;charset=utf-8");
      notify.ok(`Đã xuất ${r.rows} dòng. ${r.note}${r.truncated ? " File dừng ở 5.000 dòng đầu." : ""}`);
    },
  });
  const d = first.data;
  const all = d ? [d, ...pages] : [];
  const items = all.flatMap((p) => p.items);
  return (
    <Modal title={`Các dòng của “${title}”`} open onClose={onClose} wide>
      {first.isLoading ? (
        <Skeleton className="h-40 w-full" aria-busy="true" aria-label="Đang tải các dòng" />
      ) : first.error || !d ? (
        <ErrorState error={first.error} onRetry={() => void first.refetch()} title="Không xem được các dòng" />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm" role="status" data-testid="rows-note">{d.note}</p>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có dòng nào để hiện.</p>
          ) : (
            <div className="contain-scroll max-h-[50dvh] overflow-auto rounded-md border border-border" data-testid="rows-table">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-2 py-1.5 font-medium">#</th>
                    {d.columns.map((c) => <th key={c.key} scope="col" className="px-2 py-1.5 font-medium [overflow-wrap:anywhere]">{c.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 last:border-0">
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">{r.row_no}</td>
                      {d.columns.map((c) => <td key={c.key} className="px-2 py-1.5 [overflow-wrap:anywhere]">{cell(r.data[c.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Đang hiện {items.length}/{d.total_visible} dòng.</span>
            <div className="flex gap-2">
              {items.length < d.total_visible && <Button variant="secondary" loading={more.isPending} onClick={() => more.mutate()}>Tải thêm</Button>}
              <Button variant="secondary" loading={csv.isPending} onClick={() => csv.mutate()} data-testid="rows-csv"><Download size={16} aria-hidden /> Xuất CSV</Button>
            </div>
          </div>
          <ErrorText error={more.error ?? csv.error} />
        </div>
      )}
    </Modal>
  );
}
