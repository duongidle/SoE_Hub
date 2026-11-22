import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, type Actor } from "@soe/shared";
import type { Executor } from "@soe/db";
import { columnTypeDef } from "../datahub/column-types";
import { isComputedType } from "../datahub/cell-values";
import { emptyConfig, FormConfigSchema, type FormConfig } from "./config";

export const Id = z.uuid();
export const FORM_STATUSES = ["draft", "open", "paused", "closed"] as const;
export const FORM_ACCESS = ["public", "all_accounts", "selected"] as const;
export const VERSION_COLUMN_NAME = "Phiên bản form";
export const DAILY_LIMIT_MAX = 1000;

export const AudienceSchema = z.strictObject({
  user_ids: z.array(Id).max(500).default([]),
  /** Leader ids: the Leader and the people of their team. */
  team_ids: z.array(Id).max(200).default([]),
  roles: z.array(z.enum(["manager", "leader", "user"])).max(3).default([]),
  guest_ids: z.array(Id).max(500).default([]),
  guest_presets: z.array(z.enum(["sale", "data"])).max(2).default([]),
});
export type Audience = z.infer<typeof AudienceSchema>;

const iso = z.iso.datetime({ offset: true });
export const OptionsSchema = z.strictObject({
  one_per_user: z.boolean().optional(),
  open_at: iso.nullable().optional(),
  close_at: iso.nullable().optional(),
  max_responses: z.number().int().min(1).max(10_000_000).nullable().optional(),
  closed_message: z.string().trim().max(300).nullable().optional(),
  daily_limit: z.number().int().min(1).max(DAILY_LIMIT_MAX).optional(),
  file_max_bytes: z.number().int().min(1).max(10 * 1024 * 1024).optional(),
  files_per_question: z.number().int().min(1).max(5).optional(),
  /** People the owner named to grade the quiz (the owner always may). */
  graders: z.array(Id).max(50).optional(),
});
export type FormOptions = z.infer<typeof OptionsSchema>;

export interface FormRow {
  id: string;
  ownerId: string;
  name: string;
  tableId: string | null;
  status: (typeof FORM_STATUSES)[number];
  code: string;
  access: (typeof FORM_ACCESS)[number];
  audience: Audience;
  options: FormOptions;
  notifyNewResponse: boolean;
  draft: FormConfig;
  publishedVersion: number;
  version: number;
  createdAt: string;
  deletedAt: string | null;
}

