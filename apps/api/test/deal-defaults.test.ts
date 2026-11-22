import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessDate } from "@soe/shared";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { addIndexMonths, BUILTIN_DEFAULT_SET, DEAL_SETTINGS, ensureAllTrees, ensureTreeTemplates, startDealDefaultsLoop } from "../src/modules/deal";
import { workerEmit } from "../src/modules/datahub/template-sync";
import { splitLockTransferHandler } from "../src/modules/datahub/transfer";
import { OwnerIndex } from "../src/modules/datahub/computed";
import { recalcColumn } from "../src/modules/datahub/recalc";
import { vi } from "vitest";

/**
 * Stage 4.2 part 3: the default set of template tables, generated per tree (design module4 1.2, 3.1, 4, 5, 6, 9). Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2.
 * Tree B: MgrB > LeaderB > UserB1. No figure of the real commission policy is used: the rates below are invented for the test.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
let admin: ReturnType<typeof as>;
const tables: Record<string, string> = {};
const col: Record<string, Record<string, string>> = {};
const rid: Record<string, string> = {};
const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });
const tplOf = async (call: ReturnType<typeof as>, name: string) => (await call("datahub.template.list")).find((x: { name: string }) => x.name === name);

async function keys(call: ReturnType<typeof as>, table: string): Promise<Record<string, string>> {
  const r = await call("datahub.table.get", { table_id: table });
  return Object.fromEntries((r.columns as { key: string; name: string }[]).map((c) => [c.name, c.key]));
}
const cell = async (call: ReturnType<typeof as>, table: string, row: string, name: string) => (await call("datahub.row.get", { table_id: table, row_id: row })).data[col[table]?.[name] ?? (await keys(call, table))[name]!];

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.leaderB, org.mgrA, org.mgrB, org.admin]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  leaderA = as(t, org.leaderA.id);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  admin = as(t, org.admin.id);
  await ensureTreeTemplates(t.c.db.db, workerEmit(t.c.db.db), org.mgrA.id);
  await drainOutbox(t);
  for (const d of BUILTIN_DEFAULT_SET) {
    const tpl = await tplOf(mgrA, d.name);
    tables[d.name] = tpl.master_table_id;
    col[tpl.master_table_id] = await keys(mgrA, tpl.master_table_id);
  }
});
afterAll(async () => {
  await t.close();
});

describe("the set is generated for a tree", () => {
  it("makes every table of the set once, in order, as templates of the Manager's tree", async () => {
    const list = await mgrA("datahub.template.list");
    expect(list.map((x: { name: string }) => x.name)).toEqual(BUILTIN_DEFAULT_SET.map((d) => d.name));
    expect(list.every((x: { scope: string; can_edit: boolean }) => x.scope === "tree" && x.can_edit)).toBe(true);
    // Idempotent: a rerun makes nothing and doubles nothing.
    expect(await ensureTreeTemplates(t.c.db.db, workerEmit(t.c.db.db), org.mgrA.id)).toEqual([]);
    expect((await mgrA("datahub.template.list")).length).toBe(BUILTIN_DEFAULT_SET.length);
  });

  it("Deals: columns, roles and the key of the split lock come from the data, not from code", async () => {
    const d = await mgrA("datahub.table.get", { table_id: tables["Deals"]! });
    const roles = Object.fromEntries((d.columns as { name: string; role: string | null }[]).filter((c) => c.role).map((c) => [c.role, c.name]));
    expect(roles).toMatchObject({ ngay_chot: "Closing date", ngay_bat_dau: "Start date", doanh_thu: "Doanh thu", trang_thai: "Status", loai_deal: "Loại deal", nguoi_tham_gia: "Người tham gia", ma_deal: "Mã deal", ngay_du_kien_chot: "Ngày dự kiến chốt", da_thu: "Đã thu" });
    expect(d.key_split.enabled).toBe(true);
    expect(d.key_split.key_columns.map((c: { name: string }) => c.name)).toEqual(["Người tham gia"]);
    expect(d.members_bulk_create).toBe(false);
    // The cells nobody types into are not editable columns; the ones people fill are.
    const allow = Object.fromEntries((d.columns as { name: string; allow_edit: boolean }[]).map((c) => [c.name, c.allow_edit]));
    expect(allow["Tên công ty"]).toBe(true);
    expect(allow["Loại deal"]).toBe(false);
    expect(allow["Người tham gia"]).toBe(false);
    // Hidden in the default view.
    const views = await mgrA("datahub.view.list", { table_id: tables["Deals"]! });
    expect((views.views[0].config.hidden as string[]).length).toBeGreaterThan(5);
  });

  it("members get Deals, their own Index and Probation KPI; the policy tables are read-only for them", async () => {
    for (const who of [leaderA, userA1, userA2]) {
      const names = (await who("datahub.template.list")).map((x: { name: string; my_table_id: string | null }) => [x.name, !!x.my_table_id]);
      expect(Object.fromEntries(names)).toEqual({ "Tham số com": true, "Chính sách com": true, Deals: true, Index: true, "Probation KPI": true, "Tiền về": true, "Đợt thanh toán": true, "Sổ com": true, "Doanh thu theo người": true });
    }
    expect((await fails(userA1("datahub.row.create", { table_id: tables["Chính sách com"]!, data: { "Tỉ lệ": 0.5 } }))).code).toBe("forbidden");
    expect((await fails(userA1("datahub.row.create", { table_id: tables["Tham số com"]!, data: { "Giá trị": 1 } }))).code).toBe("forbidden");
    // The Admin has no business rights: no tables from the set.
    expect((await admin("datahub.template.list")).length).toBe(0);
  });

  it("the tables are protected: a person cannot rename, delete or retype them from the table pages", async () => {
    expect((await fails(mgrA("datahub.table.update", { table_id: tables["Deals"]!, name: "Của tôi" }))).details.reason).toBe("template_protected");
    // A member is not the owner: structure is not theirs at all.
    const mine = (await userA1("datahub.template.list")).find((x: { name: string }) => x.name === "Deals").my_table_id;
    expect((await fails(userA1("datahub.column.delete", { table_id: mine, column: "Status" }))).code).toBe("forbidden");
    const e1 = await fails(mgrA("datahub.column.delete", { table_id: tables["Deals"]!, column: "Status" }));
    const e2 = await fails(mgrA("datahub.column.type_change", { table_id: tables["Deals"]!, column: "Start date", type: "text" }));
    expect([e1.details.reason, e2.details.reason]).toEqual(["template_protected", "template_protected"]);
  });

  it("the datahub Quản lý Deal does not show in the datahub list", async () => {
    const list = await mgrA("datahub.datahub.list", { scope: "all" });
    expect(list.some((d: { name: string }) => d.name === "Quản lý Deal")).toBe(false);
    const asMember = await userA1("datahub.datahub.list", { scope: "all" });
    expect(asMember.some((d: { name: string }) => d.name === "Quản lý Deal")).toBe(false);
  });
});

describe("the columns that compute are Excel formulas over ordinary tables", () => {
  it("Tỉ lệ com sale looks up the policy in force at the closing (or expected) date, and the PS rate from the parameters", async () => {
    // Invented figures only.
    const pol = (d: string, src: string, lvl: string, perf: string, rate: number) => mgrA("datahub.row.create", { table_id: tables["Chính sách com"]!, data: { "Hiệu lực từ": d, "Nguồn lead": src, Level: lvl, Performance: perf, "Tỉ lệ": rate } });
    await pol("2024-01-01", "ML", "Level 3", "KPI", 0.11);
    await pol("2026-06-01", "ML", "Level 3", "KPI", 0.22);
    await pol("2026-06-01", "SH", "Level 3", "KPI", 0.33);
    await mgrA("datahub.row.create", { table_id: tables["Tham số com"]!, data: { "Hiệu lực từ": "2024-01-01", "Tên tham số": "Tỉ lệ PS POD", "Giá trị": 0.07 } });
    const mk = (name: string, data: Record<string, unknown>) =>
      mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: { "Tên công ty": name, ...data } }).then((r: { id: string }) => (rid[name] = r.id));
    const base = { "Nguồn lead": "ML", "Level BC": "Level 3", "Performance BC": "KPI" };
    await mk("old", { "Loại deal": "POD bán mới", "Start date": "2025-01-10", "Ngày dự kiến chốt": "2025-03-01", ...base, "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading" })] });
    await mk("new", { "Loại deal": "POD CSM", "Start date": "2026-06-10", "Ngày dự kiến chốt": "2026-07-01", ...base, "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading" })] });
    await mk("sh", { "Loại deal": "POD bán mới", "Start date": "2026-06-10", "Ngày dự kiến chốt": "2026-07-01", ...base, "Nguồn lead": "SH", "Người tham gia": [person(org.userA2.id, { vai_tro: "Leading" })] });
    await mk("ps", { "Loại deal": "PS kèm POD", "Start date": "2026-06-10", "Ngày dự kiến chốt": "2026-07-01", "Người tham gia": [person(org.userA2.id, { vai_tro: "Leading" })] });
    await mk("exp", { "Loại deal": "POD Express", "Start date": "2026-06-10", "Ngày dự kiến chốt": "2026-07-01", ...base, "Người tham gia": [person(org.leaderA.id, { vai_tro: "Leading" })] });
    await drainOutbox(t);
    const rate = (n: string) => cell(mgrA, tables["Deals"]!, rid[n]!, "Tỉ lệ com sale");
    expect(await rate("old")).toBeCloseTo(0.11, 9);
    expect(await rate("new")).toBeCloseTo(0.22, 9);
    expect(await rate("sh")).toBeCloseTo(0.33, 9);
    expect(await rate("ps")).toBeCloseTo(0.07, 9);
    // POD Express and Data have no policy yet: no rate (the column stays empty, nothing is guessed).
    expect([null, undefined, 0, ""]).toContain(await rate("exp"));
  });

  it("Mã deal, Nhóm dịch vụ, Doanh thu follow the status; a lone Leading gets 100% and counts as a deal", async () => {
    expect(String(await cell(mgrA, tables["Deals"]!, rid["new"]!, "Mã deal"))).toMatch(/^D-0000\d\d$/);
    expect(await cell(mgrA, tables["Deals"]!, rid["new"]!, "Nhóm dịch vụ")).toBe("POD");
    expect(await cell(mgrA, tables["Deals"]!, rid["ps"]!, "Nhóm dịch vụ")).toBe("PS");
    const p = (await cell(mgrA, tables["Deals"]!, rid["new"]!, "Người tham gia")) as { attrs: Record<string, unknown> }[];
    expect(p[0]!.attrs).toMatchObject({ vai_tro: "Leading", ty_le_dt: 1, tinh_deal: true });
    expect(await cell(userA1, tables["Deals"]!, rid["new"]!, "Vai trò của tôi")).toBe("Leading");
    expect(await cell(userA1, tables["Deals"]!, rid["new"]!, "Tính vào số deal của tôi")).toBe(true);
  });

  it("Closing date follows the status: empty while open, the day of the change for Lost, the manual date wins", async () => {
    const get = () => mgrA("datahub.row.get", { table_id: tables["Deals"]!, row_id: rid["old"]! });
    expect(await cell(mgrA, tables["Deals"]!, rid["old"]!, "Closing date")).toBeFalsy();
    const r = await get();
    await mgrA("datahub.row.update", { table_id: tables["Deals"]!, row_id: rid["old"]!, version: r.version, data: { Status: "Lost" } });
    await drainOutbox(t);
    const today = businessDate(new Date());
    expect(String(await cell(mgrA, tables["Deals"]!, rid["old"]!, "Closing date")).slice(0, 10)).toBe(today);
    const r2 = await get();
    await mgrA("datahub.row.update", { table_id: tables["Deals"]!, row_id: rid["old"]!, version: r2.version, data: { "Ngày đóng (sửa tay)": "2026-05-05" } });
    await drainOutbox(t);
    expect(String(await cell(mgrA, tables["Deals"]!, rid["old"]!, "Closing date")).slice(0, 10)).toBe("2026-05-05");
  });
});

describe("Index counts the deals of the month for the person who reads it", () => {
  it("each person has an Index copy; the counts follow what they see and count as theirs", async () => {
    const idxOf = async (call: ReturnType<typeof as>) => (await tplOf(call, "Index")).my_table_id as string;
    for (const call of [userA1, userA2, leaderA, mgrA]) await call("datahub.row.create", { table_id: await idxOf(call), data: { Tháng: "2026-06-01" } });
    await drainOutbox(t);
    const row = async (call: ReturnType<typeof as>) => {
      const id = await idxOf(call);
      const k = await keys(call, id);
      const r = (await call("datahub.row.list", { table_id: id, limit: 5 })).items[0] as { data: Record<string, unknown> };
      return (name: string) => r.data[k[name]!];
    };
    // June 2026: UserA1 leads "new" (POD CSM); UserA2 leads "sh" (POD bán mới) and "ps" (PS kèm POD).
    const a1 = await row(userA1);
    expect([a1("Nhận Tổng"), a1("Nhận POD"), a1("Nhận PS")]).toEqual([1, 1, 0]);
    const a2 = await row(userA2);
    expect([a2("Nhận Tổng"), a2("Nhận POD"), a2("Nhận PS")]).toEqual([2, 1, 1]);
    // The Leader leads "exp" (POD Express) and sees UserA1's deal; counts as their own only "exp".
    const l = await row(leaderA);
    expect([l("Nhận Tổng"), l("Nhận POD Express"), l("Nhận (team)")]).toEqual([1, 1, 2]);
    // The Manager counts no deal as their own but sees all five of the month in the tree columns (the 2025 one is not in June).
    const m = await row(mgrA);
    expect([m("Nhận Tổng"), m("Nhận (team)")]).toEqual([0, 4]);
    expect(a2("CR1")).toBe(1);
  });
});

describe("Index: the worker adds the new month", () => {
  it("fills the months after the last one up to the current month, once, and the new rows compute", async () => {
    const idx = (await tplOf(userA1, "Index")).my_table_id as string;
    const months = async () => ((await userA1("datahub.row.list", { table_id: idx, limit: 50 })).items as { data: Record<string, unknown> }[]).map((r) => r.data[col[idx]?.["Tháng"] ?? ""] ?? null);
    col[idx] = await keys(userA1, idx);
    expect((await months()).length).toBe(1);
    const added = await addIndexMonths(t.c.db.db, new Date("2026-09-05T03:00:00Z"));
    expect(added).toBeGreaterThanOrEqual(3);
    await drainOutbox(t);
    expect((await months()).sort()).toEqual(["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(await addIndexMonths(t.c.db.db, new Date("2026-09-20T03:00:00Z"))).toBe(0);
    const rows = (await userA1("datahub.row.list", { table_id: idx, limit: 50 })).items as { data: Record<string, unknown> }[];
    const july = rows.find((r) => r.data[col[idx]!["Tháng"]!] === "2026-07-01")!;
    expect(july.data[col[idx]!["Nhận Tổng"]!]).toBe(0);
  });
});

describe("trees, and the Admin's default set", () => {
  it("a Manager of another tree gets the set when the org says so; a person who is not a Manager gets nothing", async () => {
    expect(await ensureAllTrees(t.c.db.db, org.userB1.id)).toBe(0);
    // The org event alone builds nothing: the build is not in the dispatcher (it would hold up every event after it, e.g. the activation code).
    await workerEmit(t.c.db.db)("org.member.changed", { aggregateType: "user", aggregateId: org.mgrB.id, payload: { user_id: org.mgrB.id, change: "created" } });
    await drainOutbox(t);
    const countOf = async () => Number((await t.c.db.db.execute(sql`SELECT count(*) AS n FROM dh_templates WHERE /*scope:system*/ manager_id = ${org.mgrB.id}::uuid AND scope = 'tree'`)).rows[0]!.n);
    expect(await countOf()).toBe(0);
    expect(await ensureAllTrees(t.c.db.db, org.mgrB.id)).toBe(1);
    // The build asks for a template sync, so the members are shared at once.
    const ev = await t.c.db.db.execute(sql`SELECT 1 FROM outbox WHERE event = 'org.member.changed' AND status = 'pending' AND payload->>'change' = 'default_templates' AND payload->>'user_id' = ${org.mgrB.id}`);
    expect(ev.rows.length).toBe(1);
    await drainOutbox(t);
    const b = as(t, org.mgrB.id);
    expect((await b("datahub.template.list")).length).toBe(BUILTIN_DEFAULT_SET.length);
    // The two trees are separate: tree A's members do not see tree B's templates.
    expect((await as(t, org.userB1.id)("datahub.template.list")).map((x: { manager_id: string }) => x.manager_id)).toEqual(Array(BUILTIN_DEFAULT_SET.length).fill(org.mgrB.id));
  });

  it("the Admin's edit of the set only reaches trees made afterwards", async () => {
    const small = [{ ...BUILTIN_DEFAULT_SET[1]!, name: "Chỉ một bảng" }];
    const setIt = async (value: unknown) => {
      const cur = await admin("system.setting.list", { limit: 200 }).then((r) => (r.items as { key: string; version: number }[]).find((x) => x.key === DEAL_SETTINGS.defaultTemplates.key));
      await admin("system.setting.set", { key: DEAL_SETTINGS.defaultTemplates.key, value, ...(cur ? { version: cur.version } : {}) });
    };
    await setIt(small);
    // A new Manager, made here, directly in the database like the fixtures.
    const { users, orgMemberships } = await import("@soe/db");
    const [m] = await t.c.db.db.insert(users).values({ email: `mgrc.${org.tag}@base.vn`, fullName: "MgrC", roles: ["manager"], status: "active" }).returning({ id: users.id });
    await t.c.db.db.insert(orgMemberships).values({ userId: m!.id, managerId: m!.id });
    expect(await ensureAllTrees(t.c.db.db, m!.id)).toBe(1);
    const names = (await as(t, m!.id)("datahub.template.list")).map((x: { name: string }) => x.name);
    expect(names).toEqual(["Chỉ một bảng"]);
    // Tree A is untouched.
    expect((await mgrA("datahub.template.list")).length).toBe(BUILTIN_DEFAULT_SET.length);
    await setIt(BUILTIN_DEFAULT_SET);
  });
});

describe("transfer keeps the person on closed deals", () => {
  it("open deals move to the new person, deals that are won, lost or cancelled keep the old one", async () => {
    // "old" is Lost (closed) and led by UserA1; "new" is open and led by UserA1.
    await t.c.db.db.transaction(async (tx) => {
      await splitLockTransferHandler.execute(tx as never, org.userA1.id, org.userA2.id, { personal_columns: "keep" }, { userId: org.admin.id, via: "api", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: null });
    });
    await drainOutbox(t);
    const who = async (n: string) => ((await cell(mgrA, tables["Deals"]!, rid[n]!, "Người tham gia")) as { id: string }[]).map((e) => e.id);
    expect(await who("new")).toEqual([org.userA2.id]);
    expect(await who("old")).toEqual([org.userA1.id]);
  });
});

describe("a reader-scoped column is recalculated with one read of the catalog", () => {
  it("the owner's catalog loads once per column, not once per reader (this was most of the time a transfer or a tree change took)", async () => {
    const res = await t.c.db.db.execute(sql`SELECT c.id FROM dh_columns c JOIN dh_tables tb ON tb.id = c.table_id WHERE /*scope:system*/ c.reader_scoped AND c.type = 'formula' AND c.deleted_at IS NULL AND tb.id = ${tables["Deals"]!}::uuid LIMIT 1`);
    const id = (res.rows[0] as { id: string } | undefined)?.id;
    expect(id).toBeTruthy();
    const members = (await t.c.db.db.execute(sql`SELECT count(DISTINCT s.grantee_id)::int AS n FROM dh_tables tb JOIN dh_shares s ON s.datahub_id = tb.datahub_id WHERE /*scope:system*/ tb.id = ${tables["Deals"]!}::uuid`)).rows[0] as { n: number };
    expect(members.n).toBeGreaterThan(1); // several readers: the old code loaded 1 + members times
    const spy = vi.spyOn(OwnerIndex, "load");
    try {
      await recalcColumn(t.c.db.db, id!, new Date().toISOString());
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

void sql;

describe("the default-templates loop", () => {
  it("a build slower than the interval neither overlaps nor queues up; stop waits for the running one", async () => {
    let started = 0;
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const loop = startDealDefaultsLoop(t.c.db.db, t.c.logger, 10, async () => {
      started++;
      active++;
      maxActive = Math.max(maxActive, active);
      await gate;
      active--;
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(started).toBe(1);
    const stopping = loop.stop();
    release();
    await stopping;
    expect(active).toBe(0);
    expect(maxActive).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(started).toBe(1);
  });
});

describe("the cap of the % com is a column of the deal (Trần % com): PS has its own ceiling (module4 mục 9)", () => {
  const ps = (name: string, pct: number) =>
    mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: { "Tên công ty": name, "Loại deal": "PS không kèm POD", "Start date": "2026-06-10", "Ngày dự kiến chốt": "2026-07-01", "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: pct })] } }).then((r: { id: string }) => r.id);
  const settle = async () => {
    await drainOutbox(t);
    const { processPendingColumns } = await import("../src/modules/datahub");
    await processPendingColumns(t.c.db.db);
    await drainOutbox(t);
  };
  const schedule = (deal: string) => mgrA("payment.schedule", { deal_id: deal, payments: [{ legal_entity: "CT PS", amount: 90_000_000, due: "2026-07-01" }] });
  it("PS: the fund is the paid amount x Tỉ lệ PS POD, SoE gets its share; 100% passes, 120% is refused; POD keeps Tỉ lệ SoE", async () => {
    // Invented figures only.
    await mgrA("datahub.row.create", { table_id: tables["Tham số com"]!, data: { "Hiệu lực từ": "2026-01-01", "Tên tham số": "Tỉ lệ PS POD", "Giá trị": 0.25 } });
    await mgrA("datahub.row.create", { table_id: tables["Tham số com"]!, data: { "Hiệu lực từ": "2026-01-01", "Tên tham số": "Tỉ lệ SoE", "Giá trị": 0.2 } });
    await mgrA("datahub.row.create", { table_id: tables["Tham số com"]!, data: { "Hiệu lực từ": "2026-01-01", "Tên tham số": "Trần chia PS", "Giá trị": 1 } });
    const d40 = await ps("PS 40", 0.4);
    const d100 = await ps("PS 100", 1);
    await settle();
    expect(await cell(mgrA, tables["Deals"]!, d40, "Trần % com")).toBe(1);
    const s = await schedule(d40);
    await mgrA("payment.confirm", { received_on: "2026-07-02", receipt: { amount: 90_000_000 }, allocations: [{ payment_id: s.payments[0].id, amount: 90_000_000 }] });
    await settle();
    const k = await keys(mgrA, tables["Sổ com"]!);
    const lines = ((await mgrA("datahub.row.list", { table_id: tables["Sổ com"]!, limit: 200 })).items as { data: Record<string, unknown> }[]).filter((r) => (r.data[k["Deal"]!] as string[] | undefined)?.[0] === d40);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.data[k["Com"]!] as number).toBeCloseTo(9_000_000, 3);
    await schedule(d100);
    const d120 = await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: { "Tên công ty": "PS 120", "Loại deal": "PS không kèm POD", "Start date": "2026-06-10", "Ngày dự kiến chốt": "2026-07-01", "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.7 }), person(org.userA2.id, { vai_tro: "Associate", ty_le_com: 0.5 })] } }).then((r: { id: string }) => r.id).catch((e: unknown) => e);
    if (typeof d120 === "string") {
      await settle();
      expect((await fails(schedule(d120))).details?.reason).toBe("com_over_cap");
    } else expect(String((d120 as Error).message)).toMatch(/Trần % com|vượt/);
    const pod = await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: { "Tên công ty": "POD cap", "Loại deal": "POD CSM", "Start date": "2026-06-10", "Ngày dự kiến chốt": "2026-07-01", "Nguồn lead": "ML", "Level BC": "Level 3", "Performance BC": "KPI", "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.15 }), person(org.userA2.id, { vai_tro: "Associate", ty_le_com: 0.1 })] } }).then((r: { id: string }) => r.id).catch((e: unknown) => e);
    if (typeof pod === "string") {
      await settle();
      expect((await fails(schedule(pod))).details?.reason).toBe("com_over_cap");
    } else expect(String((pod as Error).message)).toMatch(/Tỉ lệ SoE|Trần % com|vượt/);
  });
});
