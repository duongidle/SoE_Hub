import type { Column, Level, Row } from "./types";
import { COMPUTED_TYPES, SYSTEM_TYPES } from "./cells";

/** Columns the person may compare rows by (attachments cannot be compared). */
export const comparableColumns = (columns: Column[]): Column[] => columns.filter((c) => c.type !== "attachment");

/** Columns a merge may copy a value of: written by hand, not files, and not links unless the owner merges. */
export function mergeableColumns(columns: Column[], level: Level): Column[] {
  return columns.filter((c) => !COMPUTED_TYPES.has(c.type) && !SYSTEM_TYPES.has(c.type) && c.type !== "attachment" && (c.type !== "relation" || level === "owner"));
}

export const isEmptyValue = (v: unknown): boolean => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

export interface GroupChoice {
  keepId: string;
  merge: boolean;
  /** Column key -> id of the row whose value goes to the kept row. */
  pick: Record<string, string>;
}

/** First choice for a group: keep the lowest row number; merging fills the kept row's empty cells from the first row that has a value. */
export function defaultChoice(rows: Row[], cols: Column[], merge: boolean): GroupChoice {
  const keep = rows[0]!;
  return { keepId: keep.id, merge, pick: merge ? fillPicks(rows, cols, keep.id) : {} };
}

export function fillPicks(rows: Row[], cols: Column[], keepId: string): Record<string, string> {
  const keep = rows.find((r) => r.id === keepId);
  const pick: Record<string, string> = {};
  for (const c of cols) {
    if (!keep || !isEmptyValue(keep.data[c.key])) continue;
    const from = rows.find((r) => r.id !== keepId && !isEmptyValue(r.data[c.key]));
    if (from) pick[c.key] = from.id;
  }
  return pick;
}

/** The request for one group: the values to write on the kept row (only cells that differ from what it has now). */
export function groupRequest(rows: Row[], cols: Column[], choice: GroupChoice): { keep_id: string; remove_ids: string[]; values?: Record<string, unknown> } {
  const keep = rows.find((r) => r.id === choice.keepId)!;
  const values: Record<string, unknown> = {};
  if (choice.merge) {
    for (const c of cols) {
      const fromId = choice.pick[c.key];
      if (!fromId || fromId === keep.id) continue;
      const from = rows.find((r) => r.id === fromId);
      if (!from) continue;
      const v = from.data[c.key];
      if (JSON.stringify(v ?? null) === JSON.stringify(keep.data[c.key] ?? null)) continue;
      values[c.key] = isEmptyValue(v) ? null : v;
    }
  }
  return { keep_id: keep.id, remove_ids: rows.filter((r) => r.id !== keep.id).map((r) => r.id), ...(Object.keys(values).length ? { values } : {}) };
}
