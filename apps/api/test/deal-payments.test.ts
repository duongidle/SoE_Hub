import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lockPeriod } from "@soe/db";
import { actorOf, as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { addIndexMonths, BUILTIN_DEFAULT_SET, DEAL_SETTINGS, ensureMissingTables, ensureTreeTemplates } from "../src/modules/deal";
import { scoreCandidates } from "../src/modules/deal/payment-match";
import { buildOpenApi } from "../src/http/openapi";
import { workerEmit } from "../src/modules/datahub/template-sync";

/**
 * Stage 4.4A: payments and commission by instalment (design module4 7). Invented figures only (no data of `examples/`).
 * Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2. Tree B: MgrB > LeaderB > UserB1.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let mgrB: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
let guest: ReturnType<typeof as>;
const tables: Record<string, string> = {};
const names: Record<string, Record<string, string>> = {};
const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });
const tplOf = async (call: ReturnType<typeof as>, name: string) => (await call("datahub.template.list")).find((x: { name: string }) => x.name === name);

async function keyNames(call: ReturnType<typeof as>, table: string): Promise<Record<string, string>> {
  const r = await call("datahub.table.get", { table_id: table });
  return Object.fromEntries((r.columns as { key: string; name: string }[]).map((c) => [c.key, c.name]));
}
/** A row by column NAME, with select values as option names. */
async function row(call: ReturnType<typeof as>, table: string, id: string): Promise<Record<string, unknown>> {
  const r = await call("datahub.row.get", { table_id: table, row_id: id, labels: "true" });
  const nm = names[table] ?? (names[table] = await keyNames(call, table));
  return Object.fromEntries(Object.entries(r.data as Record<string, unknown>).map(([k, v]) => [nm[k] ?? k, v]));
}

const upd = async (call: ReturnType<typeof as>, table: string, id: string, data: Record<string, unknown>) =>
  call("datahub.row.update", { table_id: table, row_id: id, data, version: (await call("datahub.row.get", { table_id: table, row_id: id })).version });
let dealSeq = 0;
async function newDeal(extra: Record<string, unknown> = {}): Promise<string> {
  dealSeq++;
  const r = await mgrA("datahub.row.create", {
    table_id: tables["Deals"]!,
    data: {
      "Tên công ty": `Công ty Thử Nghiệm ${dealSeq}`,
      "Loại deal": "POD bán mới",
      "Start date": "2026-06-10",
      "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.15 }), person(org.userA2.id, { vai_tro: "Associate", ty_le_com: 0.05 })],
      ...extra,
    },
  });
  return r.id as string;
}
const schedule = (deal: string, payments: Record<string, unknown>[], extra: Record<string, unknown> = {}) => mgrA("payment.schedule", { deal_id: deal, payments, ...extra });
const status = async (deal: string) => (await row(mgrA, tables["Deals"]!, deal))["Status"];

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.leaderB, org.mgrA, org.mgrB]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  mgrB = as(t, org.mgrB.id);
  leaderA = as(t, org.leaderA.id);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  guest = as(t, org.guestData.id);
  await ensureTreeTemplates(t.c.db.db, workerEmit(t.c.db.db), org.mgrA.id);
  await drainOutbox(t);
  for (const d of BUILTIN_DEFAULT_SET) tables[d.name] = (await tplOf(mgrA, d.name)).master_table_id;
});
afterAll(async () => {
  await t.close();
});

