import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { ensureTreeTemplates, runDueRules } from "../src/modules/deal";
import { NOTIFICATION_TYPES } from "../src/modules/notification";
import { workerEmit } from "../src/modules/datahub/template-sync";
import { processPendingColumns } from "../src/modules/datahub";

/**
 * Due-date reminders in a four-column layout (Leading, Associate in separate columns, no `vai_tro` attribute), module6 6B. Own org, so the
 * ">50 rows for one person" grouping of other test files cannot touch it. Invented data only.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let a1: ReturnType<typeof as>;
let a2: ReturnType<typeof as>;
const db = () => t.c.db.db;
const mine = async (call: ReturnType<typeof as>, type: string) => ((await call("notification.list", { limit: 200 })) as { items: { type: string; body: string }[] }).items.filter((n) => n.type === type);

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.mgrA]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  a1 = as(t, org.userA1.id);
  a2 = as(t, org.userA2.id);
  await ensureTreeTemplates(db(), workerEmit(db()), org.mgrA.id);
  await drainOutbox(t);
}, 120_000);
afterAll(async () => {
  await t.close();
});

describe("deal due rules, four-column layout", () => {
  it("the person in the Leading column is told, the one in the Associate column is not (the role is read from the stored role column)", async () => {
    const list = (await mgrA("datahub.template.list")) as { id: string; name: string; master_table_id: string }[];
    const tpl = list.find((x) => x.name === "Deals")!;
    const deals = tpl.master_table_id;
    const add = (name: string) => mgrA("datahub.template.column.create", { template_id: tpl.id, name, type: "user", role: "nguoi_tham_gia" });
    await add("L4");
    await add("A4");
    await mgrA("datahub.template.column.set_role", { template_id: tpl.id, column: "Người tham gia", role: null });
    await mgrA("datahub.table.share_options.set", { table_id: deals, key_split: true, key_columns: ["L4", "A4"] });
    await mgrA("datahub.template.column.update", { template_id: tpl.id, column: "Vai trò của tôi", config: { formula: '=IF([L4]=ME(),"Leading",IF([A4]=ME(),"Associate",""))', result_type: "text" } });
    const d = await mgrA("datahub.row.create", { table_id: deals, data: { "Tên công ty": "Công ty Bố trí 4 cột", "Loại deal": "POD bán mới", "Start date": "2026-06-10", L4: org.userA1.id, A4: org.userA2.id } });
    await mgrA("payment.schedule", { deal_id: d.id, payments: [{ amount: 1_000_000, due: "2026-11-09" }] });
    await drainOutbox(t);
    await processPendingColumns(db());
    await drainOutbox(t);
    await runDueRules(db(), new Date("2026-11-10T02:00:00Z"));
    const lead = (await mine(a1, NOTIFICATION_TYPES.dealDue)).map((x) => x.body).join("\n");
    const assoc = (await mine(a2, NOTIFICATION_TYPES.dealDue)).map((x) => x.body).join("\n");
    expect(lead).toContain("Công ty Bố trí 4 cột");
    expect(assoc).not.toContain("Công ty Bố trí 4 cột");
  });
});
