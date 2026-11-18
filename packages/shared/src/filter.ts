import { z } from "zod";

/** Filter DSL (design section 6.3). Same syntax for UI, API and MCP. */

export const COMPARE_OPS = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
export const LIST_OPS = ["in", "nin"] as const;
export const TEXT_OPS = ["contains", "starts_with"] as const;
export const EMPTY_OPS = ["is_empty", "is_not_empty"] as const;
export const RANGE_OPS = ["between"] as const;
/** Relative date operators without a value. */
export const RELATIVE_DATE_OPS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
] as const;
/** Relative date operators with a numeric value `n`. */
export const RELATIVE_DATE_N_OPS = ["last_n_days", "next_n_days"] as const;

export const FILTER_OPS = [
  ...COMPARE_OPS,
  ...LIST_OPS,
  ...TEXT_OPS,
  ...EMPTY_OPS,
  ...RANGE_OPS,
  ...RELATIVE_DATE_OPS,
  ...RELATIVE_DATE_N_OPS,
] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

export const MAX_FILTER_DEPTH = 5;
export const MAX_FILTER_CONDITIONS = 50;

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const FilterConditionSchema = z.strictObject({
  field: z.string().min(1).max(100),
  op: z.enum(FILTER_OPS),
  value: z.union([scalar, z.array(scalar)]).optional(),
});

export type FilterCondition = z.infer<typeof FilterConditionSchema>;
export type FilterNode = FilterCondition | { and: FilterNode[] } | { or: FilterNode[] };

export const FilterSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([
    FilterConditionSchema,
    z.strictObject({ and: z.array(FilterSchema).min(1) }),
    z.strictObject({ or: z.array(FilterSchema).min(1) }),
  ]),
);

export const SortItemSchema = z.object({
  field: z.string().min(1).max(100),
  dir: z.enum(["asc", "desc"]),
  /** Where empty values go. Default: last for `asc`, first for `desc` (PostgreSQL order). */
  nulls: z.enum(["first", "last"]).optional(),
});
export type SortItem = z.infer<typeof SortItemSchema>;

/** Parses `field:asc,other:desc` (direction optional, default asc). Throws Error with a message on bad input. */
export function parseSortParam(raw: string): SortItem[] {
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const [field = "", dir = "asc", nulls, ...rest] = part.split(":");
      if (rest.length > 0 || (dir !== "asc" && dir !== "desc") || (nulls !== undefined && nulls !== "first" && nulls !== "last") || !/^[a-z0-9_]+$/i.test(field)) {
        throw new Error(`Sort không hợp lệ: "${part}"`);
      }
      return (nulls ? { field, dir, nulls } : { field, dir }) as SortItem;
    });
  if (items.length > 5) throw new Error("Sắp xếp tối đa 5 cột.");
  return items;
}

/** List query params shared by every list endpoint (design section 7). */
export const MAX_PAGE_LIMIT = 500;
export const DEFAULT_PAGE_LIMIT = 50;

/** Accepts a JSON string (from the query string) or an object. */
export const filterParam = z.preprocess((v) => {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}, FilterSchema.optional());

/** A JSON value sent in the query string (a string) or as an object: parsed, then checked by `schema`. */
export function jsonParam<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => {
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  }, schema.optional()) as unknown as z.ZodOptional<T>;
}

export const listParamsShape = {
  filter: filterParam.describe("Bộ lọc dạng JSON (mục 6.3 của thiết kế)."),
  sort: z.string().max(300).optional().describe("Ví dụ: created_at:desc,id:asc"),
  fields: z.string().max(1000).optional().describe("Danh sách cột trả về, ngăn cách bằng dấu phẩy."),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().max(2000).optional(),
  include_total: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true")
    .describe("true = trả thêm `total` (đếm toàn bộ, chậm hơn trên bảng lớn)."),
};

export interface ListResult<T> {
  data: T[];
  next_cursor: string | null;
  total?: number;
}
