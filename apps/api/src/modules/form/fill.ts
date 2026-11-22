import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, type Actor } from "@soe/shared";
import { files, newId, PUBLIC_FORM_USER_ID, type Executor } from "@soe/db";
import type { Config } from "../../config";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import type { StorageDriver } from "../../storage/types";
import { loadTableAccess } from "../datahub/access";
import { applyRowOps } from "../datahub/rows";
import { ROW_EVENTS } from "../datahub/shared";
import { TableSchema } from "../datahub/table-schema";
import { sanitizeFilename } from "../system/files";
import { isEmptyAnswer, publicConfig, questionsOf, visibleBlocks, flatten, type FormConfig, type Question } from "./config";
import { disabledIds } from "./ops";
import { attemptsOf, gradeAnswers, scoreCells, summarize, type Result } from "./quiz";
import { notifyGraders, quizView, type QuizSubmitView } from "./grade";
import { DAILY_LIMIT_MAX, Id, ownerCtx, VERSION_COLUMN_NAME, liveColumns, loadFormRow, responseCount, stateOf, tableAlive, versionConfig, type FormRow, type LiveColumn } from "./shared";

type Raw = Record<string, unknown>;
type AnyCtx = HandlerCtx<Actor | null>;

/** Spam limits of a public form (design module7 5.3). Mutable so a test can lower the waiting time; production keeps these values. */
export const SPAM = { minFillMs: 3000, ipPerMinute: 10, dailyPerForm: DAILY_LIMIT_MAX, fileMaxBytes: 10 * 1024 * 1024, filesPerQuestion: 5 };
const SLOW_DOWN = "Bạn gửi quá nhanh, thử lại sau ít phút.";
const hits = new Map<string, number[]>();
export const resetSpamState = () => hits.clear();

/** Counts one attempt of an IP in the last minute. False when it is over the limit. */
function ipAllowed(ip: string | null): boolean {
  const key = ip ?? "unknown";
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= 60_000)) hits.delete(k);
  return list.length <= SPAM.ipPerMinute;
}

const sign = (secret: string, code: string, ts: number) => createHmac("sha256", secret).update(`fill:${code}:${ts}`).digest("hex").slice(0, 32);
/** The token the public page gets when it opens the form: the time it opened, signed (the server cannot trust a time the browser sends). */
export const fillToken = (secret: string, code: string, ts = Date.now()) => `${ts}.${sign(secret, code, ts)}`;
function fillAge(secret: string, code: string, token: string): number | null {
  const [t, mac] = token.split(".");
  const ts = Number(t);
  if (!Number.isFinite(ts) || !mac) return null;
  const want = Buffer.from(sign(secret, code, ts));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got) ? Date.now() - ts : null;
}

const spamError = (reason: string, details: Raw = {}) => new AppError("rate_limited", SLOW_DOWN, { reason, ...details });

// ---------------------------------------------------------------------------------------------
// who may fill (design module7 3.1)
// ---------------------------------------------------------------------------------------------

