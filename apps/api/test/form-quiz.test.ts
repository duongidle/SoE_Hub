import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { fillToken, resetSpamState } from "../src/modules/form";

let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>; // the owner of the forms
let u: ReturnType<typeof as>; // a person who takes the quiz, on the web
beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  await unlimit(t, org.userA2.id);
  a = as(t, org.userA1.id, "web");
  u = as(t, org.userA2.id, "web");
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => resetSpamState());

const q = (id: string, input: string, extra: Record<string, unknown> = {}) => ({ id, type: "question", input, label: `Câu ${id}`, ...extra });
const cfgOf = (blocks: unknown[], quiz: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({ schema: "soe-form/1", title: "Bài", description: "", appearance: {}, ...(quiz ? { quiz: { enabled: true, ...quiz } } : {}), blocks, ...extra });
const attempt = () => randomUUID();

async function newForm(name = `Bài ${randomUUID().slice(0, 6)}`, who = a) {
  const dh = await who("datahub.datahub.create", { name: `DH ${randomUUID().slice(0, 8)}` });
  const f = await who("form.form.create", { name, datahub_id: dh.id });
  return { dh, tableId: f.table_id as string, id: f.id as string, code: f.code as string };
}
async function quizForm(blocks: unknown[], quiz: Record<string, unknown> = {}) {
  const x = await newForm();
  await a("form.form.save_draft", { form_id: x.id, config: cfgOf(blocks, quiz) });
  await a("form.question.create_columns", { form_id: x.id });
  await a("form.form.publish", { form_id: x.id });
  return x;
}
async function cells(tableId: string) {
  await drainOutbox(t);
  const cols = (await a("datahub.table.get", { table_id: tableId })).columns as { key: string; name: string }[];
  const key = (n: string) => cols.find((c) => c.name === n)!.key;
  const items = (await a("datahub.row.list", { table_id: tableId, labels: "true", sort: "_created_at:asc" })).items as { id: string; data: Record<string, unknown> }[];
  return items.map((r) => ({ id: r.id, score: r.data[key("Điểm")], max: r.data[key("Điểm tối đa")], result: r.data[key("Kết quả")], attempt: r.data[key("Lần làm")], grader: r.data[key("Người chấm")], gradedAt: r.data[key("Ngày chấm")] }));
}
const submit = (code: string, answers: Record<string, unknown>, who = u) => who("form.response.submit", { code, answers, attempt_id: attempt() });
const countType = async (who: typeof a, type: string) => (((await who("notification.list", { limit: 100 })).items as { type: string }[]).filter((n) => n.type === type)).length;

const AUTO = [
  q("s", "single_select", { options: [{ label: "Hà Nội" }, { label: "Huế" }], answer: "Hà Nội", points: 2 }),
  q("m", "multi_select", { options: [{ label: "A" }, { label: "B" }, { label: "C" }], answer: ["A", "B"], points: 4, partial: true }),
  q("n", "number", { answer: { min: 10, max: 20 }, points: 2 }),
  q("e", "number", { answer: 5, points: 1 }),
  q("t", "text", { answer: ["Hà Nội", "Thủ đô"], points: 2 }),
  q("d", "text", { answer: "Đà Nẵng", match_accents: true, points: 1 }),
  q("free", "long_text"),
];

describe("quiz: auto grading", () => {
  it("scores every kind of question, scale 100, pass mark, columns written, partial credit", async () => {
    const x = await quizForm(AUTO, { scale: "100", pass: { type: "points", value: 80 }, show: "score" });
    const cols = (await a("datahub.table.get", { table_id: x.tableId })).columns.map((c: { name: string }) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["Điểm", "Điểm tối đa", "Kết quả", "Lần làm", "Người chấm", "Ngày chấm"]));
    const r1 = await submit(x.code, { s: "Hà Nội", m: ["A", "B"], n: 15, e: "5", t: "  HA   noi ", d: "Đà Nẵng", free: "ý kiến" });
    expect(r1.quiz).toMatchObject({ score: 100, max: 100, result: "Đạt", pending: false, attempt: 1 });
    expect((await cells(x.tableId))[0]).toMatchObject({ score: 100, max: 100, result: "Đạt", attempt: 1 });
    // wrong choice 0; one right multi answer is 1/2 of 4 (partial); 21 is outside 10-20; "thu do" matches "Thủ đô" (accents ignored); "Da Nang" is wrong when accents count
    const x2 = await quizForm(AUTO, { scale: "100", pass: { type: "points", value: 80 }, show: "score", max_attempts: 5 });
    const r2 = await submit(x2.code, { s: "Huế", m: ["A"], n: 21, e: 5, t: "thu do", d: "Da Nang" });
    expect(r2.quiz.max).toBe(100);
    expect(r2.quiz.score).toBeCloseTo(((2 + 1 + 2) / 12) * 100, 1);
    expect(r2.quiz.result).toBe("Không đạt");
    // one right and one wrong multi answer gets nothing (right minus wrong)
    const r3 = await submit(x2.code, { s: "Hà Nội", m: ["A", "C"], n: 10, e: 5, t: "Thủ đô", d: "Đà Nẵng" });
    expect(r3.quiz.score).toBeCloseTo(((2 + 0 + 2 + 1 + 2 + 1) / 12) * 100, 1);
    const raw = await quizForm(AUTO, { scale: "raw", pass: { type: "percent", value: 50 }, show: "score" });
    const r4 = await submit(raw.code, { s: "Hà Nội", m: ["A", "B"], n: 15, e: 5, t: "x", d: "x" });
    expect(r4.quiz).toMatchObject({ score: 9, max: 12, result: "Đạt" }); // the question without points is not graded
  });

  it("the person never gets the answers, points or settings in the form they fill", async () => {
    const x = await quizForm(AUTO, { show: "score_answers" });
    const got = await u("form.fill.get", { code: x.code });
    const text = JSON.stringify(got.config);
    for (const bad of ["answer", "points", "rubric", "partial", "match_accents", "quiz", "column_id"]) expect(text).not.toContain(`"${bad}"`);
    expect(got.quiz).toMatchObject({ max_attempts: 1, attempts_used: 0, show: "score_answers" });
  });
});

