import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { rowAudience } from "../src/modules/datahub/access";
import { splitLockTransferHandler } from "../src/modules/datahub/transfer";

/**
 * Stage 4.2 part 2: "Người dùng có thuộc tính" (design module4 4.5, 19 work 6): a list of people with attributes, the split lock and its GIN index over it,
 * "gửi xuống" (person cells filled by the system from the attributes), the limits on the totals. Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2 (+ GuestData).
 * Tree B: MgrB > LeaderB > UserB1.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
let userB1: ReturnType<typeof as>;
let tpl: { id: string; master_table_id: string };
const key: Record<string, string> = {};
const rid: Record<string, string> = {};

const ATTRS = [
  { key: "vai_tro", label: "Vai trò", kind: "select", options: ["Leading", "Associate", "Advisor"] },
  { key: "ty_le_dt", label: "% doanh thu", kind: "percent", default: 0, sum_max: 1 },
  { key: "ty_le_com", label: "% com", kind: "percent", default: 0, cap_param: "Tỉ lệ SoE" },
  { key: "tinh_deal", label: "Tính vào số deal", kind: "boolean", default: false },
];
const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });
const cellOf = async (call: ReturnType<typeof as>, row: string, name: string) => (await call("datahub.row.get", { table_id: tpl.master_table_id, row_id: row })).data[key[name]!];
const listNames = async (call: ReturnType<typeof as>) => ((await call("datahub.row.list", { table_id: tpl.master_table_id, limit: 100 })).items as { data: Record<string, unknown> }[]).map((i) => i.data[key["Tên"]!] as string).sort();

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.leaderB, org.mgrA, org.mgrB]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  leaderA = as(t, org.leaderA.id);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  userB1 = as(t, org.userB1.id);
  tpl = await mgrA("datahub.template.create", { name: "Deals thử", kind: "shared", member_permission: "edit_data" });
  const col = async (name: string, type: string, extra: Record<string, unknown> = {}) => {
    const c = await mgrA("datahub.template.column.create", { template_id: tpl.id, name, type, ...extra });
    key[name] = c.key;
    return c;
  };
  await col("Tên", "text");
  await col("Người tham gia", "user", { config: { attrs: ATTRS } });
  await col("Vai trò của tôi", "text", { storage: "person", autofill: { column: "Người tham gia", attr: "vai_tro" } });
  await col("% doanh thu của tôi", "percent", { storage: "person", autofill: { column: "Người tham gia", attr: "ty_le_dt" } });
  await col("% com của team", "percent", { storage: "person", autofill: { column: "Người tham gia", attr: "ty_le_com", sum: "team" } });
  await col("Tổng % com đã chia", "percent", { storage: "person", autofill: { column: "Người tham gia", attr: "ty_le_com", sum: "tree" } });
  await col("Tính vào số deal của tôi", "checkbox", { storage: "person", autofill: { column: "Người tham gia", attr: "tinh_deal" } });
  await mgrA("datahub.table.share_options.set", { table_id: tpl.master_table_id, key_split: true, key_columns: ["Người tham gia"] });
});
afterAll(async () => {
  await t.close();
});

describe("the type and its config", () => {
  it("a column with attrs checks its config: unique keys, a select needs labels, limits only on percent", async () => {
    const bad = (attrs: unknown[]) => fails(mgrA("datahub.template.column.create", { template_id: tpl.id, name: `X${Math.random()}`, type: "user", config: { attrs } }));
    expect((await bad([{ key: "a", label: "A", kind: "select" }])).code).toBe("validation_error");
    expect((await bad([{ key: "a", label: "A", kind: "boolean" }, { key: "a", label: "B", kind: "boolean" }])).code).toBe("validation_error");
    expect((await bad([{ key: "a", label: "A", kind: "boolean", sum_max: 1 }])).code).toBe("validation_error");
    expect((await bad([{ key: "A b", label: "A", kind: "boolean" }])).code).toBe("validation_error");
  });

  it("the autofill column must be person-stored and fit the attribute", async () => {
    const f = (type: string, autofill: unknown, storage = "person") => fails(mgrA("datahub.template.column.create", { template_id: tpl.id, name: `Y${Math.random()}`, type, storage, autofill }));
    expect((await f("text", { column: "Người tham gia", attr: "vai_tro" }, "shared")).details.reason).toBe("autofill_invalid");
    expect((await f("text", { column: "Người tham gia", attr: "khong_co" })).details.reason).toBe("autofill_invalid");
    expect((await f("text", { column: "Người tham gia", attr: "ty_le_dt" })).details.reason).toBe("autofill_invalid");
    expect((await f("text", { column: "Tên", attr: "vai_tro" })).details.reason).toBe("autofill_invalid");
  });
});

describe("values: validated in every channel", () => {
  it("rejects a bad label, a percent above 100%, the same person twice, a stranger to the table and an unknown attribute", async () => {
    const create = (people: unknown) => mgrA("datahub.row.create", { table_id: tpl.master_table_id, data: { Tên: "bad", "Người tham gia": people } });
    expect((await fails(create([person(org.userA1.id, { vai_tro: "Boss" })]))).code).toBe("validation_error");
    expect((await fails(create([person(org.userA1.id, { ty_le_dt: 1.5 })]))).code).toBe("validation_error");
    expect((await fails(create([person(org.userA1.id), person(org.userA1.id)]))).code).toBe("validation_error");
    expect((await fails(create([person(org.userA1.id, { x: 1 })]))).code).toBe("validation_error");
    // The total of "% doanh thu" over the people of a deal is at most 100%.
    expect((await fails(create([person(org.userA1.id, { ty_le_dt: 0.7 }), person(org.userA2.id, { ty_le_dt: 0.5 })]))).message).toContain("vượt");
    // Only members of the table: UserB1 is in the other tree.
    expect((await fails(create([person(org.userB1.id)]))).code).toBe("validation_error");
  });

  it("accepts percent as text, a bare uuid and fills the defaults", async () => {
    const r = await mgrA("datahub.row.create", { table_id: tpl.master_table_id, data: { Tên: "ok", "Người tham gia": [org.userA2.id, { id: org.userA1.id, attrs: { vai_tro: "leading", ty_le_dt: "40%" } }] } });
    const cell = (await cellOf(mgrA, r.id, "Người tham gia")) as { id: string; attrs: Record<string, unknown> }[];
    expect(cell).toEqual([
      { id: org.userA2.id, attrs: { ty_le_dt: 0, ty_le_com: 0, tinh_deal: false } },
      { id: org.userA1.id, attrs: { vai_tro: "Leading", ty_le_dt: 0.4, ty_le_com: 0, tinh_deal: false } },
    ]);
    await mgrA("datahub.row.delete", { table_id: tpl.master_table_id, row_id: r.id });
  });
});

describe("the split lock reads every person of the list (GIN index `ids`)", () => {
  it("each member sees the deals that name them or someone they manage; the other tree sees nothing", async () => {
    const mk = async (name: string, people: unknown) => {
      rid[name] = (await mgrA("datahub.row.create", { table_id: tpl.master_table_id, data: { Tên: name, "Người tham gia": people } })).id;
    };
    await mk("d1", [person(org.userA1.id, { vai_tro: "Leading", ty_le_dt: 0.6, ty_le_com: 0.1, tinh_deal: true }), person(org.userA2.id, { vai_tro: "Associate", ty_le_dt: 0.4, ty_le_com: 0.05 })]);
    await mk("d2", [person(org.userA2.id, { vai_tro: "Leading", ty_le_dt: 1, ty_le_com: 0.1, tinh_deal: true })]);
    await mk("d3", [person(org.leaderA.id, { vai_tro: "Advisor" })]);
    await drainOutbox(t);
    expect(await listNames(mgrA)).toEqual(["d1", "d2", "d3"]);
    expect(await listNames(userA1)).toEqual(["d1"]);
    expect(await listNames(userA2)).toEqual(["d1", "d2"]);
    expect(await listNames(leaderA)).toEqual(["d1", "d3"]); // d1 names UserA1, a person LeaderA manages
    expect((await fails(listNames(userB1))).code).toBe("not_found");
  });

  it("the key index is a partial GIN index on soe_dh_ids, and the filter uses the set of ids", async () => {
    const ix = await t.c.db.db.execute(sql`SELECT indexdef FROM pg_indexes WHERE indexname LIKE ${`dh_ix_%${key["Người tham gia"]}_ids`}`);
    expect(ix.rows.length).toBe(1);
    expect((ix.rows[0] as { indexdef: string }).indexdef).toMatch(/USING gin \(soe_dh_ids/);
    const f = await mgrA("datahub.row.list", { table_id: tpl.master_table_id, limit: 50, filter: JSON.stringify({ field: "Người tham gia", op: "eq", value: org.userA2.id }) });
    expect((f.items as { data: Record<string, unknown> }[]).map((i) => i.data[key["Tên"]!]).sort()).toEqual(["d1", "d2"]);
  });

  it("SSE audience: the people inside the lists of the changed rows hear of them", async () => {
    const heard = await rowAudience(t.c.db.db, tpl.master_table_id, [rid["d1"]!]);
    expect(heard).toEqual(expect.arrayContaining([org.mgrA.id, org.userA1.id, org.userA2.id, org.leaderA.id]));
    expect(heard).not.toContain(org.userB1.id);
  });
});

describe("gửi xuống: each person reads their own value, the system writes it", () => {
  it("my role, my share, my count flag", async () => {
    expect(await cellOf(userA1, rid["d1"]!, "Vai trò của tôi")).toBe("Leading");
    expect(await cellOf(userA2, rid["d1"]!, "Vai trò của tôi")).toBe("Associate");
    expect(await cellOf(userA1, rid["d1"]!, "% doanh thu của tôi")).toBe(0.6);
    expect(await cellOf(userA2, rid["d1"]!, "% doanh thu của tôi")).toBe(0.4);
    expect(await cellOf(userA1, rid["d1"]!, "Tính vào số deal của tôi")).toBe(true);
    // Associate: the attribute is false by default, which is a value, not an empty cell.
    expect(await cellOf(userA2, rid["d1"]!, "Tính vào số deal của tôi")).toBe(false);
  });

  it("a Leader gets the total of the team, a Manager the total over the tree", async () => {
    expect(await cellOf(leaderA, rid["d1"]!, "% com của team")).toBeCloseTo(0.1, 9); // UserA1 is in the team; UserA2 reports to MgrA
    expect(await cellOf(mgrA, rid["d1"]!, "Tổng % com đã chia")).toBeCloseTo(0.15, 9);
    expect(await cellOf(mgrA, rid["d2"]!, "Tổng % com đã chia")).toBeCloseTo(0.1, 9);
  });

  it("nobody types into those cells, whatever the channel", async () => {
    for (const call of [mgrA, userA1]) {
      const e = await fails(call("datahub.row.update", { table_id: tpl.master_table_id, row_id: rid["d1"]!, version: 1, data: { "Vai trò của tôi": "Advisor" } }));
      expect(["validation_error", "forbidden"]).toContain(e.code);
    }
  });

  it("changing the list refills: a person who leaves loses the value, a new one gets theirs, with no row history and no version change", async () => {
    const before = await mgrA("datahub.row.get", { table_id: tpl.master_table_id, row_id: rid["d2"]! });
    await mgrA("datahub.row.update", { table_id: tpl.master_table_id, row_id: rid["d2"]!, version: before.version, data: { "Người tham gia": [person(org.userA1.id, { vai_tro: "Advisor", ty_le_dt: 0.2 })] } });
    await drainOutbox(t);
    expect(await cellOf(userA1, rid["d2"]!, "Vai trò của tôi")).toBe("Advisor");
    expect(await listNames(userA2)).toEqual(["d1"]);
    const pc = await t.c.db.db.execute(sql`SELECT user_id FROM dh_person_cells WHERE /*scope:system*/ row_id = ${rid["d2"]!}::uuid AND data ? ${key["Vai trò của tôi"]!}`);
    expect((pc.rows as { user_id: string }[]).map((r) => r.user_id)).toEqual([org.userA1.id]);
    // Only the edit of the list is in the history: the refill is a system write.
    const h = await t.c.db.db.execute(sql`SELECT changes FROM row_history WHERE /*scope:system*/ row_id = ${rid["d2"]!}::uuid ORDER BY version`);
    expect((h.rows as { changes: { field: string }[] }[]).flatMap((r) => r.changes.map((c) => c.field)).every((f) => f === key["Người tham gia"] || f === key["Tên"])).toBe(true);
    const after = await mgrA("datahub.row.get", { table_id: tpl.master_table_id, row_id: rid["d2"]! });
    expect(after.version).toBe(before.version + 1);
  });
});

describe("the limit that comes from data: Tỉ lệ SoE in the Tham số com table of the same datahub", () => {
  let params: { master_table_id: string };
  it("with no parameter yet, nothing blocks the total of % com", async () => {
    const r = await mgrA("datahub.row.create", { table_id: tpl.master_table_id, data: { Tên: "cap0", "Người tham gia": [person(org.userA1.id, { ty_le_com: 0.6 })] } });
    await mgrA("datahub.row.delete", { table_id: tpl.master_table_id, row_id: r.id });
  });

  it("with Tỉ lệ SoE = 20% the total over the people may not exceed it, in every channel; an older version does not count", async () => {
    params = await mgrA("datahub.template.create", { name: "Tham số thử", kind: "shared", role_set: "com_params" });
    const c = async (name: string, type: string, role: string) => mgrA("datahub.template.column.create", { template_id: (await mgrA("datahub.template.list")).find((x: { name: string }) => x.name === "Tham số thử").id, name, type, role });
    await c("Hiệu lực từ", "date", "hieu_luc_tu");
    await c("Tên tham số", "text", "ten_tham_so");
    await c("Giá trị", "percent", "gia_tri");
    const row = (d: string, v: number) => mgrA("datahub.row.create", { table_id: params.master_table_id, data: { "Hiệu lực từ": d, "Tên tham số": "Tỉ lệ SoE", "Giá trị": v } });
    await row("2020-01-01", 0.1);
    await row("2024-01-01", 0.2);
    await row("2999-01-01", 0.01); // not in force yet
    const create = (a: number, b: number) => mgrA("datahub.row.create", { table_id: tpl.master_table_id, data: { Tên: "cap", "Người tham gia": [person(org.userA1.id, { ty_le_com: a }), person(org.userA2.id, { ty_le_com: b })] } });
    const e = await fails(create(0.15, 0.1));
    expect(e.code).toBe("validation_error");
    expect(e.message).toContain("Tỉ lệ SoE");
    const ok = await create(0.15, 0.05);
    await mgrA("datahub.row.delete", { table_id: tpl.master_table_id, row_id: ok.id });
  });
});

describe("transfer: the source's entry in the list becomes the target's; closed deals keep their person", () => {
  it("moves an entry inside a list and keeps the attributes; the target already in the list is not doubled", async () => {
    const mk = async (name: string, people: unknown) => (await mgrA("datahub.row.create", { table_id: tpl.master_table_id, data: { Tên: name, "Người tham gia": people } })).id;
    const a = await mk("t1", [person(org.userA2.id, { vai_tro: "Leading", ty_le_dt: 1 })]);
    const b = await mk("t2", [person(org.userA2.id, { vai_tro: "Associate" }), person(org.leaderA.id, { vai_tro: "Advisor" })]);
    await t.c.db.db.transaction(async (tx) => {
      await splitLockTransferHandler.execute(tx as never, org.userA2.id, org.leaderA.id, {}, { userId: org.admin.id, via: "api", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: null });
    });
    await drainOutbox(t);
    const ids = async (row: string) => ((await cellOf(mgrA, row, "Người tham gia")) as { id: string }[]).map((e) => e.id);
    expect(await ids(a)).toEqual([org.leaderA.id]);
    expect(((await cellOf(mgrA, a, "Người tham gia")) as { attrs: Record<string, unknown> }[])[0]!.attrs.vai_tro).toBe("Leading");
    expect(await ids(b)).toEqual([org.leaderA.id]);
    // The value each person reads follows the move.
    expect(await cellOf(leaderA, a, "Vai trò của tôi")).toBe("Leading");
  });
});
