import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { processPendingMerges } from "../src/modules/datahub";

/**
 * Stage 3B (Module 3 section 4): the merged table. Read-only, rows copied by the worker from at most 10 source tables of the same owner,
 * columns merged by name or by hand, three ways to remove duplicates, a diagnosis, followed through the outbox, no row history and no audit
 * entry for what the system writes, a lost source keeps the old data and says so, and sharing / organization changes sync again.
 */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let other: ReturnType<typeof as>;
let hub: Awaited<ReturnType<typeof makeTable>>;
let a: Awaited<ReturnType<typeof makeTable>>;
let b: Awaited<ReturnType<typeof makeTable>>;

const db = () => t.c.db.db;
const srcLabel = (t: { dh: { name: string }; table: { name: string } }) => `${t.dh.name} – ${t.table.name}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = async (text: ReturnType<typeof sql>) => (await db().execute(text)).rows as Record<string, unknown>[];

const rowsOf = async (tableId: string) => {
  const r = await owner("datahub.row.list", { table_id: tableId, limit: 500 });
  return r.items as { id: string; row_no: number; version: number; data: Record<string, unknown> }[];
};
const cell = (rows: { data: Record<string, unknown> }[], tbl: { cols: Record<string, { key: string }> }, name: string) => rows.map((r) => r.data[tbl.cols[name]!.key]);
const colKey = async (tableId: string, name: string) => {
  const g = await owner("datahub.table.get", { table_id: tableId });
  return (g.columns as { name: string; key: string }[]).find((c) => c.name === name)!.key;
};

async function createMerged(o: { name?: string; sources?: string[]; columns?: unknown; dedup?: unknown } = {}) {
  const r = await owner("datahub.merge.create", { datahub_id: hub.dhId, name: o.name ?? `Gộp ${Math.random().toString(36).slice(2, 8)}`, sources: o.sources ?? [a.tableId, b.tableId], ...(o.columns ? { columns: o.columns } : {}), ...(o.dedup !== undefined ? { dedup: o.dedup } : {}) });
  await drainOutbox(t);
  return r as { table: { id: string }; merge: { table_id: string } };
}

beforeAll(async () => {
  t = await makeApp({}, { sse: true });
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id, { tables: 60, datahubs: 20 });
  owner = as(t, org.userA1.id);
  other = as(t, org.userA2.id);
  hub = await makeTable(owner, { name: `Tổng hợp ${org.tag}`, columns: [] });
  // Two source tables in two datahubs of the same owner. Same column names (different case/spaces), one with an extra column.
  a = await makeTable(owner, { name: `Nguồn A ${org.tag}`, columns: [{ name: "MST", type: "text" }, { name: "Tên", type: "text" }, { name: "Doanh thu", type: "currency" }, { name: "Loại", type: "single_select", config: { options: [{ name: "POD" }, { name: "DCC" }] } }] });
  b = await makeTable(owner, { name: `Nguồn B ${org.tag}`, columns: [{ name: "mst ", type: "text" }, { name: "TÊN", type: "text" }, { name: "Doanh thu", type: "currency" }, { name: "Ghi chú", type: "long_text" }] });
  await owner("datahub.row.batch", { table_id: a.tableId, ops: [
    { op: "create", data: { MST: "0101", Tên: "An", "Doanh thu": 100, Loại: "POD" } },
    { op: "create", data: { MST: "Đức Anh", Tên: null, "Doanh thu": 50, Loại: "DCC" } },
    { op: "create", data: { MST: "0303", Tên: "Cuối", "Doanh thu": 0 } },
  ] });
  await owner("datahub.row.batch", { table_id: b.tableId, ops: [
    { op: "create", data: { "mst ": "0101 ", TÊN: "An (B)", "Doanh thu": 999, "Ghi chú": "ghi chú B" } },
    { op: "create", data: { "mst ": "duc anh", TÊN: "Đức Anh B", "Doanh thu": 7 } },
    { op: "create", data: { "mst ": "0909", TÊN: "Mới", "Doanh thu": 1 } },
  ] });
}, 90_000);
afterAll(async () => {
  await t.close();
});

describe("create and the first sync", () => {
  it("merges columns of the same name, adds Nguồn and Mã dòng gốc, copies every row, reports the diagnosis", async () => {
    const m = await createMerged({ name: "Gộp cơ bản" });
    const g = await owner("datahub.table.get", { table_id: m.table.id });
    expect(g.kind).toBe("merged");
    expect((g.columns as { name: string }[]).map((c) => c.name)).toEqual(["MST", "Tên", "Doanh thu", "Loại", "Ghi chú", "Nguồn", "Mã dòng gốc"]);
    // Loại is a select in A: it becomes text (the option name) in the merged table; money keeps its type.
    const types = Object.fromEntries((g.columns as { name: string; type: string }[]).map((c) => [c.name, c.type]));
    expect(types).toMatchObject({ MST: "text", Tên: "text", "Doanh thu": "currency", Loại: "text", "Ghi chú": "long_text", Nguồn: "text", "Mã dòng gốc": "text" });
    const rows = await rowsOf(m.table.id);
    expect(rows).toHaveLength(6);
    const mst = await colKey(m.table.id, "MST");
    const src = await colKey(m.table.id, "Nguồn");
    const origin = await colKey(m.table.id, "Mã dòng gốc");
    const loai = await colKey(m.table.id, "Loại");
    expect(rows.map((r) => r.data[mst]).sort()).toEqual(["0101", "0101", "0303", "0909", "duc anh", "Đức Anh"].sort());
    expect(rows.filter((r) => r.data[src] === srcLabel(a)).length).toBe(3);
    expect(rows.find((r) => r.data[mst] === "Đức Anh")!.data[loai]).toBe("DCC");
    const aRows = (await rowsOf(a.tableId)).map((r) => r.id);
    expect(rows.filter((r) => r.data[src] === srcLabel(a)).map((r) => r.data[origin]).sort()).toEqual([...aRows].sort());
    const info = await owner("datahub.merge.get", { table_id: m.table.id });
    expect(info).toMatchObject({ status: "ok", syncing: false, errors: [] });
    expect(info.diagnostics).toMatchObject({ total_read: 6, total_kept: 6, dropped: 0 });
    expect(info.diagnostics.summary).toContain("Chưa có khoá chống trùng");
    expect(info.diagnostics.warnings.map((w: { code: string }) => w.code)).toContain("no_key");
    expect((await owner("datahub.table.get", { table_id: m.table.id })).row_count).toBe(6);
  });

  it("is idempotent: syncing again changes nothing (same row ids, no new events)", async () => {
    const m = await createMerged({ name: "Gộp lặp", dedup: { columns: ["MST"], strategy: "priority" } });
    const before = (await rowsOf(m.table.id)).map((r) => r.id).sort();
    await owner("datahub.merge.sync", { table_id: m.table.id });
    const since = new Date();
    await drainOutbox(t);
    expect((await rowsOf(m.table.id)).map((r) => r.id).sort()).toEqual(before);
    const ev = await q(sql`SELECT event FROM outbox WHERE aggregate_id = ${m.table.id} AND created_at >= ${since.toISOString()}::timestamptz AND event LIKE 'datahub.row.%'`);
    expect(ev).toEqual([]);
  });

  it("explicit column mapping joins columns of different names", async () => {
    const x = await makeTable(owner, { name: `X ${org.tag}`, columns: [{ name: "Công ty", type: "text" }, { name: "Tiền", type: "currency" }] });
    await owner("datahub.row.create", { table_id: x.tableId, data: { "Công ty": "Zed", Tiền: 5 } });
    const m = await createMerged({
      sources: [a.tableId, x.tableId],
      columns: [
        { name: "Khách", from: { [a.tableId]: "Tên", [x.tableId]: "Công ty" } },
        { name: "Số tiền", from: { [a.tableId]: "Doanh thu", [x.tableId]: "Tiền" } },
      ],
    });
    const rows = await rowsOf(m.table.id);
    expect(rows).toHaveLength(4);
    expect(cell(rows, { cols: { Khách: { key: await colKey(m.table.id, "Khách") } } }, "Khách")).toContain("Zed");
    expect(await fails(createMerged({ sources: [a.tableId, x.tableId], columns: [{ name: "Lẫn", from: { [a.tableId]: "Tên", [x.tableId]: "Tiền" } }] }))).toMatchObject({ code: "validation_error", details: { reason: "incompatible_types" } });
  });
});

describe("de-duplication (three ways)", () => {
  it("priority: the higher source wins, accents, case and spaces ignored", async () => {
    const m = await createMerged({ dedup: { columns: ["MST"], strategy: "priority" } });
    const rows = await rowsOf(m.table.id);
    expect(rows).toHaveLength(4); // 0101 and Đức Anh joined
    const tenKey = await colKey(m.table.id, "Tên");
    const mstKey = await colKey(m.table.id, "MST");
    const an = rows.find((r) => r.data[mstKey] === "0101")!;
    expect(an.data[tenKey]).toBe("An");
    const info = await owner("datahub.merge.get", { table_id: m.table.id });
    expect(info.diagnostics).toMatchObject({ total_read: 6, total_kept: 4, dropped: 2, duplicate_groups: 2 });
    expect(info.diagnostics.summary).toBe("Gộp 2 bảng: 4 dòng, loại 2 dòng trùng khoá (2 nhóm trùng).");
    const dup = await owner("datahub.merge.duplicates", { table_id: m.table.id });
    expect(dup.total).toBe(2);
    expect(dup.groups[0].rows.some((r: { kept: boolean }) => r.kept)).toBe(true);
    expect(dup.groups[0].rows).toHaveLength(2);
  });

  it("latest: the most recently edited row wins", async () => {
    // B's "0101" row is edited after A's: it wins.
    const rb = (await rowsOf(b.tableId)).find((r) => r.data[b.cols["mst "]!.key] === "0101")!;
    await owner("datahub.row.update", { table_id: b.tableId, row_id: rb.id, data: { TÊN: "An (B) mới" }, version: rb.version });
    const m = await createMerged({ dedup: { columns: ["MST"], strategy: "latest" } });
    const rows = await rowsOf(m.table.id);
    const tenKey = await colKey(m.table.id, "Tên");
    const mstKey = await colKey(m.table.id, "MST");
    expect(rows.find((r) => String(r.data[mstKey]).trim() === "0101")!.data[tenKey]).toBe("An (B) mới");
  });

  it("cell_merge: each cell takes the first non-empty value in priority order", async () => {
    const m = await createMerged({ dedup: { columns: ["MST"], strategy: "cell_merge" } });
    const rows = await rowsOf(m.table.id);
    const tenKey = await colKey(m.table.id, "Tên");
    const mstKey = await colKey(m.table.id, "MST");
    const noteKey = await colKey(m.table.id, "Ghi chú");
    const duc = rows.find((r) => r.data[mstKey] === "Đức Anh")!;
    expect(duc.data[tenKey]).toBe("Đức Anh B"); // empty in A, filled from B
    const an = rows.find((r) => r.data[mstKey] === "0101")!;
    expect(an.data[noteKey]).toBe("ghi chú B"); // only B has it
  });

  it("rows with an empty key are kept, never merged with each other", async () => {
    const x = await makeTable(owner, { name: `Rỗng ${org.tag}`, columns: [{ name: "MST", type: "text" }, { name: "Tên", type: "text" }] });
    await owner("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "create", data: { Tên: "r1" } }, { op: "create", data: { Tên: "r2" } }, { op: "create", data: { MST: " ", Tên: "r3" } }] });
    const m = await createMerged({ sources: [x.tableId], dedup: { columns: ["MST"], strategy: "priority" } });
    expect(await rowsOf(m.table.id)).toHaveLength(3);
    expect((await owner("datahub.merge.get", { table_id: m.table.id })).diagnostics.empty_key_rows).toBe(3);
  });
});

describe("follows the sources", () => {
  it("source edits, new rows and deleted rows reach the merged table through the outbox; row ids stay", async () => {
    const x = await makeTable(owner, { name: `Theo ${org.tag}`, columns: [{ name: "MST", type: "text" }, { name: "Tiền", type: "number" }] });
    await owner("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "create", data: { MST: "1", Tiền: 10 } }, { op: "create", data: { MST: "2", Tiền: 20 } }] });
    const m = await createMerged({ sources: [x.tableId], dedup: { columns: ["MST"], strategy: "priority" } });
    const money = await colKey(m.table.id, "Tiền");
    const mst = await colKey(m.table.id, "MST");
    let rows = await rowsOf(m.table.id);
    const id1 = rows.find((r) => r.data[mst] === "1")!.id;
    const srcRows = await rowsOf(x.tableId);

    await owner("datahub.row.update", { table_id: x.tableId, row_id: srcRows.find((r) => r.data[x.cols["MST"]!.key] === "1")!.id, data: { Tiền: 11 }, version: 1 });
    await owner("datahub.row.create", { table_id: x.tableId, data: { MST: "3", Tiền: 30 } });
    await owner("datahub.row.delete", { table_id: x.tableId, row_id: srcRows.find((r) => r.data[x.cols["MST"]!.key] === "2")!.id });
    await drainOutbox(t);
    rows = await rowsOf(m.table.id);
    expect(rows.map((r) => [r.data[mst], r.data[money]]).sort()).toEqual([["1", 11], ["3", 30]]);
    expect(rows.find((r) => r.data[mst] === "1")!.id).toBe(id1);
    expect((await owner("datahub.table.get", { table_id: m.table.id })).row_count).toBe(2);

    // the row that disappeared comes back: same merged row (restored), not a second one
    await owner("datahub.row.restore", { table_id: x.tableId, row_id: srcRows.find((r) => r.data[x.cols["MST"]!.key] === "2")!.id });
    await drainOutbox(t);
    expect((await rowsOf(m.table.id)).map((r) => r.data[mst]).sort()).toEqual(["1", "2", "3"]);
    expect((await owner("datahub.table.get", { table_id: m.table.id })).row_count).toBe(3);
  });

  it("a computed value of a source (formula) is copied as a plain value and follows its recalculation", async () => {
    const x = await makeTable(owner, { name: `Công thức ${org.tag}`, columns: [{ name: "MST", type: "text" }, { name: "N", type: "number" }, { name: "Gấp đôi", type: "formula", config: { formula: "=[N]*2", result_type: "number" } }] });
    await owner("datahub.row.create", { table_id: x.tableId, data: { MST: "f", N: 4 } });
    await drainOutbox(t);
    const m = await createMerged({ sources: [x.tableId] });
    const dk = await colKey(m.table.id, "Gấp đôi");
    expect((await rowsOf(m.table.id))[0]!.data[dk]).toBe(8);
    expect((await owner("datahub.table.get", { table_id: m.table.id })).columns.find((c: { name: string }) => c.name === "Gấp đôi").type).toBe("number");
  });

  it("formula columns added on the merged table compute over its rows and follow the sync", async () => {
    const x = await makeTable(owner, { name: `Trên ${org.tag}`, columns: [{ name: "N", type: "number" }] });
    await owner("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "create", data: { N: 1 } }, { op: "create", data: { N: 2 } }] });
    const mergedName = `Gộp trên ${org.tag}`;
    const m = await createMerged({ name: mergedName, sources: [x.tableId] });
    const f = await owner("datahub.column.create", { table_id: m.table.id, name: "Bình phương", type: "formula", config: { formula: "=[N]*[N]", result_type: "number" } });
    const total = await owner("datahub.column.create", { table_id: m.table.id, name: "Tổng cột", type: "formula", config: { formula: `=SUM([${mergedName}].[N])`, result_type: "number" } });
    await drainOutbox(t);
    expect((await rowsOf(m.table.id)).map((r) => r.data[f.key]).sort()).toEqual([1, 4]);
    await owner("datahub.row.create", { table_id: x.tableId, data: { N: 3 } });
    await drainOutbox(t);
    const rows = await rowsOf(m.table.id);
    expect(rows.map((r) => r.data[f.key]).sort()).toEqual([1, 4, 9]);
    expect(rows.every((r) => r.data[total.key] === 6)).toBe(true);
    // The owner cannot add a data column to the merged table.
    expect(await fails(owner("datahub.column.create", { table_id: m.table.id, name: "Tay", type: "text" }))).toMatchObject({ code: "forbidden", details: { reason: "merged_table_columns" } });
  });
});

describe("read-only, and written by the system without a trace", () => {
  it("nobody writes rows: not the owner, not an editor; their attempts are refused", async () => {
    const m = await createMerged({ name: "Chỉ đọc" });
    const row = (await rowsOf(m.table.id))[0]!;
    const refused = { code: "forbidden", details: { reason: "merged_table_read_only" } };
    expect(await fails(owner("datahub.row.create", { table_id: m.table.id, data: {} }))).toMatchObject(refused);
    expect(await fails(owner("datahub.row.update", { table_id: m.table.id, row_id: row.id, data: {}, version: row.version }))).toMatchObject(refused);
    expect(await fails(owner("datahub.row.delete", { table_id: m.table.id, row_id: row.id }))).toMatchObject(refused);
    expect(await fails(owner("datahub.row.batch", { table_id: m.table.id, ops: [{ op: "create", data: {} }] }))).toMatchObject(refused);
    // Shared as "edit_data" the table is still read-only for the other person.
    await owner("datahub.share.set", { datahub_id: hub.dhId, table_id: m.table.id, grantee_id: org.userA2.id, permission: "edit_data" });
    expect(await fails(other("datahub.row.create", { table_id: m.table.id, data: {} }))).toMatchObject({ code: "forbidden" });
    expect((await other("datahub.table.get", { table_id: m.table.id })).access).toBe("view");
    expect((await other("datahub.row.list", { table_id: m.table.id, limit: 50 })).items).toHaveLength(6);
    // The data columns are managed by the merge.
    const mst = await colKey(m.table.id, "MST");
    expect(await fails(owner("datahub.column.delete", { table_id: m.table.id, column: mst }))).toMatchObject({ code: "forbidden", details: { reason: "merged_table_columns" } });
    expect(await fails(owner("datahub.column.type_change", { table_id: m.table.id, column: mst, type: "email" }))).toMatchObject({ code: "forbidden" });
    await owner("datahub.column.update", { table_id: m.table.id, column: mst, name: "Mã số thuế" }); // a name is free to change
  });

  it("the sync writes no row history, no audit entry, and leaves version and edit time alone", async () => {
    const x = await makeTable(owner, { name: `Vết ${org.tag}`, columns: [{ name: "N", type: "number" }] });
    await owner("datahub.row.create", { table_id: x.tableId, data: { N: 1 } });
    const m = await createMerged({ sources: [x.tableId] });
    const first = (await rowsOf(m.table.id))[0]!;
    const auditBefore = (await q(sql`SELECT count(*)::int AS n FROM audit_log`))[0]!.n as number;
    const row0 = await q(sql`SELECT updated_at, version FROM dh_rows WHERE /*scope:system*/ id = ${first.id}::uuid`);
    await owner("datahub.row.update", { table_id: x.tableId, row_id: (await rowsOf(x.tableId))[0]!.id, data: { N: 2 }, version: 1 });
    const auditMid = (await q(sql`SELECT count(*)::int AS n FROM audit_log`))[0]!.n as number;
    await drainOutbox(t);
    expect((await q(sql`SELECT count(*)::int AS n FROM audit_log`))[0]!.n).toBe(auditMid); // the sync added nothing
    expect(auditMid - auditBefore).toBeLessThanOrEqual(2); // the source edit itself (and nothing more)
    expect(await q(sql`SELECT count(*)::int AS n FROM row_history WHERE /*scope:system*/ table_id = ${m.table.id}`)).toEqual([{ n: 0 }]);
    const row1 = await q(sql`SELECT data, updated_at, version FROM dh_rows WHERE /*scope:system*/ id = ${first.id}::uuid`);
    expect(row1[0]!.version).toBe(row0[0]!.version);
    expect(String(row1[0]!.updated_at)).toBe(String(row0[0]!.updated_at));
    expect((await rowsOf(m.table.id))[0]!.data[await colKey(m.table.id, "N")]).toBe(2);
  });
});

describe("who may create it and from what", () => {
  it("only the owner of the datahub creates and configures; sources must be the owner's own, live, not merged, at most 10", async () => {
    expect(await fails(as(t, org.userB1.id)("datahub.merge.create", { datahub_id: hub.dhId, name: "Của người khác", sources: [a.tableId] }))).toMatchObject({ code: "not_found" });
    // shared with edit rights, still not the owner of the datahub
    const wide = await owner("datahub.share.set", { datahub_id: hub.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    expect(await fails(other("datahub.merge.create", { datahub_id: hub.dhId, name: "Của người khác", sources: [a.tableId] }))).toMatchObject({ code: "forbidden" });
    await owner("datahub.share.remove", { datahub_id: hub.dhId, share_id: wide.id });

    // a table of another owner, even one shared with me, cannot be a source
    const theirs = await makeTable(other, { name: `Của họ ${org.tag}`, columns: [{ name: "MST", type: "text" }] });
    await other("datahub.share.set", { datahub_id: theirs.dhId, grantee_id: org.userA1.id, permission: "view" });
    expect(await fails(owner("datahub.merge.create", { datahub_id: hub.dhId, name: "Nguồn lạ", sources: [a.tableId, theirs.tableId] }))).toMatchObject({ code: "validation_error", details: { reason: "source_not_owned" } });
    // a table nobody shared is not found
    const secret = await makeTable(as(t, org.userB1.id), { name: `Bí mật ${org.tag}`, columns: [{ name: "MST", type: "text" }] });
    expect(await fails(owner("datahub.merge.create", { datahub_id: hub.dhId, name: "Bí mật", sources: [secret.tableId] }))).toMatchObject({ code: "validation_error", details: { reason: "source_not_owned" } });

    const merged = await createMerged();
    expect(await fails(owner("datahub.merge.create", { datahub_id: hub.dhId, name: "Gộp của gộp", sources: [merged.table.id] }))).toMatchObject({ details: { reason: "source_is_merged" } });
    expect(await fails(owner("datahub.merge.create", { datahub_id: hub.dhId, name: "Trùng nguồn", sources: [a.tableId, a.tableId] }))).toMatchObject({ details: { reason: "duplicate_source" } });
    expect(await fails(owner("datahub.merge.create", { datahub_id: hub.dhId, name: "Nhiều", sources: Array.from({ length: 11 }, () => a.tableId) }))).toMatchObject({ code: "validation_error" });
    expect(await fails(owner("datahub.merge.create", { datahub_id: hub.dhId, name: "Khoá lạ", sources: [a.tableId], dedup: { columns: ["Không có"], strategy: "priority" } }))).toMatchObject({ details: { reason: "unknown_key_column" } });
    // another person cannot reconfigure or force a sync
    const viewShare = await owner("datahub.share.set", { datahub_id: hub.dhId, grantee_id: org.userA2.id, permission: "view" });
    expect(await fails(other("datahub.merge.update", { table_id: merged.table.id, sources: [a.tableId] }))).toMatchObject({ code: "forbidden" });
    expect(await fails(other("datahub.merge.sync", { table_id: merged.table.id }))).toMatchObject({ code: "forbidden" });
    expect(await fails(other("datahub.merge.duplicates", { table_id: merged.table.id }))).toMatchObject({ code: "forbidden" });
    // but sees the status, without names or configuration
    const info = await other("datahub.merge.get", { table_id: merged.table.id });
    expect(info).toMatchObject({ status: "ok", config: null });
    expect(info.diagnostics.sources).toEqual([]);
    await owner("datahub.share.remove", { datahub_id: hub.dhId, share_id: viewShare.id });
  });

  it("counts against the table limit of the datahub", async () => {
    const small = await makeTable(owner, { name: `Nhỏ ${org.tag}`, columns: [] });
    const { dhUserLimits } = await import("@soe/db");
    await db().update(dhUserLimits).set({ maxTables: 2 }).where(sql`user_id = ${org.userA1.id}::uuid`);
    try {
      await owner("datahub.merge.create", { datahub_id: small.dhId, name: "Một", sources: [a.tableId] });
      expect(await fails(owner("datahub.merge.create", { datahub_id: small.dhId, name: "Hai", sources: [a.tableId] }))).toMatchObject({ code: "quota_exceeded" });
    } finally {
      await unlimit(t, org.userA1.id, { tables: 60, datahubs: 20 });
    }
  });

  it("update: reorders sources, keeps the key of a column that stays, trashes the ones that go, syncs again", async () => {
    const m = await createMerged({ name: "Đổi cấu hình", dedup: { columns: ["MST"], strategy: "priority" } });
    const before = await owner("datahub.merge.get", { table_id: m.table.id });
    const mstKey = await colKey(m.table.id, "MST");
    await owner("datahub.merge.update", { table_id: m.table.id, sources: [b.tableId, a.tableId], dedup: { columns: ["MST"], strategy: "priority" }, version: before.version });
    await drainOutbox(t);
    expect(await colKey(m.table.id, "MST")).toBe(mstKey);
    const rows = await rowsOf(m.table.id);
    const tenKey = await colKey(m.table.id, "Tên");
    expect(rows.find((r) => r.data[mstKey] === "0101")!.data[tenKey]).toBe("An (B) mới"); // B now has priority
    await owner("datahub.merge.update", { table_id: m.table.id, sources: [a.tableId], columns: [{ name: "MST", from: { [a.tableId]: "MST" } }] });
    await drainOutbox(t);
    const g = await owner("datahub.table.get", { table_id: m.table.id });
    expect((g.columns as { name: string }[]).map((c) => c.name)).toEqual(["MST", "Nguồn", "Mã dòng gốc"]);
    expect(await rowsOf(m.table.id)).toHaveLength(3);
    expect(await fails(owner("datahub.merge.update", { table_id: m.table.id, sources: [a.tableId], version: 1 }))).toMatchObject({ code: "conflict" });
  });
});

describe("a lost source keeps the old data and says so", () => {
  it("source in the trash: status error with the name and reason, data kept; restored: ok again and current", async () => {
    const x = await makeTable(owner, { name: `Sẽ mất ${org.tag}`, columns: [{ name: "MST", type: "text" }] });
    await owner("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "create", data: { MST: "m1" } }, { op: "create", data: { MST: "m2" } }] });
    const m = await createMerged({ sources: [x.tableId, a.tableId] });
    const mst = await colKey(m.table.id, "MST");
    const n0 = (await rowsOf(m.table.id)).length;

    await owner("datahub.table.delete", { table_id: x.tableId });
    await drainOutbox(t);
    const bad = await owner("datahub.merge.get", { table_id: m.table.id });
    expect(bad.status).toBe("error");
    expect(bad.errors).toEqual([expect.objectContaining({ table_id: x.tableId, name: x.table.name, reason: "deleted" })]);
    expect(await rowsOf(m.table.id)).toHaveLength(n0); // last good copy kept
    // a change in the other source is not applied either while a source is lost (no half-merged table)
    await owner("datahub.row.create", { table_id: a.tableId, data: { MST: "xx-late" } });
    await drainOutbox(t);
    expect(await rowsOf(m.table.id)).toHaveLength(n0);
    // someone it is shared with sees the error without the name
    await owner("datahub.share.set", { datahub_id: hub.dhId, table_id: m.table.id, grantee_id: org.userA2.id, permission: "view" });
    expect((await other("datahub.merge.get", { table_id: m.table.id })).errors[0]).toMatchObject({ name: null, reason: "deleted" });
    expect((await other("datahub.row.list", { table_id: m.table.id, limit: 100 })).items).toHaveLength(n0);

    await owner("datahub.table.restore", { table_id: x.tableId });
    await drainOutbox(t);
    expect((await owner("datahub.merge.get", { table_id: m.table.id })).status).toBe("ok");
    const rows = await rowsOf(m.table.id);
    expect(rows.map((r) => r.data[mst])).toContain("xx-late");
    await owner("datahub.row.delete", { table_id: a.tableId, row_id: (await rowsOf(a.tableId)).find((r) => r.data[a.cols["MST"]!.key] === "xx-late")!.id });
    await drainOutbox(t);
  });

  it("owner loses a source: the table is given to someone else (datahub owner changes) -> error no_access, data kept", async () => {
    const x = await makeTable(owner, { name: `Chuyển ${org.tag}`, columns: [{ name: "MST", type: "text" }] });
    await owner("datahub.row.create", { table_id: x.tableId, data: { MST: "c1" } });
    const m = await createMerged({ sources: [x.tableId] });
    expect(await rowsOf(m.table.id)).toHaveLength(1);
    // The source datahub changes hands (what the Admin transfer does): the merged table's owner no longer owns it.
    await db().execute(sql`UPDATE dh_datahubs SET owner_id = ${org.userB1.id}::uuid WHERE /*scope:system*/ id = ${x.dhId}::uuid`);
    await db().execute(sql`SELECT 1`);
    const { enqueueOutbox } = await import("@soe/db");
    await enqueueOutbox(db(), { event: "datahub.structure.changed", aggregateType: "datahub", aggregateId: x.dhId, payload: { datahub_id: x.dhId, table_id: null, change: "owner_changed" } });
    await drainOutbox(t);
    const info = await owner("datahub.merge.get", { table_id: m.table.id });
    expect(info.status).toBe("error");
    expect(info.errors[0]).toMatchObject({ table_id: x.tableId, reason: "no_access" });
    expect(await rowsOf(m.table.id)).toHaveLength(1);
    await db().execute(sql`UPDATE dh_datahubs SET owner_id = ${org.userA1.id}::uuid WHERE /*scope:system*/ id = ${x.dhId}::uuid`);
  });

  it("a mapped column that is deleted or changed to another kind of type leaves empty cells and a warning, not an error", async () => {
    const x = await makeTable(owner, { name: `Cột mất ${org.tag}`, columns: [{ name: "MST", type: "text" }, { name: "Giá", type: "number" }, { name: "Ngày", type: "date" }] });
    await owner("datahub.row.create", { table_id: x.tableId, data: { MST: "g1", Giá: 9, Ngày: "2026-11-02" } });
    const m = await createMerged({ sources: [x.tableId] });
    const gia = await colKey(m.table.id, "Giá");
    expect((await rowsOf(m.table.id))[0]!.data[gia]).toBe(9);
    await owner("datahub.column.delete", { table_id: x.tableId, column: "Giá" });
    await drainOutbox(t);
    const info = await owner("datahub.merge.get", { table_id: m.table.id });
    expect(info.status).toBe("ok");
    expect(info.diagnostics.warnings.map((w: { code: string; column: string }) => `${w.code}:${w.column}`)).toContain("missing_column:Giá");
    expect((await rowsOf(m.table.id))[0]!.data[gia]).toBeUndefined();
  });
});

describe("sharing and organization changes sync again through one entry", () => {
  it("datahub.share.changed and org.member.changed ask every affected merged table to sync again", async () => {
    const m = await createMerged({ name: "Phạm vi" });
    const seq = async () => Number((await q(sql`SELECT request_seq::text AS s FROM dh_merges WHERE /*scope:system*/ table_id = ${m.table.id}::uuid`))[0]!.s);
    const s0 = await seq();
    const sh = await owner("datahub.share.set", { datahub_id: a.dhId, grantee_id: org.userA2.id, permission: "view" }); // the source datahub changed sharing
    await drainOutbox(t);
    const s1 = await seq();
    expect(s1).toBeGreaterThan(s0);
    const { enqueueOutbox } = await import("@soe/db");
    await enqueueOutbox(db(), { event: "org.member.changed", aggregateType: "user", aggregateId: org.userA1.id, payload: { user_id: org.userA1.id } });
    await drainOutbox(t);
    expect(await seq()).toBeGreaterThan(s1);
    expect(await processPendingMerges(db())).toBe(0); // everything synced
    await owner("datahub.share.remove", { datahub_id: a.dhId, share_id: sh.id });
    await drainOutbox(t);
  });
});

describe("as a source of metrics", () => {
  it("a metric on the merged table reads its rows, and the number follows a source change (the cache is cleared by the same events)", async () => {
    const x = await makeTable(owner, { name: `Số ${org.tag}`, columns: [{ name: "Mã", type: "text" }, { name: "Tiền", type: "number" }] });
    await owner("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "create", data: { Mã: "a", Tiền: 10 } }, { op: "create", data: { Mã: "b", Tiền: 20 } }] });
    const y = await makeTable(owner, { name: `Số2 ${org.tag}`, columns: [{ name: "Mã", type: "text" }, { name: "Tiền", type: "number" }] });
    await owner("datahub.row.batch", { table_id: y.tableId, ops: [{ op: "create", data: { Mã: "B", Tiền: 99 } }, { op: "create", data: { Mã: "c", Tiền: 30 } }] });
    const m = await createMerged({ name: "Cho metric", sources: [x.tableId, y.tableId], dedup: { columns: ["Mã"], strategy: "priority" } });
    const metric = await owner("metrics.metric.create", { datahub_id: hub.dhId, metric: { name: `Tổng gộp ${org.tag}`, source: m.table.id, measure: { agg: "sum", field: "Tiền" } } });
    const total = async () => (await owner("metrics.query", { metric_id: metric.id })).rows[0].value;
    expect(await total()).toBe(60); // 10 + 20 + 30 (the duplicate "B" of the second table dropped)
    await owner("datahub.row.update", { table_id: x.tableId, row_id: (await rowsOf(x.tableId))[0]!.id, data: { Tiền: 15 }, version: 1 });
    await drainOutbox(t);
    await sleep(150); // the worker's cache message reaches the api through Postgres NOTIFY
    expect(await total()).toBe(65);
    // The cache answered once, and a change of the merged table's rows clears it: a second read right after the drain is fresh, not stale.
    await owner("datahub.row.create", { table_id: y.tableId, data: { Mã: "d", Tiền: 5 } });
    await drainOutbox(t);
    await sleep(150);
    expect(await total()).toBe(70);
  });
});
