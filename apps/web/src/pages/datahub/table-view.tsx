import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { formatCount } from "@soe/shared";
import { Maximize2, Pencil, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ErrorText, errorMessage, Field, Input, Modal, Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { createView, dhKeys, getTable, listViews, rememberView, updateView } from "@/lib/datahub/api";
import { nameKey, optionsOf, parseCellText, readOnlyReason, type Parsed } from "@/lib/datahub/cells";
import { TableSession } from "@/lib/datahub/session";
import type { Column, Level, TableDetail } from "@/lib/datahub/types";
import { ViewAutosave } from "@/lib/datahub/view-autosave";
import { buildQuery, DEFAULT_ROW_HEIGHT, fullOrder, layoutColumns, moveColumn, pruneConfig, querySignature, ROW_HEIGHTS, type ColorRule, type SessionQuery, type ViewConfig, type ViewDto } from "@/lib/datahub/view-config";
import { liveBus, type LiveSignal } from "@/lib/session";
import { TableGrid, type GridApi } from "./grid";
import { PersonPicker, RatingPicker } from "./pickers";
import { RowPanel } from "./row-panel";
import { ViewTabs } from "./view-tabs";
import { ViewTools } from "./view-tools";

/** An open table: view tabs and tools on top, then the row toolbar, the grid, the status line and the row panel. */
export function TableView({ tableId }: { tableId: string }) {
  const q = useQuery({ queryKey: dhKeys.table(tableId), queryFn: () => getTable(tableId) });
  const vq = useQuery({ queryKey: dhKeys.views(tableId), queryFn: () => listViews(tableId) });
  if (q.isLoading || vq.isLoading) return <GridSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không mở được bảng" />;
  if (vq.error || !vq.data) return <ErrorState error={vq.error} onRetry={() => void vq.refetch()} title="Không tải được các view của bảng" />;
  return <ViewHost table={q.data} data={vq.data} />;
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

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** What the grid needs from the view: the columns on screen and how they look. The rows are the session's. */
export interface GridView {
  columns: Column[];
  frozen: number;
  widths: Record<string, number>;
  rowHeight: number;
  tall: boolean;
  colors: ColorRule[];
  onWidth: (key: string, width: number) => void;
  onMove: (key: string, toIndex: number) => void;
  onHeaderAction: (key: string, action: "freeze" | "unfreeze" | "hide" | "asc" | "desc" | "group") => void;
}

/** Owns the current view: which one is open (the address keeps it), its settings (saved as they change) and the session of rows it reads. */
function ViewHost({ table, data }: { table: TableDetail; data: { views: ViewDto[]; last_view_id: string | null } }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const urlView = (useSearch({ strict: false }) as { view?: string }).view;
  const views = data.views;
  const view = views.find((v) => v.id === urlView) ?? views.find((v) => v.id === data.last_view_id) ?? views[0];

  // A table always has a shared view; if somehow none is visible, make a personal one.
  const made = useRef(false);
  useEffect(() => {
    if (views.length > 0 || made.current) return;
    made.current = true;
    void createView(table.id, { name: "Dạng bảng" }).then(() => qc.invalidateQueries({ queryKey: dhKeys.views(table.id) }));
  }, [views.length, table.id, qc]);

  if (!view) return <GridSkeleton />;
  return <ViewBody key={view.id} table={table} views={views} view={view} onSelect={(id) => {
    void nav({ search: ((prev: Record<string, unknown>) => ({ ...prev, view: id })) as never, replace: true });
    void rememberView(table.id, id).catch(() => undefined);
  }} />;
}

function ViewBody({ table, views, view, onSelect }: { table: TableDetail; views: ViewDto[]; view: ViewDto; onSelect: (id: string) => void }) {
  const qc = useQueryClient();
  const auto = useMemo(
    () =>
      new ViewAutosave(view.config, {
        save: async (patch) => {
          const v = await updateView(view.id, { config: patch });
          qc.setQueryData<{ views: ViewDto[]; last_view_id: string | null }>(dhKeys.views(table.id), (old) => (old ? { ...old, views: old.views.map((x) => (x.id === v.id ? v : x)) } : old));
          return v.config;
        },
        onError: async (e) => notify.error(`Không lưu được thay đổi của view. ${errorMessage(e)}`),
      }),
    // One autosave per open view (the body is keyed by the view id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useSyncExternalStore(auto.subscribe, auto.getVersion);
  useEffect(() => auto.adopt(view.config), [auto, view.config]);
  useEffect(() => () => void auto.flush(), [auto]);

  const config = auto.config;
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 350);
  const { dead } = useMemo(() => pruneConfig(config, table.columns), [config, table.columns]);
  const query = useMemo(() => buildQuery(config, table.columns, debounced), [config, table.columns, debounced]);
  const colLayout = useMemo(() => layoutColumns(config, table.columns), [config, table.columns]);
  const rowHeightName = config.row_height ?? DEFAULT_ROW_HEIGHT;

  const change = useCallback((patch: Partial<Record<keyof ViewConfig, unknown>>) => auto.change(patch), [auto]);
  const gridView: GridView = useMemo(
    () => ({
      columns: colLayout.columns,
      frozen: colLayout.frozen,
      widths: colLayout.widths,
      rowHeight: ROW_HEIGHTS[rowHeightName],
      tall: rowHeightName === "tall",
      colors: config.colors ?? [],
      onWidth: (key, w) => auto.change({ widths: { ...(auto.config.widths ?? {}), [key]: w } }),
      onMove: (key, to) => {
        // `to` is a position among the visible columns; the saved order lists every column.
        const order = fullOrder(auto.config, table.columns);
        const visible = layoutColumns(auto.config, table.columns).columns;
        const target = visible[to]?.key;
        auto.change({ order: moveColumn(order, key, target ? order.indexOf(target) : order.length) });
      },
      onHeaderAction: (key, action) => {
        const c = auto.config;
        const visible = layoutColumns(c, table.columns).columns;
        const at = visible.findIndex((x) => x.key === key);
        if (action === "freeze") auto.change({ frozen: at + 1 });
        else if (action === "unfreeze") auto.change({ frozen: undefined });
        else if (action === "hide") {
          if (visible.length > 1) auto.change({ hidden: [...(c.hidden ?? []), key] });
        } else if (action === "group") auto.change({ group: [{ field: key, dir: "asc" }] });
        else auto.change({ sort: [{ field: key, dir: action, nulls: "last" }, ...(c.sort ?? []).filter((s) => s.field !== key)].slice(0, 5) });
      },
    }),
    [auto, colLayout, config.colors, rowHeightName, table.columns],
  );

  const cleanDead = () => {
    const { config: ok } = pruneConfig(auto.config, table.columns);
    const patch: Record<string, unknown> = {};
    for (const k of ["filter", "sort", "group", "group_aggs", "colors", "time_filter"] as const) if (JSON.stringify(ok[k]) !== JSON.stringify(auto.config[k])) patch[k] = ok[k];
    auto.change(patch);
  };

  const sig = `${table.id}:${columnsSignature(table)}:${querySignature(query)}`;
  const saveText = auto.status === "saving" ? "Đang lưu view…" : auto.status === "saved" ? "Đã lưu view" : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <ViewTabs tableId={table.id} views={views} currentId={view.id} access={table.access} onSelect={onSelect} currentConfig={config} />
      <ViewTools columns={table.columns} config={config} dead={dead} change={change} search={search} onSearch={setSearch} onCleanDead={cleanDead} />
      <p className="-mt-1 min-h-4 text-xs text-muted-foreground" aria-live="polite">
        {saveText}
        {saveText && view.shared && table.access !== "owner" ? " (chỉ cho bạn)" : ""}
      </p>
      <LoadedTable key={sig} table={table} query={query} gridView={gridView} searching={search.trim() !== ""} onClearFilters={() => { setSearch(""); auto.change({ filter: undefined, time_filter: undefined }); }} />
    </div>
  );
}

function LoadedTable({ table, query, gridView, searching, onClearFilters }: { table: TableDetail; query: SessionQuery; gridView: GridView; searching: boolean; onClearFilters: () => void }) {
  // One session per table layout and query (`key` in ViewBody). Started and stopped by an effect: StrictMode runs it twice in development.
  const [session] = useState(() => new TableSession(table, query));
  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);
  return <OpenTable table={table} session={session} gridView={gridView} filtered={searching || !!query.filter || !!query.timeFilter} onClearFilters={onClearFilters} />;
}

