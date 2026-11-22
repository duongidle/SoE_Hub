import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, toActorRef, type Actor } from "@soe/shared";
import type { Executor } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { loadTableAccess } from "../datahub/access";
import { applyRowOps } from "../datahub/rows";
import { getRow, listRows } from "../datahub/rows-read";
import { ROW_EVENTS } from "../datahub/shared";
import { TableSchema } from "../datahub/table-schema";
import { notify, NOTIFICATION_TYPES, stableId } from "../notification";
import { questionsOf, type FormConfig, type Quiz } from "./config";
import { isGraded, isManual, RESULT_LABEL, rubricPoints, scoreCells, summarize, totals, round, type ItemScore, type Result } from "./quiz";
import { Id, liveColumns, loadFormRow, ownerCtx, responseCount, stateOf, tableAlive, versionConfig, type FormRow } from "./shared";

type Raw = Record<string, unknown>;
type Ctx = HandlerCtx<Actor>;

/** The people who may grade a quiz: the owner and the ones the owner named (design module7 6.2). */
export const graderIds = (f: FormRow): string[] => [f.ownerId, ...(f.options.graders ?? [])];

interface ScoreRow {
  response_id: string;
  form_id: string;
  form_version: number;
  row_id: string | null;
  user_id: string | null;
  attempt_no: number;
  score: number;
  max_score: number;
  result: Result;
  floor_failed: boolean;
  details: ItemScore[];
  comment: string | null;
  graded_by: string | null;
  graded_at: string | Date | null;
  created_at: string | Date;
}

async function loadScore(db: Executor, responseId: string): Promise<ScoreRow> {
  const r = await db.execute(sql`SELECT * FROM form_scores WHERE response_id = ${responseId}::uuid`);
  if (!r.rows[0]) throw new AppError("not_found", "Không tìm thấy bài làm.");
  return r.rows[0] as unknown as ScoreRow;
}

const iso = (d: string | Date | null) => (d ? new Date(d).toISOString() : null);

async function formOf(db: Executor, id: string): Promise<FormRow> {
  const f = await loadFormRow(db, sql`id = ${id}::uuid`);
  if (!f) throw new AppError("not_found", "Không tìm thấy form.");
  return f;
}

/** Closed means what people meet (the owner closed it, the dates, the response limit): then the right answers may show (design module7 6.3). */
async function isClosed(db: Executor, f: FormRow): Promise<boolean> {
  return stateOf(f, { now: new Date(), responses: await responseCount(db, f.id), tableAlive: f.tableId ? await tableAlive(db, f.tableId) : true }).state === "closed";
}

export interface QuizSubmitView {
  response_id: string;
  attempt: number;
  score: number;
  max: number;
  result: string | null;
  pending: boolean;
  items?: { question_id: string; points: number; max: number; correct: boolean | null; comment: string | null }[];
  correct_answers?: Record<string, unknown>;
  comment?: string | null;
}

/** What the person who took the quiz may see (design module7 6.3: nothing / score and pass-fail / also the right answers once the form is closed). */
export async function quizView(db: Executor, f: FormRow, responseId: string): Promise<QuizSubmitView | null> {
  const sc = await loadScore(db, responseId);
  const cfg = await versionConfig(db, f.id, sc.form_version);
  const quiz = cfg?.quiz;
  if (!cfg || !quiz?.enabled || quiz.show === "none") return null;
  const sum = summarize(quiz, { score: sc.score, max: sc.max_score, pending: sc.result === "pending", floorFailed: sc.floor_failed });
  const out: QuizSubmitView = { response_id: sc.response_id, attempt: sc.attempt_no, score: sum.score, max: sum.max, result: RESULT_LABEL[sc.result], pending: sc.result === "pending" };
  if (quiz.show === "score_answers" && (await isClosed(db, f))) {
    out.items = sc.details.map((i) => ({ question_id: i.question_id, points: round(i.points), max: i.max, correct: i.correct ?? null, comment: i.comment ?? null }));
    out.correct_answers = Object.fromEntries(questionsOf(cfg).filter((q) => isGraded(q) && q.answer !== undefined && q.answer !== null).map((q) => [q.id, q.answer]));
    out.comment = sc.comment;
  }
  return out;
}

