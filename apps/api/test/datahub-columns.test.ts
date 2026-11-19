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

const create = async (x: { tableId: string; cols: Record<string, { key: string }> }, data: Record<string, unknown>) => a("datahub.row.create", { table_id: x.tableId, data });

describe("column types: validation on every write", () => {
  let x: Awaited<ReturnType<typeof makeTable>>;
  const opts = [{ name: "Ưu tiên", color: "#f00" }, { name: "Thường" }, { name: "Thấp" }];
  beforeAll(async () => {
    x = await makeTable(a, {
      columns: [
        { name: "Tên", type: "text", config: { max_length: 10 } },
        { name: "Ghi chú", type: "long_text" },
        { name: "Số", type: "number", config: { precision: 2 } },
        { name: "Tiền", type: "currency" },
        { name: "Tỉ lệ", type: "percent" },
        { name: "Ngày", type: "date" },
        { name: "Giờ", type: "datetime" },
        { name: "Xong", type: "checkbox" },
        { name: "Sao", type: "rating", config: { max: 5 } },
        { name: "Mức", type: "single_select", config: { options: opts } },
        { name: "Nhãn", type: "multi_select", config: { options: opts } },
        { name: "Người", type: "user" },
        { name: "Email", type: "email" },
        { name: "Đt", type: "phone" },
        { name: "Web", type: "url" },
        { name: "STT", type: "auto_number", config: { start: 100 } },
      ],
    });
    await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" }); // user cells take only members (module2 section 10)
  });
  const ok = (data: Record<string, unknown>) => create(x, data);
  const bad = async (data: Record<string, unknown>) => {
    const e = await fails(create(x, data));
    expect(e.code).toBe("validation_error");
    return e;
  };

  it("text: trims, max length, empty becomes empty", async () => {
    const r = await ok({ Tên: "  Linh  " });
    expect(r.data[x.cols["Tên"]!.key]).toBe("Linh");
    await bad({ Tên: "x".repeat(11) });
    await bad({ Tên: 5 });
    const empty = await ok({ Tên: "   " });
    expect(empty.data[x.cols["Tên"]!.key]).toBeUndefined();
  });

  it("number family: number, numeric string, precision; currency integer only; percent accepts 25%", async () => {
    const r = await ok({ Số: "1,234.5678", Tiền: 156000000, "Tỉ lệ": "25%" });
    expect(r.data[x.cols["Số"]!.key]).toBe(1234.57);
    expect(r.data[x.cols["Tiền"]!.key]).toBe(156000000);
    expect(r.data[x.cols["Tỉ lệ"]!.key]).toBe(0.25);
    await bad({ Số: "abc" });
    await bad({ Số: Infinity });
    await bad({ Tiền: 10.5 });
    await bad({ Tiền: 2 ** 60 });
    await bad({ "Tỉ lệ": "nhiều" });
  });

  it("date and datetime: ISO or dd/mm/yyyy, impossible dates refused, stored as UTC", async () => {
    const r = await ok({ Ngày: "18/11/2026", Giờ: "2026-11-18T09:30:00+07:00" });
    expect(r.data[x.cols["Ngày"]!.key]).toBe("2026-11-18");
    expect(r.data[x.cols["Giờ"]!.key]).toBe("2026-11-18T02:30:00.000Z");
    const noTz = await ok({ Giờ: "2026-11-18 09:30" });
    expect(noTz.data[x.cols["Giờ"]!.key]).toBe("2026-11-18T02:30:00.000Z");
    await bad({ Ngày: "2026-02-30" });
    await bad({ Ngày: "tuần sau" });
    await bad({ Giờ: "2026-13-01T00:00:00Z" });
  });

  it("checkbox and rating", async () => {
    const r = await ok({ Xong: "có", Sao: 4 });
    expect(r.data[x.cols["Xong"]!.key]).toBe(true);
    expect(r.data[x.cols["Sao"]!.key]).toBe(4);
    await bad({ Xong: "có thể" });
    await bad({ Sao: 6 });
    await bad({ Sao: 2.5 });
  });

  it("single and multi select: accept id or name (any case), reject unknown, keep option order", async () => {
    const cols = (await a("datahub.table.get", { table_id: x.tableId })).columns;
    const [o1] = cols.find((c: { name: string }) => c.name === "Mức").config.options;
    const [, n2] = cols.find((c: { name: string }) => c.name === "Nhãn").config.options;
    const r = await ok({ Mức: "ưu tiên", Nhãn: [n2.id, "Thấp", n2.id] });
    expect(r.data[x.cols["Mức"]!.key]).toBe(o1.id);
    expect(r.data[x.cols["Nhãn"]!.key]).toHaveLength(2);
    await bad({ Mức: "Không có" });
    await bad({ Nhãn: ["Thường", "Lạ"] });
    const labelled = await a("datahub.row.get", { table_id: x.tableId, row_id: r.id, labels: "true" });
    expect(labelled.data[x.cols["Mức"]!.key]).toBe("Ưu tiên");
  });

  it("user, email, phone, url", async () => {
    const r = await ok({ Người: org.userA2.id, Email: " Linh@Base.VN ", Đt: "+84 912 345 678", Web: "https://base.vn/x" });
    expect(r.data[x.cols["Email"]!.key]).toBe("linh@base.vn");
    await bad({ Người: "linh" });
    await bad({ Người: "01900000-0000-7000-8000-00000000dead" });
    await bad({ Email: "khong-phai-email" });
    await bad({ Đt: "abc" });
    await bad({ Web: "javascript:alert(1)" });
    await bad({ Web: "ftp://x.vn" });
  });

  it("auto number is assigned by the server and cannot be written", async () => {
    const r1 = await ok({});
    const r2 = await ok({});
    expect(r2.data[x.cols["STT"]!.key]).toBe(r1.data[x.cols["STT"]!.key] + 1);
    expect(r1.data[x.cols["STT"]!.key]).toBeGreaterThanOrEqual(100);
    await bad({ STT: 5 });
  });

  it("unknown column, double reference, all issues reported together", async () => {
    await bad({ "Không có": 1 });
    const key = x.cols["Tên"]!.key;
    const e = await bad({ Tên: "a", [key]: "b" });
    expect(JSON.stringify(e.details)).toContain("hai lần");
    const many = await bad({ Số: "x", Tiền: "y", Ngày: "z" });
    expect(many.details.issues).toHaveLength(3);
  });

  it("computed types are available (Stage 2B) and need a configuration", async () => {
    const types = await a("datahub.column.types");
    for (const k of ["formula", "relation", "lookup", "rollup"]) expect(types.find((d: { type: string }) => d.type === k)).toMatchObject({ available: true, writable: k === "relation" });
    const e = await fails(a("datahub.column.create", { table_id: x.tableId, name: "F", type: "formula" }));
    expect(e.code).toBe("validation_error");
  });

  it("required and default value apply on create; required blocks clearing", async () => {
    const y = await makeTable(a, { columns: [{ name: "Bắt buộc", type: "text", required: true }, { name: "Mặc định", type: "number", default_value: 7 }] });
    const e = await fails(a("datahub.row.create", { table_id: y.tableId, data: {} }));
    expect(e.message).toContain("bắt buộc");
    const r = await a("datahub.row.create", { table_id: y.tableId, data: { "Bắt buộc": "x" } });
    expect(r.data[y.cols["Mặc định"]!.key]).toBe(7);
    const e2 = await fails(a("datahub.row.update", { table_id: y.tableId, row_id: r.id, data: { "Bắt buộc": null }, version: r.version }));
    expect(e2.message).toContain("bắt buộc");
    expect((await fails(a("datahub.column.create", { table_id: y.tableId, name: "Sai", type: "number", default_value: "abc" }))).code).toBe("validation_error");
  });

  it("column keys are stable: renaming a column keeps the data", async () => {
    const y = await makeTable(a, { columns: [{ name: "Cũ", type: "text" }] });
    const r = await a("datahub.row.create", { table_id: y.tableId, data: { Cũ: "giá trị" } });
    await a("datahub.column.update", { table_id: y.tableId, column: "Cũ", name: "Mới" });
    const again = await a("datahub.row.get", { table_id: y.tableId, row_id: r.id });
    expect(again.data[y.cols["Cũ"]!.key]).toBe("giá trị");
    // Old name no longer resolves; the key and the new name do.
    expect((await fails(a("datahub.row.create", { table_id: y.tableId, data: { Cũ: "x" } }))).code).toBe("validation_error");
    await a("datahub.row.create", { table_id: y.tableId, data: { Mới: "x" } });
    await a("datahub.row.create", { table_id: y.tableId, data: { [y.cols["Cũ"]!.key]: "y" } });
  });

  it("column limit: default 70, hard ceiling 200", async () => {
    const u = org.userA2;
    const b = as(t, u.id);
    const dh = await b("datahub.datahub.create", { name: "Giới hạn cột" });
    const tb = await b("datahub.table.create", { datahub_id: dh.id, name: "T" });
    for (let i = 0; i < 70; i++) await b("datahub.column.create", { table_id: tb.id, name: `C${i}`, type: "text" });
    const e = await fails(b("datahub.column.create", { table_id: tb.id, name: "C70", type: "text" }));
    expect(e.code).toBe("quota_exceeded");
    // Admin raises the person's limit, but never above the ceiling.
    const admin = as(t, org.admin.id);
    await admin("datahub.limit.user.set", { user_id: u.id, max_columns: 200 });
    for (let i = 70; i < 200; i++) await b("datahub.column.create", { table_id: tb.id, name: `C${i}`, type: "text" });
    expect((await fails(b("datahub.column.create", { table_id: tb.id, name: "C200", type: "text" }))).code).toBe("quota_exceeded");
    expect((await fails(admin("datahub.limit.user.set", { user_id: u.id, max_columns: 201 }))).code).toBe("validation_error");
    await t.c.db.db.execute(sql`DELETE FROM dh_user_limits WHERE user_id = ${u.id}::uuid`);
  }, 60000);
});

