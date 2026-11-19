import { createHash } from "node:crypto";
import { z } from "zod";
import type { ColumnType } from "@soe/shared";

/**
 * Pure part of the merged table (design module3 section 4): the configuration shape, which column types go together, and the plan that
 * turns the rows of the source tables into the rows of the merged table (copy, de-duplicate by key, diagnostics). It reads nothing from the
 * database: `merge-sync.ts` loads the rows (through the scope of the owner) and writes the result.
 */

export const MERGE_MAX_SOURCES = 10;
export const MERGE_MAX_DEDUP_COLUMNS = 5;
export const MERGE_STRATEGIES = ["priority", "latest", "cell_merge"] as const;
export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

/** Keys of the two system columns every merged table has (cells hold text). */
export const SOURCE_COLUMN_KEY = "c_nguon";
export const ORIGIN_COLUMN_KEY = "c_magoc";
export const SOURCE_COLUMN_NAME = "Nguồn";
export const ORIGIN_COLUMN_NAME = "Mã dòng gốc";

const Uuid = z.uuid();
const ColKey = z.string().regex(/^c_[a-z0-9]{4,12}$/);

/** What is stored in `dh_merges.config` (column keys, never names, so renaming never breaks it). */
export const MergeConfigSchema = z.strictObject({
  /** Source tables, highest priority first. */
  sources: z.array(z.strictObject({ table_id: Uuid })).min(1).max(MERGE_MAX_SOURCES),
  /** Columns of the merged table. `from` maps a source table id to the key of the column it comes from (a source without an entry gives empty cells). */
  columns: z
    .array(
      z.strictObject({
        key: ColKey,
        name: z.string().min(1).max(100),
        type: z.string(),
        from: z.record(Uuid, z.string()),
      }),
    )
    .max(150),
  /** Anti-duplicate key: merged column keys; null = no key (every source row becomes a row). */
  dedup: z.strictObject({ columns: z.array(ColKey).min(1).max(MERGE_MAX_DEDUP_COLUMNS), strategy: z.enum(MERGE_STRATEGIES) }).nullable(),
});
export type MergeConfig = z.infer<typeof MergeConfigSchema>;

// ------------------------------------------------------------------------------------------------
// column types that go together
// ------------------------------------------------------------------------------------------------

type Family = "text" | "number" | "date" | "datetime" | "checkbox" | "user" | "select";

const FAMILY: Partial<Record<string, Family>> = {
  text: "text", long_text: "text", email: "text", phone: "text", url: "text",
  number: "number", currency: "number", percent: "number", rating: "number",
  date: "date", datetime: "datetime", checkbox: "checkbox", user: "user",
  single_select: "select", multi_select: "select",
};

/** The family of a source column type (computed columns pass their result type), or null when it cannot be merged. */
export const familyOf = (type: string): Family | null => FAMILY[type] ?? null;

/**
 * Type of a merged column fed by source columns of these types. Same type stays; types of one family become the plain member
 * (text, number); selects become text (the option name; several options joined by ", "). Different families cannot be merged.
 */
export function mergedType(types: string[]): { ok: true; type: ColumnType } | { ok: false; reason: string } {
  const families = new Set(types.map((t) => familyOf(t)));
  if (families.has(null)) return { ok: false, reason: `Kiểu cột "${types[types.findIndex((t) => familyOf(t) === null)]}" không ghép được.` };
  const fams = [...families] as Family[];
  const hasSelect = fams.includes("select");
  const base = fams.filter((f) => f !== "select");
  // A select merges with text or with another select (all become text); with any other family it is a mismatch.
  if (base.length > 1 || (hasSelect && base.length === 1 && base[0] !== "text")) return { ok: false, reason: "Các cột nguồn khác nhóm kiểu nên không ghép chung được." };
  if (hasSelect || base.length === 0) return { ok: true, type: "text" };
  const uniq = [...new Set(types)];
  if (uniq.length === 1) return { ok: true, type: uniq[0] as ColumnType };
  return { ok: true, type: (base[0] === "number" ? "number" : uniq.includes("long_text") ? "long_text" : "text") as ColumnType };
}

