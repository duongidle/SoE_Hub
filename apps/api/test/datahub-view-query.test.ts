import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Stage 2C-2 server side: window reads (offset, from the end), the time filter of design module2 section 5.4, groups with totals
 * (5.1), the sort rules of 5.3 and the autosave rules of 5.2 for the new view settings.
 */
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

const day = (offset = 0) => new Date(Date.now() + 7 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);

describe("window reads: offset and reverse give the same rows as following the cursor", () => {
  let x: Awaited<ReturnType<typeof makeTable>>;
  beforeAll(async () => {
    x = await makeTable(a, {
      columns: [
        { name: "Tên", type: "text" },
        { name: "Tiền", type: "currency" },
        { name: "Mức", type: "single_select", config: { options: [{ name: "P1" }, { name: "P2" }, { name: "P3" }] } },
      ],
    });
    const levels = ["P1", "P2", "P3", undefined];
    const ops = Array.from({ length: 47 }, (_, i) => ({ op: "create", data: { Tên: `Dòng ${String(i).padStart(2, "0")}`, ...(i % 5 === 0 ? {} : { Tiền: (i * 37) % 11 }), ...(levels[i % 4] ? { Mức: levels[i % 4] } : {}) } }));
    await a("datahub.row.batch", { table_id: x.tableId, ops });
  });
  const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id);
  const all = async (sort: string, filter?: unknown) => {
    const out: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const r = await a("datahub.row.list", { table_id: x.tableId, sort, limit: 7, cursor, ...(filter ? { filter: JSON.stringify(filter) } : {}) });
      out.push(...ids(r));
      if (!r.nextCursor) return out;
      cursor = r.nextCursor;
    }
  };
  for (const [name, sort, filter] of [
    ["default order", undefined, undefined],
    ["number desc, empty first", "Tiền:desc:first", undefined],
    ["number asc, empty last", "Tiền:asc:last", undefined],
    ["option order, then name desc", "Mức:asc:last,Tên:desc", undefined],
    ["option order desc with a filter", "Mức:desc", { field: "Tiền", op: "gt", value: 2 }],
  ] as const) {
    it(`${name}`, async () => {
      const full = await all(sort ?? "_row_no", filter);
      expect(full.length).toBeGreaterThan(20);
      const win = async (offset: number, limit: number, reverse = false) =>
        ids(await a("datahub.row.list", { table_id: x.tableId, sort: sort ?? "_row_no", limit, offset, reverse: String(reverse), ...(filter ? { filter: JSON.stringify(filter) } : {}) }));
      expect(await win(0, 7)).toEqual(full.slice(0, 7));
      expect(await win(14, 9)).toEqual(full.slice(14, 23));
      expect(await win(full.length - 4, 10)).toEqual(full.slice(full.length - 4));
      expect(await win(full.length + 5, 10)).toEqual([]);
      // From the end: skip 3 rows, take 8 (still in normal order).
      expect(await win(3, 8, true)).toEqual(full.slice(full.length - 11, full.length - 3));
      expect(await win(0, 5, true)).toEqual(full.slice(full.length - 5));
      expect(await win(full.length - 3, 10, true)).toEqual(full.slice(0, 3));
    });
  }
});

