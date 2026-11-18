import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
let org: Org;
beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  await unlimit(t, org.userA2.id);
});
afterAll(async () => {
  await t.close();
});

describe("names (design module2 section 2)", () => {
  it("datahub names: unique per owner, case-insensitive, trimmed, accent kept", async () => {
    const a = as(t, org.userA1.id);
    const b = as(t, org.userA2.id);
    await a("datahub.datahub.create", { name: "Doanh thu" });
    for (const dup of ["doanh thu", "  Doanh thu  ", "DOANH THU"]) {
      const e = await fails(a("datahub.datahub.create", { name: dup }));
      expect(e.code).toBe("conflict");
      expect(e.message).toContain("datahub tên này");
    }
    // Vietnamese capitals and accents: "ĐƠN" equals "đơn", but "don" is another name.
    await a("datahub.datahub.create", { name: "ĐƠN HÀNG" });
    expect((await fails(a("datahub.datahub.create", { name: "đơn hàng" }))).code).toBe("conflict");
    await a("datahub.datahub.create", { name: "don hang" });
    // Another owner may use the same name.
    await b("datahub.datahub.create", { name: "Doanh thu" });
  });

  it("table and column names: unique inside their parent only", async () => {
    const a = as(t, org.userA1.id);
    const x = await makeTable(a, { columns: [{ name: "Doanh thu", type: "currency" }] });
    expect((await fails(a("datahub.table.create", { datahub_id: x.dhId, name: " bảng 1" }))).code).toBe("conflict");
    expect((await fails(a("datahub.column.create", { table_id: x.tableId, name: "doanh THU", type: "text" }))).message).toContain("cột tên này");
    const t2 = await a("datahub.table.create", { datahub_id: x.dhId, name: "Bảng 2" });
    await a("datahub.column.create", { table_id: t2.id, name: "Doanh thu", type: "text" });
    // Renaming into a taken name is refused too.
    const c = await a("datahub.column.create", { table_id: x.tableId, name: "Khác", type: "text" });
    expect((await fails(a("datahub.column.update", { table_id: x.tableId, column: c.key, name: "DOANH thu" }))).code).toBe("conflict");
    expect((await fails(a("datahub.table.update", { table_id: t2.id, name: "bảng 1" }))).code).toBe("conflict");
  });

  it("rejects [ ], empty and over-long names with a Vietnamese message", async () => {
    const a = as(t, org.userA1.id);
    for (const bad of ["Doanh [thu]", "a]", "[", "", "   ", "x".repeat(101)]) {
      const e = await fails(a("datahub.datahub.create", { name: bad }));
      expect(e.code).toBe("validation_error");
    }
    const e = await fails(a("datahub.datahub.create", { name: "Có [ngoặc]" }));
    expect(JSON.stringify(e.details)).toContain("[");
    await a("datahub.datahub.create", { name: "x".repeat(100) });
  });

  it("the database enforces it too (a direct insert cannot bypass the commands)", async () => {
    const a = as(t, org.userA1.id);
    const x = await makeTable(a, { name: "DB check" });
    const { sql } = await import("drizzle-orm");
    const db = t.c.db.db;
    await expect(db.execute(sql`INSERT INTO dh_datahubs (id, owner_id, name) VALUES (gen_random_uuid(), ${org.userA1.id}::uuid, ${"  db CHECK "})`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO dh_tables (id, datahub_id, name) VALUES (gen_random_uuid(), ${x.dhId}::uuid, ${"BẢNG 1"})`)).rejects.toThrow();
    await expect(db.execute(sql`INSERT INTO dh_datahubs (id, owner_id, name) VALUES (gen_random_uuid(), ${org.userA1.id}::uuid, ${"có ] dấu"})`)).rejects.toThrow();
  });

  it("a trashed datahub frees its name; restoring into a taken name asks for a new one", async () => {
    const a = as(t, org.userA1.id);
    const x = await makeTable(a, { name: "Tạm" });
    await a("datahub.datahub.delete", { datahub_id: x.dhId });
    await a("datahub.datahub.create", { name: "tạm" });
    const e = await fails(a("datahub.datahub.restore", { datahub_id: x.dhId }));
    expect(e.code).toBe("conflict");
    await a("datahub.datahub.restore", { datahub_id: x.dhId, name: "Tạm (khôi phục)" });
    const list = await a("datahub.datahub.list");
    expect(list.map((d: { name: string }) => d.name)).toContain("Tạm (khôi phục)");
  });
});