describe("quiz: attempts", () => {
  it("each attempt is a row with its number; the third is refused when the limit is 2", async () => {
    const x = await quizForm([q("s", "single_select", { options: [{ label: "A" }, { label: "B" }], answer: "A", points: 1 })], { max_attempts: 2, show: "score", pass: { type: "percent", value: 100 } });
    expect((await submit(x.code, { s: "B" })).quiz.result).toBe("Không đạt");
    expect((await submit(x.code, { s: "A" })).quiz.result).toBe("Đạt");
    const err = await fails(submit(x.code, { s: "A" }));
    expect(err.details.reason).toBe("attempts_exhausted");
    expect((await cells(x.tableId)).map((r) => r.attempt)).toEqual([1, 2]);
    expect((await u("form.fill.get", { code: x.code })).already_submitted).toBe(true);
    expect(await u("form.quiz.mine", { code: x.code })).toMatchObject({ attempts_used: 2, max_attempts: 2 });
  });
});

describe("quiz: hand grading", () => {
  const RUBRIC = [
    { id: "c1", label: "Nội dung", min: 1, max: 5, weight: 2, floor: 2 },
    { id: "c2", label: "Trình bày", min: 1, max: 5, weight: 1 },
  ];
  const blocks = () => [q("a", "single_select", { options: [{ label: "A" }, { label: "B" }], answer: "A", points: 4 }), q("essay", "long_text", { points: 6, rubric: RUBRIC })];

  it("waits for a grader, the grader scores by the sheet, a floor beats the total, the row and the notifications follow", async () => {
    const x = await quizForm(blocks(), { pass: { type: "percent", value: 60 }, show: "score" });
    const sub = await submit(x.code, { a: "A", essay: "Bài viết dài" });
    expect(sub.quiz).toMatchObject({ result: "Chờ chấm", pending: true, score: 4, max: 10 });
    expect((await cells(x.tableId))[0]).toMatchObject({ result: "Chờ chấm", score: 4, max: 10 });
    await drainOutbox(t);
    expect(await countType(a, "form.grade.pending")).toBeGreaterThanOrEqual(1);

    expect((await a("form.grade.list", {})).items.map((i: { response_id: string }) => i.response_id)).toEqual([sub.id]);
    expect((await u("form.grade.list", {})).items).toHaveLength(0);
    expect((await fails(u("form.grade.get", { response_id: sub.id }))).details.reason).toBe("not_grader");
    expect((await fails(u("form.grade.submit", { response_id: sub.id, items: [{ question_id: "essay", points: 6 }] }))).details.reason).toBe("not_grader");

    const got = await a("form.grade.get", { response_id: sub.id });
    expect(got.items.find((i: { question_id: string }) => i.question_id === "essay")).toMatchObject({ manual: true, graded: false, max: 6, answer: "Bài viết dài" });
    expect(got.items.find((i: { question_id: string }) => i.question_id === "a")).toMatchObject({ manual: false, points: 4, expected: expect.anything() });
    // an auto question cannot be graded by hand, a criterion must exist
    expect((await fails(a("form.grade.submit", { response_id: sub.id, items: [{ question_id: "a", points: 1 }] }))).code).toBe("validation_error");
    expect((await fails(a("form.grade.submit", { response_id: sub.id, items: [{ question_id: "essay", criteria: { zz: 3 } }] }))).code).toBe("validation_error");

    const before = await countType(u, "form.graded");
    const done = await a("form.grade.submit", { response_id: sub.id, items: [{ question_id: "essay", criteria: { c1: 5, c2: 5 }, comment: "Tốt" }], comment: "Giỏi" });
    expect(done).toMatchObject({ score: 10, max: 10, result: "Đạt", pending: false });
    const row = (await cells(x.tableId))[0]!;
    expect(row).toMatchObject({ score: 10, result: "Đạt", grader: org.userA1.name });
    expect(row.gradedAt).toBeTruthy();
    const hist = await a("datahub.row.history", { table_id: x.tableId, row_id: row.id });
    expect(hist.items.some((h: { actor: { userId: string } }) => h.actor.userId === org.userA1.id)).toBe(true);
    await drainOutbox(t);
    expect(await countType(u, "form.graded")).toBe(before + 1);
    expect((await a("form.grade.list", {})).items).toHaveLength(0);
    expect((await u("form.quiz.mine", { code: x.code })).attempts[0]).toMatchObject({ result: "Đạt", score: 10 });

    // regrade: "Nội dung" 1 is below its floor (2): fail although the total is 6.8/10, above 60%
    const re = await a("form.grade.submit", { response_id: sub.id, items: [{ question_id: "essay", criteria: { c1: 1, c2: 5 } }] });
    expect(re.result).toBe("Không đạt");
    expect(re.score).toBeCloseTo(6.8, 2);
    expect((await cells(x.tableId))[0]).toMatchObject({ result: "Không đạt" });
  });

  it("a person the owner named can grade; nobody is told when 'show nothing'", async () => {
    const x = await quizForm(blocks(), { show: "none" });
    const sub = await submit(x.code, { a: "B", essay: "..." });
    const leader = as(t, org.leaderA.id, "web");
    expect((await fails(leader("form.grade.get", { response_id: sub.id }))).details.reason).toBe("not_grader");
    expect((await fails(a("form.form.update", { form_id: x.id, options: { graders: [randomUUID()] } }))).details.reason).toBe("grader_invalid");
    await a("form.form.update", { form_id: x.id, options: { graders: [org.leaderA.id] } });
    expect((await leader("form.grade.list", {})).items).toHaveLength(1);
    const before = await countType(u, "form.graded");
    await leader("form.grade.submit", { response_id: sub.id, items: [{ question_id: "essay", criteria: { c1: 3, c2: 3 } }] });
    await drainOutbox(t);
    expect(await countType(u, "form.graded")).toBe(before);
  });
});

