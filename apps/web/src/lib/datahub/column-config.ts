import { DH_NAME_MAX, DhNameSchema } from "@soe/shared";
import { ApiError } from "../api";
import { nameKey } from "./cells";
import type { Column, SelectOption } from "./types";

/**
 * The column editor's draft: every field as the person sees it (text boxes hold text), and the functions that turn it into the
 * body the API takes. The server checks everything again; this lets the screen say what is wrong under the right field first.
 */

export interface TypeInfo {
  type: string;
  label: string;
  group: string;
  available: boolean;
  writable: boolean;
  can_be_unique: boolean;
}

export const TYPE_GROUPS: { id: string; label: string }[] = [
  { id: "basic", label: "Cơ bản" },
  { id: "select", label: "Lựa chọn" },
  { id: "contact", label: "Liên hệ" },
  { id: "file", label: "File" },
  { id: "link", label: "Liên kết" },
  { id: "compute", label: "Tính toán" },
  { id: "system", label: "Hệ thống" },
];

/** Types a person can still make. System types are added by the system; they are listed last. */
export function groupedTypes(types: TypeInfo[]): { id: string; label: string; types: TypeInfo[] }[] {
  return TYPE_GROUPS.map((g) => ({ ...g, types: types.filter((t) => t.group === g.id && t.available) })).filter((g) => g.types.length > 0);
}

/** Types a column of this type can turn into (the server refuses computed, system and attachment columns on either side). */
export function convertibleTypes(types: TypeInfo[], current: string): TypeInfo[] {
  const from = types.find((t) => t.type === current);
  if (!from || !from.writable || current === "attachment") return [];
  return types.filter((t) => t.available && t.writable && t.type !== "attachment");
}

export const ROLLUP_FUNCTIONS: { value: string; label: string; numeric?: boolean }[] = [
  { value: "sum", label: "Tổng", numeric: true },
  { value: "avg", label: "Trung bình", numeric: true },
  { value: "min", label: "Nhỏ nhất" },
  { value: "max", label: "Lớn nhất" },
  { value: "count", label: "Đếm số" },
  { value: "counta", label: "Đếm ô không trống" },
  { value: "countunique", label: "Đếm giá trị khác nhau" },
  { value: "concat", label: "Nối chữ" },
];

export const RESULT_TYPES: { value: string; label: string }[] = [
  { value: "number", label: "Số" },
  { value: "percent", label: "Phần trăm" },
  { value: "text", label: "Chữ" },
  { value: "date", label: "Ngày" },
  { value: "datetime", label: "Ngày giờ" },
  { value: "checkbox", label: "Checkbox" },
];

export interface OptionDraft {
  id?: string;
  name: string;
  color: string;
}

/** One attribute of a Người dùng column as typed: options one per comma, limits as percent text. `extra` keeps what the form does not show (default, default_when). */
export interface AttrDraft {
  key: string;
  label: string;
  kind: "select" | "percent" | "boolean";
  options: string;
  sumMax: string;
  capParam: string;
  extra: Record<string, unknown>;
  /** Added in this form: its code follows the name until typed. A saved attribute keeps its code (the values of people are stored under it). */
  fresh: boolean;
}

export interface ColumnDraft {
  type: string;
  /** Người dùng: attributes of each person of a cell (role, share, yes/no). Empty = the cell holds people without attributes. */
  attrs: AttrDraft[];
  name: string;
  description: string;
  required: boolean;
  /** Members with the Sửa permission may type into this column (design module2 section 10). */
  allowEdit: boolean;
  unique: boolean;
  /** Text as typed; parsed with the column's own rules when sent. */
  defaultText: string;
  options: OptionDraft[];
  maxLength: string;
  precision: string;
  decimals: string;
  thousands: boolean;
  unit: string;
  ratingMax: string;
  maxFiles: string;
  start: string;
  multiple: boolean;
  targetTableId: string;
  relation: string;
  targetColumn: string;
  /** "Ngày sửa của cột": keys of the 1-5 watched columns. */
  watch: string[];
  fn: string;
  formula: string;
  /** "" = let the system work it out from the formula. */
  resultType: string;
}

