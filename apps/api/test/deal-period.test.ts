import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessDate } from "@soe/shared";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { BUILTIN_DEFAULT_SET, ensureTreeTemplates } from "../src/modules/deal";
import { workerEmit } from "../src/modules/datahub/template-sync";
import { quarterOf, snapshotAllTrees } from "../src/modules/deal";

/** Stage 4.5A: period closing (design module4 12). Invented figures only. Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2. */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let mgrB: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let guest: ReturnType<typeof as>;
const tables: Record<string, string> = {};
const names: Record<string, Record<string, string>> = {};
const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });
const tplOf = async (call: ReturnType<typeof as>, name: string) => (await call("datahub.template.list")).find((x: { name: string }) => x.name === name);

async function row(call: ReturnType<typeof as>, table: string, id: string): Promise<Record<string, unknown>> {
  const r = await call("datahub.row.get", { table_id: table, row_id: id, labels: "true" });
  if (!names[table]) {
    const tb = await call("datahub.table.get", { table_id: table });
    names[table] = Object.fromEntries((tb.columns as { key: string; name: string }[]).map((c) => [c.key, c.name]));
  }
  return Object.fromEntries(Object.entries(r.data as Record<string, unknown>).map(([k, v]) => [names[table]![k] ?? k, v]));
}
const upd = async (call: ReturnType<typeof as>, table: string, id: string, data: Record<string, unknown>) =>
  call("datahub.row.update", { table_id: table, row_id: id, data, version: (await call("datahub.row.get", { table_id: table, row_id: id })).version });
let seq = 0;
async function newDeal(extra: Record<string, unknown> = {}, split = [0.15, 0.05]): Promise<string> {
  seq++;
  const r = await mgrA("datahub.row.create", {
    table_id: tables["Deals"]!,
    data: {
      "Tên công ty": `Công ty Kỳ ${seq}`,
      "Loại deal": "POD bán mới",
      "Start date": "2026-06-10",
      "Nguồn lead": "ML",
      "Level BC": "Level 1",
      "Performance BC": "KPI",
      "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: split[0], ty_le_dt: 0.6 }), ...(split[1] !== undefined ? [person(org.userA2.id, { vai_tro: "Associate", ty_le_com: split[1], ty_le_dt: 0.4 })] : [])],
      ...extra,
    },
  });
  return r.id as string;
}
const schedule = (deal: string, payments: Record<string, unknown>[]) => mgrA("payment.schedule", { deal_id: deal, payments });
const confirm = (payment: string, on: string, amount: number) => mgrA("payment.confirm", { received_on: on, receipt: { amount }, allocations: [{ payment_id: payment, amount }] });

let d1: string, d2: string, d3: string, d4: string;
let p1: string[], p2: string[], p4: string[];
let ledger1: string[];

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.leaderA, org.mgrA, org.mgrB]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  mgrB = as(t, org.mgrB.id);
  leaderA = as(t, org.leaderA.id);
  userA1 = as(t, org.userA1.id);
  guest = as(t, org.guestData.id);
  await ensureTreeTemplates(t.c.db.db, workerEmit(t.c.db.db), org.mgrA.id);
  await drainOutbox(t);
  for (const d of BUILTIN_DEFAULT_SET) tables[d.name] = (await tplOf(mgrA, d.name)).master_table_id;
  await mgrA("datahub.row.create", { table_id: tables["Chính sách com"]!, data: { "Hiệu lực từ": "2026-01-01", "Nguồn lead": "ML", Level: "Level 1", Performance: "KPI", "Tỉ lệ": 0.2 } });
  await mgrA("datahub.row.create", { table_id: tables["Tham số com"]!, data: { "Hiệu lực từ": "2026-01-01", "Tên tham số": "Tỉ lệ SoE", "Giá trị": 0.2 } });
  // d1: complete; d2: no Level (com blank); d3: due in June, never confirmed; d4: split 10% only (does not add to the cap)
  d1 = await newDeal();
  d2 = await newDeal({ "Level BC": null });
  d3 = await newDeal();
  d4 = await newDeal({}, [0.1]);
  p1 = (await schedule(d1, [{ amount: 100_000_000, due: "2026-07-01" }, { amount: 100_000_000, due: "2026-08-01" }])).payments.map((x: { id: string }) => x.id);
  p2 = (await schedule(d2, [{ amount: 50_000_000, due: "2026-07-01" }])).payments.map((x: { id: string }) => x.id);
  await schedule(d3, [{ amount: 10_000_000, due: "2026-06-15" }]);
  p4 = (await schedule(d4, [{ amount: 40_000_000, due: "2026-07-02" }])).payments.map((x: { id: string }) => x.id);
  ledger1 = (await confirm(p1[0]!, "2026-07-03", 100_000_000)).ledger_ids;
  await confirm(p2[0]!, "2026-07-05", 50_000_000);
  await confirm(p4[0]!, "2026-07-06", 40_000_000);
  await drainOutbox(t);
}, 120_000);
afterAll(async () => {
  await t.close();
});

