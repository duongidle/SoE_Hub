import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCount, formatNumber } from "@soe/shared";
import { Maximize2, Pencil, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ErrorText, Field, Input, Modal, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { dhKeys, getTable } from "@/lib/datahub/api";
import { nameKey, optionsOf, parseCellText, readOnlyReason, type Parsed } from "@/lib/datahub/cells";
import { TableSession } from "@/lib/datahub/session";
import type { Column, Level, TableDetail } from "@/lib/datahub/types";
import { liveBus, type LiveSignal } from "@/lib/session";
import { TableGrid, type GridApi } from "./grid";
import { PersonPicker, RatingPicker } from "./pickers";
import { RowPanel } from "./row-panel";

/** An open table: toolbar, grid, status line and the row panel. The per-view toolbar (2C-2) plugs in at `data-slot="view-tools"`. */
export function TableView({ tableId }: { tableId: string }) {
  const q = useQuery({ queryKey: dhKeys.table(tableId), queryFn: () => getTable(tableId) });
  if (q.isLoading) return <GridSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không mở được bảng" />;
  return <LoadedTable key={`${q.data.id}:${columnsSignature(q.data)}`} table={q.data} />;
}

/** A change of columns builds a new session (the rows are read again with the new layout). */
const columnsSignature = (t: TableDetail) => JSON.stringify(t.columns.map((c) => [c.id, c.key, c.type, c.version, c.position]));

function GridSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-1" aria-busy="true" aria-label="Đang tải bảng">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  );
}

function LoadedTable({ table }: { table: TableDetail }) {
  // One session per table layout (`key` in TableView). Started and stopped by an effect: StrictMode runs it twice in development.
  const [session] = useState(() => new TableSession(table));
  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);
  return <OpenTable table={table} session={session} />;
}