export async function canFill(db: Executor, f: FormRow, userId: string | null): Promise<boolean> {
  if (f.access === "public") return true;
  if (!userId) return false;
  if (userId === f.ownerId) return true;
  const r = await db.execute(sql`SELECT u.kind, u.status, u.roles, u.guest_preset, m.leader_id FROM users u LEFT JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL WHERE /*scope:system*/ u.id = ${userId}::uuid`);
  const u = r.rows[0] as { kind: string; status: string; roles: string[]; guest_preset: string | null; leader_id: string | null } | undefined;
  if (!u || u.kind !== "person" || u.status !== "active") return false;
  const guest = u.roles.includes("guest");
  if (f.access === "all_accounts") return !guest;
  const a = f.audience;
  if (a.user_ids.includes(userId) || (guest && a.guest_ids.includes(userId)) || (guest && !!u.guest_preset && a.guest_presets.includes(u.guest_preset as "sale" | "data"))) return true;
  if (!guest && (a.team_ids.includes(userId) || (u.leader_id && a.team_ids.includes(u.leader_id)) || u.roles.some((x) => (a.roles as string[]).includes(x)))) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// what the person gets
// ---------------------------------------------------------------------------------------------

async function loadByCode(db: Executor, code: string): Promise<FormRow> {
  const f = await loadFormRow(db, sql`code = ${code}`);
  if (!f) throw new AppError("not_found", "Không tìm thấy form.");
  return f;
}

async function currentState(db: Executor, f: FormRow) {
  return stateOf(f, { now: new Date(), responses: await responseCount(db, f.id), tableAlive: f.tableId ? await tableAlive(db, f.tableId) : true });
}

function closedMessage(f: FormRow, st: { state: string; reason?: string }): string {
  if (st.state === "closed") return f.options.closed_message ?? "Form đã đóng.";
  if (st.state === "not_started") return "Form chưa mở.";
  if (st.state === "paused") return st.reason === "table_deleted" ? "Form tạm dừng nhận phản hồi." : "Form đang tạm dừng.";
  return "Form chưa mở.";
}

/** The form as the person fills it: no table id, column key, data hub name or answer (design module7 3.3). */
async function fillView(db: Executor, f: FormRow, cfg: FormConfig, userId: string | null, secret: string) {
  const cols = await liveColumns(db, f.tableId);
  const st = await currentState(db, f);
  const open = st.state === "open";
  return {
    code: f.code,
    name: f.name,
    state: st.state,
    message: open ? null : closedMessage(f, st),
    version: f.publishedVersion,
    config: open ? publicConfig(cfg, disabledIds(cfg, cols, !!f.tableId)) : null,
    fill_token: f.access === "public" ? fillToken(secret, f.code) : null,
    attempt_id: randomUUID(),
    userId,
  };
}

// ---------------------------------------------------------------------------------------------
// submitting (design module7 5.1)
// ---------------------------------------------------------------------------------------------

interface Submit {
  answers: Record<string, unknown>;
  attempt_id: string;
}


/**
 * The one way a response becomes a row. The row is written with the same writer as every other row (`applyRowOps`: types, unique, defaults,
 * history, recalculation, events) as the OWNER of the table, because filling a form gives the person no right on the table; the row's creator
 * is the person filling (or the account "Form công khai") and the channel is `form` (or `api` / `mcp` when a token submitted it).
 */
async function submitResponse(ctx: AnyCtx, f: FormRow, input: Submit, publicMode: boolean): Promise<{ id: string; row_id: string | null; form_version: number; replayed: boolean; thank_you: unknown; quiz: QuizSubmitView | null }> {
  const cfg = await versionConfig(ctx.db, f.id, f.publishedVersion);
  if (!cfg || !f.tableId) throw new AppError("conflict", "Form này không nhận phản hồi.", { reason: "no_table" });
  const thankYou = (cfg.appearance as { thank_you?: unknown }).thank_you ?? null;
  const filler = publicMode ? null : ctx.actor;
  const [seen] = (await ctx.db.execute(sql`SELECT id, row_id, form_version FROM form_responses WHERE form_id = ${f.id}::uuid AND attempt_id = ${input.attempt_id}`)).rows as { id: string; row_id: string | null; form_version: number }[];
  const quiz = cfg.quiz?.enabled ? cfg.quiz : null;
  if (seen) return { id: seen.id, row_id: seen.row_id, form_version: seen.form_version, replayed: true, thank_you: thankYou, quiz: quiz ? await quizView(ctx.db, f, seen.id) : null };
  const st = await currentState(ctx.db, f);
  if (st.state !== "open") throw new AppError("forbidden", closedMessage(f, st), { reason: `form_${st.state}`, closed_message: closedMessage(f, st) });
  let attemptNo = 1;
  if (quiz) {
    // A quiz needs to know who sits it, and it is never taken through a token or a connection (design module7 6.5).
    if (publicMode || f.access === "public" || !filler) throw new AppError("forbidden", "Bài kiểm tra chỉ dành cho người đăng nhập.", { reason: "quiz_internal_only" });
    if (filler.via === "api" || filler.via === "mcp") throw new AppError("forbidden", "Bài kiểm tra chỉ nộp được trên web, không nộp qua token hoặc kết nối AI.", { reason: "quiz_no_ai" });
    const done = await attemptsOf(ctx.db, f.id, filler.userId);
    if (done >= quiz.max_attempts) throw new AppError("conflict", `Bạn đã làm đủ ${quiz.max_attempts} lần.`, { reason: "attempts_exhausted", max_attempts: quiz.max_attempts });
    attemptNo = done + 1;
  }
  if (!quiz && !publicMode && f.options.one_per_user && filler) {
    const r = await ctx.db.execute(sql`SELECT 1 FROM form_responses WHERE form_id = ${f.id}::uuid AND user_id = ${filler.userId}::uuid LIMIT 1`);
    if (r.rows.length) throw new AppError("conflict", "Bạn đã gửi form này rồi.", { reason: "one_per_user" });
  }
  const cols = await liveColumns(ctx.db, f.tableId);
  const disabled = disabledIds(cfg, cols, true);
  const { visible, answers } = visibleBlocks(cfg, input.answers);
  const issues: { question_id: string; message: string }[] = [];
  const data: Record<string, unknown> = {};
  const questions = questionsOf(cfg);
  for (const q of questions) {
    if (disabled.has(q.id) || !q.column_id || !visible.has(q.id)) continue;
    const col = cols.get(q.column_id)!;
    let v = answers[q.id];
    if (isEmptyAnswer(v) && q.default !== undefined && q.default !== null) v = q.default;
    if (isEmptyAnswer(v)) {
      if (q.required || (col.required && !col.hasDefault)) issues.push({ question_id: q.id, message: "Câu này bắt buộc." });
      continue;
    }
    data[col.key] = v;
  }
  if (publicMode) await checkUploads(ctx.db, f, input.attempt_id, questions, data, issues);
  if (issues.length) throw new AppError("validation_error", issues.length === 1 ? issues[0]!.message : `Còn ${issues.length} câu chưa hợp lệ.`, { issues });
  let graded: ReturnType<typeof gradeAnswers> | null = null;
  let sum: { score: number; max: number; result: Result } | null = null;
  if (quiz) {
    graded = gradeAnswers(cfg, new Set([...visible].filter((x) => !disabled.has(x))), answers);
    sum = summarize(quiz, graded);
    Object.assign(data, scoreCells(cols, { ...sum, attempt: attemptNo, gradedAt: graded.pending ? null : new Date() }));
  }
  const verKey = [...cols.values()].find((c: LiveColumn) => c.type === "number" && c.name.toLowerCase() === VERSION_COLUMN_NAME.toLowerCase())?.key;
  if (verKey) data[verKey] = f.publishedVersion;

  const oc = ownerCtx(ctx, f);
  const acc = await loadTableAccess(oc as never, f.tableId, "owner");
  const schema = await TableSchema.load(ctx.db, acc);
  const viaToken = filler && (filler.via === "api" || filler.via === "mcp");
  const actor: Actor = { userId: filler?.userId ?? PUBLIC_FORM_USER_ID, via: viaToken ? filler!.via : "form", connectionId: filler?.connectionId ?? null, automationId: null, sessionId: null, scopes: [], ip: ctx.client?.ip ?? null, userAgent: ctx.client?.userAgent ?? null };
  const wctx = { db: ctx.db, actor, emit: ctx.emit, audit: () => undefined, requestId: ctx.requestId } as Pick<HandlerCtx, "db" | "actor" | "emit" | "audit" | "requestId">;
  let rowId: string | null = null;
  try {
    const [res] = await applyRowOps(wctx, acc, schema, [{ op: "create", data }]);
    rowId = res!.id;
  } catch (e) {
    throw remapError(e, questions, cols);
  }
  const id = newId();
  await ctx.db.execute(sql`INSERT INTO form_responses (id, form_id, form_version, table_id, row_id, user_id, attempt_id, ip) VALUES (${id}::uuid, ${f.id}::uuid, ${f.publishedVersion}::int, ${f.tableId}::uuid, ${rowId}::uuid, ${publicMode ? null : filler!.userId}::uuid, ${input.attempt_id}, ${ctx.client?.ip ?? null})`);
  if (quiz && graded && sum) {
    await ctx.db.execute(sql`INSERT INTO form_scores (response_id, form_id, form_version, row_id, user_id, attempt_no, score, max_score, result, floor_failed, details, graded_at)
      VALUES (${id}::uuid, ${f.id}::uuid, ${f.publishedVersion}::int, ${rowId}::uuid, ${filler!.userId}::uuid, ${attemptNo}::int, ${graded.score}, ${graded.max}, ${sum.result}, ${graded.floorFailed}, ${JSON.stringify(graded.items)}::jsonb, ${graded.pending ? null : new Date().toISOString()}::timestamptz)`);
    if (graded.pending) await notifyGraders(ctx, f, id, filler!.userId);
  }
  if (!publicMode && filler) await ctx.db.execute(sql`DELETE FROM form_drafts WHERE form_id = ${f.id}::uuid AND user_id = ${filler.userId}::uuid`);
  if (f.options.max_responses && (await responseCount(ctx.db, f.id)) >= f.options.max_responses) await ctx.db.execute(sql`UPDATE forms SET status = 'closed', updated_at = now() WHERE id = ${f.id}::uuid AND status = 'open'`);
  ctx.audit({ type: "form", id: f.id, details: { code: f.code, form_version: f.publishedVersion, ...(publicMode ? { public: true, ip: ctx.client?.ip ?? null } : {}) } });
  return { id, row_id: rowId, form_version: f.publishedVersion, replayed: false, thank_you: thankYou, quiz: quiz ? await quizView(ctx.db, f, id) : null };
}

/** Errors of the table writer name a column; the person needs the question (design module7 2.3b: a duplicate shows under the right question). */
function remapError(e: unknown, questions: Question[], cols: Map<string, LiveColumn>): unknown {
  if (!(e instanceof AppError)) return e;
  const qOf = (column: string): Question | undefined => {
    const k = [...cols.values()].find((c) => c.key === column || c.name === column)?.key;
    return questions.find((q) => q.column_id === k);
  };
  const details = (e.details ?? {}) as { reason?: string; column?: string; issues?: { column: string; message: string }[] };
  if (e.code === "conflict" && details.reason === "duplicate_value") {
    const q = details.column ? qOf(details.column) : undefined;
    return new AppError("conflict", q?.unique_message ?? "Câu trả lời này đã được dùng để gửi form.", { reason: "duplicate_value", ...(q ? { question_id: q.id } : {}) });
  }
  if (e.code === "validation_error" && details.issues) {
    const issues = details.issues.map((i) => ({ question_id: qOf(i.column)?.id ?? null, message: i.message }));
    return new AppError("validation_error", issues.length === 1 ? issues[0]!.message : `Còn ${issues.length} câu chưa hợp lệ.`, { issues });
  }
  return e;
}

/** A file in a public form must come from an upload link of THIS fill and THIS question (design module7 5.4). */
async function checkUploads(db: Executor, f: FormRow, attempt: string, questions: Question[], data: Record<string, unknown>, issues: { question_id: string; message: string }[]): Promise<void> {
  for (const q of questions) {
    if (q.input !== "attachment" || !q.column_id) continue;
    const ids = data[q.column_id];
    if (ids === undefined) continue;
    const list = Array.isArray(ids) ? (ids as string[]) : [];
    const max = f.options.files_per_question ?? SPAM.filesPerQuestion;
    if (list.length > max) issues.push({ question_id: q.id, message: `Tối đa ${max} file.` });
    if (list.length === 0) continue;
    const ok = await db.execute(sql`SELECT file_id FROM form_uploads WHERE form_id = ${f.id}::uuid AND attempt_id = ${attempt} AND question_id = ${q.id} AND file_id = ANY(${`{${list.join(",")}}`}::uuid[])`);
    if (ok.rows.length !== new Set(list).size) issues.push({ question_id: q.id, message: "File không hợp lệ cho lượt điền này." });
  }
}

const AnswersIn = z.record(z.string().max(60), z.unknown()).refine((a) => JSON.stringify(a).length <= 500_000, "Câu trả lời quá dài.");
const AttemptId = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);
const SubmitOut = z.object({ id: Id, row_id: Id.nullable(), form_version: z.number().int(), replayed: z.boolean(), thank_you: z.unknown(), quiz: z.unknown().nullable().describe("Bài kiểm tra: điểm và kết quả theo thiết lập \"người làm bài thấy\" (không có thì null).") });

