import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { formatCount } from "@soe/shared";
import { Flame, GitCompare, RefreshCw, ChevronsDownUp, ChevronsUpDown, Columns3, Copy, Download, Maximize2, MoreHorizontal, Trash, Pencil, Plus, Redo2, Trash2, Undo2, Upload } from "lucide-react";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ErrorText, errorMessage, Field, Input, Modal, Select } from "@/components/ui/form";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/dropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { createView, dhKeys, fetchRowsByIds, getDatahub, getTable, lookupPeople, listViews, rememberView, updateView } from "@/lib/datahub/api";
import { nameKey, optionsOf, parseCellText, readOnlyReason, type Parsed } from "@/lib/datahub/cells";
import { TableSession } from "@/lib/datahub/session";
import type { Column, Level, TableDetail } from "@/lib/datahub/types";
import { ViewAutosave } from "@/lib/datahub/view-autosave";
import { buildQuery, DEFAULT_ROW_HEIGHT, fullOrder, layoutColumns, moveColumn, normalizeConfig, pruneConfig, querySignature, ROW_HEIGHTS, type ColorRule, type SessionQuery, type ViewConfig, type ViewDto } from "@/lib/datahub/view-config";
import { cn } from "@/lib/utils";
import { can, liveBus, useMe, type LiveSignal } from "@/lib/session";
import { useUrlState } from "@/lib/use-url-state";
import { followsPeriod, overlayQuery, QUICK_LABEL, quickAvailable, TableMenuExtraContext, useSharedPeriod, useSharedPeriodControl, type QuickView } from "@/lib/datahub/deal-view";
import { PeriodButton, type PeriodScope } from "@/pages/deal/period-bar";import { PolicyDiffDialog } from "@/pages/deal/policy-diff";
import { canAddColumnHere, canEditColumnHere, isTemplateTable, layerLabel, templatePageUrl } from "@/lib/datahub/template-ui";
import { TableGrid, type GridApi } from "./grid";
import { PersonPicker, RatingPicker } from "./pickers";
import { ColumnEditor } from "./column-editor";
import { ColumnManager, useColumnDelete } from "./column-manager";
import { DuplicatesDialog } from "./duplicates-dialog";
import { ExportDialog } from "./export-dialog";
import { ImportDialog } from "./import-dialog";
import { MergeBar } from "./merge-status";
import { RowPanel } from "./row-panel";
import { TableTrashDialog } from "./trash";
import { ViewSwitcher } from "./view-tabs";
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

export function GridSkeleton() {
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
  /** Only the owner changes the structure: the header menu shows "Sửa cột" and "Xoá cột" when this is set. */
  canEditColumns: boolean;
  /** May this person change this column from the table (an ordinary table: its owner; a template table: only the person's own columns). */
  canEditColumn: (c: Column) => boolean;
  /** Tag drawn on the header of a template table column (`Mẫu`, `Riêng`...). */
  layerTag: (c: Column) => string | null;
  /** The column belongs to a template this person may edit: "Sửa trong template". */
  inTemplate: (c: Column) => boolean;
  /** Saves which groups are closed in the view (a person who only views gets their own copy, as with every view change). */
  onGroupState: (s: { collapsed: boolean; toggled: string[] }) => void;
  initialGroups: { collapsed: boolean; toggled: string[] };
  onHeaderAction: (key: string, action: "freeze" | "unfreeze" | "hide" | "asc" | "desc" | "group" | "edit" | "delete" | "template") => void;
}

const VIEW_URL = { view: "" };

/** Owns the current view: which one is open (the address keeps it), its settings (saved as they change) and the session of rows it reads. */
function ViewHost({ table, data }: { table: TableDetail; data: { views: ViewDto[]; last_view_id: string | null } }) {
  const qc = useQueryClient();
  // The open view lives in the address (?view=<id>): a link sent to someone opens the same view; the table is in the path.
  const [{ view: urlView }, setUrl] = useUrlState(VIEW_URL);
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
    setUrl({ view: id });
    void rememberView(table.id, id).catch(() => undefined);
  }} />;
}

