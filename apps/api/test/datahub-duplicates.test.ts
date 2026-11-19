import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.leaderA, org.mgrA, org.admin]) await unlimit(t, p.id);
  a = as(t, org.userA1.id);
});
afterAll(async () => {
  await t.close();
});

async function seed() {
  const x = await makeTable(a, { columns: [{ name: "Tên công ty", type: "text" }, { name: "MST", type: "text" }, { name: "Ghi chú", type: "text" }, { name: "Doanh thu", type: "number" }] });
  const rows = [
    { "Tên công ty": "Công ty Thuận Phát ", MST: "0101", "Doanh thu": 5 },
    { "Tên công ty": "cong ty thuan phat", MST: "0102", "Ghi chú": "đã gọi" },
    { "Tên công ty": "CÔNG  TY THUẬN PHÁT", MST: "0103" },
    { "Tên công ty": "Công ty Khác", MST: "0201" },
    { "Tên công ty": "Công ty Khác", MST: "0201", "Doanh thu": 9 },
    { "Tên công ty": "Không trùng", MST: "0301" },
    { "Tên công ty": "", MST: "" },
    { "Tên công ty": "", MST: "" },
  ];
  const ids: string[] = [];
  for (const r of rows) ids.push((await a("datahub.row.create", { table_id: x.tableId, data: r })).id);
  return { ...x, ids };
}