describe("period.review", () => {
  it("lists what needs handling before closing, by kind, and who is not allowed", async () => {
    await mgrA("datahub.row.create", { table_id: tables["Tiền về"]!, data: { "Ngày nhận": "2026-07-09", "Số tiền (gồm VAT)": 5_000_000, "Tên đơn vị trả": "Chưa ghép" } });
    await drainOutbox(t);
    const r = await mgrA("period.review", { month: "2026-07" });
    expect(r.closed).toBe(false);
    expect(r.counts.overdue_payment).toBe(1); // d3's June instalment; the August one is not due in July
    expect(r.counts.unmatched_receipt).toBe(1);
    expect(r.counts.com_blank).toBe(2); // d2: two people, no Level BC
    expect(r.counts.com_cap_mismatch).toBe(1); // d4: 10% of 20%
    expect(r.items.find((x: { kind: string }) => x.kind === "com_cap_mismatch")).toMatchObject({ deal_id: d4, detail: { total: 0.1, cap: 0.2 } });
    for (const who of [leaderA, userA1, guest]) expect((await fails(who("period.review", { month: "2026-07" }))).code).toBe("forbidden");
    expect((await fails(mgrB("period.review", { month: "2026-07" }))).details?.reason).toBe("payment_table_missing");
  });
  it("com by person adds the month's lines and lists one person's lines", async () => {
    const r = await mgrA("period.com", { month: "2026-07", person_id: org.userA1.id });
    const a1 = r.people.find((x: { person_id: string }) => x.person_id === org.userA1.id);
    expect(a1.total).toBeCloseTo(100_000_000 * 0.2 * 0.15 + 40_000_000 * 0.2 * 0.1, 0); // d1 and d4
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.ledger_table_id).toBe(tables["Sổ com"]);
  });
});