describe("quiz: versions and visibility", () => {
  it("a new published answer does not change an old score; the right answers show only when the form is closed", async () => {
    const x = await quizForm([q("s", "single_select", { options: [{ label: "A" }, { label: "B" }], answer: "A", points: 1 })], { show: "score_answers", max_attempts: 3 });
    const old = await submit(x.code, { s: "A" });
    expect(old.quiz).toMatchObject({ score: 1, result: null });
    expect(old.quiz.correct_answers).toBeUndefined();
    const draft = (await a("form.form.get", { form_id: x.id })).draft as { blocks: Record<string, unknown>[] };
    draft.blocks[0] = { ...draft.blocks[0], answer: "B" };
    await a("form.form.save_draft", { form_id: x.id, config: draft });
    await a("form.form.publish", { form_id: x.id });
    expect((await submit(x.code, { s: "A" })).quiz.score).toBe(0); // graded by version 2
    expect((await cells(x.tableId)).map((r) => r.score)).toEqual([1, 0]);
    expect((await a("form.grade.get", { response_id: old.id })).score).toBe(1); // the old one kept its version
    expect(JSON.stringify(await u("form.quiz.mine", { code: x.code }))).not.toContain("correct_answers");
    await a("form.form.set_status", { form_id: x.id, status: "closed" });
    const mine = await u("form.quiz.mine", { code: x.code });
    expect(mine.attempts[0].correct_answers).toEqual({ s: "A" }); // the answers of the version it was graded by
    expect(mine.attempts[1].correct_answers).toEqual({ s: "B" });
  });

  it("'show nothing' returns no score to the person", async () => {
    const x = await quizForm([q("s", "text", { answer: ["x"], points: 1 })], { show: "none" });
    expect((await submit(x.code, { s: "x" })).quiz).toBeNull();
    expect(await u("form.quiz.mine", { code: x.code })).toMatchObject({ attempts_used: 1, attempts: [] });
  });
});

