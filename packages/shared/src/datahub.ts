import { z } from "zod";

/** Datahub constants shared by api and web (design module2). */

export const DH_NAME_MAX = 100;

/**
 * Name of a datahub, table or column (design module2 section 2): trimmed, 1-100 characters, no `[` or `]`
 * (those are formula syntax). Uniqueness is case-insensitive and enforced by the database.
 */
export const DhNameSchema = z
  .string()
  .normalize("NFC")
  .trim()
  .min(1, "Tên không được để trống.")
  .max(DH_NAME_MAX, `Tên tối đa ${DH_NAME_MAX} ký tự.`)
  .refine((s) => !/[[\]]/.test(s), "Tên không được chứa dấu [ hoặc ].");

/** Column types (design module2 section 4). Computed types are reserved here and implemented in Stage 2B. */
export const COLUMN_TYPES = [
  "text", "long_text", "number", "currency", "percent", "date", "datetime", "checkbox", "rating",
  "single_select", "multi_select", "user", "email", "phone", "url", "attachment",
  "auto_number",
  "row_id", "created_time", "created_by", "modified_time", "modified_by",
  "formula", "relation", "lookup", "rollup",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const SHARE_PERMISSIONS = ["view", "edit_data"] as const;
export type SharePermission = (typeof SHARE_PERMISSIONS)[number];
export const SHARE_PERMISSION_LABELS: Record<SharePermission, string> = { view: "Xem", edit_data: "Sửa dữ liệu" };

/** Default limits (design module2 section 11). Admin changes the defaults in system settings and can override per user. */
export const DH_LIMIT_DEFAULTS = { datahubs: 5, tables: 10, columns: 70 } as const;
/** Hard ceiling of columns per table; settings and per-user overrides can never exceed it. */
export const DH_COLUMN_CEILING = 200;

/** Max operations in one batch call (design module2 section 12). */
export const DH_BATCH_MAX = 500;

/** A table above this many rows gets expression indexes for the columns used in filters and sorts (Module 0 section 6.2). */
export const DH_AUTO_INDEX_MIN_ROWS = 5000;
/** Budget: automatic indexes per table. Each one costs write time and disk, so the count is capped. */
export const DH_AUTO_INDEX_MAX_PER_TABLE = 8;
