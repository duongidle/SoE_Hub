import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { BUILTIN_DEFAULT_SET, ensureTreeTemplates } from "../src/modules/deal";
import { workerEmit } from "../src/modules/datahub/template-sync";

/**
 * Stage 4.7A: old money brought in by an import (instalments with a received date, never confirmed) is confirmed when the period is closed
 * (`period.close` with `confirm_received`); an instalment that already has a ledger line (old commission as `Com cố định`, `Đã chốt`) gets no new line.
 * Invented figures only. Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
const tables: Record<string, string> = {};
const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });
const names = async (table: string) => Object.fromEntries(((await mgrA("datahub.table.get", { table_id: table })).columns as { key: string; name: string }[]).map((c) => [c.name, c.key]));
const rowsOf = async (table: string) => {
  const nm = await names(table);
  const by = Object.fromEntries(Object.entries(nm).map(([n, k]) => [k, n]));
  return ((await mgrA("datahub.row.list", { table_id: table, limit: 200, labels: "true" })).items as { id: string; data: Record<string, unknown> }[]).map((r) => ({ id: r.id, ...Object.fromEntries(Object.entries(r.data).map(([k, v]) => [by[k] ?? k, v])) })) as Record<string, unknown>[];
};
const settle = async () => {
  await drainOutbox(t);
};

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.mgrA]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  await ensureTreeTemplates(t.c.db.db, workerEmit(t.c.db.db), org.mgrA.id);
  await drainOutbox(t);
  const list = await mgrA("datahub.template.list");
  for (const d of BUILTIN_DEFAULT_SET) tables[d.name] = list.find((x: { name: string }) => x.name === d.name).master_table_id;
  await mgrA("datahub.row.create", { table_id: tables["Chính sách com"]!, data: { "Hiệu lực từ": "2026-01-01", "Nguồn lead": "ML", Level: "Level 1", Performance: "KPI", "Tỉ lệ": 0.2 } });
  await mgrA("datahub.row.create", { table_id: tables["Tham số com"]!, data: { "Hiệu lực từ": "2026-01-01", "Tên tham số": "Tỉ lệ SoE", "Giá trị": 0.5 } });
});
afterAll(async () => {
  await t.close();
});

describe("close a period with imported, never confirmed money", () => {
  it("confirms the instalments in one batch, keeps old ledger lines as they are, makes revenue by person, then closes", async () => {
    const deals: string[] = [];
    const dots: string[] = [];
    for (const n of [1, 2, 3]) {
      const d = await mgrA("datahub.row.create", {
        table_id: tables["Deals"]!,
        data: { "Tên công ty": `Công ty Cũ ${n}`, "Loại deal": "POD bán mới", "Start date": "2026-01-10", "Nguồn lead": "ML", "Level BC": "Level 1", "Performance BC": "KPI", "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.15, ty_le_dt: 0.6 }), person(org.userA2.id, { vai_tro: "Associate", ty_le_com: 0.05, ty_le_dt: 0.4 })] },
      });
      deals.push(d.id);
      // As an import writes it: the link, the amounts and the received date, no Tiền về.
      const p = await mgrA("datahub.row.create", { table_id: tables["Đợt thanh toán"]!, data: { Deal: [d.id], "Đợt số": 1, "Số tiền dự kiến (chưa VAT)": 100_000_000, Hạn: "2026-03-05", "Ngày tiền về": "2026-03-10", "Số tiền về (chưa VAT)": 100_000_000 } });
      dots.push(p.id);
    }
    // Deal 3 has its old commission already, imported as a closed fixed value.
    const old = await mgrA("datahub.row.create", { table_id: tables["Sổ com"]!, data: { Người: org.userA1.id, Đợt: [dots[2]], Deal: [deals[2]], "Com cố định": 1_234_000, "% com": 0.15, "Trạng thái": "Đã chốt" } });
    expect(old.id).toBeTruthy();
    await settle();

    const before = await mgrA("period.review", { month: "2026-03" });
    expect(before.counts.received_unconfirmed).toBe(3);

    const done = await mgrA("period.confirm_received", { month: "2026-03" });
    expect(done).toMatchObject({ payments: 3, skipped_ledger: 1 });
    expect(done.won_deal_ids).toHaveLength(3);
    await settle();
    // A second call finds nothing left to confirm.
    expect((await mgrA("period.confirm_received", { month: "2026-03" })).payments).toBe(0);
    expect((await mgrA("period.review", { month: "2026-03" })).counts.received_unconfirmed).toBeUndefined();
    await mgrA("period.close", { month: "2026-03", close_anyway: true });
    await settle();
    expect((await fails(mgrA("period.confirm_received", { month: "2026-03" }))).details.reason).toBe("period_already_closed");

    // Every instalment is confirmed now: Tiền về linked.
    const dotRows = await rowsOf(tables["Đợt thanh toán"]!);
    expect(dotRows.filter((r) => Array.isArray(r["Tiền về"]) && (r["Tiền về"] as unknown[]).length === 1)).toHaveLength(3);
    // Deals are Won.
    const dealRows = await rowsOf(tables["Deals"]!);
    expect(dealRows.map((r) => r["Status"])).toEqual(["Won", "Won", "Won"]);
    // Ledger: deals 1 and 2 got a line per person with a share (closed by the close); deal 3 keeps only its old line.
    const ledger = await rowsOf(tables["Sổ com"]!);
    const of = (deal: string) => ledger.filter((r) => (r["Deal"] as string[] | undefined)?.[0] === deal);
    expect(of(deals[0]!)).toHaveLength(2);
    expect(of(deals[1]!)).toHaveLength(2);
    expect(of(deals[2]!)).toHaveLength(1);
    expect(of(deals[2]!)[0]!["Com cố định"]).toBe(1_234_000);
    for (const r of [...of(deals[0]!), ...of(deals[1]!)]) expect(r["Trạng thái"]).toBe("Đã chốt");
    // Revenue by person for every instalment, the one with old commission included.
    const revenue = await rowsOf(tables["Doanh thu theo người"]!);
    expect(revenue).toHaveLength(6);
    // The period is closed.
    expect((await mgrA("period.list", {})).map((x: { month: string }) => x.month)).toContain("2026-03");
  });
});
