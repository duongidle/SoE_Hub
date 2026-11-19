import { useInfiniteQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/components/ui/form";
import { searchRelation } from "@/lib/datahub/api";
import { cn } from "@/lib/utils";

const ITEM_H = 40;
const VIEW_H = 240;
const OVERSCAN = 4;

export interface Linked {
  id: string;
  label: string;
}

/**
 * Pick the rows a Liên kết cell points at. The server searches the target table (by words, or by a row number such as #12) and pages the
 * answer; the list only draws the rows in view, so a table of 100.000 rows opens as fast as one of ten. Single: a click picks and finishes.
 * Multiple: clicks toggle, "Xong" finishes. Arrow keys move, Enter picks, Esc cancels.
 */
export function RelationPicker({ tableId, column, selected, multiple, onToggle, onDone, onCancel, autoFocus = true }: { tableId: string; column: string; selected: Linked[]; multiple: boolean; onToggle: (row: Linked, on: boolean) => void; onDone: () => void; onCancel?: () => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = useInfiniteQuery({
    queryKey: ["dh-relation-search", tableId, column, term],
    queryFn: ({ pageParam }) => searchRelation(tableId, column, { q: term, after: pageParam, limit: 50 }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next_after,
    staleTime: 0,
  });
  const rows: Linked[] = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.data.map((r) => ({ id: r.id, label: r.label, no: r.row_no }))), [query.data]);
  const picked = new Set(selected.map((s) => s.id));

  const [top, setTop] = useState(0);
  // The highlighted row belongs to one search; a new search starts again at the top.
  const [mark, setMark] = useState({ i: 0, term: "" });
  const active = mark.term === term ? mark.i : 0;
  const setActive = (i: number) => setMark({ i, term });
  const box = useRef<HTMLDivElement>(null);
  const first = Math.max(0, Math.floor(top / ITEM_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((top + VIEW_H) / ITEM_H) + OVERSCAN);

  // Read the next page when the end of what is loaded comes into view.
  useEffect(() => {
    if (query.hasNextPage && !query.isFetchingNextPage && last >= rows.length - 5) void query.fetchNextPage();
  }, [last, rows.length, query]);
  useEffect(() => {
    box.current?.scrollTo({ top: 0 });
  }, [term]);

  const choose = (r: Linked) => {
    const on = !picked.has(r.id);
    onToggle(r, on);
    if (!multiple) onDone();
  };
  const move = (to: number) => {
    const i = Math.max(0, Math.min(rows.length - 1, to));
    setActive(i);
    const el = box.current;
    if (el) {
      if (i * ITEM_H < el.scrollTop) el.scrollTop = i * ITEM_H;
      else if ((i + 1) * ITEM_H > el.scrollTop + VIEW_H) el.scrollTop = (i + 1) * ITEM_H - VIEW_H;
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") move(active + 1);
    else if (e.key === "ArrowUp") move(active - 1);
    else if (e.key === "Enter") {
      if (rows[active]) choose(rows[active]!);
      else if (multiple) onDone();
    } else if (e.key === "Escape") onCancel?.();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div onKeyDown={onKey} className="w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-card p-2 text-sm shadow-md">
      {selected.length > 0 && (
        <ul aria-label="Đã chọn" className="mb-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {selected.map((s) => (
            <li key={s.id} className="inline-flex max-w-full items-center gap-1 rounded bg-muted py-0.5 pl-2 pr-0.5">
              <span className="[overflow-wrap:anywhere]">{s.label}</span>
              <button type="button" aria-label={`Bỏ liên kết ${s.label}`} onClick={() => onToggle(s, false)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-border sm:h-6">
                <X size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input aria-label="Tìm dòng để liên kết" placeholder="Tìm theo chữ hoặc số dòng, ví dụ #12" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} autoComplete="off" />
      <div
        ref={box}
        role="listbox"
        aria-label="Dòng của bảng được liên kết"
        aria-multiselectable={multiple}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
        className="contain-scroll relative mt-2 overflow-y-auto"
        style={{ height: Math.min(VIEW_H, Math.max(ITEM_H * 2, rows.length * ITEM_H)) }}
      >
        {query.isLoading ? (
          <div className="flex flex-col gap-1">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : query.error ? (
          <p role="alert" className="px-2 py-3 text-bad">{errorMessage(query.error)}</p>
        ) : rows.length === 0 ? (
          <p className="px-2 py-3 text-muted-foreground">{term ? "Không có dòng nào khớp." : "Bảng được liên kết chưa có dòng nào."}</p>
        ) : (
          <div style={{ height: rows.length * ITEM_H + (query.hasNextPage ? ITEM_H : 0) }}>
            {rows.slice(first, last).map((r, k) => {
              const i = first + k;
              const on = picked.has(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => choose(r)}
                  onMouseMove={() => setActive(i)}
                  style={{ position: "absolute", top: i * ITEM_H, height: ITEM_H, left: 0, right: 0 }}
                  className={cn("flex items-center gap-2 rounded px-2 text-left", i === active && "bg-muted")}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">{on && <Check size={16} aria-hidden />}</span>
                  <span className="min-w-0 flex-1 truncate" title={r.label}>{r.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        <button type="button" className="min-h-11 rounded px-2 text-muted-foreground hover:bg-muted sm:min-h-9" onClick={() => { selected.forEach((s) => onToggle(s, false)); if (!multiple) onDone(); }} disabled={selected.length === 0}>Bỏ hết liên kết</button>
        {multiple && <button type="button" className="min-h-11 rounded bg-primary px-3 text-primary-foreground sm:min-h-9" onClick={onDone}>Xong</button>}
      </div>
    </div>
  );
}
