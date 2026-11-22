import { randomBytes } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { AppError, COLUMN_TYPES, type ColumnType } from "@soe/shared";
import type { FieldType } from "@soe/db";
import { assertColumnKey, CellError, OPTION_MEANINGS, type DhColumn, type PersonEntry, type SelectOption, type Stored } from "./types";
import { MAX_PEOPLE, userAttrSchema, userAttrs, userIdsOf, type UserAttr } from "./user-values";

/**
 * Column-type registry (design module2 section 4). One definition per type: its config, how a value is validated
 * and normalised, how it is searched, filtered and sorted. Stage 2B adds formula, relation, lookup and rollup by
 * calling `registerColumnType` (their names are reserved here with `available: false`).
 */

export type ColCtx = Pick<DhColumn, "key" | "name" | "config">;

export interface ColumnTypeDef {
  type: ColumnType;
  label: string;
  group: "basic" | "select" | "contact" | "file" | "link" | "compute" | "system";
  /** False for reserved types that Stage 2B implements. Creating such a column is refused. */
  available: boolean;
  /** Users and the API can write values. False for auto number, system and computed columns. */
  writable: boolean;
  /** Virtual: no value in `data`; reads a standard column of the row (row id, created time...). */
  virtual?: boolean;
  /** Filter type, or null when the column cannot be filtered. */
  fieldType: FieldType | null;
  /** SQL for the typed value, reading `dh_rows.data` (or a standard column for virtual types). */
  expr(key: string): SQL;
  /** Sort expression when it differs from `expr` (select columns sort by option order). */
  sortExpr?(col: ColCtx): SQL | null;
  sortable: boolean;
  /** Index kind (see `soe_dh_ensure_index`) for equality, range and sort. */
  indexKind: "num" | "text" | "date" | "ts" | "bool" | "uuid" | null;
  /** Can the column carry the "unique" property. */
  uniqueable: boolean;
  configSchema: z.ZodType<Record<string, unknown>>;
  defaultConfig(): Record<string, unknown>;
  /** Validates and normalises one input value. Returns `null` for empty. Throws `CellError` (message without the value). */
  parse(value: unknown, col: ColCtx): Stored;
  /** Plain value (string, number, boolean or null) used when converting to another type. */
  toPlain(value: Stored, col: ColCtx): string | number | boolean | null;
  /** Text that goes into the table-wide search column. */
  searchText?(value: Stored, col: ColCtx): string | null;
  /** Ids referenced by a stored value that must exist (checked once per batch). */
  refs?(value: Stored): { users?: string[]; files?: string[] };
  /** Human form of a stored value (`labels=true`): option ids become names. */
  toLabel?(value: Stored, col: ColCtx): unknown;
}

const registry = new Map<ColumnType, ColumnTypeDef>();

export function registerColumnType(def: ColumnTypeDef): void {
  registry.set(def.type, def);
}

export function columnTypeDef(type: string): ColumnTypeDef {
  const d = registry.get(type as ColumnType);
  if (!d) throw new AppError("validation_error", `Kiểu cột "${type}" không tồn tại.`);
  return d;
}

export function listColumnTypes(): ColumnTypeDef[] {
  return COLUMN_TYPES.map((t) => registry.get(t)!).filter(Boolean);
}

// ------------------------------------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------------------------------------

const j = (key: string) => sql.raw(`data->>'${assertColumnKey(key)}'`);
const jb = (key: string) => sql.raw(`data->'${assertColumnKey(key)}'`);

const isEmptyInput = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function parseNumber(v: unknown, what: string): number {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new CellError(`${what} phải là số hợp lệ.`);
    return v;
  }
  if (typeof v === "string") {
    let t = v.trim().replace(/\s+/g, "");
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
    if (/^-?\d+(\.\d+)?$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return n;
    }
  }
  throw new CellError(`${what} phải là số.`);
}

const MAX_ABS = 1e15;

function plainNumber(v: unknown, what: string): number {
  const n = parseNumber(v, what);
  if (Math.abs(n) > MAX_ABS) throw new CellError(`${what} vượt quá giới hạn cho phép.`);
  return n;
}

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1 && y <= 9999;
}

