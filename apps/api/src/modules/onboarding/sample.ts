import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Actor } from "@soe/shared";
import type { Db } from "@soe/db";
import type { Logger } from "pino";
import type { OperationExecutor } from "../../core/executor";

/**
 * The sample plan of every Manager and Leader (design module9 1): a plan marked "Mẫu" with forms of the person's own, built from declarative data
 * (the structure of the sheet "Master plan": 4 stages, 18 weeks, Monday to Saturday; the final group of the sheet "Đánh giá thử việc").
 * Names and texts are written generically, nothing is copied from the files of `examples/` except the four question headers of the on-job report (`ONJOB_QUESTIONS`, a template structure). Safe to run again: a person who has the plan is skipped,
 * and a run that fails half way deletes the forms it made.
 */
export const SAMPLE_KEY = "sample";
const DATAHUB_NAME = "Onboarding mẫu";
const FILLER = "Người điền";
const LEADER_COLS = ["Nhận xét của leader", "Đánh giá"];

type Q = Record<string, unknown>;
const q = (id: string, input: string, label: string, extra: Q = {}): Q => ({ id, type: "question", input, label, ...extra });
const filler = (): Q => q("nguoi", "user", FILLER, { hidden: true, fill_self: true });
const cfg = (title: string, blocks: Q[], quiz?: Q) => ({ schema: "soe-form/1", title, description: "", appearance: {}, blocks, ...(quiz ? { quiz } : {}) });

/** Mockup criteria and their weights (the weights of the sheet "Đánh giá thử việc": 25/25/15/15/10/5/5; threshold 4, each criterion 3). */
export const MOCKUP_CRITERIA: [string, number][] = [["Hiểu nhu cầu khách", 25], ["Cấu trúc trình bày", 25], ["Nội dung sản phẩm", 15], ["Xử lý câu hỏi", 15], ["Giao tiếp", 10], ["Quản lý thời gian", 5], ["Chuẩn bị", 5]];
export const MOCKUP_THRESHOLD = 4;
export const MOCKUP_FLOOR = 3;
/** The four questions of the on-job report: the headers of the sheet "Bài thu hoạch on-job" (file `examples/Lộ trình onboard Dương.xlsx`), kept as they are (CLAUDE.md: defaults come from the sample file). */
export const ONJOB_QUESTIONS = [
  "1. Nội dung chính của buổi meeting này là gì, của khách nào, CO/SoE nào phụ trách chính trong buổi?",
  "2. Các vấn đề khách gặp trong buổi này là gì? Nguyên nhân của từng vấn đề?",
  "3. CO/SoE đã xử lý vấn đề của khách như thế nào, và vì sao chọn cách đó thay vì cách khác?",
  "4. Nếu đặt mình là CO/SoE phụ trách chính trong buổi này thì câu hỏi hoặc tình huống nào bạn chưa trả lời được?",
];
const QUIZ = { enabled: true, scale: "100", pass: { type: "points", value: 80 }, max_attempts: 2, show: "score" };

export interface FormSpec {
  key: string;
  name: string;
  config: ReturnType<typeof cfg>;
  /** Columns only the leader writes (added after the questions). */
  leaderColumns?: boolean;
  /** Columns that tell the person (the filler) when the leader edits them. */
  notify?: boolean;
  publish: boolean;
}
export const FORM_SPECS: FormSpec[] = [
  { key: "qna", name: "Q&A", leaderColumns: true, notify: true, publish: true, config: cfg("Q&A", [filler(), q("ngay", "date", "Ngày"), q("app", "text", "Ứng dụng"), q("cau_hoi", "long_text", "Câu hỏi"), q("tra_loi", "long_text", "Trả lời")]) },
  { key: "onjob", name: "Bài thu hoạch on-job", leaderColumns: true, notify: true, publish: true, config: cfg("Bài thu hoạch on-job", [filler(), q("ngay", "date", "Ngày", { required: true }), ...ONJOB_QUESTIONS.map((label, i) => q(`c${i + 1}`, "long_text", label))]) },
  { key: "daily", name: "Báo cáo ngày", publish: true, config: cfg("Báo cáo ngày", [filler(), q("a", "long_text", "Việc đã làm hôm nay"), q("b", "long_text", "Việc chưa xong và lý do"), q("c", "long_text", "Điều học được"), q("d", "long_text", "Kế hoạch ngày mai")]) },
  {
    key: "mockup", name: "Phiếu chấm mockup", publish: true,
    config: cfg("Phiếu chấm mockup", [
      q("duoc_cham", "user", "Người được chấm", { hidden: true, param: "nguoi_duoc_cham" }), q("buoi", "text", "Buổi", { hidden: true, param: "buoi" }),
      ...MOCKUP_CRITERIA.map(([label], i) => q(`tc${i + 1}`, "scale", label, { scale: { min: 1, max: 5, min_label: "Yếu", max_label: "Rất tốt" }, required: true })),
      q("vai_tro", "single_select", "Vai trò", { options: [{ label: "Người trình bày" }, { label: "Người hỗ trợ" }] }),
      q("manh", "long_text", "Điểm mạnh"), q("cai_thien", "long_text", "Cần cải thiện"), q("tinh", "checkbox", "Tính vào trung bình", { default: true }),
    ]),
  },
  ...[1, 2, 3].map((n): FormSpec => ({ key: `test${n}`, name: `Bài kiểm tra ${n}`, publish: false, config: cfg(`Bài kiểm tra ${n}`, [filler()], QUIZ) })),
];

