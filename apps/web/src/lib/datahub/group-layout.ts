/**
 * The lines of a grouped table. The server lists the groups (`datahub.row.groups`) in display order and the rows are read in
 * the same order, so the rows of the deepest groups follow each other in the list. This turns the group list into the lines the
 * grid draws: a header line per visible group and the rows of every open deepest group. A closed group keeps its header only.
 * Pure functions, no React.
 */

export interface GroupLine {
  /** 0 = first grouping column. */
  depth: number;
  path: (string | number | boolean | null)[];
  count: number;
  aggs: Record<string, number | string | null>;
}

export type Line = { type: "header"; group: GroupLine; key: string; open: boolean; leaf: boolean } | { type: "row"; pos: number };

export const groupKey = (path: GroupLine["path"]): string => JSON.stringify(path);

interface Segment {
  /** First display line of the segment. */
  start: number;
  /** Lines in the segment. */
  length: number;
  header?: { group: GroupLine; key: string; open: boolean; leaf: boolean };
  /** For a run of rows: the position of its first row in the list the server reads. */
  rowStart?: number;
}

export class GroupLayout {
  private segments: Segment[] = [];
  /** Total display lines. */
  readonly count: number;
  /** Rows covered by the groups (can be fewer than the table's rows when the group list was cut). */
  readonly rowsCovered: number;

  constructor(groups: GroupLine[], levels: number, closed: ReadonlySet<string> | ((key: string) => boolean)) {
    const isClosed = typeof closed === "function" ? closed : (k: string) => closed.has(k);
    let line = 0;
    let rowPos = 0;
    // A closed group hides everything inside it: `hideBelow` is its depth while we are inside one.
    let hideBelow: number | null = null;
    for (const g of groups) {
      if (hideBelow !== null && g.depth > hideBelow) {
        if (g.depth === levels - 1) rowPos += g.count;
        continue;
      }
      hideBelow = null;
      const key = groupKey(g.path);
      const leaf = g.depth === levels - 1;
      const open = !isClosed(key);
      this.segments.push({ start: line, length: 1, header: { group: g, key, open, leaf } });
      line += 1;
      if (leaf) {
        if (open && g.count > 0) {
          this.segments.push({ start: line, length: g.count, rowStart: rowPos });
          line += g.count;
        }
        rowPos += g.count;
      } else if (!open) hideBelow = g.depth;
    }
    this.count = line;
    this.rowsCovered = rowPos;
  }

  /** The line at a display index (`undefined` past the end). */
  at(index: number): Line | undefined {
    if (index < 0 || index >= this.count) return undefined;
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segments[mid]!.start <= index) lo = mid;
      else hi = mid - 1;
    }
    const s = this.segments[lo]!;
    if (s.header) return { type: "header", ...s.header };
    return { type: "row", pos: s.rowStart! + (index - s.start) };
  }

  /** Display index of a row position, or -1 when its group is closed. */
  indexOfRow(pos: number): number {
    for (const s of this.segments) if (s.rowStart !== undefined && pos >= s.rowStart && pos < s.rowStart + s.length) return s.start + (pos - s.rowStart);
    return -1;
  }

  /** The row ranges (positions in the list the server reads) behind the display lines `from..to`. */
  rowRanges(from: number, to: number): [number, number][] {
    const out: [number, number][] = [];
    for (const s of this.segments) {
      if (s.rowStart === undefined) continue;
      const a = Math.max(from, s.start);
      const b = Math.min(to, s.start + s.length - 1);
      if (a > b) continue;
      out.push([s.rowStart + (a - s.start), s.rowStart + (b - s.start)]);
    }
    return out;
  }
}

/** The text of a group key for a header: the value of the column in words. */
export function groupLabel(value: string | number | boolean | null, format: (v: string | number | boolean) => string, empty = "(Trống)"): string {
  return value === null ? empty : format(value);
}