/** `YYYY-MM-DD`, also `dd/mm/yyyy` and `dd-mm-yyyy` (the Vietnamese way of writing a date). */
function parseDateString(v: string): string {
  const t = v.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else throw new CellError("Ngày phải có dạng YYYY-MM-DD (hoặc dd/mm/yyyy).");
  if (!validDate(y, m, d)) throw new CellError("Ngày không tồn tại.");
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** ISO 8601 with an offset or `Z`; without one the time is taken as Vietnam time (+07:00). Stored as UTC. */
function parseDateTimeString(v: string): string {
  let t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) t += "T00:00:00";
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(t)) {
    throw new CellError("Ngày giờ phải có dạng ISO 8601, ví dụ 2026-11-18T09:30:00+07:00.");
  }
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(t)) t += "+07:00";
  const ms = Date.parse(t.replace(" ", "T"));
  if (Number.isNaN(ms)) throw new CellError("Ngày giờ không hợp lệ.");
  return new Date(ms).toISOString();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();

function optionsOf(col: ColCtx): SelectOption[] {
  return (col.config.options as SelectOption[] | undefined) ?? [];
}

function resolveOption(input: unknown, col: ColCtx): string {
  if (typeof input !== "string" || input.trim() === "") throw new CellError(`Lựa chọn của cột "${col.name}" phải là chữ.`);
  const opts = optionsOf(col);
  const byId = opts.find((o) => o.id === input);
  if (byId) return byId.id;
  const n = norm(input);
  const byName = opts.find((o) => norm(o.name) === n);
  if (byName) return byName.id;
  throw new CellError(`Lựa chọn không có trong cột "${col.name}".`);
}

export function newOptionId(): string {
  return `o_${randomBytes(5).toString("hex").slice(0, 8)}`;
}

/** Column key: stable, random, never derived from the name. */
export function newColumnKey(): string {
  return `c_${randomBytes(5).toString("hex").slice(0, 8)}`;
}

const emptyConfig = z.strictObject({});

const OptionSchema = z.strictObject({
  id: z.string().regex(/^o_[a-z0-9]{4,12}$/, "Mã lựa chọn không hợp lệ.").optional(),
  name: z.string().normalize("NFC").trim().min(1, "Tên lựa chọn không được để trống.").max(100, "Tên lựa chọn tối đa 100 ký tự."),
  color: z.string().trim().max(20).optional(),
  meaning: z.enum(OPTION_MEANINGS).optional(),
});

/** Select options: ids assigned for new ones, names unique in the column (case-insensitive), order = sort order. */
export function normalizeOptions(raw: unknown): SelectOption[] {
  const list = z.array(OptionSchema).max(200, "Tối đa 200 lựa chọn.").parse(raw);
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  return list.map((o) => {
    const key = norm(o.name);
    if (seenNames.has(key)) throw new AppError("validation_error", `Tên lựa chọn bị trùng: "${o.name}".`);
    seenNames.add(key);
    let id = o.id ?? newOptionId();
    while (seenIds.has(id)) id = newOptionId();
    seenIds.add(id);
    return { id, name: o.name, ...(o.color ? { color: o.color } : {}), ...(o.meaning ? { meaning: o.meaning } : {}) };
  });
}

function checkAttrs(attrs: UserAttr[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const a of attrs) {
    if (seen.has(a.key)) ctx.addIssue({ code: "custom", message: `Mã thuộc tính bị trùng: "${a.key}".` });
    seen.add(a.key);
    if (a.kind === "select" && (!a.options || a.options.length === 0)) ctx.addIssue({ code: "custom", message: `Thuộc tính "${a.label}" kiểu nhãn cần danh sách nhãn.` });
    if (a.kind !== "select" && a.options) ctx.addIssue({ code: "custom", message: `Thuộc tính "${a.label}" không có danh sách nhãn.` });
    if ((a.sum_max !== undefined || a.cap_param !== undefined || a.cap_role !== undefined) && a.kind !== "percent") ctx.addIssue({ code: "custom", message: `Giới hạn tổng chỉ dùng cho thuộc tính phần trăm ("${a.label}").` });
  }
}