export function emptyDraft(type = "text"): ColumnDraft {
  return {
    type,
    attrs: [],
    name: "",
    description: "",
    required: false,
    allowEdit: true,
    unique: false,
    defaultText: "",
    options: [],
    maxLength: "",
    precision: "",
    decimals: "",
    thousands: true,
    unit: "",
    ratingMax: "5",
    maxFiles: "",
    start: "1",
    multiple: true,
    targetTableId: "",
    relation: "",
    targetColumn: "",
    watch: [],
    fn: "sum",
    formula: "",
    resultType: "",
  };
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function attrDraftOf(a: Record<string, unknown>): AttrDraft {
  const { key, label, kind, options, sum_max, cap_param, ...extra } = a;
  return { key: str(key), label: str(label), kind: (kind as AttrDraft["kind"]) ?? "select", options: Array.isArray(options) ? options.join(", ") : "", sumMax: typeof sum_max === "number" ? String(Number((sum_max * 100).toPrecision(10))) : "", capParam: str(cap_param), extra, fresh: false };
}
export const emptyAttr = (): AttrDraft => ({ key: "", label: "", kind: "select", options: "", sumMax: "", capParam: "", extra: {}, fresh: true });
const optionList = (t: string) => t.split(",").map((x) => x.trim()).filter(Boolean);

export function draftFromColumn(col: Column): ColumnDraft {
  const d = emptyDraft(col.type);
  const c = col.config as Record<string, unknown>;
  return {
    ...d,
    attrs: Array.isArray(c.attrs) ? (c.attrs as Record<string, unknown>[]).map(attrDraftOf) : [],
    name: col.name,
    description: col.description ?? "",
    required: col.required,
    allowEdit: col.allow_edit !== false,
    unique: col.unique,
    options: (col.config.options ?? []).map((o) => ({ id: o.id, name: o.name, color: o.color ?? "gray" })),
    maxLength: str(c.max_length),
    precision: str(c.precision),
    decimals: str(col.display.decimals),
    thousands: col.display.thousands ?? true,
    unit: col.display.unit ?? "",
    ratingMax: str(c.max ?? 5),
    maxFiles: str(c.max_files),
    start: str(c.start ?? 1),
    multiple: c.multiple !== false,
    targetTableId: str(c.target_table_id),
    relation: str(c.relation),
    targetColumn: str(c.target_column),
    watch: Array.isArray(c.watch) ? (c.watch as unknown[]).map(String) : [],
    fn: str(c.fn || "sum"),
    formula: str(c.formula),
    resultType: str(c.result_type),
  };
}

/** Types that show a number: the format fields apply to them (and to computed columns whose result is a number). */
export const NUMBER_FORMAT_TYPES = new Set(["number", "percent", "currency"]);
export function hasNumberFormat(type: string, resultType: string): boolean {
  return NUMBER_FORMAT_TYPES.has(type) || (["formula", "lookup", "rollup"].includes(type) && (resultType === "number" || resultType === "percent"));
}
export const COMPUTED = new Set(["formula", "lookup", "rollup"]);
export const TEXT_LIKE = new Set(["text", "long_text", "email", "phone", "url"]);

const int = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** Configuration of the column for the API. Fields that do not belong to the type are left out. */
export function buildConfig(d: ColumnDraft): Record<string, unknown> {
  switch (d.type) {
    case "text":
    case "long_text":
    case "email":
    case "phone":
    case "url":
      return d.maxLength.trim() ? { max_length: int(d.maxLength) ?? 0 } : {};
    case "number":
      return d.precision.trim() ? { precision: int(d.precision) ?? 0 } : {};
    case "rating":
      return { max: int(d.ratingMax) ?? 5 };
    case "single_select":
    case "multi_select":
      return { options: d.options.map((o) => ({ ...(o.id ? { id: o.id } : {}), name: o.name.trim(), color: o.color })) };
    case "attachment":
      return d.maxFiles.trim() ? { max_files: int(d.maxFiles) ?? 0 } : {};
    case "auto_number":
      return { start: int(d.start) ?? 1 };
    case "relation":
      return { target_table_id: d.targetTableId, multiple: d.multiple };
    case "field_modified":
      return { watch: d.watch };
    case "lookup":
      return { relation: d.relation, target_column: d.targetColumn };
    case "rollup":
      return { relation: d.relation, target_column: d.targetColumn, fn: d.fn };
    case "formula": {
      const f = d.formula.trim();
      return { formula: f.startsWith("=") ? f : `=${f}`, ...(d.resultType ? { result_type: d.resultType } : {}) };
    }
    case "user":
      return d.attrs.length ? { attrs: d.attrs.map(attrBody) } : {};
    default:
      return {};
  }
}

function attrBody(a: AttrDraft): Record<string, unknown> {
  const sum = Number(a.sumMax.replace(",", "."));
  return {
    ...a.extra,
    key: a.key.trim(),
    label: a.label.trim(),
    kind: a.kind,
    ...(a.kind === "select" ? { options: optionList(a.options) } : {}),
    ...(a.kind === "percent" && a.sumMax.trim() !== "" && Number.isFinite(sum) ? { sum_max: Math.round(sum * 100) / 10000 } : {}),
    ...(a.kind === "percent" && a.capParam.trim() ? { cap_param: a.capParam.trim() } : {}),
  };
}

/** How values look. A formula, lookup or rollup that gives a number takes the same fields as a number column. */
export function buildDisplay(d: ColumnDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!hasNumberFormat(d.type, COMPUTED.has(d.type) ? d.resultType || "number" : d.type)) return out;
  if (d.decimals.trim() !== "") out.decimals = int(d.decimals) ?? 0;
  if (d.type !== "percent" && d.type !== "currency") out.thousands = d.thousands;
  if (d.type !== "percent" && d.unit.trim()) out.unit = d.unit.trim();
  return out;
}

