import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCount } from "@soe/shared";
import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, ErrorText, errorMessage, Modal, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { fetchRowsByIds, findDuplicates, resolveDuplicates, type DuplicateGroup } from "@/lib/datahub/api";
import { displayText } from "@/lib/datahub/cells";
import { comparableColumns, defaultChoice, fillPicks, groupRequest, isEmptyValue, mergeableColumns, type GroupChoice } from "@/lib/datahub/duplicates";
import type { Column, Row, TableDetail } from "@/lib/datahub/types";
import { cn } from "@/lib/utils";

const NO_LABELS = { people: new Map<string, string>(), linked: new Map<string, string>() };
const PAGE = 20;

/**
 * Find duplicate rows (design module2 section 7a): pick the key columns, the server lists the groups, and each group is
 * resolved by keeping one row (optionally merging values into it) or one way is applied to every group.
 */
export function DuplicatesDialog({ table, onClose }: { table: TableDetail; onClose: () => void }) {
  const cols = useMemo(() => comparableColumns(table.columns), [table.columns]);
  const [picked, setPicked] = useState<string[]>([]);
  const [run, setRun] = useState<string[] | null>(null);
  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length >= 5 ? p : [...p, key]));
  return (
    <Modal title="Tìm dòng trùng" open onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Cột để so *</legend>
          <p className="text-xs text-muted-foreground">Chọn 1 đến 5 cột. Hai dòng trùng khi mọi cột đã chọn giống nhau, không tính dấu, hoa thường và khoảng trắng thừa.</p>
          {cols.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bảng chưa có cột nào để so.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {cols.map((c) => (
                <li key={c.key}>
                  <label className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm sm:min-h-9", picked.includes(c.key) ? "border-primary bg-primary/10" : "border-border")}>
                    <input type="checkbox" checked={picked.includes(c.key)} onChange={() => toggle(c.key)} disabled={!picked.includes(c.key) && picked.length >= 5} />
                    <span className="[overflow-wrap:anywhere]">{c.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <div>
          <Button onClick={() => setRun([...picked])} disabled={picked.length === 0}>
            <Copy size={16} aria-hidden /> Tìm dòng trùng
          </Button>
        </div>
        {run && <Results key={run.join(",")} table={table} columns={run} />}
      </div>
    </Modal>
  );
}

function Results({ table, columns }: { table: TableDetail; columns: string[] }) {
  const qc = useQueryClient();
  // The first page comes from a query; later pages are added by the button. A resolved group is hidden (its rows are gone on the server, so the next offset is the number of groups still shown).
  const q = useQuery({ queryKey: ["dh-duplicates", table.id, columns], queryFn: () => findDuplicates(table.id, columns, 0, PAGE), gcTime: 0, staleTime: Infinity, refetchOnWindowFocus: false });
  const [more, setMore] = useState<DuplicateGroup[]>([]);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [hasMore, setHasMore] = useState<boolean | null>(null);
  const [bulk, setBulk] = useState(false);

  const refresh = () => {
    setMore([]);
    setGone(new Set());
    setHasMore(null);
    void qc.invalidateQueries({ queryKey: ["dh-duplicates", table.id] });
  };

  if (q.isLoading) return <div className="flex flex-col gap-2" aria-busy="true" aria-label="Đang tìm dòng trùng"><Skeleton className="h-6 w-64" /><Skeleton className="h-32 w-full" /></div>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tìm được dòng trùng" />;
  const data = q.data!;
  const shown = [...data.groups, ...more].filter((g) => !gone.has(g.ids[0]!));
  const goneRows = [...data.groups, ...more].filter((g) => gone.has(g.ids[0]!)).reduce((n, g) => n + g.count, 0);
  const totalGroups = Math.max(0, data.total_groups - gone.size);
  const totalRows = Math.max(0, data.total_rows - goneRows);
  if (data.total_groups === 0) return <EmptyState title="Không có dòng trùng" hint="Không có nhóm dòng nào giống nhau theo các cột đã chọn." />;
  const canMore = (hasMore ?? data.has_more) && shown.length < totalGroups;
  const loadMore = async () => {
    setLoadingMore(true);
    setMoreError(null);
    try {
      const r = await findDuplicates(table.id, columns, shown.length, PAGE);
      setMore((m) => [...m, ...r.groups]);
      setHasMore(r.has_more);
    } catch (e) {
      setMoreError(e);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="duplicate-results">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" aria-live="polite">
          {formatCount(totalGroups, "nhóm trùng")}, {formatCount(totalRows, "dòng")}
        </p>
        <Button variant="secondary" onClick={() => setBulk(true)} disabled={totalGroups === 0}>Xử lý mọi nhóm</Button>
      </div>
      <ul className="flex flex-col gap-3">
        {shown.map((g) => (
          <li key={g.ids[0]}>
            <GroupCard table={table} group={g} onDone={() => setGone((s) => new Set([...s, g.ids[0]!]))} />
          </li>
        ))}
      </ul>
      {canMore && (
        <Button variant="secondary" onClick={() => void loadMore()} loading={loadingMore}>
          Tải thêm nhóm
        </Button>
      )}
      <ErrorText error={moreError ? new Error(errorMessage(moreError)) : null} />
      {bulk && <BulkDialog table={table} columns={columns} total={totalGroups} onClose={() => setBulk(false)} onDone={() => { setBulk(false); refresh(); }} />}
    </div>
  );
}

function GroupCard({ table, group, onDone }: { table: TableDetail; group: DuplicateGroup; onDone: (removedIds: string[]) => void }) {
  const rowsQ = useQuery({ queryKey: ["dh-dup-rows", table.id, group.ids], queryFn: () => fetchRowsByIds(table.id, group.ids), gcTime: 0 });
  const rows = useMemo(() => [...(rowsQ.data ?? [])].sort((a, b) => (a.row_no ?? 0) - (b.row_no ?? 0)), [rowsQ.data]);
  const mCols = useMemo(() => mergeableColumns(table.columns, table.access), [table.columns, table.access]);
  const [choice, setChoice] = useState<GroupChoice | null>(null);
  const cur: GroupChoice | null = choice ?? (rows.length ? defaultChoice(rows, mCols, false) : null);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => resolveDuplicates(table.id, { groups: [groupRequest(rows, mCols, cur!)] }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["dh-table", table.id] });
      notify.ok(`Đã xoá ${formatCount(r.rows_removed, "dòng")}${r.rows_merged ? ", đã gộp giá trị" : ""}. Xem lại trong Thùng rác.`);
      onDone(rows.filter((r2) => r2.id !== cur!.keepId).map((r2) => r2.id));
    },
  });

  if (rowsQ.isLoading) return <Skeleton className="h-28 w-full" />;
  if (rowsQ.error) return <ErrorState error={rowsQ.error} onRetry={() => void rowsQ.refetch()} title="Không tải được các dòng của nhóm" />;
  if (!cur || rows.length < 2) return null;
  const setKeep = (id: string) => setChoice({ keepId: id, merge: cur.merge, pick: cur.merge ? fillPicks(rows, mCols, id) : {} });
  const setMerge = (merge: boolean) => setChoice({ keepId: cur.keepId, merge, pick: merge ? fillPicks(rows, mCols, cur.keepId) : {} });
  const mergeable = new Set(mCols.map((c) => c.key));
  const extra = group.count - group.ids.length;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="duplicate-group">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1 font-medium">Giữ</th>
              <th className="px-2 py-1 font-medium">Dòng</th>
              {table.columns.map((c) => (
                <th key={c.key} className="px-2 py-1 font-medium [overflow-wrap:anywhere]">{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const keep = r.id === cur.keepId;
              return (
                <tr key={r.id} className={cn("border-t border-border", keep && "bg-primary/5")}>
                  <td className="px-2 py-1">
                    <input type="radio" name={`keep-${group.ids[0]}`} checked={keep} onChange={() => setKeep(r.id)} aria-label={`Giữ dòng #${r.row_no}`} className="h-5 w-5" />
                  </td>
                  <td className="px-2 py-1 font-number">#{r.row_no}</td>
                  {table.columns.map((c) => (
                    <CellPick key={c.key} col={c} row={r} keepRow={rows.find((x) => x.id === cur.keepId)!} choice={cur} canPick={cur.merge && mergeable.has(c.key)} onPick={(id) => setChoice({ ...cur, pick: { ...cur.pick, [c.key]: id } })} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {extra > 0 && <p className="text-xs text-muted-foreground">Nhóm có {formatCount(group.count, "dòng")}; chỉ hiện {group.ids.length} dòng đầu. Dùng "Xử lý mọi nhóm" để xử lý cả nhóm này.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <input type="checkbox" checked={cur.merge} onChange={(e) => setMerge(e.target.checked)} />
          Gộp giá trị vào dòng giữ
        </label>
        <Button variant="danger" onClick={() => m.mutate()} loading={m.isPending} disabled={extra > 0}>
          Xoá {formatCount(rows.length - 1, "dòng")} còn lại
        </Button>
      </div>
      {cur.merge && <p className="text-xs text-muted-foreground">Bấm vào ô của dòng khác để lấy giá trị đó cho dòng giữ. Ô được chọn có dấu tích.</p>}
      <ErrorText error={m.error} />
    </div>
  );
}

function CellPick({ col, row, keepRow, choice, canPick, onPick }: { col: Column; row: Row; keepRow: Row; choice: GroupChoice; canPick: boolean; onPick: (rowId: string) => void }) {
  const text = displayText(col, row, NO_LABELS);
  const picked = choice.pick[col.key];
  const isKeep = row.id === keepRow.id;
  // The value the kept row ends up with is marked: its own, unless another row was picked.
  const chosen = canPick && (picked ? picked === row.id : isKeep);
  const same = JSON.stringify(row.data[col.key] ?? null) === JSON.stringify(keepRow.data[col.key] ?? null);
  if (!canPick || isKeep && same) return <td className="max-w-64 px-2 py-1 [overflow-wrap:anywhere]">{text}</td>;
  return (
    <td className="max-w-64 px-2 py-1">
      <button type="button" onClick={() => onPick(row.id)} aria-pressed={chosen} aria-label={`Lấy giá trị "${text}" của dòng #${row.row_no} cho cột ${col.name}`} className={cn("flex min-h-8 w-full items-center gap-1 rounded px-1 text-left [overflow-wrap:anywhere]", chosen ? "bg-primary/15" : "hover:bg-muted")}>
        {chosen && <Check size={16} aria-hidden className="shrink-0" />}
        <span className={cn(isEmptyValue(row.data[col.key]) && "text-muted-foreground")}>{text}</span>
      </button>
    </td>
  );
}

function BulkDialog({ table, columns, total, onClose, onDone }: { table: TableDetail; columns: string[]; total: number; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [keep, setKeep] = useState<"first" | "last" | "most_filled">("first");
  const [fill, setFill] = useState(true);
  const [progress, setProgress] = useState<{ done: number; removed: number } | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      let done = 0;
      let removed = 0;
      for (;;) {
        const r = await resolveDuplicates(table.id, { all: { columns, keep, fill_empty: fill } });
        done += r.groups_resolved;
        removed += r.rows_removed;
        setProgress({ done, removed });
        // Stop when finished or when nothing more can be resolved this way (very large groups stay).
        if (r.remaining_groups === 0 || r.groups_resolved === 0) return { done, removed, left: r.remaining_groups };
      }
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["dh-table", table.id] });
      notify.ok(`Đã xử lý ${formatCount(r.done, "nhóm")}, xoá ${formatCount(r.removed, "dòng")}${r.left ? `. Còn ${formatCount(r.left, "nhóm")} lớn chưa xử lý` : ""}`);
      onDone();
    },
  });
  return (
    <Modal title="Xử lý mọi nhóm trùng" open onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm">Áp một cách cho {formatCount(total, "nhóm")}. Các dòng bị xoá vào Thùng rác, khôi phục được.</p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Giữ dòng nào *</span>
          <Select value={keep} onChange={(e) => setKeep(e.target.value as typeof keep)}>
            <option value="first">Dòng đầu (số nhỏ nhất)</option>
            <option value="last">Dòng cuối (số lớn nhất)</option>
            <option value="most_filled">Dòng có nhiều ô nhập nhất</option>
          </Select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
          <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
          Điền ô trống của dòng giữ bằng giá trị của các dòng bị xoá
        </label>
        {progress && <p role="status" className="text-sm">Đã xử lý {formatCount(progress.done, "nhóm")}, xoá {formatCount(progress.removed, "dòng")}…</p>}
        <ErrorText error={m.error ? new Error(errorMessage(m.error)) : null} />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-4">
          <Button variant="secondary" onClick={onClose} disabled={m.isPending}>Huỷ</Button>
          <Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>Xoá dòng thừa của {formatCount(total, "nhóm")}</Button>
        </div>
      </div>
    </Modal>
  );
}