/** One attribute value: a label of the list, a fraction 0..1 ("25%" is read as 0.25), or yes/no. Empty gives the default (or nothing). */
function parseAttr(a: UserAttr, v: unknown, col: ColCtx): string | number | boolean | undefined {
  const empty = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  if (empty) return a.default === null || a.default === undefined ? undefined : (a.default as string | number | boolean);
  const what = `Thuộc tính "${a.label}" của cột "${col.name}"`;
  if (a.kind === "select") {
    const hit = typeof v === "string" ? a.options!.find((o) => norm(o) === norm(v)) : undefined;
    if (!hit) throw new CellError(`${what} chỉ nhận một trong: ${a.options!.join(", ")}.`);
    return hit;
  }
  if (a.kind === "percent") {
    const n = typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*%\s*$/.test(v) ? plainNumber(v.replace("%", ""), what) / 100 : plainNumber(v, what);
    if (n < 0 || n > 1) throw new CellError(`${what} phải từ 0% đến 100%.`);
    return n;
  }
  if (typeof v === "boolean") return v;
  if (typeof v === "string" && ["true", "có", "co", "yes"].includes(norm(v))) return true;
  if (typeof v === "string" && ["false", "không", "khong", "no"].includes(norm(v))) return false;
  throw new CellError(`${what} chỉ nhận có/không.`);
}

/** A list of people with attributes: `[{ id, attrs }]` (a bare uuid is a person with the default attributes). Every person once, at most MAX_PEOPLE. */
function parsePeople(value: unknown, col: ColCtx, attrs: UserAttr[]): PersonEntry[] | null {
  if (isEmptyInput(value)) return null;
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) return null;
  if (list.length > MAX_PEOPLE) throw new CellError(`Cột "${col.name}" tối đa ${MAX_PEOPLE} người.`);
  const out: PersonEntry[] = [];
  const notGiven: Set<string>[] = [];
  for (const e of list) {
    const raw = typeof e === "string" ? { id: e, attrs: {} } : e && typeof e === "object" ? (e as { id?: unknown; attrs?: unknown }) : null;
    const id = typeof raw?.id === "string" ? raw.id.trim().toLowerCase() : "";
    if (!UUID_RE.test(id)) throw new CellError(`Cột "${col.name}" cần danh sách người dùng: mã người (uuid) kèm thuộc tính.`);
    if (out.some((x) => x.id === id)) throw new CellError(`Cột "${col.name}": mỗi người chỉ xuất hiện một lần.`);
    const given = (raw!.attrs && typeof raw!.attrs === "object" ? raw!.attrs : {}) as Record<string, unknown>;
    for (const k of Object.keys(given)) if (!attrs.some((a) => a.key === k)) throw new CellError(`Cột "${col.name}" không có thuộc tính "${k}".`);
    const outAttrs: PersonEntry["attrs"] = {};
    for (const a of attrs) {
      const v = parseAttr(a, given[a.key], col);
      if (v !== undefined) outAttrs[a.key] = v;
    }
    out.push({ id, attrs: outAttrs });
    notGiven.push(new Set(attrs.filter((a) => given[a.key] === undefined || given[a.key] === null || given[a.key] === "").map((a) => a.key)));
  }
  // A value the person did not give may depend on another attribute (a lone Leading has all the revenue; a Leading counts as a deal).
  for (const a of attrs) {
    const w = a.default_when;
    if (!w) continue;
    const matching = out.filter((e) => e.attrs[w.attr] === w.value);
    if (w.only_one && matching.length !== 1) continue;
    out.forEach((e, n) => {
      if (e.attrs[w.attr] === w.value && notGiven[n]!.has(a.key)) e.attrs[a.key] = w.set;
    });
  }
  for (const a of attrs) {
    if (a.sum_max === undefined) continue;
    const total = out.reduce((s, e) => s + (typeof e.attrs[a.key] === "number" ? (e.attrs[a.key] as number) : 0), 0);
    if (total > a.sum_max + 1e-9) throw new CellError(`Tổng "${a.label}" của cột "${col.name}" là ${Math.round(total * 10000) / 100}%, vượt mức tối đa ${Math.round(a.sum_max * 10000) / 100}%.`);
  }
  return out;
}