export interface CreateBody {
  name: string;
  type: string;
  config: Record<string, unknown>;
  required?: boolean;
  allow_edit?: boolean;
  unique?: boolean;
  default_value?: unknown;
  description?: string | null;
  display?: Record<string, unknown>;
}

/** `defaultValue` is the parsed default (the editor parses it with `parseCellText`). */
export function buildBody(d: ColumnDraft, defaultValue: unknown): CreateBody {
  return {
    name: d.name.trim(),
    type: d.type,
    config: buildConfig(d),
    required: d.required,
    allow_edit: d.allowEdit,
    unique: d.unique,
    default_value: defaultValue ?? null,
    description: d.description.trim() || null,
    display: buildDisplay(d),
  };
}

/** Types that take a default value, a requirement and a unique mark. */
export function hasProperty(type: string, what: "default" | "required" | "unique" | "allow_edit", info?: TypeInfo): boolean {
  if (what === "allow_edit") return !COMPUTED.has(type) && type !== "auto_number" && !["row_id", "created_time", "created_by", "modified_time", "modified_by", "field_modified"].includes(type);
  if (COMPUTED.has(type) || type === "auto_number" || ["row_id", "created_time", "created_by", "modified_time", "modified_by", "field_modified"].includes(type)) return false;
  if (what === "unique") return info?.can_be_unique ?? false;
  if (what === "default") return !["relation", "attachment", "multi_select", "rating", "user"].includes(type);
  return true;
}

// ---- name and fields ---------------------------------------------------------------------------------------------------------

export function validateName(name: string, columns: Pick<Column, "id" | "name">[], selfId?: string): string | null {
  const r = DhNameSchema.safeParse(name);
  if (!r.success) return r.error.issues[0]?.message ?? "Tên không hợp lệ.";
  const key = nameKey(r.data);
  if (columns.some((c) => c.id !== selfId && nameKey(c.name) === key)) return "Bảng này đã có một cột tên này. Hãy đặt tên khác.";
  return null;
}

export type DraftErrors = Partial<Record<"name" | "options" | "maxLength" | "precision" | "decimals" | "ratingMax" | "maxFiles" | "start" | "targetTableId" | "relation" | "targetColumn" | "formula" | "unit" | "watch" | "attrs", string>>;

