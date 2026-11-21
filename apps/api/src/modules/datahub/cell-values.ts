import { FError, instantToSerial, isoDateTimeToSerial, isoToSerial, parseDateText, serialToIso, serialToIsoDateTime, toNumberLoose, toText, type FType, type Scalar } from "@soe/formula";
import type { LoadedRow } from "./column-source";
import type { DhColumn, Stored } from "./types";
import { userIdsOf } from "./user-values";

/** Types whose values live in `data` under the column key and that can be grouped / compared by the formula engine. */
export const COMPUTED_TYPES = ["formula", "lookup", "rollup"] as const;
export type ComputedType = (typeof COMPUTED_TYPES)[number];
export const isComputedType = (t: string): t is ComputedType => (COMPUTED_TYPES as readonly string[]).includes(t);

/** Result types a computed column can store. */
export const RESULT_TYPES = ["number", "percent", "text", "date", "datetime", "checkbox"] as const;
export type ResultType = (typeof RESULT_TYPES)[number];

/** Key under which the error of a computed cell is kept (`!c_xxx`); the value key itself is then absent. */
export const errKey = (key: string) => `!${key}`;

type ColLike = { type: string; config: Record<string, unknown> };

export const resultTypeOf = (col: ColLike): ResultType => (col.config.result_type as ResultType | undefined) ?? "text";

/** The plain column type whose behaviour (filter, sort, index) a column follows: a computed column acts as its result type. */
export function effectiveType(col: ColLike): string {
  // "Ngày sửa của cột": a moment kept in `data`, read and filtered like a date-time.
  if (col.type === "field_modified") return "datetime";
  return isComputedType(col.type) ? resultTypeOf(col) : col.type;
}

/** Type of a column as the formula engine sees it. */
export function formulaTypeOf(col: ColLike): FType {
  switch (effectiveType(col)) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "auto_number":
      return "number";
    case "date":
      return "date";
    case "datetime":
    case "created_time":
    case "modified_time":
      return "datetime";
    case "checkbox":
      return "boolean";
    default:
      return "text";
  }
}

/** Value of a cell as the formula engine reads it. Errors of computed cells come back as `FError`. */
export function cellValue(col: DhColumn, row: Pick<LoadedRow, "id" | "data" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">): Scalar {
  const type = effectiveType(col);
  switch (type) {
    case "row_id":
      return row.id;
    case "created_time":
      return instantToSerial(new Date(row.createdAt).getTime());
    case "modified_time":
      return instantToSerial(new Date(row.updatedAt).getTime());
    case "created_by":
      return row.createdBy;
    case "modified_by":
      return row.updatedBy;
    default:
  }
  const stored = row.data[col.key] as Stored | undefined;
  if (stored === undefined || stored === null) {
    if (isComputedType(col.type)) {
      const e = row.data[errKey(col.key)];
      if (typeof e === "string") return new FError(e as never);
    }
    return type === "checkbox" ? false : null;
  }
  return storedToValue(type, col, stored);
}

function storedToValue(type: string, col: Pick<DhColumn, "config">, stored: Stored): Scalar {
  switch (type) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "auto_number":
      return typeof stored === "number" ? stored : toNumberLoose(String(stored));
    case "date":
      return typeof stored === "string" ? isoToSerial(stored) : null;
    case "datetime":
      return typeof stored === "string" ? isoDateTimeToSerial(stored) : null;
    case "checkbox":
      return stored === true;
    case "single_select":
      return typeof stored === "string" ? ((col.config.options as { id: string; name: string }[] | undefined)?.find((o) => o.id === stored)?.name ?? null) : null;
    case "multi_select":
      return Array.isArray(stored) ? stored.map((id) => (col.config.options as { id: string; name: string }[] | undefined)?.find((o) => o.id === id)?.name ?? "").filter(Boolean).join(", ") : null;
    case "attachment":
      return null;
    case "user":
      return userIdsOf(stored).join(", ");
    default:
      if (Array.isArray(stored)) return (stored as string[]).join(", ");
      return stored as Scalar;
  }
}

