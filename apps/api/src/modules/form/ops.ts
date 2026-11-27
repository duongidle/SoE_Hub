import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, DH_NAME_MAX } from "@soe/shared";
import { newId, type Executor } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { loadDatahubAccess, loadTableAccess, type TableAccess } from "../datahub/access";
import { createColumn } from "../datahub/columns";
import { columnTypeOf, compatibleTypes, conditionLeaves, conditionRefs, optionIdOf, remapOptionRefs, emptyConfig, flatten, FormConfigSchema, isSelect, questionsOf, type FormConfig, type Question } from "./config";
import { STRUCTURE_EVENT } from "../datahub/shared";
import { createTableIn } from "../datahub/structure";
import { updateColumn } from "../datahub/columns";
import { TableSchema } from "../datahub/table-schema";
import { AUTO_INPUTS, ensureQuizColumns, isGraded, isManual } from "./quiz";
import {
  AudienceSchema, FORM_ACCESS, FORM_STATUSES, Id, OptionsSchema, VERSION_COLUMN_NAME, fillable, formFromDb, latestConfig, liveColumns, loadFormRow, loadOwnForm, newCode,
  responseCount, stableJson, stateOf, tableAlive, type FormRow, type LiveColumn,
} from "./shared";

type Ctx = HandlerCtx;
type Raw = Record<string, unknown>;

export interface FormIssue {
  code: string;
  message: string;
  block_id?: string;
  column?: string;
}

const FormOut = z.object({
  id: Id,
  name: z.string(),
  status: z.enum(FORM_STATUSES),
  /** What people meet: the status, the dates, the response limit and the table together. */
  state: z.enum(["draft", "open", "paused", "closed", "not_started"]),
  state_reason: z.string().nullable(),
  code: z.string(),
  link_path: z.string(),
  access: z.enum(FORM_ACCESS),
  audience: z.unknown(),
  options: z.unknown(),
  notify_new_response: z.boolean(),
  table_id: Id.nullable(),
  table_name: z.string().nullable(),
  published_version: z.number().int(),
  has_unpublished: z.boolean(),
  response_count: z.number().int(),
  last_response_at: z.string().nullable(),
  version: z.number().int(),
  created_at: z.string(),
  deleted_at: z.string().nullable(),
});

/** Questions whose column is gone: switched off, the form keeps taking the others (design module7 1.3). */
export function disabledIds(cfg: FormConfig, cols: Map<string, LiveColumn>, hasTable: boolean): Set<string> {
  const out = new Set<string>();
  for (const q of questionsOf(cfg)) if (q.column_id && hasTable && !cols.has(q.column_id)) out.add(q.id);
  return out;
}

async function summary(db: Executor, f: FormRow, extra: { responses?: number; last?: string | null; tableName?: string | null; alive?: boolean } = {}) {
  const responses = extra.responses ?? (await responseCount(db, f.id));
  let tableName = extra.tableName;
  let alive = extra.alive;
  if (f.tableId && (tableName === undefined || alive === undefined)) {
    const r = await db.execute(sql`SELECT t.name, (t.deleted_at IS NULL AND d.deleted_at IS NULL) AS alive FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ t.id = ${f.tableId}::uuid`);
    const row = r.rows[0] as { name: string; alive: boolean } | undefined;
    tableName = row?.name ?? null;
    alive = row?.alive ?? false;
  }
  let last = extra.last;
  if (last === undefined) {
    const r = await db.execute(sql`/*scope:system*/ SELECT max(created_at) AS at FROM form_responses WHERE form_id = ${f.id}::uuid`);
    const at = (r.rows[0] as { at: Date | string | null }).at;
    last = at ? new Date(at).toISOString() : null;
  }
  const st = stateOf(f, { now: new Date(), responses, tableAlive: f.tableId ? !!alive : true });
  const published = await latestConfig(db, f);
  return {
    id: f.id, name: f.name, status: f.status, state: st.state, state_reason: st.reason ?? null, code: f.code, link_path: `/f/${f.code}`, access: f.access, audience: f.audience, options: f.options,
    notify_new_response: f.notifyNewResponse, table_id: f.tableId, table_name: tableName ?? null, published_version: f.publishedVersion,
    has_unpublished: !published || stableJson(published) !== stableJson(f.draft), response_count: responses, last_response_at: last, version: f.version, created_at: f.createdAt, deleted_at: f.deletedAt,
  };
}

const touch = (ctx: Ctx, f: FormRow) => ctx.audit({ type: "form", id: f.id, details: { name: f.name } });

// ---------------------------------------------------------------------------------------------
// target table (design module7 1.1)
// ---------------------------------------------------------------------------------------------

/** The tables a form may not write to (design module7 1.1): the datahub "Quản lý Deal", someone else's table, a merged table, a template table. */
async function assertTargetOk(ctx: Ctx, acc: TableAccess): Promise<void> {
  const r = await ctx.db.execute(sql`SELECT system_key FROM dh_datahubs WHERE /*scope:system*/ id = ${acc.datahub.id}::uuid`);
  if ((r.rows[0] as { system_key: string | null } | undefined)?.system_key) throw new AppError("validation_error", "Form không ghi vào bảng của Quản lý Deal.", { reason: "form_target_deal" });
  if (acc.table.kind === "merged") throw new AppError("validation_error", "Form không ghi vào bảng gộp (chỉ đọc).", { reason: "form_target_merged" });
  if (acc.table.templateId) throw new AppError("validation_error", "Form không ghi vào bảng template.", { reason: "form_target_template" });
}

export async function ownTable(ctx: Ctx, tableId: string): Promise<TableAccess> {
  const acc = await loadTableAccess(ctx, tableId, "view");
  if (acc.level !== "owner") throw new AppError("validation_error", "Form chỉ ghi vào bảng của chính bạn, không ghi vào bảng người khác chia sẻ.", { reason: "form_target_shared" });
  await assertTargetOk(ctx, acc);
  return acc;
}

