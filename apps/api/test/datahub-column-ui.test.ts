import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { files, newId } from "@soe/db";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1]) await unlimit(t, p.id);
  owner = as(t, org.userA1.id);
});
afterAll(async () => {
  await t.close();
});

describe("datahub.relation.search", () => {
  it("finds rows of the target table by text and by number, pages by row number, and is for the owner only", async () => {
    const cust = await makeTable(owner, { name: "Khách hàng", columns: [{ name: "Tên khách", type: "text" }] });
    const names = ["Công ty Thuận Phát", "Đặng Thị Ngọc Hân", "An Phát", "Vy"];
    const rows = [];
    for (const n of names) rows.push(await owner("datahub.row.create", { table_id: cust.tableId, data: { "Tên khách": n } }));
    const blank = await owner("datahub.row.create", { table_id: cust.tableId, data: {} });
    const orders = await owner("datahub.table.create", { datahub_id: cust.dhId, name: "Đơn hàng" });
    const link = await owner("datahub.column.create", { table_id: orders.id, name: "Khách", type: "relation", config: { target_table_id: cust.tableId } });

    const all = await owner("datahub.relation.search", { table_id: orders.id, column: "Khách" });
    expect(all.data.map((r: { label: string }) => r.label)).toEqual([...names, `#${blank.row_no}`]);
    expect(all.next_after).toBeNull();

    // Without accents and in lower case.
    const byText = await owner("datahub.relation.search", { table_id: orders.id, column: link.key, q: "phat" });
    expect(byText.data.map((r: { id: string }) => r.id)).toEqual([rows[0].id, rows[2].id]);
    const byNo = await owner("datahub.relation.search", { table_id: orders.id, column: link.key, q: `#${rows[3].row_no}` });
    expect(byNo.data.map((r: { id: string }) => r.id)).toEqual([rows[3].id]);
    // A character LIKE treats as a wildcard is plain text.
    expect((await owner("datahub.relation.search", { table_id: orders.id, column: link.key, q: "%" })).data).toEqual([]);

    const p1 = await owner("datahub.relation.search", { table_id: orders.id, column: link.key, limit: 2 });
    expect(p1.data).toHaveLength(2);
    expect(p1.next_after).toBe(p1.data[1].row_no);
    const p2 = await owner("datahub.relation.search", { table_id: orders.id, column: link.key, limit: 2, after: p1.next_after });
    expect(p2.data[0].id).toBe(rows[2].id);

    // A deleted row is not offered.
    await owner("datahub.row.delete", { table_id: cust.tableId, row_id: rows[1].id });
    expect((await owner("datahub.relation.search", { table_id: orders.id, column: link.key, q: "Đặng" })).data).toEqual([]);

    // Not a relation column; people without access.
    expect((await fails(owner("datahub.relation.search", { table_id: cust.tableId, column: "Tên khách" }))).code).toBe("validation_error");
    expect((await fails(as(t, org.userB1.id)("datahub.relation.search", { table_id: orders.id, column: link.key }))).code).toBe("not_found");
    await owner("datahub.share.set", { datahub_id: cust.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    expect((await fails(as(t, org.userA2.id)("datahub.relation.search", { table_id: orders.id, column: link.key }))).code).toBe("forbidden");
  });
});

async function readyFile(ownerId: string, name: string): Promise<string> {
  const id = newId();
  await t.c.db.db.insert(files).values({ id, ownerId, createdBy: ownerId, updatedBy: ownerId, storageKey: `files/${id}`, filename: name, contentType: "application/pdf", sizeBytes: 12, status: "ready" });
  return id;
}

describe("datahub.attachment.list / download_url", () => {
  it("serve only files that sit in a cell of the table, to everyone who can see the table", async () => {
    const x = await makeTable(owner, { columns: [{ name: "Tên", type: "text" }, { name: "Hợp đồng", type: "attachment" }] });
    const f1 = await readyFile(org.userA1.id, "hợp đồng.pdf");
    const loose = await readyFile(org.userA1.id, "chưa gắn.pdf");
    const row = await owner("datahub.row.create", { table_id: x.tableId, data: { Tên: "A", "Hợp đồng": [f1] } });

    const list = await owner("datahub.attachment.list", { table_id: x.tableId, ids: `${f1},${loose},${randomUUID()}` });
    expect(list).toEqual([{ id: f1, filename: "hợp đồng.pdf", content_type: "application/pdf", size_bytes: 12 }]);
    expect((await owner("datahub.attachment.download_url", { table_id: x.tableId, file_id: f1 })).url).toContain("sig=");
    expect((await fails(owner("datahub.attachment.download_url", { table_id: x.tableId, file_id: loose }))).code).toBe("not_found");
    expect((await fails(owner("datahub.attachment.list", { table_id: x.tableId, ids: "không-phải-uuid" }))).code).toBe("validation_error");

    // A person with no share sees nothing; a viewer reads the file of someone else.
    expect((await fails(as(t, org.userB1.id)("datahub.attachment.list", { table_id: x.tableId, ids: f1 }))).code).toBe("not_found");
    expect((await fails(as(t, org.userB1.id)("datahub.attachment.download_url", { table_id: x.tableId, file_id: f1 }))).code).toBe("not_found");
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
    const viewer = as(t, org.userA2.id);
    expect((await viewer("datahub.attachment.list", { table_id: x.tableId, ids: f1 }))[0].filename).toBe("hợp đồng.pdf");
    expect((await viewer("datahub.attachment.download_url", { table_id: x.tableId, file_id: f1 })).filename).toBe("hợp đồng.pdf");

    // The same file in another table's cell does not open through this table, and a file taken out of its row is closed again.
    const y = await makeTable(owner, { columns: [{ name: "Hợp đồng", type: "attachment" }] });
    expect(await owner("datahub.attachment.list", { table_id: y.tableId, ids: f1 })).toEqual([]);
    await owner("datahub.row.delete", { table_id: x.tableId, row_id: row.id });
    expect(await viewer("datahub.attachment.list", { table_id: x.tableId, ids: f1 })).toEqual([]);
  });
});

describe("column structure for people the table is shared with", () => {
  it("blocks every structure command and keeps the formula text from them", async () => {
    const x = await makeTable(owner, { columns: [{ name: "Doanh thu", type: "currency" }] });
    const f = await owner("datahub.column.create", { table_id: x.tableId, name: "Gấp đôi", type: "formula", config: { formula: "=[Doanh thu]*2" } });
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    const editor = as(t, org.userA2.id);
    const forbidden = async (name: string, input: Record<string, unknown>) => expect((await fails(editor(name, input))).code).toBe("forbidden");
    await forbidden("datahub.column.create", { table_id: x.tableId, name: "Mới", type: "text" });
    await forbidden("datahub.column.update", { table_id: x.tableId, column: "Doanh thu", name: "Tiền" });
    await forbidden("datahub.column.delete", { table_id: x.tableId, column: "Doanh thu" });
    await forbidden("datahub.column.type_preview", { table_id: x.tableId, column: "Doanh thu", type: "number" });
    await forbidden("datahub.column.type_change", { table_id: x.tableId, column: "Doanh thu", type: "number" });
    await forbidden("datahub.formula.preview", { table_id: x.tableId, formula: "=1+1" });
    const seen = (await editor("datahub.table.get", { table_id: x.tableId })).columns.find((c: { key: string }) => c.key === f.key);
    expect(seen.type).toBe("formula");
    expect(seen.config.formula).toBeUndefined();
    expect(seen.config.expr).toBeUndefined();
    expect((await owner("datahub.table.get", { table_id: x.tableId })).columns.find((c: { key: string }) => c.key === f.key).config.formula).toBe("=[Doanh thu]*2");
  });
});