function ViewBody({ table, views, view, onSelect }: { table: TableDetail; views: ViewDto[]; view: ViewDto; onSelect: (id: string) => void }) {
  const qc = useQueryClient();
  const auto = useMemo(
    () =>
      new ViewAutosave(normalizeConfig(view.config, table.columns), {
        save: async (patch) => {
          const v = await updateView(view.id, { config: patch });
          qc.setQueryData<{ views: ViewDto[]; last_view_id: string | null }>(dhKeys.views(table.id), (old) => (old ? { ...old, views: old.views.map((x) => (x.id === v.id ? v : x)) } : old));
          return normalizeConfig(v.config, table.columns);
        },
        onError: async (e) => notify.error(`Không lưu được thay đổi của view. ${errorMessage(e)}`),
      }),
    // One autosave per open view (the body is keyed by the view id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useSyncExternalStore(auto.subscribe, auto.getVersion);
  useEffect(() => auto.adopt(normalizeConfig(view.config, table.columns)), [auto, view.config, table.columns]);
  useEffect(() => () => void auto.flush(), [auto]);

  const config = auto.config;
  const [dupOpen, setDupOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Rows added by the import (made by the worker) are not part of what the open grid knows: after an import it reads the table again.
  const [reloadKey, setReloadKey] = useState(0);
  const [trashOpen, setTrashOpen] = useState(false);
  const [rowSlot, setRowSlot] = useState<HTMLElement | null>(null);
  // Undo and redo live in the "..." menu; the open grid publishes its state here (Ctrl+Z still works in the grid).
  const [undoApi, setUndoApi] = useState<UndoApi | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [colUI, setColUI] = useState<{ kind: "manage" } | { kind: "add" } | { kind: "edit"; col: Column } | null>(null);
  const deleteCol = useColumnDelete(table);
  const meQ = useMe();
  const me = meQ.data;
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 350);
  const { dead } = useMemo(() => pruneConfig(config, table.columns), [config, table.columns]);
  const shared = useSharedPeriod();
  const periodControl = useSharedPeriodControl();
  const menuExtra = useContext(TableMenuExtraContext);
  // A morning digest links here with `?quick=priority`.
  const urlQuick = (useSearch({ strict: false }) as { quick?: string }).quick;
  const [quick, setQuick] = useState<QuickView | null>(urlQuick === "priority" || urlQuick === "recheck" ? urlQuick : null);
  const query = useMemo(() => overlayQuery(buildQuery(config, table.columns, debounced), table, config, shared, quick), [config, table, debounced, shared, quick]);
  const colLayout = useMemo(() => layoutColumns(config, table.columns), [config, table.columns]);
  const rowHeightName = config.row_height ?? DEFAULT_ROW_HEIGHT;
  const nav = useNavigate();
  // The name of the Leader on a `Mẫu · Team <tên>` tag.
  const teamLeaders = useMemo(() => [...new Set(table.columns.filter((c) => c.layer === "team" && c.layer_ref).map((c) => c.layer_ref!))], [table.columns]);
  const leadersQ = useQuery({ queryKey: ["dh-team-leaders", teamLeaders.join(",")], queryFn: () => lookupPeople({ ids: teamLeaders }), enabled: teamLeaders.length > 0, staleTime: 60_000 });
  const leaderNames = useMemo(() => new Map((leadersQ.data ?? []).map((p) => [p.id, p.full_name] as const)), [leadersQ.data]);

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
      onGroupState: (s) => auto.change({ groups_collapsed: s.collapsed || undefined, groups_toggled: s.toggled.length ? s.toggled : undefined }),
      initialGroups: { collapsed: auto.config.groups_collapsed === true, toggled: auto.config.groups_toggled ?? [] },
      canEditColumns: table.access === "owner" || isTemplateTable(table),
      canEditColumn: (c) => canEditColumnHere(table, c, me?.user.id),
      layerTag: (c) => layerLabel(c, table, c.layer === "team" && c.layer_ref ? leaderNames.get(c.layer_ref) : undefined),
      inTemplate: (c) => isTemplateTable(table) && c.layer !== "custom" && can(me, "datahub:template:write"),
      onHeaderAction: (key, action) => {
        if (action === "template") {
          if (table.template_id) void nav({ href: templatePageUrl(table.template_id, key) });
          return;
        }
        if (action === "edit" || action === "delete") {
          const target = table.columns.find((x) => x.key === key);
          if (!target || !canEditColumnHere(table, target, me?.user.id)) return;
          if (action === "edit") setColUI({ kind: "edit", col: target });
          else void deleteCol(target);
          return;
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auto, colLayout, config.colors, rowHeightName, table.columns, table.access, table.template_id, me, leaderNames],
  );

  const cleanDead = () => {
    const { config: ok } = pruneConfig(auto.config, table.columns);
    const patch: Record<string, unknown> = {};
    for (const k of ["filter", "sort", "group", "group_aggs", "colors", "time_filter"] as const) if (JSON.stringify(ok[k]) !== JSON.stringify(auto.config[k])) patch[k] = ok[k];
    auto.change(patch);
  };

  const merged = table.kind === "merged";
  // A merged table is read-only for everyone: its rows are copied by the worker (design module3 section 4.3).
  const canEditData = !merged && (table.access === "owner" || table.access === "edit_data");
  // The owner may switch "Thành viên được thêm dòng hàng loạt" off: members then cannot import or paste new rows.
  const canBulk = table.access === "owner" || table.members_bulk_create !== false;
  // The "..." menu: what is used now and then. Two groups: the data (import, export, duplicates, trash) and the structure (columns).
  const dataActions = [
    { key: "import", label: "Nhập", icon: <Upload size={16} aria-hidden />, run: () => setImportOpen(true), show: canEditData && canBulk },
    { key: "export", label: "Xuất", icon: <Download size={16} aria-hidden />, run: () => setExportOpen(true), show: true },
    { key: "dup", label: "Tìm dòng trùng", icon: <Copy size={16} aria-hidden />, run: () => setDupOpen(true), show: canEditData },
    { key: "trash", label: "Thùng rác", icon: <Trash size={16} aria-hidden />, run: () => setTrashOpen(true), show: canEditData },
  ].filter((a) => a.show);
  const structureActions = [
    { key: "cols", label: "Cột của bảng", icon: <Columns3 size={16} aria-hidden />, run: () => setColUI({ kind: "manage" }), disabled: false, show: true },
    { key: "add", label: "Thêm cột", icon: <Plus size={16} aria-hidden />, run: () => setColUI({ kind: "add" }), disabled: table.columns.length >= table.max_columns, show: canAddColumnHere(table) },
    { key: "policy", label: "So sánh phiên bản", icon: <GitCompare size={16} aria-hidden />, run: () => setPolicyOpen(true), disabled: false, show: table.role_set === "com_policy" && can(me, "deal:policy:write") },
  ].filter((a) => a.show);
  const sig = `${table.id}:${columnsSignature(table)}:${querySignature(query)}:${reloadKey}`;
  const saveText = auto.status === "saving" ? "Đang lưu view…" : auto.status === "saved" ? "Đã lưu view" : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {merged && <MergeBar table={table} />}
      <ViewTools
        columns={table.columns}
        config={config}
        dead={dead}
        change={change}
        search={search}
        onSearch={setSearch}
        onCleanDead={cleanDead}
        rowSlotRef={setRowSlot}
        lead={<ViewSwitcher tableId={table.id} views={views} currentId={view.id} access={table.access} onSelect={onSelect} currentConfig={config} />}
        period={
          shared && periodControl && followsPeriod(table) ? (
            <PeriodButton state={periodControl} scope={table.role_set as PeriodScope} showRule={table.role_set === "deals"} follow={{ checked: !config.own_period, onChange: (v) => change({ own_period: v ? undefined : true }) }} />
          ) : null
        }
        extra={
          quickAvailable(table) ? (
            <>
              {(["priority", "recheck"] as const).map((k) => (
                <Button key={k} variant="secondary" aria-label={QUICK_LABEL[k]} title={QUICK_LABEL[k]} aria-pressed={quick === k} data-testid={`quick-${k}`} className={cn("shrink-0 sm:!min-h-7 !text-xs", quick === k && "!border-primary-border !bg-primary-soft !text-primary")} onClick={() => setQuick(quick === k ? null : k)}>{k === "priority" ? <Flame size={14} aria-hidden /> : <RefreshCw size={14} aria-hidden />}<span className="hidden @[76rem]:inline" aria-hidden>{QUICK_LABEL[k]}</span></Button>
              ))}
            </>
          ) : null
        }
        more={
          <Menu trigger={<Button variant="ghost" aria-label="Thêm thao tác" title="Thêm thao tác" className="shrink-0 !px-2.5 !text-xs sm:!min-h-7 sm:!py-0"><MoreHorizontal size={16} aria-hidden /></Button>}>
            {undoApi && (
              <>
                <MenuItem disabled={!undoApi.canUndo} onSelect={() => undoApi.run(false)}><Undo2 size={16} aria-hidden /> Hoàn tác <span aria-hidden className="ml-auto pl-4 text-xs text-muted-foreground">Ctrl+Z</span></MenuItem>
                <MenuItem disabled={!undoApi.canRedo} onSelect={() => undoApi.run(true)}><Redo2 size={16} aria-hidden /> Làm lại <span aria-hidden className="ml-auto pl-4 text-xs text-muted-foreground">Ctrl+Shift+Z</span></MenuItem>
                <MenuSeparator />
              </>
            )}
            {dataActions.map((a) => <MenuItem key={a.key} onSelect={a.run}>{a.icon} {a.label}</MenuItem>)}
            {dataActions.length > 0 && structureActions.length > 0 && <MenuSeparator />}
            {structureActions.map((a) => <MenuItem key={a.key} disabled={a.disabled} onSelect={a.run}>{a.icon} {a.label}</MenuItem>)}
            {menuExtra && (
              <>
                <MenuSeparator />
                {menuExtra}
              </>
            )}
          </Menu>
        }
      />
      {view.shared && table.access !== "owner" && view.has_override && (
        <p className="text-xs text-muted-foreground">Bạn đang xem bản riêng của view này; thay đổi của bạn không ảnh hưởng người khác. Chọn "Về mặc định" trong menu view để bỏ.</p>
      )}
      {policyOpen && <PolicyDiffDialog onClose={() => setPolicyOpen(false)} />}
      {trashOpen && <TableTrashDialog tableId={table.id} onClose={() => setTrashOpen(false)} onRestored={() => { void qc.invalidateQueries({ queryKey: dhKeys.table(table.id) }); }} />}
      {dupOpen && <DuplicatesDialog table={table} onClose={() => setDupOpen(false)} />}
      {exportOpen && <ExportDialog table={table} query={query} visible={colLayout.columns} filtered={!!(query.filter || query.search || query.timeFilter || colLayout.columns.length < table.columns.length)} onClose={() => setExportOpen(false)} />}
      {importOpen && <TableImport table={table} onClose={() => setImportOpen(false)} onImported={() => setReloadKey((k) => k + 1)} />}
      {colUI?.kind === "manage" && <ColumnManager table={table} level={table.access} onClose={() => setColUI(null)} onAdd={() => setColUI({ kind: "add" })} onEdit={(c) => setColUI({ kind: "edit", col: c })} onDelete={(c) => { setColUI(null); void deleteCol(c); }} />}
      {colUI?.kind === "add" && <ColumnEditor table={table} onClose={() => setColUI(null)} />}
      {colUI?.kind === "edit" && <ColumnEditor key={colUI.col.id} table={table} column={colUI.col} onClose={() => setColUI(null)} />}
      <LoadedTable key={sig} table={table} query={query} gridView={gridView} rowSlot={rowSlot} onUndoApi={setUndoApi} statusText={saveText ? `${saveText}${saveText && view.shared && table.access !== "owner" ? " (chỉ cho bạn)" : ""}` : ""} searching={search.trim() !== ""} onClearFilters={() => { setSearch(""); auto.change({ filter: undefined, time_filter: undefined }); }} />
    </div>
  );
}