const WEEKS: { stage: number; name: string }[] = [
  ...["Làm quen sản phẩm", "Hiểu sâu sản phẩm", "Kỹ năng tạo giải pháp", "Mockup lần 1"].map((name) => ({ stage: 0, name })),
  ...["Kỹ năng trình bày", "Mockup lần 2", "Kỹ năng quản lý công việc", "Sản phẩm mới (1)", "Sản phẩm mới (2)", "Đánh giá thử việc"].map((name) => ({ stage: 1, name })),
  ...["Vai trò thực chiến (1)", "Vai trò thực chiến (2)", "Vai trò thực chiến (3) và mockup", "Vai trò dẫn dắt"].map((name) => ({ stage: 2, name })),
  ...["Sản phẩm tiếp theo (1)", "Sản phẩm tiếp theo (2)", "Sản phẩm tiếp theo (3)", "Mockup sản phẩm tiếp theo"].map((name) => ({ stage: 3, name })),
];
const STAGES = ["Tháng 1 - Nền tảng", "Tháng 2 - Mockup và đánh giá thử việc", "Tháng 3 - Học sâu và nhận deal", "Tháng 4 - Học sản phẩm tiếp theo và lên vai"];
const QNA_PER_WEEK = [10, 13, 13, 13, 10, 15, 15, 20];
const ONJOB_PER_WEEK = [2, 3, 3, 4, 3, 3, 4, 7, 4];
type It = { w: number; wd: number; kind: string; name: string; due?: string; form?: string };
const ITEMS: It[] = [
  { w: 1, wd: 2, kind: "session", name: "Session: tổng quan sản phẩm", due: "17:00" }, { w: 1, wd: 4, kind: "session", name: "Session: phương pháp làm việc", due: "17:00" }, { w: 1, wd: 5, kind: "session_cs", name: "Session với CS: làm quen" }, { w: 1, wd: 6, kind: "test", name: "Test sản phẩm cơ bản", due: "12:00", form: "test1" },
  { w: 2, wd: 1, kind: "session", name: "Session: vai trò và quy trình" }, { w: 2, wd: 2, kind: "session_cs", name: "Session với CS: quy trình" }, { w: 2, wd: 4, kind: "session_sale", name: "Session với Sale: nhu cầu khách" }, { w: 2, wd: 6, kind: "test", name: "Test sản phẩm nâng cao", due: "12:00", form: "test2" },
  { w: 3, wd: 1, kind: "session", name: "Session: kỹ năng khai thác nhu cầu" }, { w: 3, wd: 2, kind: "session_sale", name: "Session với Sale: giải pháp" }, { w: 3, wd: 4, kind: "self_study", name: "Tự học và chuẩn bị mockup" },
  { w: 4, wd: 1, kind: "mockup", name: "Mockup: làm việc với khách (lần 1)" }, { w: 4, wd: 2, kind: "session_sale", name: "Session với Sale: sản phẩm" }, { w: 4, wd: 3, kind: "self_study", name: "Tự học và chuẩn bị mockup" },
  { w: 5, wd: 1, kind: "session", name: "Session: kỹ năng trình bày" }, { w: 5, wd: 2, kind: "session_sale", name: "Session với Sale: xử lý phản đối" }, { w: 5, wd: 6, kind: "mockup", name: "Mockup: trình bày sản phẩm" },
  { w: 6, wd: 1, kind: "mockup", name: "Mockup: trình bày với team" }, { w: 6, wd: 5, kind: "review_1_1", name: "Review 1-1" },
  { w: 7, wd: 1, kind: "session", name: "Session: quản lý công việc" }, { w: 8, wd: 1, kind: "session", name: "Session: sản phẩm mới (1)" }, { w: 9, wd: 1, kind: "session", name: "Session: sản phẩm mới (2)" },
  { w: 9, wd: 5, kind: "review_1_1", name: "Review thử việc 1-1" }, { w: 9, wd: 6, kind: "test", name: "Test sản phẩm mới", due: "12:00", form: "test3" },
  { w: 10, wd: 1, kind: "review_1_1", name: "Đánh giá thử việc" },
  { w: 11, wd: 1, kind: "other", name: "Nhận deal thực tế" }, { w: 12, wd: 1, kind: "other", name: "Làm deal thực tế" }, { w: 13, wd: 1, kind: "other", name: "Làm deal thực tế" }, { w: 13, wd: 6, kind: "mockup", name: "Mockup: sản phẩm mới" }, { w: 14, wd: 1, kind: "other", name: "Dẫn dắt deal" },
  { w: 15, wd: 1, kind: "session", name: "Session: sản phẩm tiếp theo (1)" }, { w: 16, wd: 1, kind: "session", name: "Session: sản phẩm tiếp theo (2)" }, { w: 17, wd: 1, kind: "session", name: "Session: sản phẩm tiếp theo (3)" }, { w: 18, wd: 6, kind: "mockup", name: "Mockup: sản phẩm tiếp theo" },
];