describe("quiz: not for AI, not for public", () => {
  it("a token or a connection cannot submit a quiz; a public form cannot be a quiz; bad answers block publish", async () => {
    const x = await quizForm([q("s", "text", { answer: ["x"], points: 1 })], { max_attempts: 3 });
    const { activeToken } = await import("./fixtures");
    const tok = await activeToken(t, org.userA2.id, [], { kind: "personal", menus: { form: "write" } });
    const r = await t.app.inject({ method: "POST", url: `/api/v1/fill/${x.code}/submit`, headers: tok.headers, payload: { answers: { s: "x" }, attempt_id: attempt() } });
    expect(r.statusCode).toBe(403);
    expect(JSON.stringify(r.json())).toContain("quiz_no_ai");
    expect((await cells(x.tableId))).toHaveLength(0);
    expect((await fails(a("form.form.update", { form_id: x.id, access: "public" }))).details.reason).toBe("quiz_public");
    const y = await newForm();
    await a("form.form.save_draft", { form_id: y.id, config: cfgOf([q("s", "text", { answer: ["x"], points: 1 })], null) });
    await a("form.question.create_columns", { form_id: y.id });
    await a("form.form.update", { form_id: y.id, access: "public" });
    const yd = (await a("form.form.get", { form_id: y.id })).draft as Record<string, unknown>;
    await a("form.form.save_draft", { form_id: y.id, config: { ...yd, quiz: { enabled: true } } });
    expect((await fails(a("form.form.publish", { form_id: y.id }))).details.issues.some((i: { code: string }) => i.code === "quiz_public")).toBe(true);
    const z = await newForm();
    await a("form.form.save_draft", { form_id: z.id, config: cfgOf([q("s", "single_select", { options: [{ label: "A" }], answer: "Z", points: 1 })], {}) });
    await a("form.question.create_columns", { form_id: z.id });
    expect((await fails(a("form.form.publish", { form_id: z.id }))).details.issues.some((i: { code: string }) => i.code === "quiz_answer_invalid")).toBe(true);
  });
});

