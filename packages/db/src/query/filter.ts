import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  AppError,
  BUSINESS_TIMEZONE,
  MAX_FILTER_CONDITIONS,
  MAX_FILTER_DEPTH,
  type FilterCondition,
  type FilterNode,
  type FilterOp,
} from "@soe/shared";

/**
 * Filter DSL -> SQL (design section 6.3).
 * Every field must be declared in a `FieldMap`; unknown fields and operators not allowed for the field type are
 * rejected with `invalid_filter`. Values always go through bind parameters, never string concatenation.
 */

/** `set`: a JSONB array of strings (multi select, attachments). `in` = has any of, `nin` = has none of, `eq` = has this one. */
export type FieldType = "text" | "number" | "date" | "datetime" | "boolean" | "uuid" | "enum" | "set";

export interface FieldSpec {
  type: FieldType;
  /** SQL expression or column the field maps to. */
  expr: SQL | AnyPgColumn;
  /** Expression used for ORDER BY and the keyset cursor when it differs from `expr` (for example option order). */
  sortExpr?: SQL;
  /** Allowed values for `enum`. */
  values?: readonly string[];
  /** Default true. */
  sortable?: boolean;
  /** Default true. Shown when the caller does not pass `fields`. */
  selectable?: boolean;
}

export type FieldMap = Record<string, FieldSpec>;

const COMPARE = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
const REL = [
  "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
  "this_quarter", "last_quarter", "this_year", "last_year", "last_n_days", "next_n_days",
] as const;
const EMPTY = ["is_empty", "is_not_empty"] as const;

const ALLOWED: Record<FieldType, readonly FilterOp[]> = {
  text: ["eq", "neq", "in", "nin", "contains", "starts_with", ...EMPTY],
  number: [...COMPARE, "in", "nin", "between", ...EMPTY],
  date: [...COMPARE, "between", ...REL, ...EMPTY],
  datetime: [...COMPARE, "between", ...REL, ...EMPTY],
  boolean: ["eq", "neq", ...EMPTY],
  uuid: ["eq", "neq", "in", "nin", ...EMPTY],
  enum: ["eq", "neq", "in", "nin", ...EMPTY],
  set: ["eq", "neq", "in", "nin", ...EMPTY],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function bad(msg: string, details?: unknown): never {
  throw new AppError("invalid_filter", msg, details);
}

export function exprOf(spec: FieldSpec): SQL {
  return sql`${spec.expr}`;
}

function coerce(spec: FieldSpec, field: string, v: unknown): string | number | boolean {
  switch (spec.type) {
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) bad(`Cột "${field}" cần giá trị số.`, { field });
      return v;
    case "boolean":
      if (typeof v !== "boolean") bad(`Cột "${field}" cần giá trị true/false.`, { field });
      return v;
    case "date":
      if (typeof v !== "string" || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) bad(`Cột "${field}" cần ngày dạng YYYY-MM-DD.`, { field });
      return v as string;
    case "datetime":
      if (typeof v !== "string" || Number.isNaN(Date.parse(v))) bad(`Cột "${field}" cần thời điểm dạng ISO 8601.`, { field });
      return new Date(v as string).toISOString();
    case "uuid":
      if (typeof v !== "string" || !UUID_RE.test(v)) bad(`Cột "${field}" cần uuid.`, { field });
      return v as string;
    case "enum":
      if (typeof v !== "string" || (spec.values && !spec.values.includes(v))) bad(`Giá trị không hợp lệ cho cột "${field}".`, { field, allowed: spec.values });
      return v as string;
    case "text":
    case "set":
      if (typeof v !== "string") bad(`Cột "${field}" cần giá trị chữ.`, { field });
      return v as string;
  }
}

function listValue(spec: FieldSpec, field: string, c: FilterCondition): (string | number | boolean)[] {
  if (!Array.isArray(c.value) || c.value.length === 0) bad(`Toán tử "${c.op}" cần một danh sách không rỗng.`, { field });
  if (c.value.length > 500) bad(`Danh sách tối đa 500 giá trị.`, { field });
  return c.value.map((v) => coerce(spec, field, v));
}