/** The structure and checkpoints of the sample plan, with the ids of the person's forms. */
export function samplePlan(f: Record<string, string>) {
  const items = (w: number) => {
    const list: Q[] = ITEMS.filter((i) => i.w === w).map((i) => ({ name: i.name, kind: i.kind, weekday: i.wd, ...(i.due ? { due_time: i.due } : {}), ...(i.form ? { form_id: f[i.form] } : {}) }));
    if (w <= 9) {
      if (w === 1) {
        list.push({ name: "Báo cáo cuối ngày", kind: "other", repeat: "daily_workdays", until_week_no: 9, due_time: "18:00", remind_before_min: 60, form_id: f.daily, share_table: true });
        list.push({ name: "Gửi câu hỏi Q&A trong tuần", kind: "other", repeat: "weekly", weekday: 5, until_week_no: 8, form_id: f.qna, share_table: true, leader_columns: LEADER_COLS });
        list.push({ name: "On-job và bài thu hoạch (buổi 1)", kind: "on_job", repeat: "weekly", weekday: 3, until_week_no: 9, form_id: f.onjob, share_table: true, leader_columns: LEADER_COLS });
        list.push({ name: "On-job và bài thu hoạch (buổi 2)", kind: "on_job", repeat: "weekly", weekday: 5, until_week_no: 9, form_id: f.onjob, share_table: true, leader_columns: LEADER_COLS });
      }
    }
    return list;
  };
  const structure = { stages: STAGES.map((name, si) => ({ name, weeks: WEEKS.map((w, i) => ({ ...w, no: i + 1 })).filter((w) => w.stage === si).map((w) => ({ week_no: w.no, name: `Tuần ${w.no} - ${w.name}`, items: items(w.no) })) })) };
  const person = FILLER;
  const mockupCond = { type: "weighted", form_id: f.mockup, person_field: "Người được chấm", range: "plan", columns: MOCKUP_CRITERIA.map(([field, weight]) => ({ field, weight })), threshold: MOCKUP_THRESHOLD, floor: MOCKUP_FLOOR, filter: { field: "Tính vào trung bình", op: "eq", value: true }, label: "Trung bình trọng số phiếu chấm" };
  const count = (form: string, n: number, range: "week" | "plan", label: string) => ({ type: "metric", form_id: f[form], person_field: person, range, agg: "count", op: "gte", threshold: n, label });
  const best = (form: string, label: string) => ({ type: "metric", form_id: f[form], person_field: person, range: "plan", agg: "max", field: "Điểm", op: "gte", threshold: 80, label });
  const cps: Q[] = [];
  for (let w = 1; w <= 9; w++) {
    const qn = QNA_PER_WEEK[w - 1];
    if (qn) cps.push({ week_no: w, name: `Q&A ${qn} câu`, group: "qna", conditions: [count("qna", qn, "week", `Số câu Q&A trong tuần`)] });
    cps.push({ week_no: w, name: `On-job ${ONJOB_PER_WEEK[w - 1]} buổi`, group: "on_job", conditions: [count("onjob", ONJOB_PER_WEEK[w - 1]!, "week", "Số bài thu hoạch trong tuần")] });
    cps.push({ week_no: w, name: "Báo cáo ngày 5 ngày", group: "daily", conditions: [count("daily", 5, "week", "Số báo cáo ngày trong tuần")] });
  }
  cps.push({ week_no: 1, name: "Test sản phẩm cơ bản đạt 80", group: "test", conditions: [best("test1", "Điểm cao nhất")] });
  cps.push({ week_no: 2, name: "Test sản phẩm nâng cao đạt 80", group: "test", conditions: [best("test2", "Điểm cao nhất")] });
  cps.push({ week_no: 4, name: "Mockup lần 1 đạt", group: "mockup", conditions: [mockupCond] });
  cps.push({ week_no: 5, name: "Mockup done (leader xác nhận)", group: "mockup", conditions: [{ type: "manual", label: "Leader xác nhận mockup" }] });
  cps.push({ week_no: 6, name: "Mockup lần 2 đạt", group: "mockup", conditions: [mockupCond] });
  cps.push({ week_no: 9, name: "Test sản phẩm mới đạt 80", group: "test", conditions: [best("test3", "Điểm cao nhất")] });
  cps.push({ week_no: 9, name: "Review thử việc xong", group: "other", conditions: [{ type: "manual", label: "Leader xác nhận review" }] });
  const fin = (name: string, group: string, c: Q): Q => ({ week_no: null, name, is_final: true, group, conditions: [c] });
  cps.push(fin("Bài kiểm tra 1 đạt", "test", best("test1", "Điểm cao nhất")), fin("Bài kiểm tra 2 đạt", "test", best("test2", "Điểm cao nhất")), fin("Bài kiểm tra 3 đạt", "test", best("test3", "Điểm cao nhất")));
  cps.push(fin("Mockup đạt (trung bình trọng số)", "mockup", mockupCond));
  cps.push(fin("Đủ 32 buổi on-job có bài thu hoạch", "on_job", count("onjob", 32, "plan", "Số bài thu hoạch")));
  cps.push(fin("Đủ 90 câu Q&A", "qna", count("qna", 90, "plan", "Số câu Q&A")));
  return { structure, checkpoints: cps };
}

