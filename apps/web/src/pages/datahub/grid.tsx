import { CompactSelection, DataEditor, GridCellKind, type DataEditorRef, type GridCell, type GridColumn, type GridSelection, type Item, type Rectangle, type Theme } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { formatCount, formatNumber } from "@soe/shared";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { notify } from "@/components/ui/toast";
import { cellError, cellValue, displayText, editText, ERROR_HELP, nameKey, optionsOf, parseCellText, readOnlyReason, typeOf, type CellCtx } from "@/lib/datahub/cells";
import { planPaste } from "@/lib/datahub/paste";
import type { CellEdit, TableSession } from "@/lib/datahub/session";
import type { Column, Level, Row } from "@/lib/datahub/types";
import { FONT_STACK, fontsReady, token } from "@/lib/theme";
import { isInsidePopup, soeRenderer, type SoeCell } from "./grid-cells";

const ROW_HEIGHT = 36;
const MARKER_WIDTH = 56;
const NUMERIC = new Set(["number", "currency", "percent", "auto_number", "row_id"]);

function defaultWidth(col: Column): number {
  switch (typeOf(col)) {
    case "checkbox":
      return 96;
    case "rating":
      return 120;
    case "number":
    case "currency":
    case "percent":
    case "auto_number":
    case "row_id":
      return 140;
    case "date":
      return 130;
    case "datetime":
    case "created_time":
    case "modified_time":
      return 160;
    case "long_text":
      return 260;
    default:
      return 190;
  }
}

function gridTheme(): Partial<Theme> {
  return {
    accentColor: token("--primary"),
    accentFg: token("--primary-foreground"),
    accentLight: token("--selected"),
    textDark: token("--foreground"),
    textMedium: token("--primary"),
    textLight: token("--muted-foreground"),
    textHeader: token("--foreground"),
    textHeaderSelected: token("--primary-foreground"),
    bgCell: token("--card"),
    bgCellMedium: token("--muted"),
    bgHeader: token("--muted"),
    bgHeaderHasFocus: token("--selected"),
    bgHeaderHovered: token("--selected"),
    bgIconHeader: token("--muted-foreground"),
    fgIconHeader: token("--card"),
    bgBubble: token("--muted"),
    bgBubbleSelected: token("--selected"),
    textBubble: token("--foreground"),
    borderColor: token("--border"),
    horizontalBorderColor: token("--border"),
    drilldownBorder: token("--border"),
    linkColor: token("--primary"),
    cellHorizontalPadding: 8,
    cellVerticalPadding: 4,
    headerFontStyle: "600 14px",
    baseFontStyle: "14px",
    markerFontStyle: "12px",
    fontFamily: FONT_STACK,
    editorFontSize: "14px",
    lineHeight: 1.5,
    roundingRadius: 4,
  };
}

interface Tip {
  x: number;
  y: number;
  text: string;
  /** Version of the rows when the tip was made. */
  v: number;
}

export interface GridApi {
  /** Rows currently selected by their row marker, in table order. */
  selectedRowIds: () => string[];
  /** The row of the active cell. */
  activeRowId: () => string | null;
  scrollToRow: (index: number) => void;
  /** First and last row index on screen. */
  visibleRange: () => [number, number];
}

