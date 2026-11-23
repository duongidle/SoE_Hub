import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import type { Actor } from "@soe/shared";
import type { Container } from "../bootstrap";
import { ensureSamplePlan, FORM_SPECS, ONJOB_QUESTIONS, samplePlan } from "../modules/onboarding/sample";

/**
 * Demo onboarding data for the DEV database (called from demo-seed.ts; every write goes through the registry commands).
 * The Leader key `ld1` owns the plan; `us1` has a plan that started 2026-09-07 with the on-job reports and Q&A of the sheets of
 * `examples/Lộ trình onboard Dương.xlsx` (read at run time, nothing from it is stored in the repository); `us2` has a plan that started
 * 2026-11-16 with no answers. The quiz form comes from a JSON outside the repo (DEMO_TEST_FILE, default ../SoE_hub_demo-test.json).
 * Nothing from the two files is printed: only counts.
 */
const repoParent = new URL("../../../../../", import.meta.url).pathname;
const ONBOARD_FILE = process.env.DEMO_ONBOARD_FILE ?? fileURLToPath(new URL("../../../../examples/Lộ trình onboard Dương.xlsx", import.meta.url));
const TEST_FILE = process.env.DEMO_TEST_FILE ?? `${repoParent}SoE_hub_demo-test.json`;
export const DEMO_PLAN_NAME = "Lộ trình demo";
const STARTS: Record<string, string> = { us1: "2026-09-07", us2: "2026-11-16" };
const OLD_ONJOB_LABELS = ["Hôm nay mình làm được gì", "Khó khăn gặp phải", "Bài học rút ra", "Việc cần làm tiếp"];

type Q = Record<string, unknown>;
const q = (id: string, input: string, label: string, extra: Q = {}): Q => ({ id, type: "question", input, label, ...extra });
const filler = (): Q => q("nguoi", "user", "Người điền", { hidden: true, fill_self: true });
const cut = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const sp = head.lastIndexOf(" ");
  return `${(sp > max / 2 ? head.slice(0, sp) : head).trim()}…`;
};

// ---- the quiz file -------------------------------------------------------------------------------
interface TestQ { t: "s" | "m" | "e"; q: string; o?: string[]; k?: number[] }
interface TestFile { title: string; sections: { name: string; info?: string; desc?: string; questions: TestQ[] }[] }
const optLabel = (o: string): string => cut(o.replace(/^\*/, "").normalize("NFC").trim(), 100);
/** Rubric size of the two essay questions: question 1 = 3 problems (15 points), question 2 = 4 problems (20 points), 5 points each. */
const ESSAY_PROBLEMS = [3, 4];

/** The form config of the quiz. Answers: `k` (indexes of the right options) when the file has it, otherwise the options Dương chose (`*`), as a temporary answer. */
export function quizConfig(t: TestFile): { config: Q; temporary: number; withKey: boolean } {
  let n = 0, essay = 0, temporary = 0, withKey = false;
  const groups = t.sections.map((s, si) => {
    const blocks: Q[] = [];
    if (s.desc) blocks.push({ id: `d${si + 1}`, type: "text", text: s.desc.normalize("NFC") });
    for (const x of s.questions) {
      n++;
      const id = `q${n}`;
      const text = x.q.normalize("NFC").replace(/\s+/g, " ").trim();
      const long = text.length > 500;
      const base: Q = { label: long ? cut(text, 480) : text, ...(long ? { description: text.slice(0, 2000) } : {}) };
      if (x.t === "e") {
        const k = ESSAY_PROBLEMS[essay++] ?? 3;
        blocks.push(q(id, "long_text", base.label as string, { ...base, points: k * 5, hint: "Dán link Google Drive của video thực hiện (mở quyền xem).", rubric: Array.from({ length: k }, (_, i) => ({ id: `${id}r${i + 1}`, label: `Bài toán ${i + 1}`, min: 0, max: 5, weight: 1 })) }));
        continue;
      }
      const raw = x.o ?? [];
      const options = raw.map((o) => ({ label: optLabel(o) })); // a column option name holds 100 characters at most (a form option label 200): longer options are cut for the demo
      const chosen = raw.flatMap((o, i) => (o.startsWith("*") ? [options[i]!.label] : []));
      const right = x.k?.length ? x.k.map((i) => options[i]?.label).filter((v): v is string => !!v) : chosen;
      if (x.k?.length) withKey = true;
      else temporary++;
      blocks.push(q(id, x.t === "s" ? "single_select" : "multi_select", base.label as string, { ...base, options, answer: x.t === "s" ? right[0] : right, points: 1, ...(x.t === "m" ? { partial: true } : {}) }));
    }
    return { id: `g${si + 1}`, type: "group", title: cut(s.name.normalize("NFC"), 300), blocks };
  });
  const config = { schema: "soe-form/1", title: t.title.normalize("NFC"), description: "", appearance: {}, blocks: [filler(), ...groups], quiz: { enabled: true, scale: "100", pass: { type: "points", value: 80 }, max_attempts: 2, show: "score" } };
  return { config, temporary, withKey };
}