describe("time filter (design module2 section 5.4)", () => {
  let x: Awaited<ReturnType<typeof makeTable>>;
  const names = async (extra: Record<string, unknown>) => {
    const r = await a("datahub.row.list", { table_id: x.tableId, sort: "Tên", limit: 100, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])) });
    return r.items.map((i: { data: Record<string, unknown> }) => i.data[x.cols["Tên"]!.key] as string);
  };
  const tf = (columns: string[], range: unknown) => ({ time_filter: { columns, range } });
  beforeAll(async () => {
    x = await makeTable(a, {
      columns: [
        { name: "Tên", type: "text" },
        { name: "Nhận", type: "date" },
        { name: "Chốt", type: "date" },
        { name: "Giờ", type: "datetime" },
        { name: "Tiền", type: "number" },
      ],
    });
    const mk = (n: string, nhan?: string, chot?: string, gio?: string, tien?: number) => ({ Tên: n, ...(nhan ? { Nhận: nhan } : {}), ...(chot ? { Chốt: chot } : {}), ...(gio ? { Giờ: gio } : {}), ...(tien !== undefined ? { Tiền: tien } : {}) });
    const monthStart = `${day().slice(0, 7)}-01`;
    await a("datahub.row.batch", {
      table_id: x.tableId,
      ops: [
        mk("hôm nay", day(), undefined, undefined, 10),
        mk("hôm qua", day(-1), undefined, undefined, 20),
        mk("5 ngày trước", day(-5), day(2), undefined, 30),
        mk("đầu tháng", monthStart, undefined, undefined, 40),
        mk("năm ngoái", `${Number(day().slice(0, 4)) - 1}-06-15`, `${day().slice(0, 4)}-01-02`),
        // Midnight in Vietnam: 16:59:59Z on 18/11 is still the 18th, 17:00:00Z is already the 19th.
        mk("23:59:59 ngày 18", undefined, undefined, "2026-11-18T16:59:59Z"),
        mk("00:00:00 ngày 19", undefined, undefined, "2026-11-18T17:00:00Z"),
        mk("23:59:59 ngày 19", undefined, undefined, "2026-11-19T16:59:59Z"),
        mk("00:00:00 ngày 20", undefined, undefined, "2026-11-19T17:00:00Z"),
        mk("trống"),
      ].map((data) => ({ op: "create", data })),
    });
  });

  it("presets resolve in Vietnam time and drift with the day", async () => {
    expect(await names(tf(["Nhận"], { kind: "preset", preset: "today" }))).toEqual(["hôm nay"]);
    expect(await names(tf(["Nhận"], { kind: "preset", preset: "last_n_days", n: 2 }))).toEqual(["hôm nay", "hôm qua"]);
    expect(await names(tf(["Nhận"], { kind: "preset", preset: "last_n_days", n: 6 }))).toEqual(["5 ngày trước", "hôm nay", "hôm qua"]);
    const month = await names(tf(["Nhận"], { kind: "preset", preset: "this_month" }));
    expect(month).toContain("hôm nay");
    expect(month).toContain("đầu tháng");
    expect(month).not.toContain("năm ngoái");
    expect(await names(tf(["Nhận"], { kind: "preset", preset: "last_year" }))).toEqual(["năm ngoái"]);
    // Rows without a date never match a range.
    expect(await names(tf(["Nhận"], { kind: "preset", preset: "this_year" }))).not.toContain("trống");
  });

  it("a specific period stays put; from-to ranges include both ends and may be open", async () => {
    const y = Number(day().slice(0, 4));
    expect(await names(tf(["Nhận"], { kind: "period", unit: "year", year: y - 1 }))).toEqual(["năm ngoái"]);
    expect(await names(tf(["Nhận"], { kind: "period", unit: "quarter", year: y - 1, index: 2 }))).toEqual(["năm ngoái"]);
    expect(await names(tf(["Nhận"], { kind: "period", unit: "month", year: y - 1, index: 6 }))).toEqual(["năm ngoái"]);
    expect(await names(tf(["Nhận"], { kind: "period", unit: "month", year: y - 1, index: 7 }))).toEqual([]);
    expect(await names(tf(["Nhận"], { kind: "between", from: day(-1), to: day() }))).toEqual(["hôm nay", "hôm qua"]);
    expect(await names(tf(["Nhận"], { kind: "between", from: day(-1) }))).toEqual(["hôm nay", "hôm qua"]);
    const monthStart = `${day().slice(0, 7)}-01`;
    expect([...(await names(tf(["Nhận"], { kind: "between", to: day(-4) })))].sort()).toEqual(["5 ngày trước", ...(monthStart <= day(-4) ? ["đầu tháng"] : []), "năm ngoái"].sort());
  });

  it("midnight in Vietnam: 23:59:59 and 00:00:00 land on different days", async () => {
    expect(await names(tf(["Giờ"], { kind: "between", from: "2026-11-19", to: "2026-11-19" }))).toEqual(["00:00:00 ngày 19", "23:59:59 ngày 19"]);
    expect(await names(tf(["Giờ"], { kind: "between", from: "2026-11-18", to: "2026-11-18" }))).toEqual(["23:59:59 ngày 18"]);
    expect(await names(tf(["Giờ"], { kind: "between", from: "2026-11-20" }))).toEqual(["00:00:00 ngày 20"]);
    expect(await names(tf(["Giờ"], { kind: "between", to: "2026-11-18" }))).toEqual(["23:59:59 ngày 18"]);
  });

  it("several columns mean any of them; it combines with the filter by AND; created time works too", async () => {
    // Received OR closing in the last 3 days (closing is two days ahead of the "5 ngày trước" row, so it is not in the past 3 days).
    expect(await names(tf(["Nhận", "Chốt"], { kind: "between", from: day(1), to: day(3) }))).toEqual(["5 ngày trước"]);
    expect(await names(tf(["Nhận", "Chốt"], { kind: "preset", preset: "this_year" }))).toContain("năm ngoái"); // closes on 2 January
    const both = await names({ ...tf(["Nhận"], { kind: "preset", preset: "last_n_days", n: 6 }), filter: { field: "Tiền", op: "gte", value: 20 } });
    expect(both).toEqual(["5 ngày trước", "hôm qua"]);
    expect((await names(tf(["_created_at"], { kind: "preset", preset: "today" }))).length).toBe(10);
    // Total reflects the time filter.
    const r = await a("datahub.row.list", { table_id: x.tableId, include_total: "true", time_filter: JSON.stringify({ columns: ["Nhận"], range: { kind: "preset", preset: "today" } }) });
    expect(r.total).toBe(1);
  });

  it("refuses non-date columns, unknown columns and a reversed range", async () => {
    expect((await fails(a("datahub.row.list", { table_id: x.tableId, time_filter: JSON.stringify({ columns: ["Tiền"], range: { kind: "preset", preset: "today" } }) }))).code).toBe("invalid_filter");
    expect((await fails(a("datahub.row.list", { table_id: x.tableId, time_filter: JSON.stringify({ columns: ["Không có"], range: { kind: "preset", preset: "today" } }) }))).code).toBe("invalid_filter");
    expect((await fails(a("datahub.row.list", { table_id: x.tableId, time_filter: JSON.stringify({ columns: ["Nhận"], range: { kind: "between", from: "2026-05-02", to: "2026-05-01" } }) }))).code).toBe("invalid_filter");
    expect((await fails(a("datahub.row.list", { table_id: x.tableId, time_filter: JSON.stringify({ columns: ["Nhận"], range: { kind: "preset", preset: "nope" } }) }))).code).toBe("validation_error");
  });

  it("quarters follow the fiscal start month setting", async () => {
    const adm = as(t, org.admin.id);
    const fy = Number(day().slice(0, 4));
    const q = (index: number) => names(tf(["Nhận"], { kind: "period", unit: "quarter", year: fy - 1, index }));
    expect(await q(2)).toEqual(["năm ngoái"]); // Apr-Jun of calendar year (June 15)
    const s = await adm("system.setting.set", { key: "datahub.fiscal_start_month", value: 7 });
    // Fiscal year starting in July: quarter 4 of FY(y-1) is Apr-Jun of year y; quarter 4 of FY(y-2) is Apr-Jun of y-1.
    expect(await names(tf(["Nhận"], { kind: "period", unit: "quarter", year: fy - 2, index: 4 }))).toEqual(["năm ngoái"]);
    expect(await names(tf(["Nhận"], { kind: "period", unit: "year", year: fy - 2 }))).toEqual(["năm ngoái"]);
    await adm("system.setting.set", { key: "datahub.fiscal_start_month", value: 1, version: s.version });
  });
});

