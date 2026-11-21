import type { FilterNode, SortItem, TimeFilter } from "@soe/shared";
import { typeOf } from "./cells";
import type { Column } from "./types";

/**
 * The settings of a view (design module2 section 5) and the logic that turns them into the query the server understands.
 * Pure functions, no React: the toolbar edits a `ViewConfig`, the session reads rows with `buildQuery(config)`.
 * Columns are referred to by their stable `key` (a rename never breaks a view); a column that was deleted is reported
 * (`deadRefs`) and left out of the query instead of making the whole table fail to load.
 */

export type GroupFn = "count" | "sum" | "avg" | "min" | "max";
export type RowHeight = "short" | "medium" | "tall";
export type ColorRule = { filter: FilterNode; color: string };

export interface ViewConfig {
  filter?: FilterNode;
  sort?: SortItem[];
  group?: { field: string; dir?: "asc" | "desc" }[];
  hidden?: string[];
  widths?: Record<string, number>;
  frozen?: number;
  order?: string[];
  row_height?: RowHeight;
  colors?: ColorRule[];
  time_filter?: TimeFilter;
  group_aggs?: Record<string, GroupFn>;
  /** "Thu gọn tất cả" is on: groups not in `groups_toggled` are closed (new groups too). Off: they are open. */
  groups_collapsed?: boolean;
  /** Groups (JSON of their path) whose state is the opposite of the mode. */
  groups_toggled?: string[];
  /** "Không theo kỳ chung" (Quản lý Deal): the view keeps its own time range instead of the shared period bar. */
  own_period?: boolean;
}

export interface ViewDto {
  id: string;
  table_id: string;
  name: string;
  kind: string;
  position: number;
  shared: boolean;
  owner_id: string | null;
  config: ViewConfig;
  has_override: boolean;
  version: number;
}

export const MAX_SORT = 5;
export const MAX_GROUP = 3;
export const MAX_COLORS = 20;

/** Pixel heights of a row: compact, standard (default), tall (text wraps to two lines). */
export const ROW_HEIGHTS: Record<RowHeight, number> = { short: 32, medium: 36, tall: 56 };
export const DEFAULT_ROW_HEIGHT: RowHeight = "medium";
export const ROW_HEIGHT_LABELS: Record<RowHeight, string> = { short: "Gọn", medium: "Vừa", tall: "Cao" };

// ------------------------------------------------------------------------------------------------ column kinds

export type Kind = "text" | "number" | "date" | "datetime" | "boolean" | "select" | "set" | "user";

const TEXT_TYPES = new Set(["text", "long_text", "email", "phone", "url"]);
const NUMBER_TYPES = new Set(["number", "currency", "percent", "rating", "auto_number"]);

/** How the filter treats a column: by the kind of its (result) value. `null` = cannot be filtered or sorted by a plain value. */
export function kindOf(col: Pick<Column, "type" | "config">): Kind | null {
  const t = typeOf(col);
  if (TEXT_TYPES.has(t)) return "text";
  if (NUMBER_TYPES.has(t)) return "number";
  if (t === "date") return "date";
  if (t === "datetime" || t === "created_time" || t === "modified_time") return "datetime";
  if (t === "checkbox") return "boolean";
  if (t === "single_select") return "select";
  if (t === "multi_select") return "set";
  if (t === "user" || t === "created_by" || t === "modified_by") return "user";
  return null;
}

export const isFilterable = (c: Column): boolean => kindOf(c) !== null;
/** Not sortable: lists of values (multi select). */
export const isSortable = (c: Column): boolean => {
  const k = kindOf(c);
  return k !== null && k !== "set";
};
/** The server groups by any single value except lists and long text and moments. */
export const isGroupable = (c: Column): boolean => {
  const k = kindOf(c);
  return k !== null && k !== "set" && k !== "datetime" && typeOf(c) !== "long_text";
};
export const isDateColumn = (c: Column): boolean => {
  const k = kindOf(c);
  return k === "date" || k === "datetime";
};

