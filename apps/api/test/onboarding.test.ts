/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orgMemberships, users } from "@soe/db";
import { actorOf, as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { activeToken, seedOrg, type Org } from "./fixtures";
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
