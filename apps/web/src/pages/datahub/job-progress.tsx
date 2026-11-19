import { useQuery } from "@tanstack/react-query";
import { getJob, jobFinished, type JobDto } from "@/lib/datahub/api";

/** Follows a background job (import or export): asks for its state every second until it is done, failed or cancelled. */
export function useJob(id: string | null) {
  return useQuery({
    queryKey: ["dh-job", id],
    queryFn: () => getJob(id!),
    enabled: id !== null,
    refetchInterval: (q) => (q.state.data && jobFinished(q.state.data) ? false : 1000),
    staleTime: 0,
  });
}

const PHASES: Record<string, string> = { starting: "Đang bắt đầu…", reading: "Đang đọc file…", creating: "Đang tạo bảng và cột…", importing: "Đang nhập dòng…", writing: "Đang ghi file…", done: "Xong", cancelled: "Đã huỷ" };

/** The bar and the words of a running job. The numbers come from the job record, nothing is computed from guesses. */
export function JobBar({ job }: { job: JobDto }) {
  const { done, total } = job.progress;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : job.status === "done" ? 100 : 0;
  return (
    <div className="flex flex-col gap-2" data-testid="job-progress">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>{job.status === "pending" ? "Đang chờ tới lượt…" : (PHASES[job.phase ?? ""] ?? "Đang xử lý…")}</span>
        <span className="tabular-nums text-muted-foreground">{total > 0 ? `${done.toLocaleString("vi-VN")} / ${total.toLocaleString("vi-VN")} dòng` : ""}</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Tiến độ" className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