type Raw = Record<string, unknown>;
export function formFromDb(r: Raw): FormRow {
  return {
    id: r.id as string,
    ownerId: r.owner_id as string,
    name: r.name as string,
    tableId: (r.table_id as string | null) ?? null,
    status: r.status as FormRow["status"],
    code: r.code as string,
    access: r.access as FormRow["access"],
    audience: AudienceSchema.parse(r.audience ?? {}),
    options: (r.options ?? {}) as FormOptions,
    notifyNewResponse: !!r.notify_new_response,
    draft: FormConfigSchema.parse(Object.keys((r.draft as object) ?? {}).length ? r.draft : emptyConfig(r.name as string)),
    publishedVersion: r.published_version as number,
    version: r.version as number,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    deletedAt: r.deleted_at ? (r.deleted_at instanceof Date ? r.deleted_at.toISOString() : String(r.deleted_at)) : null,
  };
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
/** A link code nobody can guess: 10 random characters (design module7 3.1). */
export function newCode(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** System-scope read: the caller has already decided who may read (the owner, or the filler of an open form). */
export async function loadFormRow(db: Executor, where: ReturnType<typeof sql>, opts: { trashed?: boolean } = {}): Promise<FormRow | null> {
  const r = await db.execute(sql`SELECT * FROM forms WHERE /*scope:system*/ ${where} AND ${opts.trashed ? sql`deleted_at IS NOT NULL` : sql`deleted_at IS NULL`}`);
  return r.rows[0] ? formFromDb(r.rows[0] as Raw) : null;
}

export async function loadOwnForm(db: Executor, userId: string, formId: string, opts: { trashed?: boolean } = {}): Promise<FormRow> {
  const f = await loadFormRow(db, sql`id = ${formId}::uuid`, opts);
  if (!f || f.ownerId !== userId) throw new AppError("not_found", "Không tìm thấy form.");
  return f;
}

export interface LiveColumn {
  key: string;
  name: string;
  type: string;
  required: boolean;
  hasDefault: boolean;
  isUnique: boolean;
  options: { id: string; name: string }[];
}

/** The live columns of a table by key (the columns a form may write to). */
export async function liveColumns(db: Executor, tableId: string | null): Promise<Map<string, LiveColumn>> {
  const out = new Map<string, LiveColumn>();
  if (!tableId) return out;
  const r = await db.execute(sql`SELECT key, name, type, required, is_unique, default_value IS NOT NULL AS has_default, config FROM dh_columns WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL ORDER BY position, created_at, id`);
  for (const c of r.rows as Raw[]) {
    const options = ((c.config as { options?: { id: string; name: string }[] } | null)?.options ?? []).map((o) => ({ id: o.id, name: o.name }));
    out.set(c.key as string, { key: c.key as string, name: c.name as string, type: c.type as string, required: !!c.required, hasDefault: !!c.has_default, isUnique: !!c.is_unique, options });
  }
  return out;
}

/** A column a person can type into: not computed, not automatic (design module7 1.1). */
export function fillable(c: { type: string }): boolean {
  const def = columnTypeDef(c.type as never);
  return def.writable && !def.virtual && !isComputedType(c.type as never) && c.type !== "auto_number";
}

export function tableAlive(db: Executor, tableId: string) {
  return db.execute(sql`SELECT 1 FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ t.id = ${tableId}::uuid AND t.deleted_at IS NULL AND d.deleted_at IS NULL`).then((r) => r.rows.length > 0);
}

export type FormState = { state: "draft" | "open" | "paused" | "closed" | "not_started"; reason?: "table_deleted" | "owner" | "dates" | "limit" };

/** What people meet (design module7 1.3, 3.2): the status the owner chose, then the dates, the response limit and the state of the table. */
export function stateOf(f: FormRow, o: { now: Date; responses: number; tableAlive: boolean }): FormState {
  if (f.status === "draft" || f.publishedVersion === 0) return { state: "draft" };
  if (f.status === "closed") return { state: "closed", reason: "owner" };
  if (f.status === "paused") return { state: "paused", reason: "owner" };
  if (f.tableId && !o.tableAlive) return { state: "paused", reason: "table_deleted" };
  if (f.options.open_at && new Date(f.options.open_at) > o.now) return { state: "not_started", reason: "dates" };
  if (f.options.close_at && new Date(f.options.close_at) <= o.now) return { state: "closed", reason: "dates" };
  if (f.options.max_responses && o.responses >= f.options.max_responses) return { state: "closed", reason: "limit" };
  return { state: "open" };
}

export async function responseCount(db: Executor, formId: string): Promise<number> {
  const r = await db.execute(sql`/*scope:system*/ SELECT count(*)::int AS n FROM form_responses WHERE form_id = ${formId}::uuid`);
  return (r.rows[0] as { n: number }).n;
}

export const stableJson = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

export async function latestConfig(db: Executor, f: FormRow): Promise<FormConfig | null> {
  if (f.publishedVersion === 0) return null;
  return versionConfig(db, f.id, f.publishedVersion);
}
export async function versionConfig(db: Executor, formId: string, version: number): Promise<FormConfig | null> {
  const r = await db.execute(sql`/*scope:system*/ SELECT config FROM form_versions WHERE form_id = ${formId}::uuid AND version = ${version}::int`);
  return r.rows[0] ? FormConfigSchema.parse((r.rows[0] as { config: unknown }).config) : null;
}

/** A context that acts as the OWNER of the form's table: filling or grading a form gives the person no right on the table (design module7 5.1). */
export function ownerCtx(ctx: { db: Executor }, f: FormRow) {
  const actor: Actor = { userId: f.ownerId, via: "form", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: null };
  return { db: ctx.db, actor };
}