// ---- the workbook --------------------------------------------------------------------------------
const cellValue = (c: ExcelJS.Cell): unknown => {
  const v = c.value as unknown;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown };
    if ("result" in o) return o.result;
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if ("text" in o) return o.text;
  }
  return v;
};
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).normalize("NFC").trim());
const isoDate = (v: unknown): string | null => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

interface OnJob { date: string; answers: string[] }
interface Qna { date: string; app: string; question: string; answer: string }
async function readSheets(): Promise<{ onjob: OnJob[]; qna: Qna[] } | null> {
  if (!existsSync(ONBOARD_FILE)) return null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ONBOARD_FILE);
  const a = wb.getWorksheet("Bài thu hoạch on-job");
  const b = wb.getWorksheet("QnA");
  if (!a || !b) throw new Error("File lộ trình thiếu sheet Bài thu hoạch on-job hoặc QnA.");
  const onjob: OnJob[] = [];
  a.eachRow((row, n) => {
    if (n === 1) return;
    const date = isoDate(cellValue(row.getCell(2)));
    if (!date) return;
    const answers = [3, 4, 5, 6].map((i) => str(cellValue(row.getCell(i))));
    if (answers.every((x) => !x)) return;
    onjob.push({ date, answers });
  });
  const qna: Qna[] = [];
  b.eachRow((row, n) => {
    if (n === 1) return;
    const date = isoDate(cellValue(row.getCell(2)));
    const question = str(cellValue(row.getCell(4)));
    if (!date || !question) return;
    qna.push({ date, app: str(cellValue(row.getCell(3))), question, answer: str(cellValue(row.getCell(5))) });
  });
  return { onjob, qna };
}