describe("form JSON", () => {
  it("the owner's JSON has the answers and column names, never keys; the filler's and the public JSON have no answers", async () => {
    const x = await quizForm([q("s", "single_select", { options: [{ label: "A" }, { label: "B" }], answer: "A", points: 1 })], { max_attempts: 2 });
    const own = await a("form.form.export", { form_id: x.id });
    expect(own.has_answers).toBe(true);
    const json = own.json as { schema: string; quiz: unknown; blocks: Record<string, unknown>[] };
    expect(json).toMatchObject({ schema: "soe-form/1", quiz: { enabled: true } });
    expect(json.blocks[0]).toMatchObject({ answer: "A", points: 1, column_name: "Câu s" });
    expect(json.blocks[0]).not.toHaveProperty("column_id");
    const other = await u("form.form.export", { code: x.code });
    expect(other.has_answers).toBe(false);
    for (const bad of ["answer", "points", "quiz", "column_id"]) expect(JSON.stringify(other.json)).not.toContain(`"${bad}"`);
    expect((await fails(u("form.form.export", { form_id: x.id }))).code).toBe("not_found");
    // a public form hides the answer fields too
    const p = await newForm();
    await a("form.form.save_draft", { form_id: p.id, config: cfgOf([q("s", "text", { answer: ["secret"], points: 1, rubric: [] })], null) });
    await a("form.question.create_columns", { form_id: p.id });
    await a("form.form.update", { form_id: p.id, access: "public" });
    await a("form.form.publish", { form_id: p.id });
    const pub = await t.c.executor.execute("form.public.get", { code: p.code }, { actor: null, requestId: randomUUID(), client: { via: "web", ip: "10.1.1.1", userAgent: "vitest" } });
    expect(JSON.stringify(pub.result)).not.toContain("secret");
    void fillToken;
  });

  it("a bad JSON gets paths and reasons; import makes a new table or joins columns by name and lists what did not fit", async () => {
    const dh = await a("datahub.datahub.create", { name: `DH ${randomUUID().slice(0, 8)}` });
    const bad = await fails(a("form.form.import", { datahub_id: dh.id, json: { schema: "soe-form/1", blocks: [{ id: "q1", type: "question", input: "bogus" }] } }));
    expect(bad.code).toBe("validation_error");
    expect(bad.details.issues[0].path).toBe("blocks[0]");
    expect((await fails(a("form.form.import", { datahub_id: dh.id, json: { schema: "soe-form/9" } }))).details.issues[0].path).toBe("schema");
    const dup = await fails(a("form.form.import", { datahub_id: dh.id, json: { schema: "soe-form/1", blocks: [q("x", "text"), q("x", "text")] } }));
    expect(dup.details.issues[0].path).toBe("blocks[1].id");
    expect((await fails(a("form.form.import", { json: { schema: "soe-form/1" } }))).code).toBe("validation_error");

    const doc = { schema: "soe-form/1", title: "Nhập", blocks: [q("a", "text", { label: "Họ tên", column_name: "Họ tên" }), q("b", "single_select", { label: "Loại", options: [{ label: "X" }, { label: "Y" }] })] };
    const fresh = await a("form.form.import", { datahub_id: dh.id, json: doc });
    expect(fresh).toMatchObject({ created_columns: 2, unmatched: [] });
    const f = await a("form.form.get", { form_id: fresh.form_id });
    expect(f.status).toBe("draft");
    expect((await a("datahub.table.get", { table_id: f.table_id })).columns.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(["Họ tên", "Loại"]));

    const tb = await a("datahub.table.create", { datahub_id: dh.id, name: "Có sẵn" });
    await a("datahub.column.create", { table_id: tb.id, name: "Họ tên", type: "text" });
    await a("datahub.column.create", { table_id: tb.id, name: "Loại", type: "single_select", config: { options: [{ name: "X" }] } });
    const joined = await a("form.form.import", { table_id: tb.id, json: { ...doc, blocks: [...doc.blocks, q("c", "number", { label: "Tuổi", column_name: "Tuổi" })] } });
    expect(joined.created_columns).toBe(0);
    expect(joined.unmatched.map((m: { question_id: string; reason: string }) => [m.question_id, m.reason])).toEqual([["b", "no_column"], ["c", "no_column"]]);
    const jf = await a("form.form.get", { form_id: joined.form_id });
    const linked = (jf.draft as { blocks: { id: string; column_id: string | null }[] }).blocks;
    expect(linked[0]!.column_id).toBeTruthy();
    expect(linked[1]!.column_id).toBeFalsy();
  });
});