/** The system column "Phiên bản form" of the target table (design module7 2.2): created once, filled with the version of every response. */
export async function ensureVersionColumn(ctx: Ctx, acc: TableAccess): Promise<string> {
  const r = await ctx.db.execute(sql`SELECT key FROM dh_columns WHERE /*scope:system*/ table_id = ${acc.tableId}::uuid AND deleted_at IS NULL AND type = 'number' AND name_norm = lower(btrim(${VERSION_COLUMN_NAME}))`);
  const have = (r.rows[0] as { key: string } | undefined)?.key;
  if (have) return have;
  const col = await createColumn(ctx, acc, { name: VERSION_COLUMN_NAME, type: "number", allow_edit: false, description: "Cột của form: phiên bản form đã dùng khi gửi." }, {});
  return col.key as string;
}

// ---------------------------------------------------------------------------------------------
// connecting a question to a column (design module7 2.3a)
// ---------------------------------------------------------------------------------------------

/** A column name from the text of a question: `[` `]` removed, 100 characters cut at a word, a taken name gets ` (2)`, ` (3)`... */
export function columnNameFor(label: string, position: number, taken: Set<string>): string {
  let s = label.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
  if (!s) s = `Câu hỏi ${position}`;
  const cut = (x: string, max: number) => {
    if (x.length <= max) return x;
    const head = x.slice(0, max);
    const sp = head.lastIndexOf(" ");
    return (sp > max / 2 ? head.slice(0, sp) : head).trim();
  };
  s = cut(s, DH_NAME_MAX);
  let name = s;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${cut(s, DH_NAME_MAX - ` (${n})`.length)} (${n})`;
  return name;
}

interface DraftLink {
  /** The question's options as they stand in the column after the link. */
  options?: { id?: string; label: string }[];
}

async function createColumnFor(ctx: Ctx, acc: TableAccess, q: Question, position: number, taken: Set<string>): Promise<{ column: { key: string; name: string }; link: DraftLink }> {
  const name = columnNameFor(q.label, position, taken);
  taken.add(name.toLowerCase());
  const type = columnTypeOf(q.input);
  const config: Record<string, unknown> = isSelect(q.input) ? { options: (q.options ?? []).map((o) => ({ name: o.label })) } : {};
  const col = await createColumn(ctx, acc, { name, type: type as never, config, ...(q.default !== undefined && q.default !== null ? { default_value: undefined } : {}) }, {});
  const out = col as unknown as { key: string; name: string; config: { options?: { id: string; name: string }[] } };
  const link: DraftLink = {};
  if (isSelect(q.input)) link.options = (q.options ?? []).map((o) => ({ id: out.config.options?.find((c) => c.name.toLowerCase() === o.label.toLowerCase())?.id ?? o.id, label: o.label }));
  return { column: { key: out.key, name: out.name }, link };
}

/** Sets `column_id` (and the option ids of the column) on a question of the draft. */
function patchQuestion(cfg: FormConfig, qid: string, patch: Partial<Question>): FormConfig {
  const walk = (list: FormConfig["blocks"]): FormConfig["blocks"] =>
    list.map((b) => (b.type === "question" && b.id === qid ? ({ ...b, ...patch } as typeof b) : b.type === "group" ? ({ ...b, blocks: walk((b as { blocks: FormConfig["blocks"] }).blocks) } as typeof b) : b));
  return { ...cfg, blocks: walk(cfg.blocks) };
}

async function saveDraft(ctx: Ctx, f: FormRow, cfg: FormConfig): Promise<void> {
  await ctx.db.execute(sql`/*scope:system*/ UPDATE forms SET draft = ${JSON.stringify(cfg)}::jsonb, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE id = ${f.id}::uuid`);
}

// ---------------------------------------------------------------------------------------------
// publishing (design module7 2.2, 2.3a, 2.3b, 2.4)
// ---------------------------------------------------------------------------------------------

/** Questions only an internal form can have: "Người điền" (fill_self), Người dùng (user) and Liên kết (relation) pick a person or a row, which a public form has nobody to vouch for (design module7 2). The one rule used by publishing, by changing access and by the public submit. */
export const INTERNAL_ONLY_INPUTS: readonly string[] = ["user", "relation"];
export function isInternalOnly(q: Question): boolean {
  return !!q.fill_self || INTERNAL_ONLY_INPUTS.includes(q.input);
}
export function internalOnlyIssues(cfg: FormConfig): FormIssue[] {
  return flatten(cfg.blocks)
    .filter((f) => f.block.type === "question" && isInternalOnly(f.block as Question))
    .map((f) => {
      const q = f.block as Question;
      return { code: "internal_only", message: `Câu "${q.label || q.id}" (${q.fill_self ? "Người điền" : q.input === "user" ? "Người dùng" : "Liên kết"}) chỉ dùng cho form nội bộ.`, block_id: q.id };
    });
}

/** Everything that stops a form from being published, one entry per problem (the editor shows them next to the question). */
export function checkPublish(cfg: FormConfig, cols: Map<string, LiveColumn>, hasTable: boolean, access?: string): FormIssue[] {
  const issues: FormIssue[] = [];
  const flat = flatten(cfg.blocks);
  const seen = new Set<string>();
  const posOf = new Map<string, number>();
  for (const f of flat) {
    if (seen.has(f.block.id)) issues.push({ code: "duplicate_id", message: `Mã khối "${f.block.id}" bị trùng.`, block_id: f.block.id });
    seen.add(f.block.id);
    posOf.set(f.block.id, f.pos);
  }
  const questions = flat.filter((f) => f.block.type === "question");
  const disabled = disabledIds(cfg, cols, hasTable);
  if (access === "public") issues.push(...internalOnlyIssues(cfg).filter((i) => !disabled.has(i.block_id!)));
  const linked = new Map<string, string>();
  const unlinked: Question[] = [];
  for (const f of questions) {
    const q = f.block as Question;
    if (disabled.has(q.id)) continue;
    if (!q.column_id) {
      unlinked.push(q);
      continue;
    }
    const col = cols.get(q.column_id);
    if (!hasTable || !col) {
      issues.push({ code: "no_table", message: "Form có câu hỏi cần lưu nhưng chưa có bảng đích.", block_id: q.id });
      continue;
    }
    if (q.fill_self && (q.input !== "user" || !q.hidden || access === "public")) issues.push({ code: "fill_self", message: `Câu "${q.label || q.id}": "Người điền" phải là câu ẩn kiểu Người dùng của form nội bộ.`, block_id: q.id });
    if (linked.has(q.column_id)) issues.push({ code: "duplicate_column", message: `Câu "${q.label}" và một câu khác cùng nối vào cột "${col.name}".`, block_id: q.id, column: col.name });
    linked.set(q.column_id, q.id);
    if (!compatibleTypes(q.input).includes(col.type)) issues.push({ code: "type_mismatch", message: `Câu "${q.label}" không nối được vào cột "${col.name}" (kiểu cột không hợp).`, block_id: q.id, column: col.name });
    if (isSelect(q.input)) for (const o of q.options ?? []) if (!o.id || !col.options.some((c) => c.id === o.id)) issues.push({ code: "option_missing", message: `Lựa chọn "${o.label}" của câu "${q.label}" chưa có trong cột "${col.name}".`, block_id: q.id, column: col.name });
  }
  if (unlinked.length) {
    issues.push({ code: "unlinked_question", message: `Còn ${unlinked.length} câu chưa nối cột.`, block_id: unlinked[0]!.id });
    for (const q of unlinked.slice(0, 50)) issues.push({ code: "unlinked_question_item", message: `Câu "${q.label || q.id}" chưa nối cột.`, block_id: q.id });
  }
  // Conditions only look back (design module7 2.4): an unknown question, a later one, or an operator a form does not know.
  for (const f of flat) {
    const b = f.block as { show_if?: Parameters<typeof conditionRefs>[0] };
    if (b.show_if) {
      const { fields, badOps } = conditionRefs(b.show_if);
      for (const fld of fields) {
        const p = posOf.get(fld);
        if (p === undefined || flat[p]!.block.type !== "question") issues.push({ code: "condition_unknown", message: `Điều kiện của "${f.block.id}" trỏ tới câu "${fld}" không có.`, block_id: f.block.id });
        else if (p >= f.pos) issues.push({ code: "condition_forward", message: `Điều kiện của "${f.block.id}" phải trỏ tới câu đứng trước nó.`, block_id: f.block.id });
      }
      for (const l of conditionLeaves(b.show_if)) {
        const src = posOf.get(l.field) !== undefined ? (flat[posOf.get(l.field)!]!.block as Question) : null;
        if (src && src.type === "question" && isSelect(src.input) && !["is_empty", "is_not_empty"].includes(l.op)) {
          const vals = Array.isArray(l.value) ? l.value : [l.value];
          if (vals.some((v) => optionIdOf(src, v) === null)) issues.push({ code: "condition_option", message: `Điều kiện của "${f.block.id}" trỏ tới một lựa chọn không còn trong câu "${src.label || src.id}".`, block_id: f.block.id });
        }
      }
      for (const op of badOps) issues.push({ code: "condition_op", message: `Điều kiện của "${f.block.id}" dùng phép "${op}" mà form không hỗ trợ.`, block_id: f.block.id });
    }
    if (f.block.type === "question") {
      for (const [opt, targets] of Object.entries((f.block as Question).reveal ?? {})) {
        if (optionIdOf(f.block as Question, opt) === null) issues.push({ code: "reveal_option", message: `"Khi chọn thì hiện" của câu "${f.block.id}" trỏ tới một lựa chọn không còn.`, block_id: f.block.id });
        for (const t of targets) {
          const p = posOf.get(t);
          if (p === undefined || p <= f.pos) issues.push({ code: "reveal_target", message: `"Khi chọn thì hiện" của câu "${f.block.id}" (lựa chọn ${opt}) trỏ tới khối "${t}" không có hoặc đứng trước.`, block_id: f.block.id });
        }
      }
    }
  }
  if (cfg.quiz?.enabled) issues.push(...checkQuiz(cfg, access, disabled));
  if (hasTable) {
    const conditional = (q: Question, f: (typeof flat)[number]): boolean => {
      if (q.hidden) return false;
      for (let g: typeof f | null = f; g; g = g.group) if ((g.block as { show_if?: unknown }).show_if) return true;
      return flat.some((x) => x.block.type === "question" && Object.values((x.block as Question).reveal ?? {}).some((t) => t.includes(f.block.id) || (f.group && t.includes(f.group.block.id))));
    };
    for (const c of cols.values()) {
      if (!c.required || !fillable(c) || c.hasDefault || c.name.toLowerCase() === VERSION_COLUMN_NAME.toLowerCase()) continue;
      const qid = linked.get(c.key);
      if (!qid) issues.push({ code: "required_column_missing", message: `Cột ${c.name} là bắt buộc trong bảng nhưng form chưa có câu này.`, column: c.name });
      else {
        const f = flat.find((x) => x.block.id === qid)!;
        if (conditional(f.block as Question, f)) issues.push({ code: "required_column_conditional", message: `Cột ${c.name} là bắt buộc trong bảng nhưng câu nối vào có thể bị ẩn bởi điều kiện.`, block_id: qid, column: c.name });
      }
    }
  }
  return issues;
}

/** Quiz settings (design module7 6): internal forms only, an answer for every auto-graded question, a sound rubric. */
function checkQuiz(cfg: FormConfig, access: string | undefined, disabled: Set<string>): FormIssue[] {
  const issues: FormIssue[] = [];
  if (access === "public") issues.push({ code: "quiz_public", message: "Bài kiểm tra chỉ dùng cho form nội bộ (cần biết ai làm bài)." });
  const graded = questionsOf(cfg).filter((q) => isGraded(q) && !disabled.has(q.id));
  if (graded.length === 0) issues.push({ code: "quiz_no_points", message: "Bài kiểm tra chưa có câu nào có điểm." });
  const pass = cfg.quiz?.pass;
  if (pass && pass.type === "percent" && pass.value > 100) issues.push({ code: "quiz_pass", message: "Ngưỡng đạt theo % tối đa 100." });
  for (const q of graded) {
    const bad = (code: string, message: string) => issues.push({ code, message: `Câu "${q.label || q.id}": ${message}`, block_id: q.id });
    if (!isManual(q)) {
      const a = q.answer;
      if (q.input === "single_select" || q.input === "multi_select") {
        const list = Array.isArray(a) ? a : [a];
        const known = (x: unknown) => optionIdOf(q, x) !== null;
        if (q.input === "single_select" && Array.isArray(a)) bad("quiz_answer_invalid", "chọn một đáp án đúng.");
        else if (list.length === 0 || !list.every(known)) bad("quiz_answer_invalid", "đáp án đúng phải là lựa chọn của câu hỏi.");
      } else if (q.input === "text") {
        const list = Array.isArray(a) ? a : [a];
        if (list.length === 0 || !list.every((x) => typeof x === "string" && x.trim() !== "")) bad("quiz_answer_invalid", "cần ít nhất một đáp án chấp nhận.");
      } else if (typeof a === "object" && a !== null && !Array.isArray(a)) {
        const r = a as { min?: unknown; max?: unknown };
        if ((r.min === undefined && r.max === undefined) || (r.min !== undefined && typeof r.min !== "number") || (r.max !== undefined && typeof r.max !== "number") || (typeof r.min === "number" && typeof r.max === "number" && r.min > r.max)) bad("quiz_answer_invalid", "khoảng đáp án không hợp lệ.");
      } else if (typeof a !== "number") bad("quiz_answer_invalid", "đáp án là một số hoặc một khoảng.");
    } else if (q.rubric?.length) {
      if (q.rubric.every((c) => (c.weight ?? 1) <= 0)) bad("quiz_rubric", "phiếu chấm cần ít nhất một tiêu chí có trọng số.");
      for (const c of q.rubric) if ((c.floor ?? 0) > (c.max ?? 5) || (c.min ?? 1) > (c.max ?? 5)) bad("quiz_rubric", `tiêu chí "${c.label}" có thang hoặc điểm sàn không hợp lệ.`);
    }
    if (!AUTO_INPUTS.has(q.input) && q.input !== "long_text" && q.input !== "attachment") bad("quiz_input", "loại câu này không chấm điểm được.");
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------------------------

/** Publishes the draft of a form of the caller (the body of `form.form.publish`; `onboarding.plan.clone` publishes the copy of a published form with it). */
export async function publishForm(ctx: Ctx, formId: string): Promise<{ id: string; published_version: number; status: (typeof FORM_STATUSES)[number] }> {
  await ctx.db.execute(sql`/*scope:system*/ SELECT 1 FROM forms WHERE id = ${formId}::uuid FOR UPDATE`);
  const f = await loadOwnForm(ctx.db, ctx.actor.userId, formId);
  const cols = await liveColumns(ctx.db, f.tableId);
  if (f.tableId && !(await tableAlive(ctx.db, f.tableId))) throw new AppError("conflict", "Bảng đích đã bị xoá. Khôi phục bảng trước khi xuất bản.", { reason: "table_deleted" });
  const issues = checkPublish(f.draft, cols, !!f.tableId, f.access);
  if (issues.length) throw new AppError("validation_error", `Chưa xuất bản được: ${issues[0]!.message}`, { issues });
  if (f.tableId) {
    const acc = await ownTable(ctx, f.tableId);
    await ensureVersionColumn(ctx, acc);
    if (f.draft.quiz?.enabled) await ensureQuizColumns(ctx, acc, await liveColumns(ctx.db, f.tableId));
  }
  const next = f.publishedVersion + 1;
  await ctx.db.execute(sql`INSERT INTO form_versions (form_id, version, config, published_by) VALUES (${f.id}::uuid, ${next}::int, ${JSON.stringify(f.draft)}::jsonb, ${ctx.actor.userId}::uuid)`);
  const status = f.status === "draft" ? "open" : f.status;
  await ctx.db.execute(sql`/*scope:system*/ UPDATE forms SET published_version = ${next}::int, status = ${status}, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE id = ${f.id}::uuid`);
  ctx.audit({ type: "form", id: f.id, details: { name: f.name, published_version: next } });
  return { id: f.id, published_version: next, status };
}

/** Creates a form (a new table in `datahub_id`, or the owner's own table `table_id`, or none) with an optional first draft. Returns the id. */
export async function createFormIn(ctx: Ctx, i: { name: string; datahub_id?: string; table_id?: string }, draft?: FormConfig): Promise<string> {
  if (i.datahub_id && i.table_id) throw new AppError("validation_error", "Chọn một trong hai: bảng có sẵn hoặc datahub để tạo bảng mới.");
  let acc: TableAccess | null = null;
  if (i.table_id) acc = await ownTable(ctx, i.table_id);
  else if (i.datahub_id) {
    const dh = await loadDatahubAccess(ctx, i.datahub_id, "owner");
    if (dh.systemKey) throw new AppError("validation_error", "Form không ghi vào bảng của Quản lý Deal.", { reason: "form_target_deal" });
    acc = await createTableIn(ctx, dh, i.name.slice(0, DH_NAME_MAX));
  }
  const id = newId();
  let code = newCode();
  for (let n = 0; n < 5; n++) {
    const clash = await ctx.db.execute(sql`/*scope:system*/ SELECT 1 FROM forms WHERE code = ${code}`);
    if (clash.rows.length === 0) break;
    code = newCode();
  }
  await ctx.db.execute(sql`INSERT INTO forms (id, owner_id, name, table_id, code, draft, created_by, updated_by) VALUES (${id}::uuid, ${ctx.actor.userId}::uuid, ${i.name}, ${acc?.tableId ?? null}::uuid, ${code}, ${JSON.stringify(draft ?? emptyConfig(i.name))}::jsonb, ${ctx.actor.userId}::uuid, ${ctx.actor.userId}::uuid)`);
  if (acc) await ensureVersionColumn(ctx, acc);
  ctx.audit({ type: "form", id, details: { name: i.name } });
  return id;
}

/** Creates a column for every question of `cfg` that has none (or only `only`), returns the new draft. The one place "create columns for the questions" is done. */
export async function createColumnsFor(ctx: Ctx, tableId: string, cfg: FormConfig, only?: string[]): Promise<{ cfg: FormConfig; created: { question_id: string; column_id: string; column_name: string }[] }> {
  const acc = await ownTable(ctx, tableId);
  const cols = await liveColumns(ctx.db, tableId);
  const taken = new Set([...cols.values()].map((c) => c.name.toLowerCase()));
  const disabled = disabledIds(cfg, cols, true);
  const qs = questionsOf(cfg);
  let out = cfg;
  const created: { question_id: string; column_id: string; column_name: string }[] = [];
  for (const q of qs) {
    if ((q.column_id && !disabled.has(q.id)) || (only && !only.includes(q.id))) continue;
    const made = await createColumnFor(ctx, acc, q, qs.indexOf(q) + 1, taken);
    out = patchQuestion(out, q.id, { column_id: made.column.key, ...(made.link.options ? { options: made.link.options } : {}) });
    if (made.link.options) out = remapOptionRefs(out, q.id, q.options ?? [], made.link.options);
    created.push({ question_id: q.id, column_id: made.column.key, column_name: made.column.name });
  }
  return { cfg: out, created };
}

export { saveDraft };

const FormId = z.object({ form_id: Id });
const MANAGE = { permission: "form:form:create" as const, aiAllowed: true, menu: "form" as const };

export const formManageOperations = [
  defineCommand({
    name: "form.form.create",
    summary: "Tạo form. Có `table_id` thì ghi vào bảng sẵn có của bạn; có `datahub_id` thì tạo bảng mới (tên = tên form) trong datahub đó; không có cả hai thì form chưa có bảng đích.",
    description: "Không chọn được bảng của Quản lý Deal, bảng người khác chia sẻ, bảng gộp, bảng template. Bảng đích có thêm cột hệ thống `Phiên bản form`.",
    ...MANAGE,
    emits: [STRUCTURE_EVENT],
    input: z.object({ name: z.string().trim().min(1).max(200), datahub_id: Id.optional(), table_id: Id.optional() }),
    output: FormOut,
    http: { method: "POST", path: "/forms", status: 201 },
    handler: async (ctx, i) => {
      const id = await createFormIn(ctx, i);
      return summary(ctx.db, (await loadOwnForm(ctx.db, ctx.actor.userId, id))!);
    },
  }),

  defineQuery({
    name: "form.form.list",
    summary: "Form của tôi: số phản hồi, phản hồi mới nhất, trạng thái. `trashed=true` xem thùng rác.",
    permission: "form:form:create",
    aiAllowed: true,
    menu: "form",
    list: true,
    input: z.object({ trashed: z.enum(["true", "false"]).optional() }),
    output: FormOut,
    http: { method: "GET", path: "/forms" },
    handler: async (ctx, i) => {
      const trashed = i.trashed === "true";
      const rows = await ctx.db.execute(sql`SELECT f.*, (SELECT count(*)::int FROM form_responses r WHERE r.form_id = f.id) AS responses,
          (SELECT max(r.created_at) FROM form_responses r WHERE r.form_id = f.id) AS last_at, t.name AS table_name, (t.deleted_at IS NULL AND d.deleted_at IS NULL) AS table_alive
        FROM forms f LEFT JOIN dh_tables t ON t.id = f.table_id LEFT JOIN dh_datahubs d ON d.id = t.datahub_id
        WHERE /*scope:system*/ f.owner_id = ${ctx.actor.userId}::uuid AND ${trashed ? sql`f.deleted_at IS NOT NULL` : sql`f.deleted_at IS NULL`} ORDER BY f.created_at DESC, f.id`);
      const items = [];
      for (const r of rows.rows as Raw[]) {
        const last = r.last_at ? new Date(r.last_at as string | Date).toISOString() : null;
        items.push(await summary(ctx.db, formFromDb(r), { responses: r.responses as number, last, tableName: (r.table_name as string | null) ?? null, alive: r.table_alive === null ? true : !!r.table_alive }));
      }
      return { items, nextCursor: null, total: items.length };
    },
  }),

  defineQuery({
    name: "form.form.target_tables",
    summary: "Bảng form của tôi ghi vào được, gom theo datahub của tôi (đã loại bảng Quản lý Deal, bảng gộp, bảng template, bảng đã xoá).",
    permission: "form:form:create",
    aiAllowed: true,
    menu: "form",
    input: z.object({}),
    output: z.array(z.object({ datahub_id: Id, datahub_name: z.string(), tables: z.array(z.object({ id: Id, name: z.string() })) })),
    http: { method: "GET", path: "/forms/target-tables" },
    handler: async (ctx) => {
      const r = await ctx.db.execute(sql`SELECT d.id AS dh_id, d.name AS dh_name, t.id AS t_id, t.name AS t_name FROM dh_datahubs d LEFT JOIN dh_tables t ON t.datahub_id = d.id AND t.deleted_at IS NULL AND t.kind <> 'merged' AND t.template_id IS NULL
        WHERE /*scope:system*/ d.owner_id = ${ctx.actor.userId}::uuid AND d.deleted_at IS NULL AND d.system_key IS NULL ORDER BY d.name, t.position, t.name`);
      const out = new Map<string, { datahub_id: string; datahub_name: string; tables: { id: string; name: string }[] }>();
      for (const x of r.rows as { dh_id: string; dh_name: string; t_id: string | null; t_name: string | null }[]) {
        const e = out.get(x.dh_id) ?? { datahub_id: x.dh_id, datahub_name: x.dh_name, tables: [] };
        if (x.t_id) e.tables.push({ id: x.t_id, name: x.t_name! });
        out.set(x.dh_id, e);
      }
      return [...out.values()];
    },
  }),

  defineQuery({
    name: "form.form.get",
    summary: "Chi tiết form của tôi: thông tin, bản nháp (cấu hình `soe-form/1`), bản đã xuất bản, các câu bị tắt vì cột đã bị xoá.",
    permission: "form:form:create",
    aiAllowed: true,
    menu: "form",
    input: FormId,
    output: FormOut.extend({ draft: z.unknown(), published: z.unknown(), disabled_question_ids: z.array(z.string()), max_columns: z.number().int().nullable() }),
    http: { method: "GET", path: "/forms/:form_id" },
    handler: async (ctx, i) => {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id);
      const cols = await liveColumns(ctx.db, f.tableId);
      const pub = await latestConfig(ctx.db, f);
      return { ...(await summary(ctx.db, f)), draft: f.draft, published: pub, disabled_question_ids: [...disabledIds(f.draft, cols, !!f.tableId)], max_columns: f.tableId ? cols.size : null };
    },
  }),

  defineCommand({
    name: "form.form.update",
    summary: "Đổi tên, cách mở (công khai / mọi tài khoản / chọn người), người được điền, tuỳ chọn (mở/đóng lúc, số phản hồi tối đa, mỗi người một phản hồi, câu khi đóng).",
    description: "Mỗi người một phản hồi chỉ dùng cho form nội bộ. `notify_new_response` được lưu nhưng chưa có tác dụng.",
    ...MANAGE,
    input: z.object({ form_id: Id, name: z.string().trim().min(1).max(200).optional(), access: z.enum(FORM_ACCESS).optional(), audience: AudienceSchema.optional(), options: OptionsSchema.optional(), notify_new_response: z.boolean().optional() }),
    output: FormOut,
    http: { method: "PATCH", path: "/forms/:form_id" },
    handler: async (ctx, i) => {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id);
      const access = i.access ?? f.access;
      const options = i.options ?? f.options;
      const published = await latestConfig(ctx.db, f);
      if (access === "public" && (published?.quiz?.enabled || f.draft.quiz?.enabled)) throw new AppError("validation_error", "Bài kiểm tra chỉ dùng cho form nội bộ. Tắt chế độ Bài kiểm tra trước.", { reason: "quiz_public" });
      if (access === "public" && access !== f.access) {
        for (const [where, cfg] of [["bản nháp", f.draft], ["bản đã xuất bản", published]] as const) {
          const bad = cfg ? internalOnlyIssues(cfg) : [];
          if (bad.length) throw new AppError("validation_error", `Không đổi sang công khai được: ${where} có câu chỉ dùng cho form nội bộ. ${bad[0]!.message}`, { reason: "internal_only_public", issues: bad });
        }
      }
      if (i.options?.graders?.length) {
        const ok = await ctx.db.execute(sql`SELECT id FROM users WHERE /*scope:system*/ kind = 'person' AND status = 'active' AND id = ANY(${`{${i.options.graders.join(",")}}`}::uuid[])`);
        if (ok.rows.length !== new Set(i.options.graders).size) throw new AppError("validation_error", "Người chấm phải là tài khoản đang hoạt động.", { reason: "grader_invalid" });
      }
      if (access === "public" && options.one_per_user) throw new AppError("validation_error", "\"Mỗi người một phản hồi\" chỉ dùng cho form nội bộ.", { reason: "one_per_user_public" });
      if (options.open_at && options.close_at && new Date(options.open_at) >= new Date(options.close_at)) throw new AppError("validation_error", "Giờ đóng phải sau giờ mở.");
      await ctx.db.execute(sql`/*scope:system*/ UPDATE forms SET name = ${i.name ?? f.name}, access = ${access}, audience = ${JSON.stringify(i.audience ?? f.audience)}::jsonb, options = ${JSON.stringify(options)}::jsonb,
        notify_new_response = ${i.notify_new_response ?? f.notifyNewResponse}, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE id = ${f.id}::uuid`);
      touch(ctx, f);
      return summary(ctx.db, (await loadOwnForm(ctx.db, ctx.actor.userId, f.id))!);
    },
  }),

  defineCommand({
    name: "form.form.save_draft",
    summary: "Lưu bản nháp của form (cấu hình `soe-form/1`). Trình soạn gọi sau mỗi thay đổi; người điền không thấy cho tới khi xuất bản.",
    ...MANAGE,
    input: z.object({ form_id: Id, config: FormConfigSchema, version: z.number().int().min(1).optional() }),
    output: z.object({ id: Id, version: z.number().int(), has_unpublished: z.boolean() }),
    http: { method: "PUT", path: "/forms/:form_id/draft" },
    handler: async (ctx, i) => {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id);
      if (i.version !== undefined && i.version !== f.version) throw new AppError("conflict", undefined, { current_version: f.version, sent_version: i.version });
      const ids = flatten(i.config.blocks).map((x) => x.block.id);
      if (new Set(ids).size !== ids.length) throw new AppError("validation_error", "Mã khối trong form bị trùng.", { reason: "duplicate_id" });
      await saveDraft(ctx, f, i.config);
      touch(ctx, f);
      const published = await latestConfig(ctx.db, f);
      return { id: f.id, version: f.version + 1, has_unpublished: !published || stableJson(published) !== stableJson(i.config) };
    },
  }),

  defineCommand({
    name: "form.question.link",
    summary: "Nối một câu hỏi với một cột của bảng đích: chọn cột (`column_id`) hoặc tạo cột mới (`create: true`, tên lấy theo câu hỏi, chép lựa chọn sang cột).",
    description: "Câu lựa chọn nối vào cột có sẵn mà thiếu lựa chọn thì lỗi `option_missing`; gửi lại với `add_options: true` để thêm các lựa chọn vào cột.",
    ...MANAGE,
    emits: [STRUCTURE_EVENT],
    input: z.object({ form_id: Id, question_id: z.string(), column_id: z.string().optional(), create: z.boolean().optional(), name: z.string().trim().min(1).max(DH_NAME_MAX).optional(), add_options: z.boolean().optional() }),
    output: z.object({ question_id: z.string(), column_id: z.string(), column_name: z.string(), created: z.boolean(), options: z.array(z.unknown()).nullable() }),
    http: { method: "POST", path: "/forms/:form_id/questions/:question_id/link" },
    handler: async (ctx, i) => {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id);
      if (!f.tableId) throw new AppError("validation_error", "Form chưa có bảng đích.", { reason: "no_table" });
      const acc = await ownTable(ctx, f.tableId);
      const qs = questionsOf(f.draft);
      const q = qs.find((x) => x.id === i.question_id);
      if (!q) throw new AppError("not_found", "Không tìm thấy câu hỏi trong bản nháp.");
      if (!!i.column_id === !!i.create) throw new AppError("validation_error", "Chọn một: cột có sẵn (`column_id`) hoặc tạo cột mới (`create`).");
      const cols = await liveColumns(ctx.db, f.tableId);
      let key: string;
      let name: string;
      let created = false;
      let options: { id?: string; label: string }[] | null = null;
      if (i.create) {
        const taken = new Set([...cols.values()].map((c) => c.name.toLowerCase()));
        const made = await createColumnFor(ctx, acc, i.name ? { ...q, label: i.name } : q, qs.indexOf(q) + 1, taken);
        key = made.column.key;
        name = made.column.name;
        options = made.link.options ?? null;
        created = true;
      } else {
        const col = cols.get(i.column_id!);
        if (!col) throw new AppError("not_found", "Không tìm thấy cột.");
        if (!fillable(col) || !compatibleTypes(q.input).includes(col.type)) throw new AppError("validation_error", `Cột "${col.name}" không hợp với kiểu câu hỏi này.`, { reason: "type_mismatch" });
        if (qs.some((x) => x.id !== q.id && x.column_id === col.key)) throw new AppError("validation_error", `Cột "${col.name}" đã nối với một câu khác của form này.`, { reason: "column_taken" });
        key = col.key;
        name = col.name;
        if (isSelect(q.input)) {
          const have = new Map(col.options.map((o) => [o.name.toLowerCase(), o.id]));
          const missing = (q.options ?? []).filter((o) => !have.has(o.label.toLowerCase()));
          if (missing.length && !i.add_options) throw new AppError("validation_error", `Thêm ${missing.length} lựa chọn vào cột "${col.name}"?`, { reason: "option_missing", missing: missing.map((o) => o.label) });
          if (missing.length) {
            const schema = await TableSchema.load(ctx.db, acc);
            const dc = schema.tryResolve(col.key)!;
            const cur = (dc.config.options ?? []) as { id: string; name: string }[];
            await updateColumn(ctx, acc, dc, { config: { ...dc.config, options: [...cur, ...missing.map((o) => ({ name: o.label }))] } });
          }
          const fresh = await liveColumns(ctx.db, f.tableId);
          options = (q.options ?? []).map((o) => ({ id: fresh.get(key)!.options.find((c) => c.name.toLowerCase() === o.label.toLowerCase())?.id, label: o.label }));
        }
      }
      let next = patchQuestion(f.draft, q.id, { column_id: key, ...(options ? { options: options as { id?: string; label: string }[] } : {}) });
      if (options) next = remapOptionRefs(next, q.id, q.options ?? [], options as { id?: string; label: string }[]);
      await saveDraft(ctx, f, next);
      touch(ctx, f);
      return { question_id: q.id, column_id: key, column_name: name, created, options };
    },
  }),

  defineCommand({
    name: "form.question.create_columns",
    summary: "Tạo cột mới cho mọi câu chưa nối cột (hoặc cho `question_ids`), tên theo từng câu hỏi (\"Tạo cột mới cho 3 câu\").",
    ...MANAGE,
    emits: [STRUCTURE_EVENT],
    input: z.object({ form_id: Id, question_ids: z.array(z.string()).max(500).optional() }),
    output: z.object({ created: z.array(z.object({ question_id: z.string(), column_id: z.string(), column_name: z.string() })) }),
    http: { method: "POST", path: "/forms/:form_id/create-columns" },
    handler: async (ctx, i) => {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id);
      if (!f.tableId) throw new AppError("validation_error", "Form chưa có bảng đích.", { reason: "no_table" });
      const { cfg, created } = await createColumnsFor(ctx, f.tableId, f.draft, i.question_ids);
      if (created.length) await saveDraft(ctx, f, cfg);
      touch(ctx, f);
      return { created };
    },
  }),

  defineQuery({
    name: "form.question.link_options",
    summary: "Cột của bảng đích một câu hỏi nối được: chưa nối với câu khác của form này và có kiểu hợp.",
    permission: "form:form:create",
    aiAllowed: true,
    menu: "form",
    input: z.object({ form_id: Id, question_id: z.string() }),
    output: z.array(z.object({ column_id: z.string(), name: z.string(), type: z.string(), required: z.boolean() })),
    http: { method: "GET", path: "/forms/:form_id/questions/:question_id/link-options" },
    handler: async (ctx, i) => {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id);
      const q = questionsOf(f.draft).find((x) => x.id === i.question_id);
      if (!q) throw new AppError("not_found", "Không tìm thấy câu hỏi trong bản nháp.");
      const used = new Set(questionsOf(f.draft).filter((x) => x.id !== q.id && x.column_id).map((x) => x.column_id));
      return [...(await liveColumns(ctx.db, f.tableId)).values()]
        .filter((c) => fillable(c) && compatibleTypes(q.input).includes(c.type) && !used.has(c.key) && c.name.toLowerCase() !== VERSION_COLUMN_NAME.toLowerCase())
        .map((c) => ({ column_id: c.key, name: c.name, type: c.type, required: c.required }));
    },
  }),

  defineCommand({
    name: "form.form.publish",
    summary: "Xuất bản bản nháp: kiểm rồi lưu thành phiên bản mới. Lỗi trả danh sách `issues` có cấu trúc (câu chưa nối cột, cột bắt buộc thiếu, điều kiện sai).",
    description: "Lần xuất bản đầu đưa form từ Nháp sang Đang nhận. Xuất bản lại không tạo cột mới.",
    ...MANAGE,
    emits: [STRUCTURE_EVENT],
    input: FormId,
    output: z.object({ id: Id, published_version: z.number().int(), status: z.enum(FORM_STATUSES) }),
    http: { method: "POST", path: "/forms/:form_id/publish" },
    handler: async (ctx, i) => publishForm(ctx, i.form_id),
  }),

  defineCommand({
    name: "form.form.discard_draft",
    summary: "Bỏ thay đổi chưa xuất bản: bản nháp quay về bản đang chạy.",
    ...MANAGE,
    input: FormId,
    output: z.object({ id: Id, draft: z.unknown() }),
    http: { method: "POST", path: "/forms/:form_id/discard-draft" },
    handler: async (ctx, i) => {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id);
      const cfg = (await latestConfig(ctx.db, f)) ?? emptyConfig(f.name);
      await saveDraft(ctx, f, cfg);
      touch(ctx, f);
      return { id: f.id, draft: cfg };
    },
  }),

  defineCommand({
    name: "form.form.rotate_link",
    summary: "Đổi link của form: link cũ chết ngay.",
    ...MANAGE,
    input: FormId,
    output: z.object({ id: Id, code: z.string(), link_path: z.string() }),
    http: { method: "POST", path: "/forms/:form_id/rotate-link" },
    handler: async (ctx, i) => {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id);
      let code = newCode();
      while ((await ctx.db.execute(sql`/*scope:system*/ SELECT 1 FROM forms WHERE code = ${code}`)).rows.length) code = newCode();
      await ctx.db.execute(sql`/*scope:system*/ UPDATE forms SET code = ${code}, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE id = ${f.id}::uuid`);
      touch(ctx, f);
      return { id: f.id, code, link_path: `/f/${code}` };
    },
  }),

  defineCommand({
    name: "form.form.set_status",
    summary: "Đổi trạng thái: `open` (Đang nhận), `paused` (Tạm dừng), `closed` (Đã đóng). Form chưa xuất bản chưa mở được.",
    ...MANAGE,
    input: z.object({ form_id: Id, status: z.enum(["open", "paused", "closed"]) }),
    output: FormOut,
    http: { method: "POST", path: "/forms/:form_id/status" },
    handler: async (ctx, i) => {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id);
      if (f.publishedVersion === 0) throw new AppError("conflict", "Form chưa xuất bản.", { reason: "not_published" });
      await ctx.db.execute(sql`/*scope:system*/ UPDATE forms SET status = ${i.status}, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE id = ${f.id}::uuid`);
      touch(ctx, f);
      return summary(ctx.db, (await loadOwnForm(ctx.db, ctx.actor.userId, f.id))!);
    },
  }),

  defineCommand({
    name: "form.form.delete",
    summary: "Xoá form (vào thùng rác 7 ngày). Link ngừng nhận phản hồi; bảng đích và phản hồi đã có giữ nguyên.",
    ...MANAGE,
    input: FormId,
    output: z.object({ id: Id, deleted: z.literal(true) }),
    http: { method: "DELETE", path: "/forms/:form_id" },
    handler: async (ctx, i) => {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id);
      await ctx.db.execute(sql`/*scope:system*/ UPDATE forms SET deleted_at = now(), deleted_by = ${ctx.actor.userId}::uuid, version = version + 1, updated_at = now() WHERE id = ${f.id}::uuid`);
      touch(ctx, f);
      return { id: f.id, deleted: true as const };
    },
  }),

  defineCommand({
    name: "form.form.restore",
    summary: "Khôi phục form từ thùng rác.",
    ...MANAGE,
    input: FormId,
    output: FormOut,
    http: { method: "POST", path: "/forms/:form_id/restore" },
    handler: async (ctx, i) => {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, i.form_id, { trashed: true });
      await ctx.db.execute(sql`/*scope:system*/ UPDATE forms SET deleted_at = NULL, deleted_by = NULL, version = version + 1, updated_at = now() WHERE id = ${f.id}::uuid`);
      touch(ctx, f);
      return summary(ctx.db, (await loadOwnForm(ctx.db, ctx.actor.userId, f.id))!);
    },
  }),
];

export { loadFormRow };