/**
 * `rowSlot`: the node of the page toolbar the row actions (add row, undo, selection) are portaled into. `undefined` (a page with no
 * toolbar of its own) draws them in a line above the grid; `null` is the toolbar not mounted yet. `statusText`: the view-saving text of the footer line.
 */
/** What the "..." menu needs of the open grid for undo and redo. */
export interface UndoApi {
  canUndo: boolean;
  canRedo: boolean;
  run: (redo: boolean) => void;
}

export function LoadedTable({ table, query, gridView, searching, onClearFilters, rowSlot, statusText, onUndoApi }: { table: TableDetail; query: SessionQuery; gridView: GridView; searching: boolean; onClearFilters: () => void; rowSlot?: HTMLElement | null; statusText?: string; onUndoApi?: (a: UndoApi | null) => void }) {
  // One session per table layout and query (`key` in ViewBody). Started and stopped by an effect: StrictMode runs it twice in development.
  const [session] = useState(() => {
    const s = new TableSession(table, query);
    s.setGroupState(gridView.initialGroups);
    return s;
  });
  const saveGroups = gridView.onGroupState;
  useEffect(() => {
    session.bindGroupState(saveGroups);
  }, [session, saveGroups]);
  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);
  return <OpenTable table={table} session={session} gridView={gridView} filtered={searching || !!query.filter || !!query.timeFilter} onClearFilters={onClearFilters} rowSlot={rowSlot} statusText={statusText} onUndoApi={onUndoApi} />;
}

