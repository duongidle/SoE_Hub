/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessDate } from "@soe/shared";
import { orgMemberships, users } from "@soe/db";
import { actorOf, as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { activeToken, seedOrg, type Org } from "./fixtures";
import { resetMetricCache } from "../src/modules/metrics/runner";
import { makeApp, type TestApp } from "./helpers";

/**
 * Stage 9A: onboarding plans (design module9 1, 2, 4, 8, 10). Invented data only. Tree A: MgrA > LeaderA > UserA1; UserA2 is under MgrA directly.
 */
let t: TestApp;
let org: Org;
let leader: ReturnType<typeof as>;
let leader2: ReturnType<typeof as>;
let leader2Id: string;
let staff: ReturnType<typeof as>;
const START = "2026-11-23"; // a Monday

const q = (id: string, input: string, label: string, extra: Record<string, unknown> = {}) => ({ id, type: "question", input, label, ...extra });
const col = async (tableId: string, name: string) => ((await leader("datahub.table.get", { table_id: tableId })).columns as { key: string; name: string }[]).find((c) => c.name === name)!.key;

/** A form of the leader: hidden "Người điền", one answer, and a column only the leader writes. Selected people only. */
async function leaderForm() {
  const dh = await leader("datahub.datahub.create", { name: `DH ${randomUUID().slice(0, 8)}` });
  const f = await leader("form.form.create", { name: `Báo cáo ${randomUUID().slice(0, 6)}`, datahub_id: dh.id });
  const blocks = [q("nguoi", "user", "Người điền", { hidden: true, fill_self: true }), q("tl", "long_text", "Câu trả lời")];
  await leader("form.form.save_draft", { form_id: f.id, config: { schema: "soe-form/1", title: "Báo cáo", description: "", appearance: {}, blocks } });
  await leader("form.question.create_columns", { form_id: f.id });
  await leader("datahub.column.create", { table_id: f.table_id, name: "Nhận xét của leader", type: "long_text" });
  await leader("form.form.publish", { form_id: f.id });
  await leader("form.form.update", { form_id: f.id, access: "selected", audience: { user_ids: [] } });
  return { id: f.id as string, code: f.code as string, tableId: f.table_id as string };
}
const structure = (formId?: string) => ({
  stages: [{ name: "Tháng 1", weeks: [
    { name: "W1 - Làm quen", items: [
      { name: "Session 1", weekday: 2, kind: "session", due_time: "10:00" },
      { name: "Báo cáo cuối ngày", repeat: "daily_workdays", until_week_no: 2, due_time: "18:00", remind_before_min: 60, ...(formId ? { form_id: formId, share_table: true, leader_columns: ["Nhận xét của leader"] } : {}) },
    ] },
    { name: "W2 - Thực hành", items: [{ name: "Review 1-1", weekday: 5, kind: "review_1_1" }] },
  ] }],
});
const occurrences = (plan: any) => plan.stages.flatMap((s: any) => s.weeks.flatMap((w: any) => w.items.flatMap((i: any) => i.occurrences.map((o: any) => ({ item: i.name, ...o })))));

let form: Awaited<ReturnType<typeof leaderForm>>;
let planId: string;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.leaderA, org.mgrA, org.userA1]) await unlimit(t, p.id);
  leader = as(t, org.leaderA.id, "web");
  staff = as(t, org.userA1.id, "web");
  const db = t.c.db.db;
  const [u] = await db.insert(users).values({ email: `leader2.${org.tag}@base.vn`, fullName: `Leader2 ${org.tag}`, roles: ["leader"], status: "active", passwordHash: "x" }).returning({ id: users.id });
  leader2Id = u!.id;
  await db.insert(orgMemberships).values({ userId: leader2Id, managerId: org.mgrA.id, leaderId: null });
  await unlimit(t, leader2Id);
  leader2 = as(t, leader2Id, "web");
  form = await leaderForm();
});
afterAll(async () => {
  await t.close();
});

