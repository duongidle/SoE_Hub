import { EMPTY, formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent, parseLocaleDate, parseLocaleDateTime, parseLocaleNumber } from "@soe/shared";
import type { Column, Level, Row, SelectOption } from "./types";

/** What the grid needs to turn stored values into text: names for people and linked rows (loaded by id, shown as "…" until they arrive). */
export interface CellCtx {
  people: ReadonlyMap<string, string>;
  linked: ReadonlyMap<string, string>;
  /** People named in a Người dùng column who are not members of the table any more (shown with "không còn quyền"). */
  noAccess?: ReadonlySet<string>;
}

export const NO_ACCESS = "không còn quyền";

export const COMPUTED_TYPES = new Set(["formula", "lookup", "rollup"]);
export const SYSTEM_TYPES = new Set(["row_id", "created_time", "created_by", "modified_time", "modified_by", "field_modified"]);

/** The plain type a column behaves as: a computed column behaves as its result type. */
export function typeOf(col: Pick<Column, "type" | "config">): string {
  // "Ngày sửa của cột" holds a moment and behaves as a date-time (nobody types into it).
  if (col.type === "field_modified") return "datetime";
  return COMPUTED_TYPES.has(col.type) ? (col.config.result_type ?? "text") : col.type;
}

/** Why a column cannot be typed into (null = it can, when the person may edit data). */
export function readOnlyReason(col: Column, level: Level): string | null {
  if (COMPUTED_TYPES.has(col.type)) return "Cột này do công thức tính, không sửa trực tiếp.";
  if (col.type === "auto_number") return "Số tự tăng do hệ thống điền.";
  if (SYSTEM_TYPES.has(col.type)) return "Cột hệ thống, không sửa được.";
  if (col.allow_edit === false && level !== "owner") return "Chủ bảng không cho sửa cột này.";
  if (col.type === "relation" && level !== "owner") return "Chỉ chủ datahub được sửa cột liên kết.";
  if (col.type === "relation") return "Chọn dòng liên kết trong ô, không gõ hay dán được.";
  if (col.type === "attachment") return "Tải file lên trong ô, không gõ hay dán được.";
  return null;
}

/** Columns whose cells are changed with a picker (choose linked rows, upload files) instead of typing or pasting. */
export const PICKER_TYPES = new Set(["relation", "attachment"]);

/** The person may change this picker cell: files by anyone who may edit data, links only by the owner (design module2 section 10). */
export function pickerEditable(col: Pick<Column, "type">, level: Level): boolean {
  return level !== "view" && (col.type === "attachment" || (col.type === "relation" && level === "owner"));
}

/** Error codes of the formula engine that can sit in a computed cell. */
const ERROR_RE = /^#(DIV\/0!|N\/A|NAME\?|NUM!|REF!|VALUE!|CYCLE!|PERM!)$/;

export const ERROR_HELP: Record<string, string> = {
  "#DIV/0!": "Chia cho 0 hoặc cho ô trống.",
  "#N/A": "Không tìm thấy giá trị cần tra cứu.",
  "#NAME?": "Tên cột hoặc tên hàm không đúng.",
  "#NUM!": "Số không hợp lệ cho phép tính này.",
  "#REF!": "Tham chiếu tới cột hoặc dòng không còn.",
  "#VALUE!": "Kiểu dữ liệu không phù hợp với phép tính.",
  "#CYCLE!": "Công thức tham chiếu vòng tròn.",
  "#PERM!": "Không có quyền đọc dữ liệu nguồn.",
};

/** The error code of a computed cell, or null. Only computed columns hold errors; a text cell that reads "#N/A" is just text. */
export function cellError(col: Column, value: unknown): string | null {
  return COMPUTED_TYPES.has(col.type) && typeof value === "string" && ERROR_RE.test(value) ? value : null;
}