export function TableGrid({ session, level, onOpenRow, onSelection, apiRef, onAddRow }: { session: TableSession; level: Level; onOpenRow: (rowId: string) => void; onSelection: (rowIds: string[], activeRowId: string | null) => void; apiRef: React.MutableRefObject<GridApi | null>; onAddRow: () => Promise<void> }) {
  const { store, labels, table } = session;
  useSyncExternalStore(store.subscribe, store.getVersion);
  const [labelVersion, setLabelVersion] = useState(0);
  useEffect(() => labels.subscribe(() => setLabelVersion((v) => v + 1)), [labels]);

  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void fontsReady().then(() => live && setReady(true));
    return () => void (live = false);
  }, []);
  const theme = useMemo(() => (ready ? gridTheme() : undefined), [ready]);

  const columns = table.columns;
  const canWrite = level !== "view";
  const [widths, setWidths] = useState<Record<string, number>>({});
  const gridColumns: GridColumn[] = useMemo(() => columns.map((c) => ({ id: c.id, title: c.name, width: widths[c.id] ?? defaultWidth(c) })), [columns, widths]);

  const ref = useRef<DataEditorRef>(null);
  const visible = useRef<Rectangle>({ x: 0, y: 0, width: 0, height: 0 });
  const [selection, setSelection] = useState<GridSelection>({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
  const [tip, setTip] = useState<Tip | null>(null);

  const ctx: CellCtx = useMemo(() => ({ people: labels.people, linked: labels.linked }), [labels]);
  // Names of people already known, for pasting a name into a user column.
  const peopleByName = useCallback(() => new Map([...labels.people].filter(([, n]) => n !== "—" && n !== "…").map(([id, n]) => [nameKey(n), id] as const)), [labels]);

  // ---- reading cells ----------------------------------------------------------------------------------------------
  const getCellContent = useCallback(
    ([c, r]: Item): GridCell => {
      const col = columns[c];
      const row = store.rowAt(r);
      if (!col || !row) {
        if (!row && r < store.count) void store.ensure(r);
        return { kind: GridCellKind.Loading, allowOverlay: false };
      }
      const reason = readOnlyReason(col, level);
      const ro = !canWrite || reason !== null;
      const v = cellValue(col, row);
      const type = typeOf(col);
      const err = cellError(col, v);
      const text = displayText(col, row, ctx);
      if (err) return { kind: GridCellKind.Text, data: err, displayData: err, allowOverlay: true, readonly: true, contentAlign: "right", copyData: err, themeOverride: { textDark: token("--bad") } };

      switch (type) {
        case "checkbox":
          return { kind: GridCellKind.Boolean, data: v === true, allowOverlay: false, readonly: ro, copyData: text };
        case "single_select":
        case "multi_select": {
          const ids = Array.isArray(v) ? (v as string[]) : typeof v === "string" ? [v] : [];
          const cell: SoeCell = { kind: GridCellKind.Custom, allowOverlay: !ro, copyData: text === "—" ? "" : text, data: { t: "select", ids, options: optionsOf(col), multi: type === "multi_select", readonly: ro } };
          return cell;
        }
        case "rating": {
          const cell: SoeCell = { kind: GridCellKind.Custom, allowOverlay: !ro, copyData: typeof v === "number" ? String(v) : "", data: { t: "rating", value: typeof v === "number" ? v : null, max: col.config.max ?? 5, readonly: ro } };
          return cell;
        }
        case "user": {
          const id = typeof v === "string" ? v : null;
          if (id) labels.wantPerson(id);
          const name = id ? (labels.people.get(id) ?? "…") : "";
          const cell: SoeCell = { kind: GridCellKind.Custom, allowOverlay: !ro, copyData: name, data: { t: "person", id, name, readonly: ro } };
          return cell;
        }
        case "created_by":
        case "modified_by":
          if (typeof v === "string") labels.wantPerson(v);
          break;
        case "relation":
          if (Array.isArray(v)) v.forEach((id) => labels.wantLinked(col.key, String(id)));
          break;
      }
      return {
        kind: GridCellKind.Text,
        data: editText(col, row),
        displayData: text,
        allowOverlay: true,
        readonly: ro,
        contentAlign: NUMERIC.has(type) ? "right" : undefined,
        copyData: text === "—" ? "" : text,
      };
    },
    // labelVersion makes a redraw pick up names that arrived later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, store, level, canWrite, ctx, labels, labelVersion],
  );

  // A tip describes a cell as it was when the pointer arrived; any change of the rows makes it stale (it is then not shown).
  const version = store.version;

  // ---- redraw what is on screen when rows or names change ---------------------------------------------------------
  useEffect(() => {
    const g = ref.current;
    const v = visible.current;
    if (!g || v.width === 0) return;
    const cells: { cell: Item }[] = [];
    for (let r = v.y; r < v.y + v.height; r++) for (let c = v.x; c < v.x + v.width; c++) cells.push({ cell: [c, r] });
    g.updateCells(cells);
  }, [version, labelVersion]);

  // ---- writing ----------------------------------------------------------------------------------------------------
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

  const valueFromCell = useCallback(
    (col: Column, cell: GridCell): { ok: true; value: unknown } | { ok: false; message: string } => {
      if (cell.kind === GridCellKind.Boolean) return { ok: true, value: cell.data === true };
      if (cell.kind === GridCellKind.Custom) {
        const d = (cell as SoeCell).data;
        if (d.t === "select") return { ok: true, value: d.multi ? (d.ids.length ? d.ids : null) : (d.ids[0] ?? null) };
        if (d.t === "rating") return { ok: true, value: d.value };
        return { ok: true, value: d.id };
      }
      if (cell.kind === GridCellKind.Text) return parseCellText(col, cell.data, peopleByName());
      return { ok: false, message: "Không đọc được giá trị này." };
    },
    [peopleByName],
  );

  const onCellEdited = useCallback(
    (cell: Item, newValue: GridCell) => {
      const col = columns[cell[0]];
      const row = store.rowAt(cell[1]);
      if (!col || !row || !canWrite) return;
      const parsed = valueFromCell(col, newValue);
      if (!parsed.ok) {
        notify.error(parsed.message);
        store.patch([row]); // draw the old value again
        return;
      }
      void run(async () => {
        await session.edit([{ rowId: row.id, key: col.key, value: parsed.value }], `Sửa ô "${col.name}"`);
      });
    },
    [columns, store, canWrite, valueFromCell, run, session],
  );

  const onPaste = useCallback(
    (target: Item, values: readonly (readonly string[])[]) => {
      if (!canWrite) {
        notify.error("Bạn chỉ có quyền xem bảng này.");
        return false;
      }
      let matrix = values.map((r) => [...r]);
      // One value pasted over a block of selected cells fills the whole block, as in a spreadsheet.
      const range = selection.current?.range;
      if (matrix.length === 1 && matrix[0]!.length === 1 && range && (range.width > 1 || range.height > 1)) {
        matrix = Array.from({ length: range.height }, () => Array.from({ length: range.width }, () => matrix[0]![0]!));
      }
      const plan = planPaste({ columns, rowAt: store.rowAt, rowCount: store.rows.length, startRow: target[1], startCol: target[0], matrix, level, peopleByName: peopleByName() });
      if (plan.errors.length) {
        const e = plan.errors[0]!;
        notify.error(`Dòng ${e.row}, cột "${e.column}": ${e.message}${plan.errors.length > 1 ? ` (và ${plan.errors.length - 1} ô khác lỗi). Chưa ghi gì.` : " Chưa ghi gì."}`);
        return false;
      }
      if (plan.changes.length === 0) {
        notify.info(plan.skipped ? "Không có ô nào ghi được: các cột này do hệ thống tính." : "Giá trị dán giống hệt giá trị đang có.");
        return false;
      }
      void run(async () => {
        const entries = [];
        let created = 0;
        if (plan.newRows > 0) {
          const values2: Record<string, unknown>[] = Array.from({ length: plan.newRows }, () => ({}));
          for (const ch of plan.changes) if (ch.newIndex !== null) values2[ch.newIndex]![ch.key] = ch.value;
          const res = await session.doCreate(values2, "Dán thêm dòng");
          entries.push(res.entry);
          created = res.rows.length;
        }
        const edits: CellEdit[] = plan.changes.filter((c) => c.rowId).map((c) => ({ rowId: c.rowId!, key: c.key, value: c.value }));
        if (edits.length) {
          const e = await session.doEdits(edits, "Dán vào ô");
          if (e) entries.push(e);
        }
        session.push(entries, "Dán dữ liệu");
        notify.ok(`Đã dán ${formatNumber(plan.changes.length)} ô${created ? `, thêm ${formatCount(created, "dòng")}` : ""}${plan.skipped ? `. Bỏ qua ${formatNumber(plan.skipped)} ô ở cột do hệ thống tính` : ""}`);
      });
      return false;
    },
    [canWrite, columns, level, peopleByName, run, selection, session, store],
  );

  const onFillPattern = useCallback(
    (e: { patternSource: Rectangle; fillDestination: Rectangle; preventDefault: () => void }) => {
      e.preventDefault();
      if (!canWrite) return;
      const src = e.patternSource;
      const dst = e.fillDestination;
      const edits: CellEdit[] = [];
      let skipped = 0;
      for (let r = dst.y; r < dst.y + dst.height; r++) {
        const row = store.rowAt(r);
        if (!row) continue;
        for (let c = dst.x; c < dst.x + dst.width; c++) {
          const col = columns[c];
          if (!col || readOnlyReason(col, level)) {
            skipped++;
            continue;
          }
          const sc = src.x + (((c - src.x) % src.width) + src.width) % src.width;
          const sr = src.y + (((r - src.y) % src.height) + src.height) % src.height;
          const srcCol = columns[sc];
          const srcRow = store.rowAt(sr);
          if (!srcCol || !srcRow) continue;
          if (srcCol.id === col.id) edits.push({ rowId: row.id, key: col.key, value: srcRow.data[col.key] ?? null });
          else {
            const p = parseCellText(col, displayText(srcCol, srcRow, ctx) === "—" ? "" : displayText(srcCol, srcRow, ctx), peopleByName());
            if (p.ok) edits.push({ rowId: row.id, key: col.key, value: p.value });
            else skipped++;
          }
        }
      }
      void run(async () => {
        const n = await session.edit(edits, "Điền xuống");
        if (n) notify.ok(`Đã điền ${formatNumber(n)} ô${skipped ? `. Bỏ qua ${formatNumber(skipped)} ô` : ""}`);
      });
    },
    [canWrite, store, columns, level, ctx, peopleByName, run, session],
  );

  const onDelete = useCallback(
    (sel: GridSelection) => {
      if (!canWrite || !sel.current) return false;
      const edits: CellEdit[] = [];
      for (const rg of [sel.current.range, ...sel.current.rangeStack]) {
        for (let r = rg.y; r < rg.y + rg.height; r++) {
          const row = store.rowAt(r);
          if (!row) continue;
          for (let c = rg.x; c < rg.x + rg.width; c++) {
            const col = columns[c];
            if (col && !readOnlyReason(col, level) && !col.required) edits.push({ rowId: row.id, key: col.key, value: col.type === "checkbox" ? false : null });
          }
        }
      }
      void run(async () => {
        await session.edit(edits, "Xoá nội dung ô");
      });
      return false;
    },
    [canWrite, store, columns, level, run, session],
  );

  // ---- selection, scroll, keyboard ------------------------------------------------------------------------------
  const onGridSelectionChange = useCallback(
    (s: GridSelection) => {
      setSelection(s);
      const ids = s.rows.toArray().map((i) => store.rowAt(i)?.id).filter((x): x is string => !!x);
      const active = s.current ? (store.rowAt(s.current.cell[1])?.id ?? null) : null;
      onSelection(ids, active);
    },
    [onSelection, store],
  );

  useEffect(() => {
    apiRef.current = {
      selectedRowIds: () => selection.rows.toArray().map((i) => store.rowAt(i)?.id).filter((x): x is string => !!x),
      activeRowId: () => (selection.current ? (store.rowAt(selection.current.cell[1])?.id ?? null) : null),
      scrollToRow: (index) => ref.current?.scrollTo(0, index, "vertical", 0, 0, { vAlign: "center" }),
      visibleRange: () => [visible.current.y, visible.current.y + visible.current.height],
    };
  }, [apiRef, selection, store]);

  const onVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      visible.current = range;
      if (range.y + range.height + 40 > store.rows.length) void store.ensure(range.y + range.height).catch(() => undefined);
    },
    [store],
  );

  // Keep following the visible region with sync after someone else's change (see TableView) and while formulas are being calculated.
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      const v = visible.current;
      if (store.pendingIn(v.y, v.y + v.height) > 0 && n++ < 30) void store.sync(v.y, v.y + v.height).catch(() => undefined);
      else n = 0;
    }, 2000);
    return () => clearInterval(t);
  }, [store]);

  // ---- hover tip: error meaning, "calculating", and the full text of a cut cell ----------------------------------
  const onItemHovered = useCallback(
    (args: { kind: string; location: Item; bounds?: Rectangle }) => {
      if (args.kind !== "cell" || !args.bounds) return setTip(null);
      const col = columns[args.location[0]];
      const row = store.rowAt(args.location[1]);
      if (!col || !row) return setTip(null);
      const err = cellError(col, cellValue(col, row));
      let text: string | null = null;
      if (err) text = `${err} ${ERROR_HELP[err] ?? ""}`.trim();
      else if (row.pending?.includes(col.key)) text = "Đang tính lại giá trị này.";
      else {
        const full = displayText(col, row, ctx);
        const w = (widths[col.id] ?? defaultWidth(col)) - 16;
        const c = document.createElement("canvas").getContext("2d");
        if (c && full.length > 3) {
          c.font = `14px ${FONT_STACK}`;
          if (c.measureText(full).width > w) text = full.length > 600 ? `${full.slice(0, 600)}…` : full;
        }
      }
      setTip(text ? { x: args.bounds.x + Math.min(args.bounds.width, 240) / 2, y: args.bounds.y + args.bounds.height + 4, text, v: store.version } : null);
    },
    [columns, store, ctx, widths],
  );

  const drawCell = useCallback(
    (args: { ctx: CanvasRenderingContext2D; col: number; row: number; rect: Rectangle }, draw: () => void) => {
      draw();
      const col = columns[args.col];
      const row = store.rowAt(args.row);
      if (!col || !row?.pending?.includes(col.key)) return;
      // "Calculating": a ring with a gap, top right of the cell.
      const { ctx: c, rect } = args;
      const cx = rect.x + rect.width - 12;
      const cy = rect.y + rect.height / 2;
      c.save();
      c.strokeStyle = token("--calc");
      c.lineWidth = 1.75;
      c.beginPath();
      c.arc(cx, cy, 5, 0.4, Math.PI * 1.75);
      c.stroke();
      c.restore();
    },
    [columns, store],
  );

  const rowsCount = store.count;
  return (
    // data-* : the layout the browser tests use to find a cell on the canvas.
    <div className="relative min-h-0 flex-1" onMouseLeave={() => setTip(null)} data-testid="grid" data-widths={JSON.stringify(gridColumns.map((c) => ("width" in c ? c.width : 0)))} data-row-height={ROW_HEIGHT} data-marker-width={MARKER_WIDTH}>
      {theme && (
        <DataEditor
          ref={ref}
          width="100%"
          height="100%"
          theme={theme}
          columns={gridColumns}
          rows={rowsCount}
          rowHeight={ROW_HEIGHT}
          headerHeight={ROW_HEIGHT}
          getCellContent={getCellContent}
          customRenderers={[soeRenderer]}
          isOutsideClick={(e) => !isInsidePopup(e)}
          rowMarkers={{ kind: "both", width: MARKER_WIDTH }}
          rowSelectionMode="multi"
          gridSelection={selection}
          onGridSelectionChange={onGridSelectionChange}
          onVisibleRegionChanged={onVisibleRegionChanged}
          onCellEdited={onCellEdited}
          onPaste={onPaste}
          onDelete={onDelete}
          fillHandle={canWrite}
          onFillPattern={onFillPattern}
          keybindings={{ downFill: true }}
          getCellsForSelection
          onColumnResize={(c, w) => setWidths((s) => ({ ...s, [c.id ?? ""]: Math.max(70, Math.min(600, Math.round(w))) }))}
          onItemHovered={onItemHovered}
          drawCell={drawCell}
          trailingRowOptions={canWrite ? { hint: "Thêm dòng", sticky: true, tint: true } : undefined}
          onRowAppended={canWrite ? () => onAddRow().then(() => undefined) : undefined}
          smoothScrollX
          smoothScrollY
          overscrollX={0}
          overscrollY={0}
          onKeyDown={(e) => {
            if (e.shiftKey && e.key === " ") {
              const id = apiRef.current?.activeRowId();
              if (id) {
                e.preventDefault();
                onOpenRow(id);
              }
            }
          }}
        />
      )}
      {tip && tip.v === version && (
        <div role="tooltip" className="pointer-events-none fixed z-[70] max-w-xs -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md [overflow-wrap:anywhere]" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

export type { Row };