function OpenTable({ table, session, gridView, filtered, onClearFilters }: { table: TableDetail; session: TableSession; gridView: GridView; filtered: boolean; onClearFilters: () => void }) {
  const qc = useQueryClient();
  const level: Level = table.access;
  const store = session.store;
  useSyncExternalStore(store.subscribe, store.getVersion);
  useSyncExternalStore(session.subscribeLayout, session.getLayoutVersion);
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
        void session.syncAll(from, to);
      }, 250);
    };
    liveBus.addEventListener("signal", onSignal);
    return () => {
      liveBus.removeEventListener("signal", onSignal);
      if (timer) clearTimeout(timer);
    };
  }, [table.id, session, qc]);

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
  const total = store.count;
  const columnsEmpty = table.columns.length === 0;
  const empty = store.known && total === 0 && store.status === "ready";

  let body: React.ReactNode;
  if (columnsEmpty) {
    body = <EmptyState title="Bảng chưa có cột" hint={level === "owner" ? "Thêm cột để bắt đầu nhập dữ liệu." : "Chủ datahub chưa thêm cột nào."} />;
  } else if (store.status === "error" && !store.known) {
    body = <ErrorState error={store.error} onRetry={() => void store.reload().catch(() => undefined)} />;
  } else if (session.grouped && session.groupsStatus === "error" && !session.layout) {
    body = <ErrorState error={session.groupsError} onRetry={() => void session.loadGroups()} title="Không tải được các nhóm" />;
  } else if (!store.known || (session.grouped && !session.layout)) {
    body = <GridSkeleton />;
  } else if (empty && filtered) {
    body = <EmptyState title="Không có dòng nào khớp" hint="Bộ lọc, khoảng thời gian hoặc từ khoá của view đang loại hết các dòng." action={<Button variant="secondary" onClick={onClearFilters}>Xoá bộ lọc</Button>} />;
  } else if (empty) {
    body = (
      <EmptyState
        title="Bảng chưa có dòng nào"
        hint={canWrite ? "Thêm dòng đầu tiên, hoặc dán dữ liệu từ Excel hay Google Sheets." : "Người có quyền sửa chưa thêm dòng nào."}
        action={canWrite ? <Button onClick={() => void addRow()}><Plus size={16} aria-hidden /> Thêm dòng đầu tiên</Button> : undefined}
      />
    );
  } else {
    body = <TableGrid session={session} level={level} view={gridView} apiRef={apiRef} onOpenRow={setOpenRow} onSelection={(ids, active) => setSel({ ids, active })} onAddRow={addRow} />;
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
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground" aria-live="polite">
          {saving > 0 ? <span>Đang lưu...</span> : null}
          {!columnsEmpty && store.known && <span>{formatCount(total, "dòng")}</span>}
        </div>
      </div>
      {session.grouped && session.groupsTruncated && (
        <p role="status" className="rounded-md bg-warn/15 px-3 py-2 text-sm">Có hơn 1.000 nhóm nên chỉ hiện 1.000 nhóm đầu. Lọc bớt dòng hoặc chọn cột nhóm khác.</p>
      )}
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