// ------------------------------------------------------------------------------------------------
// planning
// ------------------------------------------------------------------------------------------------

export interface PlanSourceColumn {
  type: string;
  /** Select options (id to name) when the column is a select. */
  options?: Map<string, string>;
}

export interface PlanRow {
  id: string;
  rowNo: number;
  updatedAt: number;
  data: Record<string, unknown>;
}

export interface PlanSource {
  tableId: string;
  name: string;
  /** Live columns by key. A mapped column missing here is reported and gives empty cells. */
  columns: Map<string, PlanSourceColumn>;
  rows: PlanRow[];
}

export interface PlannedRow {
  /** Stable identity of the merged row across syncs. */
  ident: string;
  sourceTableId: string;
  sourceRowId: string;
  /** Cells by merged column key (data columns only; `Nguồn` and `Mã dòng gốc` are added by the writer). */
  data: Record<string, string | number | boolean | null>;
}

export interface DuplicateGroup {
  key: string;
  rows: { source_table_id: string; source_name: string; row_id: string; row_no: number; kept: boolean }[];
}

export interface MergeDiagnostics {
  sources: { table_id: string; name: string; rows: number; kept: number; dropped: number }[];
  total_read: number;
  total_kept: number;
  dropped: number;
  duplicate_groups: number;
  /** Rows whose key is empty: never treated as duplicates. */
  empty_key_rows: number;
  strategy: MergeStrategy | null;
  warnings: { code: "no_key" | "missing_column" | "type_mismatch"; message: string; source_table_id?: string; column?: string }[];
  /** First groups of duplicates (the full list comes from `datahub.merge.duplicates`). */
  duplicate_sample: DuplicateGroup[];
}

export const DUPLICATE_SAMPLE = 20;