/** A response waits for a grader: the owner and the people named are told (design module7 7). */
export async function notifyGraders(ctx: { db: Executor; actor: Actor | null }, f: FormRow, responseId: string, takerId: string): Promise<void> {
  const [u] = (await ctx.db.execute(sql`SELECT full_name FROM users WHERE /*scope:system*/ id = ${takerId}::uuid`)).rows as { full_name: string | null }[];
  await notify.send(ctx.db as never, {
    type: NOTIFICATION_TYPES.formGradePending,
    recipients: graderIds(f),
    actor: ctx.actor ? toActorRef(ctx.actor) : null,
    object: { type: "form", id: f.id },
    sourceEventId: stableId("form.grade.pending", responseId),
    render: () => ({ title: "Bài kiểm tra chờ chấm", body: `${u?.full_name ?? "Một người"} vừa nộp bài "${f.name}" và đang chờ chấm.`, link: `/form/cham-bai?response=${responseId}`, data: { form_id: f.id, response_id: responseId } }),
  });
}

async function nameOf(db: Executor, userId: string): Promise<string | null> {
  const [u] = (await db.execute(sql`SELECT full_name FROM users WHERE /*scope:system*/ id = ${userId}::uuid`)).rows as { full_name: string | null }[];
  return u?.full_name ?? null;
}

async function ownerAccess(ctx: { db: Executor }, f: FormRow) {
  if (!f.tableId) throw new AppError("conflict", "Form này chưa có bảng đích.", { reason: "no_table" });
  const acc = await loadTableAccess(ownerCtx(ctx, f) as never, f.tableId, "owner");
  return { acc, schema: await TableSchema.load(ctx.db, acc) };
}

async function assertGrader(ctx: Ctx, f: FormRow): Promise<void> {
  if (!graderIds(f).includes(ctx.actor.userId)) throw new AppError("forbidden", "Bạn không phải người chấm của form này.", { reason: "not_grader" });
}

const quizOfScore = async (db: Executor, sc: ScoreRow): Promise<{ cfg: FormConfig; quiz: Quiz }> => {
  const cfg = await versionConfig(db, sc.form_id, sc.form_version);
  if (!cfg?.quiz?.enabled) throw new AppError("conflict", "Form này không còn là bài kiểm tra.");
  return { cfg, quiz: cfg.quiz };
};

const CriteriaIn = z.record(z.string().max(60), z.number().min(0).max(100));
const ItemIn = z.object({ question_id: z.string().max(60), points: z.number().min(0).max(1000).optional(), criteria: CriteriaIn.optional(), comment: z.string().max(2000).optional() });
const GradeItemOut = z.object({ question_id: z.string(), label: z.string(), input: z.string(), manual: z.boolean(), graded: z.boolean(), max: z.number(), points: z.number(), answer: z.unknown(), expected: z.unknown(), correct: z.boolean().nullable(), comment: z.string().nullable(), criteria: z.record(z.string(), z.number()).nullable(), rubric: z.array(z.unknown()).nullable() });
const ListItemOut = z.object({ response_id: Id, form_id: Id, form_name: z.string(), user_id: Id.nullable(), user_name: z.string().nullable(), attempt: z.number().int(), result: z.string().nullable(), score: z.number(), max: z.number(), submitted_at: z.string(), graded_at: z.string().nullable() });

