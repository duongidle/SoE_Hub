import * as Dialog from "@radix-ui/react-dialog";
import { useInfiniteQuery } from "@tanstack/react-query";
import { formatDateTime, formatRelative } from "@soe/shared";
import { ArrowRight, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Input, Select, Textarea } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { ErrorState } from "@/components/ui/states";
import { Tip } from "@/components/ui/tooltip";
import { fetchRowsByIds, getHistory } from "@/lib/datahub/api";
import { NO_ACCESS, cellError, cellValue, displayText, editText, ERROR_HELP, attrsOf, entriesOf, nameKey, optionsOf, parseCellText, PICKER_TYPES, pickerEditable, readOnlyReason, typeOf, type CellCtx } from "@/lib/datahub/cells";
import type { TableSession } from "@/lib/datahub/session";
import type { Column, Level, Row } from "@/lib/datahub/types";
import { cn } from "@/lib/utils";
import { AttachmentField } from "./attachment-field";
import { OriginLink } from "./merge-status";
import { PersonChip } from "@/components/ui/person";
import { OptionChip, PersonPicker, RatingPicker } from "./pickers";
import { RelationPicker } from "./relation-picker";
import { PeopleAttrsEditor } from "./people-attrs";
import { DealPaymentsPanel } from "../deal/payments";
import { RemindMeButton } from "../notify/reminders";

const OP_LABEL: Record<string, string> = { create: "Tạo dòng", update: "Sửa", delete: "Xoá vào thùng rác", restore: "Khôi phục", upsert: "Cập nhật" };
const VIA_LABEL: Record<string, string> = { web: "", api: "qua API", mcp: "qua AI", form: "qua form", import: "qua import", automation: "tự động", system: "hệ thống" };

function useLabels(session: TableSession) {
  const [, set] = useState(0);
  useEffect(() => session.labels.subscribe(() => set((v) => v + 1)), [session]);
  return session.labels;
}

/**
 * All columns of one row, editable by the same rules as the grid, and the history of changes. Opened from the grid
 * (Shift + Space, the "Chi tiết dòng" button). Each field saves when the person leaves it.
 */