describe("form: clone, responses, transfer, trash", () => {
  it("clones into a new table with the same questions and answers, or into an existing table", async () => {
    const x = await quizForm([q("s", "single_select", { options: [{ label: "A" }, { label: "B" }], answer: "A", points: 1 })], { max_attempts: 2 });
    const c = await a("form.form.clone", { form_id: x.id });
    const cf = await a("form.form.get", { form_id: c.form_id });
    expect(cf).toMatchObject({ status: "draft", published_version: 0, name: expect.stringContaining("(bản sao)") });
    expect(cf.table_id).not.toBe(x.tableId);
    expect(c.created_columns).toBe(1);
    expect(cf.code).not.toBe(x.code);
    expect((cf.draft as { blocks: Record<string, unknown>[]; quiz: unknown }).blocks[0]).toMatchObject({ answer: "A", points: 1 });
    expect((cf.draft as { quiz: unknown }).quiz).toMatchObject({ max_attempts: 2 });
    await a("form.form.publish", { form_id: c.form_id });
    const again = await a("form.form.clone", { form_id: x.id, table_id: x.tableId, name: "Trên bảng cũ" });
    expect(again).toMatchObject({ created_columns: 0, unmatched: [] });
    expect((await a("form.form.get", { form_id: again.form_id })).table_id).toBe(x.tableId);
  });

  it("lists the responses of the form with answers by question and the score of a quiz", async () => {
    const x = await quizForm([q("s", "text", { answer: ["x"], points: 2 }), q("n", "number")], { show: "score" });
    await submit(x.code, { s: "x", n: 7 });
    const res = await a("form.response.list", { form_id: x.id });
    expect(res.data ?? res.items).toHaveLength(1);
    const first = (res.data ?? res.items)[0];
    expect(first.answers).toEqual({ s: "x", n: 7 });
    expect(first.quiz).toMatchObject({ score: 2, max: 2, attempt: 1 });
    expect((await fails(u("form.response.list", { form_id: x.id }))).code).toBeDefined();
  });

  it("an owner change moves the forms with the datahubs; a deleted column switches the question off and tells the owner", async () => {
    const o2 = await seedOrg(t);
    for (const p of [o2.userA1, o2.userA2]) await unlimit(t, p.id);
    const from = as(t, o2.userA1.id, "web");
    const to = as(t, o2.userA2.id, "web");
    const x = await newForm("Chuyển", from);
    await from("form.form.save_draft", { form_id: x.id, config: cfgOf([q("s", "text")], null) });
    await from("form.question.create_columns", { form_id: x.id });
    await from("form.form.publish", { form_id: x.id });
    // the owner deletes the column: the question is off and the owner gets a mandatory notification
    const col = (await from("datahub.table.get", { table_id: x.tableId })).columns.find((c: { name: string }) => c.name === "Câu s");
    await from("datahub.column.delete", { table_id: x.tableId, column: col.key });
    await drainOutbox(t);
    expect(await countType(from, "form.question.off")).toBe(1);
    expect((await from("form.form.get", { form_id: x.id })).disabled_question_ids).toEqual(["s"]);
    await from("datahub.column.restore", { table_id: x.tableId, column: col.key });

    const admin = as(t, o2.admin.id);
    const preview = await admin("data.transfer.preview", { from_user_id: o2.userA1.id, to_user_id: o2.userA2.id });
    expect(preview.groups.find((g: { handler: string }) => g.handler === "forms").items.map((i: { label: string }) => i.label)).toEqual(["Chuyển"]);
    await admin("data.transfer.execute", { from_user_id: o2.userA1.id, to_user_id: o2.userA2.id });
    expect((await to("form.form.list")).items.map((f: { id: string }) => f.id)).toEqual([x.id]);
    const res = await to("form.response.submit", { code: x.code, answers: { s: "sau chuyển" }, attempt_id: attempt() });
    expect(res.row_id).toBeTruthy();
    expect((await to("form.form.get", { form_id: x.id })).response_count).toBe(1);
  });

  it("a table purged from the trash is not blocked by its form: the form pauses and keeps its responses", async () => {
    const x = await quizForm([q("s", "text", { answer: ["x"], points: 1 })], { show: "score" });
    await submit(x.code, { s: "x" });
    const { registerDatahubTrash } = await import("../src/modules/datahub/trash");
    const { purgeTrash } = await import("@soe/db");
    registerDatahubTrash();
    await a("datahub.datahub.delete", { datahub_id: x.dh.id });
    await t.c.db.db.execute(sql`UPDATE dh_datahubs SET deleted_at = ${new Date(Date.now() - 8 * 86400_000)} WHERE /*scope:system*/ id = ${x.dh.id}::uuid`);
    await purgeTrash(t.c.db.db, 7);
    expect((await t.c.db.db.execute(sql`SELECT 1 FROM dh_tables WHERE /*scope:system*/ id = ${x.tableId}::uuid`)).rows).toHaveLength(0);
    const f = await a("form.form.get", { form_id: x.id });
    expect(f).toMatchObject({ state: "paused", state_reason: "table_deleted", response_count: 1 });
    expect((await t.c.executor.execute("form.public.get", { code: x.code }, { actor: null, requestId: randomUUID() }).catch((e) => e)) instanceof Error).toBe(true);
    expect((await fails(submit(x.code, { s: "x" }))).details.reason).toBe("form_paused");
  });
});