const selectConfig = z.strictObject({ options: z.array(z.unknown()).default([]) });

const plain = (v: Stored): string | number | boolean | null => (Array.isArray(v) ? v.join(", ") : v);

// ------------------------------------------------------------------------------------------------
// definitions
// ------------------------------------------------------------------------------------------------

function textLike(type: "text" | "long_text" | "email" | "phone" | "url", label: string, group: ColumnTypeDef["group"], parseValue: (s: string, col: ColCtx) => string): ColumnTypeDef {
  const maxDefault = type === "long_text" ? 100_000 : type === "url" ? 2000 : 1000;
  return {
    type, label, group, available: true, writable: true,
    fieldType: "text",
    expr: j,
    sortable: true,
    indexKind: "text",
    uniqueable: type !== "long_text",
    configSchema: z.strictObject({ max_length: z.number().int().min(1).max(100_000).optional() }),
    defaultConfig: () => ({}),
    parse(value, col) {
      if (isEmptyInput(value)) return null;
      if (typeof value !== "string") throw new CellError(`Cột "${col.name}" cần giá trị chữ.`);
      const s = parseValue(value, col);
      const max = (col.config.max_length as number | undefined) ?? maxDefault;
      if (s.length > max) throw new CellError(`Cột "${col.name}" tối đa ${max} ký tự.`);
      return s;
    },
    toPlain: plain,
    searchText: (v) => (typeof v === "string" ? v : null),
  };
}