describe("groups with totals (design module2 section 5.1)", () => {
  let x: Awaited<ReturnType<typeof makeTable>>;
  const rowsOf = async (filter: unknown) => (await a("datahub.row.list", { table_id: x.tableId, include_total: "true", limit: 1, filter: JSON.stringify(filter) })).total as number;
  beforeAll(async () => {
    x = await makeTable(a, {
      columns: [
        { name: "Tên", type: "text" },
        { name: "Tiền", type: "number" },
        { name: "Mức", type: "single_select", config: { options: [{ name: "P1" }, { name: "P2" }, { name: "P3" }] } },
        { name: "Vùng", type: "text" },
        { name: "Ngày", type: "date" },
        { name: "Nhãn", type: "multi_select", config: { options: [{ name: "x" }] } },
      ],
    });
    const data: Record<string, unknown>[] = [
      { Tên: "a", Tiền: 12_345_678_900, Mức: "P3", Vùng: "Bắc", Ngày: "2026-01-05" },
      { Tên: "b", Tiền: 0.1, Mức: "P1", Vùng: "Bắc", Ngày: "2026-01-01" },
      { Tên: "c", Tiền: 0.2, Mức: "P1", Vùng: "Bắc" },
      { Tên: "d", Tiền: -50, Mức: "P1", Vùng: "Nam" },
      { Tên: "e", Mức: "P2", Vùng: "Nam", Ngày: "2026-03-01" },
      { Tên: "f", Tiền: 7 },
      { Tên: "g", Tiền: 5, Vùng: "Nam", Mức: "P3" },
    ];
    await a("datahub.row.batch", { table_id: x.tableId, ops: data.map((d) => ({ op: "create", data: d })) });
  });
  const groups = (group: unknown, extra: Record<string, unknown> = {}) => a("datahub.row.groups", { table_id: x.tableId, group: JSON.stringify(group), ...extra });

  it("single level: count and totals, option order, empty last, exact decimals and huge sums", async () => {
    const r = await groups([{ field: "Mức" }], { aggs: JSON.stringify({ Tiền: "sum" }) });
    expect(r.truncated).toBe(false);
    // Option order P1, P2, P3, then the empty group last (not alphabetical).
    expect(r.groups.map((g: { path: unknown[] }) => g.path[0])).toEqual([expect.any(String), expect.any(String), expect.any(String), null]);
    const byName = r.groups.map((g: { count: number; aggs: Record<string, unknown> }) => [g.count, g.aggs[x.cols["Tiền"]!.key]]);
    expect(byName).toEqual([[3, -49.7], [1, null], [2, 12_345_678_905], [1, 7]]);
    expect(r.groups.reduce((n: number, g: { count: number }) => n + g.count, 0)).toBe(7);
  });

  it("descending order flips the groups but keeps empty last", async () => {
    const r = await groups([{ field: "Vùng", dir: "desc" }]);
    expect(r.groups.map((g: { path: unknown[]; count: number }) => [g.path[0], g.count])).toEqual([["Nam", 3], ["Bắc", 3], [null, 1]]);
  });

  it("nested groups list a group, then the groups inside it, each with its own totals", async () => {
    const r = await groups([{ field: "Vùng" }, { field: "Mức" }], { aggs: JSON.stringify({ Tiền: "sum" }) });
    const shape = r.groups.map((g: { depth: number; path: unknown[]; count: number }) => `${g.depth}:${g.path.length}:${g.count}`);
    // Bắc(3): P1(2), P3(1); Nam(3): P1(1), P2(1), P3(1); empty(1): empty(1)
    expect(shape).toEqual(["0:1:3", "1:2:2", "1:2:1", "0:1:3", "1:2:1", "1:2:1", "1:2:1", "0:1:1", "1:2:1"]);
    const tien = x.cols["Tiền"]!.key;
    expect(r.groups[0].aggs[tien]).toBe(12_345_678_900.3);
    expect(r.groups[1].aggs[tien]).toBeCloseTo(0.3, 10);
  });

  it("a group's count equals the rows the list returns when filtered by its key (same filter, same search)", async () => {
    const filter = { field: "Tên", op: "neq", value: "g" };
    const r = await a("datahub.row.groups", { table_id: x.tableId, group: JSON.stringify([{ field: "Mức" }, { field: "Vùng" }]), filter: JSON.stringify(filter) });
    const leaves = r.groups.filter((g: { depth: number }) => g.depth === 1);
    for (const g of leaves) {
      const conds = [filter, ...["Mức", "Vùng"].map((f, i) => (g.path[i] === null ? { field: f, op: "is_empty" } : { field: f, op: "eq", value: g.path[i] }))];
      expect(await rowsOf({ and: conds })).toBe(g.count);
    }
    expect(leaves.reduce((n: number, g: { count: number }) => n + g.count, 0)).toBe(6);
  });

  it("min, max, avg and count; date min/max; time filter and search narrow the groups", async () => {
    const r = await groups([{ field: "Vùng" }], { aggs: JSON.stringify({ Tiền: "avg", Ngày: "min", Tên: "count" }) });
    const bac = r.groups.find((g: { path: unknown[] }) => g.path[0] === "Bắc");
    expect(bac.aggs[x.cols["Ngày"]!.key]).toBe("2026-01-01");
    expect(bac.aggs[x.cols["Tên"]!.key]).toBe(3);
    expect(bac.aggs[x.cols["Tiền"]!.key]).toBeCloseTo(12_345_678_900.3 / 3, 3);
    const t2 = await groups([{ field: "Vùng" }], { time_filter: JSON.stringify({ columns: ["Ngày"], range: { kind: "between", from: "2026-01-01", to: "2026-01-31" } }) });
    expect(t2.groups.map((g: { path: unknown[]; count: number }) => [g.path[0], g.count])).toEqual([["Bắc", 2]]);
    const s2 = await groups([{ field: "Vùng" }], { search: "nam" });
    expect(s2.groups.map((g: { path: unknown[]; count: number }) => [g.path[0], g.count])).toEqual([["Nam", 3]]);
  });

  it("refuses columns that cannot be grouped or totalled, and bad shapes", async () => {
    for (const f of ["Nhãn"]) expect((await fails(groups([{ field: f }]))).code).toBe("invalid_filter");
    expect((await fails(groups([{ field: "Không có" }]))).code).toBe("invalid_filter");
    expect((await fails(groups([{ field: "Vùng" }], { aggs: JSON.stringify({ Vùng: "sum" }) }))).code).toBe("invalid_filter");
    expect((await fails(groups([{ field: "Vùng" }, { field: "Mức" }, { field: "Tên" }, { field: "Ngày" }]))).code).toBe("validation_error");
    expect((await fails(a("datahub.row.groups", { table_id: x.tableId }))).code).toBe("validation_error");
  });

  it("empty table and the group cap", async () => {
    const e = await makeTable(a, { columns: [{ name: "K", type: "text" }] });
    expect((await a("datahub.row.groups", { table_id: e.tableId, group: JSON.stringify([{ field: "K" }]) })).groups).toEqual([]);
    const ops = Array.from({ length: 1100 }, (_, i) => ({ op: "create", data: { K: `k${String(i).padStart(4, "0")}` } }));
    for (let i = 0; i < ops.length; i += 500) await a("datahub.row.batch", { table_id: e.tableId, ops: ops.slice(i, i + 500) });
    const r = await a("datahub.row.groups", { table_id: e.tableId, group: JSON.stringify([{ field: "K" }]) });
    expect(r.truncated).toBe(true);
    expect(r.groups).toHaveLength(1000);
    expect(r.groups[0].path[0]).toBe("k0000");
  });

  it("only people who can read the table get groups", async () => {
    expect((await fails(as(t, org.userB1.id)("datahub.row.groups", { table_id: x.tableId, group: JSON.stringify([{ field: "Mức" }]) }))).code).toBe("not_found");
  });
});