export function fillOperations(cfg: Config, storage: StorageDriver) {
  const secret = cfg.AUTH_SECRET;

  async function internalForm(ctx: AnyCtx & { actor: Actor }, code: string): Promise<FormRow> {
    const f = await loadByCode(ctx.db, code);
    if (!(await canFill(ctx.db, f, ctx.actor.userId))) throw new AppError("forbidden", "Bạn không được điền form này.", { reason: "not_in_audience" });
    return f;
  }

  /** Spam checks of a public submission or upload (design module7 5.3). Every call counts toward the IP limit. */
  async function publicGate(ctx: AnyCtx, f: FormRow, token: string, trap: string | undefined, opts: { fill: boolean }): Promise<void> {
    const ip = ctx.client?.ip ?? null;
    if (!ipAllowed(ip)) throw spamError("ip_rate", { ip, form: f.code });
    if (trap) throw spamError("honeypot", { ip, form: f.code });
    const age = fillAge(secret, f.code, token);
    if (age === null) throw spamError("bad_token", { ip, form: f.code });
    if (opts.fill) {
      if (age < SPAM.minFillMs) throw spamError("too_fast", { ip, form: f.code });
      const daily = Math.min(f.options.daily_limit ?? SPAM.dailyPerForm, SPAM.dailyPerForm);
      const r = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM form_responses WHERE form_id = ${f.id}::uuid AND created_at > now() - interval '1 day'`);
      if ((r.rows[0] as { n: number }).n >= daily) throw spamError("daily_limit", { form: f.code });
    }
  }

  async function publicForm(ctx: AnyCtx, code: string): Promise<FormRow> {
    const f = await loadByCode(ctx.db, code);
    if (f.access !== "public") throw new AppError("not_found", "Không tìm thấy form.");
    return f;
  }

  return [
    defineQuery({
      name: "form.fill.get",
      summary: "Mở form nội bộ để điền (theo mã link): cấu hình đã lọc (không mã bảng, mã cột, đáp án), bản nháp của tôi, đã gửi chưa.",
      description: "Chỉ người được mở form (mọi tài khoản không gồm Guest, hoặc người/team/vai trò/Guest được chọn). Form công khai mở bằng `form.public.get`.",
      permission: "form:response:submit",
      aiAllowed: true,
      menu: "form",
      input: z.object({ code: z.string().min(4).max(40) }),
      output: z.object({ code: z.string(), name: z.string(), state: z.string(), message: z.string().nullable(), version: z.number().int(), config: z.unknown(), fill_token: z.string().nullable(), attempt_id: z.string(), draft: z.unknown(), form_updated: z.boolean(), already_submitted: z.boolean(), quiz: z.unknown().nullable().describe("Bài kiểm tra: `{ max_attempts, attempts_used, show }` (không có thì null).") }),
      http: { method: "GET", path: "/fill/:code" },
      handler: async (ctx, i) => {
        const f = await internalForm(ctx, i.code);
        const pubCfg = await versionConfig(ctx.db, f.id, f.publishedVersion);
        if (!pubCfg) throw new AppError("not_found", "Form chưa xuất bản.");
        const v = await fillView(ctx.db, f, pubCfg, ctx.actor.userId, secret);
        const [d] = (await ctx.db.execute(sql`SELECT answers, form_version FROM form_drafts WHERE form_id = ${f.id}::uuid AND user_id = ${ctx.actor.userId}::uuid`)).rows as { answers: Record<string, unknown>; form_version: number }[];
        let draft: Record<string, unknown> | null = null;
        let updated = false;
        if (d) {
          // The form was published again while the person was filling it: keep the answers of the questions that still exist (design module7 4).
          const live = new Set(questionsOf(pubCfg).map((q) => q.id));
          draft = Object.fromEntries(Object.entries(d.answers).filter(([k]) => live.has(k)));
          updated = d.form_version !== f.publishedVersion;
          if (updated) await ctx.db.execute(sql`UPDATE form_drafts SET answers = ${JSON.stringify(draft)}::jsonb, form_version = ${f.publishedVersion}::int WHERE form_id = ${f.id}::uuid AND user_id = ${ctx.actor.userId}::uuid`);
        }
        const q = pubCfg.quiz?.enabled ? pubCfg.quiz : null;
        const used = q ? await attemptsOf(ctx.db, f.id, ctx.actor.userId) : 0;
        const done = q ? used >= q.max_attempts : f.options.one_per_user ? (await ctx.db.execute(sql`SELECT 1 FROM form_responses WHERE form_id = ${f.id}::uuid AND user_id = ${ctx.actor.userId}::uuid LIMIT 1`)).rows.length > 0 : false;
        ctx.audit({ type: "form", id: f.id });
        const { userId: _u, ...rest } = v;
        return { ...rest, draft, form_updated: updated, already_submitted: done, quiz: q ? { max_attempts: q.max_attempts, attempts_used: used, show: q.show } : null };
      },
    }),

    defineCommand({
      name: "form.response.submit",
      summary: "Gửi một phản hồi của form nội bộ (một dòng ở bảng đích, có lịch sử dòng). Qua token hoặc kết nối có menu Form mức Sửa cũng được.",
      description: "`attempt_id` là mã của lượt điền: gửi hai lần cùng mã chỉ tạo một dòng. Câu bị điều kiện ẩn thì giá trị bị bỏ. Lỗi theo câu trả về `details.issues[].question_id`. Bài kiểm tra không nộp qua AI.",
      permission: "form:response:submit",
      aiAllowed: true,
      menu: "form",
      emits: ROW_EVENTS,
      input: z.object({ code: z.string().min(4).max(40), answers: AnswersIn, attempt_id: AttemptId }),
      output: SubmitOut,
      http: { method: "POST", path: "/fill/:code/submit", status: 201 },
      handler: async (ctx, i) => {
        const f = await internalForm(ctx, i.code);
        return submitResponse(ctx, f, i, false);
      },
    }),

    defineCommand({
      name: "form.draft.save",
      summary: "Lưu bản nháp câu trả lời của tôi (form nội bộ, theo người và form). Không tạo dòng ở bảng đích.",
      permission: "form:response:submit",
      aiAllowed: false,
      input: z.object({ code: z.string().min(4).max(40), answers: AnswersIn }),
      output: z.object({ saved: z.literal(true), form_version: z.number().int() }),
      http: { method: "PUT", path: "/fill/:code/draft" },
      handler: async (ctx, i) => {
        const f = await internalForm(ctx, i.code);
        const pubCfg = await versionConfig(ctx.db, f.id, f.publishedVersion);
        if (!pubCfg) throw new AppError("not_found", "Form chưa xuất bản.");
        const live = new Set(questionsOf(pubCfg).map((q) => q.id));
        const answers = Object.fromEntries(Object.entries(i.answers).filter(([k]) => live.has(k)));
        await ctx.db.execute(sql`INSERT INTO form_drafts (form_id, user_id, answers, form_version) VALUES (${f.id}::uuid, ${ctx.actor.userId}::uuid, ${JSON.stringify(answers)}::jsonb, ${f.publishedVersion}::int)
          ON CONFLICT (form_id, user_id) DO UPDATE SET answers = EXCLUDED.answers, form_version = EXCLUDED.form_version, updated_at = now()`);
        return { saved: true as const, form_version: f.publishedVersion };
      },
    }),

    defineCommand({
      name: "form.draft.delete",
      summary: "Xoá bản nháp câu trả lời của tôi.",
      permission: "form:response:submit",
      aiAllowed: false,
      input: z.object({ code: z.string().min(4).max(40) }),
      output: z.object({ deleted: z.literal(true) }),
      http: { method: "DELETE", path: "/fill/:code/draft" },
      handler: async (ctx, i) => {
        const f = await internalForm(ctx, i.code);
        await ctx.db.execute(sql`DELETE FROM form_drafts WHERE form_id = ${f.id}::uuid AND user_id = ${ctx.actor.userId}::uuid`);
        return { deleted: true as const };
      },
    }),

    // ------------------------------------------------------------------------------- public (no login)
    defineQuery({
      name: "form.public.get",
      summary: "Mở form công khai theo mã link (không cần đăng nhập): cấu hình bản đã xuất bản, đã lọc.",
      description: "Không có mã bảng, mã cột, tên datahub hay đáp án. Trả `fill_token` (ký giờ mở form) và `attempt_id` để gửi kèm khi nộp.",
      permission: null,
      aiAllowed: false,
      input: z.object({ code: z.string().min(4).max(40) }),
      output: z.object({ code: z.string(), name: z.string(), state: z.string(), message: z.string().nullable(), version: z.number().int(), config: z.unknown(), fill_token: z.string().nullable(), attempt_id: z.string() }),
      http: { method: "GET", path: "/public/forms/:code" },
      handler: async (ctx, i) => {
        const f = await publicForm(ctx, i.code);
        const pubCfg = await versionConfig(ctx.db, f.id, f.publishedVersion);
        if (!pubCfg) throw new AppError("not_found", "Không tìm thấy form.");
        const { userId: _u, ...v } = await fillView(ctx.db, f, pubCfg, null, secret);
        return v;
      },
    }),

    defineCommand({
      name: "form.public.submit",
      summary: "Gửi phản hồi của form công khai (không cần đăng nhập). Chống spam: ô bẫy, dưới 3 giây, 10 lần/phút mỗi IP, 1.000 phản hồi/ngày mỗi form.",
      description: "`fill_token` lấy từ `form.public.get`. `website` là ô bẫy: người thật để trống. Vượt ngưỡng trả `rate_limited` \"Bạn gửi quá nhanh, thử lại sau ít phút\".",
      permission: null,
      aiAllowed: false,
      emits: ROW_EVENTS,
      input: z.object({ code: z.string().min(4).max(40), answers: AnswersIn, attempt_id: AttemptId, fill_token: z.string().max(200), website: z.string().max(500).optional() }),
      output: SubmitOut,
      http: { method: "POST", path: "/public/forms/:code/submit", status: 201 },
      handler: async (ctx, i) => {
        const f = await publicForm(ctx, i.code);
        await publicGate(ctx, f, i.fill_token, i.website, { fill: true });
        return submitResponse(ctx, f, i, true);
      },
    }),

    defineCommand({
      name: "form.public.upload_init",
      summary: "Xin link tải file lên cho một câu Đính kèm của form công khai (link có hạn, chỉ cho lượt điền này; 10 MB, 5 file mỗi câu, tính dung lượng của chủ form).",
      permission: null,
      aiAllowed: false,
      input: z.object({ code: z.string().min(4).max(40), fill_token: z.string().max(200), attempt_id: AttemptId, question_id: z.string().max(60), filename: z.string().min(1).max(255), content_type: z.string().min(3).max(150), size_bytes: z.number().int().min(1) }),
      output: z.object({ file_id: Id, upload: z.object({ url: z.string(), method: z.literal("PUT"), headers: z.record(z.string(), z.string()), expires_at: z.string() }) }),
      http: { method: "POST", path: "/public/forms/:code/uploads", status: 201 },
      handler: async (ctx, i) => {
        const f = await publicForm(ctx, i.code);
        await publicGate(ctx, f, i.fill_token, undefined, { fill: false });
        const pubCfg = await versionConfig(ctx.db, f.id, f.publishedVersion);
        const q = pubCfg ? questionsOf(pubCfg).find((x) => x.id === i.question_id && x.input === "attachment") : undefined;
        if (!q) throw new AppError("not_found", "Không có câu hỏi tải file này.");
        const maxBytes = Math.min(f.options.file_max_bytes ?? SPAM.fileMaxBytes, SPAM.fileMaxBytes, cfg.FILE_MAX_BYTES);
        if (i.size_bytes > maxBytes) throw new AppError("payload_too_large", `Mỗi file tối đa ${Math.floor(maxBytes / 1024 / 1024)} MB.`, { max_bytes: maxBytes });
        if (!cfg.allowedFileTypes.includes(i.content_type)) throw new AppError("unsupported_media_type", "Loại file này không được chấp nhận.", { allowed: cfg.allowedFileTypes });
        const per = f.options.files_per_question ?? SPAM.filesPerQuestion;
        const n = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM form_uploads WHERE form_id = ${f.id}::uuid AND attempt_id = ${i.attempt_id} AND question_id = ${q.id}`)).rows[0] as { n: number };
        if (n.n >= Math.min(per, SPAM.filesPerQuestion)) throw new AppError("validation_error", `Mỗi câu tối đa ${per} file.`, { reason: "too_many_files" });
        const used = (await ctx.db.execute(sql`SELECT coalesce(sum(size_bytes), 0)::float8 AS total FROM files WHERE /*scope:system*/ owner_id = ${f.ownerId}::uuid AND deleted_at IS NULL`)).rows[0] as { total: number };
        if (used.total + i.size_bytes > cfg.FILE_USER_QUOTA_BYTES) throw new AppError("quota_exceeded", "Không tải file lên được lúc này.", { reason: "owner_quota" });
        const id = newId();
        const [row] = await ctx.db.insert(files).values({ id, ownerId: f.ownerId, createdBy: PUBLIC_FORM_USER_ID, updatedBy: PUBLIC_FORM_USER_ID, storageKey: `files/${id}`, filename: sanitizeFilename(i.filename), contentType: i.content_type, sizeBytes: i.size_bytes }).returning();
        await ctx.db.execute(sql`INSERT INTO form_uploads (file_id, form_id, attempt_id, question_id) VALUES (${id}::uuid, ${f.id}::uuid, ${i.attempt_id}, ${q.id})`);
        const up = await storage.createUploadUrl({ key: row!.storageKey, contentType: i.content_type, sizeBytes: i.size_bytes, ttlSeconds: Math.min(cfg.UPLOAD_URL_TTL_SECONDS, 900) });
        ctx.audit({ type: "form", id: f.id, details: { code: f.code, upload: true, ip: ctx.client?.ip ?? null } });
        return { file_id: id, upload: { url: up.url, method: up.method, headers: up.headers, expires_at: up.expiresAt.toISOString() } };
      },
    }),

    defineCommand({
      name: "form.public.upload_complete",
      summary: "Xác nhận file đã tải lên xong (form công khai).",
      permission: null,
      aiAllowed: false,
      input: z.object({ code: z.string().min(4).max(40), fill_token: z.string().max(200), attempt_id: AttemptId, file_id: Id }),
      output: z.object({ file_id: Id, ready: z.literal(true) }),
      http: { method: "POST", path: "/public/forms/:code/uploads/:file_id/complete" },
      handler: async (ctx, i) => {
        const f = await publicForm(ctx, i.code);
        await publicGate(ctx, f, i.fill_token, undefined, { fill: false });
        const [u] = (await ctx.db.execute(sql`SELECT f.storage_key, f.size_bytes, f.status FROM form_uploads u JOIN files f ON f.id = u.file_id WHERE /*scope:system*/ u.file_id = ${i.file_id}::uuid AND u.form_id = ${f.id}::uuid AND u.attempt_id = ${i.attempt_id}`)).rows as { storage_key: string; size_bytes: number; status: string }[];
        if (!u) throw new AppError("not_found", "Không tìm thấy file.");
        if (u.status !== "ready") {
          const st = await storage.stat(u.storage_key);
          if (!st || st.sizeBytes !== Number(u.size_bytes)) throw new AppError("validation_error", "Chưa thấy file trên kho lưu trữ hoặc dung lượng không khớp.");
          await ctx.db.execute(sql`UPDATE files SET status = 'ready', version = version + 1, updated_at = now() WHERE /*scope:system*/ id = ${i.file_id}::uuid`);
        }
        return { file_id: i.file_id, ready: true as const };
      },
    }),
  ];
}

export { flatten };