/** Folds a key part: no accents, no case, single spaces, trimmed. Empty means "no value". */
export function normalizeKeyPart(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join(",") : String(v);
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type Cell = string | number | boolean | null;

/** A source cell as the merged column stores it. Selects become their names. */
export function convertCell(col: PlanSourceColumn | undefined, raw: unknown): Cell {
  if (raw === null || raw === undefined || raw === "") return null;
  if (!col) return null;
  if (col.type === "single_select") return typeof raw === "string" ? (col.options?.get(raw) ?? null) : null;
  if (col.type === "multi_select") {
    if (!Array.isArray(raw)) return null;
    const names = raw.map((id) => col.options?.get(String(id))).filter((x): x is string => !!x);
    return names.length ? names.join(", ") : null;
  }
  if (Array.isArray(raw) || typeof raw === "object") return null;
  return raw as Cell;
}

const isEmpty = (v: Cell) => v === null || v === "";
const shortIdent = (k: string) => (k.length > 120 ? `h:${createHash("sha1").update(k).digest("hex")}` : `k:${k}`);

interface Candidate {
  source: number;
  row: PlanRow;
  data: Record<string, Cell>;
}

/** Runs the plan: the rows the merged table must hold, and the diagnostics. */
export function planMerge(config: MergeConfig, sources: PlanSource[]): { rows: PlannedRow[]; diagnostics: MergeDiagnostics; groups: DuplicateGroup[] } {
  const bySource = new Map(sources.map((s) => [s.tableId, s]));
  const warnings: MergeDiagnostics["warnings"] = [];
  const dedupCols = config.dedup?.columns ?? [];
  const strategy = config.dedup?.strategy ?? null;
  if (!config.dedup) warnings.push({ code: "no_key", message: "Chưa có khoá chống trùng, số liệu có thể bị đếm hai lần." });

  // 1. copy every row into the merged columns
  const candidates: Candidate[] = [];
  const order = config.sources.map((s) => s.table_id);
  order.forEach((tableId, source) => {
    const src = bySource.get(tableId);
    if (!src) return;
    const missing = new Set<string>();
    for (const row of src.rows) {
      const data: Record<string, Cell> = {};
      for (const c of config.columns) {
        const from = c.from[tableId];
        if (!from) {
          data[c.key] = null;
          continue;
        }
        const sc = src.columns.get(from);
        if (!sc && !missing.has(c.key)) {
          missing.add(c.key);
          warnings.push({ code: "missing_column", message: `Bảng "${src.name}" không còn cột nguồn của "${c.name}" (đã xoá hoặc đổi kiểu): ô này để trống.`, source_table_id: tableId, column: c.name });
        }
        data[c.key] = convertCell(sc, row.data[from]);
      }
      candidates.push({ source, row, data });
    }
  });
  const byPriority = (a: Candidate, b: Candidate) => a.source - b.source || a.row.rowNo - b.row.rowNo;
  candidates.sort(byPriority);

  const kept: PlannedRow[] = [];
  const keptPerSource = new Map<string, number>();
  const groups: DuplicateGroup[] = [];
  let emptyKey = 0;
  const nameOf = (i: number) => bySource.get(order[i]!)?.name ?? "";
  const push = (c: Candidate, ident: string, data: Record<string, Cell>) => {
    const tableId = order[c.source]!;
    kept.push({ ident, sourceTableId: tableId, sourceRowId: c.row.id, data });
    keptPerSource.set(tableId, (keptPerSource.get(tableId) ?? 0) + 1);
  };

  if (!config.dedup) {
    for (const c of candidates) push(c, `r:${order[c.source]}:${c.row.id}`, c.data);
  } else {
    const groupsByKey = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const parts = dedupCols.map((k) => normalizeKeyPart(c.data[k]));
      if (parts.every((p) => p === "")) {
        emptyKey++;
        push(c, `r:${order[c.source]}:${c.row.id}`, c.data);
        continue;
      }
      const key = parts.join("\u0001");
      const list = groupsByKey.get(key);
      if (list) list.push(c);
      else groupsByKey.set(key, [c]);
    }
    for (const [key, list] of groupsByKey) {
      const ident = shortIdent(key);
      if (list.length === 1) {
        push(list[0]!, ident, list[0]!.data);
        continue;
      }
      let winner = list[0]!;
      if (strategy === "latest") for (const c of list) if (c.row.updatedAt > winner.row.updatedAt) winner = c;
      let data = winner.data;
      if (strategy === "cell_merge") {
        data = { ...winner.data };
        for (const col of config.columns) {
          if (!isEmpty(data[col.key] ?? null)) continue;
          for (const c of list) {
            const v = c.data[col.key] ?? null;
            if (!isEmpty(v)) {
              data[col.key] = v;
              break;
            }
          }
        }
      }
      push(winner, ident, data);
      groups.push({
        key: dedupCols.map((k) => String(winner.data[k] ?? "")).join(" | "),
        rows: list.map((c) => ({ source_table_id: order[c.source]!, source_name: nameOf(c.source), row_id: c.row.id, row_no: c.row.rowNo, kept: c === winner })),
      });
    }
  }

  const total = candidates.length;
  const diagnostics: MergeDiagnostics = {
    sources: order.map((tableId) => {
      const s = bySource.get(tableId);
      const kept = keptPerSource.get(tableId) ?? 0;
      return { table_id: tableId, name: s?.name ?? "", rows: s?.rows.length ?? 0, kept, dropped: (s?.rows.length ?? 0) - kept };
    }),
    total_read: total,
    total_kept: kept.length,
    dropped: total - kept.length,
    duplicate_groups: groups.length,
    empty_key_rows: emptyKey,
    strategy,
    warnings,
    duplicate_sample: groups.slice(0, DUPLICATE_SAMPLE),
  };
  return { rows: kept, diagnostics, groups };
}