describe("colour rules: the server says which rules a row satisfies", () => {
  it("marks are indexes of the matching rules, follow the same filter compiler, and survive reading by id", async () => {
    const x = await makeTable(a, { columns: [{ name: "Tên", type: "text" }, { name: "Tiền", type: "number" }] });
    await a("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "create", data: { Tên: "a", Tiền: 5 } }, { op: "create", data: { Tên: "b", Tiền: 50 } }, { op: "create", data: { Tên: "c" } }].map((o) => o) });
    const marks = JSON.stringify([{ field: "Tiền", op: "gt", value: 10 }, { field: "Tiền", op: "is_empty" }, { field: "Tên", op: "contains", value: "A" }]);
    const r = await a("datahub.row.list", { table_id: x.tableId, sort: "Tên", marks });
    expect(r.items.map((i: { marks: number[] }) => i.marks)).toEqual([[2], [0], [1]]);
    const noRules = await a("datahub.row.list", { table_id: x.tableId });
    expect(noRules.items[0].marks).toBeUndefined();
    const byId = await a("datahub.row.list", { table_id: x.tableId, marks, filter: JSON.stringify({ field: "_id", op: "in", value: [r.items[1].id] }) });
    expect(byId.items.map((i: { marks: number[] }) => i.marks)).toEqual([[0]]);
    expect((await fails(a("datahub.row.list", { table_id: x.tableId, marks: JSON.stringify([{ field: "Không có", op: "eq", value: 1 }]) }))).code).toBe("invalid_filter");
  });
});

describe("time range resolver for the toolbar", () => {
  it("returns the dates and where today falls, from the same resolver as the filter", async () => {
    const r = await a("datahub.time_filter.resolve", { range: JSON.stringify({ kind: "preset", preset: "this_month" }) });
    expect(r.from).toBe(`${day().slice(0, 7)}-01`);
    expect(r.today).toBe(day());
    expect(r).toMatchObject({ fiscal_start_month: 1, year: Number(day().slice(0, 4)), month: Number(day().slice(5, 7)) });
    expect(r.fiscal_quarter).toBe(Math.floor((Number(day().slice(5, 7)) - 1) / 3) + 1);
    expect((await fails(a("datahub.time_filter.resolve", {}))).code).toBe("validation_error");
  });
});

describe("autosave of the new view settings (design module2 section 5.2)", () => {
  it("time filter, group, totals and colours save per person: owner on the shared view, sharee as their own copy, personal views", async () => {
    const y = await makeTable(a, { columns: [{ name: "Tên", type: "text" }, { name: "Ngày", type: "date" }, { name: "Tiền", type: "number" }] });
    await a("datahub.share.set", { datahub_id: y.dhId, grantee_id: org.userA2.id, permission: "view" });
    const guest = as(t, org.userA2.id);
    const shared = (await a("datahub.view.list", { table_id: y.tableId })).views[0];
    const cfg = { time_filter: { columns: ["Ngày"], range: { kind: "preset", preset: "this_month" } }, group: [{ field: "Tên" }], group_aggs: { Tiền: "sum" } };
    await a("datahub.view.update", { view_id: shared.id, config: cfg });
    expect((await guest("datahub.view.list", { table_id: y.tableId })).views[0].config).toMatchObject(cfg);
    // The sharee turns the time filter off: their own copy changes, the shared view keeps it.
    await guest("datahub.view.update", { view_id: shared.id, config: { time_filter: null } });
    const mine = (await guest("datahub.view.list", { table_id: y.tableId })).views[0];
    expect(mine.has_override).toBe(true);
    expect(mine.config.time_filter).toBeUndefined();
    expect(mine.config.group).toEqual([{ field: "Tên" }]);
    expect((await a("datahub.view.list", { table_id: y.tableId })).views[0].config.time_filter).toBeDefined();
    expect((await guest("datahub.view.reset", { view_id: shared.id })).config.time_filter).toBeDefined();
    // Bad settings are refused.
    expect((await fails(a("datahub.view.update", { view_id: shared.id, config: { time_filter: { columns: ["Không có"], range: { kind: "preset", preset: "today" } } } }))).code).toBe("invalid_filter");
    expect((await fails(a("datahub.view.update", { view_id: shared.id, config: { group_aggs: { Tiền: "median" } } }))).code).toBe("validation_error");
    expect((await fails(a("datahub.view.update", { view_id: shared.id, config: { group: [{ field: "Tên" }, { field: "Ngày" }, { field: "Tiền" }, { field: "Tên" }] } }))).code).toBe("validation_error");
    // Reordering: the owner moves shared views, a person moves their own.
    const second = await a("datahub.view.create", { table_id: y.tableId, name: "Thứ hai", shared: true });
    await a("datahub.view.update", { view_id: second.id, position: 0 });
    await a("datahub.view.update", { view_id: shared.id, position: 1 });
    expect((await guest("datahub.view.list", { table_id: y.tableId })).views.map((v: { name: string }) => v.name)).toEqual(["Thứ hai", "Dạng bảng"]);
    expect((await fails(guest("datahub.view.update", { view_id: second.id, position: 5 }))).code).toBe("forbidden");
    const own1 = await guest("datahub.view.create", { table_id: y.tableId, name: "A" });
    const own2 = await guest("datahub.view.create", { table_id: y.tableId, name: "B" });
    await guest("datahub.view.update", { view_id: own2.id, position: 0 });
    await guest("datahub.view.update", { view_id: own1.id, position: 1 });
    expect((await guest("datahub.view.list", { table_id: y.tableId })).views.filter((v: { shared: boolean }) => !v.shared).map((v: { name: string }) => v.name)).toEqual(["B", "A"]);
  });
});
