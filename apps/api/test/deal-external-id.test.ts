import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { BUILTIN_DEFAULT_SET, ensureTreeTemplates } from "../src/modules/deal";
import { workerEmit } from "../src/modules/datahub/template-sync";

/**
 * Stage 4.7A: an external system names the instalments by its own code (`source` + `external_id`) in `payment.schedule` and `payment.confirm`
 * (design module4 14). Invented figures only.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
const tables: Record<string, string> = {};
const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });
const keyOf = async (table: string, name: string) => ((await mgrA("datahub.table.get", { table_id: table })).columns as { key: string; name: string }[]).find((c) => c.name === name)!.key;
const newDeal = async (name: string) =>
  (await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: { "Tên công ty": name, "Loại deal": "POD bán mới", "Start date": "2026-06-10", "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.15 })] } })).id as string;

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

describe("external id of an instalment", () => {
  it("schedule is repeatable: the same code edits the instalment it made; confirm finds the instalment by code", async () => {
    const deal = await newDeal("Công ty Mã Ngoài");
    const first = await mgrA("payment.schedule", { deal_id: deal, payments: [{ source: "bpm", external_id: "P-1", amount: 100_000_000, due: "2026-07-01" }, { source: "bpm", external_id: "P-2", amount: 50_000_000, due: "2026-08-01" }] });
    expect(first.payments.map((p: { created: boolean; external_id: string }) => [p.created, p.external_id])).toEqual([[true, "bpm:P-1"], [true, "bpm:P-2"]]);
    const again = await mgrA("payment.schedule", { deal_id: deal, payments: [{ source: "bpm", external_id: "P-1", amount: 120_000_000, due: "2026-07-05" }] });
    expect(again.payments[0]).toMatchObject({ id: first.payments[0].id, created: false, amount: 120_000_000 });
    const rows = (await mgrA("datahub.row.list", { table_id: tables["Đợt thanh toán"]!, limit: 100 })).items as { data: Record<string, unknown> }[];
    const ext = await keyOf(tables["Đợt thanh toán"]!, "Mã ngoài");
    expect(rows.map((r) => r.data[ext]).sort()).toEqual(["bpm:P-1", "bpm:P-2"]);
    await drainOutbox(t);
    const c = await mgrA("payment.confirm", { received_on: "2026-07-05", receipt: { amount: 120_000_000 }, allocations: [{ source: "bpm", external_id: "P-1", amount: 120_000_000 }] });
    expect(c.payments[0]!.id).toBe(first.payments[0].id);
    expect(c.won_deal_ids).toEqual([deal]);
  });

  it("refuses: a code twice in one call, a code of another deal, an unknown code, both or neither of id and code", async () => {
    const d1 = await newDeal("Công ty Mã A");
    const d2 = await newDeal("Công ty Mã B");
    await mgrA("payment.schedule", { deal_id: d1, payments: [{ external_id: "X-1", amount: 10_000_000, due: "2026-09-01" }] });
    expect((await fails(mgrA("payment.schedule", { deal_id: d2, payments: [{ external_id: "Y-1", amount: 1, due: "2026-09-01" }, { external_id: "Y-1", amount: 2, due: "2026-09-02" }] }))).details.reason).toBe("duplicate_external_id");
    expect((await fails(mgrA("payment.schedule", { deal_id: d2, payments: [{ external_id: "X-1", amount: 10_000_000, due: "2026-09-01" }] }))).details.reason).toBe("payment_not_of_deal");
    expect((await fails(mgrA("payment.confirm", { received_on: "2026-09-02", receipt: { amount: 1 }, allocations: [{ external_id: "Z-9", amount: 1 }] }))).details.reason).toBe("payment_not_found");
    expect((await fails(mgrA("payment.confirm", { received_on: "2026-09-02", receipt: { amount: 1 }, allocations: [{ amount: 1 }] }))).details.reason).toBe("payment_ref_required");
  });
});
