import { CompactSelection, DataEditor, GridCellKind, type DataEditorRef, type GridCell, type GridColumn, type GridSelection, type Item, type Rectangle, type Theme } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { formatCount, formatNumber } from "@soe/shared";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { notify } from "@/components/ui/toast";
import { NO_ACCESS, cellError, cellValue, displayText, editText, ERROR_HELP, attrsOf, entriesOf, nameKey, optionsOf, parseCellText, peopleText, pickerEditable, readOnlyReason, typeOf, type CellCtx } from "@/lib/datahub/cells";
import { planPaste } from "@/lib/datahub/paste";
import type { CellEdit, TableSession } from "@/lib/datahub/session";
import type { Column, Level, Row } from "@/lib/datahub/types";
import { PointPopover } from "@/components/ui/popover";
import { type Line } from "@/lib/datahub/group-layout";
import { isGroupable, isSortable, kindOf } from "@/lib/datahub/view-config";
import { FONT_STACK, fontsReady, optionColor, token } from "@/lib/theme";
import { isInsidePopup, soeRenderer, type SoeCell } from "./grid-cells";
import type { GridView } from "./table-view";

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
    accentLight: token("--primary-soft"),
    textDark: token("--foreground"),
    textMedium: token("--muted-foreground"),
    textLight: token("--muted-foreground"),
    textHeader: token("--muted-foreground"),
    textHeaderSelected: token("--primary-foreground"),
    bgCell: token("--card"),
    bgCellMedium: token("--workspace"),
    bgHeader: token("--workspace"),
    bgHeaderHasFocus: token("--primary-soft"),
    bgHeaderHovered: token("--muted"),
    bgIconHeader: token("--muted-foreground"),
    fgIconHeader: token("--card"),
    bgBubble: token("--muted"),
    bgBubbleSelected: token("--selected"),
    textBubble: token("--foreground"),
    borderColor: token("--border-soft"),
    horizontalBorderColor: token("--border-soft"),
    drilldownBorder: token("--border"),
    linkColor: token("--primary"),
    cellHorizontalPadding: 8,
    cellVerticalPadding: 4,
    headerFontStyle: "600 13px",
    baseFontStyle: "14px",
    markerFontStyle: "12px",
    fontFamily: FONT_STACK,
    editorFontSize: "14px",
    lineHeight: 1.5,
    roundingRadius: 6,
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
  /** First and last row POSITION (in the list the server reads) on screen. */
  visibleRange: () => [number, number];
}