describe("period.close and what it freezes", () => {
  it("refuses while items remain, then closes when asked to close anyway", async () => {
    const e = await fails(mgrA("period.close", { month: "2026-07" }));
    expect(e.details.reason).toBe("period_pending_items");
    expect(e.details.total).toBeGreaterThan(0);
    const c = await mgrA("period.close", { month: "2026-07", close_anyway: true });
    expect(c.lock_ids).toHaveLength(2);
    expect(c.closed_ledger_ids.length).toBe(5);
    expect(c.blank_com_ids).toHaveLength(2);
    await drainOutbox(t);
    const l = await row(mgrA, tables["Sổ com"]!, ledger1[0]!);
    expect(l["Trạng thái"]).toBe("Đã chốt");
    expect([3_000_000, 1_000_000]).toContain(l["Com cố định"]);
    expect(l["Com"]).toBe(l["Com cố định"]);
    expect((await mgrA("period.list")).map((x: { month: string }) => x.month)).toEqual(["2026-07"]);
    expect((await fails(mgrA("period.close", { month: "2026-07", close_anyway: true }))).details.reason).toBe("period_already_closed");
    expect((await mgrA("period.review", { month: "2026-07" })).closed).toBe(true);
  });

  it("the instalments, the closed lines and the deal closed in the month stay; the rest still moves", async () => {
    expect((await fails(mgrA("payment.unconfirm", { payment_ids: [p1[0]!] }))).code).toBe("period_locked");
    expect((await fails(upd(mgrA, tables["Đợt thanh toán"]!, p1[0]!, { "Số tiền về (chưa VAT)": 1 }))).code).toBe("period_locked");
    expect((await fails(upd(mgrA, tables["Sổ com"]!, ledger1[0]!, { "% com": 0.5 }))).details.reason).toBe("ledger_line_closed");
    expect((await fails(mgrA("datahub.row.delete", { table_id: tables["Sổ com"]!, row_id: ledger1[0]!, version: 1 }))).details?.reason).toBe("ledger_line_closed");
    expect((await fails(upd(mgrA, tables["Deals"]!, d1, { "Loại deal": "PS kèm POD" }))).code).toBe("period_locked");
    const share = [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.15, ty_le_dt: 0.5 }), person(org.userA2.id, { vai_tro: "Associate", ty_le_com: 0.05, ty_le_dt: 0.5 })];
    expect((await fails(upd(mgrA, tables["Deals"]!, d1, { "Người tham gia": share }))).details.reason).toBe("deal_revenue_share_in_closed_period");
    await upd(mgrA, tables["Deals"]!, d1, { "Ghi chú": "vẫn sửa được" });
    const moreCom = [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.1, ty_le_dt: 0.6 }), person(org.userA2.id, { vai_tro: "Associate", ty_le_com: 0.05, ty_le_dt: 0.4 })];
    await upd(mgrA, tables["Deals"]!, d1, { "Người tham gia": moreCom });
    // a deal not closed in July is free
    await upd(mgrA, tables["Deals"]!, d3, { "Loại deal": "POD CSM" });
  });

  it("money that arrives dated in the closed month goes to the open period as Về muộn; an adjustment too", async () => {
    const open = `${businessDate(new Date()).slice(0, 7)}-01`;
    await confirm(p1[1]!, "2026-07-20", 100_000_000);
    await drainOutbox(t);
    const dot = await row(mgrA, tables["Đợt thanh toán"]!, p1[1]!);
    expect(dot["Ngày tiền về"]).toBe("2026-07-20");
    expect(dot["Kỳ"]).toBe(open);
    expect(dot["Về muộn"]).toBe("Về muộn");
    const adj = await mgrA("commission.adjust", { payment_id: p1[0]!, person_id: org.userA1.id, amount: -200_000, reason: "Sửa sau chốt" });
    expect(adj.period).toBe(open);
    await drainOutbox(t);
    expect((await row(mgrA, tables["Sổ com"]!, adj.ledger_id))["Kỳ"]).toBe(open);
    const july = await mgrA("period.com", { month: "2026-07" });
    expect(july.people.reduce((s: number, x: { lines: number }) => s + x.lines, 0)).toBe(5); // the late line and the adjustment are in the open month, not in July
  });

  it("reopen needs a reason and a Manager; the closed lines stay fixed and the instalments move again", async () => {
    expect((await fails(mgrA("period.reopen", { month: "2026-07", reason: " " }))).code).toBe("validation_error");
    for (const who of [leaderA, userA1, guest]) expect((await fails(who("period.reopen", { month: "2026-07", reason: "x" }))).code).toBe("forbidden");
    await mgrA("period.reopen", { month: "2026-07", reason: "Sửa Closing date" });
    expect((await mgrA("period.list")).length).toBe(0);
    await upd(mgrA, tables["Đợt thanh toán"]!, p1[0]!, { "Số tiền nhận (gồm VAT)": 100_000_000 });
    expect((await fails(upd(mgrA, tables["Sổ com"]!, ledger1[0]!, { "% com": 0.5 }))).details.reason).toBe("ledger_line_closed");
    expect((await fails(mgrA("period.reopen", { month: "2026-07", reason: "x" }))).code).toBe("not_found");
  });
});