const defs: ColumnTypeDef[] = [
  textLike("text", "Văn bản", "basic", (s) => s.trim()),
  textLike("long_text", "Văn bản dài", "basic", (s) => s),
  textLike("email", "Email", "contact", (s, col) => {
    const e = s.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new CellError(`Cột "${col.name}" cần một email hợp lệ.`);
    return e;
  }),
  textLike("phone", "Điện thoại", "contact", (s, col) => {
    const p = s.trim();
    if (!/^\+?[0-9 .\-()]{6,20}$/.test(p)) throw new CellError(`Cột "${col.name}" cần số điện thoại hợp lệ.`);
    return p;
  }),
  textLike("url", "URL", "contact", (s, col) => {
    const u = s.trim();
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("scheme");
    } catch {
      throw new CellError(`Cột "${col.name}" cần đường dẫn http(s) hợp lệ.`);
    }
    return u;
  }),

  {
    type: "number", label: "Số", group: "basic", available: true, writable: true,
    fieldType: "number", expr: (k) => sql`(${j(k)})::numeric`, sortable: true, indexKind: "num", uniqueable: true,
    configSchema: z.strictObject({ precision: z.number().int().min(0).max(10).optional() }),
    defaultConfig: () => ({}),
    parse(value, col) {
      if (isEmptyInput(value)) return null;
      let n = plainNumber(value, `Cột "${col.name}"`);
      const p = col.config.precision as number | undefined;
      if (p !== undefined) n = Number(n.toFixed(p));
      return n;
    },
    toPlain: plain,
  },
  {
    type: "currency", label: "Tiền (VND)", group: "basic", available: true, writable: true,
    fieldType: "number", expr: (k) => sql`(${j(k)})::numeric`, sortable: true, indexKind: "num", uniqueable: true,
    configSchema: emptyConfig, defaultConfig: () => ({}),
    parse(value, col) {
      if (isEmptyInput(value)) return null;
      const n = plainNumber(value, `Cột "${col.name}"`);
      if (!Number.isSafeInteger(n)) throw new CellError(`Cột "${col.name}" là tiền VND, phải là số nguyên.`);
      return n;
    },
    toPlain: plain,
  },
  {
    type: "percent", label: "Phần trăm", group: "basic", available: true, writable: true,
    fieldType: "number", expr: (k) => sql`(${j(k)})::numeric`, sortable: true, indexKind: "num", uniqueable: false,
    configSchema: emptyConfig, defaultConfig: () => ({}),
    // Stored as a fraction: 0.25 = 25%. A string such as "25%" is accepted and converted.
    parse(value, col) {
      if (isEmptyInput(value)) return null;
      if (typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*%\s*$/.test(value)) return plainNumber(value.replace("%", ""), `Cột "${col.name}"`) / 100;
      return plainNumber(value, `Cột "${col.name}"`);
    },
    toPlain: plain,
  },
  {
    type: "date", label: "Ngày", group: "basic", available: true, writable: true,
    fieldType: "date", expr: (k) => sql`soe_date(${j(k)})`, sortable: true, indexKind: "date", uniqueable: true,
    configSchema: emptyConfig, defaultConfig: () => ({}),
    parse(value, col) {
      if (isEmptyInput(value)) return null;
      if (typeof value !== "string") throw new CellError(`Cột "${col.name}" cần ngày dạng YYYY-MM-DD.`);
      return parseDateString(value);
    },
    toPlain: plain,
  },
  {
    type: "datetime", label: "Ngày giờ", group: "basic", available: true, writable: true,
    fieldType: "datetime", expr: (k) => sql`soe_ts(${j(k)})`, sortable: true, indexKind: "ts", uniqueable: true,
    configSchema: emptyConfig, defaultConfig: () => ({}),
    parse(value, col) {
      if (isEmptyInput(value)) return null;
      if (typeof value !== "string") throw new CellError(`Cột "${col.name}" cần ngày giờ dạng ISO 8601.`);
      return parseDateTimeString(value);
    },
    toPlain: plain,
  },
  {
    type: "checkbox", label: "Checkbox", group: "basic", available: true, writable: true,
    // An empty checkbox counts as unchecked, so filters on `false` find rows that never set it.
    fieldType: "boolean", expr: (k) => sql`coalesce((${j(k)})::boolean, false)`, sortable: true, indexKind: null, uniqueable: false,
    configSchema: emptyConfig, defaultConfig: () => ({}),
    parse(value, col) {
      if (value === null || value === undefined || value === "") return null;
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        const t = norm(value);
        if (["true", "1", "x", "yes", "có", "co"].includes(t)) return true;
        if (["false", "0", "no", "không", "khong"].includes(t)) return false;
      }
      throw new CellError(`Cột "${col.name}" cần giá trị true/false.`);
    },
    toPlain: plain,
  },
  {
    type: "rating", label: "Đánh giá (sao)", group: "basic", available: true, writable: true,
    fieldType: "number", expr: (k) => sql`(${j(k)})::numeric`, sortable: true, indexKind: "num", uniqueable: false,
    configSchema: z.strictObject({ max: z.number().int().min(1).max(10).default(5) }),
    defaultConfig: () => ({ max: 5 }),
    parse(value, col) {
      if (isEmptyInput(value)) return null;
      const n = plainNumber(value, `Cột "${col.name}"`);
      const max = (col.config.max as number | undefined) ?? 5;
      if (!Number.isInteger(n) || n < 0 || n > max) throw new CellError(`Cột "${col.name}" nhận số sao từ 0 đến ${max}.`);
      return n === 0 ? null : n;
    },
    toPlain: plain,
  },
  {
    type: "single_select", label: "Một lựa chọn", group: "select", available: true, writable: true,
    fieldType: "enum", expr: j, sortable: true, indexKind: "text", uniqueable: true,
    // Sort follows the order the user gave the options (design section 5.3), not the alphabet.
    sortExpr(col) {
      const opts = optionsOf(col);
      if (opts.length === 0) return null;
      return sql`array_position(ARRAY[${sql.join(opts.map((o) => sql`${o.id}`), sql`, `)}]::text[], ${j(col.key)})`;
    },
    configSchema: selectConfig,
    defaultConfig: () => ({ options: [] }),
    parse(value, col) {
      if (isEmptyInput(value)) return null;
      return resolveOption(value, col);
    },
    toPlain: (v, col) => (typeof v === "string" ? (optionsOf(col).find((o) => o.id === v)?.name ?? null) : null),
    searchText: (v, col) => (typeof v === "string" ? (optionsOf(col).find((o) => o.id === v)?.name ?? null) : null),
    toLabel: (v, col) => (typeof v === "string" ? (optionsOf(col).find((o) => o.id === v)?.name ?? v) : v),
  },
  {
    type: "multi_select", label: "Nhiều lựa chọn", group: "select", available: true, writable: true,
    fieldType: "set", expr: jb, sortable: false, indexKind: null, uniqueable: false,
    configSchema: selectConfig,
    defaultConfig: () => ({ options: [] }),
    parse(value, col) {
      if (value === null || value === undefined) return null;
      const arr = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
      if (!arr) throw new CellError(`Cột "${col.name}" cần danh sách lựa chọn.`);
      const ids: string[] = [];
      for (const x of arr) {
        if (typeof x === "string" && x.trim() === "") continue;
        const id = resolveOption(x, col);
        if (!ids.includes(id)) ids.push(id);
      }
      return ids.length ? ids : null;
    },
    toPlain: (v, col) => (Array.isArray(v) ? v.map((id) => optionsOf(col).find((o) => o.id === id)?.name ?? id).join(", ") : null),
    searchText: (v, col) => (Array.isArray(v) ? v.map((id) => optionsOf(col).find((o) => o.id === id)?.name ?? "").join(" ") : null),
    toLabel: (v, col) => (Array.isArray(v) ? v.map((id) => optionsOf(col).find((o) => o.id === id)?.name ?? id) : v),
  },
  {
    type: "user", label: "Người dùng", group: "contact", available: true, writable: true,
    fieldType: "uuid", expr: (k) => sql`(${j(k)})::uuid`, sortable: true, indexKind: "uuid", uniqueable: true,
    configSchema: z.strictObject({ attrs: z.array(userAttrSchema).max(8, "Tối đa 8 thuộc tính.").optional() }).superRefine((c, ctx) => checkAttrs(c.attrs ?? [], ctx)),
    defaultConfig: () => ({}),
    parse(value, col) {
      const attrs = userAttrs({ type: "user", config: col.config });
      if (attrs.length) return parsePeople(value, col, attrs);
      if (isEmptyInput(value)) return null;
      if (typeof value !== "string" || !UUID_RE.test(value.trim())) throw new CellError(`Cột "${col.name}" cần mã người dùng (uuid).`);
      return value.trim().toLowerCase();
    },
    toPlain: (v) => (Array.isArray(v) ? userIdsOf(v).join(", ") : plain(v)),
    searchText: () => null,
    refs: (v) => ({ users: userIdsOf(v) }),
  },
  {
    type: "attachment", label: "Đính kèm", group: "file", available: true, writable: true,
    fieldType: "set", expr: jb, sortable: false, indexKind: null, uniqueable: false,
    configSchema: z.strictObject({ max_files: z.number().int().min(1).max(50).optional() }),
    defaultConfig: () => ({}),
    parse(value, col) {
      if (value === null || value === undefined) return null;
      if (!Array.isArray(value)) throw new CellError(`Cột "${col.name}" cần danh sách mã file.`);
      const ids = [...new Set(value.map((x) => (typeof x === "string" ? x.trim().toLowerCase() : "")))];
      if (ids.some((x) => !UUID_RE.test(x))) throw new CellError(`Cột "${col.name}" cần mã file (uuid).`);
      const max = (col.config.max_files as number | undefined) ?? 20;
      if (ids.length > max) throw new CellError(`Cột "${col.name}" tối đa ${max} file.`);
      return ids.length ? ids : null;
    },
    toPlain: () => null,
    refs: (v) => ({ files: Array.isArray(v) ? (v as string[]) : [] }),
  },
  {
    type: "auto_number", label: "Số tự tăng", group: "compute", available: true, writable: false,
    fieldType: "number", expr: (k) => sql`(${j(k)})::numeric`, sortable: true, indexKind: "num", uniqueable: false,
    configSchema: z.strictObject({ start: z.number().int().min(0).max(1e9).default(1), seq: z.number().int().optional() }),
    defaultConfig: () => ({ start: 1 }),
    parse() {
      throw new CellError("Cột số tự tăng do hệ thống điền, không sửa được.");
    },
    toPlain: plain,
  },
];