describe("the three new tables of the set", () => {
  it("are made with roles, links and the split lock; Deals rolls its payments up", async () => {
    const dots = await mgrA("datahub.table.get", { table_id: tables["Đợt thanh toán"]! });
    const roles = Object.fromEntries((dots.columns as { name: string; role: string | null; type: string }[]).filter((c) => c.role).map((c) => [c.role, c.type]));
    expect(roles).toMatchObject({ deal: "relation", han: "date", so_tien_ve: "currency", ky: "formula", chia_com_dot: "user" });
    expect(dots.key_split.key_columns.map((c: { name: string }) => c.name)).toEqual(["Người tham gia"]);
    const deals = await mgrA("datahub.table.get", { table_id: tables["Deals"]! });
    const types = Object.fromEntries((deals.columns as { name: string; type: string }[]).map((c) => [c.name, c.type]));
    expect(types["Đã thu"]).toBe("rollup");
    expect(types["Ngày tiền về đầu tiên"]).toBe("rollup");
    const ledger = await mgrA("datahub.table.get", { table_id: tables["Sổ com"]! });
    expect(ledger.key_split.key_columns.map((c: { name: string }) => c.name)).toEqual(["Người"]);
  });

  it("a tree that already runs gets the tables it lacks, once (idempotent), and keeps the ones it has", async () => {
    // Tree B starts with only the two policy tables (as a tree built before 4.4 would have fewer tables).
    const old = BUILTIN_DEFAULT_SET.filter((d) => ["Tham số com", "Chính sách com"].includes(d.name));
    await ensureTreeTemplates(t.c.db.db, workerEmit(t.c.db.db), org.mgrB.id, old);
    await drainOutbox(t);
    expect((await mgrB("datahub.template.list")).map((x: { name: string }) => x.name)).toEqual(["Tham số com", "Chính sách com"]);
    expect(await ensureMissingTables(t.c.db.db, org.mgrB.id)).toBe(1);
    await drainOutbox(t);
    const list = (await mgrB("datahub.template.list")).map((x: { name: string }) => x.name);
    expect([...list].sort()).toEqual(BUILTIN_DEFAULT_SET.map((d) => d.name).sort());
    expect(await ensureMissingTables(t.c.db.db, org.mgrB.id)).toBe(0);
    expect(DEAL_SETTINGS.defaultTemplates.key).toBe("deal.default_templates");
  });
});

describe("payment.schedule", () => {
  it("makes the schedule in one call, links both ways, copies the people, and edits only what has not arrived", async () => {
    const deal = await newDeal();
    const r = await schedule(deal, [
      { legal_entity: "Công ty TNHH Alpha", contract_no: "HD-01", amount: 100_000_000, due: "2026-07-01" },
      { legal_entity: "Công ty TNHH Alpha", contract_no: "HD-01", amount: 50_000_000, due: "2026-08-01" },
    ]);
    expect(r.payments.map((p: { seq: number }) => p.seq)).toEqual([1, 2]);
    await drainOutbox(t);
    const first = await row(mgrA, tables["Đợt thanh toán"]!, r.payments[0].id);
    expect(first["Số tiền dự kiến (chưa VAT)"]).toBe(100_000_000);
    expect((first["Người tham gia"] as { id: string }[]).map((p) => p.id).sort()).toEqual([org.userA1.id, org.userA2.id].sort());
    expect(first["Deal"]).toHaveLength(1);
    expect(first["Nguồn nhập"]).toBe("API");
    expect(((await row(mgrA, tables["Deals"]!, deal))["Đợt thanh toán"] as unknown[]).length).toBe(2);
    // The member sees the instalments of their own deal only.
    expect((await userA1("datahub.row.list", { table_id: (await tplOf(userA1, "Đợt thanh toán")).my_table_id, limit: 50 })).items.length).toBeGreaterThanOrEqual(2);
    // Edit one, remove one, add one.
    const r2 = await schedule(deal, [{ id: r.payments[0].id, amount: 90_000_000, due: "2026-07-05" }, { amount: 10_000_000, due: "2026-09-01" }], { remove_ids: [r.payments[1].id] });
    expect(r2.removed).toEqual([r.payments[1].id]);
    expect(r2.payments[1]).toMatchObject({ seq: 3, created: true });
    await drainOutbox(t);
    expect(((await row(mgrA, tables["Deals"]!, deal))["Đợt thanh toán"] as unknown[]).length).toBe(2);
    expect((await row(mgrA, tables["Đợt thanh toán"]!, r.payments[0].id))["Hạn"]).toBe("2026-07-05");
  });

  it("refuses a payment that is not of the deal, a closed deal, and anyone but a Manager", async () => {
    const deal = await newDeal();
    const other = await newDeal();
    const o = await schedule(other, [{ amount: 1_000_000, due: "2026-07-01" }]);
    expect((await fails(schedule(deal, [{ id: o.payments[0].id, amount: 5, due: "2026-07-01" }]))).details.reason).toBe("payment_not_of_deal");
    const closed = await newDeal();
    await upd(mgrA, tables["Deals"]!, closed, { Status: "Lost" });
    expect((await fails(schedule(closed, [{ amount: 1, due: "2026-07-01" }]))).details.reason).toBe("deal_closed");
    for (const who of [leaderA, userA1, userA2, guest]) expect((await fails(who("payment.schedule", { deal_id: deal, payments: [] }))).code).toBe("forbidden");
  });

  it("the other tree's Manager cannot reach a deal of this tree", async () => {
    const deal = await newDeal();
    expect((await fails(mgrB("payment.schedule", { deal_id: deal, payments: [] }))).code).toBe("not_found");
  });
});

