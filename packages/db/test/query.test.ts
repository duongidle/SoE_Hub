import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { FilterNode } from "@soe/shared";
import { listPage, compileFilter, newId, type FieldMap } from "../src/index";
import { appDb, testItems } from "./helpers";

const TAG = `q-${newId().slice(-8)}`;

const fields: FieldMap = {
  id: { type: "uuid", expr: testItems.id },
  name: { type: "text", expr: testItems.name },
  status: { type: "enum", expr: testItems.status, values: ["new", "won", "lost"] },
  amount: { type: "number", expr: testItems.amount },
  closing_date: { type: "date", expr: testItems.closingDate },
  happened_at: { type: "datetime", expr: testItems.happenedAt },
  done: { type: "boolean", expr: testItems.done },
  created_at: { type: "datetime", expr: testItems.createdAt },
};

const base = sql`name LIKE ${TAG + "%"} AND deleted_at IS NULL`;

async function ids(filter: FilterNode | undefined) {
  const { db } = appDb();
  const r = await listPage(db, { from: sql`test_items`, fields, baseWhere: base, filter, defaultSort: [{ field: "name", dir: "asc" }], limit: 500 });
  return r.items.map((i) => (i.name as string).slice(TAG.length + 1)).sort();
}

beforeAll(async () => {
  const { db } = appDb();
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => new Date(today.getTime() - n * 86400000);
  await db.insert(testItems).values([
    { name: `${TAG} Thuận Phát`, status: "won", amount: 500_000_000, closingDate: "2026-10-15", done: true },
    { name: `${TAG} Đặng Văn A`, status: "new", amount: 100, closingDate: "2026-12-31" },
    { name: `${TAG} 50%_off`, status: "lost", amount: null, closingDate: null },
    { name: `${TAG} recent`, status: "new", amount: 5, closingDate: iso(daysAgo(2)), happenedAt: daysAgo(2) },
    { name: `${TAG} old`, status: "new", amount: 6, closingDate: iso(daysAgo(400)), happenedAt: daysAgo(400) },
    { name: `${TAG} empty`, status: "new", amount: 7 },
  ]);
});

describe("filter DSL -> SQL", () => {
  it("eq / in / between / and / or", async () => {
    expect(await ids({ field: "status", op: "eq", value: "won" })).toEqual(["Thuận Phát"]);
    expect(await ids({ field: "status", op: "in", value: ["won", "lost"] })).toEqual(["50%_off", "Thuận Phát"]);
    expect(await ids({ field: "closing_date", op: "between", value: ["2026-10-01", "2026-12-31"] })).toEqual(expect.arrayContaining(["Thuận Phát", "Đặng Văn A"]));
    expect(await ids({ field: "closing_date", op: "between", value: ["2026-10-01", "2026-10-31"] })).toEqual(["Thuận Phát"]);
    expect(
      await ids({
        and: [
          { field: "status", op: "in", value: ["won", "new"] },
          { or: [{ field: "name", op: "contains", value: "thuan" }, { field: "amount", op: "gte", value: 100 }] },
        ],
      }),
    ).toEqual(["Thuận Phát", "Đặng Văn A"].sort());
  });

  it("contains ignores accents and case (Vietnamese)", async () => {
    expect(await ids({ field: "name", op: "contains", value: "THUAN phat" })).toEqual(["Thuận Phát"]);
    expect(await ids({ field: "name", op: "contains", value: "dang van" })).toEqual(["Đặng Văn A"]);
    expect(await ids({ field: "name", op: "starts_with", value: `${TAG} thuan` })).toEqual(["Thuận Phát"]);
  });

  it("escapes LIKE wildcards in the user value", async () => {
    expect(await ids({ field: "name", op: "contains", value: "50%_" })).toEqual(["50%_off"]);
    expect(await ids({ field: "name", op: "contains", value: "%" })).toEqual(["50%_off"]);
  });

  it("is_empty / is_not_empty / neq / nin treat NULL sensibly", async () => {
    expect(await ids({ field: "amount", op: "is_empty" })).toEqual(["50%_off"]);
    expect((await ids({ field: "closing_date", op: "is_not_empty" })).length).toBe(4);
    expect(await ids({ field: "status", op: "neq", value: "new" })).toEqual(["50%_off", "Thuận Phát"]);
    expect(await ids({ field: "status", op: "nin", value: ["new"] })).toEqual(["50%_off", "Thuận Phát"]);
  });

  it("relative dates", async () => {
    expect(await ids({ field: "closing_date", op: "last_n_days", value: 7 })).toEqual(["recent"]);
    expect(await ids({ field: "happened_at", op: "last_n_days", value: 7 })).toEqual(["recent"]);
    expect(await ids({ field: "closing_date", op: "last_year" })).not.toContain("recent");
    const thisYear = await ids({ field: "closing_date", op: "this_year" });
    expect(Array.isArray(thisYear)).toBe(true);
    for (const op of ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_quarter", "last_quarter"] as const) {
      await expect(ids({ field: "happened_at", op })).resolves.toBeDefined();
    }
  });

  it("rejects bad input with invalid_filter", async () => {
    const bad = (f: FilterNode) => expect(ids(f)).rejects.toMatchObject({ code: "invalid_filter" });
    await bad({ field: "nope", op: "eq", value: 1 });
    await bad({ field: "name", op: "gt", value: "a" }); // op not allowed for text
    await bad({ field: "amount", op: "eq", value: "abc" });
    await bad({ field: "status", op: "eq", value: "weird" });
    await bad({ field: "closing_date", op: "eq", value: "15/10/2026" });
    await bad({ field: "amount", op: "between", value: [1] });
    await bad({ field: "amount", op: "in", value: [] });
    await bad({ field: "closing_date", op: "last_n_days", value: 0 });
    await bad({ field: "id", op: "eq", value: "not-a-uuid" });
  });

  it("limits depth and number of conditions", () => {
    let deep: FilterNode = { field: "amount", op: "eq", value: 1 };
    for (let i = 0; i < 6; i++) deep = { and: [deep] };
    expect(() => compileFilter(deep, fields)).toThrow(/lồng/);
    const many: FilterNode = { and: Array.from({ length: 51 }, () => ({ field: "amount", op: "eq", value: 1 }) as FilterNode) };
    expect(() => compileFilter(many, fields)).toThrow(/tối đa/);
  });

  it("injection attempts stay inert (values are bind parameters)", async () => {
    expect(await ids({ field: "name", op: "contains", value: "'; DROP TABLE test_items; --" })).toEqual([]);
    expect((await ids(undefined)).length).toBe(6);
  });
});