describe("form: MCP tools", () => {
  it("form_save creates a form from JSON, form_get reads it back, form_responses lists answers; a bad JSON returns paths", async () => {
    const { activeToken } = await import("./fixtures");
    const tk = await activeToken(t, org.userA1.id, [], { kind: "personal", menus: { form: "full", datahub: "full" } });
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const r = await t.app.inject({ method: "POST", url: "/mcp", headers: { authorization: `Bearer ${tk.token}` }, payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } });
      return r.json().result as { isError?: boolean; structuredContent: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const tools = (await t.app.inject({ method: "POST", url: "/mcp", headers: { authorization: `Bearer ${tk.token}` }, payload: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).json().result.tools as { name: string }[];
    expect(tools.map((x) => x.name)).toEqual(expect.arrayContaining(["form_get", "form_save", "form_responses"]));
    const dh = await a("datahub.datahub.create", { name: `DH ${randomUUID().slice(0, 8)}` });
    const bad = await rpc("form_save", { datahub_id: dh.id, json: { schema: "soe-form/1", blocks: [{ id: "q", type: "question", input: "nope" }] } });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.structuredContent)).toContain("blocks[0]");
    const made = await rpc("form_save", { datahub_id: dh.id, name: "Từ AI", publish: true, json: { schema: "soe-form/1", title: "Từ AI", blocks: [q("a", "text", { label: "Họ tên" })] } });
    expect(made.isError).toBeFalsy();
    const id = made.structuredContent.form_id as string;
    expect(made.structuredContent.published).toMatchObject({ published_version: 1 });
    const got = await rpc("form_get", { form_id: id });
    expect(got.structuredContent.json.blocks[0]).toMatchObject({ column_name: "Họ tên" });
    expect((await rpc("form_get", {})).structuredContent.forms.some((f: { id: string }) => f.id === id)).toBe(true);
    const code = (await a("form.form.get", { form_id: id })).code as string;
    await u("form.response.submit", { code, answers: { a: "Lan" }, attempt_id: attempt() });
    const res = await rpc("form_responses", { form_id: id });
    expect(res.structuredContent).toMatchObject({ columns: ["_id", "created_at", "Họ tên"], total: 1 });
    expect(res.structuredContent.rows[0].slice(2)).toEqual(["Lan"]);
    // saving over it keeps the column of the same name and adds one for a new question
    const again = await rpc("form_save", { form_id: id, json: { schema: "soe-form/1", title: "Từ AI", blocks: [q("a", "text", { label: "Họ tên", column_name: "Họ tên" }), q("b", "number", { label: "Tuổi" })] } });
    expect(again.structuredContent).toMatchObject({ created_columns: 1, unmatched: [] });
  });
});