describe("forecast and snapshot", () => {
  const today = businessDate(new Date());
  const q = quarterOf(today);
  const after = new Date(Date.parse(`${q.end}T00:00:00Z`) + 40 * 86_400_000).toISOString().slice(0, 10);
  let d5: string, d6: string, d7: string;
  let p5: string[];
  let snap: { id: string; forecast: number; row_count: number };

  it("forecast has two parts: signed (instalments not yet paid, due in the range) and unsigned (open deals with no schedule)", async () => {
    d5 = await newDeal();
    d6 = await newDeal({ "Ngày dự kiến chốt": q.end, "Doanh thu dự kiến": 80_000_000 });
    d7 = await newDeal({ "Loại deal": "PS không kèm POD", "Ngày dự kiến chốt": after, "Doanh thu dự kiến": 30_000_000 });
    p5 = (await schedule(d5, [{ amount: 100_000_000, due: q.end }, { amount: 50_000_000, due: q.end }])).payments.map((x: { id: string }) => x.id);
    await drainOutbox(t);
    const f = await mgrA("deal.forecast", { from: q.start, to: q.end });
    expect(f.signed).toBeGreaterThanOrEqual(150_000_000);
    expect(f.unsigned).toBeGreaterThanOrEqual(80_000_000);
    const pod = f.by_type.find((x: { type: string }) => x.type === "POD bán mới");
    expect(pod.signed).toBeGreaterThanOrEqual(150_000_000);
    expect(f.by_type.find((x: { type: string }) => x.type === "PS không kèm POD")).toBeUndefined(); // d7 expects to close after the range
    expect(f.by_month.length).toBeGreaterThan(0);
    for (const who of [leaderA, userA1, guest]) expect((await fails(who("deal.forecast", { from: q.start, to: q.end }))).code).toBe("forbidden");
  });

  it("a snapshot copies the open deals with their forecast value; the quarterly job takes one per tree and quarter", async () => {
    snap = await mgrA("deal.snapshot.create", { note: "thử" });
    expect(snap.row_count).toBeGreaterThanOrEqual(3);
    expect(snap.forecast).toBeGreaterThanOrEqual(230_000_000);
    expect((await mgrA("deal.snapshot.list")).map((x: { id: string }) => x.id)).toContain(snap.id);
    expect(await snapshotAllTrees(t.c.db.db)).toBe(1);
    expect(await snapshotAllTrees(t.c.db.db)).toBe(0);
    expect((await mgrA("deal.snapshot.list")).filter((x: { auto: boolean }) => x.auto)).toHaveLength(1);
    expect((await fails(mgrB("deal.snapshot.create", {}))).details.reason).toBe("payment_table_missing");
    for (const who of [leaderA, userA1, guest]) expect((await fails(who("deal.snapshot.create", {}))).code).toBe("forbidden");
  });

  it("at the end of the quarter each deal is won in the quarter, slipped, lost or still open; accuracy is won revenue over the forecast", async () => {
    await confirm(p5[0]!, today, 100_000_000);
    await upd(mgrA, tables["Deals"]!, d6, { Status: "Lost" });
    await drainOutbox(t);
    const c = await mgrA("deal.snapshot.compare", { snapshot_id: snap.id });
    const g = (name: string) => c.deals.find((x: { deal_id: string }) => x.deal_id === name);
    expect(g(d5)).toMatchObject({ group: "won", forecast: 150_000_000, actual: 100_000_000 });
    expect(g(d6)).toMatchObject({ group: "lost", forecast: 80_000_000, actual: 0 });
    expect(g(d7)).toMatchObject({ group: "slipped", forecast: 0 });
    expect(c.accuracy).toBeCloseTo(c.actual / c.forecast, 6);
    expect(c.groups.find((x: { group: string }) => x.group === "won").count).toBeGreaterThanOrEqual(1);
    expect(c.by_type.length).toBeGreaterThan(0);
    expect((await fails(mgrB("deal.snapshot.compare", { snapshot_id: snap.id }))).code).toBe("not_found");
  });
});