export function validateDraft(d: ColumnDraft, columns: Pick<Column, "id" | "name">[], selfId?: string): DraftErrors {
  const e: DraftErrors = {};
  const n = validateName(d.name, columns, selfId);
  if (n) e.name = n;
  const intField = (key: "maxLength" | "precision" | "decimals" | "ratingMax" | "maxFiles" | "start", v: string, min: number, max: number, what: string, optional = true) => {
    if (v.trim() === "" && optional) return;
    const x = int(v);
    if (x === null || x < min || x > max) e[key] = `${what} là số nguyên từ ${min} đến ${max}.`;
  };
  if (TEXT_LIKE.has(d.type)) intField("maxLength", d.maxLength, 1, 100_000, "Độ dài tối đa");
  if (d.type === "number") intField("precision", d.precision, 0, 10, "Số chữ số thập phân");
  if (d.type === "rating") intField("ratingMax", d.ratingMax, 1, 10, "Số sao", false);
  if (d.type === "attachment") intField("maxFiles", d.maxFiles, 1, 50, "Số file tối đa");
  if (d.type === "auto_number") intField("start", d.start, 0, 1_000_000_000, "Số bắt đầu", false);
  if (hasNumberFormat(d.type, COMPUTED.has(d.type) ? d.resultType || "number" : d.type)) intField("decimals", d.decimals, 0, 10, "Số chữ số thập phân");
  if (d.unit.length > 20) e.unit = "Đơn vị tối đa 20 ký tự.";
  if (d.type === "single_select" || d.type === "multi_select") {
    const seen = new Set<string>();
    for (const [i, o] of d.options.entries()) {
      const nm = o.name.trim();
      if (!nm) return { ...e, options: `Lựa chọn thứ ${i + 1} chưa có tên. Điền tên hoặc xoá lựa chọn.` };
      if (nm.length > 100) return { ...e, options: `Lựa chọn "${nm.slice(0, 30)}…" dài quá 100 ký tự.` };
      const k = nameKey(nm);
      if (seen.has(k)) return { ...e, options: `Tên lựa chọn bị trùng: "${nm}".` };
      seen.add(k);
    }
    if (d.options.length > 200) e.options = "Tối đa 200 lựa chọn.";
  }
  if (d.type === "user") {
    if (d.attrs.length > 8) e.attrs = "Tối đa 8 thuộc tính.";
    const keys = new Set<string>();
    for (const [i, a] of d.attrs.entries()) {
      const at = `Thuộc tính thứ ${i + 1}`;
      if (!a.label.trim()) return { ...e, attrs: `${at} chưa có tên.` };
      if (!/^[a-z][a-z0-9_]{0,29}$/.test(a.key.trim())) return { ...e, attrs: `${at}: mã gồm chữ thường không dấu, số và dấu gạch dưới, bắt đầu bằng chữ (ví dụ "vai_tro").` };
      if (keys.has(a.key.trim())) return { ...e, attrs: `Mã thuộc tính bị trùng: "${a.key.trim()}".` };
      keys.add(a.key.trim());
      if (a.kind === "select" && optionList(a.options).length === 0) return { ...e, attrs: `${at} ("${a.label.trim()}") kiểu nhãn cần ít nhất một nhãn.` };
      if (a.kind === "percent" && a.sumMax.trim() !== "") {
        const n = Number(a.sumMax.replace(",", "."));
        if (!Number.isFinite(n) || n < 0 || n > 100) return { ...e, attrs: `${at}: giới hạn tổng từ 0 đến 100 (%).` };
      }
    }
  }
  if (d.type === "relation" && !d.targetTableId) e.targetTableId = "Chọn bảng để liên kết tới.";
  if ((d.type === "lookup" || d.type === "rollup") && !d.relation) e.relation = "Chọn cột Liên kết của bảng này.";
  if ((d.type === "lookup" || d.type === "rollup") && d.relation && !d.targetColumn) e.targetColumn = "Chọn cột của bảng được liên kết.";
  if (d.type === "field_modified" && (d.watch.length < 1 || d.watch.length > 5)) e.watch = "Chọn từ 1 đến 5 cột để theo dõi.";
  if (d.type === "formula" && d.formula.trim().replace(/^=/, "").trim() === "") e.formula = "Nhập công thức, bắt đầu bằng dấu =.";
  return e;
}

/** Where the first error sits, in form order (focus goes there). */
export const FIELD_ORDER: (keyof DraftErrors)[] = ["name", "targetTableId", "relation", "targetColumn", "watch", "formula", "options", "attrs", "maxLength", "precision", "ratingMax", "maxFiles", "start", "decimals", "unit"];
export function firstError(e: DraftErrors): keyof DraftErrors | null {
  return FIELD_ORDER.find((k) => e[k]) ?? null;
}

// ---- server errors -------------------------------------------------------------------------------------------------------------

