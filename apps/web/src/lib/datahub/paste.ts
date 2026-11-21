import { parseCellText, readOnlyReason, sameValue, type PeopleByName } from "./cells";
import type { Column, Level, Row } from "./types";

/** Splits clipboard text from Excel / Google Sheets: tabs between cells, new lines between rows, quotes around cells that hold a tab or a new line. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const src = text.replace(/\r\n?/g, "\n");
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
    i++;
  }
  // A trailing new line (every copy from a sheet ends with one) does not make an extra empty row.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export interface PasteCellChange {
  /** Index in the loaded rows, or null for a row that does not exist yet. */
  rowIndex: number | null;
  /** Index among the new rows when `rowIndex` is null. */
  newIndex: number | null;
  rowId: string | null;
  key: string;
  column: string;
  value: unknown;
}

export interface PastePlan {
  changes: PasteCellChange[];
  /** Number of rows to create (pasting below the last row). */
  newRows: number;
  errors: { row: number; column: string; message: string }[];
  /** Cells skipped because the column cannot be written (computed, system...). */
  skipped: number;
}

/**
 * Plans what a paste does. `startRow` and `startCol` are the first selected cell; cells go right and down from there.
 * Rows past the last existing row become new rows. Cells whose value is the same as now are left out.
 * Anything that cannot be read is listed in `errors` and nothing is written when there is any (the caller decides).
 */
export function planPaste(o: {
  columns: Column[];
  rowAt: (i: number) => Row | undefined;
  rowCount: number;
  startRow: number;
  startCol: number;
  matrix: string[][];
  level: Level;
  peopleByName?: PeopleByName;
}): PastePlan {
  const plan: PastePlan = { changes: [], newRows: 0, errors: [], skipped: 0 };
  o.matrix.forEach((cells, dy) => {
    const r = o.startRow + dy;
    const exists = r < o.rowCount;
    const row = exists ? o.rowAt(r) : undefined;
    const newIndex = exists ? null : r - o.rowCount;
    if (!exists) plan.newRows = Math.max(plan.newRows, newIndex! + 1);
    cells.forEach((text, dx) => {
      const col = o.columns[o.startCol + dx];
      if (!col) return;
      if (readOnlyReason(col, o.level, row)) {
        plan.skipped++;
        return;
      }
      if (exists && !row) {
        plan.errors.push({ row: r + 1, column: col.name, message: "Dòng này chưa được tải. Cuộn tới dòng đó rồi dán lại." });
        return;
      }
      const parsed = parseCellText(col, text, o.peopleByName);
      if (!parsed.ok) {
        plan.errors.push({ row: r + 1, column: col.name, message: parsed.message });
        return;
      }
      if (row && sameValue(row.data[col.key], parsed.value)) return;
      if (!row && (parsed.value === null || parsed.value === undefined)) return;
      plan.changes.push({ rowIndex: exists ? r : null, newIndex, rowId: row?.id ?? null, key: col.key, column: col.name, value: parsed.value });
    });
  });
  return plan;
}
