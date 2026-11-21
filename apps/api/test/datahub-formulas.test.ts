import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { activeToken, login, seedOrg, type Org, type WebSession } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { enqueueOutbox } from "@soe/db";
import { markVolatilePending } from "../src/modules/datahub";

/**
 * Formula, relation, lookup and rollup columns (Stage 2B, design module2 sections 4, 6.4, 6.5):
 * save-time checks, same-row computation in the writing transaction, worker recalculation, no log from recalculation.
 */
let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
let admin: pg.Client;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  await unlimit(t, org.userA2.id);
  a = as(t, org.userA1.id);
  admin = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
  await admin.connect();
});
afterAll(async () => {
  await admin.end();
  await t.close();
});

const q = async (text: string, params: unknown[] = []) => (await admin.query(text, params)).rows as Record<string, unknown>[];

async function rows(tableId: string, extra: Record<string, unknown> = {}) {
  const r = await a("datahub.row.list", { table_id: tableId, limit: 500, ...extra });
  return r.items as { id: string; version: number; updated_at: string; data: Record<string, unknown> }[];
}

async function addFormula(tableId: string, name: string, formula: string, extra: Record<string, unknown> = {}) {
  return a("datahub.column.create", { table_id: tableId, name, type: "formula", config: { formula, ...extra } });
}

describe("same-row formulas: computed in the transaction that saves the row", () => {
  let x: Awaited<ReturnType<typeof makeTable>>;
  let totalKey: string;
  beforeAll(async () => {
    x = await makeTable(a, { columns: [{ name: "Đơn giá", type: "currency" }, { name: "Số lượng", type: "number" }, { name: "Ngày", type: "date" }, { name: "Tên", type: "text" }] });
    const f = await addFormula(x.tableId, "Thành tiền", "=[Đơn giá] * [Số lượng]");
    totalKey = f.key;
  });

  it("is available the moment the row is created, and again after an edit", async () => {
    const r = await a("datahub.row.create", { table_id: x.tableId, data: { "Đơn giá": 1500, "Số lượng": 4 } });
    expect(r.data[totalKey]).toBe(6000);
    const u = await a("datahub.row.update", { table_id: x.tableId, row_id: r.id, data: { "Số lượng": 5 }, version: r.version });
    expect(u.data[totalKey]).toBe(7500);
    expect(u.version).toBe(2);
  });

  it("computed cells cannot be written by people, the API or the batch", async () => {
    const e = await fails(a("datahub.row.create", { table_id: x.tableId, data: { "Thành tiền": 1 } }));
    expect(e.code).toBe("validation_error");
    expect(e.message).toContain("không sửa được");
  });

  it("an error is stored next to the value, shown as its code, and never breaks filters or sorting", async () => {
    const f = await addFormula(x.tableId, "Đơn giá mỗi cái", "=[Đơn giá] / [Số lượng]");
    const r = await a("datahub.row.create", { table_id: x.tableId, data: { "Đơn giá": 100, "Số lượng": 0 } });
    expect(r.data[f.key]).toBe("#DIV/0!");
    const ok = await a("datahub.row.create", { table_id: x.tableId, data: { "Đơn giá": 100, "Số lượng": 4 } });
    expect(ok.data[f.key]).toBe(25);
    // numeric filter and sort over a column that has an error cell
    const list = await rows(x.tableId, { filter: JSON.stringify({ field: "Đơn giá mỗi cái", op: "gte", value: 10 }), sort: "Đơn giá mỗi cái:desc" });
    expect(list.map((i) => i.data[f.key])).toContain(25);
    const withError = (await rows(x.tableId, { fields: "Đơn giá mỗi cái" })).find((i) => i.id === r.id)!;
    expect(withError.data[f.key]).toBe("#DIV/0!");
    // fixing the input clears the error
    const fixed = await a("datahub.row.update", { table_id: x.tableId, row_id: r.id, data: { "Số lượng": 2 }, version: r.version });
    expect(fixed.data[f.key]).toBe(50);
    expect(Object.keys(fixed.data).some((k) => k.startsWith("!"))).toBe(false);
  });

  it("result type follows the formula: text, boolean, date, number", async () => {
    const txt = await addFormula(x.tableId, "Nhãn", '=IF([Đơn giá] > 1000, "Lớn", "Nhỏ") & " " & [Tên]');
    const bool = await addFormula(x.tableId, "Lớn?", "=[Đơn giá] > 1000");
    const date = await addFormula(x.tableId, "Hạn", "=[Ngày] + 30");
    const cols = (await a("datahub.table.get", { table_id: x.tableId })).columns as { name: string; config: { result_type?: string } }[];
    const type = (n: string) => cols.find((c) => c.name === n)!.config.result_type;
    expect([type("Nhãn"), type("Lớn?"), type("Hạn"), type("Thành tiền")]).toEqual(["text", "checkbox", "date", "number"]);
    const r = await a("datahub.row.create", { table_id: x.tableId, data: { "Đơn giá": 5000, "Số lượng": 1, Ngày: "2026-11-18", Tên: "A" } });
    expect([r.data[txt.key], r.data[bool.key], r.data[date.key]]).toEqual(["Lớn A", true, "2026-12-18"]);
    const sorted = await rows(x.tableId, { filter: JSON.stringify({ field: "Hạn", op: "gte", value: "2026-12-01" }) });
    expect(sorted).toHaveLength(1);
  });

  it("formulas do not enter the row history, and the history is not changed by recalculation", async () => {
    const r = await a("datahub.row.create", { table_id: x.tableId, data: { "Đơn giá": 10, "Số lượng": 2 } });
    const h = await a("datahub.row.history", { table_id: x.tableId, row_id: r.id });
    const fields = h.items.flatMap((i: { changes: { field_name: string }[] }) => i.changes.map((c) => c.field_name));
    expect(fields.sort()).toEqual(["Số lượng", "Đơn giá"].sort());
    await a("datahub.row.delete", { table_id: x.tableId, row_id: r.id });
    const h2 = await a("datahub.row.history", { table_id: x.tableId, row_id: r.id });
    const del = h2.items.find((i: { op: string }) => i.op === "delete");
    expect(del.changes.map((c: { field_name: string }) => c.field_name).sort()).toEqual(["Số lượng", "Đơn giá"].sort());
  });
});

