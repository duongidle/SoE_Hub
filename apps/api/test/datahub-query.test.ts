import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const vnToday = (offsetDays = 0) => {
  const now = new Date(Date.now() + 7 * 3600_000 + offsetDays * 86400_000);
  return now.toISOString().slice(0, 10);
};

describe("filter DSL over JSONB, every column type", () => {
  let x: Awaited<ReturnType<typeof makeTable>>;
  const names: Record<string, string> = {};
  const q = async (filter: unknown, extra: Record<string, unknown> = {}) => {
    const r = await a("datahub.row.list", { table_id: x.tableId, filter: JSON.stringify(filter), sort: "Tên", limit: 100, ...extra });
    return r.items.map((i: { data: Record<string, unknown> }) => i.data[x.cols["Tên"]!.key] as string);
  };
  beforeAll(async () => {
    x = await makeTable(a, {
      columns: [
        { name: "Tên", type: "text" },
        { name: "Số", type: "number" },
        { name: "Tiền", type: "currency" },
        { name: "Tỉ lệ", type: "percent" },
        { name: "Ngày", type: "date" },
        { name: "Giờ", type: "datetime" },
        { name: "Xong", type: "checkbox" },
        { name: "Sao", type: "rating" },
        { name: "Mức", type: "single_select", config: { options: [{ name: "P1" }, { name: "P2" }, { name: "P3" }] } },
        { name: "Nhãn", type: "multi_select", config: { options: [{ name: "x" }, { name: "y" }, { name: "z" }] } },
        { name: "Người", type: "user" },
        { name: "Email", type: "email" },
        { name: "STT", type: "auto_number" },
        { name: "Tạo", type: "created_time" },
        { name: "Mã", type: "row_id" },
      ],
    });
    names.today = vnToday();
    const rows = [
      { Tên: "Nguyễn Thuận", Số: 1, Tiền: 100, "Tỉ lệ": 0.1, Ngày: vnToday(), Giờ: "2026-01-01T00:00:00Z", Xong: true, Sao: 5, Mức: "P1", Nhãn: ["x", "y"], Người: org.userA1.id, Email: "a@base.vn" },
      { Tên: "Trần Thị Hà", Số: 2.5, Tiền: 200, "Tỉ lệ": 0.5, Ngày: vnToday(-3), Giờ: "2026-06-01T00:00:00Z", Sao: 3, Mức: "P2", Nhãn: ["y"], Người: org.userA2.id, Email: "b@base.vn" },
      { Tên: "Lê Văn C", Số: 10, Tiền: 300, Ngày: vnToday(-40), Mức: "P3", Nhãn: ["z"], Email: "c@gmail.com" },
      { Tên: "Phạm D", Ngày: vnToday(5) },
      { Tên: "Đặng _50%_ E" },
    ];
    for (const r of rows) await a("datahub.row.create", { table_id: x.tableId, data: r });
  });

  it("text: eq, neq, in, nin, contains (no accents, any case), starts_with, escaping, empty", async () => {
    expect(await q({ field: "Tên", op: "eq", value: "Phạm D" })).toEqual(["Phạm D"]);
    expect(await q({ field: "Tên", op: "neq", value: "Phạm D" })).toHaveLength(4);
    expect(await q({ field: "Tên", op: "in", value: ["Phạm D", "Lê Văn C"] })).toEqual(["Lê Văn C", "Phạm D"]);
    expect(await q({ field: "Tên", op: "nin", value: ["Phạm D", "Lê Văn C"] })).toHaveLength(3);
    expect(await q({ field: "Tên", op: "contains", value: "thuan" })).toEqual(["Nguyễn Thuận"]);
    expect(await q({ field: "Tên", op: "contains", value: "THI HA" })).toEqual(["Trần Thị Hà"]);
    expect(await q({ field: "Tên", op: "starts_with", value: "le van" })).toEqual(["Lê Văn C"]);
    expect(await q({ field: "Tên", op: "contains", value: "_50%_" })).toEqual(["Đặng _50%_ E"]);
    expect(await q({ field: "Tên", op: "contains", value: "%" })).toEqual(["Đặng _50%_ E"]);
    expect(await q({ field: "Email", op: "is_empty" })).toHaveLength(2);
    expect(await q({ field: "Email", op: "is_not_empty" })).toHaveLength(3);
    expect(await q({ field: "Email", op: "contains", value: "gmail" })).toEqual(["Lê Văn C"]);
    expect(await q({ field: "Email", op: "eq", value: null })).toHaveLength(2);
  });

  it("number, currency, percent, rating, auto number: comparisons, between, in, empty", async () => {
    expect(await q({ field: "Số", op: "gt", value: 1 })).toEqual(["Lê Văn C", "Trần Thị Hà"]);
    expect(await q({ field: "Số", op: "gte", value: 2.5 })).toEqual(["Lê Văn C", "Trần Thị Hà"]);
    expect(await q({ field: "Số", op: "lt", value: 2.5 })).toEqual(["Nguyễn Thuận"]);
    expect(await q({ field: "Số", op: "between", value: [2, 3] })).toEqual(["Trần Thị Hà"]);
    expect(await q({ field: "Số", op: "is_empty" })).toHaveLength(2);
    expect(await q({ field: "Tiền", op: "in", value: [100, 300] })).toEqual(["Lê Văn C", "Nguyễn Thuận"]);
    expect(await q({ field: "Tiền", op: "lte", value: 200 })).toHaveLength(2);
    expect(await q({ field: "Tỉ lệ", op: "gte", value: 0.5 })).toEqual(["Trần Thị Hà"]);
    expect(await q({ field: "Sao", op: "gte", value: 4 })).toEqual(["Nguyễn Thuận"]);
    expect(await q({ field: "STT", op: "between", value: [1, 2] })).toHaveLength(2);
  });

  it("number filter with a string value is refused", async () => {
    const e = await fails(a("datahub.row.list", { table_id: x.tableId, filter: JSON.stringify({ field: "Số", op: "gt", value: "abc" }) }));
    expect(e.code).toBe("invalid_filter");
  });

  it("date: compare, between, relative operators (Vietnam time)", async () => {
    expect(await q({ field: "Ngày", op: "eq", value: vnToday() })).toEqual(["Nguyễn Thuận"]);
    expect(await q({ field: "Ngày", op: "today" })).toEqual(["Nguyễn Thuận"]);
    expect(await q({ field: "Ngày", op: "between", value: [vnToday(-10), vnToday(10)] })).toHaveLength(3);
    expect(await q({ field: "Ngày", op: "last_n_days", value: 7 })).toEqual(["Nguyễn Thuận", "Trần Thị Hà"]);
    expect(await q({ field: "Ngày", op: "next_n_days", value: 7 })).toEqual(["Nguyễn Thuận", "Phạm D"]);
    expect(await q({ field: "Ngày", op: "last_n_days", value: 60 })).toHaveLength(3);
    expect(await q({ field: "Ngày", op: "is_empty" })).toEqual(["Đặng _50%_ E"]);
    // this_month always contains today's row
    expect(await q({ field: "Ngày", op: "this_month" })).toContain("Nguyễn Thuận");
    expect(await q({ field: "Ngày", op: "this_year" })).toContain("Nguyễn Thuận");
  });

  it("datetime: compare and between, relative", async () => {
    expect(await q({ field: "Giờ", op: "gte", value: "2026-03-01T00:00:00Z" })).toEqual(["Trần Thị Hà"]);
    expect(await q({ field: "Giờ", op: "between", value: ["2025-12-31T00:00:00Z", "2026-02-01T00:00:00Z"] })).toEqual(["Nguyễn Thuận"]);
    expect(await q({ field: "Giờ", op: "last_year" })).toBeInstanceOf(Array);
    expect(await q({ field: "Giờ", op: "is_empty" })).toHaveLength(3);
  });

  it("checkbox: an unset checkbox counts as unchecked", async () => {
    expect(await q({ field: "Xong", op: "eq", value: true })).toEqual(["Nguyễn Thuận"]);
    expect(await q({ field: "Xong", op: "eq", value: false })).toHaveLength(4);
    expect(await q({ field: "Xong", op: "neq", value: true })).toHaveLength(4);
  });

  it("single select by option name or id; multi select: eq, in, nin, empty", async () => {
    expect(await q({ field: "Mức", op: "eq", value: "p1" })).toEqual(["Nguyễn Thuận"]);
    expect(await q({ field: "Mức", op: "in", value: ["P1", "P3"] })).toEqual(["Lê Văn C", "Nguyễn Thuận"]);
    expect(await q({ field: "Mức", op: "nin", value: ["P1", "P3"] })).toHaveLength(3);
    expect(await q({ field: "Mức", op: "is_empty" })).toHaveLength(2);
    expect((await fails(a("datahub.row.list", { table_id: x.tableId, filter: JSON.stringify({ field: "Mức", op: "eq", value: "P9" }) }))).code).toBe("invalid_filter");
    expect(await q({ field: "Nhãn", op: "eq", value: "y" })).toEqual(["Nguyễn Thuận", "Trần Thị Hà"]);
    expect(await q({ field: "Nhãn", op: "in", value: ["x", "z"] })).toEqual(["Lê Văn C", "Nguyễn Thuận"]);
    expect(await q({ field: "Nhãn", op: "nin", value: ["y"] })).toHaveLength(3);
    expect(await q({ field: "Nhãn", op: "is_empty" })).toHaveLength(2);
    expect(await q({ field: "Nhãn", op: "is_not_empty" })).toHaveLength(3);
  });

  it("user, system columns, standard fields, nested and/or", async () => {
    expect(await q({ field: "Người", op: "eq", value: org.userA2.id })).toEqual(["Trần Thị Hà"]);
    expect(await q({ field: "Người", op: "in", value: [org.userA1.id, org.userA2.id] })).toHaveLength(2);
    expect(await q({ field: "Tạo", op: "last_n_days", value: 1 })).toHaveLength(5);
    expect(await q({ field: "Mã", op: "neq", value: "00000000-0000-7000-8000-000000000000" })).toHaveLength(5);
    expect(await q({ field: "_row_no", op: "lte", value: 2 })).toEqual(["Nguyễn Thuận", "Trần Thị Hà"]);
    expect(await q({ field: "_created_by", op: "eq", value: org.userA1.id })).toHaveLength(5);
    expect(
      await q({ and: [{ field: "Số", op: "gte", value: 1 }, { or: [{ field: "Mức", op: "eq", value: "P3" }, { field: "Tên", op: "contains", value: "thuan" }] }] }),
    ).toEqual(["Lê Văn C", "Nguyễn Thuận"]);
  });

  it("search across all text cells, accent and case insensitive, every word must match", async () => {
    const r = await a("datahub.row.list", { table_id: x.tableId, search: "tran ha" });
    expect(r.items).toHaveLength(1);
    expect((await a("datahub.row.list", { table_id: x.tableId, search: "gmail" })).items).toHaveLength(1);
    expect((await a("datahub.row.list", { table_id: x.tableId, search: "p2" })).items).toHaveLength(1); // option names are searchable
    expect((await a("datahub.row.list", { table_id: x.tableId, search: "khong co" })).items).toHaveLength(0);
  });

  it("bad filters: unknown column, operator not valid for the type, missing value", async () => {
    for (const f of [{ field: "Không có", op: "eq", value: 1 }, { field: "Số", op: "contains", value: "1" }, { field: "Tên", op: "gt", value: "a" }, { field: "Tên", op: "eq" }, { field: "Nhãn", op: "gt", value: "x" }, { field: "Xong", op: "contains", value: "x" }]) {
      expect((await fails(a("datahub.row.list", { table_id: x.tableId, filter: JSON.stringify(f) }))).code).toBe("invalid_filter");
    }
  });
});

