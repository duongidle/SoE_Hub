import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ExternalLink, RefreshCw, Settings2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ErrorText, Modal } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { fmtTime } from "@/lib/api";
import { getMerge, mergeDuplicates, mergeKeys, mergeOrigin, syncMerged, type MergeDiagnostics, type MergeDuplicateGroup, type MergeInfo } from "@/lib/datahub/api";
import type { TableDetail } from "@/lib/datahub/types";
import { MergeDialog } from "./merge-dialog";

const REASON_TEXT: Record<string, string> = {
  deleted: "đã bị xoá hoặc nằm trong thùng rác",
  no_access: "bạn không còn quyền chủ với bảng này",
  merged: "là bảng gộp, không dùng làm nguồn được",
  sync_failed: "đồng bộ gặp lỗi ngoài dự kiến",
};

/** The diagnosis of design module3 section 4.2: the sentence, per source counts, warnings and a few duplicate groups. Used by the builder (preview) and the table. */
export function MergeDiagnosticsView({ d, onSeeDuplicates }: { d: MergeDiagnostics; onSeeDuplicates?: () => void }) {
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="merge-diagnostics">
      <p className="font-medium" data-testid="merge-summary">{d.summary}</p>
      {d.sources.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-muted-foreground">
          {d.sources.map((s) => (
            <li key={s.table_id} className="[overflow-wrap:anywhere]">
              {s.name}: đọc {s.rows.toLocaleString("vi-VN")} dòng, giữ {s.kept.toLocaleString("vi-VN")}
              {s.dropped > 0 ? `, loại ${s.dropped.toLocaleString("vi-VN")}` : ""}
            </li>
          ))}
        </ul>
      )}
      {d.empty_key_rows > 0 && <p className="text-muted-foreground">{d.empty_key_rows.toLocaleString("vi-VN")} dòng có khoá trống: giữ nguyên, không so trùng.</p>}
      {d.warnings.filter((w) => w.code !== "no_key").map((w, i) => (
        <p key={i} className="flex items-start gap-1.5 text-foreground"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden /> <span>{w.message}</span></p>
      ))}
      {d.duplicate_groups > 0 && <DuplicateList groups={d.duplicate_sample} total={d.duplicate_groups} onMore={onSeeDuplicates} />}
    </div>
  );
}