describe("creating or editing a formula recomputes the whole column in the worker", () => {
  it("is pending with progress until the worker has run, then ready; rows keep version and updated_at", async () => {
    const x = await makeTable(a, { columns: [{ name: "A", type: "number" }, { name: "B", type: "number" }] });
    for (let i = 1; i <= 30; i++) await a("datahub.row.create", { table_id: x.tableId, data: { A: i, B: 2 } });
    const before = await rows(x.tableId);
    const f = await addFormula(x.tableId, "Tích", "=[A] * [B]");
    expect(f.calc).toMatchObject({ status: "pending" });
    await drainOutbox(t);
    const col = (await a("datahub.table.get", { table_id: x.tableId })).columns.find((c: { key: string }) => c.key === f.key);
    expect(col.calc).toMatchObject({ status: "ready", done: 30, total: 30 });
    const after = await rows(x.tableId);
    expect(after.map((r) => r.data[f.key])).toEqual(Array.from({ length: 30 }, (_, i) => (i + 1) * 2));
    // No version, no updated_at, no history, no audit rows from the recalculation.
    expect(after.map((r) => r.version)).toEqual(before.map((r) => r.version));
    expect(after.map((r) => r.updated_at)).toEqual(before.map((r) => r.updated_at));
    expect(Number((await q(`SELECT count(*) FROM row_history WHERE table_id = $1`, [x.tableId]))[0]!.count)).toBe(30);
    // Editing the formula recomputes again.
    const u = await a("datahub.column.update", { table_id: x.tableId, column: f.key, config: { formula: "=[A] + [B]" } });
    expect(u.calc.status).toBe("pending");
    await drainOutbox(t);
    expect((await rows(x.tableId)).map((r) => r.data[f.key])).toEqual(Array.from({ length: 30 }, (_, i) => i + 3));
    expect(Number((await q(`SELECT count(*) FROM row_history WHERE table_id = $1`, [x.tableId]))[0]!.count)).toBe(30);
  });

  it("a formula that is edited shows its text with current names; renaming a column keeps it working", async () => {
    const x = await makeTable(a, { columns: [{ name: "Giá", type: "number" }] });
    const f = await addFormula(x.tableId, "Gấp đôi", "=[Giá]*2");
    await a("datahub.column.update", { table_id: x.tableId, column: "Giá", name: "Đơn giá mới" });
    const cols = (await a("datahub.table.get", { table_id: x.tableId })).columns;
    expect(cols.find((c: { key: string }) => c.key === f.key).config.formula).toBe("=[Đơn giá mới]*2");
    expect(cols.find((c: { key: string }) => c.key === f.key).config.expr).toBeUndefined();
    const r = await a("datahub.row.create", { table_id: x.tableId, data: { "Đơn giá mới": 21 } });
    expect(r.data[f.key]).toBe(42);
  });
});

describe("save-time checks", () => {
  it("rejects bad syntax, unknown names, functions and argument counts with a position and a Vietnamese message", async () => {
    const x = await makeTable(a, { columns: [{ name: "A", type: "number" }] });
    const bad = async (formula: string, msg: RegExp) => {
      const e = await fails(addFormula(x.tableId, `F ${Math.random()}`, formula));
      expect(e.code).toBe("validation_error");
      expect(e.message).toMatch(msg);
      return e;
    };
    const e = await bad("=IF([A] > 1, 2", /Thiếu dấu đóng ngoặc/);
    expect(e.details.position.start).toBeGreaterThan(0);
    await bad("=[Không có] + 1", /Không có cột "Không có"/);
    await bad("=FOO([A])", /Hàm FOO không tồn tại/);
    await bad("=IF([A])", /cần từ 2 đến 3 đối số/);
    await bad("=[Bảng lạ].[X]", /Không có bảng "Bảng lạ"/);
    await bad("=", /đang trống|Công thức/);
    // a column cannot read itself
    const f = await addFormula(x.tableId, "Tự", "=[A]+1");
    const e2 = await fails(a("datahub.column.update", { table_id: x.tableId, column: f.key, config: { formula: "=[Tự] + 1" } }));
    expect(e2.message).toContain("#CYCLE!");
  });

  it("blocks cycles across columns and tables", async () => {
    const dh = await a("datahub.datahub.create", { name: `Vòng ${Math.random()}` });
    const t1 = await a("datahub.table.create", { datahub_id: dh.id, name: "B1" });
    const t2 = await a("datahub.table.create", { datahub_id: dh.id, name: "B2" });
    await a("datahub.column.create", { table_id: t1.id, name: "X", type: "number" });
    await a("datahub.column.create", { table_id: t2.id, name: "Y", type: "number" });
    const f1 = await addFormula(t1.id, "F1", "=[X] + 1");
    const f2 = await addFormula(t1.id, "F2", "=[F1] + 1");
    // F1 -> F2 would close F1 -> F2 -> F1
    const e = await fails(a("datahub.column.update", { table_id: t1.id, column: f1.key, config: { formula: "=[F2] + 1" } }));
    expect(e.message).toMatch(/vòng tròn/);
    expect(e.message).toContain("F1");
    // across tables: B2.G reads B1.F2 (sum of the column); then B1.F2 may not read B2.G
    const g = await addFormula(t2.id, "G", "=SUM([B1].[F2])");
    const e2 = await fails(a("datahub.column.update", { table_id: t1.id, column: f2.key, config: { formula: "=SUM([B2].[G])" } }));
    expect(e2.details.code).toBe("#CYCLE!");
    void g;
  });

  it("only the owner's own datahubs can be referenced: someone else's datahub is not found, even when shared (#PERM!)", async () => {
    const mine = await makeTable(a, { name: `Của tôi ${Math.random()}`, columns: [{ name: "A", type: "number" }] });
    const bName = `Của B ${Math.random()}`;
    const b = as(t, org.userA2.id);
    const theirs = await makeTable(b, { name: bName, columns: [{ name: "Tiền", type: "number" }] });
    await b("datahub.share.set", { datahub_id: theirs.dhId, grantee_id: org.userA1.id, permission: "edit_data" });
    expect((await a("datahub.table.get", { table_id: theirs.tableId })).name).toBeTruthy(); // A1 can read it ...
    const e = await fails(addFormula(mine.tableId, "Lấy trộm", `=SUM([${bName}].[Bảng 1].[Tiền])`)); // ... but not use it in a formula
    expect(e.code).toBe("validation_error");
    expect(e.message).toContain("#PERM!");
    // nor can a relation point at it
    const e2 = await fails(a("datahub.column.create", { table_id: mine.tableId, name: "Liên kết", type: "relation", config: { target_table_id: theirs.tableId } }));
    expect(e2.details.code).toBe("#PERM!");
  });

  it("scan-only conditions are refused on source tables above 20,000 rows; equality conditions are allowed (grouped SQL)", async () => {
    const dh = await a("datahub.datahub.create", { name: `Lớn ${Math.random()}` });
    const big = await a("datahub.table.create", { datahub_id: dh.id, name: "Lớn" });
    const small = await a("datahub.table.create", { datahub_id: dh.id, name: "Nhỏ" });
    const bk = await a("datahub.column.create", { table_id: big.id, name: "Mã", type: "text" });
    await a("datahub.column.create", { table_id: big.id, name: "Số", type: "number" });
    await a("datahub.column.create", { table_id: big.id, name: "Ngày", type: "date" });
    await a("datahub.column.create", { table_id: small.id, name: "Mã", type: "text" });
    await a("datahub.column.create", { table_id: small.id, name: "Ngày", type: "date" });
    await q(`UPDATE dh_tables SET row_count = 20001 WHERE id = $1`, [big.id]);
    const e = await fails(addFormula(small.id, "Đếm", '=COUNTIFS([Lớn].[Ngày], ">="&[Ngày])'));
    expect(e.details.code).toBe("scan_too_large");
    expect(e.message).toContain("20.000");
    const e2 = await fails(addFormula(small.id, "Đếm2", '=COUNTIFS([Lớn].[Mã], "POD*")'));
    expect(e2.details.code).toBe("scan_too_large");
    await addFormula(small.id, "Đếm đúng", "=COUNTIFS([Lớn].[Mã], [Mã])"); // equality: grouped SQL, any size
    await addFormula(small.id, "Tổng", "=SUMIFS([Lớn].[Số], [Lớn].[Mã], [Mã])");
    await addFormula(small.id, "Tên", '=XLOOKUP([Mã], [Lớn].[Mã], [Lớn].[Mã], "-")');
    void bk;
  });
});