describe("payment.confirm and unconfirm", () => {
  it("the first instalment makes the deal Won and writes the commission lines; the second does not touch the status", async () => {
    const deal = await newDeal();
    const s = await schedule(deal, [
      { legal_entity: "Công ty TNHH Beta", amount: 100_000_000, due: "2026-07-01" },
      { legal_entity: "Công ty TNHH Beta", amount: 100_000_000, due: "2026-08-01" },
    ]);
    expect(await status(deal)).toBe("Processing");
    const c = await mgrA("payment.confirm", {
      received_on: "2026-07-03",
      receipt: { amount: 108_000_000, payer_name: "CT TNHH Beta", account_no: "0011223344", bank: "VCB", content: "TT dot 1" },
      allocations: [{ payment_id: s.payments[0].id, amount: 100_000_000, amount_received: 108_000_000 }],
    });
    expect(c.won_deal_ids).toEqual([deal]);
    expect(c.ledger_ids).toHaveLength(2);
    await drainOutbox(t);
    expect(await status(deal)).toBe("Won");
    const dealRow = await row(mgrA, tables["Deals"]!, deal);
    expect(dealRow["Đã thu"]).toBe(100_000_000);
    expect(dealRow["Ngày tiền về đầu tiên"]).toBe("2026-07-03");
    expect(dealRow["Closing date"]).toBe("2026-07-03");
    const lines = await Promise.all(c.ledger_ids.map((id: string) => row(mgrA, tables["Sổ com"]!, id)));
    expect(lines.map((l) => l["% com"]).sort()).toEqual([0.05, 0.15]);
    expect(lines.every((l) => l["Trạng thái"] === "Tạm tính")).toBe(true);
    expect(lines.every((l) => l["Số tiền về"] === 100_000_000)).toBe(true);
    const dot = await row(mgrA, tables["Đợt thanh toán"]!, s.payments[0].id);
    expect(dot["Trạng thái"]).toBe("Đã về");
    expect(dot["Kỳ"]).toBe("2026-07-01");
    const rec = await row(mgrA, tables["Tiền về"]!, c.receipt_id);
    expect(rec["Trạng thái"]).toBe("Đã ghép");
    // A second instalment: no new Won, a second pair of lines.
    const c2 = await mgrA("payment.confirm", { received_on: "2026-08-02", receipt: { amount: 100_000_000 }, allocations: [{ payment_id: s.payments[1].id, amount: 100_000_000 }] });
    expect(c2.won_deal_ids).toEqual([]);
    expect(c2.ledger_ids).toHaveLength(2);
    // Already confirmed.
    expect((await fails(mgrA("payment.confirm", { received_on: "2026-08-03", receipt: { amount: 1 }, allocations: [{ payment_id: s.payments[1].id, amount: 1 }] }))).details.reason).toBe("payment_already_confirmed");
  });

  it("checks that the allocations add up to the receipt, splits a short payment (or keeps it), and splits one receipt over two instalments", async () => {
    const deal = await newDeal();
    const s = await schedule(deal, [{ amount: 100_000_000, due: "2026-07-01" }, { amount: 40_000_000, due: "2026-08-01" }, { amount: 30_000_000, due: "2026-09-01" }]);
    const [a, b, c] = s.payments.map((p: { id: string }) => p.id);
    expect((await fails(mgrA("payment.confirm", { received_on: "2026-07-03", receipt: { amount: 99 }, allocations: [{ payment_id: a, amount: 100 }] }))).details.reason).toBe("allocation_sum_mismatch");
    // Short: 60 of 100 comes, the rest becomes a new instalment with the same due date.
    const r = await mgrA("payment.confirm", { received_on: "2026-07-03", receipt: { amount: 60_000_000 }, allocations: [{ payment_id: a, amount: 60_000_000 }] });
    expect(r.payments[0].split_off_id).not.toBeNull();
    await drainOutbox(t);
    const off = await row(mgrA, tables["Đợt thanh toán"]!, r.payments[0].split_off_id);
    expect(off["Số tiền dự kiến (chưa VAT)"]).toBe(40_000_000);
    expect(off["Hạn"]).toBe("2026-07-01");
    expect((await row(mgrA, tables["Đợt thanh toán"]!, a))["Trạng thái"]).toBe("Đã về");
    // Keep: stays "Về thiếu".
    const k = await mgrA("payment.confirm", { received_on: "2026-08-03", receipt: { amount: 10_000_000 }, allocations: [{ payment_id: b, amount: 10_000_000, shortfall: "keep" }] });
    expect(k.payments[0].split_off_id).toBeNull();
    await drainOutbox(t);
    expect((await row(mgrA, tables["Đợt thanh toán"]!, b))["Trạng thái"]).toBe("Về thiếu");
    // One transfer for two instalments (the remaining one of 40 and the third one of 30).
    const m = await mgrA("payment.confirm", { received_on: "2026-09-02", receipt: { amount: 70_000_000, payer_name: "Gộp" }, allocations: [{ payment_id: r.payments[0].split_off_id, amount: 40_000_000 }, { payment_id: c, amount: 30_000_000 }] });
    await drainOutbox(t);
    expect(((await row(mgrA, tables["Tiền về"]!, m.receipt_id))["Đợt"] as unknown[]).length).toBe(2);
  });

  it("an existing receipt (Tiền về chưa ghép) can be matched later; a closed deal refuses", async () => {
    const deal = await newDeal();
    const s = await schedule(deal, [{ amount: 10_000_000, due: "2026-07-01" }]);
    const rc = await mgrA("datahub.row.create", { table_id: tables["Tiền về"]!, data: { "Ngày nhận": "2026-07-02", "Số tiền (gồm VAT)": 10_800_000, "Tên đơn vị trả": "Ai đó" } });
    await drainOutbox(t);
    expect((await row(mgrA, tables["Tiền về"]!, rc.id))["Trạng thái"]).toBe("Chưa ghép");
    const r = await mgrA("payment.confirm", { received_on: "2026-07-02", receipt: { id: rc.id }, allocations: [{ payment_id: s.payments[0].id, amount: 10_000_000, amount_received: 10_800_000 }] });
    expect(r.receipt_id).toBe(rc.id);
    await drainOutbox(t);
    expect((await row(mgrA, tables["Tiền về"]!, rc.id))["Trạng thái"]).toBe("Đã ghép");
    const lost = await newDeal();
    const s2 = await schedule(lost, [{ amount: 1_000_000, due: "2026-07-01" }]);
    await upd(mgrA, tables["Deals"]!, lost, { Status: "Lost" });
    expect((await fails(mgrA("payment.confirm", { received_on: "2026-07-02", receipt: { amount: 1_000_000 }, allocations: [{ payment_id: s2.payments[0].id, amount: 1_000_000 }] }))).details.reason).toBe("deal_closed");
  });

  it("unconfirm clears the instalment, drops the tentative lines and reopens a deal with nothing left; a locked month refuses", async () => {
    const deal = await newDeal();
    const s = await schedule(deal, [{ amount: 50_000_000, due: "2026-07-01" }]);
    const c = await mgrA("payment.confirm", { received_on: "2026-07-10", receipt: { amount: 50_000_000 }, allocations: [{ payment_id: s.payments[0].id, amount: 50_000_000 }] });
    await drainOutbox(t);
    expect(await status(deal)).toBe("Won");
    // A locked month refuses.
    const lock = await lockPeriod(t.c.db.db, { tableId: tables["Đợt thanh toán"]!, scope: org.mgrA.id, periodStart: "2026-07-01", periodEnd: "2026-07-31", actor: actorOf(org.mgrA.id) });
    expect((await fails(mgrA("payment.unconfirm", { payment_ids: [s.payments[0].id] }))).code).toBe("period_locked");
    await t.c.db.db.execute(sql`UPDATE period_locks SET unlocked_at = now() WHERE id = ${lock!.id}::uuid`);
    const u = await mgrA("payment.unconfirm", { payment_ids: [s.payments[0].id] });
    expect(u.reopened_deal_ids).toEqual([deal]);
    expect(u.removed_ledger_ids.sort()).toEqual([...c.ledger_ids].sort());
    await drainOutbox(t);
    expect(await status(deal)).toBe("Processing");
    expect((await row(mgrA, tables["Đợt thanh toán"]!, s.payments[0].id))["Ngày tiền về"] ?? null).toBeNull();
    expect((await row(mgrA, tables["Tiền về"]!, c.receipt_id))["Trạng thái"]).toBe("Chưa ghép");
    expect((await fails(mgrA("payment.unconfirm", { payment_ids: [s.payments[0].id] }))).details.reason).toBe("payment_not_confirmed");
  });

  it("only a Manager confirms; the member does not see the other people's commission", async () => {
    const deal = await newDeal();
    const s = await schedule(deal, [{ amount: 10_000_000, due: "2026-07-01" }]);
    for (const who of [leaderA, userA1, userA2, guest]) expect((await fails(who("payment.confirm", { received_on: "2026-07-02", receipt: { amount: 1 }, allocations: [{ payment_id: s.payments[0].id, amount: 1 }] }))).code).toBe("forbidden");
    expect((await fails(mgrB("payment.confirm", { received_on: "2026-07-02", receipt: { amount: 1 }, allocations: [{ payment_id: s.payments[0].id, amount: 1 }] }))).code).toBe("not_found");
    await mgrA("payment.confirm", { received_on: "2026-07-02", receipt: { amount: 10_000_000 }, allocations: [{ payment_id: s.payments[0].id, amount: 10_000_000 }] });
    await drainOutbox(t);
    const mine = (await tplOf(userA1, "Sổ com")).my_table_id as string;
    const seen = (await userA1("datahub.row.list", { table_id: mine, limit: 200 })).items as { data: Record<string, unknown> }[];
    const nm = await keyNames(userA1, mine);
    const owners = seen.flatMap((r) => Object.entries(r.data).filter(([k]) => nm[k] === "Người").map(([, v]) => v));
    expect(owners.length).toBeGreaterThan(0);
    expect(owners.every((v) => v === org.userA1.id)).toBe(true);
    const tienVe = (await tplOf(userA1, "Tiền về")).my_table_id as string;
    expect((await userA1("datahub.row.list", { table_id: tienVe, limit: 50 })).items).toHaveLength(0);
  });
});

