import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import type { Actor } from "@soe/shared";
import type { Container } from "../bootstrap";
import { buildForms, ensureSamplePlan, FORM_SPECS, ONJOB_QUESTIONS, runner, samplePlan } from "../modules/onboarding/sample";

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
const PLAN_NAME = "Lộ trình onboard SoE";
const HUB_NAME = "Onboarding SoE";
const STARTS: Record<string, string> = { us1: "2026-09-07", us2: "2026-11-16" };

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

  const hubForms = async (hubId: string) => rows<{ id: string; name: string; code: string; table_id: string }>(sql`SELECT f.id, f.name, f.code, f.table_id FROM forms f JOIN dh_tables t ON t.id = f.table_id WHERE /*scope:system*/ f.owner_id = ${ld1}::uuid AND t.datahub_id = ${hubId}::uuid AND f.deleted_at IS NULL ORDER BY f.created_at`);
  const hubOf = async (name: string) => (await rows<{ id: string }>(sql`SELECT id FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${ld1}::uuid AND name = ${name} AND deleted_at IS NULL`))[0]?.id;
  const dropForm = async (f: { id: string; table_id: string | null }) => {
    await ld("form.form.delete", { form_id: f.id });
    if (f.table_id) await ld("datahub.table.delete", { table_id: f.table_id }); // a deleted form keeps its table: it goes too
  };
  const dropPlans = async (name: string) => {
    for (const p of await rows<{ id: string; status: string }>(sql`SELECT id, status FROM onb_plans WHERE /*scope:system*/ owner_id = ${ld1}::uuid AND name = ${name}`)) {
      if (p.status === "active") await ld("onboarding.plan.stop", { plan_id: p.id, reason: "Dựng lại dữ liệu onboarding" });
      await ld("onboarding.plan.delete", { plan_id: p.id });
    }
  };

  // 0. reset: the plans, the forms (with tables) of the datahub of this data, and the rows of us1 ----------
  if (reset) {
    // one-off clean-up of the first version of this seed (plans "Lộ trình demo", the quiz form and the rows of us1 inside the system template datahub); not needed after it has run once
    await dropPlans("Lộ trình demo");
    const tplHub = await hubOf("Onboarding mẫu");
    if (tplHub) {
      for (const f of await hubForms(tplHub)) {
        if (f.name === "Q&A" || f.name === "Bài thu hoạch on-job") for (const r of await rows<{ id: string }>(sql`SELECT id FROM dh_rows WHERE /*scope:system*/ table_id = ${f.table_id}::uuid AND created_by = ${us1}::uuid AND deleted_at IS NULL`)) await ld("datahub.row.delete", { table_id: f.table_id, row_id: r.id });
        if (test && f.name === test.title) await dropForm(f);
      }
    }
    await dropPlans(PLAN_NAME);
    const hub0 = await hubOf(HUB_NAME);
    if (hub0) for (const f of await hubForms(hub0)) await dropForm(f);
    await drain(c);
    console.log("Onboarding: đã xoá lộ trình, form và bài nộp của dữ liệu seed.");
  }

  // 1. the system template of the Leader stays as it is -------------------------------------------------
  if (await ensureSamplePlan(db, c.executor, ld1)) console.log("Onboarding: đã dựng lộ trình mẫu của hệ thống cho Leader.");

  // 2. own datahub and forms of the Leader for this data (same declaration as the template) ---------------
  const hub = (await hubOf(HUB_NAME)) ?? ((await ld("datahub.datahub.create", { name: HUB_NAME })).id as string);
  let have = await hubForms(hub);
  if (!have.some((f) => f.name === "Q&A")) {
    const made: string[] = [];
    try {
      await buildForms(runner(c.executor, ld1), hub, FORM_SPECS.filter((s) => s.key !== "test2" || !test), made);
    } catch (e) {
      for (const f of await hubForms(hub)) await dropForm(f).catch(() => undefined); // never leave half-built forms behind
      throw e;
    }
    console.log("Onboarding: đã dựng bộ form của lộ trình.");
  }
  have = await hubForms(hub);
  const formOf = (name: string) => have.find((f) => f.name === name);
  const onjob = formOf("Bài thu hoạch on-job");

  // 3. the quiz form --------------------------------------------------------------------------------------
  let quizId: string | null = null;
  let withKey = false;
  if (!test) console.log(`Onboarding: không thấy file bài test (${TEST_FILE}); lộ trình dùng form Bài kiểm tra 2 như khai báo.`);
  else {
    const built = quizConfig(test);
    withKey = built.withKey;
    const exist = formOf(test.title);
    if (exist) quizId = exist.id;
    else {
      const f = await ld("form.form.create", { name: test.title, datahub_id: hub });
      try {
        await ld("form.form.save_draft", { form_id: f.id, config: built.config });
        await ld("form.question.create_columns", { form_id: f.id });
        await ld("form.form.publish", { form_id: f.id });
        await ld("form.form.update", { form_id: f.id, access: "selected", audience: { user_ids: [] } });
      } catch (e) {
        await dropForm({ id: f.id, table_id: f.table_id }).catch(() => undefined); // never leave a half-built form behind
        throw e;
      }
      quizId = f.id;
      have = await hubForms(hub);
      console.log(`Onboarding: đã dựng form bài test (${test.sections.reduce((n, s) => n + s.questions.length, 0)} câu).`);
      if (built.temporary > 0) console.warn(`CẢNH BÁO: file bài test chưa có đáp án đúng (trường k). ${built.temporary} câu đang dùng đáp án TẠM theo bài làm của Dương, cần đáp án thật. Không nộp bài làm của Dương để khỏi ra điểm giả.`);
    }
  }

  // 4. the plans, assigned ---------------------------------------------------------------------------------
  const plans = await rows<{ id: string; staff_id: string | null }>(sql`SELECT id, staff_id FROM onb_plans WHERE /*scope:system*/ owner_id = ${ld1}::uuid AND name = ${PLAN_NAME}`);
  const assigned: Record<string, string> = {};
  for (const key of ["us1", "us2"] as const) {
    const staff = ids[key]!;
    const had = plans.find((p) => p.staff_id === staff);
    if (had) { assigned[key] = had.id; continue; }
    const formIds: Record<string, string> = {};
    for (const spec of FORM_SPECS) { const f = formOf(spec.name); if (f) formIds[spec.key] = f.id; }
    if (quizId) formIds.test2 = quizId;
    const { structure, checkpoints } = samplePlan(formIds);
    const draft = (await ld("onboarding.plan.create", { name: PLAN_NAME, is_template: false, structure, checkpoints })).id as string; // one plan of its own for each person
    const plan = await ld("onboarding.plan.assign", { plan_id: draft, staff_id: staff, start_date: STARTS[key]! });
    assigned[key] = plan.id as string;
    console.log(`Onboarding demo: đã gắn lộ trình cho ${names[key] ?? key} từ ${STARTS[key]}.`);
    if (key === "us1") await submitAnswers(plan.id as string);
  }

  async function submitAnswers(planId: string): Promise<void> {
    const sheets = await readSheets();
    const qna = formOf("Q&A");
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