describe("formulas across tables and datahubs (worker)", () => {
  let dhA: { id: string };
  let customers: { id: string };
  let deals: { id: string };
  let key: Record<string, string>;
  let other: Awaited<ReturnType<typeof makeTable>>;
  const mkRow = (tableId: string, data: Record<string, unknown>) => a("datahub.row.create", { table_id: tableId, data });

  beforeAll(async () => {
    dhA = await a("datahub.datahub.create", { name: `Kinh doanh ${Math.random()}` });
    customers = await a("datahub.table.create", { datahub_id: dhA.id, name: "Khách hàng" });
    deals = await a("datahub.table.create", { datahub_id: dhA.id, name: "Deals" });
    key = {};
    for (const [tbl, name, type] of [
      [customers.id, "Mã", "text"], [customers.id, "Tên", "text"], [customers.id, "Hạng", "number"],
      [deals.id, "Mã KH", "text"], [deals.id, "Doanh thu", "currency"], [deals.id, "Trạng thái", "text"],
    ] as const) key[`${tbl === customers.id ? "KH" : "D"}.${name}`] = (await a("datahub.column.create", { table_id: tbl, name, type })).key;
    other = await makeTable(a, { name: `Thanh toán ${Math.random()}`, columns: [{ name: "Mã KH", type: "text" }, { name: "Số tiền", type: "currency" }] });
    for (const [m, n, h] of [["KH1", "Công ty A", 1], ["KH2", "Công ty B", 2]] as const) await mkRow(customers.id, { Mã: m, Tên: n, Hạng: h });
    for (const [m, v, s] of [["KH1", 100, "Won"], ["KH1", 50, "Lost"], ["kh2", 70, "Won"], ["KH9", 5, "Won"]] as const) await mkRow(deals.id, { "Mã KH": m, "Doanh thu": v, "Trạng thái": s });
    await mkRow(other.tableId, { "Mã KH": "KH1", "Số tiền": 1000 });
    await mkRow(other.tableId, { "Mã KH": "KH1", "Số tiền": 500 });
  });

  it("XLOOKUP, SUMIFS and COUNTIFS from another table and from another datahub of the same owner", async () => {
    const name = await addFormula(deals.id, "Tên KH", '=XLOOKUP([Mã KH], [Khách hàng].[Mã], [Khách hàng].[Tên], "(chưa có)")');
    const total = await addFormula(customers.id, "Doanh thu", "=SUMIFS([Deals].[Doanh thu], [Deals].[Mã KH], [Mã])");
    const won = await addFormula(customers.id, "Deal thắng", '=COUNTIFS([Deals].[Mã KH], [Mã], [Deals].[Trạng thái], "Won")');
    const paid = await addFormula(customers.id, "Đã thanh toán", `=SUMIFS([${other.dh.name}].[Bảng 1].[Số tiền], [${other.dh.name}].[Bảng 1].[Mã KH], [Mã])`);
    const ratio = await addFormula(customers.id, "Tỉ lệ thu", '=IFERROR([Đã thanh toán] / [Doanh thu], "")');
    await drainOutbox(t);
    const dealRows = await rows(deals.id);
    expect(dealRows.map((r) => r.data[name.key])).toEqual(["Công ty A", "Công ty A", "Công ty B", "(chưa có)"]); // "kh2" matches KH2: text equality ignores case
    const cust = await rows(customers.id);
    expect(cust.map((r) => [r.data[total.key], r.data[won.key], r.data[paid.key], r.data[ratio.key]])).toEqual([
      [150, 1, 1500, 10],
      [70, 1, 0, 0],
    ]);
  });

  it("editing the source table recomputes the dependants (worker), and the change is a signal for open tables", async () => {
    const total = (await a("datahub.table.get", { table_id: customers.id })).columns.find((c: { name: string }) => c.name === "Doanh thu");
    const d = (await rows(deals.id)).find((r) => r.data[key["D.Doanh thu"]!] === 100)!;
    await a("datahub.row.update", { table_id: deals.id, row_id: d.id, data: { "Doanh thu": 400 }, version: d.version });
    await drainOutbox(t);
    expect((await rows(customers.id))[0]!.data[total.key]).toBe(450);
    // a new deal for KH2
    await mkRow(deals.id, { "Mã KH": "KH2", "Doanh thu": 30, "Trạng thái": "Won" });
    await drainOutbox(t);
    expect((await rows(customers.id))[1]!.data[total.key]).toBe(100);
    // deleting a deal
    const gone = (await rows(deals.id)).find((r) => r.data[key["D.Doanh thu"]!] === 30)!;
    await a("datahub.row.delete", { table_id: deals.id, row_id: gone.id });
    await drainOutbox(t);
    expect((await rows(customers.id))[1]!.data[total.key]).toBe(70);
    // the recalculation announced itself to the people who can see the table
    const ev = await q(`SELECT payload FROM outbox WHERE event = 'datahub.formula.recalculated' AND payload->>'table_id' = $1 AND payload->>'state' = 'done' AND (payload->>'changed_rows')::int > 0`, [customers.id]);
    expect(ev.length).toBeGreaterThan(0);
  });

  it("a new row gets its cross-table value from the worker, not from the API", async () => {
    const name = (await a("datahub.table.get", { table_id: deals.id })).columns.find((c: { name: string }) => c.name === "Tên KH");
    const r = await mkRow(deals.id, { "Mã KH": "KH2", "Doanh thu": 1, "Trạng thái": "Won" });
    expect(r.data[name.key]).toBeUndefined(); // not there yet
    const pending = (await a("datahub.table.get", { table_id: deals.id })).columns.find((c: { name: string }) => c.name === "Tên KH");
    expect(pending.calc.status).toBe("pending"); // queued in the writing transaction (design 6.7)
    await drainOutbox(t);
    expect((await a("datahub.row.get", { table_id: deals.id, row_id: r.id })).data[name.key]).toBe("Công ty B");
  });

  it("recalculation writes no history, no audit, no version bump (design 6.5)", async () => {
    const auditBefore = Number((await q(`SELECT count(*) FROM audit_log WHERE command LIKE 'datahub.%'`))[0]!.count);
    const row = (await rows(customers.id))[0]!;
    const d = (await rows(deals.id)).find((r) => r.data[key["D.Doanh thu"]!] === 400)!;
    await a("datahub.row.update", { table_id: deals.id, row_id: d.id, data: { "Doanh thu": 410 }, version: d.version });
    const auditMid = Number((await q(`SELECT count(*) FROM audit_log WHERE command LIKE 'datahub.%'`))[0]!.count);
    await drainOutbox(t);
    const auditAfter = Number((await q(`SELECT count(*) FROM audit_log WHERE command LIKE 'datahub.%'`))[0]!.count);
    expect(auditAfter).toBe(auditMid); // the worker's recalculation logged nothing
    expect(auditMid).toBeGreaterThan(auditBefore);
    const after = (await rows(customers.id))[0]!;
    expect(after.version).toBe(row.version);
    expect(after.updated_at).toBe(row.updated_at);
    expect(Object.values(after.data)).toContain(460);
    const hist = await q(`SELECT count(*) FROM row_history WHERE row_id = $1`, [row.id]);
    expect(Number(hist[0]!.count)).toBe(1); // only the creation
  });

  it("a deleted column or table gives #REF!, and restoring it brings the values back", async () => {
    const dep = await addFormula(customers.id, "Dùng KH", "=SUM([Deals].[Doanh thu])");
    await drainOutbox(t);
    expect((await rows(customers.id))[0]!.data[dep.key]).toBeGreaterThan(0);
    await a("datahub.column.delete", { table_id: deals.id, column: "Doanh thu" });
    await drainOutbox(t);
    expect((await rows(customers.id))[0]!.data[dep.key]).toBe("#REF!");
    await a("datahub.column.restore", { table_id: deals.id, column: key["D.Doanh thu"] });
    await drainOutbox(t);
    expect((await rows(customers.id))[0]!.data[dep.key]).toBeGreaterThan(0);
    await a("datahub.table.delete", { table_id: deals.id });
    await drainOutbox(t);
    expect((await rows(customers.id))[0]!.data[dep.key]).toBe("#REF!");
    await a("datahub.table.restore", { table_id: deals.id });
    await drainOutbox(t);
    expect((await rows(customers.id))[0]!.data[dep.key]).toBeGreaterThan(0);
  });

  it("a formula whose table now belongs to someone else shows #PERM! (checked at every calculation)", async () => {
    const dep = await addFormula(customers.id, "Tổng thanh toán", `=SUM([${other.dh.name}].[Bảng 1].[Số tiền])`);
    await drainOutbox(t);
    expect((await rows(customers.id))[0]!.data[dep.key]).toBe(1500);
    // The datahub changes owner (what a data transfer does): its "owner_changed" event makes the dependants recompute.
    await q(`UPDATE dh_datahubs SET owner_id = $1 WHERE id = $2`, [org.userA2.id, other.dhId]);
    await enqueueOutbox(t.c.db.db, { event: "datahub.structure.changed", aggregateType: "datahub", aggregateId: other.dhId, payload: { datahub_id: other.dhId, table_id: null, change: "owner_changed" } });
    await drainOutbox(t);
    expect((await rows(customers.id))[0]!.data[dep.key]).toBe("#PERM!");
    await q(`UPDATE dh_datahubs SET owner_id = $1 WHERE id = $2`, [org.userA1.id, other.dhId]);
  });
});

