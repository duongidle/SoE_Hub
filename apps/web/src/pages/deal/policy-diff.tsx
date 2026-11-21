import { useQuery } from "@tanstack/react-query";
import { formatDate, formatPercent } from "@soe/shared";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Field, Modal, Select, Table } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { policyDiff } from "@/lib/datahub/period-api";

const KIND = { added: { label: "Thêm", tone: "ok" }, changed: { label: "Đổi", tone: "warn" }, removed: { label: "Bỏ", tone: "bad" } } as const;
const rate = (v: number | null) => (v === null ? "—" : formatPercent(v));
const value = (v: number | null) => (v === null ? "—" : String(v));

/**
 * Compare a version of the commission policy with the one in force before it (Module 4 mục 9): rows added, changed, removed, old rate to new rate,
 * and how many open deals it touches. Opened from the table `Chính sách com`, only for the Manager. The server computes everything.
 */
export function PolicyDiffDialog({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState<string | undefined>(undefined);
  const q = useQuery({ queryKey: ["policy-diff", from ?? ""], queryFn: () => policyDiff(from) });
  const d = q.data;
  return (
    <Modal title="So sánh phiên bản chính sách com" open onClose={onClose} wide>
      <div className="flex flex-col gap-3" data-testid="policy-diff">
        {q.isLoading ? <Skeleton className="h-32 w-full" /> : q.error || !d ? <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không so sánh được" /> : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Bản mới (hiệu lực từ)">
                <Select aria-label="Bản mới" value={d.new_from ?? ""} onChange={(e) => setFrom(e.target.value || undefined)} className="!w-48">
                  {d.versions.map((v) => <option key={v} value={v}>{formatDate(v)}</option>)}
                </Select>
              </Field>
              <p className="pb-2 text-sm text-muted-foreground">
                {d.old_from ? <>so với bản hiệu lực từ <strong>{formatDate(d.old_from)}</strong></> : "Chưa có bản nào trước đó, mọi dòng đều là dòng thêm."}
              </p>
            </div>
            <p className="text-sm" data-testid="policy-diff-affected">
              <strong>{d.affected_open_deals}</strong> deal đang mở bị ảnh hưởng. Giữ nguyên {d.unchanged} dòng.
            </p>
            {d.rows.length === 0 && d.params.length === 0 ? <p className="text-sm text-muted-foreground">Không có dòng nào khác nhau.</p> : (
              <>
                {d.rows.length > 0 && (
                  <Table>
                    <thead><tr><th>Thay đổi</th><th>Nguồn lead</th><th>Level</th><th>Performance</th><th className="text-right">Tỉ lệ cũ</th><th className="text-right">Tỉ lệ mới</th></tr></thead>
                    <tbody>
                      {d.rows.map((r) => (
                        <tr key={`${r.lead}|${r.level}|${r.performance}`} data-testid="policy-diff-row">
                          <td><Badge tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Badge></td>
                          <td>{r.lead}</td><td>{r.level}</td><td>{r.performance}</td>
                          <td className="text-right">{rate(r.old_rate)}</td><td className="text-right">{rate(r.new_rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
                {d.params.length > 0 && (
                  <>
                    <h3 className="text-sm font-medium">Tham số com</h3>
                    <Table>
                      <thead><tr><th>Thay đổi</th><th>Tham số</th><th className="text-right">Cũ</th><th className="text-right">Mới</th></tr></thead>
                      <tbody>{d.params.map((p) => <tr key={p.name}><td><Badge tone={KIND[p.kind].tone}>{KIND[p.kind].label}</Badge></td><td>{p.name}</td><td className="text-right">{value(p.old_value)}</td><td className="text-right">{value(p.new_value)}</td></tr>)}</tbody>
                    </Table>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