export type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "nin" | "contains" | "starts_with" | "is_empty" | "is_not_empty" | "between" | "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "this_quarter" | "last_quarter" | "this_year" | "last_year" | "last_n_days" | "next_n_days";

const REL: Op[] = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year", "last_n_days", "next_n_days"];

/** Operators a kind accepts, in the order the list shows them. Matches what the server accepts for the same column. */
export const OPS_BY_KIND: Record<Kind, Op[]> = {
  text: ["contains", "eq", "neq", "starts_with", "is_empty", "is_not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "is_not_empty"],
  date: ["eq", "gt", "gte", "lt", "lte", "between", ...REL, "is_empty", "is_not_empty"],
  datetime: ["gte", "lte", "between", ...REL, "is_empty", "is_not_empty"],
  boolean: ["eq"],
  select: ["eq", "neq", "in", "nin", "is_empty", "is_not_empty"],
  set: ["eq", "neq", "in", "nin", "is_empty", "is_not_empty"],
  user: ["eq", "neq", "is_empty", "is_not_empty"],
};

export const OP_LABELS: Record<Op, string> = {
  eq: "là",
  neq: "không phải",
  gt: "lớn hơn",
  gte: "từ",
  lt: "nhỏ hơn",
  lte: "đến",
  in: "là một trong",
  nin: "không phải một trong",
  contains: "chứa",
  starts_with: "bắt đầu bằng",
  is_empty: "để trống",
  is_not_empty: "có giá trị",
  between: "trong khoảng",
  today: "là hôm nay",
  yesterday: "là hôm qua",
  this_week: "trong tuần này",
  last_week: "trong tuần trước",
  this_month: "trong tháng này",
  last_month: "trong tháng trước",
  this_quarter: "trong quý này",
  last_quarter: "trong quý trước",
  this_year: "trong năm nay",
  last_year: "trong năm trước",
  last_n_days: "trong N ngày qua",
  next_n_days: "trong N ngày tới",
};

/** Wording of an operator that fits the kind (a date is "trước/sau", a number is "nhỏ hơn/lớn hơn", a list is "có"). */
export function opLabel(kind: Kind, op: Op): string {
  if (kind === "date" || kind === "datetime") {
    if (op === "gt") return "sau";
    if (op === "lt") return "trước";
    if (op === "gte") return "từ ngày";
    if (op === "lte") return "đến ngày";
    if (op === "eq") return "là ngày";
  }
  if (kind === "set") {
    if (op === "eq") return "có chứa";
    if (op === "neq") return "không chứa";
    if (op === "in") return "có một trong";
    if (op === "nin") return "không có cái nào trong";
  }
  return OP_LABELS[op];
}

export const NO_VALUE_OPS = new Set<Op>(["is_empty", "is_not_empty", "today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year"]);
export const N_OPS = new Set<Op>(["last_n_days", "next_n_days"]);
export const LIST_OPS = new Set<Op>(["in", "nin"]);

// ------------------------------------------------------------------------------------------------ draft filter tree

/**
 * The filter as the editor holds it: every node has an id (stable while editing) and a condition keeps the text the person
 * typed, so an unfinished condition does not disappear. Only complete conditions go to the server (`draftToFilter`).
 */
export type DraftCond = { kind: "cond"; id: string; field: string; op: Op; text: string; text2: string; ids: string[] };
export type DraftGroup = { kind: "group"; id: string; mode: "and" | "or"; children: DraftNode[] };
export type DraftNode = DraftCond | DraftGroup;

let seq = 0;
export const draftId = (): string => `d${++seq}`;

export function emptyGroup(mode: "and" | "or" = "and"): DraftGroup {
  return { kind: "group", id: draftId(), mode, children: [] };
}

export function newCond(col: Column | undefined): DraftCond {
  const kind = col ? kindOf(col) : null;
  const op = kind ? OPS_BY_KIND[kind][0]! : "eq";
  return { kind: "cond", id: draftId(), field: col?.key ?? "", op, text: "", text2: "", ids: [] };
}

/** The text a stored value reads as in the editor (what the person would type). */
function textOfValue(col: Column | undefined, v: unknown): string {
  if (v === null || v === undefined) return "";
  const t = col ? typeOf(col) : "text";
  if (typeof v === "number") {
    if (t === "percent") return String(Number((v * 100).toPrecision(12))).replace(".", ",");
    return String(v).replace(".", ",");
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && (kindOfType(t) === "date" || kindOfType(t) === "datetime")) {
    const [y, m, d] = v.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return String(v);
}
const kindOfType = (t: string): Kind | null => kindOf({ type: t, config: {} });

/** A saved filter as an editable tree. The root is always a group. */
export function filterToDraft(node: FilterNode | undefined, columns: Column[]): DraftGroup {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const walk = (n: FilterNode): DraftNode => {
    if ("and" in n) return { kind: "group", id: draftId(), mode: "and", children: n.and.map(walk) };
    if ("or" in n) return { kind: "group", id: draftId(), mode: "or", children: n.or.map(walk) };
    const col = byKey.get(n.field);
    const op = n.op as Op;
    const arr = Array.isArray(n.value) ? n.value : n.value === undefined ? [] : [n.value];
    const kind = col ? kindOf(col) : null;
    const idsKind = kind === "select" || kind === "set" || kind === "user";
    return {
      kind: "cond",
      id: draftId(),
      field: n.field,
      op,
      text: op === "between" ? textOfValue(col, arr[0]) : N_OPS.has(op) || !idsKind ? textOfValue(col, arr[0] ?? null) : "",
      text2: op === "between" ? textOfValue(col, arr[1]) : "",
      ids: idsKind ? arr.filter((x): x is string => typeof x === "string") : [],
    };
  };
  if (!node) return emptyGroup();
  const root = walk(node);
  return root.kind === "group" ? root : { kind: "group", id: draftId(), mode: "and", children: [root] };
}

/** The value a finished condition sends, or an error sentence when the text cannot be read (`null` value = nothing to send). */
export type CondValue = { ok: true; value: unknown; empty?: boolean } | { ok: false; reason: "empty" | "invalid"; message?: string };

export function condValue(col: Column, c: DraftCond, parse: (col: Column, text: string) => { ok: true; value: unknown } | { ok: false; message: string }): CondValue {
  const kind = kindOf(col);
  if (!kind) return { ok: false, reason: "invalid", message: "Không lọc được theo cột này." };
  if (!OPS_BY_KIND[kind].includes(c.op)) return { ok: false, reason: "invalid", message: "Toán tử này không dùng được cho cột đã chọn." };
  if (NO_VALUE_OPS.has(c.op)) return { ok: true, value: undefined, empty: true };
  if (kind === "boolean") return { ok: true, value: c.text !== "false" };
  if (kind === "select" || kind === "set" || kind === "user") {
    if (c.ids.length === 0) return { ok: false, reason: "empty" };
    return { ok: true, value: LIST_OPS.has(c.op) ? c.ids : c.ids[0] };
  }
  if (N_OPS.has(c.op)) {
    const n = Number(c.text.replace(",", "."));
    if (c.text.trim() === "") return { ok: false, reason: "empty" };
    return Number.isInteger(n) && n >= 1 && n <= 3660 ? { ok: true, value: n } : { ok: false, reason: "invalid", message: "Nhập số ngày từ 1 đến 3.660." };
  }
  const one = (text: string): CondValue => {
    if (text.trim() === "") return { ok: false, reason: "empty" };
    const p = parse(col, text);
    if (!p.ok) return { ok: false, reason: "invalid", message: p.message };
    if (p.value === null || p.value === undefined) return { ok: false, reason: "empty" };
    return { ok: true, value: p.value };
  };
  if (c.op === "between") {
    const a = one(c.text);
    const b = one(c.text2);
    if (!a.ok) return a;
    if (!b.ok) return b;
    return { ok: true, value: [a.value, b.value] };
  }
  return one(c.text);
}

/** Draft -> filter for the server. Unfinished or invalid conditions and conditions on deleted columns are left out. */
export function draftToFilter(root: DraftGroup, columns: Column[], parse: Parameters<typeof condValue>[2]): FilterNode | undefined {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const walk = (n: DraftNode): FilterNode | null => {
    if (n.kind === "group") {
      const kids = n.children.map(walk).filter((x): x is FilterNode => x !== null);
      if (kids.length === 0) return null;
      // One condition needs no group around it.
      if (kids.length === 1) return kids[0]!;
      return n.mode === "and" ? { and: kids } : { or: kids };
    }
    const col = byKey.get(n.field);
    if (!col) return null;
    const v = condValue(col, n, parse);
    if (!v.ok) return null;
    return v.value === undefined ? { field: n.field, op: n.op } : { field: n.field, op: n.op, value: v.value as never };
  };
  return walk(root) ?? undefined;
}

/** Number of finished conditions in a saved filter (for the badge on the button). */
export function countConditions(node: FilterNode | undefined): number {
  if (!node) return 0;
  if ("and" in node) return node.and.reduce((n, x) => n + countConditions(x), 0);
  if ("or" in node) return node.or.reduce((n, x) => n + countConditions(x), 0);
  return 1;
}

/** Fields a filter refers to. */
export function filterFields(node: FilterNode | undefined): string[] {
  if (!node) return [];
  if ("and" in node) return node.and.flatMap(filterFields);
  if ("or" in node) return node.or.flatMap(filterFields);
  return [node.field];
}

/** The filter without the conditions that refer to columns that no longer exist (or cannot be filtered any more). */
export function pruneFilter(node: FilterNode | undefined, ok: (field: string) => boolean): FilterNode | undefined {
  if (!node) return undefined;
  if ("and" in node) {
    const kids = node.and.map((n) => pruneFilter(n, ok)).filter((x): x is FilterNode => !!x);
    return kids.length ? { and: kids } : undefined;
  }
  if ("or" in node) {
    const kids = node.or.map((n) => pruneFilter(n, ok)).filter((x): x is FilterNode => !!x);
    return kids.length ? { or: kids } : undefined;
  }
  return ok(node.field) ? node : undefined;
}

// ------------------------------------------------------------------------------------------------ column references

const nameKey = (s: string) => s.normalize("NFC").trim().toLowerCase();

/**
 * A view made through the API or by an AI may name its columns by name ("Doanh thu") instead of by key; the server accepts both.
 * The screen works with keys, so references are turned into keys when the view is loaded (names the table does not know stay as they are
 * and show up as deleted columns).
 */
export function normalizeConfig(config: ViewConfig, columns: Column[]): ViewConfig {
  const keys = new Set(columns.map((c) => c.key));
  const byName = new Map(columns.map((c) => [nameKey(c.name), c.key] as const));
  const meta = new Set(["_created_at", "_updated_at"]);
  const ref = (f: string): string => (keys.has(f) || meta.has(f) ? f : (byName.get(nameKey(f)) ?? f));
  const walk = (n: FilterNode): FilterNode => ("and" in n ? { and: n.and.map(walk) } : "or" in n ? { or: n.or.map(walk) } : { ...n, field: ref(n.field) });
  const out: ViewConfig = { ...config };
  if (config.filter) out.filter = walk(config.filter);
  if (config.sort) out.sort = config.sort.map((s) => ({ ...s, field: ref(s.field) }));
  if (config.group) out.group = config.group.map((g) => ({ ...g, field: ref(g.field) }));
  if (config.hidden) out.hidden = config.hidden.map(ref);
  if (config.order) out.order = config.order.map(ref);
  if (config.widths) out.widths = Object.fromEntries(Object.entries(config.widths).map(([k, v]) => [ref(k), v]));
  if (config.group_aggs) out.group_aggs = Object.fromEntries(Object.entries(config.group_aggs).map(([k, v]) => [ref(k), v])) as Record<string, GroupFn>;
  if (config.colors) out.colors = config.colors.map((c) => ({ ...c, filter: walk(c.filter) }));
  if (config.time_filter) out.time_filter = { ...config.time_filter, columns: config.time_filter.columns.map(ref) };
  return out;
}

// ------------------------------------------------------------------------------------------------ dead references

export interface DeadRefs {
  /** Settings of the view that point at columns that were deleted. */
  filter: number;
  sort: number;
  group: number;
  colors: number;
  time: boolean;
  total: number;
}

/**
 * A view keeps working when a column it uses is deleted: the setting that refers to it is ignored and the toolbar says so.
 * Returns the config the server can run (without the dead references) and what was dropped.
 */
export function pruneConfig(config: ViewConfig, columns: Column[]): { config: ViewConfig; dead: DeadRefs } {
  const alive = new Map(columns.map((c) => [c.key, c]));
  const okFilter = (f: string) => {
    const c = alive.get(f);
    return !!c && isFilterable(c);
  };
  const out: ViewConfig = { ...config };
  const dead: DeadRefs = { filter: 0, sort: 0, group: 0, colors: 0, time: false, total: 0 };

  if (config.filter) {
    const before = countConditions(config.filter);
    out.filter = pruneFilter(config.filter, okFilter);
    dead.filter = before - countConditions(out.filter);
    if (!out.filter) delete out.filter;
  }
  if (config.sort) {
    out.sort = config.sort.filter((s) => {
      const c = alive.get(s.field);
      return !!c && isSortable(c);
    });
    dead.sort = config.sort.length - out.sort.length;
    if (out.sort.length === 0) delete out.sort;
  }
  if (config.group) {
    out.group = config.group.filter((g) => {
      const c = alive.get(g.field);
      return !!c && isGroupable(c);
    });
    dead.group = config.group.length - out.group.length;
    if (out.group.length === 0) {
      delete out.group;
      delete out.group_aggs;
    }
  }
  if (out.group_aggs) {
    const aggs = Object.fromEntries(Object.entries(out.group_aggs).filter(([k]) => alive.has(k)));
    if (Object.keys(aggs).length) out.group_aggs = aggs as Record<string, GroupFn>;
    else delete out.group_aggs;
  }
  if (config.colors) {
    out.colors = config.colors.map((r) => ({ ...r, filter: pruneFilter(r.filter, okFilter) as FilterNode })).filter((r) => !!r.filter);
    dead.colors = config.colors.length - out.colors.length;
    if (out.colors.length === 0) delete out.colors;
  }
  if (config.time_filter) {
    const cols = config.time_filter.columns.filter((k) => k === "_created_at" || k === "_updated_at" || (alive.has(k) && isDateColumn(alive.get(k)!)));
    if (cols.length === 0) {
      delete out.time_filter;
      dead.time = true;
    } else if (cols.length !== config.time_filter.columns.length) out.time_filter = { ...config.time_filter, columns: cols };
  }
  dead.total = dead.filter + dead.sort + dead.group + dead.colors + (dead.time ? 1 : 0);
  return { config: out, dead };
}

// ------------------------------------------------------------------------------------------------ the query of a view

/** What a session reads: the filter, sort, search and the pieces the server computes per row or per group. */
export interface SessionQuery {
  filter?: FilterNode;
  /** JSON of `[{field, dir, nulls}]`. */
  sort?: string;
  search?: string;
  timeFilter?: TimeFilter;
  marks?: FilterNode[];
  group?: { field: string; dir: "asc" | "desc" }[];
  aggs?: Record<string, GroupFn>;
}

/**
 * The rows a view shows, as the server reads them. With a grouping, the rows are sorted by the group columns first (empty last,
 * the same order the group list uses) and then by the view's own sort, so a group's rows are one block in the list.
 */
export function buildQuery(config: ViewConfig, columns: Column[], search = ""): SessionQuery {
  const { config: c } = pruneConfig(config, columns);
  const group = (c.group ?? []).map((g) => ({ field: g.field, dir: g.dir ?? ("asc" as const) }));
  const sortItems: SortItem[] = [...group.map((g) => ({ field: g.field, dir: g.dir, nulls: "last" as const })), ...(c.sort ?? []).filter((s) => !group.some((g) => g.field === s.field))];
  const q: SessionQuery = {};
  if (c.filter) q.filter = c.filter;
  if (sortItems.length) q.sort = JSON.stringify(sortItems);
  if (search.trim()) q.search = search.trim();
  if (c.time_filter) q.timeFilter = c.time_filter;
  if (c.colors?.length) q.marks = c.colors.map((r) => r.filter);
  if (group.length) {
    q.group = group;
    if (c.group_aggs) q.aggs = c.group_aggs;
  }
  return q;
}

/** Stable text of a query: the session is rebuilt exactly when this changes. */
export const querySignature = (q: SessionQuery): string => JSON.stringify(q);

// ------------------------------------------------------------------------------------------------ the layout of a view

export interface ColumnLayout {
  /** Columns on screen, in order. */
  columns: Column[];
  /** Number of leading columns that stay put when scrolling sideways. */
  frozen: number;
  widths: Record<string, number>;
}

/** Visible columns of a view in the order of the view (columns the view does not list come last, in table order). */
export function layoutColumns(config: ViewConfig, columns: Column[]): ColumnLayout {
  const hidden = new Set(config.hidden ?? []);
  const rank = new Map((config.order ?? []).map((k, i) => [k, i] as const));
  const sorted = [...columns].sort((a, b) => {
    const ra = rank.get(a.key);
    const rb = rank.get(b.key);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.position - b.position;
  });
  const visible = sorted.filter((c) => !hidden.has(c.key));
  return { columns: visible, frozen: Math.min(config.frozen ?? 0, Math.max(0, visible.length - 1)), widths: config.widths ?? {} };
}

/** Moves a column inside the order of the view; `order` lists every column in the view's order. */
export function moveColumn(order: string[], key: string, to: number): string[] {
  const rest = order.filter((k) => k !== key);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, key);
  return rest;
}

/** The order of all columns of the table for a view (the saved order, then the columns it does not list). */
export function fullOrder(config: ViewConfig, columns: Column[]): string[] {
  const all = columns.map((c) => c.key);
  const known = (config.order ?? []).filter((k) => all.includes(k));
  return [...known, ...all.filter((k) => !known.includes(k))];
}

// ------------------------------------------------------------------------------------------------ autosave

/**
 * What to send to save `next` over `prev`: only the settings that changed; a setting that is now empty is sent as `null`
 * (the server removes it). Nothing changed -> `null`.
 */
export function diffConfig(prev: ViewConfig, next: ViewConfig): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    const a = (prev as Record<string, unknown>)[k];
    const b = (next as Record<string, unknown>)[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    patch[k] = b === undefined ? null : b;
  }
  return Object.keys(patch).length ? patch : null;
}

/** A patch applied to a config as the server does: `null` removes the setting. */
export function applyPatch(config: ViewConfig, patch: Record<string, unknown>): ViewConfig {
  const out: Record<string, unknown> = { ...config };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out as ViewConfig;
}

/** Who a change lands on, for the line under the toolbar (mục 5.2). */
export function saveTarget(view: Pick<ViewDto, "shared" | "has_override">, tableAccess: "owner" | "edit_data" | "view"): "shared" | "personal" | "copy" {
  if (!view.shared) return "personal";
  return tableAccess === "owner" ? "shared" : "copy";
}