describe("onboarding 9A", () => {
  it("creates a plan and assigns it: real dates of every item, daily items on working days", async () => {
    const p = await leader("onboarding.plan.create", { name: "Lộ trình thử", structure: structure(form.id) });
    planId = p.id;
    expect((await fails(leader("onboarding.plan.assign", { plan_id: planId, staff_id: org.userA1.id, start_date: "2026-11-24" }))).details.reason).toBe("start_not_monday");
    expect((await fails(leader("onboarding.plan.assign", { plan_id: planId, staff_id: org.userA2.id, start_date: START }))).details.reason).toBe("not_plan_editor");
    await leader("onboarding.plan.assign", { plan_id: planId, staff_id: org.userA1.id, start_date: START, followers: [leader2Id] });
    const plan = await leader("onboarding.plan.get", { plan_id: planId });
    const occ = occurrences(plan);
    expect(plan.status).toBe("active");
    expect(occ.filter((o: any) => o.item === "Session 1").map((o: any) => o.on_date)).toEqual(["2026-11-24"]);
    expect(occ.filter((o: any) => o.item === "Review 1-1").map((o: any) => o.on_date)).toEqual(["2026-12-04"]);
    const daily = occ.filter((o: any) => o.item === "Báo cáo cuối ngày").map((o: any) => o.on_date);
    expect(daily).toHaveLength(12);
    expect(daily[0]).toBe("2026-11-23");
    expect(daily[11]).toBe("2026-12-05");
    expect(daily).not.toContain("2026-11-29"); // Sunday
    expect(occ.find((o: any) => o.on_date === "2026-11-23" && o.item === "Báo cáo cuối ngày").due_at).toBe("2026-11-23T11:00:00.000Z"); // 18:00 Vietnam
    // Ticking belongs to the person on the plan.
    const first = occ.find((o: any) => o.item === "Session 1");
    expect((await fails(leader("onboarding.item.tick", { occurrence_id: first.id }))).code).toBe("not_found");
    expect((await staff("onboarding.item.tick", { occurrence_id: first.id })).done_at).not.toBeNull();
    await drainOutbox(t);
  });

  it("one running plan per person", async () => {
    const other = await leader("onboarding.plan.create", { name: "Lộ trình thứ hai", structure: structure() });
    expect((await fails(leader("onboarding.plan.assign", { plan_id: other.id, staff_id: org.userA1.id, start_date: START }))).details.reason).toBe("staff_has_active_plan");
  });

  it("assigning opens the form to the person; the hidden Filler is written by the server; the person sees only their rows and cannot edit the leader's column", async () => {
    const audience = (await leader("form.form.update", { form_id: form.id })).audience;
    expect(audience.user_ids).toContain(org.userA1.id);
    const r = await staff("form.response.submit", { code: form.code, answers: { nguoi: org.userA2.id, tl: "Hôm nay làm quen" }, attempt_id: randomUUID() });
    expect(r.row_id).toBeTruthy();
    const dhId = (await leader("datahub.table.get", { table_id: form.tableId })).datahub_id;
    await leader("datahub.share.set", { datahub_id: dhId, grantee_id: org.userA2.id, table_id: form.tableId, permission: "view" });
    await leader("datahub.row.create", { table_id: form.tableId, data: { "Người điền": org.userA2.id, "Câu trả lời": "của người khác" } });
    await drainOutbox(t);
    const mine = (await staff("datahub.row.list", { table_id: form.tableId, limit: 50 })).items as { id: string; version: number; data: Record<string, unknown> }[];
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine[0]!.data)).toContain(org.userA1.id);
    expect(JSON.stringify(mine[0]!.data)).not.toContain(org.userA2.id);
    const answer = await col(form.tableId, "Câu trả lời");
    const note = await col(form.tableId, "Nhận xét của leader");
    await staff("datahub.row.update", { table_id: form.tableId, row_id: mine[0]!.id, data: { [answer]: "Sửa lại" }, version: mine[0]!.version });
    expect((await fails(staff("datahub.row.update", { table_id: form.tableId, row_id: mine[0]!.id, data: { [note]: "tự khen" }, version: mine[0]!.version + 1 }))).code).toBe("forbidden");
  });

  it("another Leader of the tree only clones: a plan of someone else loses its forms, a plan of mine brings my forms along", async () => {
    const [stranger] = await Promise.all([as(t, org.leaderB.id, "web")("onboarding.plan.list", { scope: "mine" })]);
    expect(stranger).toEqual([]);
    expect((await fails(as(t, org.leaderB.id, "web")("onboarding.plan.get", { plan_id: planId }))).code).toBe("not_found");
    expect((await fails(leader2("onboarding.plan.save", { plan_id: planId, name: "đổi tên" }))).details.reason).toBe("not_plan_editor");
    const copy = await leader2("onboarding.plan.clone", { plan_id: planId });
    const c = await leader2("onboarding.plan.get", { plan_id: copy.id });
    const items = c.stages.flatMap((s: any) => s.weeks.flatMap((w: any) => w.items));
    expect(items).toHaveLength(3);
    expect(items.every((i: any) => i.form_id === null)).toBe(true);
    expect(items.find((i: any) => i.name === "Báo cáo cuối ngày").need_form).toBe(true);
    expect(c.status).toBe("draft");
    const mineCopy = await leader("onboarding.plan.clone", { plan_id: planId });
    const m = await leader("onboarding.plan.get", { plan_id: mineCopy.id });
    const mf = m.stages.flatMap((s: any) => s.weeks.flatMap((w: any) => w.items)).find((i: any) => i.name === "Báo cáo cuối ngày").form_id;
    expect(mf).toBeTruthy();
    expect(mf).not.toBe(form.id);
  });

  it("stopping drops the table back to Xem for the person", async () => {
    await leader("onboarding.plan.stop", { plan_id: planId, reason: "Thử việc đổi hướng" });
    const sh = await t.c.db.db.execute(sql`/*scope:system*/ SELECT permission FROM dh_shares WHERE table_id = ${form.tableId}::uuid AND grantee_id = ${org.userA1.id}::uuid`);
    expect((sh.rows[0] as { permission: string }).permission).toBe("view");
    expect((await fails(staff("onboarding.item.tick", { occurrence_id: randomUUID() }))).code).toBe("not_found");
    expect((await leader("onboarding.plan.get", { plan_id: planId })).status).toBe("stopped");
  });

  it("AI: the person on a plan is refused, a Leader can build a plan, nobody ticks through AI", async () => {
    const menus = { onboarding: "write" as const };
    const conn = async (userId: string) => {
      const tk = await activeToken(t, userId, [], { menus });
      const actor = { ...actorOf(userId, "mcp"), connectionId: tk.id, connectionKind: "personal" as const, connectionName: "test" };
      return async (name: string, input: Record<string, unknown> = {}) => (await t.c.executor.execute(name, input, { actor, requestId: randomUUID() })).result as any;
    };
    const mine = await conn(org.userA1.id);
    expect((await fails(mine("onboarding.plan.list", { scope: "mine" }))).code).toBe("forbidden");
    const lead = await conn(org.leaderA.id);
    const made = await lead("onboarding.plan.create", { name: "Do AI dựng", structure: structure() });
    expect(made.name).toBe("Do AI dựng");
    expect((await fails(lead("onboarding.item.tick", { occurrence_id: randomUUID() }))).code).toBe("ai_not_allowed");
    expect(t.c.registry.get("onboarding.item.tick")!.ai).toMatchObject({ forbidden: "hard" });
  });
});