export function TableGrid({ session, level, view, onOpenRow, onSelection, apiRef, onAddRow }: { session: TableSession; level: Level; view: GridView; onOpenRow: (rowId: string) => void; onSelection: (rowIds: string[], activeRowId: string | null) => void; apiRef: React.MutableRefObject<GridApi | null>; onAddRow: () => Promise<void> }) {
  const { store, labels } = session;
  useSyncExternalStore(store.subscribe, store.getVersion);
  const layoutVersion = useSyncExternalStore(session.subscribeLayout, session.getLayoutVersion);
  const [labelVersion, setLabelVersion] = useState(0);
  useEffect(() => labels.subscribe(() => setLabelVersion((v) => v + 1)), [labels]);

  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void fontsReady().then(() => live && setReady(true));
    return () => void (live = false);
  }, []);
  const theme = useMemo(() => (ready ? gridTheme() : undefined), [ready]);

  const columns = view.columns;
  const canWrite = level !== "view";
  // While a column is being dragged wider the new width shows at once; the view saves it when the drag ends.
  const [drag, setDrag] = useState<Record<string, number>>({});
  const widthOf = useCallback((c: Column) => drag[c.id] ?? view.widths[c.key] ?? defaultWidth(c), [drag, view.widths]);
  const gridColumns: GridColumn[] = useMemo(() => columns.map((c) => ({ id: c.id, title: c.name, width: widthOf(c), hasMenu: true })), [columns, widthOf]);
  const ROW_HEIGHT = view.rowHeight;
  const grouped = session.grouped;
  const groupCols = useMemo(() => (session.query.group ?? []).map((g) => session.table.columns.find((c) => c.key === g.field)), [session]);

  /** What a line of the grid is: a row of the list (by position) or the header of a group. */
  const lineAt = useCallback(
    (i: number): Line | undefined => {
      if (grouped) return session.layout?.at(i);
      return i >= 0 && i < store.count ? { type: "row", pos: i } : undefined;
    },
    // layoutVersion: the lines changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouped, session, store, layoutVersion],
  );
  const rowAtLine = useCallback(
    (i: number): Row | undefined => {
      const l = lineAt(i);
      return l?.type === "row" ? store.rowAt(l.pos) : undefined;
    },
    [lineAt, store],
  );
  const [menu, setMenu] = useState<{ x: number; y: number; col: Column } | null>(null);

  const ref = useRef<DataEditorRef>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const visible = useRef<Rectangle>({ x: 0, y: 0, width: 0, height: 0 });
  const [selection, setSelection] = useState<GridSelection>({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
  const [tip, setTip] = useState<Tip | null>(null);

  const ctx: CellCtx = useMemo(() => ({ people: labels.people, linked: labels.linked, noAccess: labels.noAccess }), [labels]);
  // Names of people already known, for pasting a name into a user column.
  const peopleByName = useCallback(() => new Map([...labels.people].filter(([, n]) => n !== "—" && n !== "…").map(([id, n]) => [nameKey(n), id] as const)), [labels]);

  // ---- group header lines -------------------------------------------------------------------------------------------
  type HeaderLine = Extract<Line, { type: "header" }>;
  const keyText = useCallback(
    (depth: number, value: string | number | boolean | null): string => {
      const col = groupCols[depth];
      if (value === null) return "(Trống)";
      if (!col) return String(value);
      if (typeof value === "string" && ["user", "created_by", "modified_by"].includes(typeOf(col))) {
        labels.wantPerson(value);
        return labels.people.get(value) ?? "…";
      }
      return displayText(col, { id: "", data: { [col.key]: value } }, ctx);
    },
    // labelVersion: names that arrived later
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupCols, ctx, labels, labelVersion],
  );
  const headerText = useCallback(
    (line: HeaderLine): string => `${groupCols[line.group.depth]?.name ?? ""}: ${keyText(line.group.depth, line.group.path[line.group.depth] ?? null)} · ${formatCount(line.group.count, "dòng")}`,
    [groupCols, keyText],
  );
  /** The short text drawn on the line (the name of the column is in the tooltip). */
  const headerLabel = useCallback((line: HeaderLine): string => `${keyText(line.group.depth, line.group.path[line.group.depth] ?? null)} · ${formatCount(line.group.count, "dòng")}`, [keyText]);
  /** The total of one column on a group line, or null when the view asks none for it. */
  const aggOf = useCallback(
    (line: HeaderLine, col: Column): { label: string; text: string } | null => {
      const fn = session.query.aggs?.[col.key];
      if (!fn) return null;
      const v = line.group.aggs[col.key];
      const text = v === null || v === undefined ? "—" : fn === "count" ? formatNumber(Number(v)) : displayText(col, { id: "", data: { [col.key]: v } }, ctx);
      return { label: AGG_SHORT[fn], text };
    },
    [session, ctx],
  );

  // ---- reading cells ----------------------------------------------------------------------------------------------
  const getCellContent = useCallback(
    ([c, r]: Item): GridCell => {
      const col = columns[c];
      const line = lineAt(r);
      if (line?.type === "header") {
        // Drawn by `drawCell`; the text is what Copy and the tooltip give.
        const text = c === 0 ? headerText(line) : "";
        return { kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: false, readonly: true, copyData: text };
      }
      const row = line ? store.rowAt(line.pos) : undefined;
      if (!col || !row) return { kind: GridCellKind.Loading, allowOverlay: false };
      const reason = readOnlyReason(col, level, row);
      const ro = !canWrite || reason !== null;
      const v = cellValue(col, row);
      const type = typeOf(col);
      const err = cellError(col, v);
      const text = displayText(col, row, ctx);
      // A colour rule of the view (the server says which rules this row satisfies) tints the row.
      const rule = row.marks?.length ? view.colors[row.marks[0]!] : undefined;
      const tint = rule ? { bgCell: optionColor(rule.color) } : undefined;
      if (err) return { kind: GridCellKind.Text, data: err, displayData: err, allowOverlay: true, readonly: true, contentAlign: "right", copyData: err, themeOverride: { ...tint, textDark: token("--bad") } };

      switch (type) {
        case "checkbox":
          return { kind: GridCellKind.Boolean, data: v === true, allowOverlay: false, readonly: ro, copyData: text, themeOverride: tint };
        case "single_select":
        case "multi_select": {
          const ids = Array.isArray(v) ? (v as string[]) : typeof v === "string" ? [v] : [];
          const cell: SoeCell = { kind: GridCellKind.Custom, allowOverlay: !ro, copyData: text === "—" ? "" : text, data: { t: "select", ids, options: optionsOf(col), multi: type === "multi_select", readonly: ro }, themeOverride: tint };
          return cell;
        }
        case "rating": {
          const cell: SoeCell = { kind: GridCellKind.Custom, allowOverlay: !ro, copyData: typeof v === "number" ? String(v) : "", data: { t: "rating", value: typeof v === "number" ? v : null, max: col.config.max ?? 5, readonly: ro }, themeOverride: tint };
          return cell;
        }
        case "user": {
          if (attrsOf(col).length) {
            const list = entriesOf(v);
            list.forEach((e) => labels.wantPerson(e.id));
            // Looking at the people of a deal is allowed even when the cell cannot be edited.
            const cell: SoeCell = { kind: GridCellKind.Custom, allowOverlay: true, copyData: text === "—" ? "" : text, data: { t: "persons", col, value: list, text: text === "—" ? "" : text, shownText: peopleText(col, v, { ...ctx, people: labels.shown }), names: labels.people, readonly: ro, tableId: session.table.id }, themeOverride: tint };
            return cell;
          }
          const id = typeof v === "string" ? v : null;
          if (id) labels.wantPerson(id);
          const name = id ? (labels.people.get(id) ?? "…") : "";
          const drawn = id ? (labels.shown.get(id) ?? name) : "";
          const shown = id && labels.noAccess.has(id) ? `${drawn} (${NO_ACCESS})` : drawn;
          const cell: SoeCell = { kind: GridCellKind.Custom, allowOverlay: !ro, copyData: name, data: { t: "person", id, name: shown, readonly: ro, tableId: session.table.id }, themeOverride: tint };
          return cell;
        }
        case "created_by":
        case "modified_by":
          if (typeof v === "string") labels.wantPerson(v);
          break;
        case "relation": {
          const ids = Array.isArray(v) ? (v as string[]) : [];
          ids.forEach((id) => labels.wantLinked(col.key, String(id)));
          const names = ids.map((id) => labels.linked.get(id) ?? "…");
          const rel: SoeCell = { kind: GridCellKind.Custom, allowOverlay: pickerEditable(col, level), copyData: names.join(", "), data: { t: "relation", ids, names, multiple: col.config.multiple !== false, readonly: !pickerEditable(col, level), tableId: session.table.id, column: col.key, learn: (id, label) => labels.learnLinked(id, label) }, themeOverride: tint };
          return rel;
        }
        case "attachment": {
          const ids = Array.isArray(v) ? (v as string[]) : [];
          const files: SoeCell = { kind: GridCellKind.Custom, allowOverlay: true, copyData: text === "—" ? "" : text, data: { t: "files", ids, max: (col.config.max_files as number | undefined) ?? 20, readonly: !pickerEditable(col, level), tableId: session.table.id }, themeOverride: tint };
          return files;
        }
      }
      return {
        kind: GridCellKind.Text,
        data: editText(col, row),
        // created by / modified by draw the name told apart from a namesake; copy keeps the plain name.
        displayData: type === "created_by" || type === "modified_by" ? displayText(col, row, { ...ctx, people: labels.shown }) : text,
        allowOverlay: true,
        readonly: ro,
        contentAlign: NUMERIC.has(type) ? "right" : undefined,
        copyData: text === "—" ? "" : text,
        allowWrapping: view.tall,
        themeOverride: tint,
      };
    },
    // labelVersion makes a redraw pick up names that arrived later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, store, level, canWrite, ctx, labels, labelVersion, lineAt, view.colors, view.tall, headerText],
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
  }, [version, labelVersion, layoutVersion]);

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
        if (d.t === "persons") return { ok: true, value: d.value.length ? d.value : null };
        if (d.t === "relation" || d.t === "files") return { ok: true, value: d.ids.length ? d.ids : null };
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
      const row = rowAtLine(cell[1]);
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
    [columns, store, canWrite, valueFromCell, run, session, rowAtLine],
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
      if (grouped) {
        const lastLine = target[1] + matrix.length - 1;
        for (let i = target[1]; i <= lastLine; i++) {
          if (lineAt(i)?.type !== "row") {
            notify.error("Không dán qua dòng nhóm được. Chọn các dòng trong cùng một nhóm.");
            return false;
          }
        }
      }
      const plan = planPaste({ columns, rowAt: rowAtLine, rowCount: session.lineCount, startRow: target[1], startCol: target[0], matrix, level, peopleByName: peopleByName() });
      if (plan.newRows > 1 && level !== "owner" && session.table.members_bulk_create === false) {
        notify.error("Chủ bảng không cho thành viên thêm nhiều dòng một lúc. Dán vào các dòng đang có, hoặc thêm từng dòng.");
        return false;
      }
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
    [canWrite, columns, level, peopleByName, run, selection, session, grouped, lineAt, rowAtLine],
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
        const row = rowAtLine(r);
        if (!row) continue;
        for (let c = dst.x; c < dst.x + dst.width; c++) {
          const col = columns[c];
          if (!col || readOnlyReason(col, level, row)) {
            skipped++;
            continue;
          }
          const sc = src.x + (((c - src.x) % src.width) + src.width) % src.width;
          const sr = src.y + (((r - src.y) % src.height) + src.height) % src.height;
          const srcCol = columns[sc];
          const srcRow = rowAtLine(sr);
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
    [canWrite, columns, level, ctx, peopleByName, run, session, rowAtLine],
  );

  const onDelete = useCallback(
    (sel: GridSelection) => {
      if (!canWrite || !sel.current) return false;
      const edits: CellEdit[] = [];
      for (const rg of [sel.current.range, ...sel.current.rangeStack]) {
        for (let r = rg.y; r < rg.y + rg.height; r++) {
          const row = rowAtLine(r);
          if (!row) continue;
          for (let c = rg.x; c < rg.x + rg.width; c++) {
            const col = columns[c];
            if (col && !readOnlyReason(col, level, row) && !col.required) edits.push({ rowId: row.id, key: col.key, value: col.type === "checkbox" ? false : null });
          }
        }
      }
      void run(async () => {
        await session.edit(edits, "Xoá nội dung ô");
      });
      return false;
    },
    [canWrite, columns, level, run, session, rowAtLine],
  );

  // ---- selection, scroll, keyboard ------------------------------------------------------------------------------
  const onGridSelectionChange = useCallback(
    (s: GridSelection) => {
      setSelection(s);
      const ids = s.rows.toArray().map((i) => rowAtLine(i)?.id).filter((x): x is string => !!x);
      const active = s.current ? (rowAtLine(s.current.cell[1])?.id ?? null) : null;
      onSelection(ids, active);
    },
    [onSelection, rowAtLine],
  );

  /** The rows of the list behind display lines `from..to`: one range, or one per open group the lines touch. */
  const rangesOf = useCallback(
    (from: number, to: number): [number, number][] => (grouped ? (session.layout?.rowRanges(from, to) ?? []) : [[from, to]]),
    [grouped, session],
  );
  const positionsOf = useCallback(
    (from: number, to: number): [number, number] => {
      const r = rangesOf(from, to);
      return r.length ? [r[0]![0], r[r.length - 1]![1]] : [0, 0];
    },
    [rangesOf],
  );

  useEffect(() => {
    apiRef.current = {
      selectedRowIds: () => selection.rows.toArray().map((i) => rowAtLine(i)?.id).filter((x): x is string => !!x),
      activeRowId: () => (selection.current ? (rowAtLine(selection.current.cell[1])?.id ?? null) : null),
      scrollToRow: (pos) => {
        const line = grouped ? session.layout?.indexOfRow(pos) ?? -1 : pos;
        if (line >= 0) ref.current?.scrollTo(0, line, "vertical", 0, 0, { vAlign: "center" });
      },
      visibleRange: () => positionsOf(visible.current.y, visible.current.y + visible.current.height),
    };
  }, [apiRef, selection, rowAtLine, grouped, session, positionsOf]);

  const onVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      visible.current = range;
      // The blocks near the screen (a screenful of margin each way) are read; a jump of the scroll bar reads only the place it lands on.
      store.want(rangesOf(range.y - 30, range.y + range.height + 60));
    },
    [store, rangesOf],
  );
  // The lines changed (groups opened or closed, new totals): the rows behind the screen are not the same.
  useEffect(() => {
    const v = visible.current;
    if (v.height > 0) store.want(rangesOf(v.y - 30, v.y + v.height + 60));
  }, [layoutVersion, rangesOf, store]);

  // Keep following the visible region with sync after someone else's change (see TableView) and while formulas are being calculated.
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      const [a, b] = positionsOf(visible.current.y, visible.current.y + visible.current.height);
      if (store.pendingIn(a, b) > 0 && n++ < 30) void store.sync(a, b).catch(() => undefined);
      else n = 0;
    }, 2000);
    return () => clearInterval(t);
  }, [store, positionsOf]);

  // ---- hover tip: error meaning, "calculating", and the full text of a cut cell ----------------------------------
  const onItemHovered = useCallback(
    (args: { kind: string; location: Item; bounds?: Rectangle }) => {
      if (args.kind !== "cell" || !args.bounds) return setTip(null);
      const col = columns[args.location[0]];
      const line = lineAt(args.location[1]);
      if (line?.type === "header") {
        const agg = col ? aggOf(line, col) : null;
        const text = agg && col ? `${agg.label} của cột "${col.name}": ${agg.text}` : headerText(line);
        return setTip({ x: args.bounds.x + Math.min(args.bounds.width, 240) / 2, y: args.bounds.y + args.bounds.height + 4, text, v: store.version });
      }
      const row = line ? store.rowAt(line.pos) : undefined;
      if (!col || !row) return setTip(null);
      const err = cellError(col, cellValue(col, row));
      let text: string | null = null;
      if (err) text = `${err} ${ERROR_HELP[err] ?? ""}`.trim();
      else if (row.pending?.includes(col.key)) text = "Đang tính lại giá trị này.";
      else {
        const full = displayText(col, row, ctx);
        const w = widthOf(col) - 16;
        const c = document.createElement("canvas").getContext("2d");
        if (c && full.length > 3) {
          c.font = `14px ${FONT_STACK}`;
          if (c.measureText(full).width > w) text = full.length > 600 ? `${full.slice(0, 600)}…` : full;
        }
      }
      setTip(text ? { x: args.bounds.x + Math.min(args.bounds.width, 240) / 2, y: args.bounds.y + args.bounds.height + 4, text, v: store.version } : null);
    },
    [columns, store, ctx, widthOf, lineAt, aggOf, headerText],
  );

  // A template table: the header carries the tag of the layer (`Mẫu`, `Riêng`...) after the name when there is room.
  const drawHeader = useCallback(
    (args: { ctx: CanvasRenderingContext2D; columnIndex: number; theme: Theme; rect: Rectangle }, drawContent: () => void) => {
      drawContent();
      const col = columns[args.columnIndex];
      const tag = col ? view.layerTag(col) : null;
      if (!col || !tag) return;
      const { ctx: c, rect, theme: th } = args;
      c.save();
      c.font = `${th.headerFontStyle} ${FONT_STACK}`;
      const nameW = c.measureText(col.name).width;
      c.font = `11px ${FONT_STACK}`;
      const w = c.measureText(tag).width + 10;
      const x = rect.x + th.cellHorizontalPadding + nameW + 8;
      if (x + w < rect.x + rect.width - 30) {
        c.fillStyle = token(col.layer === "custom" ? "--muted" : "--primary-soft");
        c.beginPath();
        c.roundRect(x, rect.y + rect.height / 2 - 9, w, 18, 4);
        c.fill();
        c.fillStyle = token("--muted-foreground");
        c.textBaseline = "middle";
        c.fillText(tag, x + 5, rect.y + rect.height / 2 + 1);
      }
      c.restore();
    },
    [columns, view],
  );

  const drawCell = useCallback(
    (args: { ctx: CanvasRenderingContext2D; col: number; row: number; rect: Rectangle }, draw: () => void) => {
      const col = columns[args.col];
      const line = lineAt(args.row);
      if (line?.type === "header") {
        drawHeaderLine(args.ctx, args.rect, line, args.col === 0 && col ? headerLabel(line) : null, col ? aggOf(line, col) : null, !!col && NUMERIC.has(typeOf(col)));
        return;
      }
      draw();
      const row = line ? store.rowAt(line.pos) : undefined;
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
    [columns, store, lineAt, headerLabel, aggOf],
  );

  const onHeaderClick = useCallback(
    (cell: Item) => {
      // Opening or closing a group: the first cell of its line (a click or Enter), so a click elsewhere on the line only selects.
      const line = lineAt(cell[1]);
      if (line?.type === "header" && cell[0] === 0) session.toggleGroup(line.key);
    },
    [lineAt, session],
  );

  const rowsCount = session.lineCount;

  // ---- the row number column (module 12): left click opens the row panel, right click selects the row ---------------------------
  // Not for a grouped table: its marker is a checkbox and keeps working as before.
  const markerRowAt = (clientX: number, clientY: number): number | null => {
    const root = rootRef.current;
    const ed = ref.current;
    if (grouped || !root || !ed) return null;
    const rect = root.getBoundingClientRect();
    if (clientX < rect.left || clientX - rect.left > MARKER_WIDTH + 1) return null;
    const v = visible.current;
    for (let r = v.y; r <= Math.min(v.y + v.height + 1, rowsCount - 1); r++) {
      const b = ed.getBounds(0, r);
      if (b && clientY >= b.y && clientY < b.y + b.height) return lineAt(r)?.type === "header" ? null : r;
    }
    return null;
  };
  const selectRow = (r: number, mode: "replace" | "toggle" | "range") => {
    const cur = selection.rows;
    let rows: CompactSelection;
    if (mode === "toggle") rows = cur.hasIndex(r) ? cur.remove(r) : cur.add(r);
    else if (mode === "range" && cur.length > 0) {
      const anchor = cur.toArray()[cur.length - 1]!;
      rows = cur.add([Math.min(anchor, r), Math.max(anchor, r) + 1]);
    } else rows = CompactSelection.fromSingleSelection(r);
    onGridSelectionChange({ columns: CompactSelection.empty(), rows });
  };
  const pressed = useRef<{ row: number; mode: "open" | "replace" | "toggle" | "range" } | null>(null);
  const touch = useRef<{ row: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const markerHandlers = {
    // The grid reads its selection on mouse up as well, so the action runs just after that (a timer of 0) and has the last word.
    onMouseDownCapture: (e: React.MouseEvent) => {
      const r = markerRowAt(e.clientX, e.clientY);
      if (r === null) return;
      if (e.button === 2) {
        e.stopPropagation();
        e.preventDefault();
        pressed.current = { row: r, mode: e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : "replace" };
      } else if (e.button === 0 && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.stopPropagation();
        e.preventDefault();
        pressed.current = { row: r, mode: "open" };
      }
    },
    onMouseUpCapture: () => {
      const p = pressed.current;
      pressed.current = null;
      if (!p) return;
      setTimeout(() => {
        if (p.mode === "open") {
          const id = rowAtLine(p.row)?.id;
          if (id) onOpenRow(id);
        } else selectRow(p.row, p.mode);
      }, 0);
    },
    onContextMenu: (e: React.MouseEvent) => {
      if (markerRowAt(e.clientX, e.clientY) !== null) e.preventDefault();
    },
    // Touch: a tap opens the row, a long press selects it.
    onTouchStartCapture: (e: React.TouchEvent) => {
      const t = e.touches[0];
      const r = t ? markerRowAt(t.clientX, t.clientY) : null;
      if (r === null) return;
      touch.current = { row: r, timer: setTimeout(() => { if (touch.current) { touch.current.timer = null; selectRow(r, "toggle"); } }, 500) };
    },
    onTouchEndCapture: () => {
      const t = touch.current;
      touch.current = null;
      if (!t?.timer) return;
      clearTimeout(t.timer);
      const id = rowAtLine(t.row)?.id;
      if (id) onOpenRow(id);
    },
    onTouchMoveCapture: () => {
      if (touch.current?.timer) clearTimeout(touch.current.timer);
      touch.current = null;
    },
  };
  return (
    // data-* : the layout the browser tests use to find a cell on the canvas.
    <div ref={rootRef} {...markerHandlers} className="relative min-h-[60dvh] flex-1 overflow-hidden rounded-card border border-border-soft bg-card sm:min-h-0" onMouseLeave={() => setTip(null)} data-testid="grid" data-widths={JSON.stringify(gridColumns.map((c) => ("width" in c ? c.width : 0)))} data-row-height={ROW_HEIGHT} data-lines={rowsCount} data-layer-tags={JSON.stringify(Object.fromEntries(columns.flatMap((c) => { const t = view.layerTag(c); return t ? [[c.name, t]] : []; })))} data-marker-width={MARKER_WIDTH}>
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
          rowMarkers={grouped ? { kind: "checkbox", width: MARKER_WIDTH } : { kind: "number", width: MARKER_WIDTH }}
          freezeColumns={view.frozen}
          onCellClicked={onHeaderClick}
          onHeaderMenuClick={(c, bounds) => {
            const col = columns[c];
            if (col) setMenu({ x: bounds.x, y: bounds.y + bounds.height, col });
          }}
          onColumnMoved={(from, to) => {
            const col = columns[from];
            if (col) view.onMove(col.key, to);
          }}
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
          onColumnResize={(c, w) => setDrag((s) => ({ ...s, [c.id ?? ""]: clampWidth(w) }))}
          onColumnResizeEnd={(c, w) => {
            const col = columns.find((x) => x.id === c.id);
            if (col) view.onWidth(col.key, clampWidth(w));
            setDrag({});
          }}
          onItemHovered={onItemHovered}
          drawCell={drawCell}
          drawHeader={drawHeader}
          trailingRowOptions={canWrite && !grouped ? { hint: "Thêm dòng", sticky: true, tint: true } : undefined}
          onRowAppended={canWrite && !grouped ? () => onAddRow().then(() => undefined) : undefined}
          smoothScrollX
          smoothScrollY
          overscrollX={0}
          overscrollY={0}
          onKeyDown={(e) => {
            // Enter or Space on the first cell of a group line opens or closes the group.
            const cur = selection.current?.cell;
            if (cur && cur[0] === 0 && !e.shiftKey && (e.key === "Enter" || e.key === " ") && lineAt(cur[1])?.type === "header") {
              e.preventDefault();
              onHeaderClick(cur);
              return;
            }
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
      <PointPopover at={menu} label={menu ? `Cột ${menu.col.name}` : "Cột"} onClose={() => setMenu(null)}>
        {menu && <HeaderMenu col={menu.col} canEdit={view.canEditColumn(menu.col)} inTemplate={view.inTemplate(menu.col)} frozen={view.frozen} index={columns.findIndex((c) => c.id === menu.col.id)} sole={columns.length <= 1} onAction={(a) => { view.onHeaderAction(menu.col.key, a); setMenu(null); }} />}
      </PointPopover>
      {tip && tip.v === version && (
        <div role="tooltip" className="pointer-events-none fixed z-[70] max-w-xs -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md [overflow-wrap:anywhere]" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

const clampWidth = (w: number) => Math.max(70, Math.min(600, Math.round(w)));

const AGG_SHORT = { count: "Đếm", sum: "Tổng", avg: "TB", min: "Nhỏ nhất", max: "Lớn nhất" } as const;

function HeaderMenu({ col, canEdit, inTemplate, frozen, index, sole, onAction }: { col: Column; canEdit: boolean; inTemplate: boolean; frozen: number; index: number; sole: boolean; onAction: (a: "freeze" | "unfreeze" | "hide" | "asc" | "desc" | "group" | "edit" | "delete" | "template") => void }) {
  const item = "flex min-h-11 w-full items-center rounded px-2 text-left hover:bg-muted sm:min-h-9 disabled:opacity-50";
  const kind = kindOf(col);
  const [asc, desc] = kind === "date" || kind === "datetime" ? ["Sắp xếp cũ → mới", "Sắp xếp mới → cũ"] : kind === "number" ? ["Sắp xếp nhỏ → lớn", "Sắp xếp lớn → nhỏ"] : kind === "select" ? ["Sắp xếp theo thứ tự lựa chọn", "Sắp xếp ngược thứ tự lựa chọn"] : ["Sắp xếp A → Z", "Sắp xếp Z → A"];
  return (
    <div role="menu" className="flex flex-col">
      {isSortable(col) && (
        <>
          <button type="button" role="menuitem" className={item} onClick={() => onAction("asc")}>{asc}</button>
          <button type="button" role="menuitem" className={item} onClick={() => onAction("desc")}>{desc}</button>
        </>
      )}
      {isGroupable(col) && <button type="button" role="menuitem" className={item} onClick={() => onAction("group")}>Nhóm theo cột này</button>}
      <button type="button" role="menuitem" className={item} onClick={() => onAction(index + 1 === frozen ? "unfreeze" : "freeze")}>{index + 1 === frozen ? "Bỏ cố định" : "Cố định đến cột này"}</button>
      <button type="button" role="menuitem" className={item} disabled={sole} onClick={() => onAction("hide")}>Ẩn cột</button>
      {inTemplate && (
        <>
          <div role="separator" className="my-1 h-px bg-border" />
          <button type="button" role="menuitem" className={item} onClick={() => onAction("template")}>Sửa trong template…</button>
        </>
      )}
      {canEdit && (
        <>
          <div role="separator" className="my-1 h-px bg-border" />
          <button type="button" role="menuitem" className={item} onClick={() => onAction("edit")}>Sửa cột…</button>
          <button type="button" role="menuitem" className={`${item} text-bad`} onClick={() => onAction("delete")}>Xoá cột</button>
        </>
      )}
    </div>
  );
}

/** A group line: a chevron (open or closed), the name of the group and its row count, and the totals the view asks for. */
function drawHeaderLine(c: CanvasRenderingContext2D, rect: Rectangle, line: Extract<Line, { type: "header" }>, label: string | null, agg: { label: string; text: string } | null, numeric: boolean) {
  c.save();
  c.fillStyle = token(line.group.depth === 0 ? "--primary-soft" : "--workspace");
  c.fillRect(rect.x, rect.y, rect.width, rect.height);
  c.fillStyle = token("--border-soft");
  c.fillRect(rect.x, rect.y + rect.height - 1, rect.width, 1);
  c.textBaseline = "middle";
  const cy = rect.y + rect.height / 2;
  if (label !== null) {
    const x = rect.x + 14 + line.group.depth * 16;
    c.strokeStyle = token("--foreground");
    c.lineWidth = 1.75;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.beginPath();
    if (line.open) {
      c.moveTo(x - 4, cy - 2);
      c.lineTo(x, cy + 2);
      c.lineTo(x + 4, cy - 2);
    } else {
      c.moveTo(x - 2, cy - 4);
      c.lineTo(x + 2, cy);
      c.lineTo(x - 2, cy + 4);
    }
    c.stroke();
    c.font = `600 14px ${FONT_STACK}`;
    c.fillStyle = token("--foreground");
    c.textAlign = "left";
    c.fillText(fit(c, label, rect.x + rect.width - (x + 12) - 8), x + 12, cy + 1);
  } else if (agg) {
    const pad = 8;
    c.font = `600 14px ${FONT_STACK}`;
    c.fillStyle = token("--foreground");
    const valueW = c.measureText(agg.text).width;
    c.textAlign = numeric ? "right" : "left";
    c.fillText(agg.text, numeric ? rect.x + rect.width - pad : rect.x + pad, cy + 1);
    // The kind of total ("Tổng") shows when it fits next to the number.
    c.font = `400 12px ${FONT_STACK}`;
    c.fillStyle = token("--muted-foreground");
    if (c.measureText(agg.label).width + valueW + pad * 3 < rect.width) {
      c.textAlign = numeric ? "left" : "right";
      c.fillText(agg.label, numeric ? rect.x + pad : rect.x + rect.width - pad, cy + 1);
    }
  }
  c.restore();
}

/** The text cut at the end with an ellipsis to fit `max` pixels (a group name is never cut silently: the tooltip has all of it). */
function fit(c: CanvasRenderingContext2D, text: string, max: number): string {
  if (max <= 0 || c.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

export type { Row };
