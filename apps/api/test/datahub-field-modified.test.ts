import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/** Stage 4.1d (module4 19c): the column type "Ngày sửa của cột…". */
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tracked = async (x: Awaited<ReturnType<typeof makeTable>>, rowId: string, col: string): Promise<string | null> =>
  ((await a("datahub.row.get", { table_id: x.tableId, row_id: rowId })).data[x.cols[col]!.key] as string | undefined) ?? null;

describe("Ngày sửa của cột", () => {
  it("is set when a watched column changes (create and update), not when another column does; nobody types into it", async () => {
    const x = await makeTable(a, { columns: [{ name: "Status", type: "text" }, { name: "Ghi chú", type: "text" }, { name: "Giá", type: "number" }] });
    const col = await a("datahub.column.create", { table_id: x.tableId, name: "Ngày đổi Status", type: "field_modified", config: { watch: ["Status"] } });
    x.cols["Ngày đổi Status"] = { key: col.key, id: col.id };
    // Watched columns come back as keys, so a rename never breaks the column.
    expect(col.config.watch).toEqual([x.cols["Status"]!.key]);
    const r1 = await a("datahub.row.create", { table_id: x.tableId, data: { Status: "Mới", "Ghi chú": "a" } });
    const r2 = await a("datahub.row.create", { table_id: x.tableId, data: { "Ghi chú": "chỉ ghi chú" } });
    const first = await tracked(x, r1.id, "Ngày đổi Status");
    expect(first).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(Math.abs(Date.parse(first!) - Date.now())).toBeLessThan(60_000);
    expect(await tracked(x, r2.id, "Ngày đổi Status")).toBeNull(); // nothing watched was set
    await sleep(20);
    const v1 = (await a("datahub.row.get", { table_id: x.tableId, row_id: r1.id })).version;
    await a("datahub.row.update", { table_id: x.tableId, row_id: r1.id, data: { "Ghi chú": "b" }, version: v1 });
    expect(await tracked(x, r1.id, "Ngày đổi Status")).toBe(first); // another column changed
    const v2 = (await a("datahub.row.get", { table_id: x.tableId, row_id: r1.id })).version;
    await a("datahub.row.update", { table_id: x.tableId, row_id: r1.id, data: { Status: "Thắng" }, version: v2 });
    const second = await tracked(x, r1.id, "Ngày đổi Status");
    expect(Date.parse(second!)).toBeGreaterThan(Date.parse(first!));
    // Same value written again is not a change.
    const v3 = (await a("datahub.row.get", { table_id: x.tableId, row_id: r1.id })).version;
    await a("datahub.row.update", { table_id: x.tableId, row_id: r1.id, data: { Status: "Thắng" }, version: v3 });
    expect(await tracked(x, r1.id, "Ngày đổi Status")).toBe(second);
    // Read-only for everyone, even through the API.
    expect((await fails(a("datahub.row.update", { table_id: x.tableId, row_id: r1.id, data: { "Ngày đổi Status": "2020-01-01T00:00:00Z" }, version: v3 }))).code).toBe("validation_error");
    // The tracking cell is not in the row history (it is derived, like a formula).
    const h = await a("datahub.row.history", { table_id: x.tableId, row_id: r1.id });
    expect(JSON.stringify(h)).not.toContain(x.cols["Ngày đổi Status"]!.key);
  });

  it("a formula recalculation does not count: a watched column cannot be computed", async () => {
    const x = await makeTable(a, { columns: [{ name: "Giá", type: "number" }, { name: "Gấp đôi", type: "formula", config: { formula: "=[Giá]*2" } }] });
    const e = await fails(a("datahub.column.create", { table_id: x.tableId, name: "Đổi", type: "field_modified", config: { watch: ["Gấp đôi"] } }));
    expect(e.details.reason).toBe("watch_column");
    const watchGia = await a("datahub.column.create", { table_id: x.tableId, name: "Đổi giá", type: "field_modified", config: { watch: ["Giá"] } });
    const r = await a("datahub.row.create", { table_id: x.tableId, data: { Giá: 5 } });
    const at = ((await a("datahub.row.get", { table_id: x.tableId, row_id: r.id })).data[watchGia.key]) as string;
    await sleep(20);
    await drainOutbox(t); // recalculation of the formula column
    expect((await a("datahub.row.get", { table_id: x.tableId, row_id: r.id })).data[watchGia.key]).toBe(at);
  });

  it("refuses 0 or more than 5 watched columns, itself, and columns that do not exist", async () => {
    const x = await makeTable(a, { columns: ["A", "B", "C", "D", "E", "F"].map((n) => ({ name: n, type: "text" })) });
    const bad = (watch: string[]) => fails(a("datahub.column.create", { table_id: x.tableId, name: "T", type: "field_modified", config: { watch } }));
    expect((await bad([])).code).toBe("validation_error");
    expect((await bad(["A", "B", "C", "D", "E", "F"])).code).toBe("validation_error");
    expect((await bad(["Không có"])).details.reason).toBe("watch_column");
    const ok = await a("datahub.column.create", { table_id: x.tableId, name: "T", type: "field_modified", config: { watch: ["A", "B", "C", "D", "E"] } });
    expect(ok.config.watch).toHaveLength(5);
  });

  it("created on a table that has rows: filled from the row history (latest change of a watched column; empty when none)", async () => {
    const x = await makeTable(a, { columns: [{ name: "Status", type: "text" }, { name: "Ghi chú", type: "text" }] });
    const r1 = await a("datahub.row.create", { table_id: x.tableId, data: { Status: "Mới" } });
    const r2 = await a("datahub.row.create", { table_id: x.tableId, data: { "Ghi chú": "x" } });
    await sleep(30);
    await a("datahub.row.update", { table_id: x.tableId, row_id: r1.id, data: { Status: "Thắng" }, version: r1.version });
    const hist = await a("datahub.row.history", { table_id: x.tableId, row_id: r1.id });
    const lastAt = (hist.items as { at: string; op: string }[]).filter((i) => i.op === "update")[0]!.at;
    const col = await a("datahub.column.create", { table_id: x.tableId, name: "Ngày đổi Status", type: "field_modified", config: { watch: ["Status"] } });
    const got = (await a("datahub.row.get", { table_id: x.tableId, row_id: r1.id })).data[col.key] as string;
    expect(Date.parse(got)).toBe(Date.parse(lastAt));
    expect((await a("datahub.row.get", { table_id: x.tableId, row_id: r2.id })).data[col.key]).toBeUndefined();
    // Backfill is a system fill: the row version did not move.
    expect((await a("datahub.row.get", { table_id: x.tableId, row_id: r1.id })).version).toBe(r1.version + 1);
    // It sorts and filters like a date-time.
    const sorted = await a("datahub.row.list", { table_id: x.tableId, sort: JSON.stringify([{ field: "Ngày đổi Status", dir: "desc", nulls: "last" }]) });
    expect(sorted.items[0].id).toBe(r1.id);
  });
});