describe("TODAY() and NOW() columns", () => {
  it("are recomputed after midnight (00:05 Vietnam time) and hourly, with catch-up, without logging", async () => {
    const x = await makeTable(a, { columns: [{ name: "Hạn", type: "date" }] });
    const left = await addFormula(x.tableId, "Còn lại", "=DATEDIF(TODAY(), [Hạn], \"D\")");
    const stamp = await addFormula(x.tableId, "Giờ", "=NOW()");
    const r = await a("datahub.row.create", { table_id: x.tableId, data: { Hạn: "2030-01-10" } });
    await drainOutbox(t);
    const day1 = (await a("datahub.row.get", { table_id: x.tableId, row_id: r.id })).data;
    const col = (await a("datahub.table.get", { table_id: x.tableId })).columns.find((c: { key: string }) => c.key === left.key);
    expect(col.calc.status).toBe("ready");
    const d1 = day1[left.key] as number;
    // markVolatilePending is global (every table in the shared DB), so assert on this table's own columns only.
    // A volatile column of another table (e.g. the Đợt thanh toán default template) must not change the result: add one that stays stale.
    const other = await makeTable(a, { columns: [{ name: "Hạn", type: "date" }] });
    await addFormula(other.tableId, "Hôm nay", "=TODAY()");
    await drainOutbox(t);
    const ownDue = async (now: Date): Promise<number> => {
      await markVolatilePending(t.c.db.db, now);
      return Number((await q(`SELECT count(*) FROM dh_columns WHERE table_id = $1 AND deleted_at IS NULL AND calc_status = 'pending'`, [x.tableId]))[0]!.count);
    };
    // Nothing is due right now.
    expect(await ownDue(new Date())).toBe(0);
    // Tomorrow 00:04 Vietnam time: the TODAY() job has not run yet; the hourly NOW() column is due.
    const vn = new Date(Date.now() + 7 * 3_600_000);
    const at0004 = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + 1, 0, 4) - 7 * 3_600_000);
    expect(await ownDue(at0004)).toBe(1);
    await drainOutbox(t, { now: at0004 });
    // 00:05 and later: TODAY() columns are due too (also covers "worker started after the missed run").
    const at0006 = new Date(at0004.getTime() + 2 * 60_000);
    expect(await ownDue(at0006)).toBe(1);
    await drainOutbox(t, { now: at0006 });
    const day2 = (await a("datahub.row.get", { table_id: x.tableId, row_id: r.id })).data;
    expect(day2[left.key] as number).toBeLessThan(d1);
    expect(day2[stamp.key]).not.toBe(day1[stamp.key]);
    expect(Number((await q(`SELECT count(*) FROM row_history WHERE table_id = $1`, [x.tableId]))[0]!.count)).toBe(1);
    // After the catch-up nothing is due until the next boundary.
    expect(await ownDue(at0006)).toBe(0);
  });
});