/** Stage 9B: checkpoints computed by the metrics engine, manual confirmation, the final verdict. Weeks are real: the plan starts on the Monday of the current week. */
describe("onboarding 9B", () => {
  const mondayThisWeek = (): string => {
    const d = businessDate(new Date());
    const w = new Date(`${d}T00:00:00Z`).getUTCDay();
    const m = new Date(`${d}T00:00:00Z`);
    m.setUTCDate(m.getUTCDate() - ((w + 6) % 7));
    return m.toISOString().slice(0, 10);
  };
  /** A fresh running plan for UserA1 with the given structure and checkpoints (an earlier running plan is closed first). */
  async function runPlan(weeks: unknown[], checkpoints: unknown[]) {
    await t.c.db.db.execute(sql`/*scope:system*/ UPDATE onb_plans SET status = 'stopped' WHERE staff_id = ${org.userA1.id}::uuid AND status = 'active'`);
    const made = await leader("onboarding.plan.create", { name: `Lộ trình ${randomUUID().slice(0, 6)}`, structure: { stages: [{ name: "Tháng 1", weeks }] }, checkpoints });
    await leader("onboarding.plan.assign", { plan_id: made.id, staff_id: org.userA1.id, start_date: mondayThisWeek() });
    return made.id as string;
  }
  const progress = async (id: string, who: typeof leader = leader) => (await who("onboarding.progress.get", { plan_id: id })) as any;
  const addRows = async (f: { tableId: string }, n: number, data: (i: number) => Record<string, unknown>) => {
    for (let i = 0; i < n; i++) await leader("datahub.row.create", { table_id: f.tableId, data: data(i) });
    resetMetricCache(); // in production the worker drops the cache when rows change
  };
  const shareView = async (tableId: string) => {
    const dhId = (await leader("datahub.table.get", { table_id: tableId })).datahub_id;
    for (const g of [org.userA1.id, org.userA2.id]) await leader("datahub.share.set", { datahub_id: dhId, grantee_id: g, table_id: tableId, permission: "view" });
  };

  it("Q&A of week 1: 7 of 10 is still running with the real value, 10 is Đạt", async () => {
    const f = await leaderForm();
    await shareView(f.tableId);
    const id = await runPlan([{ name: "W1", items: [] }], [{ week_no: 1, name: "Q&A tuần 1 ≥ 10", conditions: [{ type: "metric", form_id: f.id, agg: "count", range: "week", threshold: 10 }] }]);
    await addRows(f, 7, (i) => ({ "Người điền": org.userA1.id, "Câu trả lời": `câu ${i}` }));
    await addRows(f, 5, () => ({ "Người điền": org.userA2.id, "Câu trả lời": "của người khác" })); // other people's rows do not count
    let cp = (await progress(id)).checkpoints[0];
    expect(cp.status).toBe("running");
    expect(cp.conditions[0]).toMatchObject({ value: 7, threshold: 10, met: false });
    await addRows(f, 3, () => ({ "Người điền": org.userA1.id, "Câu trả lời": "thêm" }));
    const p = await progress(id);
    cp = p.checkpoints[0];
    expect(cp.status).toBe("passed");
    expect(cp.conditions[0].value).toBe(10);
    expect(p.checkpoints_passed).toBe(1);
    expect((await progress(id, staff)).checkpoints[0].status).toBe("passed"); // the person sees their own
  });

  it("weighted score sheet with the numbers of the mockup sheet: 3,96 < 4 is Chưa đạt, every criterion >= 3; the row not counted is left out", async () => {
    const dh = await leader("datahub.datahub.create", { name: `Phiếu ${randomUUID().slice(0, 6)}` });
    const f = await leader("form.form.create", { name: "Phiếu chấm", datahub_id: dh.id });
    await leader("form.form.save_draft", { form_id: f.id, config: { schema: "soe-form/1", title: "Phiếu", description: "", appearance: {}, blocks: [q("p", "user", "Người được chấm")] } });
    await leader("form.question.create_columns", { form_id: f.id });
    const crit = ["Nghiệp vụ", "Phân tích", "Trình bày", "Tư duy", "Giao tiếp", "Chủ động", "Tuân thủ"];
    for (const c of crit) await leader("datahub.column.create", { table_id: f.table_id, name: c, type: "number" });
    await leader("datahub.column.create", { table_id: f.table_id, name: "Tính vào trung bình", type: "checkbox" });
    await shareView(f.table_id);
    const weights = [25, 25, 15, 15, 10, 5, 5];
    const sums = [31, 30, 34, 32, 35, 31, 30]; // 8 graders: averages 3,88 3,75 4,25 4,00 4,38 3,88 3,75
    const val = (s: number, i: number) => (s > 32 ? (i < s - 32 ? 5 : 4) : i < 32 - s ? 3 : 4);
    await addRows({ tableId: f.table_id }, 8, (i) => ({ "Người được chấm": org.userA1.id, "Tính vào trung bình": true, ...Object.fromEntries(crit.map((c, k) => [c, val(sums[k]!, i)])) }));
    await addRows({ tableId: f.table_id }, 1, () => ({ "Người được chấm": org.userA1.id, "Tính vào trung bình": false, ...Object.fromEntries(crit.map((c) => [c, 1])) }));
    const cond = { type: "weighted", form_id: f.id, person_field: "Người được chấm", range: "plan", filter: { field: "Tính vào trung bình", op: "eq", value: true }, columns: crit.map((c, k) => ({ field: c, weight: weights[k] })), threshold: 4, floor: 3 };
    const id = await runPlan([{ name: "W1", items: [] }], [{ week_no: 1, name: "Mockup", conditions: [cond] }]);
    const r = (await progress(id)).checkpoints[0].conditions[0];
    expect(r.value).toBeCloseTo(3.9625, 3);
    expect(r.met).toBe(false);
    expect(r.columns.map((c: any) => c.avg)).toEqual([3.875, 3.75, 4.25, 4, 4.375, 3.875, 3.75]);
    expect(r.columns.every((c: any) => c.met)).toBe(true);
    // the same sheet with a lower bar passes, with a higher floor it fails on the criteria
    const id2 = await runPlan([{ name: "W1", items: [] }], [{ week_no: 1, name: "A", conditions: [{ ...cond, threshold: 3.9 }] }, { week_no: 1, name: "B", conditions: [{ ...cond, threshold: 3.9, floor: 4 }] }]);
    const cps = (await progress(id2)).checkpoints;
    expect(cps[0].status).toBe("passed");
    expect(cps[1].status).toBe("running");
  });

  it("rows against the on-job sessions already passed", async () => {
    const f = await leaderForm();
    await shareView(f.tableId);
    const id = await runPlan([{ name: "W1", items: [{ name: "On-job 1", kind: "on_job", weekday: 1 }, { name: "On-job 2", kind: "on_job", weekday: 1 }] }], [{ week_no: 1, name: "Đủ bài thu hoạch", conditions: [{ type: "vs_items", form_id: f.id, item_kind: "on_job", range: "plan" }] }]);
    await addRows(f, 1, () => ({ "Người điền": org.userA1.id, "Câu trả lời": "bài 1" }));
    let c = (await progress(id)).checkpoints[0].conditions[0];
    expect(c).toMatchObject({ value: 1, threshold: 2, met: false });
    await addRows(f, 1, () => ({ "Người điền": org.userA1.id, "Câu trả lời": "bài 2" }));
    c = (await progress(id)).checkpoints[0].conditions[0];
    expect(c).toMatchObject({ value: 2, threshold: 2, met: true });
  });

  it("manual confirmation and the final verdict: only the leader, never AI; the note shows after the verdict", async () => {
    const id = await runPlan([{ name: "W1", items: [] }], [{ name: "Nhận deal", is_final: true, conditions: [{ type: "manual" }] }]);
    const p = await progress(id);
    expect(p.checkpoints[0]).toMatchObject({ status: "running", is_final: true });
    expect(p.final).toEqual({ result: null, note: null });
    expect((await fails(staff("onboarding.checkpoint.confirm", { checkpoint_id: p.checkpoints[0].id }))).code).toBe("forbidden");
    await leader("onboarding.checkpoint.confirm", { checkpoint_id: p.checkpoints[0].id });
    expect((await progress(id)).checkpoints[0].status).toBe("passed");
    expect(t.c.registry.get("onboarding.checkpoint.confirm")!.ai).toMatchObject({ forbidden: "hard" });
    expect(t.c.registry.get("onboarding.plan.finish")!.ai).toMatchObject({ forbidden: "hard" });
    expect((await fails(staff("onboarding.plan.finish", { plan_id: id, result: "passed" }))).code).toBe("forbidden");
    const done = await leader("onboarding.plan.finish", { plan_id: id, result: "passed", note: "Làm tốt" });
    expect(done).toMatchObject({ status: "completed", final_result: "passed" });
    expect((await progress(id, staff)).final).toEqual({ result: "passed", note: "Làm tốt" });
    expect((await fails(leader("onboarding.plan.finish", { plan_id: id, result: "failed" }))).details.reason).toBe("plan_not_active");
  });
  it("column option \"tell the person when edited\": the leader's comment tells the person of the row; a recalculation does not; grouped; no value in the text", async () => {
    const f = await leaderForm();
    await shareView(f.tableId);
    await leader("datahub.column.create", { table_id: f.tableId, name: "Điểm", type: "number" });
    await leader("datahub.column.create", { table_id: f.tableId, name: "Gấp đôi", type: "formula", config: { formula: "=[Điểm]*2" } });
    const me = (await leader("datahub.row.create", { table_id: f.tableId, data: { "Người điền": org.userA1.id, "Câu trả lời": "bài của tôi", "Điểm": 1 } })) as { id: string };
    const other = (await leader("datahub.row.create", { table_id: f.tableId, data: { "Người điền": org.userA2.id, "Câu trả lời": "bài của người khác", "Điểm": 1 } })) as { id: string };
    // only the owner of the table sets the option; the person column must be a user column
    expect((await fails(staff("datahub.column.update", { table_id: f.tableId, column: "Nhận xét của leader", notify_on_change: { people_column: "Người điền" } }))).code).toMatch(/forbidden|not_found/);
    expect((await fails(leader("datahub.column.update", { table_id: f.tableId, column: "Nhận xét của leader", notify_on_change: { people_column: "Câu trả lời" } }))).details.reason).toBe("notify_people_column");
    const set = await leader("datahub.column.update", { table_id: f.tableId, column: "Nhận xét của leader", notify_on_change: { people_column: "Người điền" } });
    expect(set.notify_on_change).toMatchObject({ people_column: expect.any(String) });
    await leader("datahub.column.update", { table_id: f.tableId, column: "Gấp đôi", notify_on_change: { people_column: "Người điền" } });
    const mineN = async (who: typeof staff) => ((await who("notification.list", { limit: 100 })) as { items: { type: string; body: string }[] }).items.filter((n) => n.type === "datahub.cell.changed");
    const edit = async (rowId: string, data: Record<string, unknown>) => {
      const cur = (await leader("datahub.row.get", { table_id: f.tableId, row_id: rowId })) as { version: number };
      await leader("datahub.row.update", { table_id: f.tableId, row_id: rowId, version: cur.version, data });
      await drainOutbox(t);
    };
    await edit(me.id, { "Điểm": 5 }); // plain column, and "Gấp đôi" is recalculated: nobody is told
    expect(await mineN(staff)).toHaveLength(0);
    await edit(me.id, { "Nhận xét của leader": "Cần sửa câu 2 (bí mật 12345)" });
    const got = await mineN(staff);
    expect(got).toHaveLength(1);
    expect(got[0]!.body).toContain("Nhận xét của leader");
    expect(got[0]!.body).not.toContain("12345");
    await edit(me.id, { "Nhận xét của leader": "Đã xem lại" }); // same row within 10 minutes: one notification
    expect(await mineN(staff)).toHaveLength(1);
    expect(await mineN(as(t, org.userA2.id, "web"))).toHaveLength(0); // the other person's row is not theirs to be told about... until it is edited
    await edit(other.id, { "Nhận xét của leader": "Ổn" });
    expect(await mineN(as(t, org.userA2.id, "web"))).toHaveLength(1);
    expect(await mineN(staff)).toHaveLength(1);
  });
});

