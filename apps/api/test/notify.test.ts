import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { businessDate, type ActorRef } from "@soe/shared";
import { enqueueOutbox, reminders, users } from "@soe/db";
import { as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { activeToken, seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { notify, notifyExpiringConnections, runDueReminders, NOTIFICATION_TYPES } from "../src/modules/notification";
import { MAX_PENDING_REMINDERS, nextOccurrence, parseDue, tomorrow0830, type Recurrence } from "../src/modules/notification/reminders";

/**
 * Stage 6A1: the one door (`notify.send`), the declared types, the settings and the reminders (design module6 3, 4, 5.4, 14).
 * Invented data only. Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2. Tree B: MgrB > LeaderB > UserB1.
 */
let t: TestApp;
let org: Org;
let a1: ReturnType<typeof as>;
let a2: ReturnType<typeof as>;
let leader: ReturnType<typeof as>;
let b1: ReturnType<typeof as>;
const db = () => t.c.db.db;

const mine = async (call: ReturnType<typeof as>, type?: string) => {
  const r = (await call("notification.list", { limit: 100 })) as { items: { type: string; title: string; body: string; category: string; priority: string; link: string | null }[] };
  return type ? r.items.filter((n) => n.type === type) : r.items;
};
const emit = async (event: string, payload: Record<string, unknown>, actor: ActorRef | null = null) => {
  await enqueueOutbox(db(), { event, aggregateType: "test", aggregateId: null, payload, actor });
  await drainOutbox(t);
};
const iso = (s: string) => new Date(s);
const rec = (dueAt: string, repeat: Recurrence["repeat"], o: Partial<Recurrence> = {}): Recurrence => ({ dueAt: iso(dueAt), repeat, weekdays: [], anchorDay: Number(dueAt.slice(8, 10)), untilDate: null, ...o });

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  a1 = as(t, org.userA1.id);
  a2 = as(t, org.userA2.id);
  leader = as(t, org.leaderA.id);
  b1 = as(t, org.userB1.id);
});
afterAll(async () => {
  await t.close();
});

describe("notify.send", () => {
  const actorOf = (userId: string) => ({ userId, via: "api" as const, connectionId: null, automationId: null });
  const send = (recipients: string[], o: { actor?: ReturnType<typeof actorOf> | null; type?: string } = {}) =>
    notify.send(db(), { type: o.type ?? NOTIFICATION_TYPES.datahubShared, recipients, actor: o.actor ?? null, render: (_r, by) => ({ title: "Thử", body: `${by} thử` }) });

  it("never tells the person who caused it (except a reminder), and drops locked and non-person accounts", async () => {
    const n = await send([org.userA1.id, org.userA2.id], { actor: actorOf(org.userA1.id) });
    expect(n).toBe(1);
    expect(await mine(a1, NOTIFICATION_TYPES.datahubShared)).toHaveLength(0);
    expect((await mine(a2, NOTIFICATION_TYPES.datahubShared)).at(0)?.body).toContain(org.userA1.name);
    await db().update(users).set({ status: "locked" }).where(sql`id = ${org.userB1.id}::uuid`);
    expect(await send([org.userB1.id])).toBe(0);
    await db().update(users).set({ status: "active" }).where(sql`id = ${org.userB1.id}::uuid`);
    expect(await send([org.userB1.id])).toBe(1);
  });

  it("a type switched off is not sent; a mandatory type cannot be switched off", async () => {
    const off = (await a2("notification.settings.set", { disabled_types: [NOTIFICATION_TYPES.datahubShared] })) as { disabled_types: string[] };
    expect(off.disabled_types).toEqual([NOTIFICATION_TYPES.datahubShared]);
    const before = (await mine(a2, NOTIFICATION_TYPES.datahubShared)).length;
    expect(await send([org.userA2.id])).toBe(0);
    expect(await mine(a2, NOTIFICATION_TYPES.datahubShared)).toHaveLength(before);
    expect((await fails(a2("notification.settings.set", { disabled_types: [NOTIFICATION_TYPES.accountLocked] }))).details.reason).toBe("mandatory_type");
    expect((await fails(a2("notification.settings.set", { disabled_types: ["khong.co"] }))).details.reason).toBe("unknown_type");
    // A mandatory type is sent even when a stale setting names it.
    await db().execute(sql`UPDATE notification_settings SET disabled_types = ARRAY['account.locked', 'datahub.shared'] WHERE /*scope:system*/ user_id = ${org.userA2.id}::uuid`);
    await emit("auth.account.locked", { user_id: org.userA2.id, minutes: 15 });
    expect(await mine(a2, NOTIFICATION_TYPES.accountLocked)).toHaveLength(1);
    const s = (await a2("notification.settings.get")) as { morning_digest: boolean; types: { type: string; enabled: boolean; mandatory: boolean }[] };
    expect(s.morning_digest).toBe(true);
    expect(s.types.find((x) => x.type === "account.locked")).toMatchObject({ mandatory: true, enabled: true });
    expect(s.types.find((x) => x.type === "datahub.shared")).toMatchObject({ mandatory: false, enabled: false });
    expect(((await a2("notification.settings.set", { morning_digest: false })) as { morning_digest: boolean }).morning_digest).toBe(false);
    await a2("notification.settings.set", { disabled_types: [], morning_digest: true });
  });

  it("one event gives one notification per person, whatever the retries", async () => {
    const ev = { user_id: org.userB1.id, minutes: 15 };
    const id = await enqueueOutbox(db(), { event: "auth.account.locked", aggregateId: null, aggregateType: "test", payload: ev });
    await drainOutbox(t);
    const n = (await mine(b1, NOTIFICATION_TYPES.accountLocked)).length;
    // Same event handled again (at-least-once delivery): the stable source id makes it a no-op.
    await db().execute(sql`UPDATE outbox SET status = 'pending', delivered_to = '{}' WHERE id = ${id}::uuid`);
    await drainOutbox(t);
    expect(await mine(b1, NOTIFICATION_TYPES.accountLocked)).toHaveLength(n);
  });
});