describe("relation, lookup and rollup", () => {
  it("links rows of another table of the same owner; lookup and rollup follow them", async () => {
    const dh = await a("datahub.datahub.create", { name: `Liên kết ${Math.random()}` });
    const cust = await a("datahub.table.create", { datahub_id: dh.id, name: "KH" });
    const ord = await a("datahub.table.create", { datahub_id: dh.id, name: "Đơn" });
    await a("datahub.column.create", { table_id: cust.id, name: "Tên", type: "text" });
    await a("datahub.column.create", { table_id: cust.id, name: "Hạng", type: "number" });
    await a("datahub.column.create", { table_id: ord.id, name: "Tiền", type: "currency" });
    const link = await a("datahub.column.create", { table_id: ord.id, name: "Khách", type: "relation", config: { target_table_id: cust.id, multiple: false } });
    const links = await a("datahub.column.create", { table_id: cust.id, name: "Đơn hàng", type: "relation", config: { target_table_id: ord.id } });
    const look = await a("datahub.column.create", { table_id: ord.id, name: "Tên KH", type: "lookup", config: { relation: "Khách", target_column: "Tên" } });
    const sum = await a("datahub.column.create", { table_id: cust.id, name: "Tổng tiền", type: "rollup", config: { relation: "Đơn hàng", target_column: "Tiền", fn: "sum" } });
    const cnt = await a("datahub.column.create", { table_id: cust.id, name: "Số đơn", type: "rollup", config: { relation: "Đơn hàng", target_column: "Tiền", fn: "count" } });
    const names = await a("datahub.column.create", { table_id: ord.id, name: "Mọi tên", type: "lookup", config: { relation: "Khách", target_column: "Tên" } });
    void names;
    expect(look.config).toMatchObject({ relation: "Khách", target_column: "Tên", result_type: "text" });
    expect(sum.config.result_type).toBe("number");
    const c1 = await a("datahub.row.create", { table_id: cust.id, data: { Tên: "An", Hạng: 1 } });
    const c2 = await a("datahub.row.create", { table_id: cust.id, data: { Tên: "Bình", Hạng: 2 } });
    const o1 = await a("datahub.row.create", { table_id: ord.id, data: { Tiền: 100, Khách: [c1.id] } });
    const o2 = await a("datahub.row.create", { table_id: ord.id, data: { Tiền: 250, Khách: [c1.id] } });
    const o3 = await a("datahub.row.create", { table_id: ord.id, data: { Tiền: 40, Khách: [c2.id] } });
    // a single relation takes one row only; the id must be a live row of the target table
    expect((await fails(a("datahub.row.create", { table_id: ord.id, data: { Khách: [c1.id, c2.id] } }))).message).toContain("chỉ liên kết được một dòng");
    expect((await fails(a("datahub.row.create", { table_id: ord.id, data: { Khách: [o1.id] } }))).message).toContain("không tồn tại");
    // the other direction (many) is set by hand here
    await a("datahub.row.update", { table_id: cust.id, row_id: c1.id, data: { "Đơn hàng": [o1.id, o2.id] }, version: c1.version });
    await a("datahub.row.update", { table_id: cust.id, row_id: c2.id, data: { "Đơn hàng": [o3.id] }, version: c2.version });
    await drainOutbox(t);
    const ordRows = await rows(ord.id);
    expect(ordRows.map((r) => r.data[look.key])).toEqual(["An", "An", "Bình"]);
    const custRows = await rows(cust.id);
    expect(custRows.map((r) => [r.data[sum.key], r.data[cnt.key]])).toEqual([[350, 2], [40, 1]]);
    // the target changes: lookup and rollup follow
    await a("datahub.row.update", { table_id: cust.id, row_id: c1.id, data: { Tên: "An Nguyễn" }, version: 2 });
    await a("datahub.row.update", { table_id: ord.id, row_id: o2.id, data: { Tiền: 1000 }, version: o2.version });
    await drainOutbox(t);
    expect((await rows(ord.id)).map((r) => r.data[look.key])).toEqual(["An Nguyễn", "An Nguyễn", "Bình"]);
    expect((await rows(cust.id))[0]!.data[sum.key]).toBe(1100);
    // deleting a linked row removes it from the rollup
    await a("datahub.row.delete", { table_id: ord.id, row_id: o1.id });
    await drainOutbox(t);
    expect((await rows(cust.id))[0]!.data[sum.key]).toBe(1000);
    void link;
    void links;
  });

  it("only the owner can write a relation cell; an editor of the shared table cannot", async () => {
    const dh = await a("datahub.datahub.create", { name: `Chia sẻ ${Math.random()}` });
    const tb = await a("datahub.table.create", { datahub_id: dh.id, name: "T" });
    await a("datahub.column.create", { table_id: tb.id, name: "Tên", type: "text" });
    await a("datahub.column.create", { table_id: tb.id, name: "Cha", type: "relation", config: { target_table_id: tb.id } });
    const r = await a("datahub.row.create", { table_id: tb.id, data: { Tên: "x" } });
    await a("datahub.share.set", { datahub_id: dh.id, grantee_id: org.userA2.id, permission: "edit_data" });
    const b = as(t, org.userA2.id);
    const e = await fails(b("datahub.row.create", { table_id: tb.id, data: { Tên: "y", Cha: [r.id] } }));
    expect(e.message).toContain("Chỉ chủ datahub");
    await b("datahub.row.create", { table_id: tb.id, data: { Tên: "y" } }); // normal cells are fine
    await a("datahub.row.create", { table_id: tb.id, data: { Tên: "z", Cha: [r.id] } });
  });

  it("checks the configuration: relation must be a relation column, target column must exist, rollup function fits the type", async () => {
    const dh = await a("datahub.datahub.create", { name: `Cấu hình ${Math.random()}` });
    const t1 = await a("datahub.table.create", { datahub_id: dh.id, name: "A" });
    const t2 = await a("datahub.table.create", { datahub_id: dh.id, name: "B" });
    await a("datahub.column.create", { table_id: t1.id, name: "Chữ", type: "text" });
    await a("datahub.column.create", { table_id: t2.id, name: "Tên", type: "text" });
    await a("datahub.column.create", { table_id: t1.id, name: "Link", type: "relation", config: { target_table_id: t2.id } });
    expect((await fails(a("datahub.column.create", { table_id: t1.id, name: "L1", type: "lookup", config: { relation: "Chữ", target_column: "Tên" } }))).message).toContain("không phải cột Liên kết");
    expect((await fails(a("datahub.column.create", { table_id: t1.id, name: "L2", type: "lookup", config: { relation: "Link", target_column: "Không có" } }))).message).toContain("Không có cột");
    expect((await fails(a("datahub.column.create", { table_id: t1.id, name: "L3", type: "rollup", config: { relation: "Link", target_column: "Tên", fn: "sum" } }))).message).toContain("chỉ dùng cho cột số");
    expect((await fails(a("datahub.column.create", { table_id: t1.id, name: "L4", type: "rollup", config: { relation: "Link", target_column: "Tên" } }))).code).toBe("validation_error");
    const ok = await a("datahub.column.create", { table_id: t1.id, name: "Các tên", type: "rollup", config: { relation: "Link", target_column: "Tên", fn: "concat" } });
    expect(ok.config.result_type).toBe("text");
    // relation target cannot be changed
    const e = await fails(a("datahub.column.update", { table_id: t1.id, column: "Link", config: { target_table_id: t1.id } }));
    expect(e.message).toContain("Không đổi được bảng đích");
  });
});