function OpenTable({ table, session }: { table: TableDetail; session: TableSession }) {
  const qc = useQueryClient();
  const level: Level = table.access;
  const store = session.store;
  useSyncExternalStore(store.subscribe, store.getVersion);
  const undo = session.undo;
  useSyncExternalStore(undo.subscribe, () => `${undo.canUndo}-${undo.canRedo}`);
  const saving = useSyncExternalStore(session.onSaving, () => session.saving);

  const apiRef = useRef<GridApi | null>(null);
  const [sel, setSel] = useState<{ ids: string[]; active: string | null }>({ ids: [], active: null });
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);

  // Someone else changed rows, or the server finished recalculating: read the rows on screen again (not the whole table).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onSignal = (e: Event) => {
      const s = (e as CustomEvent<LiveSignal>).detail;
      if (s.aggregate_id !== table.id) return;
      if (s.event === "datahub.structure.changed") {
        void qc.invalidateQueries({ queryKey: dhKeys.table(table.id) });
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const [from, to] = apiRef.current?.visibleRange() ?? [0, 50];
        void store.sync(from, to).catch(() => undefined);
      }, 250);
    };
    liveBus.addEventListener("signal", onSignal);
    return () => {
      liveBus.removeEventListener("signal", onSignal);
      if (timer) clearTimeout(timer);
    };
  }, [table.id, store, qc]);

  const run = useCallback(
    async (job: () => Promise<void>) => {
      try {
        await job();
      } catch (e) {
        notify.error(await session.explain(e));
      }
    },
    [session],
  );

  const addRow = useCallback(async () => {
    await run(async () => {
      const [row] = await session.create([{}], "Thêm dòng");
      if (!row) return;
      const at = store.indexOf(row.id);
      if (at >= 0) apiRef.current?.scrollToRow(at);
      else notify.ok(`Đã thêm dòng #${row.row_no ?? ""} ở cuối bảng`, { label: "Mở dòng", onClick: () => { store.adopt(row); setOpenRow(row.id); } });
    });
  }, [run, session, store]);

  const deleteSelected = async () => {
    const ids = sel.ids;
    if (ids.length === 0) return;
    await run(async () => {
      const entry = await session.doDelete(ids, ids.length === 1 ? "Xoá 1 dòng" : `Xoá ${ids.length} dòng`);
      session.undo.push(entry);
      setSel({ ids: [], active: null });
      notify.ok(`Đã xoá ${formatCount(ids.length, "dòng")}`, {
        label: "Hoàn tác",
        onClick: () => void session.undo.revert(entry).catch(async (e) => notify.error(await session.explain(e))),
      });
    });
  };

  const doUndo = async (redo: boolean) => {
    try {
      const label = await (redo ? session.undo.redo() : session.undo.undo());
      if (label) notify.info(`${redo ? "Đã làm lại" : "Đã hoàn tác"}: ${label}`);
    } catch (e) {
      notify.error(`Không ${redo ? "làm lại" : "hoàn tác"} được: ${await session.explain(e)}`);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z") {
      e.preventDefault();
      void doUndo(e.shiftKey);
    } else if (k === "y") {
      e.preventDefault();
      void doUndo(true);
    }
  };

  const canWrite = level !== "view";
  const total = store.total ?? 0;
  const loaded = store.rows.length;
  const columnsEmpty = table.columns.length === 0;

  let body: React.ReactNode;
  if (columnsEmpty) {
    body = <EmptyState title="Bảng chưa có cột" hint={level === "owner" ? "Thêm cột để bắt đầu nhập dữ liệu." : "Chủ datahub chưa thêm cột nào."} />;
  } else if (store.status === "loading" && loaded === 0) {
    body = <GridSkeleton />;
  } else if (store.status === "error" && loaded === 0) {
    body = <ErrorState error={store.error} onRetry={() => void store.reload().catch(() => undefined)} />;
  } else if (store.done && loaded === 0) {
    body = (
      <EmptyState
        title="Bảng chưa có dòng nào"
        hint={canWrite ? "Thêm dòng đầu tiên, hoặc dán dữ liệu từ Excel hay Google Sheets." : "Người có quyền sửa chưa thêm dòng nào."}
        action={canWrite ? <Button onClick={() => void addRow()}><Plus size={16} aria-hidden /> Thêm dòng đầu tiên</Button> : undefined}
      />
    );
  } else {
    body = <TableGrid session={session} level={level} apiRef={apiRef} onOpenRow={setOpenRow} onSelection={(ids, active) => setSel({ ids, active })} onAddRow={addRow} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" onKeyDown={onKeyDown}>
      <div role="toolbar" aria-label="Công cụ bảng" className="flex flex-wrap items-center gap-2">
        {canWrite && (
          <>
            <Tip label="Hoàn tác (Ctrl+Z)">
              <Button variant="secondary" aria-label="Hoàn tác" disabled={!undo.canUndo} onClick={() => void doUndo(false)} className="!px-2.5"><Undo2 size={16} aria-hidden /></Button>
            </Tip>
            <Tip label="Làm lại (Ctrl+Shift+Z)">
              <Button variant="secondary" aria-label="Làm lại" disabled={!undo.canRedo} onClick={() => void doUndo(true)} className="!px-2.5"><Redo2 size={16} aria-hidden /></Button>
            </Tip>
            <Button variant="secondary" onClick={() => void addRow()} disabled={columnsEmpty}><Plus size={16} aria-hidden /> Thêm dòng</Button>
          </>
        )}
        {sel.ids.length > 0 && canWrite && (
          <>
            <Button variant="secondary" onClick={() => setBulk(true)}><Pencil size={16} aria-hidden /> Sửa {formatCount(sel.ids.length, "dòng")}</Button>
            <Button variant="secondary" className="!text-bad" onClick={() => void deleteSelected()}><Trash2 size={16} aria-hidden /> Xoá {formatCount(sel.ids.length, "dòng")}</Button>
          </>
        )}
        {(sel.active || sel.ids.length === 1) && (
          <Button variant="secondary" onClick={() => setOpenRow(sel.ids.length === 1 ? sel.ids[0]! : sel.active)}><Maximize2 size={16} aria-hidden /> Chi tiết dòng</Button>
        )}
        {!canWrite && <Badge tone="muted">Chỉ xem</Badge>}
        <div data-slot="view-tools" className="contents" />
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground" aria-live="polite">
          {saving > 0 ? <span>Đang lưu...</span> : null}
          {!columnsEmpty && store.status !== "loading" && (
            <span>{loaded < total ? `Đã tải ${formatNumber(loaded)} / ${formatCount(total, "dòng")}` : formatCount(total, "dòng")}</span>
          )}
        </div>
      </div>
      {body}
      {openRow && <RowPanel session={session} rowId={openRow} level={level} onClose={() => setOpenRow(null)} />}
      {bulk && <BulkEdit session={session} level={level} ids={sel.ids} onClose={() => setBulk(false)} />}
    </div>
  );
}