export const gradeOperations = [
  defineQuery({
    name: "form.grade.list",
    summary: "Bài kiểm tra cần tôi chấm (form của tôi hoặc form chủ giao cho tôi chấm). Mặc định chỉ bài chờ chấm; `status=all` lấy cả bài đã chấm.",
    permission: "form:response:submit",
    aiAllowed: true,
    menu: "form",
    list: true,
    input: z.object({ form_id: Id.optional(), status: z.enum(["pending", "all"]).default("pending"), limit: z.coerce.number().int().min(1).max(200).default(100) }),
    output: ListItemOut,
    http: { method: "GET", path: "/grading" },
    handler: async (ctx, i) => {
      const me = ctx.actor.userId;
      const r = await ctx.db.execute(sql`SELECT s.response_id, s.form_id, f.name AS form_name, s.user_id, u.full_name AS user_name, s.attempt_no, s.result, s.score, s.max_score, s.floor_failed, s.form_version, s.created_at, s.graded_at
        FROM form_scores s JOIN forms f ON f.id = s.form_id LEFT JOIN users u ON u.id = s.user_id
        WHERE /*scope:system*/ f.deleted_at IS NULL AND (f.owner_id = ${me}::uuid OR f.options->'graders' @> ${JSON.stringify([me])}::jsonb)
          ${i.form_id ? sql`AND s.form_id = ${i.form_id}::uuid` : sql``} ${i.status === "pending" ? sql`AND s.result = 'pending'` : sql``}
        ORDER BY s.created_at, s.response_id LIMIT ${i.limit}`);
      const quizzes = new Map<string, Quiz | undefined>();
      const items = [];
      for (const s of r.rows as Raw[]) {
        const key = `${s.form_id}:${s.form_version}`;
        if (!quizzes.has(key)) quizzes.set(key, (await versionConfig(ctx.db, s.form_id as string, s.form_version as number))?.quiz);
        const quiz = quizzes.get(key);
        const sum = quiz ? summarize(quiz, { score: s.score as number, max: s.max_score as number, pending: s.result === "pending", floorFailed: !!s.floor_failed }) : { score: s.score as number, max: s.max_score as number };
        items.push({
          response_id: s.response_id as string, form_id: s.form_id as string, form_name: s.form_name as string, user_id: (s.user_id as string | null) ?? null, user_name: (s.user_name as string | null) ?? null, attempt: s.attempt_no as number,
          result: RESULT_LABEL[s.result as Result], score: sum.score, max: sum.max, submitted_at: iso(s.created_at as Date)!, graded_at: iso(s.graded_at as Date | null),
        });
      }
      return { items, nextCursor: null, total: items.length };
    },
  }),

  defineQuery({
    name: "form.grade.get",
    summary: "Mở một bài để chấm: từng câu có câu trả lời của người làm, điểm tự động (đã chấm), điểm tối đa, phiếu chấm tiêu chí, đáp án đúng.",
    description: "Chỉ chủ form và người chủ giao chấm. Câu tự luận/tải file (có điểm tối đa) chưa chấm có `graded: false`.",
    permission: "form:response:submit",
    aiAllowed: true,
    menu: "form",
    input: z.object({ response_id: Id }),
    output: z.object({ response_id: Id, form_id: Id, form_name: z.string(), user_id: Id.nullable(), user_name: z.string().nullable(), attempt: z.number().int(), result: z.string().nullable(), score: z.number(), max: z.number(), pending: z.boolean(), comment: z.string().nullable(), items: z.array(GradeItemOut), submitted_at: z.string() }),
    http: { method: "GET", path: "/grading/:response_id" },
    handler: async (ctx, i) => {
      const sc = await loadScore(ctx.db, i.response_id);
      const f = await formOf(ctx.db, sc.form_id);
      await assertGrader(ctx, f);
      const { cfg, quiz } = await quizOfScore(ctx.db, sc);
      const { acc, schema } = await ownerAccess(ctx, f);
      let data: Record<string, unknown> = {};
      if (sc.row_id) {
        try {
          data = (await getRow(ctx.db, acc, schema, sc.row_id, { labels: true })).data;
        } catch (e) {
          if (!(e instanceof AppError && e.code === "not_found")) throw e;
        }
      }
      const byId = new Map(sc.details.map((d) => [d.question_id, d]));
      const items = questionsOf(cfg)
        .filter((q) => byId.has(q.id))
        .map((q) => {
          const d = byId.get(q.id)!;
          return { question_id: q.id, label: q.label, input: q.input, manual: d.manual, graded: d.graded, max: d.max, points: d.points, answer: q.column_id ? (data[q.column_id] ?? null) : null, expected: d.manual ? null : (q.answer ?? null), correct: d.correct ?? null, comment: d.comment ?? null, criteria: d.criteria ?? null, rubric: q.rubric ?? null };
        });
      const sum = summarize(quiz, { score: sc.score, max: sc.max_score, pending: sc.result === "pending", floorFailed: sc.floor_failed });
      const [u] = sc.user_id ? ((await ctx.db.execute(sql`SELECT full_name FROM users WHERE /*scope:system*/ id = ${sc.user_id}::uuid`)).rows as { full_name: string | null }[]) : [];
      return { response_id: sc.response_id, form_id: f.id, form_name: f.name, user_id: sc.user_id, user_name: u?.full_name ?? null, attempt: sc.attempt_no, result: RESULT_LABEL[sc.result], score: sum.score, max: sum.max, pending: sc.result === "pending", comment: sc.comment, items, submitted_at: iso(sc.created_at)! };
    },
  }),

  defineCommand({
    name: "form.grade.submit",
    summary: "Chấm bài: điểm từng câu tự luận/tải file (`points`, hoặc `criteria` theo phiếu chấm) kèm nhận xét. Chấm hết các câu thì có kết quả Đạt/Không đạt và cập nhật dòng ở bảng đích.",
    description: "Chỉ chủ form và người chủ giao chấm. Câu có phiếu chấm thì gửi `criteria` (mã tiêu chí → điểm); điểm = tổng điểm tiêu chí × trọng số, quy về điểm tối đa của câu. Một tiêu chí dưới điểm sàn thì Không đạt dù tổng đủ. Chấm lại được.",
    permission: "form:response:submit",
    aiAllowed: true,
    menu: "form",
    emits: ROW_EVENTS,
    input: z.object({ response_id: Id, items: z.array(ItemIn).min(1).max(200), comment: z.string().max(5000).optional() }),
    output: z.object({ response_id: Id, score: z.number(), max: z.number(), result: z.string().nullable(), pending: z.boolean() }),
    http: { method: "POST", path: "/grading/:response_id", status: 201 },
    handler: async (ctx, i) => {
      const sc = await loadScore(ctx.db, i.response_id);
      const f = await formOf(ctx.db, sc.form_id);
      await assertGrader(ctx, f);
      const { cfg, quiz } = await quizOfScore(ctx.db, sc);
      const qs = new Map(questionsOf(cfg).map((q) => [q.id, q]));
      const items = sc.details.map((d) => ({ ...d }));
      for (const g of i.items) {
        const q = qs.get(g.question_id);
        const item = items.find((d) => d.question_id === g.question_id);
        if (!q || !item || !isManual(q)) throw new AppError("validation_error", `Câu "${g.question_id}" không phải câu chấm tay của bài này.`, { question_id: g.question_id });
        if (q.rubric?.length) {
          if (!g.criteria) throw new AppError("validation_error", `Câu "${q.label}" chấm theo phiếu tiêu chí: gửi \`criteria\`.`, { question_id: g.question_id });
          const ids = new Set(q.rubric.map((c) => c.id));
          for (const k of Object.keys(g.criteria)) if (!ids.has(k)) throw new AppError("validation_error", `Tiêu chí "${k}" không có trong phiếu chấm.`, { question_id: g.question_id });
          const r = rubricPoints(q, g.criteria);
          Object.assign(item, { points: r.points, criteria: g.criteria, floor_failed: r.floor_failed });
        } else {
          if (g.points === undefined) throw new AppError("validation_error", `Câu "${q.label}": gửi \`points\`.`, { question_id: g.question_id });
          if (g.points > item.max) throw new AppError("validation_error", `Điểm câu "${q.label}" tối đa ${item.max}.`, { question_id: g.question_id });
          Object.assign(item, { points: g.points });
        }
        item.graded = true;
        item.comment = g.comment ?? item.comment ?? null;
      }
      const t = totals(items);
      const sum = summarize(quiz, t);
      const now = new Date();
      const done = !t.pending;
      await ctx.db.execute(sql`UPDATE form_scores SET score = ${t.score}, max_score = ${t.max}, result = ${sum.result}, floor_failed = ${t.floorFailed}, details = ${JSON.stringify(items)}::jsonb, comment = ${i.comment ?? sc.comment},
        graded_by = ${done ? ctx.actor.userId : sc.graded_by}::uuid, graded_at = ${done ? now.toISOString() : null}::timestamptz WHERE response_id = ${sc.response_id}::uuid`);
      if (sc.row_id && f.tableId) {
        const { acc, schema } = await ownerAccess(ctx, f);
        const cols = await liveColumns(ctx.db, f.tableId);
        const wctx = { db: ctx.db, actor: ctx.actor, emit: ctx.emit, audit: ctx.audit, requestId: ctx.requestId } as Pick<HandlerCtx, "db" | "actor" | "emit" | "audit" | "requestId">;
        try {
          const row = await getRow(ctx.db, acc, schema, sc.row_id, {});
          await applyRowOps(wctx, acc, schema, [{ op: "update", id: sc.row_id, version: row.version as number, data: scoreCells(cols, { ...sum, graderName: done ? await nameOf(ctx.db, ctx.actor.userId) : null, gradedAt: done ? now : null }) }]);
        } catch (e) {
          if (!(e instanceof AppError && e.code === "not_found")) throw e; // the row was deleted: the score is kept in `form_scores`
        }
      }
      ctx.audit({ type: "form", id: f.id, details: { response_id: sc.response_id, graded: done } });
      if (done && sc.result === "pending" && sc.user_id && quiz.show !== "none") {
        await notify.send(ctx.db as never, {
          type: NOTIFICATION_TYPES.formGraded,
          recipients: [sc.user_id],
          actor: toActorRef(ctx.actor),
          object: { type: "form", id: f.id },
          sourceEventId: stableId("form.graded", sc.response_id),
          render: () => ({ title: "Bài kiểm tra đã chấm xong", body: `Bài "${f.name}" của bạn đã được chấm: ${sum.score}/${sum.max}${sum.result === "pass" ? " (Đạt)" : sum.result === "fail" ? " (Không đạt)" : ""}.`, link: `/form/bai-lam`, data: { form_id: f.id, response_id: sc.response_id } }),
        });
      }
      return { response_id: sc.response_id, score: sum.score, max: sum.max, result: RESULT_LABEL[sum.result], pending: !done };
    },
  }),

  defineQuery({
    name: "form.quiz.mine",
    summary: "Kết quả các lần làm bài kiểm tra của tôi theo mã link: điểm, Đạt/Không đạt/Chờ chấm, và đáp án đúng khi form đã đóng và chủ cho xem.",
    description: "Chỉ hiện những gì thiết lập \"người làm bài thấy\" cho phép; nếu là \"không thấy gì\" thì danh sách rỗng (chỉ có số lần đã làm).",
    permission: "form:response:submit",
    aiAllowed: true,
    menu: "form",
    input: z.object({ code: z.string().min(4).max(40) }),
    output: z.object({ attempts_used: z.number().int(), max_attempts: z.number().int().nullable(), attempts: z.array(z.unknown()) }),
    http: { method: "GET", path: "/fill/:code/mine" },
    handler: async (ctx, i) => {
      const f = await loadFormRow(ctx.db, sql`code = ${i.code}`);
      if (!f) throw new AppError("not_found", "Không tìm thấy form.");
      const rs = (await ctx.db.execute(sql`SELECT s.response_id, s.attempt_no, s.created_at FROM form_scores s WHERE s.form_id = ${f.id}::uuid AND s.user_id = ${ctx.actor.userId}::uuid ORDER BY s.attempt_no`)).rows as { response_id: string; attempt_no: number; created_at: Date }[];
      const cfg = await versionConfig(ctx.db, f.id, f.publishedVersion);
      const attempts = [];
      for (const r of rs) {
        const v = await quizView(ctx.db, f, r.response_id);
        if (v) attempts.push({ ...v, submitted_at: iso(r.created_at) });
      }
      return { attempts_used: rs.length, max_attempts: cfg?.quiz?.enabled ? cfg.quiz.max_attempts : null, attempts };
    },
  }),

  defineQuery({
    name: "form.response.list",
    summary: "Phản hồi của form (dòng của bảng đích, đọc bằng quyền chủ): câu trả lời theo mã câu hỏi; bài kiểm tra có thêm điểm và kết quả. Phân trang.",
    permission: "form:form:create",
    aiAllowed: true,
    menu: "form",
    list: true,
    input: z.object({ form_id: Id, limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(2000).optional(), search: z.string().max(200).optional() }),
    output: z.object({ row_id: Id, created_at: z.string(), created_by: z.string().nullable(), answers: z.record(z.string(), z.unknown()), quiz: z.unknown().nullable() }),
    listExtra: z.object({ questions: z.array(z.object({ question_id: z.string(), label: z.string(), input: z.string() })).describe("Các câu có cột nối, theo thứ tự đọc.") }),
    http: { method: "GET", path: "/forms/:form_id/responses" },
    handler: async (ctx, i) => {
      const f = await formOf(ctx.db, i.form_id);
      if (f.ownerId !== ctx.actor.userId) throw new AppError("not_found", "Không tìm thấy form.");
      const cfg = f.draft;
      const pub = f.publishedVersion ? ((await versionConfig(ctx.db, f.id, f.publishedVersion)) ?? cfg) : cfg;
      const cols = await liveColumns(ctx.db, f.tableId);
      const qs = questionsOf(pub).filter((q) => q.column_id && cols.has(q.column_id));
      if (!f.tableId) return { items: [], nextCursor: null, total: 0, extra: { questions: [] } };
      const { acc, schema } = await ownerAccess(ctx, f);
      const res = await listRows(ctx.db, acc, schema, { limit: i.limit, cursor: i.cursor, search: i.search, labels: true, includeTotal: true, sort: "_created_at:desc", fields: ["_created_at", "_created_by", ...qs.map((q) => q.column_id!)].join(",") });
      const scores = new Map<string, Raw>();
      const ids = res.items.map((r) => r.id as string);
      if (ids.length) for (const s of (await ctx.db.execute(sql`SELECT row_id, score, max_score, result, floor_failed, attempt_no, form_version FROM form_scores WHERE form_id = ${f.id}::uuid AND row_id = ANY(${`{${ids.join(",")}}`}::uuid[])`)).rows as Raw[]) scores.set(s.row_id as string, s);
      const quiz = pub.quiz?.enabled ? pub.quiz : null;
      const items = res.items.map((r) => {
        const s = scores.get(r.id as string);
        const answers = Object.fromEntries(qs.map((q) => [q.id, r.data[q.column_id!] ?? null]));
        const sum = s && quiz ? summarize(quiz, { score: s.score as number, max: s.max_score as number, pending: s.result === "pending", floorFailed: !!s.floor_failed }) : null;
        return { row_id: r.id as string, created_at: new Date(r.created_at as string | Date).toISOString(), created_by: (r.created_by as string | null) ?? null, answers, quiz: s && sum ? { score: sum.score, max: sum.max, result: RESULT_LABEL[s.result as Result], attempt: s.attempt_no } : null };
      });
      return { items, nextCursor: res.nextCursor, total: res.total, extra: { questions: qs.map((q) => ({ question_id: q.id, label: q.label, input: q.input })) } };
    },
  }),
];