describe("permissions on computed columns", () => {
  it("only the owner defines them; an editor and a viewer do not; other users do not see the table; formula text is hidden from non-owners", async () => {
    const x = await makeTable(a, { columns: [{ name: "A", type: "number" }] });
    await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.leaderA.id, permission: "view" });
    const f = await addFormula(x.tableId, "Gấp ba", "=[A]*3");
    for (const id of [org.userA2.id, org.leaderA.id]) {
      const who = as(t, id);
      const e = await fails(who("datahub.column.create", { table_id: x.tableId, name: "Lậu", type: "formula", config: { formula: "=1" } }));
      expect(e.code).toBe("forbidden");
      const e2 = await fails(who("datahub.column.update", { table_id: x.tableId, column: f.key, config: { formula: "=2" } }));
      expect(e2.code).toBe("forbidden");
      const col = (await who("datahub.table.get", { table_id: x.tableId })).columns.find((c: { key: string }) => c.key === f.key);
      expect(col.config.formula).toBeUndefined();
      expect(col.config.expr).toBeUndefined();
      expect(col.config.result_type).toBe("number");
    }
    // an editor can edit data, and the formula is computed with the owner's definition
    const editor = as(t, org.userA2.id);
    const r = await editor("datahub.row.create", { table_id: x.tableId, data: { A: 7 } });
    expect(r.data[f.key]).toBe(21);
    // Another user does not even see the table; neither does a Guest or an Admin (no sharing, no extra access).
    const e3 = await fails(as(t, org.userB1.id)("datahub.column.create", { table_id: x.tableId, name: "Lậu", type: "formula", config: { formula: "=1" } }));
    expect(e3.code).toBe("not_found");
    for (const id of [org.guestData.id, org.admin.id]) {
      const e = await fails(as(t, id)("datahub.column.create", { table_id: x.tableId, name: "Lậu", type: "formula", config: { formula: "=1" } }));
      expect(["not_found", "forbidden"]).toContain(e.code);
    }
  });
});