describe("types", () => {
  it("a share the person lost before the event is handled is not told; a live one is", async () => {
    const x = await makeTable(a1);
    await a1("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
    const gone = await makeTable(a1);
    await a1("datahub.share.set", { datahub_id: gone.dhId, grantee_id: org.userB1.id, permission: "view" });
    const shares = (await a1("datahub.share.list", { datahub_id: gone.dhId })) as { id: string }[];
    await a1("datahub.share.remove", { datahub_id: gone.dhId, share_id: shares[0]!.id });
    await drainOutbox(t);
    const got = await mine(a2, NOTIFICATION_TYPES.datahubShared);
    expect(got.some((n) => n.link === `/datahub/${x.dhId}`)).toBe(true);
    expect(got.every((n) => n.category === "datahub")).toBe(true);
    expect((await mine(b1, NOTIFICATION_TYPES.datahubShared)).some((n) => n.link === `/datahub/${gone.dhId}`)).toBe(false);
    // The sharer is not told about their own action.
    expect(await mine(a1, NOTIFICATION_TYPES.datahubShared)).toHaveLength(0);
  });

  it("AI connection: Admins hear of a request, the owner of the decision, and the body names the connection", async () => {
    const tk = await activeToken(t, org.userA1.id, [], { menus: { notify: "write" }, name: "claude-thu" });
    await emit("auth.token.requested", { token_id: tk.id, user_id: org.userA1.id, name: "claude-thu" });
    const admin = as(t, org.admin.id);
    const req = (await mine(admin, NOTIFICATION_TYPES.aiRequested)).find((n) => n.body.includes("claude-thu"));
    expect(req).toBeDefined();
    expect(req!.priority).toBe("important");
    await emit("auth.token.decided", { token_id: tk.id, user_id: org.userA1.id, status: "rejected" }, { userId: org.admin.id, via: "web", connectionId: null, automationId: null });
    expect((await mine(a1, NOTIFICATION_TYPES.aiRejected)).some((n) => n.body.includes("claude-thu"))).toBe(true);
    expect(await mine(a1, NOTIFICATION_TYPES.aiApproved)).toHaveLength(0);
    // An AI actor is named in the text: "(qua <connection>)".
    const own = (await makeTable(a1)).dhId;
    await a1("datahub.share.set", { datahub_id: own, grantee_id: org.userA2.id, permission: "view" });
    await drainOutbox(t);
    await emit("datahub.share.changed", { datahub_id: own, table_id: null, grantee_id: org.userA2.id }, { userId: org.userA1.id, via: "mcp", connectionId: tk.id, automationId: null });
    const viaAi = (await mine(a2, NOTIFICATION_TYPES.datahubShared)).filter((n) => n.body.includes("(qua claude-thu)"));
    expect(viaAi).toHaveLength(1);
  });

  it("a connection near its end is told once", async () => {
    const tk = await activeToken(t, org.userA2.id, [], { menus: { notify: "read" }, name: "sap-het-han", expiresAt: new Date(Date.now() + 3 * 86400_000) });
    expect(await notifyExpiringConnections(db())).toBeGreaterThanOrEqual(1);
    expect(await notifyExpiringConnections(db())).toBe(0);
    expect((await mine(a2, NOTIFICATION_TYPES.aiExpiring)).some((n) => n.body.includes("sap-het-han"))).toBe(true);
    void tk;
  });

  it("the payment notice carries the deal name only: nothing of anyone's commission or amount", async () => {
    const tableId = (await makeTable(a1)).tableId;
    await emit("deal.payment.confirmed", { table_id: tableId, deals: [{ deal_id: org.mgrA.id, deal: "Công ty Thử", user_ids: [org.leaderA.id, org.userA1.id], payments: 2 }] }, { userId: org.mgrA.id, via: "web", connectionId: null, automationId: null });
    const n = (await mine(leader, NOTIFICATION_TYPES.dealPaymentConfirmed)).at(0)!;
    expect(n.body).toContain("Công ty Thử");
    expect(n.body).not.toMatch(/%|VND|\d[.,]\d{3}/);
    expect(await mine(as(t, org.mgrA.id), NOTIFICATION_TYPES.dealPaymentConfirmed)).toHaveLength(0);
  });
});

describe("recurrence", () => {
  it("daily keeps the Vietnam time of day next to midnight", () => {
    expect(nextOccurrence(rec("2026-11-23T23:59:00+07:00", "daily"), iso("2026-11-23T23:59:00+07:00"))!.toISOString()).toBe("2026-11-24T16:59:00.000Z");
    expect(nextOccurrence(rec("2026-11-24T00:01:00+07:00", "daily"), iso("2026-11-24T00:01:00+07:00"))!.toISOString()).toBe("2026-11-24T17:01:00.000Z");
    // Late worker: the next one is after now, one notification for the missed days.
    expect(nextOccurrence(rec("2026-11-20T08:00:00+07:00", "daily"), iso("2026-11-23T10:00:00+07:00"))!.toISOString()).toBe("2026-11-24T01:00:00.000Z");
  });
  it("monthly on the 31st falls on the last day of shorter months and comes back", () => {
    const r = rec("2026-01-31T09:00:00+07:00", "monthly");
    const feb = nextOccurrence(r, r.dueAt)!;
    expect(feb.toISOString()).toBe("2026-02-28T02:00:00.000Z");
    expect(nextOccurrence({ ...r, dueAt: feb }, feb)!.toISOString()).toBe("2026-03-31T02:00:00.000Z");
    const dec = rec("2026-12-31T23:30:00+07:00", "monthly");
    expect(nextOccurrence(dec, dec.dueAt)!.toISOString()).toBe("2027-01-31T16:30:00.000Z");
    const leap = rec("2027-12-31T09:00:00+07:00", "monthly");
    const feb2028 = nextOccurrence({ ...leap, dueAt: iso("2028-01-31T09:00:00+07:00") }, iso("2028-01-31T09:00:00+07:00"))!;
    expect(feb2028.toISOString()).toBe("2028-02-29T02:00:00.000Z");
  });
  it("weekly goes to the next chosen weekday; the end date is inclusive", () => {
    const r = rec("2026-11-23T08:00:00+07:00", "weekly", { weekdays: [1, 3] }); // Monday
    const wed = nextOccurrence(r, r.dueAt)!;
    expect(wed.toISOString()).toBe("2026-11-25T01:00:00.000Z");
    expect(nextOccurrence({ ...r, dueAt: wed }, wed)!.toISOString()).toBe("2026-11-30T01:00:00.000Z");
    expect(nextOccurrence({ ...r, untilDate: "2026-11-25" }, r.dueAt)!.toISOString()).toBe("2026-11-25T01:00:00.000Z");
    expect(nextOccurrence({ ...r, dueAt: wed, untilDate: "2026-11-25" }, wed)).toBeNull();
    expect(nextOccurrence(rec("2026-11-23T08:00:00+07:00", "none"), iso("2026-11-23T08:00:00+07:00"))).toBeNull();
  });
  it("reads Vietnam time when no zone is given, and tomorrow 08:30 is Vietnam time", () => {
    expect(parseDue("2026-11-23T14:00").toISOString()).toBe("2026-11-23T07:00:00.000Z");
    expect(parseDue("2026-11-23T14:00:00Z").toISOString()).toBe("2026-11-23T14:00:00.000Z");
    expect(tomorrow0830(iso("2026-11-23T20:00:00Z")).toISOString()).toBe("2026-11-25T01:30:00.000Z"); // 03:00 on the 24th in Vietnam
    expect(() => parseDue("mai")).toThrow();
  });
});

describe("reminders", () => {
  const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const rows = (call: ReturnType<typeof as>) => call("reminder.list", {}) as Promise<{ id: string; status: string; due_at: string; content: string }[]>;
  const pull = (id: string, when: Date) => db().update(reminders).set({ dueAt: when }).where(sql`/*scope:system*/ id = ${id}::uuid`);

  it("refuses a time in the past, a bad end date and a long text", async () => {
    expect((await fails(a1("reminder.create", { content: "x", due_at: new Date(Date.now() - 60_000).toISOString() }))).details.reason).toBe("reminder_in_past");
    expect((await fails(a1("reminder.create", { content: "x", due_at: future(48), repeat: "daily", until: "2020-01-01" }))).details.reason).toBe("reminder_until_before_start");
    await fails(a1("reminder.create", { content: "x".repeat(501), due_at: future(1) }));
  });

  it("fires once when due, even if the job runs twice; Xong ends it; others never see it", async () => {
    const r = (await a1("reminder.create", { content: "Gọi lại Thuận Phát", due_at: future(1) })) as { id: string };
    expect(await runDueReminders(db())).toBe(0);
    await pull(r.id, new Date(Date.now() - 1000));
    expect(await runDueReminders(db())).toBeGreaterThanOrEqual(1);
    expect(await runDueReminders(db())).toBe(0);
    const n = (await mine(a1, NOTIFICATION_TYPES.reminderDue)).filter((x) => x.body === "Gọi lại Thuận Phát");
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ priority: "important", category: "reminder" });
    expect((await rows(a1)).find((x) => x.id === r.id)?.status).toBe("fired");
    expect(await mine(a2, NOTIFICATION_TYPES.reminderDue)).toHaveLength(0);
    expect((await fails(a2("reminder.done", { id: r.id }))).code).toBe("not_found");
    expect(((await a1("reminder.done", { id: r.id })) as { status: string }).status).toBe("done");
    expect((await rows(a1)).some((x) => x.id === r.id)).toBe(false);
    expect(((await a1("reminder.list", { status: "done" })) as { id: string }[]).some((x) => x.id === r.id)).toBe(true);
  });

  /** The end date is a Vietnam date (not UTC): between 00:00 and 07:00 Vietnam time the UTC date is still yesterday. `at` fakes the clock (Date only). */
  const dailyMovesOn = async (at?: string) => {
    if (at) vi.useFakeTimers({ toFake: ["Date"], now: new Date(at) });
    try {
      const r = (await a1("reminder.create", { content: "Báo cáo ngày", due_at: future(1), repeat: "daily", until: businessDate(new Date(Date.now() + 86400_000)) })) as { id: string };
      await pull(r.id, new Date(Date.now() - 1000));
      await runDueReminders(db());
      const after = (await rows(a1)).find((x) => x.id === r.id)!;
      expect(after.status).toBe("pending");
      expect(new Date(after.due_at).getTime()).toBeGreaterThan(Date.now());
      // Xong on a repeating reminder keeps it running.
      expect(((await a1("reminder.done", { id: r.id })) as { status: string }).status).toBe("pending");
      await a1("reminder.delete", { id: r.id });
      expect((await rows(a1)).some((x) => x.id === r.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  };
  it("a daily reminder moves to the next day and stops after its end date", () => dailyMovesOn());
  it("the same at 00:30 Vietnam time (the UTC date is still yesterday)", () => dailyMovesOn("2026-11-24T00:30:00+07:00"));

  it("snooze moves a fired reminder; on a repeating one it makes a one-off copy", async () => {
    const r = (await a1("reminder.create", { content: "Hoãn thử", due_at: future(1) })) as { id: string };
    await pull(r.id, new Date(Date.now() - 1000));
    await runDueReminders(db());
    const s = (await a1("reminder.snooze", { id: r.id, until: "1h" })) as { due_at: string; status: string };
    expect(s.status).toBe("pending");
    expect(new Date(s.due_at).getTime() - Date.now()).toBeGreaterThan(3500_000);
    const t2 = (await a1("reminder.snooze", { id: r.id, until: "tomorrow_0830" })) as { due_at: string };
    expect(new Date(t2.due_at).toISOString().slice(11, 16)).toBe("01:30");
    const rep = (await a1("reminder.create", { content: "Lặp tuần", due_at: future(2), repeat: "weekly" })) as { id: string; weekdays: number[] };
    expect(rep.weekdays).toHaveLength(1);
    const copy = (await a1("reminder.snooze", { id: rep.id, until: "1h" })) as { id: string; repeat: string };
    expect(copy.id).not.toBe(rep.id);
    expect(copy.repeat).toBe("none");
  });

  it("limits the waiting reminders per person", async () => {
    const [p] = (await db().select({ id: users.id }).from(users).where(sql`id = ${org.userB1.id}::uuid`)) as { id: string }[];
    const bulk = Array.from({ length: MAX_PENDING_REMINDERS }, (_, i) => ({ userId: p!.id, content: `r${i}`, dueAt: new Date(Date.now() + 86400_000 * 30) }));
    await db().insert(reminders).values(bulk);
    expect((await fails(b1("reminder.create", { content: "thêm", due_at: future(5) }))).details.reason).toBe("reminder_limit");
    expect(((await a2("reminder.create", { content: "người khác vẫn đặt được", due_at: future(5) })) as { id: string }).id).toBeTruthy();
  });
});


describe("row events", () => {
  const roleOf = (tableId: string, name: string, role: string) => db().execute(sql`UPDATE dh_columns SET role = ${role} WHERE /*scope:system*/ table_id = ${tableId}::uuid AND name = ${name}`);
  const setOf = (tableId: string, set: string) => db().execute(sql`UPDATE dh_tables SET role_set = ${set} WHERE /*scope:system*/ id = ${tableId}::uuid`);
  const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });

  it("tells a person added to, changed in and removed from a deal, with no share or commission in the text", async () => {
    const mgr = as(t, org.mgrA.id);
    const x = await makeTable(mgr, { columns: [{ name: "Tên công ty", type: "text" }, { name: "Người tham gia", type: "user", config: { attrs: [{ key: "ty_le_com", label: "Com", kind: "percent", default: 0 }] } }] });
    for (const p of [org.userA1, org.userA2, org.leaderA]) await mgr("datahub.share.set", { datahub_id: x.dhId, grantee_id: p.id, permission: "view" });
    await setOf(x.tableId, "deals");
    await roleOf(x.tableId, "Tên công ty", "ten_cong_ty");
    await roleOf(x.tableId, "Người tham gia", "nguoi_tham_gia");
    const row = (await mgr("datahub.row.create", { table_id: x.tableId, data: { "Tên công ty": "Thuận Phát", "Người tham gia": [person(org.userA1.id, { ty_le_com: 0.3 }), person(org.userA2.id, { ty_le_com: 0.2 })] } })) as { id: string; version: number };
    await drainOutbox(t);
    const added = (await mine(a1, NOTIFICATION_TYPES.dealParticipantAdded)).filter((n) => n.body.includes("Thuận Phát"));
    expect(added).toHaveLength(1);
    expect(added[0]!.body).not.toMatch(/%|0[.,]3/);
    expect((await mine(a2, NOTIFICATION_TYPES.dealParticipantAdded)).filter((n) => n.body.includes("Thuận Phát"))).toHaveLength(1);
    expect(await mine(as(t, org.mgrA.id), NOTIFICATION_TYPES.dealParticipantAdded)).toHaveLength(0);
    // A1's share changes, A2 leaves, the leader joins; the notice goes to each of them by what happened to them.
    await mgr("datahub.row.update", { table_id: x.tableId, row_id: row.id, version: row.version, data: { "Người tham gia": [person(org.userA1.id, { ty_le_com: 0.4 }), person(org.leaderA.id, { ty_le_com: 0.1 })] } });
    await drainOutbox(t);
    expect((await mine(a1, NOTIFICATION_TYPES.dealParticipantChanged)).filter((n) => n.body.includes("Thuận Phát"))).toHaveLength(1);
    expect((await mine(a2, NOTIFICATION_TYPES.dealParticipantRemoved)).filter((n) => n.body.includes("Thuận Phát"))).toHaveLength(1);
    expect((await mine(leader, NOTIFICATION_TYPES.dealParticipantAdded)).filter((n) => n.body.includes("Thuận Phát"))).toHaveLength(1);
    // A change to another column is not about participants.
    const before = (await mine(a1)).length;
    const cur = (await mgr("datahub.row.get", { table_id: x.tableId, row_id: row.id })) as { version: number };
    await mgr("datahub.row.update", { table_id: x.tableId, row_id: row.id, version: cur.version, data: { "Tên công ty": "Thuận Phát 2" } });
    await drainOutbox(t);
    expect(await mine(a1)).toHaveLength(before);
  });

  it("a committed KPI plan edited by the Manager is told to the person it is about, and only then", async () => {
    const mgr = as(t, org.mgrA.id);
    const x = await makeTable(mgr, { columns: [{ name: "Người", type: "user" }, { name: "KPI", type: "number" }, { name: "Trạng thái", type: "single_select", config: { options: [{ name: "Nháp" }, { name: "Đã commit", meaning: "committed" }] } }] });
    await mgr("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA1.id, permission: "view" });
    await setOf(x.tableId, "kpi");
    await roleOf(x.tableId, "Trạng thái", "trang_thai_commit");
    const keyCol = (await db().execute(sql`SELECT key FROM dh_columns WHERE /*scope:system*/ table_id = ${x.tableId}::uuid AND name = 'Người'`)).rows[0] as { key: string };
    await db().execute(sql`UPDATE dh_tables SET key_columns = ARRAY[${keyCol.key}]::text[] WHERE /*scope:system*/ id = ${x.tableId}::uuid`);
    const row = (await mgr("datahub.row.create", { table_id: x.tableId, data: { Người: org.userA1.id, KPI: 100, "Trạng thái": "Nháp" } })) as { id: string; version: number };
    const edit = async (data: Record<string, unknown>) => {
      const cur = (await mgr("datahub.row.get", { table_id: x.tableId, row_id: row.id })) as { version: number };
      await mgr("datahub.row.update", { table_id: x.tableId, row_id: row.id, version: cur.version, data });
      await drainOutbox(t);
    };
    await edit({ KPI: 150 });
    expect(await mine(a1, NOTIFICATION_TYPES.kpiEditedAfterCommit)).toHaveLength(0);
    await edit({ "Trạng thái": "Đã commit" });
    expect(await mine(a1, NOTIFICATION_TYPES.kpiEditedAfterCommit)).toHaveLength(0);
    await edit({ KPI: 200 });
    const n = await mine(a1, NOTIFICATION_TYPES.kpiEditedAfterCommit);
    expect(n).toHaveLength(1);
    expect(n[0]!.body).toContain(org.mgrA.name);
    expect(n[0]!.body).not.toMatch(/200|150/);
  });
});

describe("MCP", () => {
  const rpc = async (token: string, method: string, params: Record<string, unknown> = {}) => {
    const r = await t.app.inject({ method: "POST", url: "/mcp", headers: { authorization: `Bearer ${token}` }, payload: { jsonrpc: "2.0", id: 1, method, params } });
    return r.json().result;
  };
  it("reminder_create and notifications_list work through a connection with the Notification menu, and are hidden without it", async () => {
    const withMenu = await activeToken(t, org.userA2.id, [], { menus: { notify: "write" }, name: "co-menu" });
    const without = await activeToken(t, org.userA2.id, [], { menus: { deal: "read" }, name: "khong-menu" });
    const names = ((await rpc(withMenu.token, "tools/list")).tools as { name: string }[]).map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["reminder_create", "notifications_list"]));
    expect(((await rpc(without.token, "tools/list")).tools as { name: string }[]).map((x) => x.name)).not.toContain("reminder_create");
    const made = await rpc(withMenu.token, "tools/call", { name: "reminder_create", arguments: { content: "Từ AI", due_at: new Date(Date.now() + 7200_000).toISOString() } });
    expect(made.isError).toBeFalsy();
    expect(made.structuredContent.content).toBe("Từ AI");
    expect((await rows(a2)).some((x) => x.content === "Từ AI")).toBe(true);
    const past = await rpc(withMenu.token, "tools/call", { name: "reminder_create", arguments: { content: "Cũ", due_at: "2020-01-01T00:00" } });
    expect(past.isError).toBe(true);
    const list = await rpc(withMenu.token, "tools/call", { name: "notifications_list", arguments: { unread_only: false, limit: 5 } });
    expect(list.structuredContent.columns).toEqual(["_id", "created_at", "category", "title", "body", "read"]);
    expect(list.structuredContent.rows.length).toBeLessThanOrEqual(5);
    const blocked = await rpc(without.token, "tools/call", { name: "reminder_create", arguments: { content: "x", due_at: new Date(Date.now() + 7200_000).toISOString() } });
    expect(blocked.isError).toBe(true);
  });
  const rows = (call: ReturnType<typeof as>) => call("reminder.list", {}) as Promise<{ content: string }[]>;
});