describe("commission.adjust", () => {
  it("adds a fixed Điều chỉnh line with a reason (may be negative); needs the reason and a Manager", async () => {
    const deal = await newDeal();
    const s = await schedule(deal, [{ amount: 10_000_000, due: "2026-07-01" }]);
    const r = await mgrA("commission.adjust", { payment_id: s.payments[0].id, person_id: org.userA1.id, amount: -500_000, reason: "Nhập sai tỉ lệ" });
    await drainOutbox(t);
    const line = await row(mgrA, tables["Sổ com"]!, r.ledger_id);
    expect(line).toMatchObject({ "Trạng thái": "Điều chỉnh", "Com cố định": -500_000, "Lý do": "Nhập sai tỉ lệ", Com: -500_000 });
    expect((await fails(mgrA("commission.adjust", { payment_id: s.payments[0].id, person_id: org.userA1.id, amount: 1, reason: "  " }))).code).toBe("validation_error");
    expect((await fails(userA1("commission.adjust", { payment_id: s.payments[0].id, person_id: org.userA1.id, amount: 1, reason: "x" }))).code).toBe("forbidden");
  });
});

describe("payment.match_candidates", () => {
  it("ranks the unconfirmed instalments with reasons; a remembered account and VAT make one strong", async () => {
    const d1 = await newDeal({ "Tên công ty": "Gamma Software" });
    const d2 = await newDeal({ "Tên công ty": "Delta Retail" });
    const s1 = await schedule(d1, [{ legal_entity: "Công ty Cổ phần Gamma", tax_code: "0312345678", contract_no: "GM-2026-07", amount: 100_000_000, due: "2026-07-10" }, { legal_entity: "Công ty Cổ phần Gamma", amount: 100_000_000, due: "2026-08-10" }]);
    const s2 = await schedule(d2, [{ legal_entity: "Delta Retail JSC", amount: 100_000_000, due: "2026-07-12" }]);
    // The first transfer of Gamma is matched by hand: it is remembered afterwards.
    await mgrA("payment.confirm", { received_on: "2026-07-09", receipt: { amount: 100_000_000, payer_name: "GAMMA SOFTWARE JSC", account_no: "9988776655" }, allocations: [{ payment_id: s1.payments[0].id, amount: 100_000_000 }] });
    await drainOutbox(t);
    const m = await mgrA("payment.match_candidates", { amount: 108_000_000, payer_name: "Cong ty CP Gamma", account_no: "99887 76655", received_on: "2026-08-09" });
    expect(m[0]).toMatchObject({ payment_id: s1.payments[1].id, strong: true });
    expect(m[0].reasons.join(" | ")).toContain("số tài khoản đã ghép trước");
    expect(m[0].reasons.join(" | ")).toContain("VAT 8%");
    expect(m.map((x: { payment_id: string }) => x.payment_id)).not.toContain(s1.payments[0].id);
    expect(m.find((x: { payment_id: string }) => x.payment_id === s2.payments[0].id)?.strong ?? false).toBe(false);
    for (const who of [leaderA, userA1, guest]) expect((await fails(who("payment.match_candidates", { amount: 1 }))).code).toBe("forbidden");
  });

  it("the scoring is a pure fixed rule: tax code, contract number in the content, similar name, amount with VAT", () => {
    const f = { id: "p1", dealId: "d1", dealName: "Zeta Co", legalEntity: "Công ty TNHH Zeta", taxCode: "0100", contractNo: "ZT-77", seq: 1, planned: 200, due: "2026-07-10" };
    const none = { accountDeals: new Set<string>(), payerDeals: new Set<string>() };
    const r = scoreCandidates({ amount: 210, payer_name: "ZETA", tax_code: "0100", content: "TT HD zt-77", received_on: "2026-07-12" }, [f], none);
    expect(r[0]!.strong).toBe(true);
    expect(r[0]!.reasons.join("|")).toContain("VAT 5%");
    expect(scoreCandidates({ amount: 999 }, [f], none)).toEqual([]);
  });
});