/** Set one column to one value on every selected row. */
function BulkEdit({ session, level, ids, onClose }: { session: TableSession; level: Level; ids: string[]; onClose: () => void }) {
  const cols = session.table.columns.filter((c) => !readOnlyReason(c, level));
  const [colId, setColId] = useState(cols[0]?.id ?? "");
  const col = cols.find((c) => c.id === colId);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const people = new Map([...session.labels.people].map(([id, n]) => [nameKey(n), id] as const));

  const apply = async () => {
    if (!col) return;
    const parsed: Parsed = picked !== undefined ? { ok: true, value: picked } : parseCellText(col, text, people);
    if (!parsed.ok) return setError(parsed.message);
    setBusy(true);
    setError(null);
    try {
      await session.edit(ids.map((rowId) => ({ rowId, key: col.key, value: parsed.value })), `Sửa hàng loạt cột "${col.name}"`);
      notify.ok(`Đã sửa ${formatCount(ids.length, "dòng")}`);
      onClose();
    } catch (e) {
      setError(await session.explain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Sửa ${formatCount(ids.length, "dòng")}`} open onClose={onClose} dirty={!!text || picked !== undefined}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void apply(); }}>
        <Field label="Cột" hint="Giá trị mới được ghi vào cột này ở mọi dòng đã chọn.">
          <Select value={colId} onChange={(e) => { setColId(e.target.value); setText(""); setPicked(undefined); setError(null); }}>
            {cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {col && <BulkValue col={col} text={text} setText={setText} picked={picked} setPicked={setPicked} session={session} />}
        <ErrorText error={error ? new Error(error) : null} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button type="submit" loading={busy} disabled={!col}>Ghi vào {formatCount(ids.length, "dòng")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function BulkValue({ col, text, setText, picked, setPicked, session }: { col: Column; text: string; setText: (s: string) => void; picked: unknown; setPicked: (v: unknown) => void; session: TableSession }) {
  switch (col.type) {
    case "checkbox":
      return (
        <Field label="Giá trị">
          <Select value={picked === undefined ? "" : String(picked)} onChange={(e) => setPicked(e.target.value === "" ? undefined : e.target.value === "true")}>
            <option value="">Chọn Có hoặc Không</option>
            <option value="true">Có</option>
            <option value="false">Không</option>
          </Select>
        </Field>
      );
    case "single_select":
      return (
        <Field label="Giá trị">
          <Select value={picked === undefined ? "" : String(picked ?? "__empty")} onChange={(e) => setPicked(e.target.value === "" ? undefined : e.target.value === "__empty" ? null : e.target.value)}>
            <option value="">Chọn một lựa chọn</option>
            <option value="__empty">Để trống</option>
            {optionsOf(col).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
      );
    case "multi_select": {
      const ids = Array.isArray(picked) ? (picked as string[]) : [];
      return (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">Giá trị</legend>
          {optionsOf(col).map((o) => (
            <label key={o.id} className="flex min-h-9 items-center gap-2">
              <input type="checkbox" className="h-5 w-5" checked={ids.includes(o.id)} onChange={(e) => setPicked(e.target.checked ? [...ids, o.id] : ids.filter((x) => x !== o.id))} />
              {o.name}
            </label>
          ))}
          <span className="text-xs text-muted-foreground">Không chọn gì thì để trống cột này.</span>
        </fieldset>
      );
    }
    case "rating":
      return <RatingPicker value={typeof picked === "number" ? picked : null} max={col.config.max ?? 5} onPick={(n) => setPicked(n)} />;
    case "user":
      return <PersonPicker value={typeof picked === "string" ? picked : null} valueName={typeof picked === "string" ? session.labels.people.get(picked) : undefined} autoFocus={false} onDone={(p) => { if (p) session.labels.learnPerson(p.id, p.full_name); setPicked(p?.id ?? null); }} />;
    default:
      return (
        <Field label="Giá trị" hint={col.type === "date" ? "Dạng dd/mm/yyyy." : col.type === "datetime" ? "Dạng dd/mm/yyyy hh:mm." : col.type === "percent" ? "Ví dụ 12,5%." : "Để trống để xoá giá trị."}>
          <Input value={text} onChange={(e) => setText(e.target.value)} inputMode={["number", "currency", "percent"].includes(col.type) ? "decimal" : undefined} autoComplete="off" />
        </Field>
      );
  }
}