/** The stored value of a cell. System columns have no value in `data`; they read the standard fields of the row. */
export function cellValue(col: Column, row: Row): unknown {
  switch (col.type) {
    case "row_id":
      return row.row_no;
    case "created_time":
      return row.created_at;
    case "modified_time":
      return row.updated_at;
    case "created_by":
      return row.created_by;
    case "modified_by":
      return row.updated_by;
    default:
      return row.data[col.key];
  }
}

export function optionsOf(col: Column): SelectOption[] {
  return col.config.options ?? [];
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

const withUnit = (text: string, col: Column) => (col.display.unit ? `${text} ${col.display.unit}` : text);

function one(type: string, col: Column, v: unknown, ctx: CellCtx): string {
  if (isEmpty(v)) return EMPTY;
  switch (type) {
    case "number":
    case "auto_number":
    case "rating":
      return typeof v === "number" ? withUnit(formatNumber(v, { decimals: col.display.decimals ?? col.config.precision, thousands: col.display.thousands }), col) : String(v);
    case "currency":
      return typeof v === "number" ? formatCurrency(v, { unit: col.display.unit }) : String(v);
    case "percent":
      return typeof v === "number" ? formatPercent(v, { decimals: col.display.decimals }) : String(v);
    case "date":
      return formatDate(String(v));
    case "datetime":
    case "created_time":
    case "modified_time":
      return formatDateTime(String(v));
    case "checkbox":
      return v === true ? "Có" : "Không";
    case "row_id":
      return `#${v as number}`;
    case "user":
      return typeof v === "string" ? `${ctx.people.get(v) ?? "…"}${ctx.noAccess?.has(v) ? ` (${NO_ACCESS})` : ""}` : EMPTY;
    case "created_by":
    case "modified_by":
      return typeof v === "string" ? (ctx.people.get(v) ?? "…") : EMPTY;
    default:
      return String(v);
  }
}

/** Text of a cell as shown in the grid, the detail panel and copied to the clipboard. Always the same for the same value. */
export function displayText(col: Column, row: Row, ctx: CellCtx): string {
  const v = cellValue(col, row);
  const err = cellError(col, v);
  if (err) return err;
  if (isEmpty(v)) return EMPTY;
  const type = typeOf(col);
  switch (type) {
    case "single_select":
      return optionsOf(col).find((o) => o.id === v)?.name ?? EMPTY;
    case "multi_select":
      return Array.isArray(v) ? v.map((id) => optionsOf(col).find((o) => o.id === id)?.name ?? EMPTY).join(", ") : EMPTY;
    case "relation":
      return Array.isArray(v) ? v.map((id) => ctx.linked.get(String(id)) ?? "…").join(", ") : EMPTY;
    case "attachment":
      return Array.isArray(v) ? `${v.length} tệp` : EMPTY;
    case "long_text":
      return String(v).replace(/\s*\n\s*/g, " ");
    default:
      if (Array.isArray(v)) return v.map((x) => one(type, col, x, ctx)).join(", ");
      return one(type, col, v, ctx);
  }
}

/** Plain text of a value for editing in a text box (what the person types back). */
export function editText(col: Column, row: Row): string {
  const v = cellValue(col, row);
  if (isEmpty(v)) return "";
  switch (col.type) {
    case "number":
      return typeof v === "number" ? String(v).replace(".", ",") : String(v);
    case "percent":
      return typeof v === "number" ? `${String(Number((v * 100).toPrecision(12))).replace(".", ",")}%` : String(v);
    case "date":
      return formatDate(String(v));
    case "datetime":
      return formatDateTime(String(v));
    default:
      return String(v);
  }
}

export type Parsed = { ok: true; value: unknown } | { ok: false; message: string };
const bad = (message: string): Parsed => ({ ok: false, message });

const TRUE_WORDS = new Set(["true", "1", "x", "có", "co", "yes", "y", "đã"]);
const FALSE_WORDS = new Set(["false", "0", "", "không", "khong", "no", "n", "chưa"]);

const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();
const strip = (s: string) => norm(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
const clip = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

/** Name (without accents, lower case) -> user id, for pasting names into a user column. */
export type PeopleByName = ReadonlyMap<string, string>;
export const nameKey = strip;

/**
 * Turns typed or pasted text into the value to send. The server validates again on every channel; this step makes the
 * Vietnamese ways of writing (`dd/mm/yyyy`, `156,000,000`, `1.234,5`, `25%`) work and names the cell when it cannot be read.
 * Empty text clears the cell. In a percent column a number without `%` is read as percent points (`12,5` = 12,5%).
 */
export function parseCellText(col: Column, text: string, peopleByName?: PeopleByName): Parsed {
  const t = text.trim();
  if (t === "" && col.type !== "checkbox") return { ok: true, value: null };
  switch (col.type) {
    case "text":
    case "long_text":
    case "email":
    case "phone":
    case "url":
      return { ok: true, value: col.type === "long_text" ? text : t };
    case "number": {
      const n = parseLocaleNumber(t);
      return n === null ? bad(`"${clip(t)}" không phải số.`) : { ok: true, value: n };
    }
    case "currency": {
      const n = parseLocaleNumber(t);
      if (n === null) return bad(`"${clip(t)}" không phải số tiền.`);
      return Number.isSafeInteger(n) ? { ok: true, value: n } : bad("Tiền VND phải là số nguyên.");
    }
    case "percent": {
      const n = parseLocaleNumber(t.replace(/\s*%$/, ""));
      return n === null ? bad(`"${clip(t)}" không phải phần trăm.`) : { ok: true, value: Number((n / 100).toPrecision(12)) };
    }
    case "date": {
      const d = parseLocaleDate(t);
      return d ? { ok: true, value: d } : bad(`"${clip(t)}" không phải ngày. Nhập dạng dd/mm/yyyy.`);
    }
    case "datetime": {
      const d = parseLocaleDateTime(t);
      return d ? { ok: true, value: d } : bad(`"${clip(t)}" không phải ngày giờ. Nhập dạng dd/mm/yyyy hh:mm.`);
    }
    case "checkbox": {
      const w = norm(t);
      if (TRUE_WORDS.has(w)) return { ok: true, value: true };
      if (FALSE_WORDS.has(w)) return { ok: true, value: false };
      return bad(`"${clip(t)}" không phải Có hoặc Không.`);
    }
    case "rating": {
      const n = parseLocaleNumber(t);
      const max = col.config.max ?? 5;
      return n !== null && Number.isInteger(n) && n >= 0 && n <= max ? { ok: true, value: n === 0 ? null : n } : bad(`Đánh giá là số nguyên từ 0 đến ${max}.`);
    }
    case "single_select": {
      const o = findOption(col, t);
      return o ? { ok: true, value: o.id } : bad(`"${clip(t)}" không có trong danh sách lựa chọn của cột "${clip(col.name)}".`);
    }
    case "multi_select": {
      const ids: string[] = [];
      for (const part of t.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)) {
        const o = findOption(col, part);
        if (!o) return bad(`"${clip(part)}" không có trong danh sách lựa chọn của cột "${clip(col.name)}".`);
        if (!ids.includes(o.id)) ids.push(o.id);
      }
      return { ok: true, value: ids.length ? ids : null };
    }
    case "user": {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return { ok: true, value: t.toLowerCase() };
      const id = peopleByName?.get(strip(t));
      return id ? { ok: true, value: id } : bad(`Không tìm thấy người tên "${clip(t)}". Chọn từ danh sách khi sửa ô.`);
    }
    default:
      return bad("Cột này không sửa trực tiếp được.");
  }
}

function findOption(col: Column, text: string): SelectOption | undefined {
  const n = norm(text);
  return optionsOf(col).find((o) => o.id === text.trim() || norm(o.name) === n) ?? optionsOf(col).find((o) => strip(o.name) === strip(text));
}

/** Cell values equal for the purpose of "did this change". */
export function sameValue(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}