describe("keyset pagination", () => {
  const PAGE_TAG = `pg-${newId().slice(-8)}`;
  const pageBase = sql`name LIKE ${PAGE_TAG + "%"} AND deleted_at IS NULL`;

  beforeAll(async () => {
    const { db } = appDb();
    const rows = Array.from({ length: 53 }, (_, i) => ({
      name: `${PAGE_TAG}-${String(i).padStart(3, "0")}`,
      // many ties on amount, and some NULLs
      amount: i % 7 === 0 ? null : i % 5,
      // sub-millisecond differences must survive the cursor
      happenedAt: new Date(1_700_000_000_000 + Math.floor(i / 10) * 1000),
    }));
    await db.insert(testItems).values(rows);
    // Give a few rows identical timestamps with microsecond differences.
    await db.execute(sql`UPDATE test_items SET happened_at = '2026-01-01 10:00:00.000100+00' WHERE name = ${PAGE_TAG + "-001"}`);
    await db.execute(sql`UPDATE test_items SET happened_at = '2026-01-01 10:00:00.000200+00' WHERE name = ${PAGE_TAG + "-002"}`);
    await db.execute(sql`UPDATE test_items SET happened_at = '2026-01-01 10:00:00.000300+00' WHERE name = ${PAGE_TAG + "-003"}`);
  });

  async function walk(sort: string, limit: number) {
    const { db } = appDb();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: Awaited<ReturnType<typeof listPage<Record<string, unknown>>>> = await listPage(db, {
        from: sql`test_items`, fields, baseWhere: pageBase, sort, defaultSort: [{ field: "name", dir: "asc" }], limit, cursor, includeTotal: pages === 0,
      });
      if (pages === 0) expect(r.total).toBe(53);
      seen.push(...r.items.map((i) => i.id as string));
      cursor = r.nextCursor;
      pages++;
    } while (cursor && pages < 100);
    return { seen, pages };
  }

  async function expected(orderBy: string) {
    const { db } = appDb();
    const res = await db.execute(sql`SELECT id FROM test_items WHERE name LIKE ${PAGE_TAG + "%"} ORDER BY ${sql.raw(orderBy)}`);
    return res.rows.map((r) => (r as { id: string }).id);
  }

  it("visits every row exactly once, in order, for ASC with NULLs and ties", async () => {
    const { seen, pages } = await walk("amount:asc", 8);
    expect(pages).toBe(Math.ceil(53 / 8));
    expect(new Set(seen).size).toBe(53);
    expect(seen).toEqual(await expected("amount ASC NULLS LAST, id ASC"));
  });

  it("works for DESC (NULLs first)", async () => {
    const { seen } = await walk("amount:desc", 6);
    expect(seen).toEqual(await expected("amount DESC NULLS FIRST, id ASC"));
  });

  it("works for mixed directions and timestamps with microseconds", async () => {
    const { seen } = await walk("happened_at:desc,amount:asc", 4);
    expect(new Set(seen).size).toBe(53);
    expect(seen).toEqual(await expected("happened_at DESC NULLS FIRST, amount ASC NULLS LAST, id ASC"));
  });

  it("limit larger than data returns no cursor; `fields` limits the columns", async () => {
    const { db } = appDb();
    const r = await listPage(db, { from: sql`test_items`, fields, baseWhere: pageBase, defaultSort: [{ field: "name", dir: "asc" }], limit: 500, select: "name,amount" });
    expect(r.nextCursor).toBeNull();
    expect(r.items).toHaveLength(53);
    expect(Object.keys(r.items[0]!).sort()).toEqual(["amount", "name"]);
  });

  it("rejects a cursor that does not match the sort, garbage cursors, unknown sort or select fields", async () => {
    const { db } = appDb();
    const first = await listPage(db, { from: sql`test_items`, fields, baseWhere: pageBase, sort: "amount:asc", defaultSort: [], limit: 5 });
    const run = (o: object) => listPage(db, { from: sql`test_items`, fields, baseWhere: pageBase, defaultSort: [{ field: "name", dir: "asc" }], ...o });
    await expect(run({ sort: "amount:desc", cursor: first.nextCursor })).rejects.toMatchObject({ code: "invalid_filter" });
    await expect(run({ cursor: "!!!" })).rejects.toMatchObject({ code: "invalid_filter" });
    await expect(run({ sort: "nope:asc" })).rejects.toMatchObject({ code: "invalid_filter" });
    await expect(run({ select: "nope" })).rejects.toMatchObject({ code: "invalid_filter" });
  });
});