describe("formula API: function catalogue and preview", () => {
  let x: Awaited<ReturnType<typeof makeTable>>;
  beforeAll(async () => {
    x = await makeTable(a, { columns: [{ name: "Giá", type: "currency" }, { name: "Số lượng", type: "number" }, { name: "Ngày", type: "date" }] });
    for (let i = 1; i <= 8; i++) await a("datahub.row.create", { table_id: x.tableId, data: { Giá: i * 100, "Số lượng": i % 3, Ngày: `2026-11-${String(i).padStart(2, "0")}` } });
  });
  const preview = (input: Record<string, unknown>) => a("datahub.formula.preview", { table_id: x.tableId, ...input });

  it("catalogue: about 100 functions, each with group, syntax, Vietnamese description, example; and the error codes", async () => {
    const c = await a("datahub.formula.functions");
    expect(c.functions.length).toBeGreaterThanOrEqual(100);
    const sumifs = c.functions.find((f: { name: string }) => f.name === "SUMIFS");
    expect(sumifs).toMatchObject({ group: "Thống kê", min_args: 3 });
    expect(sumifs.description).toContain("Cộng");
    expect(sumifs.example).toContain("SUMIFS(");
    expect(c.functions.find((f: { name: string }) => f.name === "TODAY").volatile).toBe("today");
    expect(c.functions.find((f: { name: string }) => f.name === "NOW").volatile).toBe("now");
    expect(c.errors.map((e: { code: string }) => e.code)).toEqual(expect.arrayContaining(["#DIV/0!", "#N/A", "#VALUE!", "#REF!", "#CYCLE!", "#PERM!"]));
    expect(c.errors.find((e: { code: string }) => e.code === "#PERM!").message).toContain("cùng chủ");
  });

  it("preview: result on the first 5 rows, with errors per row", async () => {
    const r = await preview({ formula: "=[Giá] / [Số lượng]" });
    expect(r).toMatchObject({ ok: true, formula: "=[Giá] / [Số lượng]", result_type: "number", volatile: null, errors: [] });
    expect(r.rows).toHaveLength(5);
    expect(r.rows.map((i: { value: unknown }) => i.value)).toEqual([100, 100, null, 400, 250]); // row 3: 300 / 0
    expect(r.rows[2]).toMatchObject({ error: "#DIV/0!", value: null });
    expect(r.rows[2].error_message).toContain("Chia cho 0");
    expect(r.reads.columns.sort()).toEqual(["Giá", "Số lượng"]);
    const d = await preview({ formula: "=[Ngày] + 30" });
    expect(d).toMatchObject({ result_type: "date" });
    expect(d.rows[0].value).toBe("2026-12-01");
    expect((await preview({ formula: "=TODAY()" })).volatile).toBe("today");
    expect((await preview({ formula: "=1", result_type: "text" })).rows[0].value).toBe("1");
    // nothing was written
    expect((await a("datahub.table.get", { table_id: x.tableId })).columns).toHaveLength(3);
  });

  it("preview: errors come with the position and a Vietnamese message instead of an HTTP error", async () => {
    const bad = async (formula: string, msg: RegExp, start?: number) => {
      const r = await preview({ formula });
      expect(r.ok).toBe(false);
      expect(r.errors[0].message).toMatch(msg);
      if (start !== undefined) expect(r.errors[0].start).toBe(start);
      expect(r.rows).toEqual([]);
      return r;
    };
    await bad("=IF([Giá] > 1, 2", /Thiếu dấu đóng ngoặc/);
    await bad("=[Giá] + [Không có]", /Không có cột "Không có"/, 9);
    await bad("=FOO(1)", /Hàm FOO không tồn tại/, 1);
    await bad("=SUM()", /cần từ 1 đến nhiều đối số|cần/);
    await bad("=1 +", /cần thêm/, 4);
    // cycle: an existing formula column cannot read itself
    const f = await a("datahub.column.create", { table_id: x.tableId, name: "Tổng", type: "formula", config: { formula: "=[Giá] * 2" } });
    const r = await preview({ formula: "=[Tổng] + 1", column: f.key });
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain("#CYCLE!");
    expect((await preview({ formula: "=[Giá] * 3", column: "Tổng" })).ok).toBe(true);
    expect((await fails(preview({ formula: "=1", column: "Giá" }))).code).toBe("not_found"); // not a formula column
  });

  it("preview: tells which calls use the grouped SQL and which tables are scanned", async () => {
    const r = await preview({ formula: "=COUNTIFS([Bảng 1].[Giá], [Giá]) + SUMIFS([Bảng 1].[Giá], [Bảng 1].[Ngày], \">=\"&[Ngày])" });
    expect(r.ok).toBe(true);
    expect(r.reads.grouped_calls).toBe(1);
    expect(r.reads.scanned_tables).toEqual([{ name: "Bảng 1", rows: 8 }]);
    expect(r.rows[0].value).toBeGreaterThan(0);
  });

  describe("permissions over the web (cookie) and API (token) channels", () => {
    const sessions = new Map<string, WebSession>();
    const tokens = new Map<string, Record<string, string>>();
    type Who = "owner" | "dhView" | "dhEdit" | "leader" | "manager" | "admin" | "other" | "guest";
    const person = (w: Who) => ({ owner: org.userA1, dhView: org.userA2, dhEdit: org.leaderA, leader: org.leaderB, manager: org.mgrB, admin: org.admin, other: org.userB1, guest: org.guestData })[w];
    beforeAll(async () => {
      await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
      await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.leaderA.id, permission: "edit_data" });
    });
    async function call(channel: "web" | "api", who: Who, method: "GET" | "POST", url: string, body?: unknown) {
      const p = person(who);
      let headers: Record<string, string>;
      if (channel === "web") {
        let s = sessions.get(p.id);
        if (!s) sessions.set(p.id, (s = await login(t, p.email)));
        headers = method === "GET" ? s.read : s.write;
      } else {
        let h = tokens.get(p.id);
        if (!h) tokens.set(p.id, (h = (await activeToken(t, p.id, ["datahub:datahub:use"])).headers));
        headers = h;
      }
      return (await t.app.inject({ method, url: `/api/v1${url}`, headers, ...(body ? { payload: body as object } : {}) })).statusCode;
    }
    // [catalogue, preview]: the preview needs the owner of the datahub (it reads the owner's tables); other people do not see the table at all.
    const expected: Record<Who, number[]> = {
      owner: [200, 200], dhView: [200, 403], dhEdit: [200, 403], leader: [200, 404], manager: [200, 404], admin: [200, 404], other: [200, 404], guest: [403, 403],
    };
    for (const channel of ["web", "api"] as const) {
      for (const who of Object.keys(expected) as Who[]) {
        it(`${channel}: ${who}`, async () => {
          const got = [await call(channel, who, "GET", "/datahub/formula-functions"), await call(channel, who, "POST", `/tables/${x.tableId}/formula/preview`, { formula: "=[Giá]" })];
          expect(got).toEqual(expected[who]);
        });
      }
    }
  });
});