export function RowPanel({ session, rowId, level, onClose }: { session: TableSession; rowId: string; level: Level; onClose: () => void }) {
  const store = session.store;
  useSyncExternalStore(store.subscribe, store.getVersion);
  const labels = useLabels(session);
  const row = store.get(rowId);
  const [tab, setTab] = useState<"data" | "history">("data");
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    if (store.get(rowId)) return;
    fetchRowsByIds(session.table.id, [rowId])
      .then((r) => (r[0] ? store.adopt(r[0]) : setLoadError(new Error("Dòng này đã bị xoá hoặc bạn không còn quyền xem."))))
      .catch(setLoadError);
  }, [rowId, session, store]);

  const ctx: CellCtx = { people: labels.people, linked: labels.linked, noAccess: labels.noAccess };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-card shadow-lg sm:rounded-l-xl">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <Dialog.Title className="text-lg font-semibold">{row?.row_no ? `Dòng #${row.row_no}` : "Chi tiết dòng"}</Dialog.Title>
            {row && <RemindMeButton object={{ type: session.table.role_set === "deals" ? "deal" : "row", id: rowId }} />}
            <Button variant="ghost" onClick={onClose} aria-label="Đóng" className="!px-2">
              <X size={20} aria-hidden />
            </Button>
          </div>
          {session.table.kind === "merged" && session.table.access === "owner" && <OriginLink tableId={session.table.id} rowId={rowId} />}
          <div role="tablist" aria-label="Chi tiết dòng" className="flex gap-1 border-b border-border px-4">
            {(["data", "history"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("border-b-2 px-3 py-3 text-sm sm:py-2", tab === t ? "border-primary font-medium" : "border-transparent text-muted-foreground")}>
                {t === "data" ? "Dữ liệu" : "Lịch sử thay đổi"}
              </button>
            ))}
          </div>
          <div className="contain-scroll-y min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {loadError ? (
              <ErrorState error={loadError} title="Không mở được dòng" />
            ) : !row ? (
              <div className="flex flex-col gap-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : tab === "data" ? (
              <div className="flex flex-col gap-4">
                {level === "view" && <p className="rounded-md bg-muted px-3 py-2 text-sm">Bạn chỉ có quyền xem bảng này.</p>}
                {session.table.role_set === "deals" && <DealPaymentsPanel dealRow={row} dealsTableId={session.table.id} />}
                {session.table.columns.map((c) => (
                  <Field key={c.id} col={c} row={row} level={level} session={session} ctx={ctx} />
                ))}
                {session.table.columns.length === 0 && <p className="text-muted-foreground">Bảng chưa có cột nào.</p>}
              </div>
            ) : (
              <History session={session} rowId={rowId} ctx={ctx} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ col, row, level, session, ctx }: { col: Column; row: Row; level: Level; session: TableSession; ctx: CellCtx }) {
  // Why this field cannot be typed into. A person who may only view gets one notice at the top of the panel, not one per field.
  const viewOnly = level === "view";
  const picker = PICKER_TYPES.has(col.type);
  const reason = viewOnly ? null : picker && pickerEditable(col, level) ? null : readOnlyReason(col, level, row);
  const type = typeOf(col);
  const value = cellValue(col, row);
  const err = cellError(col, value);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState(false);
  const [linking, setLinking] = useState(false);
  const stored = editText(col, row);
  // While the person types, `draft` holds their text; otherwise the field follows the stored value (another person, a recalculation).
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? stored;
  const setText = setDraft;

  const save = async (v: unknown) => {
    setBusy(true);
    try {
      await session.edit([{ rowId: row.id, key: col.key, value: v }], `Sửa ô "${col.name}"`);
      setError(null);
    } catch (e) {
      const m = await session.explain(e);
      setError(m);
      notify.error(m);
    } finally {
      setBusy(false);
    }
  };
  const commitText = () => {
    if (text === stored) return setDraft(null);
    const p = parseCellText(col, text, new Map([...session.labels.people].map(([id, n]) => [nameKey(n), id] as const)));
    if (!p.ok) return setError(p.message);
    setError(null);
    setDraft(null);
    void save(p.value);
  };

  const id = `f-${col.id}`;
  const label = (
    <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-sm font-medium">
      <span className="[overflow-wrap:anywhere]">{col.name}{col.required && <span className="text-bad" aria-label="bắt buộc"> *</span>}</span>
      {busy && <span className="text-xs font-normal text-muted-foreground">Đang lưu...</span>}
    </label>
  );
  const hint = col.description ? <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{col.description}</span> : null;
  const errorText = error ? <span role="alert" className="text-xs text-bad">{error}</span> : null;

  let control: React.ReactNode;
  if (type === "attachment") {
    const ids = Array.isArray(value) ? (value as string[]) : [];
    control = <AttachmentField tableId={session.table.id} ids={ids} max={(col.config.max_files as number | undefined) ?? 20} readonly={viewOnly || !!reason} onChange={(list) => void save(list.length ? list : null)} />;
  } else if (type === "relation" && !viewOnly && !reason) {
    const ids = Array.isArray(value) ? (value as string[]) : [];
    ids.forEach((x) => session.labels.wantLinked(col.key, x));
    const selected = ids.map((x) => ({ id: x, label: ctx.linked.get(x) ?? "…" }));
    const multiple = col.config.multiple !== false;
    control = (
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <span id={id} className="min-h-9 py-1.5 text-sm [overflow-wrap:anywhere]">{selected.length ? selected.map((x) => x.label).join(", ") : "—"}</span>
          <Button variant="secondary" onClick={() => setLinking((v) => !v)} className="shrink-0">{linking ? "Đóng" : "Chọn dòng"}</Button>
        </div>
        {linking && (
          <RelationPicker
            tableId={session.table.id}
            column={col.key}
            selected={selected}
            multiple={multiple}
            onToggle={(r, on) => {
              if (on) session.labels.learnLinked(r.id, r.label);
              const next = on ? (multiple ? [...ids.filter((x) => x !== r.id), r.id] : [r.id]) : ids.filter((x) => x !== r.id);
              void save(next.length ? next : null);
            }}
            onDone={() => setLinking(false)}
            onCancel={() => setLinking(false)}
          />
        )}
      </div>
    );
  } else if (type === "user" && attrsOf(col).length > 0) {
    entriesOf(value).forEach((e) => session.labels.wantPerson(e.id));
    const shown = displayText(col, row, ctx);
    control = (
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <span id={id} data-testid={`people-text-${col.key}`} className="min-h-9 py-1.5 text-sm [overflow-wrap:anywhere]">{shown}</span>
          <Button variant="secondary" onClick={() => setPerson((v) => !v)} className="shrink-0">{person ? "Đóng" : viewOnly || reason ? "Xem chi tiết" : "Sửa người"}</Button>
        </div>
        {person && (
          <PeopleAttrsEditor col={col} tableId={session.table.id} value={value} names={ctx.people} readonly={viewOnly || !!reason} busy={busy} error={error} onCancel={() => setPerson(false)} onSave={(list) => {
            void (async () => {
              setBusy(true);
              try {
                await session.edit([{ rowId: row.id, key: col.key, value: list }], `Sửa ô "${col.name}"`);
                setError(null);
                setPerson(false);
              } catch (e) {
                setError(await session.explain(e));
              } finally {
                setBusy(false);
              }
            })();
          }} />
        )}
      </div>
    );
  } else if (viewOnly || reason || type === "relation") {
    const shown = err ? `${err}. ${ERROR_HELP[err] ?? ""}` : displayText(col, row, ctx);
    const pend = row.pending?.includes(col.key);
    control = (
      <div id={id} role="textbox" aria-label={col.name} aria-readonly="true" tabIndex={0} className={cn("min-h-11 rounded-md sm:min-h-9 border border-border bg-muted px-3 py-1.5 text-sm [overflow-wrap:anywhere]", err && "text-bad", typeof value === "number" && "text-right")}>
        {shown}
        {pend && <span className="ml-2 text-xs text-muted-foreground">Đang tính lại...</span>}
      </div>
    );
  } else if (type === "checkbox") {
    control = (
      <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
        <input id={id} type="checkbox" className="h-5 w-5" checked={value === true} onChange={(e) => void save(e.target.checked)} />
        {value === true ? "Có" : "Không"}
      </label>
    );
  } else if (type === "single_select") {
    control = (
      <Select id={id} value={typeof value === "string" ? value : ""} onChange={(e) => void save(e.target.value || null)}>
        <option value="">—</option>
        {optionsOf(col).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
    );
  } else if (type === "multi_select") {
    const ids = Array.isArray(value) ? (value as string[]) : [];
    control = (
      <div id={id} role="group" aria-label={col.name} className="flex flex-wrap gap-2">
        {optionsOf(col).map((o) => {
          const on = ids.includes(o.id);
          return (
            <button key={o.id} type="button" aria-pressed={on} onClick={() => void save((on ? ids.filter((x) => x !== o.id) : [...ids, o.id]).filter(Boolean).length ? (on ? ids.filter((x) => x !== o.id) : [...ids, o.id]) : null)} className={cn("min-h-11 rounded-md border px-2 py-1 text-sm sm:min-h-9", on ? "border-primary" : "border-border")}>
              <OptionChip option={o} />
              {on && <span className="sr-only"> (đã chọn)</span>}
            </button>
          );
        })}
        {optionsOf(col).length === 0 && <span className="text-sm text-muted-foreground">Cột chưa có lựa chọn nào.</span>}
      </div>
    );
  } else if (type === "rating") {
    control = <RatingPicker value={typeof value === "number" ? value : null} max={col.config.max ?? 5} onPick={(n) => void save(n)} />;
  } else if (type === "user") {
    const uid = typeof value === "string" ? value : null;
    if (uid) session.labels.wantPerson(uid);
    control = (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span id={id} className="min-h-9 py-1.5 text-sm [overflow-wrap:anywhere]">{uid ? <><PersonChip person={{ id: uid, full_name: ctx.people.get(uid) ?? "…" }} />{ctx.noAccess?.has(uid) ? ` (${NO_ACCESS})` : ""}</> : "—"}</span>
          <Button variant="secondary" onClick={() => setPerson((v) => !v)}>{person ? "Đóng" : "Đổi người"}</Button>
        </div>
        {person && <PersonPicker tableId={session.table.id} value={uid} valueName={uid ? ctx.people.get(uid) : undefined} onCancel={() => setPerson(false)} onDone={(p) => { setPerson(false); if (p) session.labels.learnPerson(p.id, p.full_name, p.email); void save(p?.id ?? null); }} />}
      </div>
    );
  } else if (type === "long_text") {
    control = <Textarea id={id} rows={4} value={text} onFocus={() => setDraft((d) => d ?? stored)} onChange={(e) => setText(e.target.value)} onBlur={commitText} aria-invalid={!!error} />;
  } else {
    const numeric = ["number", "currency", "percent"].includes(type);
    control = (
      <Input
        id={id}
        value={text}
        inputMode={numeric ? "decimal" : type === "phone" ? "tel" : type === "email" ? "email" : type === "url" ? "url" : type === "date" || type === "datetime" ? "numeric" : undefined}
        type="text"
        autoComplete="off"
        className={cn(numeric && "text-right")}
        placeholder={type === "date" ? "dd/mm/yyyy" : type === "datetime" ? "dd/mm/yyyy hh:mm" : type === "percent" ? "12,5%" : undefined}
        onFocus={() => setDraft((d) => d ?? stored)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        aria-invalid={!!error}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {label}
      {control}
      {reason ? <span className="text-xs text-muted-foreground">{reason}</span> : hint}
      {errorText}
    </div>
  );
}

function History({ session, rowId, ctx }: { session: TableSession; rowId: string; ctx: CellCtx }) {
  const q = useInfiniteQuery({
    queryKey: ["dh-history", session.table.id, rowId],
    queryFn: ({ pageParam }) => getHistory(session.table.id, rowId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 0,
  });
  useLabels(session);

  const items = (q.data?.pages ?? []).flatMap((p) => p.items);
  const hasMore = q.hasNextPage;
  items.forEach((i) => i.actor?.userId && session.labels.wantPerson(i.actor.userId));
  const byKey = new Map(session.table.columns.map((c) => [c.key, c]));
  const show = (key: string, v: unknown): string => {
    const col = byKey.get(key);
    if (!col) return v === null || v === undefined ? "—" : String(v);
    if (Array.isArray(v)) v.forEach((x) => col.type === "relation" && session.labels.wantLinked(col.key, String(x)));
    return displayText(col, { id: "", data: { [key]: v } }, ctx);
  };

  if (q.error && items.length === 0) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được lịch sử" />;
  if (q.isLoading) return <div className="flex flex-col gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Dòng này chưa có thay đổi nào.</p>;
  return (
    <ol aria-label="Lịch sử thay đổi" className="flex flex-col gap-4">
      {items.map((h) => {
        const who = h.actor?.userId ? (ctx.people.get(h.actor.userId) ?? "…") : "Hệ thống";
        const via = VIA_LABEL[h.actor?.via ?? "web"] ?? "";
        return (
          <li key={h.version} className="flex flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="inline-flex flex-wrap items-center font-medium [overflow-wrap:anywhere]">{h.actor?.userId ? <PersonChip person={{ id: h.actor.userId, full_name: who }} /> : who}{via && <span className="font-normal text-muted-foreground"> {via}</span>} · {OP_LABEL[h.op] ?? h.op}</span>
              <Tip label={formatDateTime(h.at)}><time dateTime={h.at} className="text-xs text-muted-foreground">{formatRelative(h.at)}</time></Tip>
            </div>
            {h.changes.map((c) => (
              <div key={c.field} className="rounded-md bg-muted px-2 py-1">
                <span className="font-medium [overflow-wrap:anywhere]">{c.field_name ?? "Cột đã xoá"}</span>
                <div className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
                  <span className="[overflow-wrap:anywhere]">{show(c.field, c.old)}</span>
                  <ArrowRight size={16} aria-label="đổi thành" className="shrink-0" />
                  <span className="text-foreground [overflow-wrap:anywhere]">{show(c.field, c.new)}</span>
                </div>
              </div>
            ))}
          </li>
        );
      })}
      {hasMore && (
        <li>
          <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Tải thêm</Button>
        </li>
      )}
    </ol>
  );
}