const actorOf = (userId: string): Actor => ({ userId, via: "web", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: "soe-worker" });

/** Runs a registry command as one person. */
export type Run = <T = unknown>(name: string, input: Record<string, unknown>) => Promise<T>;
export const runner = (executor: OperationExecutor, userId: string): Run => async <T>(name: string, input: Record<string, unknown>): Promise<T> => (await executor.execute(name, input, { actor: actorOf(userId), requestId: randomUUID() })).result as T;

/** Builds the forms of `specs` (with their tables) in the datahub `dhId` of the person who runs `run`; returns spec key -> form id. `made` collects the ids so a caller can delete them when a later step fails. */
export async function buildForms(run: Run, dhId: string, specs: FormSpec[], made: string[] = []): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const spec of specs) {
    const form = await run<{ id: string; table_id: string }>("form.form.create", { name: spec.name, datahub_id: dhId });
    made.push(form.id);
    ids[spec.key] = form.id;
    await run("form.form.save_draft", { form_id: form.id, config: spec.config });
    await run("form.question.create_columns", { form_id: form.id });
    if (spec.leaderColumns) {
      await run("datahub.column.create", { table_id: form.table_id, name: LEADER_COLS[0], type: "long_text" });
      await run("datahub.column.create", { table_id: form.table_id, name: LEADER_COLS[1], type: "single_select", config: { options: [{ name: "Đúng" }, { name: "Cần sửa" }, { name: "Sai" }] } });
    }
    if (spec.notify) for (const c of LEADER_COLS) await run("datahub.column.update", { table_id: form.table_id, column: c, notify_on_change: { people_column: FILLER } });
    if (spec.publish) await run("form.form.publish", { form_id: form.id });
    await run("form.form.update", { form_id: form.id, access: "selected", audience: { user_ids: [] } });
  }
  return ids;
}