describe("guards that follow the meaning of the option", () => {
  it("Won is only set by the system (not by a member, not by the Manager by hand); Huỷ only by the Manager", async () => {
    const deal = await newDeal();
    const mine = (await tplOf(userA1, "Deals")).my_table_id as string;
    expect((await fails(upd(userA1, mine, deal, { Status: "Won" }))).details.reason).toBe("status_won_system_only");
    expect((await fails(upd(mgrA, tables["Deals"]!, deal, { Status: "Won" }))).details.reason).toBe("status_won_system_only");
    expect((await fails(upd(userA1, mine, deal, { Status: "Huỷ" }))).details.reason).toBe("status_cancel_manager_only");
    await upd(mgrA, tables["Deals"]!, deal, { Status: "Huỷ" });
    expect(await status(deal)).toBe("Huỷ");
    // A member still moves a deal between the open and the other closed statuses.
    const d2 = await newDeal();
    await upd(userA1, mine, d2, { Status: "Pending" });
    await upd(userA1, mine, d2, { Status: "Lost" });
    // A Won deal cannot be taken out of Won by hand either.
    const d3 = await newDeal();
    const s = await schedule(d3, [{ amount: 1_000_000, due: "2026-07-01" }]);
    await mgrA("payment.confirm", { received_on: "2026-07-02", receipt: { amount: 1_000_000 }, allocations: [{ payment_id: s.payments[0].id, amount: 1_000_000 }] });
    expect((await fails(upd(mgrA, tables["Deals"]!, d3, { Status: "Processing" }))).details.reason).toBe("status_won_system_only");
  });

  it("a committed Probation KPI plan: the person cannot change it, the Manager can with a reason", async () => {
    const mine = (await tplOf(userA1, "Probation KPI")).my_table_id as string;
    const r = await userA1("datahub.row.create", { table_id: mine, data: { Năm: 2026, "KPI Software": 100, "Trạng thái": "Nháp" } });
    await upd(userA1, mine, r.id, { "KPI Software": 120 });
    await upd(userA1, mine, r.id, { "Trạng thái": "Đã commit" });
    expect((await fails(upd(userA1, mine, r.id, { "KPI Software": 999 }))).details.reason).toBe("plan_committed_manager_only");
    expect((await fails(upd(mgrA, tables["Probation KPI"]!, r.id, { "KPI Software": 150 }))).details.reason).toBe("plan_committed_reason_required");
    await upd(mgrA, tables["Probation KPI"]!, r.id, { "KPI Software": 150, "Lý do sửa sau commit": "Điều chỉnh chỉ tiêu quý" });
    expect((await row(mgrA, tables["Probation KPI"]!, r.id))["KPI Software"]).toBe(150);
  });
});