describe("sorting and keyset pagination", () => {
  let x: Awaited<ReturnType<typeof makeTable>>;
  const k = (n: string) => x.cols[n]!.key;
  beforeAll(async () => {
    x = await makeTable(a, {
      columns: [
        { name: "Tên", type: "text" },
        { name: "Mức", type: "single_select", config: { options: [{ name: "P1 - Ưu tiên cao" }, { name: "P2" }, { name: "P3" }, { name: "Chưa đủ dữ liệu" }, { name: "Không đánh giá" }] } },
        { name: "Hạn", type: "date" },
      ],
    });
    // Alphabetical order of the options would be: Chưa đủ, Không, P1, P2, P3. The user's order is the list above.
    const data = [
      { Tên: "d", Mức: "Không đánh giá", Hạn: "2026-01-03" },
      { Tên: "b", Mức: "P2", Hạn: "2026-01-02" },
      { Tên: "a", Mức: "P1 - Ưu tiên cao" },
      { Tên: "c", Mức: "P2", Hạn: "2026-01-01" },
      { Tên: "e", Hạn: "2026-01-05" },
      { Tên: "f", Mức: "Chưa đủ dữ liệu" },
      { Tên: "g", Mức: "P3", Hạn: "2026-01-04" },
      { Tên: "h" },
    ];
    for (const r of data) await a("datahub.row.create", { table_id: x.tableId, data: r });
  });
  const names = (r: { items: { data: Record<string, unknown> }[] }) => r.items.map((i) => i.data[k("Tên")]).join("");

  it("sorts a single select by the option order, not the alphabet; empty last by default", async () => {
    expect(names(await a("datahub.row.list", { table_id: x.tableId, sort: "Mức,Tên" }))).toBe("a" + "bc" + "g" + "f" + "d" + "eh");
    expect(names(await a("datahub.row.list", { table_id: x.tableId, sort: JSON.stringify([{ field: "Mức", dir: "desc" }, { field: "Tên", dir: "asc" }]) }))).toBe("eh" + "d" + "f" + "g" + "bc" + "a");
  });

  it("empty values first or last on request; multi-level sort", async () => {
    expect(names(await a("datahub.row.list", { table_id: x.tableId, sort: "Hạn:asc:first,Tên" }))).toBe("afh" + "c" + "b" + "d" + "g" + "e");
    expect(names(await a("datahub.row.list", { table_id: x.tableId, sort: "Hạn:desc:last,Tên" }))).toBe("e" + "g" + "d" + "b" + "c" + "afh");
    // The example of the design: priority (option order), then due date, empty last.
    expect(names(await a("datahub.row.list", { table_id: x.tableId, sort: "Mức:asc,Hạn:asc:last,Tên" }))).toBe("a" + "cb" + "g" + "f" + "d" + "eh");
  });

  it("sorts by a name with spaces or a column key, and standard fields", async () => {
    expect(names(await a("datahub.row.list", { table_id: x.tableId, sort: `${k("Tên")}:desc` }))).toBe("hgfedcba");
    expect(names(await a("datahub.row.list", { table_id: x.tableId, sort: "_row_no:desc" }))).toBe("hgfecabd");
  });

  it("keyset pages cover every row exactly once with many ties and empty values, in every sort direction", async () => {
    const y = await makeTable(a, { columns: [{ name: "Nhóm", type: "number" }, { name: "Mức", type: "single_select", config: { options: [{ name: "A" }, { name: "B" }, { name: "C" }] } }, { name: "STT", type: "auto_number" }] });
    const ops = Array.from({ length: 120 }, (_, i) => ({ op: "create", data: { ...(i % 7 === 0 ? {} : { Nhóm: i % 4 }), ...(i % 5 === 0 ? {} : { Mức: ["A", "B", "C"][i % 3] }) } }));
    await a("datahub.row.batch", { table_id: y.tableId, ops });
    const sorts = ["Nhóm", "Nhóm:desc", "Nhóm:asc:first", "Nhóm:desc:last", "Mức,Nhóm:desc", "Mức:desc:first,Nhóm:asc:last", "_created_at", "STT:desc"];
    for (const sort of sorts) {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const r = await a("datahub.row.list", { table_id: y.tableId, sort, limit: 17, cursor });
        seen.push(...r.items.map((i: { id: string }) => i.id));
        cursor = r.next_cursor ?? r.nextCursor ?? undefined;
        pages++;
      } while (cursor && pages < 20);
      expect(seen, sort).toHaveLength(120);
      expect(new Set(seen).size, sort).toBe(120);
      // Same order as one big page.
      const whole = await a("datahub.row.list", { table_id: y.tableId, sort, limit: 500 });
      expect(seen, sort).toEqual(whole.items.map((i: { id: string }) => i.id));
    }
  });

  it("a cursor from another sort is refused", async () => {
    const r = await a("datahub.row.list", { table_id: x.tableId, sort: "Tên", limit: 2 });
    expect(r.nextCursor).toBeTruthy();
    expect((await fails(a("datahub.row.list", { table_id: x.tableId, sort: "Tên:desc", limit: 2, cursor: r.nextCursor }))).code).toBe("invalid_filter");
  });
});