/** A server error as one line and the field it belongs under ("form" = no single field). */
export function columnError(e: unknown): { field: keyof DraftErrors | "form"; message: string } {
  if (!(e instanceof ApiError)) return { field: "form", message: e instanceof TypeError ? "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại." : e instanceof Error ? e.message : String(e) };
  const own = e.body?.error.message ?? "";
  const vn = /[À-ỹ]/.test(own);
  const d = e.details as { reason?: string; column?: string; issues?: { path: string; message: string }[]; code?: string } | undefined;
  if (e.code === "conflict" && d?.reason === "duplicate_name") return { field: "name", message: own };
  if (e.code === "conflict" && d?.reason === "duplicate_values") return { field: "form", message: own };
  if (e.code === "quota_exceeded") return { field: "form", message: own || "Bảng đã đủ số cột cho phép." };
  if (e.code === "forbidden") return { field: "form", message: "Chỉ chủ datahub được đổi cấu trúc bảng." };
  if (e.code === "not_found") return { field: "form", message: "Cột hoặc bảng này không còn nữa. Tải lại trang rồi thử lại." };
  if (e.code === "validation_error") {
    const path = d?.issues?.[0]?.path ?? "";
    const msg = d?.issues?.[0]?.message ?? own;
    if (/^(name)/.test(path)) return { field: "name", message: msg };
    if (/options/.test(path) || /lựa chọn/i.test(msg)) return { field: "options", message: msg };
    if (/^(formula|config\.formula)/.test(path) || /công thức/i.test(msg)) return { field: "formula", message: msg };
    if (/target_table_id/.test(path) || d?.code === "#PERM!" || /Bảng liên kết/.test(msg)) return { field: "targetTableId", message: msg };
    if (/relation/.test(path)) return { field: "relation", message: msg };
    if (/target_column/.test(path)) return { field: "targetColumn", message: msg };
    if (/attrs/.test(path)) return { field: "attrs", message: msg };
    if (/max_length/.test(path)) return { field: "maxLength", message: msg };
    if (/precision/.test(path)) return { field: "precision", message: msg };
    if (/max_files/.test(path)) return { field: "maxFiles", message: msg };
    return { field: "form", message: vn ? msg : "Thông tin của cột chưa hợp lệ. Kiểm tra lại các ô rồi thử lại." };
  }
  return { field: "form", message: vn ? own : "Không lưu được cột. Thử lại sau ít phút." };
}

// ---- type change ---------------------------------------------------------------------------------------------------------------

export interface ConversionReport {
  total_rows: number;
  with_value: number;
  unchanged: number;
  converted: number;
  cannot_convert: number;
  samples: { row_id: string; row_no: number; value: unknown; reason: string }[];
}

export interface ConversionSummary {
  /** One line per effect, in the order they matter. */
  lines: string[];
  /** Cells that will be emptied. */
  lost: number;
  /** True when nothing is lost or changed: the type can change without asking. */
  harmless: boolean;
}

const plural = (n: number) => n.toLocaleString("vi-VN");

/** What a type change does, from the server's count (the screen never counts cells itself). */
export function describeConversion(r: ConversionReport, from: string, to: string): ConversionSummary {
  const lines: string[] = [];
  if (r.with_value === 0) lines.push("Chưa ô nào có giá trị nên không ô nào bị ảnh hưởng.");
  else {
    if (r.unchanged > 0) lines.push(`${plural(r.unchanged)} ô giữ nguyên giá trị.`);
    if (r.converted > 0) lines.push(`${plural(r.converted)} ô đổi sang dạng của kiểu "${to}".`);
    if (r.cannot_convert > 0) lines.push(`${plural(r.cannot_convert)} ô không chuyển được nên sẽ bị xoá trắng. Giá trị cũ vẫn nằm trong lịch sử của dòng.`);
  }
  void from;
  return { lines, lost: r.cannot_convert, harmless: r.cannot_convert === 0 && r.converted === 0 };
}

/** The sample of a value that cannot be converted, as one short line for the dialog. */
export function sampleLine(s: ConversionReport["samples"][number]): string {
  const v = typeof s.value === "string" ? s.value : JSON.stringify(s.value);
  const shown = v.length > 40 ? `${v.slice(0, 40)}…` : v;
  return `Dòng #${s.row_no}: "${shown}"`;
}

// ---- options -------------------------------------------------------------------------------------------------------------------

export function moveOption(list: OptionDraft[], index: number, by: -1 | 1): OptionDraft[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** The first of the nine colours not yet used, so new options start different from each other. */
export function nextColor(used: string[], colors: readonly string[]): string {
  return colors.find((c) => !used.includes(c)) ?? colors[used.length % colors.length]!;
}

export const NAME_MAX = DH_NAME_MAX;
export type { SelectOption };