function OpenTable({ table, session, gridView, filtered, onClearFilters, rowSlot, statusText, onUndoApi }: { table: TableDetail; session: TableSession; gridView: GridView; filtered: boolean; onClearFilters: () => void; rowSlot?: HTMLElement | null; statusText?: string; onUndoApi?: (a: UndoApi | null) => void }) {
  const qc = useQueryClient();
  // A merged table is read-only for everyone, its owner included.
  const level: Level = table.kind === "merged" ? "view" : table.access;
  const store = session.store;
  useSyncExternalStore(store.subscribe, store.getVersion);
  useSyncExternalStore(session.subscribeLayout, session.getLayoutVersion);
  const undo = session.undo;
  useSyncExternalStore(undo.subscribe, () => `${undo.canUndo}-${undo.canRedo}`);
  const saving = useSyncExternalStore(session.onSaving, () => session.saving);

  const apiRef = useRef<GridApi | null>(null);
  const [sel, setSel] = useState<{ ids: string[]; active: string | null }>({ ids: [], active: null });
  const [openRow, setOpenRow] = useState<string | null>(null);
  // `?row=<id>` (links of the close-period screen): open that row once, whatever filter the view has.
  const wantedRow = (useSearch({ strict: false }) as { row?: string }).row;
  const openedWanted = useRef<string | null>(null);
  useEffect(() => {
    if (!wantedRow || openedWanted.current === wantedRow) return;
    openedWanted.current = wantedRow;
    void fetchRowsByIds(table.id, [wantedRow]).then((rows) => {
      if (rows[0]) { session.store.adopt(rows[0]); setOpenRow(rows[0].id); }
    }).catch(() => undefined);
  }, [wantedRow, table.id, session]);
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

  const canUndoNow = undo.canUndo;
  const canRedoNow = undo.canRedo;
  const undoRef = useRef(doUndo);
  useEffect(() => {
    undoRef.current = doUndo;
  });
  useEffect(() => {
    if (!onUndoApi || level === "view") return;
    onUndoApi({ canUndo: canUndoNow, canRedo: canRedoNow, run: (redo) => void undoRef.current(redo) });
  }, [onUndoApi, level, canUndoNow, canRedoNow]);
  useEffect(() => () => onUndoApi?.(null), [onUndoApi]);

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
        action={canWrite ? <Button variant="secondary" onClick={() => void addRow()}><Plus size={16} aria-hidden /> Thêm dòng đầu tiên</Button> : undefined}
      />
    );
  } else {
    body = <TableGrid session={session} level={level} view={gridView} apiRef={apiRef} onOpenRow={setOpenRow} onSelection={(ids, active) => setSel({ ids, active })} onAddRow={addRow} />;
  }

  // What belongs to the rows: add a row (the one main button of the screen), undo and redo, actions on the selection, the groups.
  const rowTools = (
    <>
      {canWrite && (
        <>
          <Button onClick={() => void addRow()} disabled={columnsEmpty} className="shrink-0 !text-xs sm:!min-h-7 sm:!py-0"><Plus size={16} aria-hidden /> Thêm dòng</Button>
        </>
      )}
      {sel.ids.length > 0 && canWrite && (
        <>
          <Button variant="ghost" aria-label={`Sửa ${formatCount(sel.ids.length, "dòng")}`} title={`Sửa ${formatCount(sel.ids.length, "dòng")}`} className="shrink-0 !bg-primary-soft !text-primary !text-xs sm:!min-h-7 sm:!py-0" onClick={() => setBulk(true)}><Pencil size={16} aria-hidden /><span aria-hidden className="text-xs font-semibold @[64rem]:hidden">{sel.ids.length}</span><span aria-hidden className="hidden @[64rem]:inline">Sửa {formatCount(sel.ids.length, "dòng")}</span></Button>
          <Button variant="ghost" aria-label={`Xoá ${formatCount(sel.ids.length, "dòng")}`} title={`Xoá ${formatCount(sel.ids.length, "dòng")}`} className="shrink-0 !text-bad !text-xs sm:!min-h-7 sm:!py-0" onClick={() => void deleteSelected()}><Trash2 size={16} aria-hidden /><span aria-hidden className="text-xs font-semibold @[64rem]:hidden">{sel.ids.length}</span><span aria-hidden className="hidden @[64rem]:inline">Xoá {formatCount(sel.ids.length, "dòng")}</span></Button>
        </>
      )}
      {(sel.active || sel.ids.length === 1) && (
        <Tip label="Chi tiết dòng (bấm số thứ tự, hoặc Shift + Space)">
          <Button variant="ghost" aria-label="Chi tiết dòng" className="shrink-0 !px-2 !text-xs sm:!min-h-7 sm:!py-0" onClick={() => setOpenRow(sel.ids.length === 1 ? sel.ids[0]! : sel.active)}><Maximize2 size={16} aria-hidden /></Button>
        </Tip>
      )}
      {session.grouped && (
        <>
          <Button variant="ghost" className="shrink-0 !px-2" title="Thu gọn tất cả nhóm" aria-label="Thu gọn tất cả" onClick={() => session.setAllCollapsed(true)} data-testid="groups-collapse-all"><ChevronsDownUp size={16} aria-hidden /></Button>
          <Button variant="ghost" className="shrink-0 !px-2" title="Mở tất cả nhóm" aria-label="Mở tất cả" onClick={() => session.setAllCollapsed(false)} data-testid="groups-expand-all"><ChevronsUpDown size={16} aria-hidden /></Button>
        </>
      )}
      {!canWrite && <Badge tone="muted">Chỉ xem</Badge>}
    </>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" onKeyDown={onKeyDown}>
      {rowSlot === undefined ? <div role="toolbar" aria-label="Công cụ bảng" className="flex flex-wrap items-center gap-2">{rowTools}</div> : rowSlot ? createPortal(rowTools, rowSlot) : null}
      {session.grouped && session.groupsTruncated && (
        <p role="status" className="rounded-md bg-warn/15 px-3 py-2 text-sm">Có hơn 1.000 nhóm nên chỉ hiện 1.000 nhóm đầu. Lọc bớt dòng hoặc chọn cột nhóm khác.</p>
      )}
      {body}
      <div className="flex min-h-4 flex-wrap items-center gap-x-3 text-xs text-muted-foreground" aria-live="polite">
        {!columnsEmpty && store.known && <span>{formatCount(total, "dòng")}</span>}
        {saving > 0 ? <span>Đang lưu...</span> : null}
        {statusText ? <span>{statusText}</span> : null}
      </div>
      {openRow && <RowPanel session={session} rowId={openRow} level={level} onClose={() => setOpenRow(null)} onNavigate={setOpenRow} />}
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
      return <PersonPicker tableId={session.table.id} value={typeof picked === "string" ? picked : null} valueName={typeof picked === "string" ? session.labels.people.get(picked) : undefined} autoFocus={false} onDone={(p) => { if (p) session.labels.learnPerson(p.id, p.full_name, p.email); setPicked(p?.id ?? null); }} />;
    default:
      return (
        <Field label="Giá trị" hint={col.type === "date" ? "Dạng dd/mm/yyyy." : col.type === "datetime" ? "Dạng dd/mm/yyyy hh:mm." : col.type === "percent" ? "Ví dụ 12,5%." : "Để trống để xoá giá trị."}>
          <Input value={text} onChange={(e) => setText(e.target.value)} inputMode={["number", "currency", "percent"].includes(col.type) ? "decimal" : undefined} autoComplete="off" />
        </Field>
      );
  }
}

/** The import wizard opened from a table: the datahub's tables are the targets, the open table is the first sheet's default. */
function TableImport({ table, onClose, onImported }: { table: TableDetail; onClose: () => void; onImported: () => void }) {
  const dh = useQuery({ queryKey: dhKeys.datahub(table.datahub_id), queryFn: () => getDatahub(table.datahub_id) });
  if (!dh.data) return null;
  return <ImportDialog target={{ datahub: { id: dh.data.id, name: dh.data.name, access: dh.data.access, tables: dh.data.tables.map((t) => ({ id: t.id, name: t.name })) }, table: { id: table.id, name: table.name } }} onClose={onClose} onImported={onImported} />;
}
