// Tab Responses (design module7 7, 14): the count, the list, and the link to the table that holds the rows.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Input } from "@/components/ui/form";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { apiList, fmtTime } from "@/lib/api";
import { getTable } from "@/lib/datahub/api";
import type { FormDetail } from "./model";

interface Resp { row_id: string; created_at: string; created_by: string | null; answers: Record<string, unknown>; quiz: { score: number; max: number; result: string | null; attempt: number } | null }
const show = (v: unknown): string => (v === undefined || v === null || v === "" ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));

export function ResponsesTab({ form }: { form: FormDetail }) {
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: ["form-responses", form.id, search], queryFn: () => apiList<Resp>(`/forms/${form.id}/responses?limit=50${search ? `&search=${encodeURIComponent(search)}` : ""}`) });
  const table = useQuery({ queryKey: ["form-table", form.table_id], queryFn: () => getTable(form.table_id!), enabled: !!form.table_id });
  const qs = ((q.data as unknown as { questions?: { question_id: string; label: string }[] } | undefined)?.questions ?? []).slice(0, 6);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-sm" data-testid="response-count"><b>{form.response_count}</b> phản hồi</p>
        {table.data && <Link to="/datahub/$datahubId/$tableId" params={{ datahubId: table.data.datahub_id, tableId: table.data.id }} className="text-sm text-primary underline" data-testid="open-table">Mở bảng "{table.data.name}" trong Datahub</Link>}
        <Input className="max-w-60" placeholder="Tìm trong phản hồi" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm phản hồi" />
      </div>
      {q.error ? <ErrorState error={q.error} /> : q.data?.data.length === 0 ? <EmptyState title="Chưa có phản hồi" /> : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm" data-testid="response-table">
            <thead className="bg-muted text-left"><tr><th className="p-2">Lúc</th>{qs.map((x) => <th key={x.question_id} className="p-2">{x.label}</th>)}<th className="p-2">Kết quả</th></tr></thead>
            <tbody>{q.data?.data.map((r) => <tr key={r.row_id} className="border-t border-border"><td className="p-2 whitespace-nowrap">{fmtTime(r.created_at)}</td>{qs.map((x) => <td key={x.question_id} className="max-w-48 truncate p-2">{show(r.answers[x.question_id])}</td>)}<td className="p-2">{r.quiz ? `${r.quiz.score}/${r.quiz.max} · ${r.quiz.result ?? ""}` : ""}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
