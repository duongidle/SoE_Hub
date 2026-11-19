import { z } from "zod";
import { AppError, FilterSchema, TIME_PRESETS, TimeRangeSchema } from "@soe/shared";

/**
 * JSON of a metric and of a data source (design module3 sections 3 and 5). The same JSON is written by people (through the
 * screens), by the API and by AI. Every shape is strict: an unknown key is an error that names the key, so an AI can fix it.
 * Stage 3A-2 adds derived metrics (`formula`), comparisons, cumulative sums, cohorts, targets and outliers by extending
 * `MetricDefSchema`; Stage 4 adds the snapshot parameter to the query.
 */

export const AGGS = ["count", "count_distinct", "sum", "avg", "min", "max", "median", "percentile", "trimmed_mean", "stddev", "stddev_pop"] as const;
export type Agg = (typeof AGGS)[number];

export const BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const COLLAPSE_AGGS = ["sum", "avg", "min", "max", "count", "first", "last"] as const;
export type CollapseAgg = (typeof COLLAPSE_AGGS)[number];

/** Largest number of groups one answer may hold. */
export const MAX_GROUPS = 5000;
export const DEFAULT_GROUPS = 1000;
export const MAX_JOINS = 5;
export const MAX_GROUP_FIELDS = 3;

const Ref = z.string().min(1).max(200);

/** `p90` is a short way to write `{ agg: "percentile", p: 90 }`; a bare preset name is a range. */
function normalizeMeasure(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const m = typeof o.agg === "string" ? /^p(\d{1,2}(?:\.\d+)?)$/i.exec(o.agg) : null;
    if (m) return { ...o, agg: "percentile", p: Number(m[1]) };
  }
  return v;
}

export const MeasureSchema = z.preprocess(
  normalizeMeasure,
  z
    .strictObject({
      agg: z.enum(AGGS),
      /** Column to aggregate. Optional only for `count` (counts rows). */
      field: Ref.optional(),
      /** `percentile`: 0 to 100. */
      p: z.number().min(0).max(100).optional(),
      /** `trimmed_mean`: share cut from each end (default 0.1 = 10%). */
      trim: z.number().min(0).max(0.49).optional(),
    })
    .superRefine((m, ctx) => {
      if (m.agg !== "count" && !m.field) ctx.addIssue({ code: "custom", path: ["field"], message: `Phép "${m.agg}" cần chỉ rõ cột (field).` });
      if (m.agg === "percentile" && m.p === undefined) ctx.addIssue({ code: "custom", path: ["p"], message: 'Phép "percentile" cần p từ 0 đến 100 (ví dụ 90 cho P90).' });
      if (m.agg !== "percentile" && m.p !== undefined) ctx.addIssue({ code: "custom", path: ["p"], message: 'Chỉ phép "percentile" dùng p.' });
      if (m.agg !== "trimmed_mean" && m.trim !== undefined) ctx.addIssue({ code: "custom", path: ["trim"], message: 'Chỉ phép "trimmed_mean" dùng trim.' });
    }),
);
export type Measure = z.output<typeof MeasureSchema>;

/** A range of days: the ranges of the Datahub time filter plus "the last N months". */
export const RelativeMonthsSchema = z.strictObject({ kind: z.literal("last_n_months"), n: z.number().int().min(1).max(120) });
export const RangeSchema = z.preprocess(
  (v) => (typeof v === "string" && (TIME_PRESETS as readonly string[]).includes(v) ? { kind: "preset", preset: v } : v),
  z.union([TimeRangeSchema, RelativeMonthsSchema]),
);
export type Range = z.output<typeof RangeSchema>;

export const TimeSpecSchema = z.strictObject({
  /** Date column the range and the time buckets read. */
  field: Ref.optional(),
  bucket: z.enum(BUCKETS).optional(),
  range: RangeSchema.optional(),
});
export type TimeSpec = z.output<typeof TimeSpecSchema>;

export const GroupSchema = z.preprocess(
  (v) => (typeof v === "string" ? { field: v } : v),
  z.strictObject({ field: Ref, /** Date columns only; default `day`. */ bucket: z.enum(BUCKETS).optional() }),
);
export type Group = z.output<typeof GroupSchema>;

export const JoinSchema = z
  .strictObject({
    /** Table to join (id or name), same datahub as the base table. */
    table: Ref,
    /** Name of the joined table inside the metric (`Alias.Column`). Default: the table name. */
    as: Ref.optional(),
    /** Relation column of the base table that links to the joined table (preferred). */
    link: Ref.optional(),
    /** Or pairs of key columns: `left` in the base table, `right` in the joined table. */
    on: z.array(z.strictObject({ left: Ref, right: Ref })).min(1).max(3).optional(),
    /**
     * How a joined column is folded to ONE value per base row before joining, so that a many-rows table never multiplies the
     * numbers. Default: sum for numbers, "any true" for checkboxes, smallest for the rest.
     */
    collapse: z.record(Ref, z.enum(COLLAPSE_AGGS)).optional(),
  })
  .superRefine((j, ctx) => {
    if ((j.link ? 1 : 0) + (j.on ? 1 : 0) !== 1) ctx.addIssue({ code: "custom", message: 'Mỗi phép ghép cần đúng một trong "link" (cột Liên kết) hoặc "on" (cặp cột khoá).' });
  });
export type JoinDef = z.output<typeof JoinSchema>;

export const SourceDefSchema = z.strictObject({
  name: z.string().max(100).optional(),
  /** Base table (id or name). */
  table: Ref,
  joins: z.array(JoinSchema).max(MAX_JOINS).optional(),
});
export type SourceDef = z.output<typeof SourceDefSchema>;

export const MetricNameSchema = z.string().normalize("NFC").trim().min(1).max(100).refine((s) => !/[[\]]/.test(s), "Tên không chứa [ hoặc ].");

export const MetricDefSchema = z.strictObject({
  name: MetricNameSchema,
  description: z.string().max(500).optional(),
  /** Saved source (id or name), a table (id or name) or an inline source. */
  source: z.union([Ref, SourceDefSchema]),
  measure: MeasureSchema,
  filter: FilterSchema.optional(),
  time: TimeSpecSchema.optional(),
  group_by: z.array(GroupSchema).max(MAX_GROUP_FIELDS).optional(),
  /** How a number is shown. The server never rounds; this is only a hint for screens. */
  format: z.enum(["number", "money", "percent", "days"]).optional(),
});
export type MetricDef = z.output<typeof MetricDefSchema>;

/** What a call to `metrics.query` may change on top of a metric. */
export const QueryOverridesSchema = z.strictObject({
  time: TimeSpecSchema.optional(),
  group_by: z.array(GroupSchema).max(MAX_GROUP_FIELDS).optional(),
  filter: FilterSchema.optional(),
  order: z.enum(["group", "value_desc", "value_asc"]).optional(),
  limit: z.number().int().min(1).max(MAX_GROUPS).optional(),
});
export type QueryOverrides = z.output<typeof QueryOverridesSchema>;

/** Parses JSON against a schema; a failure is a `validation_error` that lists every problem with its path. */
export function parseJson<S extends z.ZodType>(schema: S, raw: unknown, what: string): z.output<S> {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  throw new AppError("validation_error", `${what} không hợp lệ: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(gốc)"}: ${i.message}`).join("; ")}`, {
    reason: "invalid_json",
    issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}
