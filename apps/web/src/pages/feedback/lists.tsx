import { useInfiniteQuery } from "@tanstack/react-query";
import { Button, PageTitle, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, FilteredEmptyState } from "@/components/ui/states";
import { apiList, qs } from "@/lib/api";
import { useUrlState } from "@/lib/use-url-state";
import { FeedbackDrawer, FeedbackRow, KIND_LABEL, STATUS_LABEL, type FeedbackSummary } from "./common";

const PAGE = 20;

function useFeedbackList(path: string, params: Record<string, string>) {
  return useInfiniteQuery({
    queryKey: ["feedback", "list", path, params],
    queryFn: ({ pageParam }) => apiList<FeedbackSummary>(`${path}${qs({ ...params, limit: PAGE, cursor: pageParam || undefined })}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

function ListBody({ q, onOpen, showAuthor, filtered, onClear, emptyHint }: { q: ReturnType<typeof useFeedbackList>; onOpen: (id: string) => void; showAuthor?: boolean; filtered: boolean; onClear: () => void; emptyHint: string }) {
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (rows.length === 0) return filtered ? <FilteredEmptyState onClear={onClear} /> : <EmptyState title="Chưa có góp ý nào" hint={emptyHint} />;
  return (
    <>
      <Card>
        <ul className="divide-y divide-border-soft" aria-label="Danh sách góp ý">
          {rows.map((r) => <FeedbackRow key={r.id} row={r} onOpen={() => onOpen(r.id)} showAuthor={showAuthor} />)}
        </ul>
      </Card>
      {q.hasNextPage && <div className="flex justify-center"><Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Tải thêm</Button></div>}
    </>
  );
}

/** "Góp ý của tôi" (/gop-y): what I sent, with the status; a row opens the drawer with the thread. */
export function MyFeedbackPage() {
  const [s, set] = useUrlState({ kind: "", status: "", id: "" });
  const q = useFeedbackList("/feedback/mine", { kind: s.kind, status: s.status });
  const filtered = !!(s.kind || s.status);
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Góp ý của tôi</PageTitle>
      <Filters kind={s.kind} status={s.status} statusAll="" onChange={(p) => set(p)} />
      <ListBody q={q} onOpen={(id) => set({ id })} filtered={filtered} onClear={() => set({ kind: "", status: "" })} emptyHint="Bấm nút ? trên thanh trên cùng, chọn Gửi góp ý." />
      {s.id && <FeedbackDrawer id={s.id} onClose={() => set({ id: "" })} />}
    </div>
  );
}

/** "Feedback" (/quan-tri/feedback): the handler's inbox. New and Viewing by default, newest first, "Tải thêm" pages by cursor. */
export function FeedbackInboxPage() {
  const [s, set] = useUrlState({ kind: "", status: "open", id: "" });
  const q = useFeedbackList("/feedback", { kind: s.kind, status: s.status });
  const filtered = !!s.kind || s.status !== "open";
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Feedback</PageTitle>
      <Filters kind={s.kind} status={s.status} statusAll="all" onChange={(p) => set(p)} withOpen />
      <ListBody q={q} onOpen={(id) => set({ id })} showAuthor filtered={filtered} onClear={() => set({ kind: "", status: "open" })} emptyHint="Chưa ai gửi góp ý." />
      {s.id && <FeedbackDrawer id={s.id} manage onClose={() => set({ id: "" })} />}
    </div>
  );
}

function Filters({ kind, status, statusAll, onChange, withOpen }: { kind: string; status: string; statusAll: string; onChange: (p: { kind?: string; status?: string }) => void; withOpen?: boolean }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Loại
        <Select aria-label="Lọc theo loại" className="w-48" value={kind} onChange={(e) => onChange({ kind: e.target.value })}>
          <option value="">Tất cả loại</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold">
        Trạng thái
        <Select aria-label="Lọc theo trạng thái" className="w-56" value={status} onChange={(e) => onChange({ status: e.target.value })}>
          {withOpen && <option value="open">Mới và Đang xem</option>}
          <option value={statusAll}>Tất cả trạng thái</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </label>
    </div>
  );
}
