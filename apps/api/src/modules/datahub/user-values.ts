import { z } from "zod";
import { FError } from "@soe/formula";
import type { DhColumn, PersonEntry } from "./types";

/**
 * "Người dùng" cells (design module4 4.5). A column without `config.attrs` holds one person: a uuid string. A column WITH `config.attrs`
 * holds a list of people with attributes: `[{ id, attrs: { <attr key>: value } }]`. Everything that reads people out of a cell (the split
 * lock, the "only members" check, the events, transfer, export) goes through `userIdsOf`, so both shapes work everywhere. The SQL twin is
 * `soe_dh_ids(cell)` (migration 0017).
 */
export type AttrKind = "select" | "percent" | "boolean";

export interface UserAttr {
  key: string;
  label: string;
  kind: AttrKind;
  /** `select`: the labels to choose from. */
  options?: string[];
  default?: string | number | boolean | null;
  sum_max?: number;
  cap_param?: string;
  default_when?: { attr: string; value: string; set: string | number | boolean; only_one?: boolean };
}

export const MAX_PEOPLE = 50;

export const userAttrSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, "Mã thuộc tính gồm chữ thường, số và dấu gạch dưới."),
  label: z.string().trim().min(1).max(60),
  kind: z.enum(["select", "percent", "boolean"]),
  options: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  /** `percent`: the total over the people of one cell may not exceed this (a fraction: 1 = 100%). */
  sum_max: z.number().min(0).max(1).optional(),
  /** `percent`: the total may not exceed the parameter of this name in the "Tham số com" table of the same datahub (module4 4.5); no value there, no limit. */
  cap_param: z.string().trim().min(1).max(100).optional(),
  /** When the person gives no value: `set` instead of `default`, for entries whose attribute `attr` is `value` (`only_one`: only when exactly one entry has it). Example: a lone Leading gets 100% revenue. */
  default_when: z
    .strictObject({ attr: z.string().min(1).max(30), value: z.string().min(1).max(60), set: z.union([z.string(), z.number(), z.boolean()]), only_one: z.boolean().optional() })
    .optional(),
});

/** The attributes of a user column; empty = the column holds one person. */
export function userAttrs(col: Pick<DhColumn, "type" | "config">): UserAttr[] {
  if (col.type !== "user") return [];
  const a = (col.config as { attrs?: UserAttr[] }).attrs;
  return Array.isArray(a) ? a : [];
}

export const hasAttrs = (col: Pick<DhColumn, "type" | "config">): boolean => userAttrs(col).length > 0;

/** Every person id in a stored user cell, whichever shape. */
export function userIdsOf(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.map((e) => (typeof e === "string" ? e : e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string" ? (e as { id: string }).id : "")).filter(Boolean);
  return [];
}

/** The entries of a stored attribute cell (a single-person string is read as one entry without attributes). */
export function entriesOf(v: unknown): PersonEntry[] {
  if (typeof v === "string") return [{ id: v, attrs: {} }];
  if (!Array.isArray(v)) return [];
  return v.flatMap((e): PersonEntry[] => {
    if (typeof e === "string") return [{ id: e, attrs: {} }];
    if (e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string") return [{ id: (e as PersonEntry).id, attrs: { ...((e as PersonEntry).attrs ?? {}) } }];
    return [];
  });
}

/** A list of people as text for export: `Tên (Leading; 50%; Có), Tên (...)`. Percent shows as a percentage. */
export function formatPeople(entries: PersonEntry[], attrs: UserAttr[], nameOf: (id: string) => string): string {
  return entries
    .map((e) => {
      const parts = attrs.flatMap((a) => {
        const v = e.attrs[a.key];
        if (v === undefined) return [];
        return [a.kind === "percent" && typeof v === "number" ? `${Math.round(v * 10000) / 100}%` : typeof v === "boolean" ? (v ? "Có" : "Không") : String(v)];
      });
      return parts.length ? `${nameOf(e.id)} (${parts.join("; ")})` : nameOf(e.id);
    })
    .join(", ");
}

/** The sum of the numeric attribute `name` over the people of a user cell (all of them, or only those in `inScope`). Used by ATTRSUM. */
/** The sum of the numeric attribute `name` over the people of a user cell (all of them, or only those in `inScope`). Used by ATTRSUM (module2 section 6.2). */
export function attrSumOfCell(col: Pick<DhColumn, "type" | "config">, stored: unknown, name: string, inScope: Set<string> | null): number {
  let sum = 0;
  for (const id of userIdsOf(stored)) {
    if (inScope && !inScope.has(id)) continue;
    const v = attrOfCell(col, stored, id, name);
    if (typeof v === "number" && Number.isFinite(v)) sum += v;
  }
  return sum;
}

/**
 * The value of attribute `name` (label or code, case-insensitive) of `person` in a stored user cell of `col`: a number, text or boolean; null when the person
 * is not in the cell or the attribute has no value. Used by the formula function ATTR (design module2 section 6.2). An unknown attribute name is a #NAME? error.
 */
export function attrOfCell(col: Pick<DhColumn, "type" | "config">, stored: unknown, person: string, name: string): string | number | boolean | null {
  const attrs = userAttrs(col);
  const want = name.trim().toLowerCase();
  const a = attrs.find((x) => x.key.toLowerCase() === want || x.label.trim().toLowerCase() === want);
  if (!a) throw new FError("#NAME?", `Cột không có thuộc tính "${name}".`);
  const p = person.trim().toLowerCase();
  const e = entriesOf(stored).find((x) => x.id.toLowerCase() === p);
  if (!e) return null;
  const v = e.attrs[a.key];
  return v === undefined ? null : (v as string | number | boolean | null);
}