// ---- main ----------------------------------------------------------------------------------------
interface Args { c: Container; ids: Record<string, string>; names: Record<string, string>; drain: (c: Container) => Promise<void>; reset: boolean }
export async function seedOnboarding({ c, ids, names, drain, reset }: Args): Promise<void> {
  const db = c.db.db;
  const ld1 = ids.ld1, us1 = ids.us1, us2 = ids.us2;
  if (!ld1 || !us1 || !us2) { console.log("Onboarding demo: thiếu tài khoản ld1/us1/us2, bỏ qua."); return; }
  const actorOf = (userId: string): Actor => ({ userId, via: "web", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: "demo-seed" });
  const as = (userId: string) => async (name: string, input: Record<string, unknown> = {}): Promise<any> => // eslint-disable-line @typescript-eslint/no-explicit-any
    (await c.executor.execute(name, input, { actor: actorOf(userId), requestId: randomUUID() })).result;
  const ld = as(ld1);
  const rows = async <T>(query: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(query)).rows as T[];
  const test: TestFile | null = existsSync(TEST_FILE) ? (JSON.parse(readFileSync(TEST_FILE, "utf8")) as TestFile) : null;
  if (test) test.title = test.title.normalize("NFC");

  // 0. reset: the demo plans, the quiz form and the answers of us1 -------------------------------------
  if (reset) {
    for (const p of await rows<{ id: string; status: string }>(sql`SELECT id, status FROM onb_plans WHERE /*scope:system*/ owner_id = ${ld1}::uuid AND name = ${DEMO_PLAN_NAME}`)) {
      if (p.status === "active") await ld("onboarding.plan.stop", { plan_id: p.id, reason: "Dựng lại dữ liệu demo" });
      await ld("onboarding.plan.delete", { plan_id: p.id });
    }
    for (const spec of FORM_SPECS.filter((s) => s.key === "qna" || s.key === "onjob")) {
      const f = (await rows<{ table_id: string }>(sql`SELECT table_id FROM forms WHERE /*scope:system*/ owner_id = ${ld1}::uuid AND name = ${spec.name} AND deleted_at IS NULL ORDER BY created_at LIMIT 1`))[0];
      if (!f) continue;
      for (const r of await rows<{ id: string }>(sql`SELECT id FROM dh_rows WHERE /*scope:system*/ table_id = ${f.table_id}::uuid AND created_by = ${us1}::uuid AND deleted_at IS NULL`)) await ld("datahub.row.delete", { table_id: f.table_id, row_id: r.id });
    }
    if (test) for (const f of await rows<{ id: string; table_id: string | null }>(sql`SELECT id, table_id FROM forms WHERE /*scope:system*/ owner_id = ${ld1}::uuid AND name = ${test.title} AND deleted_at IS NULL`)) {
      await ld("form.form.delete", { form_id: f.id });
      if (f.table_id) await ld("datahub.table.delete", { table_id: f.table_id }); // the form keeps its table when deleted; the demo table goes too
    }
    await drain(c);
    console.log("Onboarding demo: đã xoá lộ trình demo, form bài test demo và bài nộp của nhân sự demo.");
  }

  // 1. the sample plan of the Leader, and its on-job form in the layout of the sheet --------------------
  if (await ensureSamplePlan(db, c.executor, ld1)) console.log("Onboarding demo: đã dựng lộ trình mẫu cho Leader.");
  const formOf = async (name: string) => (await rows<{ id: string; code: string; table_id: string }>(sql`SELECT id, code, table_id FROM forms WHERE /*scope:system*/ owner_id = ${ld1}::uuid AND name = ${name} AND deleted_at IS NULL ORDER BY created_at LIMIT 1`))[0];
  const onjob = await formOf("Bài thu hoạch on-job");
  if (onjob) {
    const got = await ld("form.form.get", { form_id: onjob.id });
    const blocks = (got.draft as { blocks: { id: string; column_id?: string }[] }).blocks;
    if (blocks.some((b) => b.id === "a")) {
      const spec = FORM_SPECS.find((s) => s.key === "onjob")!;
      const next = JSON.parse(JSON.stringify(spec.config)) as { blocks: { id: string; column_id?: string }[] };
      const keep = blocks.find((b) => b.id === "nguoi");
      if (keep?.column_id) next.blocks.find((b) => b.id === "nguoi")!.column_id = keep.column_id;
      await ld("form.form.save_draft", { form_id: onjob.id, config: next });
      await ld("form.question.create_columns", { form_id: onjob.id });
      const cols = (await ld("datahub.table.get", { table_id: onjob.table_id })).columns as { name: string }[];
      for (const col of cols.filter((x) => OLD_ONJOB_LABELS.includes(x.name))) await ld("datahub.column.delete", { table_id: onjob.table_id, column: col.name });
      await ld("form.form.publish", { form_id: onjob.id });
      console.log("Onboarding demo: đã cập nhật form Bài thu hoạch on-job theo sheet.");
    }
  }

  // 2. the quiz form ------------------------------------------------------------------------------------
  let quizId: string | null = null;
  let withKey = false;
  if (!test) console.log(`Onboarding demo: không thấy file bài test (${TEST_FILE}); lộ trình dùng form Bài kiểm tra 2 của mẫu.`);
  else {
    const have = await formOf(test.title);
    const built = quizConfig(test);
    withKey = built.withKey;
    if (have) quizId = have.id;
    else {
      const hub = (await rows<{ id: string }>(sql`SELECT id FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${ld1}::uuid AND name = 'Onboarding mẫu' AND deleted_at IS NULL`))[0];
      if (!hub) throw new Error("Không thấy datahub Onboarding mẫu của Leader.");
      const f = await ld("form.form.create", { name: test.title, datahub_id: hub.id });
      try {
        await ld("form.form.save_draft", { form_id: f.id, config: built.config });
        await ld("form.question.create_columns", { form_id: f.id });
        await ld("form.form.publish", { form_id: f.id });
        await ld("form.form.update", { form_id: f.id, access: "selected", audience: { user_ids: [] } });
      } catch (e) {
        await ld("form.form.delete", { form_id: f.id }).catch(() => undefined); // never leave a half-built form behind
        await ld("datahub.table.delete", { table_id: f.table_id }).catch(() => undefined);
        throw e;
      }
      quizId = f.id;
      console.log(`Onboarding demo: đã dựng form bài test (${test.sections.reduce((n, s) => n + s.questions.length, 0)} câu).`);
      if (built.temporary > 0) console.warn(`CẢNH BÁO: file bài test chưa có đáp án đúng (trường k). ${built.temporary} câu đang dùng đáp án TẠM theo bài làm của Dương, cần đáp án thật. Không nộp bài làm của Dương để khỏi ra điểm giả.`);
    }
  }

  // 3. the demo plan, assigned -----------------------------------------------------------------------------
  const plans = await rows<{ id: string; staff_id: string | null }>(sql`SELECT id, staff_id FROM onb_plans WHERE /*scope:system*/ owner_id = ${ld1}::uuid AND name = ${DEMO_PLAN_NAME}`);
  let template = plans.find((p) => !p.staff_id)?.id;
  const assigned: Record<string, string> = {};
  for (const key of ["us1", "us2"] as const) {
    const staff = ids[key]!;
    const have = plans.find((p) => p.staff_id === staff);
    if (have) { assigned[key] = have.id; continue; }
    if (!template) {
      const formIds: Record<string, string> = {};
      for (const spec of FORM_SPECS) { const f = await formOf(spec.name); if (f) formIds[spec.key] = f.id; }
      if (quizId) formIds.test2 = quizId;
      const { structure, checkpoints } = samplePlan(formIds);
      template = (await ld("onboarding.plan.create", { name: DEMO_PLAN_NAME, is_template: true, structure, checkpoints })).id as string;
    }
    const plan = await ld("onboarding.plan.assign", { plan_id: template, staff_id: staff, start_date: STARTS[key]! });
    assigned[key] = plan.id as string;
    console.log(`Onboarding demo: đã gắn lộ trình cho ${names[key] ?? key} từ ${STARTS[key]}.`);
    if (key === "us1") await submitAnswers(plan.id as string);
  }

  async function submitAnswers(planId: string): Promise<void> {
    const sheets = await readSheets();
    const qna = await formOf("Q&A");
    if (!sheets || !qna || !onjob) { console.log("Onboarding demo: không có file lộ trình hoặc form, không nạp bài nộp."); return; }
    const me = as(us1!);
    const put = async (code: string, answers: Record<string, unknown>, date: string): Promise<void> => {
      const r = await me("form.response.submit", { code, answers, attempt_id: randomUUID() });
      // Demo only: the checkpoints of a week count rows by their creation day, so the row is dated as in the sheet (17:00 Vietnam time).
      const at = `${date}T17:00:00+07:00`;
      if (r.row_id) await db.execute(sql`/*scope:system*/ UPDATE dh_rows SET created_at = ${at}::timestamptz WHERE id = ${r.row_id}::uuid`);
      await db.execute(sql`/*scope:system*/ UPDATE form_responses SET created_at = ${at}::timestamptz WHERE id = ${r.id}::uuid`);
    };
    for (const x of sheets.onjob) await put(onjob.code, { ngay: x.date, ...Object.fromEntries(ONJOB_QUESTIONS.map((_, i) => [`c${i + 1}`, x.answers[i]]).filter(([, v]) => v)) }, x.date);
    for (const x of sheets.qna) await put(qna.code, { ngay: x.date, ...(x.app ? { app: x.app } : {}), cau_hoi: x.question, ...(x.answer ? { tra_loi: x.answer } : {}) }, x.date);
    if (quizId && withKey && test) {
      const code = (await rows<{ code: string }>(sql`SELECT code FROM forms WHERE /*scope:system*/ id = ${quizId}::uuid`))[0]!.code;
      const answers: Record<string, unknown> = {};
      let n = 0;
      for (const s of test.sections) for (const x of s.questions) {
        n++;
        if (x.t === "e" || !x.o) continue;
        const chosen = x.o.filter((o) => o.startsWith("*")).map(optLabel);
        if (chosen.length) answers[`q${n}`] = x.t === "s" ? chosen[0] : chosen;
      }
      await me("form.response.submit", { code, answers, attempt_id: randomUUID() });
    }
    await drain(c);
    console.log(`Onboarding demo: đã nạp ${sheets.onjob.length} bài on-job và ${sheets.qna.length} câu Q&A của nhân sự demo.`);
    // check table: week -> number of rows by the sheet and the status of the two weekly checkpoints (counts only)
    const start = STARTS.us1!;
    const wk = (d: string): number => Math.floor((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 604800000) + 1;
    const count = (list: { date: string }[]): Map<number, number> => { const m = new Map<number, number>(); for (const x of list) m.set(wk(x.date), (m.get(wk(x.date)) ?? 0) + 1); return m; };
    const oj = count(sheets.onjob), qn = count(sheets.qna);
    const prog = await ld("onboarding.progress.get", { plan_id: planId });
    const cps = prog.checkpoints as { week_no: number | null; name: string; group: string | null; status: string }[];
    console.log("Kiểm checkpoint tuần của nhân sự demo (tuần: số on-job, số Q&A | checkpoint on-job, Q&A):");
    for (let w = 1; w <= 9; w++) {
      const find = (g: string) => cps.find((x) => x.week_no === w && x.group === g);
      console.log(`  tuần ${w}: on-job ${oj.get(w) ?? 0}, Q&A ${qn.get(w) ?? 0} | ${find("on_job")?.name ?? "-"}: ${find("on_job")?.status ?? "-"} | ${find("qna")?.name ?? "-"}: ${find("qna")?.status ?? "-"}`);
    }
    for (const f of cps.filter((x) => x.week_no === null && (x.group === "on_job" || x.group === "qna"))) console.log(`  chốt cuối: ${f.name}: ${f.status}`);
  }
}