describe("Index months", () => {
  it("a new Index starts at the month of the earliest Start date among the Deals of its tree, not at the current month", async () => {
    await newDeal({ "Start date": "2026-03-15" });
    await addIndexMonths(t.c.db.db, new Date("2026-05-10T03:00:00Z"));
    await drainOutbox(t);
    const mine = (await tplOf(userA1, "Index")).my_table_id as string;
    const nm = await keyNames(userA1, mine);
    const months = ((await userA1("datahub.row.list", { table_id: mine, limit: 50 })).items as { data: Record<string, unknown> }[]).map((r) => Object.entries(r.data).find(([k]) => nm[k] === "Tháng")![1]).sort();
    expect(months).toEqual(["2026-03-01", "2026-04-01", "2026-05-01"]);
  });
});

describe("OpenAPI", () => {
  it("the commands are in the generated OpenAPI (the Bruno requests are checked by openapi.test.ts)", () => {
    const paths = Object.keys((buildOpenApi(t.c.registry, "http://localhost:3000") as unknown as { paths: Record<string, unknown> }).paths);
    for (const p of ["/deal/payments/schedule", "/deal/payments/confirm", "/deal/payments/unconfirm", "/deal/commission/adjust", "/deal/payments/match"]) expect(paths).toContain("/api/v1" + p);
  });
});