/**
 * "Ngày sửa của cột…" (design module2 section 4): the moment a person, the API, a form or a command last changed one of 1-5 watched columns of the row.
 * Kept in `data` as an ISO instant like a date-time column; nobody types into it. The row writer sets it (`field-modified.ts`); a formula recalculation
 * does not, and neither does a value written by the system (same rule as the logs).
 */
export const MAX_WATCH = 5;
defs.push({
  type: "field_modified", label: "Ngày sửa của cột", group: "system", available: true, writable: false,
  fieldType: "datetime", expr: (k) => sql`soe_ts(${j(k)})`, sortable: true, indexKind: "ts", uniqueable: false,
  configSchema: z.strictObject({ watch: z.array(z.string().min(1).max(100)).min(1, "Chọn ít nhất một cột theo dõi.").max(MAX_WATCH, `Theo dõi tối đa ${MAX_WATCH} cột.`) }),
  defaultConfig: () => ({ watch: [] }),
  parse() {
    throw new CellError("Cột này do hệ thống điền khi cột được theo dõi đổi giá trị, không sửa được.");
  },
  toPlain: plain,
});

function systemType(type: "row_id" | "created_time" | "created_by" | "modified_time" | "modified_by", label: string, fieldType: FieldType, expr: string): ColumnTypeDef {
  return {
    type, label, group: "system", available: true, writable: false, virtual: true,
    fieldType, expr: () => sql.raw(expr), sortable: true, indexKind: null, uniqueable: false,
    configSchema: emptyConfig, defaultConfig: () => ({}),
    parse() {
      throw new CellError("Cột hệ thống không sửa được.");
    },
    toPlain: () => null,
  };
}

