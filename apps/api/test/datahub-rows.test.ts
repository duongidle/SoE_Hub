import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
});
afterAll(async () => {
  await t.close();
});

describe("rows: create, update, delete, batch, upsert", () => {
  it("creates with row numbers, version 1, standard columns; reads, lists and selects fields", async () => {
    const x = await makeTable(a, { columns: [{ name: "Tên", type: "text" }, { name: "Tiền", type: "currency" }] });
    const r1 = await a("datahub.row.create", { table_id: x.tableId, data: { Tên: "A", Tiền: 5 } });
    const r2 = await a("datahub.row.create", { table_id: x.tableId, data: { Tên: "B" } });
    expect([r1.row_no, r2.row_no]).toEqual([1, 2]);
    expect(r1).toMatchObject({ version: 1, created_by: org.userA1.id, updated_by: org.userA1.id });
    expect(r1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // UUIDv7
    const list = await a("datahub.row.list", { table_id: x.tableId, fields: "Tên", include_total: "true" });
    expect(list.total).toBe(2);
    expect(list.items[0].data).toEqual({ [x.cols["Tên"]!.key]: "A" });
    const sel = await a("datahub.row.list", { table_id: x.tableId, fields: "_row_no,Tiền" });
    expect(sel.items[0]).toMatchObject({ row_no: 1, data: { [x.cols["Tiền"]!.key]: 5 } });
    expect(sel.items[0].version).toBeUndefined();
  });

  it("update bumps version only when something changed; delete goes to the trash and restores", async () => {
    const x = await makeTable(a, { columns: [{ name: "Tên", type: "text" }] });
    const r = await a("datahub.row.create", { table_id: x.tableId, data: { Tên: "A" } });
    const same = await a("datahub.row.update", { table_id: x.tableId, row_id: r.id, data: { Tên: "A" }, version: 1 });
    expect(same.version).toBe(1);
    const u = await a("datahub.row.update", { table_id: x.tableId, row_id: r.id, data: { Tên: "B" }, version: 1 });
    expect(u).toMatchObject({ version: 2, updated_by: org.userA1.id });
    await a("datahub.row.delete", { table_id: x.tableId, row_id: r.id });
    expect((await a("datahub.row.list", { table_id: x.tableId })).items).toHaveLength(0);
    expect((await fails(a("datahub.row.get", { table_id: x.tableId, row_id: r.id }))).code).toBe("not_found");
    const trash = await a("datahub.trash.list", { table_id: x.tableId });
    expect(trash.rows.map((z: { id: string }) => z.id)).toEqual([r.id]);
    expect(trash.retention_days).toBe(7);
    const back = await a("datahub.row.restore", { table_id: x.tableId, row_id: r.id });
    expect(back.data[x.cols["Tên"]!.key]).toBe("B");
    expect(back.version).toBe(4);
    const t2 = await a("datahub.table.get", { table_id: x.tableId });
    expect(t2.row_count).toBe(1);
  });

  it("batch: up to 500 in one transaction; one failure writes nothing", async () => {
    const x = await makeTable(a, { columns: [{ name: "Tên", type: "text" }, { name: "Mã", type: "text", unique: true }] });
    const ops = Array.from({ length: 500 }, (_, i) => ({ op: "create", data: { Tên: `Dòng ${i}`, Mã: `M${i}` } }));
    const res = await a("datahub.row.batch", { table_id: x.tableId, ops });
    expect(res.results).toHaveLength(500);
    expect(res.results.every((r: { outcome: string }) => r.outcome === "created")).toBe(true);
    expect((await a("datahub.row.list", { table_id: x.tableId, include_total: "true", limit: 1 })).total).toBe(500);
    // 501 operations: refused by the schema.
    expect((await fails(a("datahub.row.batch", { table_id: x.tableId, ops: [...ops, ops[0]] }))).code).toBe("validation_error");
    // A duplicate unique value in the last op rolls back the earlier ones.
    const e = await fails(a("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "create", data: { Tên: "Mới", Mã: "NEW" } }, { op: "create", data: { Tên: "Trùng", Mã: "M1" } }] }));
    expect(e.code).toBe("conflict");
    expect(e.details.reason).toBe("duplicate_value");
    expect((await a("datahub.row.list", { table_id: x.tableId, filter: JSON.stringify({ field: "Mã", op: "eq", value: "NEW" }) })).items).toHaveLength(0);
    // Mixed batch.
    const ids = (await a("datahub.row.list", { table_id: x.tableId, limit: 2 })).items.map((r: { id: string; version: number }) => r);
    const mixed = await a("datahub.row.batch", { table_id: x.tableId, ops: [
      { op: "update", id: ids[0].id, data: { Tên: "Đổi" }, base: { Tên: "Dòng 0" } },
      { op: "delete", id: ids[1].id },
      { op: "create", data: { Tên: "Thêm", Mã: "ADD" } },
    ] });
    expect(mixed.results.map((r: { outcome: string }) => r.outcome)).toEqual(["updated", "deleted", "created"]);
    // The same row twice in one batch is refused.
    expect((await fails(a("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "delete", id: ids[0].id }, { op: "delete", id: ids[0].id }] }))).code).toBe("validation_error");
  });

  it("upsert by a unique key column: updates when found, creates when not, merges repeats in one batch", async () => {
    const x = await makeTable(a, { columns: [{ name: "Mã deal", type: "text", unique: true }, { name: "Doanh thu", type: "currency" }, { name: "Ghi chú", type: "text" }] });
    const first = await a("datahub.row.upsert", { table_id: x.tableId, key: "Mã deal", data: { "Mã deal": "D-1", "Doanh thu": 100 } });
    expect(first.outcome).toBe("created");
    const second = await a("datahub.row.upsert", { table_id: x.tableId, key: x.cols["Mã deal"]!.key, data: { "Mã deal": "D-1", "Doanh thu": 200 } });
    expect(second).toMatchObject({ outcome: "updated" });
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.data[x.cols["Ghi chú"]!.key]).toBeUndefined();
    const batch = await a("datahub.row.batch", { table_id: x.tableId, ops: [
      { op: "upsert", key: "Mã deal", data: { "Mã deal": "D-2", "Doanh thu": 1 } },
      { op: "upsert", key: "Mã deal", data: { "Mã deal": "D-2", "Ghi chú": "gộp" } },
      { op: "upsert", key: "Mã deal", data: { "Mã deal": "D-1", "Ghi chú": "cũ" } },
    ] });
    expect(batch.results.map((r: { outcome: string }) => r.outcome)).toEqual(["created", "created", "updated"]);
    expect(batch.results[0].id).toBe(batch.results[1].id);
    expect((await a("datahub.row.list", { table_id: x.tableId, include_total: "true" })).total).toBe(2);
    const merged = await a("datahub.row.get", { table_id: x.tableId, row_id: batch.results[0].id });
    expect(merged.data).toMatchObject({ [x.cols["Doanh thu"]!.key]: 1, [x.cols["Ghi chú"]!.key]: "gộp" });
    // A key column without "unique" is refused; a missing key value too.
    expect((await fails(a("datahub.row.upsert", { table_id: x.tableId, key: "Ghi chú", data: { "Ghi chú": "x" } }))).code).toBe("validation_error");
    expect((await fails(a("datahub.row.upsert", { table_id: x.tableId, key: "Mã deal", data: { "Doanh thu": 1 } }))).code).toBe("validation_error");
  });

  it("making a column unique fails clearly when values are already duplicated, and unique indexes can be dropped", async () => {
    const x = await makeTable(a, { columns: [{ name: "Mã", type: "text" }] });
    for (const v of ["a", "a", "b"]) await a("datahub.row.create", { table_id: x.tableId, data: { Mã: v } });
    const e = await fails(a("datahub.column.update", { table_id: x.tableId, column: "Mã", unique: true }));
    expect(e.code).toBe("conflict");
    expect(e.details.reason).toBe("duplicate_values");
    await a("datahub.row.delete", { table_id: x.tableId, row_id: (await a("datahub.row.list", { table_id: x.tableId, limit: 1 })).items[0].id });
    await a("datahub.column.update", { table_id: x.tableId, column: "Mã", unique: true });
    expect((await fails(a("datahub.row.create", { table_id: x.tableId, data: { Mã: "b" } }))).code).toBe("conflict");
    await a("datahub.column.update", { table_id: x.tableId, column: "Mã", unique: false });
    await a("datahub.row.create", { table_id: x.tableId, data: { Mã: "b" } });
  });
});

describe("cell-level merge (design module2 section 7)", () => {
  let x: Awaited<ReturnType<typeof makeTable>>;
  let rowId: string;
  const b = () => as(t, org.userA2.id);
  beforeAll(async () => {
    x = await makeTable(a, { columns: [{ name: "Tên", type: "text" }, { name: "Tiền", type: "currency" }, { name: "Ghi chú", type: "text" }] });
    await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    rowId = (await a("datahub.row.create", { table_id: x.tableId, data: { Tên: "A", Tiền: 1 } })).id;
  });

  it("two people edit different cells of one row: both edits survive, version increments each time", async () => {
    const readA = await a("datahub.row.get", { table_id: x.tableId, row_id: rowId });
    const readB = await b()("datahub.row.get", { table_id: x.tableId, row_id: rowId });
    const k = (n: string) => x.cols[n]!.key;
    const e1 = await a("datahub.row.update", { table_id: x.tableId, row_id: rowId, data: { Tên: "A2" }, base: { Tên: readA.data[k("Tên")] } });
    expect(e1.version).toBe(readA.version + 1);
    const e2 = await b()("datahub.row.update", { table_id: x.tableId, row_id: rowId, data: { Tiền: 99 }, base: { Tiền: readB.data[k("Tiền")] } });
    expect(e2.version).toBe(readA.version + 2);
    expect(e2.data[k("Tên")]).toBe("A2");
    expect(e2.data[k("Tiền")]).toBe(99);
  });

  it("the same cell changed since the client read it: 409 with the current value; nothing is written", async () => {
    const before = await a("datahub.row.get", { table_id: x.tableId, row_id: rowId });
    const k = x.cols["Tên"]!.key;
    await a("datahub.row.update", { table_id: x.tableId, row_id: rowId, data: { Tên: "Người 1" }, base: { Tên: before.data[k] } });
    const e = await fails(b()("datahub.row.update", { table_id: x.tableId, row_id: rowId, data: { Tên: "Người 2", "Ghi chú": "x" }, base: { Tên: before.data[k], "Ghi chú": null } }));
    expect(e.code).toBe("conflict");
    expect(e.details).toMatchObject({ reason: "cell_conflict", conflicts: [{ row_id: rowId, column: k, name: "Tên", current: "Người 1" }] });
    const now = await a("datahub.row.get", { table_id: x.tableId, row_id: rowId });
    expect(now.data[k]).toBe("Người 1");
    expect(now.data[x.cols["Ghi chú"]!.key]).toBeUndefined();
    // Setting the cell to the value it already has is not a conflict.
    await b()("datahub.row.update", { table_id: x.tableId, row_id: rowId, data: { Tên: "Người 1" }, base: { Tên: before.data[k] } });
  });

  it("without `base` the whole-row version is checked; neither is an error", async () => {
    const cur = await a("datahub.row.get", { table_id: x.tableId, row_id: rowId });
    const e = await fails(a("datahub.row.update", { table_id: x.tableId, row_id: rowId, data: { Tiền: 5 }, version: cur.version - 1 }));
    expect(e.code).toBe("conflict");
    expect(e.details).toMatchObject({ reason: "version_conflict" });
    expect((await fails(a("datahub.row.update", { table_id: x.tableId, row_id: rowId, data: { Tiền: 5 } }))).code).toBe("validation_error");
    await a("datahub.row.update", { table_id: x.tableId, row_id: rowId, data: { Tiền: 5 }, version: cur.version });
  });

  it("batch conflicts are all reported and the whole batch is rolled back", async () => {
    const r2 = await a("datahub.row.create", { table_id: x.tableId, data: { Tên: "R2" } });
    const k = x.cols["Tên"]!.key;
    const e = await fails(a("datahub.row.batch", { table_id: x.tableId, ops: [
      { op: "update", id: rowId, data: { Tên: "X" }, base: { Tên: "cũ" } },
      { op: "update", id: r2.id, data: { Tên: "Y" }, base: { Tên: "R2" } },
    ] }));
    expect(e.details.conflicts).toHaveLength(1);
    expect((await a("datahub.row.get", { table_id: x.tableId, row_id: r2.id })).data[k]).toBe("R2");
  });
});

describe("history and audit", () => {
  it("every write records row_history with input data only; the Admin audit view shows no values", async () => {
    const x = await makeTable(a, { columns: [{ name: "Bí mật", type: "text" }, { name: "Số", type: "number" }] });
    const secret = "gia-tri-rat-bi-mat-123";
    const r = await a("datahub.row.create", { table_id: x.tableId, data: { "Bí mật": secret, Số: 42 } });
    await a("datahub.row.update", { table_id: x.tableId, row_id: r.id, data: { "Bí mật": "gia-tri-moi-456" }, version: 1 });
    await fails(a("datahub.row.update", { table_id: x.tableId, row_id: r.id, data: { "Bí mật": "xung-dot-789" }, base: { "Bí mật": "sai" } }));
    await a("datahub.row.delete", { table_id: x.tableId, row_id: r.id });
    await a("datahub.row.restore", { table_id: x.tableId, row_id: r.id });

    const h = await a("datahub.row.history", { table_id: x.tableId, row_id: r.id });
    expect(h.items.map((i: { op: string }) => i.op)).toEqual(["restore", "delete", "update", "create"]);
    expect(h.items[2].changes[0]).toMatchObject({ field: x.cols["Bí mật"]!.key, field_name: "Bí mật", old: secret, new: "gia-tri-moi-456" });
    expect(h.items[3].actor).toMatchObject({ userId: org.userA1.id, via: "api" });

    // Audit: rows exist for every command, none contains a value.
    const res = await t.c.db.db.execute(sql`SELECT command, result, target_type, details FROM audit_log WHERE command LIKE 'datahub.row.%' AND target_id = ${x.tableId}`);
    const rows = res.rows as { command: string; result: string; target_type: string; details: unknown }[];
    expect(rows.map((q) => q.command)).toEqual(expect.arrayContaining(["datahub.row.create", "datahub.row.update", "datahub.row.delete", "datahub.row.restore"]));
    expect(rows.some((q) => q.result === "error")).toBe(true);
    const dump = JSON.stringify(rows);
    for (const v of [secret, "gia-tri-moi-456", "xung-dot-789", "sai"]) expect(dump).not.toContain(v);
    expect(rows.find((q) => q.command === "datahub.row.update" && q.result === "success")!.details).toMatchObject({ fields: [x.cols["Bí mật"]!.key], values_hidden: true });
    // The same through the Admin's audit API.
    const admin = as(t, org.admin.id);
    const list = await admin("system.audit.list", { filter: JSON.stringify({ field: "target_id", op: "eq", value: x.tableId }), limit: 100 });
    expect(JSON.stringify(list.items)).not.toContain("gia-tri-moi-456");
  });

  it("changes made by the system (formula recalculation, Stage 2B) are not logged: nothing in 2A writes history without a user", async () => {
    const x = await makeTable(a, { columns: [{ name: "Tên", type: "text" }] });
    const r = await a("datahub.row.create", { table_id: x.tableId, data: { Tên: "A" } });
    // Auto-number back-fill on a new column is a system fill: no history entry, no version bump.
    await a("datahub.column.create", { table_id: x.tableId, name: "STT", type: "auto_number" });
    const h = await a("datahub.row.history", { table_id: x.tableId, row_id: r.id });
    expect(h.items).toHaveLength(1);
    expect((await a("datahub.row.get", { table_id: x.tableId, row_id: r.id })).version).toBe(1);
  });
});
