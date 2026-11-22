import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { orgMemberships, users } from "@soe/db";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { BUILTIN_DEFAULT_SET, ensureTreeTemplates, runDueRules, runMorningDigest } from "../src/modules/deal";
import { NOTIFICATION_TYPES } from "../src/modules/notification";
import { workerEmit } from "../src/modules/datahub/template-sync";
import { processPendingColumns } from "../src/modules/datahub";

/**
 * Stage 6A2: morning digest, deal due reminders, general announcements (design module6 5.5, 6.4, 6.5, 7, 14). Invented data only.
 * Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2. Tree B: MgrB > LeaderB > UserB1.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let a1: ReturnType<typeof as>;
let a2: ReturnType<typeof as>;
let b1: ReturnType<typeof as>;
let tplId: string;
const tables: Record<string, string> = {};
const db = () => t.c.db.db;
const person = (id: string, vai_tro: string) => ({ id, attrs: { vai_tro, ty_le_com: 0.1 } });
const at = (day: string) => new Date(`${day}T02:00:00Z`); // 09:00 in Vietnam
let seq = 0;

const mine = async (call: ReturnType<typeof as>, type: string) => {
  const r = (await call("notification.list", { limit: 200 })) as { items: { type: string; title: string; body: string; priority: string }[] };
  return r.items.filter((n) => n.type === type);
};
async function deal(o: { lead: string; others?: string[]; exp?: string; extra?: Record<string, unknown> }): Promise<{ id: string; name: string }> {
  const name = `Công ty Thử ${++seq}`;
  const r = await mgrA("datahub.row.create", {
    table_id: tables["Deals"]!,
    data: { "Tên công ty": name, "Loại deal": "POD bán mới", "Start date": "2026-06-10", ...(o.exp ? { "Ngày dự kiến chốt": o.exp } : {}), "Người tham gia": [person(o.lead, "Leading"), ...(o.others ?? []).map((x) => person(x, "Associate"))], ...o.extra },
  });
  return { id: r.id as string, name };
}
const settle = async () => {
  await drainOutbox(t);
  await processPendingColumns(db());
  await drainOutbox(t);
};
const pay = (dealId: string, due: string) => mgrA("payment.schedule", { deal_id: dealId, payments: [{ amount: 1_000_000, due }] });
const setMarker = (day: string | null) =>
  day === null
    ? db().execute(sql`DELETE FROM system_settings WHERE key = ${`deal.due_rules.last_run:${org.mgrA.id}`}`)
    : db().execute(sql`INSERT INTO system_settings (id, key, value, created_at, updated_at, version) VALUES (gen_random_uuid(), ${`deal.due_rules.last_run:${org.mgrA.id}`}, to_jsonb(${day}::text), now(), now(), 1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  leaderA = as(t, org.leaderA.id);
  a1 = as(t, org.userA1.id);
  a2 = as(t, org.userA2.id);
  b1 = as(t, org.userB1.id);
  await ensureTreeTemplates(db(), workerEmit(db()), org.mgrA.id);
  await drainOutbox(t);
  const list = (await mgrA("datahub.template.list")) as { id: string; name: string; master_table_id: string }[];
  for (const d of BUILTIN_DEFAULT_SET) tables[d.name] = list.find((x) => x.name === d.name)!.master_table_id;
  tplId = list.find((x) => x.name === "Deals")!.id;
}, 120_000);
afterAll(async () => {
  await t.close();
});

describe("deal due rules", () => {
  it("fires each milestone on the right Vietnam day, to the Leading person (and Leader at 7 days), and only to people on the deal", async () => {
    const before = await deal({ lead: org.userA1.id, others: [org.userA2.id], exp: "2026-10-13" });
    const over = await deal({ lead: org.userA1.id, exp: "2026-10-09" });
    const later = await deal({ lead: org.userA1.id, exp: "2026-10-20" });
    const other = await deal({ lead: org.userA2.id, exp: "2026-10-13" });
    const pBefore = await deal({ lead: org.userA1.id });
    await pay(pBefore.id, "2026-10-13");
    const pOn = await deal({ lead: org.userA1.id });
    await pay(pOn.id, "2026-10-10");
    const p7 = await deal({ lead: org.userA1.id });
    await pay(p7.id, "2026-10-03");
    const pNone = await deal({ lead: org.userA1.id });
    await pay(pNone.id, "2026-10-12");
    await settle();

    const n = await runDueRules(db(), at("2026-10-10"));
    expect(n).toBe(7);
    const bodies1 = (await mine(a1, NOTIFICATION_TYPES.dealDue)).map((x) => x.body).join("\n");
    for (const d of [before, over, pBefore, pOn, p7]) expect(bodies1).toContain(`"${d.name}"`);
    for (const d of [later, other, pNone]) expect(bodies1).not.toContain(`"${d.name}"`);
    expect(bodies1).toContain("13/10/2026");
    expect(bodies1).toContain("quá 1 ngày");
    // The associate on `before` is not Leading: not told. The other deal's Leading person is.
    const bodies2 = (await mine(a2, NOTIFICATION_TYPES.dealDue)).map((x) => x.body).join("\n");
    expect(bodies2).toContain(`"${other.name}"`);
    expect(bodies2).not.toContain(`"${before.name}"`);
    // Leader of the Leading person hears of the instalment 7 days late, and only of that one.
    const lead = (await mine(leaderA, NOTIFICATION_TYPES.dealDue)).map((x) => x.body).join("\n");
    expect(lead).toContain(`"${p7.name}"`);
    expect(lead).not.toContain(`"${pBefore.name}"`);
    expect(await mine(b1, NOTIFICATION_TYPES.dealDue)).toHaveLength(0);
  });

  it("running twice never doubles, even without the run marker", async () => {
    const count = async () => (await mine(a1, NOTIFICATION_TYPES.dealDue)).length;
    const was = await count();
    expect(await runDueRules(db(), at("2026-10-10"))).toBe(0);
    await setMarker(null);
    expect(await runDueRules(db(), at("2026-10-10"))).toBe(0);
    expect(await count()).toBe(was);
  });

  it("catches up yesterday when the last run was missed", async () => {
    const d = await deal({ lead: org.userA1.id, exp: "2026-10-14" }); // 3 days after 11/10: the run of 11/10 was missed
    await drainOutbox(t);
    await setMarker("2026-10-10");
    // The two days: 11/10 (this deal, and the instalment due 10/10 one day late) and 12/10 (the instalment due that day).
    expect(await runDueRules(db(), at("2026-10-12"))).toBe(3);
    expect((await mine(a1, NOTIFICATION_TYPES.dealDue)).some((x) => x.body.includes(`"${d.name}"`))).toBe(true);
  });

  it("an off rule sends nothing; only the Manager of the tree edits; milestones are limited to 5", async () => {
    expect((await fails(leaderA("deal.due_rules.set", { rules: [{ key: "deal_expected_close", enabled: false, milestones: [] }] }))).code).toBe("forbidden");
    expect((await leaderA("deal.due_rules.get")).can_edit).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => ({ kind: "before", days: i + 1, to: ["leading"] }));
    expect((await fails(mgrA("deal.due_rules.set", { rules: [{ key: "payment_due", enabled: true, milestones: six }] }))).code).toBe("validation_error");
    await mgrA("deal.due_rules.set", { rules: [{ key: "deal_expected_close", enabled: false, milestones: [{ kind: "before", days: 3, to: ["leading"] }] }] });
    const d = await deal({ lead: org.userA1.id, exp: "2026-10-23" });
    await drainOutbox(t);
    await runDueRules(db(), at("2026-10-20"));
    expect((await mine(a1, NOTIFICATION_TYPES.dealDue)).some((x) => x.body.includes(`"${d.name}"`))).toBe(false);
    // Switched on with a new milestone ("on the day"), the same deal is told on its day.
    await mgrA("deal.due_rules.set", { rules: [{ key: "deal_expected_close", enabled: true, milestones: [{ kind: "on", days: 5, to: ["leading"] }] }] });
    expect((await mgrA("deal.due_rules.get")).rules[0].milestones[0].days).toBe(0);
    expect(await runDueRules(db(), at("2026-10-23"))).toBe(1);
    await mgrA("deal.due_rules.set", { rules: [{ key: "deal_expected_close", enabled: true, milestones: [{ kind: "before", days: 3, to: ["leading"] }, { kind: "after", days: 1, to: ["leading"] }] }] });
  });

  it("more than 50 rows for one person become one grouped notification", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) ids.push((await deal({ lead: org.userA1.id, exp: "2026-11-13" })).id);
    await drainOutbox(t);
    const was = (await mine(a1, NOTIFICATION_TYPES.dealDue)).length;
    await runDueRules(db(), at("2026-11-10"));
    const now = await mine(a1, NOTIFICATION_TYPES.dealDue);
    expect(now.length - was).toBe(1);
    expect(now[0]!.title).toContain("51 deal");
  }, 120_000);
});

describe("morning digest", () => {
  it("counts by role on the deals each person reads; nothing to say sends nothing; the flag turns it off; one per day", async () => {
    const soon = await deal({ lead: org.userA1.id, others: [org.userA2.id], exp: "2026-09-12" });
    const over = await deal({ lead: org.userA1.id, exp: "2026-09-05" });
    await deal({ lead: org.userA2.id, exp: "2026-09-30" });
    await pay(soon.id, "2026-09-11");
    await pay(soon.id, "2026-09-01");
    await drainOutbox(t);
    await a2("notification.settings.set", { morning_digest: false });
    const n = await runMorningDigest(db(), at("2026-09-10"));
    expect(n).toBeGreaterThanOrEqual(2); // A1 and the Manager at least
    const d1 = (await mine(a1, NOTIFICATION_TYPES.morningDigest))[0]!;
    expect(d1.body).toContain("deal cần chấm lại hôm nay");
    expect(d1.body).toContain("1 deal dự kiến chốt trong 7 ngày tới");
    expect(d1.body).toContain("1 deal đã quá ngày dự kiến chốt");
    expect(d1.body).toContain("1 đợt thanh toán đến hạn trong 7 ngày tới");
    expect(d1.body).toContain("1 đợt thanh toán đã quá hạn");
    // Switched off: no digest. Other tree and the Leader (who manages A1 but sees the deals through them): see below.
    expect(await mine(a2, NOTIFICATION_TYPES.morningDigest)).toHaveLength(0);
    expect(await mine(b1, NOTIFICATION_TYPES.morningDigest)).toHaveLength(0);
    expect((await mine(leaderA, NOTIFICATION_TYPES.morningDigest))[0]!.body).toContain("1 deal dự kiến chốt");
    await runMorningDigest(db(), at("2026-09-10"));
    expect(await mine(a1, NOTIFICATION_TYPES.morningDigest)).toHaveLength(1);
    await a2("notification.settings.set", { morning_digest: true });
    expect(over.name).toBeTruthy();
  });

  it("follows the role when the Manager moves it to another column", async () => {
    await mgrA("datahub.template.column.create", { template_id: tplId, name: "Chốt dự kiến mới", type: "date" });
    await mgrA("datahub.template.column.set_role", { template_id: tplId, column: "Chốt dự kiến mới", role: "ngay_du_kien_chot" });
    const mover = await deal({ lead: org.userA1.id, exp: "2027-03-01", extra: { "Chốt dự kiến mới": "2027-01-13" } });
    await drainOutbox(t);
    const was = (await mine(a1, NOTIFICATION_TYPES.morningDigest)).length;
    await runMorningDigest(db(), at("2027-01-10"));
    const all = await mine(a1, NOTIFICATION_TYPES.morningDigest);
    expect(all.length - was).toBe(1);
    // The new column is the one read: one deal soon (the other deals have no date there), none overdue.
    expect(all[0]!.body).toContain("1 deal dự kiến chốt trong 7 ngày tới");
    expect(all[0]!.body).not.toContain("quá ngày dự kiến chốt");
    expect(mover.id).toBeTruthy();
  });
});

describe("announcements", () => {
  const send = (call: ReturnType<typeof as>, scope: Record<string, unknown>, o: { title?: string; important?: boolean } = {}) => call("announcement.send", { title: o.title ?? "Họp team 9h mai", body: "Nội dung", important: o.important ?? false, scope });

  it("a Leader writes to their team only; people outside the reach are refused with a clear error", async () => {
    expect((await fails(send(leaderA, { teams: [org.leaderB.id] }))).details.reason).toBe("out_of_scope");
    expect((await fails(send(leaderA, { user_ids: [org.userA2.id] }))).details.reason).toBe("out_of_scope");
    expect((await fails(send(leaderA, { all: true }))).details.reason).toBe("out_of_scope");
    expect((await fails(send(a1, { user_ids: [org.userA2.id] }))).code).toBe("forbidden");
    const r = await send(leaderA, { teams: [org.leaderA.id] }, { title: "Team A họp" });
    expect(r.recipient_count).toBe(1); // UserA1 (the sender is not a recipient)
    expect((await mine(a1, NOTIFICATION_TYPES.announcement)).map((x) => x.title)).toContain("Team A họp");
    expect(await mine(a2, NOTIFICATION_TYPES.announcement)).toHaveLength(0);
    // A Guest is never a recipient, by tree, by team or by name.
    expect((await fails(send(mgrA, { user_ids: [org.guestData.id] }))).details.reason).toBe("out_of_scope");
    expect(await mine(as(t, org.guestData.id), NOTIFICATION_TYPES.announcement)).toHaveLength(0);
    const one = await send(leaderA, { user_ids: [org.userA1.id] }, { title: "Riêng A1" });
    expect(one.recipient_count).toBe(1);
  });

  it("a Manager writes to the tree or a team in it, not to another tree; important is pinned; read count and unread list", async () => {
    expect((await fails(send(mgrA, { trees: [org.mgrB.id] }))).details.reason).toBe("out_of_scope");
    expect((await fails(send(mgrA, { teams: [org.leaderB.id] }))).details.reason).toBe("out_of_scope");
    expect((await fails(send(mgrA, { user_ids: [org.userB1.id] }))).details.reason).toBe("out_of_scope");
    const r = await send(mgrA, { trees: [org.mgrA.id] }, { title: "Chính sách com mới", important: true });
    expect(r.recipient_count).toBe(3); // LeaderA, UserA1, UserA2 (not the sender, not GuestData)
    const got = (await mine(a2, NOTIFICATION_TYPES.announcement)).find((x) => x.title === "Chính sách com mới")!;
    expect(got.priority).toBe("important");
    expect(await mine(b1, NOTIFICATION_TYPES.announcement)).toHaveLength(0);
    // Nobody has read it yet; after UserA1 reads it, 1 of 4.
    expect(await mgrA("announcement.read_status", { id: r.id })).toMatchObject({ read: 0, total: 3 });
    const n1 = (await mine(a1, NOTIFICATION_TYPES.announcement)).length;
    await a1("notification.mark_read", { all: true });
    expect(n1).toBeGreaterThan(0);
    const st = await mgrA("announcement.read_status", { id: r.id });
    expect(st).toMatchObject({ read: 1, total: 3 });
    expect(st.unread.map((u: { user_id: string }) => u.user_id)).not.toContain(org.userA1.id);
    expect((await fails(a2("announcement.read_status", { id: r.id }))).code).toBe("forbidden");
    // The sent tab, and the received tab of a recipient.
    const sent = (await mgrA("announcement.list_sent", {})) as { id: string; read_count: number }[];
    expect(sent.find((x) => x.id === r.id)!.read_count).toBe(1);
    expect(((await a2("announcement.list_received", {})) as { id: string }[]).some((x) => x.id === r.id)).toBe(true);
  });

  it("recall removes it from every inbox; a person who joins the team later does not get it", async () => {
    const r = await send(mgrA, { trees: [org.mgrA.id] }, { title: "Sẽ thu hồi" });
    const [late] = await db().insert(users).values({ email: `late.${org.tag}@base.vn`, fullName: `Late ${org.tag}`, roles: ["user"], status: "active" }).returning({ id: users.id });
    await db().insert(orgMemberships).values({ userId: late!.id, managerId: org.mgrA.id, leaderId: null });
    expect(await mine(as(t, late!.id), NOTIFICATION_TYPES.announcement)).toHaveLength(0);
    expect((await mgrA("announcement.read_status", { id: r.id })).total).toBe(3);
    expect((await mine(a1, NOTIFICATION_TYPES.announcement)).some((x) => x.title === "Sẽ thu hồi")).toBe(true);
    expect((await fails(leaderA("announcement.recall", { id: r.id }))).code).toBe("not_found");
    expect((await mgrA("announcement.recall", { id: r.id })).removed).toBe(3);
    expect((await mine(a1, NOTIFICATION_TYPES.announcement)).some((x) => x.title === "Sẽ thu hồi")).toBe(false);
    expect(((await a1("announcement.list_received", {})) as { id: string }[]).some((x) => x.id === r.id)).toBe(false);
    expect((await mgrA("announcement.recall", { id: r.id })).removed).toBe(0);
  });
});