const GROUP_CYCLE = ["test", "mockup", "on_job", "qna", "daily"] as const;

describe("onboarding 9C", () => {
  const monday = (): string => {
    const d = businessDate(new Date());
    const m = new Date(`${d}T00:00:00Z`);
    m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7));
    return m.toISOString().slice(0, 10);
  };
  async function runPlan(weeks: unknown[], checkpoints: unknown[] = [], who: typeof leader = leader, staffId: string = org.userA1.id) {
    await t.c.db.db.execute(sql`/*scope:system*/ UPDATE onb_plans SET status = 'stopped' WHERE staff_id = ${staffId}::uuid AND status = 'active'`);
    const made = await who("onboarding.plan.create", { name: `Lộ trình ${randomUUID().slice(0, 6)}`, structure: { stages: [{ name: "Tháng 1", weeks }] }, checkpoints });
    await who("onboarding.plan.assign", { plan_id: made.id, staff_id: staffId, start_date: monday() });
    return made.id as string;
  }
  const mine = async (who: typeof staff, type: string) => ((await who("notification.list", { limit: 100 })) as { items: { type: string; body: string; read_at: string | null }[] }).items.filter((n) => n.type === type);

  it("overdue: the person and the leader are told once, however often the job runs", async () => {
    const { runOnboardingDue } = await import("../src/modules/onboarding/reminders");
    await runPlan([{ name: "W1", items: [{ name: "Báo cáo ngày", weekday: 1, due_time: "10:00", remind_before_min: 60 }] }]);
    const mon = monday();
    const before = new Date(`${mon}T09:30:00+07:00`); // inside the reminder window (09:00 to 10:00)
    const after = new Date(`${mon}T10:30:00+07:00`);
    const r1 = await runOnboardingDue(t.c.db.db, before);
    expect(r1.reminded).toBeGreaterThanOrEqual(1);
    expect(await mine(staff, "onboarding.due")).toHaveLength(1);
    expect(await mine(leader, "onboarding.due")).toHaveLength(0);
    await runOnboardingDue(t.c.db.db, before);
    expect(await mine(staff, "onboarding.due")).toHaveLength(1);
    await runOnboardingDue(t.c.db.db, after);
    await runOnboardingDue(t.c.db.db, after);
    expect(await mine(staff, "onboarding.overdue")).toHaveLength(1);
    expect(await mine(leader, "onboarding.overdue")).toHaveLength(1);
  });

  it("ticks fold into one summary a day for the leader, rewritten as more comes in", async () => {
    const id = await runPlan([{ name: "W1", items: [{ name: "Việc A", weekday: 1 }, { name: "Việc B", weekday: 1 }] }]);
    const occ = occurrences(await leader("onboarding.plan.get", { plan_id: id }));
    await staff("onboarding.item.tick", { occurrence_id: occ[0].id });
    await drainOutbox(t);
    const one = (await mine(leader, "onboarding.daily")).filter((n) => n.body.includes("xong 1 việc"));
    expect(one).toHaveLength(1);
    await staff("onboarding.item.tick", { occurrence_id: occ[1].id });
    await drainOutbox(t);
    const all = (await mine(leader, "onboarding.daily")).filter((n) => n.body.includes("xong 2 việc"));
    expect(all).toHaveLength(1);
    expect((await mine(leader, "onboarding.daily")).filter((n) => n.body.includes("xong 1 việc"))).toHaveLength(0); // rewritten, not a second one
    expect(await mine(staff, "onboarding.daily")).toHaveLength(0);
  });

  it("overview: a Leader sees only their own team; the Manager sees the tree; 10 plans of 20 checkpoints (timed)", async () => {
    const f = await leaderForm();
    const mgr = as(t, org.mgrA.id, "web");
    const db = t.c.db.db;
    const ids: string[] = [];
    for (let n = 0; n < 9; n++) {
      const [u] = await db.insert(users).values({ email: `ov${n}.${org.tag}@base.vn`, fullName: `Nhân sự ${n} ${org.tag}`, roles: ["user"], status: "active", passwordHash: "x" }).returning({ id: users.id });
      await db.insert(orgMemberships).values({ userId: u!.id, managerId: org.mgrA.id, leaderId: org.leaderA.id });
      ids.push(u!.id);
    }
    const cps = Array.from({ length: 20 }, (_, k) => ({ week_no: 1, name: `CP ${k}`, group: GROUP_CYCLE[k % GROUP_CYCLE.length], conditions: [{ type: "metric", form_id: f.id, agg: "count", threshold: 1, range: "plan" }] }));
    await runPlan([{ name: "W1", items: [{ name: "Việc", weekday: 1 }] }], cps); // UserA1
    for (const id of ids) await runPlan([{ name: "W1", items: [{ name: "Việc", weekday: 1 }] }], cps, leader, id);
    const t0 = Date.now();
    const rows = (await leader("onboarding.overview", {})) as any[];
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(2000); // measured 135 ms (23/11/2026, 10 plans x 20 checkpoints)
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows[0]).toMatchObject({ checkpoints_total: 20, total_weeks: 1, groups: { test: { total: 4, passed: 0, state: expect.any(String) } } });
    expect(((await leader2("onboarding.overview", {})) as any[]).length).toBe(0);
    expect(((await mgr("onboarding.overview", {})) as any[]).length).toBe(rows.length);
    expect(((await staff("onboarding.overview", {})) as any[]).length).toBe(0);
    expect(((await leader("onboarding.overview", { q: "Nhân sự 3" })) as any[]).length).toBe(1);
  });

  it("the sample plan is built for a Leader (once); cloned and assigned, its forms are published and the person can fill them", async () => {
    const { ensureSamplePlan } = await import("../src/modules/onboarding/sample");
    await unlimit(t, org.leaderA.id, { datahubs: 500, tables: 500 });
    const id = await ensureSamplePlan(t.c.db.db, t.c.executor, org.leaderA.id);
    expect(id).toBeTruthy();
    expect(await ensureSamplePlan(t.c.db.db, t.c.executor, org.leaderA.id)).toBeNull();
    const tpl = (await leader("onboarding.plan.get", { plan_id: id })) as any;
    expect(tpl.is_template).toBe(true);
    expect(tpl.stages).toHaveLength(4);
    expect(tpl.stages.flatMap((x: any) => x.weeks)).toHaveLength(18);
    expect(tpl.checkpoints.filter((c: any) => c.is_final)).toHaveLength(6);
    expect(JSON.stringify(tpl.checkpoints)).toContain("\"threshold\":4");
    // another Leader gets their own forms; the sample of the first is not theirs
    const mine2 = await ensureSamplePlan(t.c.db.db, t.c.executor, leader2Id);
    expect(mine2).toBeTruthy();
    expect(mine2).not.toBe(id);
    // clone, then assign
    const copy = (await leader("onboarding.plan.clone", { plan_id: id })) as any;
    await t.c.db.db.execute(sql`/*scope:system*/ UPDATE onb_plans SET status = 'stopped' WHERE staff_id = ${org.userA1.id}::uuid AND status = 'active'`);
    const run = (await leader("onboarding.plan.assign", { plan_id: copy.id, staff_id: org.userA1.id, start_date: monday() })) as any; // a template is assigned as a copy of its own
    const got = (await leader("onboarding.plan.get", { plan_id: run.id })) as any;
    const qna = got.stages.flatMap((x: any) => x.weeks.flatMap((w: any) => w.items)).find((i: any) => i.name.startsWith("Gửi câu hỏi Q&A"));
    expect(qna.form_id).not.toBe(tpl.stages[0].weeks[0].items.find((i: any) => i.name.startsWith("Gửi câu hỏi Q&A")).form_id); // the copy has forms of its own
    const [f] = (await t.c.db.db.execute(sql`/*scope:system*/ SELECT code, published_version FROM forms WHERE id = ${qna.form_id}::uuid`)).rows as { code: string; published_version: number }[];
    expect(f!.published_version).toBeGreaterThan(0);
    const r = await staff("form.response.submit", { code: f!.code, answers: { ngay: monday(), app: "Ứng dụng A", cau_hoi: "Câu hỏi mẫu", tra_loi: "Trả lời mẫu" }, attempt_id: randomUUID() });
    expect(r.row_id).toBeTruthy();
    resetMetricCache();
    const pr = (await leader("onboarding.progress.get", { plan_id: run.id })) as any;
    const q1 = pr.checkpoints.find((c: any) => c.name === "Q&A 10 câu");
    expect(q1.conditions[0].value).toBe(1);
  });

  it("the sample plan does not use the person's datahub limit (1 of 1 used: the sample is still built, own tables still work, a second own datahub is still refused)", async () => {
    const { ensureSamplePlan } = await import("../src/modules/onboarding/sample");
    const db = t.c.db.db;
    const [u] = await db.insert(users).values({ email: `leader3.${org.tag}@base.vn`, fullName: `Leader3 ${org.tag}`, roles: ["leader"], status: "active", passwordHash: "x" }).returning({ id: users.id });
    await db.insert(orgMemberships).values({ userId: u!.id, managerId: org.mgrA.id, leaderId: null });
    await unlimit(t, u!.id, { datahubs: 1, tables: 10 });
    const l3 = as(t, u!.id, "web");
    const mine = (await l3("datahub.datahub.create", { name: "Của tôi" })) as any;
    expect(await ensureSamplePlan(db, t.c.executor, u!.id)).toBeTruthy();
    await l3("datahub.table.create", { datahub_id: mine.id, name: "Bảng 1" });
    await expect(l3("datahub.datahub.create", { name: "Thứ hai" })).rejects.toMatchObject({ code: "quota_exceeded" });
    const used = (await l3("datahub.limit.mine", {})) as any;
    expect(used.used.datahubs).toBe(1);
  });

  it("a break week pushes the later weeks down by one (items, checkpoints, real dates) and removing it brings them back", async () => {
    const id = await runPlan([{ name: "W1", items: [{ name: "Việc 1", weekday: 1 }] }, { name: "W2", items: [{ name: "Việc 2", weekday: 1 }] }], [{ week_no: 2, name: "CP tuần 2", conditions: [{ type: "manual" }] }]);
    const dateOf = async (item: string) => occurrences(await leader("onboarding.plan.get", { plan_id: id })).find((o: any) => o.item === item).on_date as string;
    const before = await dateOf("Việc 2");
    await leader("onboarding.plan.week_break", { plan_id: id, week_no: 2, is_break: true });
    const got = (await leader("onboarding.plan.get", { plan_id: id })) as any;
    expect(got.stages[0].weeks.map((w: any) => [w.week_no, w.is_break])).toEqual([[1, false], [2, true], [3, false]]);
    expect(got.checkpoints[0].week_no).toBe(3);
    const after = await dateOf("Việc 2");
    expect((new Date(`${after}T00:00:00Z`).getTime() - new Date(`${before}T00:00:00Z`).getTime()) / 86400000).toBe(7);
    await leader("onboarding.plan.week_break", { plan_id: id, week_no: 2, is_break: false });
    expect(await dateOf("Việc 2")).toBe(before);
  });
});