defs.push(
  systemType("row_id", "Mã dòng", "uuid", "id"),
  systemType("created_time", "Ngày tạo", "datetime", "created_at"),
  systemType("created_by", "Người tạo", "uuid", "created_by"),
  systemType("modified_time", "Ngày sửa", "datetime", "updated_at"),
  systemType("modified_by", "Người sửa", "uuid", "updated_by"),
);

// Computed and linked columns (stage 2B). Their configuration is checked by `computed.ts` (it needs the database);
// a computed column behaves like the plain type of its result (`config.result_type`) for filter, sort and index.
const computedBase = {
  group: "compute" as const,
  available: true,
  writable: false,
  fieldType: null,
  sortable: false,
  indexKind: null,
  uniqueable: false,
  configSchema: z.record(z.string(), z.unknown()),
  defaultConfig: () => ({}),
  parse(): never {
    throw new CellError("Cột tính toán do công thức điền, không sửa được.");
  },
  toPlain: () => null,
};
defs.push(
  { ...computedBase, type: "formula", label: "Công thức", expr: (k) => jb(k) },
  { ...computedBase, type: "lookup", label: "Lookup", group: "link", expr: (k) => jb(k) },
  { ...computedBase, type: "rollup", label: "Rollup", group: "link", expr: (k) => jb(k) },
  {
    type: "relation", label: "Liên kết dòng", group: "link", available: true, writable: true,
    fieldType: "set", expr: jb, sortable: false, indexKind: null, uniqueable: false,
    configSchema: z.record(z.string(), z.unknown()),
    defaultConfig: () => ({ multiple: true }),
    // Stored as an array of row ids of the target table. Existence of the rows is checked by the row writer.
    parse(value, col) {
      if (value === null || value === undefined) return null;
      const arr = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
      if (!arr) throw new CellError(`Cột "${col.name}" cần danh sách mã dòng.`);
      const ids = [...new Set(arr.map((x) => (typeof x === "string" ? x.trim().toLowerCase() : "")).filter((x) => x !== ""))];
      if (ids.some((x) => !UUID_RE.test(x))) throw new CellError(`Cột "${col.name}" cần mã dòng (uuid).`);
      if (col.config.multiple === false && ids.length > 1) throw new CellError(`Cột "${col.name}" chỉ liên kết được một dòng.`);
      if (ids.length > 500) throw new CellError(`Cột "${col.name}" liên kết tối đa 500 dòng.`);
      return ids.length ? ids : null;
    },
    toPlain: () => null,
  },
);

