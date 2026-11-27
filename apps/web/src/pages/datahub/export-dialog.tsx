import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, ErrorText, Field, Modal, Notice, Select } from "@/components/ui/form";
import { useMe } from "@/lib/session";
import { cancelJob, createExport, jobDownload, saveFromUrl, type ExportBody, type JobDto } from "@/lib/datahub/api";
import type { Column, TableDetail } from "@/lib/datahub/types";
import type { SessionQuery } from "@/lib/datahub/view-config";
import { JobBar, useJob } from "./job-progress";

type Scope = "view" | "table" | "datahub";
type Format = "xlsx" | "csv" | "json";

/**
 * Export of the open table (design module2 section 9): as the view shows it (its filter, sort, search and the visible columns, in order),
 * the whole table, or the whole datahub as XLSX. The file is made by the worker; this dialog follows the job and starts the download.
 */
export function ExportDialog({ table, query, visible, filtered, onClose }: { table: TableDetail; query: SessionQuery; visible: Column[]; filtered: boolean; onClose: () => void }) {
  const [scope, setScope] = useState<Scope>(filtered ? "view" : "table");
  const [format, setFormat] = useState<Format>("xlsx");
  // A grouped view can leave as its group lines (with totals) or as every row.
  const grouped = !!query.group?.length;
  const [what, setWhat] = useState<"groups" | "rows">("groups");
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const downloaded = useRef<string | null>(null);
  const isGuest = !!useMe().data?.user.roles.includes("guest");
  const [emails, setEmails] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => {
      const body: ExportBody = scope === "datahub" ? { datahub_id: table.datahub_id, format: "xlsx" } : { table_id: table.id, format };
      if (scope === "view") {
        if (query.filter) body.filter = query.filter;
        if (query.sort) body.sort = query.sort;
        if (query.search) body.search = query.search;
        if (query.timeFilter) body.time_filter = query.timeFilter;
        body.columns = visible.map((c) => c.key);
        if (grouped && what === "groups") {
          body.groups_only = true;
          body.group = query.group;
          if (query.aggs) body.aggs = query.aggs;
        }
      }
      if (emails && !isGuest && !(scope === "view" && grouped && what === "groups")) body.user_emails = true;
      return createExport(body);
    },
    onSuccess: (j: JobDto) => setJobId(j.id),
  });

  const d = job.data;
  useEffect(() => {
    if (d?.status === "done" && downloaded.current !== d.id) {
      downloaded.current = d.id;
      void jobDownload(d.id)
        .then((r) => saveFromUrl(r.url, r.filename))
        .catch(() => setDlError("Không tải được file. Bấm \"Tải lại file\"."));
    }
  }, [d]);

  const running = !!jobId && (!d || d.status === "pending" || d.status === "running");
  const retry = () => {
    setDlError(null);
    if (d) void jobDownload(d.id).then((r) => saveFromUrl(r.url, r.filename)).catch(() => setDlError("File đã hết hạn (giữ 24 giờ). Hãy xuất lại."));
  };

  return (
    <Modal title="Xuất dữ liệu" open onClose={onClose}>
      <div className="flex flex-col gap-4" data-testid="export-dialog">
        {!jobId && (
          <>
            <Field label="Xuất gì">
              <Select value={scope} onChange={(e) => { const s = e.target.value as Scope; setScope(s); if (s === "datahub") setFormat("xlsx"); }} aria-label="Phạm vi xuất">
                <option value="view">Bảng như view đang xem (bộ lọc, sắp xếp, cột đang hiện)</option>
                <option value="table">Cả bảng "{table.name}"</option>
                <option value="datahub">Cả datahub (mỗi bảng một sheet, chỉ XLSX)</option>
              </Select>
            </Field>
            {scope === "view" && grouped && (
              <Field label="Dòng xuất ra" hint={what === "groups" ? "Mỗi dòng là một nhóm: cột nhóm, Số dòng và các cột tổng của view." : "Từng dòng dữ liệu của bảng, sắp theo nhóm."}>
                <Select value={what} onChange={(e) => setWhat(e.target.value as "groups" | "rows")} aria-label="Dòng xuất ra">
                  <option value="groups">Dòng nhóm (tổng hợp)</option>
                  <option value="rows">Mọi dòng</option>
                </Select>
              </Field>
            )}
            {!isGuest && !(scope === "view" && grouped && what === "groups") && (
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={emails} onChange={(e) => setEmails(e.target.checked)} data-testid="export-emails" />
                Thêm cột email cạnh cột người dùng
              </label>
            )}
            <Field label="Định dạng">
              <Select value={format} onChange={(e) => setFormat(e.target.value as Format)} disabled={scope === "datahub"} aria-label="Định dạng file">
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="csv">CSV (.csv, UTF-8)</option>
                <option value="json">JSON (.json)</option>
              </Select>
            </Field>
            <p className="text-sm text-muted-foreground">
              File chứa giá trị đã tính của cột công thức. {table.access === "owner" ? "File Excel có thêm một sheet \"Công thức\" liệt kê công thức từng cột." : "Bạn không được xem nội dung công thức nên file không có phần đó."}
            </p>
            <ErrorText error={start.error} />
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" onClick={onClose}>Huỷ</Button>
              <Button onClick={() => start.mutate()} loading={start.isPending}><Download size={16} aria-hidden /> Xuất file</Button>
            </div>
          </>
        )}
        {jobId && (
          <>
            {d ? <JobBar job={d} /> : <p className="text-sm text-muted-foreground">Đang gửi yêu cầu…</p>}
            {d?.status === "done" && <Notice>Đã xuất xong: {d.result?.name}. Nếu file chưa tự tải xuống, bấm "Tải lại file".</Notice>}
            {d?.status === "failed" && <p role="alert" className="text-sm text-bad">Không xuất được. {d.error}</p>}
            {dlError && <p role="alert" className="text-sm text-bad">{dlError}</p>}
            <ErrorText error={job.error} />
            <div className="flex flex-wrap justify-between gap-2">
              {running ? <Button variant="secondary" onClick={() => void cancelJob(jobId)}>Huỷ xuất</Button> : <Button variant="secondary" onClick={onClose}>Đóng</Button>}
              {d?.status === "done" && <Button onClick={retry}><Download size={16} aria-hidden /> Tải lại file</Button>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