describe("duplicates: find", () => {
  it("normalises accents, case and spaces; ignores empty keys; groups by one or several columns", async () => {
    const x = await seed();
    const r = await a("datahub.row.duplicates", { table_id: x.tableId, columns: "Tên công ty" });
    expect(r.total_groups).toBe(2);
    expect(r.total_rows).toBe(5);
    expect(r.groups[0]).toMatchObject({ count: 3, ids: [x.ids[0], x.ids[1], x.ids[2]] });
    expect(r.groups[1]).toMatchObject({ count: 2, ids: [x.ids[3], x.ids[4]] });
    const two = await a("datahub.row.duplicates", { table_id: x.tableId, columns: `${x.cols["Tên công ty"]!.key},MST` });
    expect(two.total_groups).toBe(1);
    expect(two.groups[0]!.ids).toEqual([x.ids[3], x.ids[4]]);
    expect(two.has_more).toBe(false);
  });

  it("pages groups and refuses bad column choices", async () => {
    const x = await seed();
    const p = await a("datahub.row.duplicates", { table_id: x.tableId, columns: "Tên công ty", limit: 1 });
    expect(p.groups).toHaveLength(1);
    expect(p.has_more).toBe(true);
    expect((await fails(a("datahub.row.duplicates", { table_id: x.tableId, columns: "Cột không có" }))).code).toBe("validation_error");
  });

  it("works on 20.000 rows in a reasonable time", async () => {
    const x = await makeTable(a, { columns: [{ name: "Tên", type: "text" }] });
    await t.c.db.db.execute((await import("drizzle-orm")).sql`INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
      SELECT gen_random_uuid(), ${x.tableId}::uuid, g, jsonb_build_object(${x.cols["Tên"]!.key}::text, 'Công ty ' || (g % 10000)), '', ${org.userA1.id}::uuid, ${org.userA1.id}::uuid FROM generate_series(1, 20000) g`);
    const t0 = Date.now();
    const r = await a("datahub.row.duplicates", { table_id: x.tableId, columns: "Tên" });
    expect(r.total_groups).toBe(10000);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe("duplicates: resolve", () => {
  it("keep one and delete the others (to the trash, restorable); merge writes values to the kept row with history", async () => {
    const x = await seed();
    const res = await a("datahub.row.duplicates.resolve", { table_id: x.tableId, groups: [{ keep_id: x.ids[0], remove_ids: [x.ids[1], x.ids[2]], values: { "Ghi chú": "đã gọi" } }, { keep_id: x.ids[3], remove_ids: [x.ids[4]] }] });
    expect(res).toMatchObject({ groups_resolved: 2, rows_removed: 3, rows_merged: 1 });
    const left = await a("datahub.row.duplicates", { table_id: x.tableId, columns: "Tên công ty" });
    expect(left.total_groups).toBe(0);
    const kept = await a("datahub.row.get", { table_id: x.tableId, row_id: x.ids[0] });
    expect(kept.data[x.cols["Ghi chú"]!.key]).toBe("đã gọi");
    const hist = await a("datahub.row.history", { table_id: x.tableId, row_id: x.ids[0] });
    expect(hist.items[0].op).toBe("update");
    const trash = await a("datahub.trash.list", { table_id: x.tableId });
    expect(trash.rows.map((r: { id: string }) => r.id).sort()).toEqual([x.ids[1], x.ids[2], x.ids[4]].sort());
    await a("datahub.row.restore", { table_id: x.tableId, row_id: x.ids[1] });
    expect((await a("datahub.row.duplicates", { table_id: x.tableId, columns: "Tên công ty" })).total_groups).toBe(1);
  });

  it("all: keep first / last / most_filled, with fill_empty copying cells into the kept row", async () => {
    const x = await seed();
    const r = await a("datahub.row.duplicates.resolve", { table_id: x.tableId, all: { columns: ["Tên công ty"], keep: "first", fill_empty: true } });
    expect(r).toMatchObject({ groups_resolved: 2, rows_removed: 3, remaining_groups: 0 });
    const kept = await a("datahub.row.get", { table_id: x.tableId, row_id: x.ids[0] });
    expect(kept.data[x.cols["Ghi chú"]!.key]).toBe("đã gọi");
    expect(kept.data[x.cols["Doanh thu"]!.key]).toBe(5);
    const kept2 = await a("datahub.row.get", { table_id: x.tableId, row_id: x.ids[3] });
    expect(kept2.data[x.cols["Doanh thu"]!.key]).toBe(9);

    const y = await seed();
    await a("datahub.row.duplicates.resolve", { table_id: y.tableId, all: { columns: ["Tên công ty"], keep: "most_filled", fill_empty: false } });
    const live = (await a("datahub.row.list", { table_id: y.tableId })).items.map((r: { id: string }) => r.id);
    expect(live).toContain(y.ids[0]); // rows 0 and 1 both hold 3 values: a tie keeps the first
    expect(live).not.toContain(y.ids[1]);
    expect(live).toContain(y.ids[4]); // has revenue
    expect(live).not.toContain(y.ids[3]);

    const z = await seed();
    await a("datahub.row.duplicates.resolve", { table_id: z.tableId, all: { columns: ["Tên công ty"], keep: "last", fill_empty: false } });
    const liveZ = (await a("datahub.row.list", { table_id: z.tableId })).items.map((r: { id: string }) => r.id);
    expect(liveZ).toContain(z.ids[2]);
    expect(liveZ).not.toContain(z.ids[0]);
    await drainOutbox(t);
  });

  it("refuses overlapping rows, missing rows; needs edit permission", async () => {
    const x = await seed();
    expect((await fails(a("datahub.row.duplicates.resolve", { table_id: x.tableId, groups: [{ keep_id: x.ids[0], remove_ids: [x.ids[0]] }] }))).code).toBe("validation_error");
    expect((await fails(a("datahub.row.duplicates.resolve", { table_id: x.tableId, groups: [{ keep_id: x.ids[0], remove_ids: ["01900000-0000-7000-8000-00000000dead"] }] }))).code).toBe("not_found");
    expect((await fails(a("datahub.row.duplicates.resolve", { table_id: x.tableId }))).code).toBe("validation_error");
    // View sharing, Leader, Manager, Admin: no access.
    await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
    for (const p of [org.userA2, org.leaderA, org.mgrA, org.admin]) {
      const c = as(t, p.id);
      const e1 = await fails(c("datahub.row.duplicates", { table_id: x.tableId, columns: "Tên công ty" }));
      const e2 = await fails(c("datahub.row.duplicates.resolve", { table_id: x.tableId, all: { columns: ["Tên công ty"], keep: "first", fill_empty: false } }));
      expect([e1.code, e2.code].every((k) => k === "forbidden" || k === "not_found")).toBe(true);
    }
    // Edit permission works.
    await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    const r = await as(t, org.userA2.id)("datahub.row.duplicates", { table_id: x.tableId, columns: "Tên công ty" });
    expect(r.total_groups).toBe(2);
  });
});