describe("SQL export view and trash purge", () => {
  it("the view shows computed columns by their result type; error cells are NULL; purging a column drops its values and errors", async () => {
    const x = await makeTable(a, { columns: [{ name: "Giá", type: "number" }, { name: "Ngày", type: "date" }] });
    await addFormula(x.tableId, "Gấp đôi", "=[Giá] * 2");
    await addFormula(x.tableId, "Chia", "=10 / [Giá]");
    await addFormula(x.tableId, "Hạn", "=[Ngày] + 1");
    await addFormula(x.tableId, "Nhãn", '=IF([Giá] > 5, "lớn", "nhỏ")');
    await addFormula(x.tableId, "Cờ", "=[Giá] > 5");
    await a("datahub.row.create", { table_id: x.tableId, data: { Giá: 0, Ngày: "2026-01-31" } });
    await a("datahub.row.create", { table_id: x.tableId, data: { Giá: 10, Ngày: "2026-02-28" } });
    await drainOutbox(t);
    const view = String((await q(`SELECT sql_view FROM dh_tables WHERE id = $1`, [x.tableId]))[0]!.sql_view);
    const rows = await q(`SELECT * FROM dh_views."${view}" ORDER BY row_no`);
    expect(rows.map((r) => [r["Gấp đôi"], r["Chia"], r["Nhãn"], r["Cờ"]])).toEqual([["0", null, "nhỏ", false], ["20", "1", "lớn", true]]);
    expect(rows.every((r) => r["Hạn"] instanceof Date)).toBe(true); // a real date column in the view
    // purge: the value and the error of a deleted column are removed from the rows
    const chia = (await a("datahub.table.get", { table_id: x.tableId })).columns.find((c: { name: string }) => c.name === "Chia");
    await a("datahub.column.delete", { table_id: x.tableId, column: chia.key });
    await q(`UPDATE dh_columns SET deleted_at = now() - interval '10 days' WHERE id = $1`, [chia.id]);
    const { purgeTrash } = await import("@soe/db");
    const { registerDatahubTrash } = await import("../src/modules/datahub/trash");
    registerDatahubTrash();
    await purgeTrash(t.c.db.db, 7);
    const left = await q(`SELECT count(*) FROM dh_rows WHERE table_id = $1 AND (data ? $2 OR data ? $3)`, [x.tableId, chia.key, `!${chia.key}`]);
    expect(Number(left[0]!.count)).toBe(0);
  });
});

describe("errors in a rolled-up column", () => {
  it("sum/avg/min/max/concat return the first error; count and counta do not; fixing the source clears it", async () => {
    const dh = await a("datahub.datahub.create", { name: `Rollup lỗi ${Math.random()}` });
    const p = await a("datahub.table.create", { datahub_id: dh.id, name: "P" });
    const c = await a("datahub.table.create", { datahub_id: dh.id, name: "C" });
    await a("datahub.column.create", { table_id: c.id, name: "X", type: "number" });
    await a("datahub.column.create", { table_id: c.id, name: "E", type: "formula", config: { formula: "=10 / [X]" } });
    await a("datahub.column.create", { table_id: p.id, name: "Con", type: "relation", config: { target_table_id: c.id } });
    const mk = (fn: string) => a("datahub.column.create", { table_id: p.id, name: `r_${fn}`, type: "rollup", config: { relation: "Con", target_column: "E", fn } });
    const cols: Record<string, { key: string }> = {};
    for (const fn of ["sum", "max", "count", "counta"]) cols[fn] = await mk(fn);
    const c1 = await a("datahub.row.create", { table_id: c.id, data: { X: 2 } });
    const c2 = await a("datahub.row.create", { table_id: c.id, data: { X: 0 } });
    const row = await a("datahub.row.create", { table_id: p.id, data: { Con: [c1.id, c2.id] } });
    await drainOutbox(t);
    const got = (await a("datahub.row.get", { table_id: p.id, row_id: row.id })).data;
    expect([got[cols.sum!.key], got[cols.max!.key], got[cols.count!.key], got[cols.counta!.key]]).toEqual(["#DIV/0!", "#DIV/0!", 1, 2]);
    await a("datahub.row.update", { table_id: c.id, row_id: c2.id, data: { X: 5 }, version: c2.version });
    await drainOutbox(t);
    const fixed = (await a("datahub.row.get", { table_id: p.id, row_id: row.id })).data;
    expect([fixed[cols.sum!.key], fixed[cols.max!.key], fixed[cols.count!.key], fixed[cols.counta!.key]]).toEqual([7, 5, 2, 2]);
  });
});