function singleValue(spec: FieldSpec, field: string, c: FilterCondition) {
  if (c.value === undefined || c.value === null || Array.isArray(c.value)) bad(`Toán tử "${c.op}" cần một giá trị.`, { field });
  return coerce(spec, field, c.value);
}

const tz = sql.raw(`'${BUSINESS_TIMEZONE}'`);
const todayVn = sql`(now() AT TIME ZONE ${tz})::date`;

/** [start, end) as SQL `date` expressions in business time. */
function relativeRange(op: FilterOp, n?: number): [SQL, SQL] {
  const t = todayVn;
  switch (op) {
    case "today": return [t, sql`(${t} + 1)`];
    case "yesterday": return [sql`(${t} - 1)`, t];
    case "this_week": return [sql`date_trunc('week', ${t})::date`, sql`(date_trunc('week', ${t})::date + 7)`];
    case "last_week": return [sql`(date_trunc('week', ${t})::date - 7)`, sql`date_trunc('week', ${t})::date`];
    case "this_month": return [sql`date_trunc('month', ${t})::date`, sql`(date_trunc('month', ${t}) + interval '1 month')::date`];
    case "last_month": return [sql`(date_trunc('month', ${t}) - interval '1 month')::date`, sql`date_trunc('month', ${t})::date`];
    // Quarters follow the calendar year. A configurable fiscal year is a Stage 4 concern (design section 5).
    case "this_quarter": return [sql`date_trunc('quarter', ${t})::date`, sql`(date_trunc('quarter', ${t}) + interval '3 months')::date`];
    case "last_quarter": return [sql`(date_trunc('quarter', ${t}) - interval '3 months')::date`, sql`date_trunc('quarter', ${t})::date`];
    case "this_year": return [sql`date_trunc('year', ${t})::date`, sql`(date_trunc('year', ${t}) + interval '1 year')::date`];
    case "last_year": return [sql`(date_trunc('year', ${t}) - interval '1 year')::date`, sql`date_trunc('year', ${t})::date`];
    case "last_n_days": return [sql`(${t} - ${(n ?? 1) - 1}::int)`, sql`(${t} + 1)`];
    case "next_n_days": return [t, sql`(${t} + ${n ?? 1}::int)`];
    default: throw new Error(`not a relative op: ${op}`);
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Conditions on a JSONB array of strings. */
function compileSet(spec: FieldSpec, c: FilterCondition, e: SQL): SQL {
  const f = c.field;
  const arr = (vals: (string | number | boolean)[]) => sql`ARRAY[${sql.join(vals.map((v) => sql`${v}`), sql`, `)}]::text[]`;
  switch (c.op) {
    case "is_empty": return sql`(${e} IS NULL OR ${e} = '[]'::jsonb)`;
    case "is_not_empty": return sql`(${e} IS NOT NULL AND ${e} <> '[]'::jsonb)`;
    case "eq": return sql`${e} ? ${singleValue(spec, f, c) as string}`;
    case "neq": return sql`NOT coalesce(${e} ? ${singleValue(spec, f, c) as string}, false)`;
    case "in": return sql`${e} ?| ${arr(listValue(spec, f, c))}`;
    case "nin": return sql`NOT coalesce(${e} ?| ${arr(listValue(spec, f, c))}, false)`;
    default: return bad(`Toán tử "${c.op}" không dùng được cho cột "${f}".`, { field: f, op: c.op });
  }
}

function compileCondition(fields: FieldMap, c: FilterCondition): SQL {
  const spec = fields[c.field];
  if (!spec) bad(`Không có cột "${c.field}" để lọc.`, { field: c.field, allowed: Object.keys(fields) });
  if (!ALLOWED[spec.type].includes(c.op)) bad(`Toán tử "${c.op}" không dùng được cho cột "${c.field}" (kiểu ${spec.type}).`, { field: c.field, op: c.op });
  const e = exprOf(spec);
  const f = c.field;

  if (spec.type === "set") return compileSet(spec, c, e);

  switch (c.op) {
    case "is_empty":
      return spec.type === "text" ? sql`(${e} IS NULL OR ${e} = '')` : sql`${e} IS NULL`;
    case "is_not_empty":
      return spec.type === "text" ? sql`(${e} IS NOT NULL AND ${e} <> '')` : sql`${e} IS NOT NULL`;
    case "eq": return sql`${e} = ${singleValue(spec, f, c)}`;
    case "neq": return sql`${e} IS DISTINCT FROM ${singleValue(spec, f, c)}`;
    case "gt": return sql`${e} > ${singleValue(spec, f, c)}`;
    case "gte": return sql`${e} >= ${singleValue(spec, f, c)}`;
    case "lt": return sql`${e} < ${singleValue(spec, f, c)}`;
    case "lte": return sql`${e} <= ${singleValue(spec, f, c)}`;
    case "in": return sql`${e} IN (${sql.join(listValue(spec, f, c).map((v) => sql`${v}`), sql`, `)})`;
    case "nin": return sql`(${e} IS NULL OR ${e} NOT IN (${sql.join(listValue(spec, f, c).map((v) => sql`${v}`), sql`, `)}))`;
    case "between": {
      if (!Array.isArray(c.value) || c.value.length !== 2) bad(`Toán tử "between" cần đúng 2 giá trị [từ, đến].`, { field: f });
      const lo = coerce(spec, f, c.value[0]);
      const hi = coerce(spec, f, c.value[1]);
      return sql`${e} BETWEEN ${lo} AND ${hi}`;
    }
    case "contains":
    case "starts_with": {
      const v = singleValue(spec, f, c) as string;
      const needle = c.op === "contains" ? `%${escapeLike(v)}%` : `${escapeLike(v)}%`;
      // Accent- and case-insensitive; matches the trigram index convention (soe_unaccent(lower(col))).
      return sql`soe_unaccent(lower(${e})) LIKE soe_unaccent(lower(${needle})) ESCAPE '\\'`;
    }
    default: {
      // Relative date operators.
      let n: number | undefined;
      if (c.op === "last_n_days" || c.op === "next_n_days") {
        if (typeof c.value !== "number" || !Number.isInteger(c.value) || c.value < 1 || c.value > 3660) bad(`Toán tử "${c.op}" cần số nguyên từ 1 đến 3660.`, { field: f });
        n = c.value;
      }
      const [start, end] = relativeRange(c.op, n);
      if (spec.type === "date") return sql`(${e} >= ${start} AND ${e} < ${end})`;
      return sql`(${e} >= (${start})::timestamp AT TIME ZONE ${tz} AND ${e} < (${end})::timestamp AT TIME ZONE ${tz})`;
    }
  }
}

/** Compiles a filter tree to a SQL condition. Validates depth, size, fields, operators and values. */
export function compileFilter(filter: FilterNode | undefined | null, fields: FieldMap): SQL | undefined {
  if (!filter) return undefined;
  let count = 0;
  const walk = (node: FilterNode, depth: number): SQL => {
    if (depth > MAX_FILTER_DEPTH) bad(`Bộ lọc lồng quá ${MAX_FILTER_DEPTH} cấp.`);
    if ("and" in node || "or" in node) {
      const isAnd = "and" in node;
      const children = isAnd ? node.and : node.or;
      const parts = children.map((ch) => walk(ch, depth + 1));
      return sql`(${sql.join(parts, isAnd ? sql` AND ` : sql` OR `)})`;
    }
    if (++count > MAX_FILTER_CONDITIONS) bad(`Bộ lọc tối đa ${MAX_FILTER_CONDITIONS} điều kiện.`);
    return compileCondition(fields, node);
  };
  return walk(filter, 1);
}