function DuplicateList({ groups, total, onMore }: { groups: MergeDuplicateGroup[]; total: number; onMore?: () => void }) {
  return (
    <details className="rounded-md border border-border bg-card p-2" data-testid="merge-duplicates">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium sm:min-h-0 sm:py-0">Các nhóm trùng khoá ({total.toLocaleString("vi-VN")})</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {groups.map((g, i) => (
          <li key={i} className="rounded border border-border p-2" data-testid="merge-dup-group">
            <div className="text-sm font-medium [overflow-wrap:anywhere]">Khoá: {g.key || "(trống)"}</div>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {g.rows.map((r) => (
                <li key={r.row_id} className="[overflow-wrap:anywhere]">
                  {r.source_name}, dòng #{r.row_no} {r.kept ? <Badge tone="ok">được giữ</Badge> : <Badge tone="muted">bị loại</Badge>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {onMore && total > groups.length && <Button variant="secondary" className="mt-2" onClick={onMore}>Xem tất cả {total.toLocaleString("vi-VN")} nhóm</Button>}
    </details>
  );
}

/** Every group of duplicates, a page at a time (the server recomputes them from the sources). */
function AllDuplicates({ tableId, onClose }: { tableId: string; onClose: () => void }) {
  const [offset, setOffset] = useState(0);
  const q = useQuery({ queryKey: [...mergeKeys.info(tableId), "dups", offset], queryFn: () => mergeDuplicates(tableId, offset, 20) });
  return (
    <Modal title="Các nhóm trùng khoá" open onClose={onClose} wide>
      {q.isLoading ? <Skeleton className="h-24 w-full" /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data || q.data.groups.length === 0 ? <EmptyState title="Không có nhóm trùng" /> : (
        <div className="flex flex-col gap-3" data-testid="merge-dup-all">
          <p className="text-sm text-muted-foreground">Nhóm {offset + 1}–{offset + q.data.groups.length} trên {q.data.total.toLocaleString("vi-VN")}.</p>
          <ul className="flex flex-col gap-2">
            {q.data.groups.map((g, i) => (
              <li key={i} className="rounded border border-border p-2">
                <div className="text-sm font-medium [overflow-wrap:anywhere]">Khoá: {g.key || "(trống)"}</div>
                <ul className="mt-1 text-xs text-muted-foreground">
                  {g.rows.map((r) => <li key={r.row_id} className="[overflow-wrap:anywhere]">{r.source_name}, dòng #{r.row_no} — {r.kept ? "được giữ" : "bị loại"}</li>)}
                </ul>
              </li>
            ))}
          </ul>
          <div className="flex justify-between gap-2">
            <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - 20))}>Trước</Button>
            <Button variant="secondary" disabled={offset + 20 >= q.data.total} onClick={() => setOffset((o) => o + 20)}>Sau</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * The strip above a merged table: that it is read-only, whether it is up to date, the diagnosis, and (for the owner) the ways to sync
 * again and to change the configuration. A lost source is said plainly; the rows shown are those of the last good sync.
 */
export function MergeBar({ table }: { table: TableDetail }) {
  const qc = useQueryClient();
  const owner = table.access === "owner";
  const q = useQuery({ queryKey: mergeKeys.info(table.id), queryFn: () => getMerge(table.id), refetchInterval: (query) => (query.state.data?.syncing ? 1500 : false) });
  const sync = useMutation({
    mutationFn: () => syncMerged(table.id),
    onSuccess: (info) => {
      qc.setQueryData(mergeKeys.info(table.id), info);
      notify.ok("Đã yêu cầu đồng bộ lại. Dòng được chép trong vài giây.");
    },
  });
  const [configuring, setConfiguring] = useState(false);
  const [allDups, setAllDups] = useState(false);
  const info: MergeInfo | undefined = q.data;

  return (
    <section aria-label="Trạng thái bảng gộp" className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 text-sm" data-testid="merge-bar">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="muted">Bảng gộp · chỉ đọc</Badge>
        {q.isLoading ? <Skeleton className="h-5 w-40" /> : q.error ? <span className="text-bad">Không tải được trạng thái đồng bộ.</span> : info && (
          info.syncing ? <Badge tone="warn" data-testid="merge-status">Đang đồng bộ…</Badge>
          : info.status === "error" ? <Badge tone="bad" data-testid="merge-status">Lỗi nguồn</Badge>
          : info.status === "pending" ? <Badge tone="warn" data-testid="merge-status">Chưa đồng bộ</Badge>
          : <Badge tone="ok" data-testid="merge-status">Đã đồng bộ {fmtTime(info.synced_at)}</Badge>
        )}
        {owner && (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => sync.mutate()} loading={sync.isPending} disabled={info?.syncing} data-testid="merge-resync"><RefreshCw size={16} aria-hidden /> Đồng bộ lại</Button>
            <Button variant="secondary" onClick={() => setConfiguring(true)} disabled={!info?.config} data-testid="merge-configure"><Settings2 size={16} aria-hidden /> Cấu hình</Button>
          </span>
        )}
      </div>
      {info && info.errors.length > 0 && (
        <div role="alert" className="rounded-md bg-bad/10 p-2 text-bad" data-testid="merge-errors">
          <p className="font-medium">Bảng đang giữ dữ liệu của lần đồng bộ cuối vì có nguồn không đọc được:</p>
          <ul className="list-disc pl-5">
            {info.errors.map((e, i) => <li key={i} className="[overflow-wrap:anywhere]">{e.name ? `Bảng "${e.name}"` : "Một bảng nguồn"}: {REASON_TEXT[e.reason] ?? e.reason}.</li>)}
          </ul>
          {owner && <p className="mt-1 text-foreground">Khôi phục hoặc bỏ bảng đó khỏi cấu hình, bảng gộp sẽ tự đồng bộ lại.</p>}
        </div>
      )}
      {info?.diagnostics && (owner ? <MergeDiagnosticsView d={info.diagnostics} onSeeDuplicates={() => setAllDups(true)} /> : <p className="font-medium" data-testid="merge-summary">{info.diagnostics.summary}</p>)}
      <ErrorText error={sync.error} />
      {configuring && info?.config && <MergeDialog datahubId={table.datahub_id} existing={{ table, info }} onClose={() => setConfiguring(false)} />}
      {allDups && <AllDuplicates tableId={table.id} onClose={() => setAllDups(false)} />}
    </section>
  );
}

/** In the row panel of a merged table: where the row came from, with a link to the source table (the row is edited there). Owner only. */
export function OriginLink({ tableId, rowId }: { tableId: string; rowId: string }) {
  const q = useQuery({ queryKey: [...mergeKeys.info(tableId), "origin", rowId], queryFn: () => mergeOrigin(tableId, rowId), retry: false });
  if (!q.data) return null;
  const o = q.data;
  if (!o.source_datahub_id || !o.source_table_name) return <p className="px-4 pt-2 text-xs text-muted-foreground" data-testid="merge-origin">Dòng gốc không còn (bảng nguồn đã xoá hoặc dòng đã bị xoá).</p>;
  return (
    <p className="px-4 pt-2 text-sm" data-testid="merge-origin">
      <Link to="/datahub/$datahubId/$tableId" params={{ datahubId: o.source_datahub_id, tableId: o.source_table_id }} className="inline-flex min-h-11 items-center gap-1 text-primary underline sm:min-h-0">
        <ExternalLink size={14} aria-hidden /> Mở bảng nguồn "{o.source_table_name}"{o.source_row_no ? ` (dòng #${o.source_row_no})` : ""} để sửa
      </Link>
    </p>
  );
}