describe("type change with a dry run", () => {
  it("previews values that cannot convert, refuses without consent, keeps old values in the history", async () => {
    const x = await makeTable(a, { columns: [{ name: "Giá", type: "text" }] });
    const key = x.cols["Giá"]!.key;
    const vals = ["100", "250.5", "1,000", "không rõ", "300"];
    const rows = [];
    for (const v of vals) rows.push(await a("datahub.row.create", { table_id: x.tableId, data: { Giá: v } }));
    const preview = await a("datahub.column.type_preview", { table_id: x.tableId, column: "Giá", type: "number" });
    expect(preview).toMatchObject({ with_value: 5, cannot_convert: 1, converted: 4 });
    expect(preview.samples[0]).toMatchObject({ value: "không rõ" });
    // The preview wrote nothing.
    expect((await a("datahub.row.get", { table_id: x.tableId, row_id: rows[0].id })).data[key]).toBe("100");

    const refused = await fails(a("datahub.column.type_change", { table_id: x.tableId, column: "Giá", type: "number" }));
    expect(refused.code).toBe("validation_error");
    expect(refused.details.cannot_convert).toBe(1);

    const done = await a("datahub.column.type_change", { table_id: x.tableId, column: "Giá", type: "number", accept_data_loss: true });
    expect(done.column.type).toBe("number");
    const after = await a("datahub.row.list", { table_id: x.tableId, sort: "_row_no" });
    expect(after.items.map((r: { data: Record<string, unknown> }) => r.data[key])).toEqual([100, 250.5, 1000, undefined, 300]);
    // History keeps the old text value of the cleared cell.
    const h = await a("datahub.row.history", { table_id: x.tableId, row_id: rows[3].id });
    expect(h.items[0].changes[0]).toMatchObject({ field: key, old: "không rõ", new: null });
    expect(h.items[0].op).toBe("update");
    const h0 = await a("datahub.row.history", { table_id: x.tableId, row_id: rows[0].id });
    expect(h0.items[0].changes[0]).toMatchObject({ old: "100", new: 100 });
  });

  it("text to single select builds the options from the distinct values", async () => {
    const x = await makeTable(a, { columns: [{ name: "Trạng thái", type: "text" }] });
    for (const v of ["Mới", "Đang làm", "Mới", "Xong"]) await a("datahub.row.create", { table_id: x.tableId, data: { "Trạng thái": v } });
    const p = await a("datahub.column.type_preview", { table_id: x.tableId, column: "Trạng thái", type: "single_select" });
    expect(p.new_config.options.map((o: { name: string }) => o.name).sort()).toEqual(["Mới", "Xong", "Đang làm"].sort());
    expect(p.cannot_convert).toBe(0);
    await a("datahub.column.type_change", { table_id: x.tableId, column: "Trạng thái", type: "single_select" });
    const rows = await a("datahub.row.list", { table_id: x.tableId, labels: "true", sort: "_row_no" });
    expect(rows.items.map((r: { data: Record<string, unknown> }) => Object.values(r.data)[0])).toEqual(["Mới", "Đang làm", "Mới", "Xong"]);
  });

  it("refuses system, auto number and reserved targets", async () => {
    const x = await makeTable(a, { columns: [{ name: "Số", type: "number" }, { name: "STT", type: "auto_number" }] });
    expect((await fails(a("datahub.column.type_preview", { table_id: x.tableId, column: "STT", type: "number" }))).code).toBe("validation_error");
    expect((await fails(a("datahub.column.type_preview", { table_id: x.tableId, column: "Số", type: "formula" }))).code).toBe("validation_error");
    expect((await fails(a("datahub.column.type_preview", { table_id: x.tableId, column: "Số", type: "number" }))).code).toBe("validation_error");
  });
});