export type StoreOutcome = { kind: "value"; value: Stored } | { kind: "empty" } | { kind: "error"; code: string };

/** A formula result as it is stored in a cell of the given result type. */
export function valueToStored(type: ResultType, v: Scalar): StoreOutcome {
  if (v instanceof FError) return { kind: "error", code: v.code };
  switch (type) {
    case "number":
    case "percent": {
      if (v === null || v === "") return { kind: "empty" };
      const n = typeof v === "number" ? v : toNumberLoose(v);
      if (n === null || !Number.isFinite(n)) return { kind: "error", code: "#VALUE!" };
      return { kind: "value", value: n };
    }
    case "text":
      if (v === null) return { kind: "empty" };
      return { kind: "value", value: toText(v).slice(0, 100_000) };
    case "date": {
      if (v === null || v === "") return { kind: "empty" };
      const s = typeof v === "number" ? v : typeof v === "string" ? (parseDateText(v) ?? toNumberLoose(v)) : null;
      if (s === null || !Number.isFinite(s) || s < 1 || s > 2_958_465) return { kind: "error", code: "#VALUE!" };
      return { kind: "value", value: serialToIso(s) };
    }
    case "datetime": {
      if (v === null || v === "") return { kind: "empty" };
      const s = typeof v === "number" ? v : typeof v === "string" ? (parseDateText(v) ?? toNumberLoose(v)) : null;
      if (s === null || !Number.isFinite(s) || s < 1 || s > 2_958_465) return { kind: "error", code: "#VALUE!" };
      return { kind: "value", value: serialToIsoDateTime(s) };
    }
    case "checkbox":
      if (v === null || v === "") return { kind: "value", value: false };
      if (typeof v === "boolean") return { kind: "value", value: v };
      if (typeof v === "number") return { kind: "value", value: v !== 0 };
      return { kind: "error", code: "#VALUE!" };
  }
}

/** Result type that follows from a static formula type. */
export function resultTypeFor(t: FType): ResultType {
  switch (t) {
    case "number":
      return "number";
    case "boolean":
      return "checkbox";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    default:
      return "text";
  }
}

/** JSON with the keys of every object in sorted order: the database (jsonb) hands objects back in its own key order, which is not the order a parser wrote them. */
function stable(v: unknown): string {
  return JSON.stringify(v ?? null, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}

/** Two stored cell values are the same value (object key order does not matter: a person's attributes read back from jsonb in another order). */
export function sameStored(a: unknown, b: unknown): boolean {
  // Hot path (every cell write, a recalculation of 100,000 rows): plain values compare directly; only objects and arrays need the key sort.
  const x = a ?? null;
  const y = b ?? null;
  if (typeof x !== "object" && typeof y !== "object") return x === y;
  if (x === null || y === null) return x === y;
  return stable(a) === stable(b);
}

/** Applies a stored outcome to a row's data (value key and error key). Returns true when the data changed. */
export function applyOutcome(data: Record<string, Stored>, col: Pick<DhColumn, "key">, out: StoreOutcome): boolean {
  const ek = errKey(col.key);
  const oldVal = data[col.key] ?? null;
  const oldErr = (data[ek] as unknown as string | undefined) ?? null;
  const newVal = out.kind === "value" ? out.value : null;
  const newErr = out.kind === "error" ? out.code : null;
  if (sameStored(oldVal, newVal) && oldErr === newErr) return false;
  if (newVal === null) delete data[col.key];
  else data[col.key] = newVal;
  if (newErr === null) delete data[ek];
  else (data as Record<string, unknown>)[ek] = newErr;
  return true;
}

/** API shape of a row's cells: the error of a computed cell (`!c_xxx`) is shown in place of its value. */
export function exposeErrors<T extends Record<string, unknown>>(data: T): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const k of Object.keys(data)) {
    if (!k.startsWith("!")) continue;
    out ??= { ...data };
    delete out[k];
    out[k.slice(1)] = data[k];
  }
  return out ?? data;
}