for (const d of defs) registerColumnType(d);

// ------------------------------------------------------------------------------------------------
// config / display
// ------------------------------------------------------------------------------------------------

export const DisplaySchema = z
  .strictObject({
    decimals: z.number().int().min(0).max(10),
    thousands: z.boolean(),
    unit: z.string().max(20),
    date_format: z.enum(["dd/mm/yyyy", "yyyy-mm-dd", "dd/mm/yyyy hh:mm"]),
    color: z.string().max(20),
  })
  .partial();

/** Validates a column config for its type and fills defaults; select options get ids. */
export function normalizeConfig(type: string, raw: unknown): Record<string, unknown> {
  const def = columnTypeDef(type);
  const r = def.configSchema.safeParse(raw ?? def.defaultConfig());
  if (!r.success) {
    throw new AppError("validation_error", `Cấu hình cột kiểu "${def.label}" không hợp lệ.`, { issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  const cfg = { ...r.data };
  if (type === "single_select" || type === "multi_select") cfg.options = normalizeOptions(cfg.options ?? []);
  return cfg;
}

export function normalizeDisplay(raw: unknown): Record<string, unknown> {
  const r = DisplaySchema.safeParse(raw ?? {});
  if (!r.success) throw new AppError("validation_error", "Định dạng hiển thị không hợp lệ.", { issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  return r.data;
}

// ------------------------------------------------------------------------------------------------
// conversion (type change)
// ------------------------------------------------------------------------------------------------

export type Conversion = { ok: true; value: Stored } | { ok: false };

/** Converts one stored value of `from` into the form of `to`. `ok: false` = the value cannot be converted. */
export function convertValue(from: ColCtx & { type: ColumnType }, to: ColCtx & { type: ColumnType }, value: Stored): Conversion {
  if (value === null) return { ok: true, value: null };
  const fdef = columnTypeDef(from.type);
  const tdef = columnTypeDef(to.type);
  try {
    let src: unknown = fdef.toPlain(value, from);
    // Several selections into a single choice: only a lone value converts.
    if (to.type === "single_select" && from.type === "multi_select" && Array.isArray(value) && value.length !== 1) return { ok: false };
    if (to.type === "multi_select" && typeof src === "string" && from.type !== "multi_select") src = [src];
    if (to.type === "checkbox" && typeof src === "number") src = src !== 0;
    if (to.type === "rating" && typeof src === "string") src = Number(src);
    if (from.type === "percent" && to.type === "text" && typeof src === "number") src = `${Number((src * 100).toFixed(6))}%`;
    if (to.type === "attachment" || (from.type === "attachment" && src === null)) return { ok: false };
    return { ok: true, value: tdef.parse(src, to) };
  } catch (e) {
    if (e instanceof CellError) return { ok: false };
    throw e;
  }
}

/** Text of a row for table-wide search: every text-like cell joined. Capped so one huge cell cannot bloat the index. */
export function buildSearchText(data: Record<string, Stored>, columns: DhColumn[]): string {
  const parts: string[] = [];
  for (const c of columns) {
    if (c.deletedAt) continue;
    const def = columnTypeDef(c.type);
    if (!def.searchText) continue;
    const v = data[c.key];
    if (v === undefined || v === null) continue;
    const t = def.searchText(v, c);
    if (t) parts.push(t);
  }
  return parts.join(" ").slice(0, 20_000);
}