/** Builds the sample plan of one person (Manager or Leader of a tree). Returns the plan id, or null when they already have it. */
export async function ensureSamplePlan(db: Db, executor: OperationExecutor, userId: string): Promise<string | null> {
  const have = await db.execute(sql`SELECT 1 FROM onb_plans WHERE /*scope:system*/ owner_id = ${userId}::uuid AND builtin = ${SAMPLE_KEY}`);
  if (have.rows.length) return null;
  const run = runner(executor, userId);
  const made: string[] = [];
  try {
    const hubs = (await db.execute(sql`SELECT id FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${userId}::uuid AND name = ${DATAHUB_NAME} AND deleted_at IS NULL`)).rows as { id: string }[];
    // Built by the system, so it is not counted in the person's datahub limit (`quota_exempt`, like the datahub "Quản lý Deal"); an ordinary datahub otherwise.
    let dhId = hubs[0]?.id;
    if (!dhId) {
      dhId = randomUUID();
      await db.execute(sql`/*scope:system*/ INSERT INTO dh_datahubs (id, owner_id, name, quota_exempt, created_by, updated_by) VALUES (${dhId}::uuid, ${userId}::uuid, ${DATAHUB_NAME}, true, ${userId}::uuid, ${userId}::uuid)`);
    }
    const ids = await buildForms(run, dhId, FORM_SPECS, made);
    const { structure, checkpoints } = samplePlan(ids);
    const plan = await run<{ id: string }>("onboarding.plan.create", { name: "Lộ trình mẫu (18 tuần)", is_template: true, structure, checkpoints });
    await db.execute(sql`/*scope:system*/ UPDATE onb_plans SET builtin = ${SAMPLE_KEY} WHERE id = ${plan.id}::uuid`);
    return plan.id;
  } catch (e) {
    for (const id of made) await run("form.form.delete", { form_id: id }).catch(() => undefined);
    throw e;
  }
}

/** Every active Manager and Leader of a tree without the sample plan gets it. `only` limits it to one person. */
export async function ensureAllSamplePlans(db: Db, executor: OperationExecutor, log?: Logger, only?: string, skip: Set<string> = new Set()): Promise<number> {
  const rows = (await db.execute(sql`SELECT u.id FROM users u JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL
    WHERE /*scope:system*/ u.kind = 'person' AND u.status = 'active' AND (u.roles && ARRAY['manager','leader']::text[]) AND (m.manager_id IS NOT NULL OR 'manager' = ANY(u.roles))
      AND NOT EXISTS (SELECT 1 FROM onb_plans p WHERE p.owner_id = u.id AND p.builtin = ${SAMPLE_KEY}) ${only ? sql`AND u.id = ${only}::uuid` : sql``}`)).rows as { id: string }[];
  let n = 0;
  for (const { id } of rows) {
    if (skip.has(id)) continue;
    try {
      if (await ensureSamplePlan(db, executor, id)) n++;
    } catch (err) {
      skip.add(id); // not tried again until the worker restarts (missing permission, errors): the error is logged once
      log?.warn({ err, user: id }, "onboarding sample plan could not be built");
    }
  }
  return n;
}

export function startSamplePlanLoop(db: Db, executor: OperationExecutor, log: Logger, intervalMs: number): { stop(): Promise<void> } {
  let stopped = false;
  let current: Promise<void> | null = null;
  const skip = new Set<string>();
  const timer = setInterval(() => {
    if (stopped || current) return;
    current = ensureAllSamplePlans(db, executor, log, undefined, skip).then(() => undefined).catch((err) => log.error({ err }, "onboarding sample plans loop error")).finally(() => { current = null; });
  }, intervalMs);
  return { async stop() { stopped = true; clearInterval(timer); await current; } };
}
