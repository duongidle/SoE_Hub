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

describe("files in an attachment cell: only NEW ids need to be the writer's own", () => {
  it("keeps what is already in the cell, refuses someone else's id, on update, create, upsert and restore", async () => {
    const x = await makeTable(owner, { columns: [{ name: "Mã", type: "text", unique: true }, { name: "Hợp đồng", type: "attachment" }] });
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    const editor = as(t, org.userA2.id);
    const fOwner = await readyFile(org.userA1.id, "của chủ.pdf");
    const fOwner2 = await readyFile(org.userA1.id, "của chủ 2.pdf");
    const fEditor = await readyFile(org.userA2.id, "của người sửa.pdf");
    const cell = async (id: string) => ((await owner("datahub.row.get", { table_id: x.tableId, row_id: id })).data[x.cols["Hợp đồng"]!.key] ?? []) as string[];

    const row = await owner("datahub.row.create", { table_id: x.tableId, data: { Mã: "A", "Hợp đồng": [fOwner] } });
    const other = await owner("datahub.row.create", { table_id: x.tableId, data: { Mã: "B" } });

    const bad = (p: Promise<unknown>) => fails(p).then((e) => { expect(e.code).toBe("validation_error"); expect(e.message).toContain("không phải file của bạn"); });
    // The editor adds a file of their own to a cell that holds the owner's: allowed, the owner's stays.
    const r1 = await editor("datahub.row.update", { table_id: x.tableId, row_id: row.id, data: { "Hợp đồng": [fOwner, fEditor] }, version: row.version });
    expect(await cell(row.id)).toEqual([fOwner, fEditor]);
    // The owner takes the editor's file out: allowed.
    const r2 = await owner("datahub.row.update", { table_id: x.tableId, row_id: row.id, data: { "Hợp đồng": [fOwner] }, version: r1.version });
    expect(await cell(row.id)).toEqual([fOwner]);
    // (The owner cannot put the editor's file back: it would be a new id the owner did not upload. The editor can.)
    await bad(owner("datahub.row.update", { table_id: x.tableId, row_id: row.id, data: { "Hợp đồng": [fOwner, fEditor] }, version: r2.version }));
    await editor("datahub.row.update", { table_id: x.tableId, row_id: row.id, data: { "Hợp đồng": [fOwner, fEditor] }, version: r2.version });

    // The editor cannot copy an id of someone else's file into a cell: not into this cell's row, not from another row of the table, not for a new row.
    await bad(editor("datahub.row.update", { table_id: x.tableId, row_id: other.id, data: { "Hợp đồng": [fOwner] }, version: other.version }));
    await bad(editor("datahub.row.update", { table_id: x.tableId, row_id: row.id, data: { "Hợp đồng": [fOwner, fEditor, fOwner2] }, base: { "Hợp đồng": [fOwner, fEditor] } }));
    await bad(editor("datahub.row.create", { table_id: x.tableId, data: { "Hợp đồng": [fOwner] } }));
    // Upsert: an existing row keeps its ids and takes the writer's own; a foreign id is refused.
    await editor("datahub.row.upsert", { table_id: x.tableId, key: "Mã", data: { Mã: "A", "Hợp đồng": [fOwner, fEditor] } });
    await bad(editor("datahub.row.upsert", { table_id: x.tableId, key: "Mã", data: { Mã: "A", "Hợp đồng": [fOwner, fEditor, fOwner2] } }));
    await bad(editor("datahub.row.upsert", { table_id: x.tableId, key: "Mã", data: { Mã: "C", "Hợp đồng": [fOwner] } }));
    // A file that does not exist at all.
    await bad(owner("datahub.row.update", { table_id: x.tableId, row_id: other.id, data: { "Hợp đồng": [randomUUID()] }, version: other.version }));

    // Delete and restore a row that holds files of two people: restoring needs no ownership check.
    await owner("datahub.row.delete", { table_id: x.tableId, row_id: row.id });
    expect((await editor("datahub.row.restore_batch", { table_id: x.tableId, row_ids: [row.id] })).rows).toHaveLength(1);
    expect(await cell(row.id)).toEqual([fOwner, fEditor]);
  });
});

describe("a link may point at any table of any datahub of the same owner, never at someone else's", () => {
  it("searches and labels rows of a table in another datahub of the owner; refuses another owner's table", async () => {
    const cust = await makeTable(owner, { name: "Khách riêng", columns: [{ name: "Tên khách", type: "text" }] });
    const c1 = await owner("datahub.row.create", { table_id: cust.tableId, data: { "Tên khách": "Công ty Ngoài Datahub" } });
    const deals = await makeTable(owner, { name: "Deals khác datahub" });
    const link = await owner("datahub.column.create", { table_id: deals.tableId, name: "Khách", type: "relation", config: { target_table_id: cust.tableId } });
    const found = await owner("datahub.relation.search", { table_id: deals.tableId, column: link.key, q: "ngoai" });
    expect(found.data.map((r: { id: string }) => r.id)).toEqual([c1.id]);
    const deal = await owner("datahub.row.create", { table_id: deals.tableId, data: { Khách: [c1.id] } });
    expect(deal.id).toBeTruthy();
    expect((await owner("datahub.relation.labels", { table_id: deals.tableId, column: link.key, ids: c1.id }))[0].label).toBe("Công ty Ngoài Datahub");
    // A person the deals datahub is shared with sees the label (a value in the cell), but cannot search.
    await owner("datahub.share.set", { datahub_id: deals.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    const editor = as(t, org.userA2.id);
    expect((await editor("datahub.relation.labels", { table_id: deals.tableId, column: link.key, ids: c1.id }))[0].label).toBe("Công ty Ngoài Datahub");
    expect((await fails(editor("datahub.relation.search", { table_id: deals.tableId, column: link.key }))).code).toBe("forbidden");

    // Another owner's table: a link cannot be made to it, a row of it cannot be linked.
    const theirs = await makeTable(as(t, org.userB1.id), { name: "Của người khác", columns: [{ name: "Tên", type: "text" }] });
    const theirRow = await as(t, org.userB1.id)("datahub.row.create", { table_id: theirs.tableId, data: { Tên: "Bí mật" } });
    const refused = await fails(owner("datahub.column.create", { table_id: deals.tableId, name: "Lạ", type: "relation", config: { target_table_id: theirs.tableId } }));
    expect(refused.code).toBe("validation_error");
    expect((await fails(owner("datahub.row.create", { table_id: deals.tableId, data: { Khách: [theirRow.id] } }))).code).toBe("validation_error");
    // And the other owner cannot read these rows through the owner's link.
    expect((await fails(as(t, org.userB1.id)("datahub.relation.search", { table_id: deals.tableId, column: link.key }))).code).toBe("not_found");
    expect((await fails(as(t, org.userB1.id)("datahub.relation.labels", { table_id: deals.tableId, column: link.key, ids: c1.id }))).code).toBe("not_found");
  });
});
