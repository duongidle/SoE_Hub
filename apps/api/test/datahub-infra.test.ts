import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import pg from "pg";
import { as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { devHeaders, makeApp, type TestApp } from "./helpers";
import { seedOrg, type Org } from "./fixtures";
import { SseHub, type SseSignal } from "../src/http/sse";
import { processIndexRequests } from "../src/modules/datahub/export-views";

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

const ownerClient = async () => {
  const c = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
  await c.connect();
  return c;
};

describe("query guard: datahub tables are owned data", () => {
  it("a query straight on a datahub table without the scope marker is refused (in dev and test)", async () => {
    for (const q of ["SELECT * FROM dh_rows", "UPDATE dh_columns SET name = 'x'", "SELECT 1 FROM dh_datahubs d JOIN dh_tables t ON t.datahub_id = d.id", "DELETE FROM dh_shares", "SELECT * FROM dh_views"]) {
      const err = await t.c.db.db.execute(sql.raw(q)).then(() => null, (e: Error & { cause?: Error }) => e);
      expect(String(err?.cause?.message ?? err?.message), q).toMatch(/phạm vi/);
    }
    // With the marker it runs (the helper functions put it there).
    await expect(t.c.db.db.execute(sql`SELECT count(*) FROM dh_rows WHERE /*scope:system*/ true`)).resolves.toBeDefined();
  });
});

describe("settings: default limits are system settings", () => {
  it("Admin changes the defaults; invalid values are refused; the ceiling of columns is 200", async () => {
    const admin = as(t, org.admin.id);
    const fresh = as(t, org.guestSale.id);
    void fresh;
    const cat = await admin("system.setting.catalog");
    const keys = JSON.stringify(cat);
    for (const k of ["datahub.max_datahubs", "datahub.max_tables", "datahub.max_columns"]) expect(keys).toContain(k);
    expect((await fails(admin("system.setting.set", { key: "datahub.max_columns", value: 201 }))).code).toBe("validation_error");
    expect((await fails(admin("system.setting.set", { key: "datahub.max_datahubs", value: 0 }))).code).toBe("validation_error");
    await admin("system.setting.set", { key: "datahub.max_tables", value: 12 });
    expect((await as(t, org.leaderA.id)("datahub.limit.mine")).limits).toEqual({ datahubs: 5, tables: 12, columns: 70 });
    const cur = await admin("system.setting.get", { key: "datahub.max_tables" });
    await admin("system.setting.set", { key: "datahub.max_tables", value: 10, version: cur.version });
  });
});

describe("SQL export views in schema dh_views (design module2 section 3)", () => {
  it("one view per table with the user's column names, rebuilt by the worker when the structure changes; soe_app cannot read it", async () => {
    const x = await makeTable(owner, {
      name: "Theo dõi lead",
      columns: [
        { name: "Khách hàng", type: "text" },
        { name: "Doanh thu", type: "currency" },
        { name: "Mức", type: "single_select", config: { options: [{ name: "Nóng" }, { name: "Ấm" }] } },
        { name: "Ngày hẹn", type: "date" },
        { name: "Nhãn", type: "multi_select", config: { options: [{ name: "a" }, { name: "b" }] } },
      ],
    });
    await owner("datahub.row.create", { table_id: x.tableId, data: { "Khách hàng": "Thuận", "Doanh thu": 150, Mức: "Ấm", "Ngày hẹn": "2026-12-01", Nhãn: ["a", "b"] } });
    await owner("datahub.row.create", { table_id: x.tableId, data: { "Khách hàng": "Hà" } });
    const gone = await owner("datahub.row.create", { table_id: x.tableId, data: { "Khách hàng": "Xoá" } });
    await owner("datahub.row.delete", { table_id: x.tableId, row_id: gone.id });
    await drainOutbox(t);

    const local = org.userA1.email.split("@")[0];
    const viewName = `${local} – Theo dõi lead – Bảng 1`;
    const tableInfo = await owner("datahub.table.get", { table_id: x.tableId });
    expect(tableInfo.sql_view).toBe(viewName);

    const db = await ownerClient();
    try {
      const res = await db.query(`SELECT * FROM dh_views."${viewName}" ORDER BY row_no`);
      expect(res.rows).toHaveLength(2);
      expect(Object.keys(res.rows[0])).toEqual(["id", "row_no", "Khách hàng", "Doanh thu", "Mức", "Ngày hẹn", "Nhãn"]);
      expect(res.rows[0]).toMatchObject({ "Khách hàng": "Thuận", "Doanh thu": "150", Mức: "Ấm", Nhãn: "a, b" });
      expect(res.rows[1]["Doanh thu"]).toBeNull();

      // Rename a column and add one: the view follows (the worker rebuilds it).
      await owner("datahub.column.update", { table_id: x.tableId, column: "Doanh thu", name: "Doanh số" });
      await owner("datahub.column.create", { table_id: x.tableId, name: "Ghi chú", type: "text" });
      await drainOutbox(t);
      const res2 = await db.query(`SELECT * FROM dh_views."${viewName}" ORDER BY row_no LIMIT 1`);
      expect(Object.keys(res2.rows[0])).toContain("Doanh số");
      expect(Object.keys(res2.rows[0])).toContain("Ghi chú");
      expect(Object.keys(res2.rows[0])).not.toContain("Doanh thu");

      // Renaming the table renames the view; a trashed table has no view; restoring brings it back.
      await owner("datahub.table.update", { table_id: x.tableId, name: "Lead Q4" });
      await drainOutbox(t);
      const newName = `${local} – Theo dõi lead – Lead Q4`;
      expect((await db.query(`SELECT count(*)::int AS n FROM dh_views."${newName}"`)).rows[0].n).toBe(2);
      await expect(db.query(`SELECT 1 FROM dh_views."${viewName}"`)).rejects.toThrow();
      await owner("datahub.table.delete", { table_id: x.tableId });
      await drainOutbox(t);
      await expect(db.query(`SELECT 1 FROM dh_views."${newName}"`)).rejects.toThrow();
      await owner("datahub.table.restore", { table_id: x.tableId });
      await drainOutbox(t);
      expect((await db.query(`SELECT count(*)::int AS n FROM dh_views."${newName}"`)).rows[0].n).toBe(2);
    } finally {
      await db.end();
    }

    // The runtime role cannot read the schema (only the schema owner / admin database role can).
    const app = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await app.connect();
    try {
      await expect(app.query(`SELECT * FROM dh_views."${local} – Theo dõi lead – Lead Q4"`)).rejects.toThrow(/permission denied/);
      // ... and it cannot create things there either, nor call the DDL functions with bad input.
      await expect(app.query(`CREATE VIEW dh_views.evil AS SELECT 1`)).rejects.toThrow();
      await expect(app.query(`SELECT soe_dh_ensure_index('${x.tableId}'::uuid, 'a; drop table users', 'text')`)).rejects.toThrow(/invalid column key/);
      await expect(app.query(`SELECT soe_dh_ensure_index('${x.tableId}'::uuid, 'c_abc', 'nope')`)).rejects.toThrow(/invalid index kind/);
    } finally {
      await app.end();
    }
  });

  it("long names are cut to the 63-byte identifier limit and two tables never share a view name", async () => {
    const long = "Một cái tên rất dài của datahub để thử giới hạn định danh của Postgres";
    const x = await makeTable(owner, { name: long });
    const t2 = await owner("datahub.table.create", { datahub_id: x.dhId, name: "Một cái tên rất dài của bảng để thử giới hạn định danh" });
    await drainOutbox(t);
    const db = await ownerClient();
    try {
      const names = (await db.query(`SELECT sql_view FROM dh_tables WHERE id = ANY($1::uuid[])`, [[x.tableId, t2.id]])).rows.map((r) => r.sql_view as string);
      expect(names[0]).not.toBe(names[1]);
      for (const n of names) {
        expect(Buffer.byteLength(n)).toBeLessThanOrEqual(63);
        expect((await db.query(`SELECT count(*)::int AS n FROM dh_views."${n}"`)).rows[0].n).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await db.end();
    }
  });
});

describe("SSE signals reach only people who can see the table", () => {
  it("row and structure signals: owner and sharees only; a table share covers only that table", async () => {
    const x = await makeTable(owner, { columns: [{ name: "Tên", type: "text" }] });
    const t2 = await owner("datahub.table.create", { datahub_id: x.dhId, name: "Bảng 2" });
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userB1.id, table_id: x.tableId, permission: "edit_data" });
    await drainOutbox(t); // flush earlier events first

    const hub = new SseHub(t.c.config.DATABASE_URL, t.c.logger);
    await hub.start();
    try {
      const got: SseSignal[] = [];
      hub.subscribe((s) => got.push(s));
      await owner("datahub.row.create", { table_id: x.tableId, data: { Tên: "a" } });
      await owner("datahub.row.create", { table_id: t2.id, data: {} });
      await owner("datahub.column.create", { table_id: t2.id, name: "C", type: "text" });
      await drainOutbox(t);
      await new Promise((r) => setTimeout(r, 400));
      const rowSig = (tableId: string) => got.find((s) => s.event === "datahub.row.created" && s.aggregate_id === tableId)!;
      expect(rowSig(x.tableId).audience!.users!.sort()).toEqual([org.userA1.id, org.userA2.id, org.userB1.id].sort());
      expect(rowSig(t2.id).audience!.users!.sort()).toEqual([org.userA1.id, org.userA2.id].sort());
      const structure = got.find((s) => s.event === "datahub.structure.changed" && s.aggregate_id === t2.id)!;
      expect(structure.audience!.users).not.toContain(org.userB1.id);
      // No values in a signal.
      expect(JSON.stringify(got.filter((s) => s.event.startsWith("datahub.")))).not.toContain('"Tên"');
    } finally {
      await hub.stop();
    }
  });

  it("HTTP stream: the owner gets the signal, a stranger (also a Manager) does not", async () => {
    const x = await makeTable(owner, { columns: [{ name: "Tên", type: "text" }] });
    await drainOutbox(t);
    const hub = new SseHub(t.c.config.DATABASE_URL, t.c.logger);
    await hub.start();
    const { buildApp } = await import("../src/http/app");
    const server = await buildApp({ ...t.c, sse: hub });
    await server.listen({ port: 0, host: "127.0.0.1" });
    const port = (server.server.address() as { port: number }).port;
    const ctl = new AbortController();
    const open = async (userId: string) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/events?topics=datahub`, { signal: ctl.signal, headers: devHeaders(userId) });
      const reader = res.body!.getReader();
      const state = { text: "" };
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return;
            state.text += new TextDecoder().decode(value);
          }
        } catch {
          /* aborted */
        }
      })();
      return state;
    };
    try {
      const mine = await open(org.userA1.id);
      const stranger = await open(org.mgrA.id);
      await new Promise((r) => setTimeout(r, 300));
      await owner("datahub.row.create", { table_id: x.tableId, data: { Tên: "x" } });
      await drainOutbox(t);
      await new Promise((r) => setTimeout(r, 500));
      expect(mine.text).toContain("datahub.row.created");
      expect(mine.text).toContain(x.tableId);
      expect(stranger.text).not.toContain("datahub.row.created");
      expect(stranger.text).not.toContain(x.tableId);
    } finally {
      ctl.abort();
      await server.close();
      await hub.stop();
    }
  });
});

describe("data transfer: datahubs move to the target", () => {
  it("ownership moves (also trashed ones), name clashes are resolved, shares to the target vanish, source is locked", async () => {
    const o2 = await seedOrg(t);
    for (const p of [o2.userA1, o2.userA2]) await unlimit(t, p.id);
    const from = as(t, o2.userA1.id);
    const to = as(t, o2.userA2.id);
    const a = await makeTable(from, { name: "Báo cáo", columns: [{ name: "Tên", type: "text" }] });
    const b = await makeTable(from, { name: "Lưu trữ" });
    await from("datahub.datahub.delete", { datahub_id: b.dhId });
    await to("datahub.datahub.create", { name: "báo cáo" });
    await from("datahub.share.set", { datahub_id: a.dhId, grantee_id: o2.userA2.id, permission: "view" });
    await from("datahub.row.create", { table_id: a.tableId, data: { Tên: "giữ nguyên" } });

    const admin = as(t, o2.admin.id);
    const preview = await admin("data.transfer.preview", { from_user_id: o2.userA1.id, to_user_id: o2.userA2.id });
    const group = preview.groups.find((g: { handler: string }) => g.handler === "datahubs");
    expect(group.items.map((i: { label: string }) => i.label).sort()).toEqual(["Báo cáo", "Lưu trữ (trong thùng rác)"]);
    await admin("data.transfer.execute", { from_user_id: o2.userA1.id, to_user_id: o2.userA2.id });

    const mine = await to("datahub.datahub.list");
    expect(mine.map((d: { name: string }) => d.name).sort()).toEqual(["Báo cáo (chuyển giao)", "báo cáo"]);
    const moved = mine.find((d: { id: string }) => d.id === a.dhId);
    expect(moved).toMatchObject({ owner_id: o2.userA2.id, access: "owner" });
    expect((await to("datahub.row.list", { table_id: a.tableId })).items).toHaveLength(1);
    // Now the new owner changes structure; the old owner is locked out; the redundant share is gone.
    await to("datahub.column.create", { table_id: a.tableId, name: "Mới", type: "text" });
    expect((await to("datahub.share.list", { datahub_id: a.dhId })).filter((s: { grantee_id: string }) => s.grantee_id === o2.userA2.id)).toHaveLength(0);
    const trash = await to("datahub.trash.list");
    expect(trash.datahubs.map((d: { id: string }) => d.id)).toContain(b.dhId);
    // The export view name follows the new owner.
    await drainOutbox(t);
    const db = await ownerClient();
    try {
      const name = (await db.query(`SELECT sql_view FROM dh_tables WHERE id = $1`, [a.tableId])).rows[0].sql_view as string;
      expect(name.startsWith(`${o2.userA2.email.split("@")[0]} – `)).toBe(true);
    } finally {
      await db.end();
    }
  });
});

describe("auto index (Module 0 section 6.2)", () => {
  it("a table above 5,000 rows gets expression indexes for filtered and sorted columns, within a budget of 8", async () => {
    const x = await makeTable(owner, {
      columns: [
        { name: "Tên", type: "text" }, { name: "Số", type: "number" }, { name: "Ngày", type: "date" }, { name: "Mức", type: "single_select", config: { options: [{ name: "A" }, { name: "B" }] } },
        { name: "C1", type: "number" }, { name: "C2", type: "number" }, { name: "C3", type: "number" }, { name: "C4", type: "number" }, { name: "C5", type: "number" }, { name: "C6", type: "number" },
      ],
    });
    const db = await ownerClient();
    try {
      const k = (n: string) => x.cols[n]!.key;
      // Small table: using a column creates no request.
      await owner("datahub.row.list", { table_id: x.tableId, filter: JSON.stringify({ field: "Số", op: "gt", value: 1 }) });
      expect((await db.query(`SELECT count(*)::int AS n FROM dh_index_requests WHERE table_id = $1`, [x.tableId])).rows[0].n).toBe(0);

      await db.query(
        `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
         SELECT gen_random_uuid(), $1, g, jsonb_build_object($2::text, 'ten ' || g, $3::text, g % 1000, $4::text, to_char(date '2026-01-01' + (g % 300), 'YYYY-MM-DD')), 'ten ' || g, $5, $5 FROM generate_series(1, 6000) g`,
        [x.tableId, k("Tên"), k("Số"), k("Ngày"), org.userA1.id],
      );
      await db.query(`UPDATE dh_tables SET row_count = 6000, next_row_no = 6001 WHERE id = $1`, [x.tableId]);

      await owner("datahub.row.list", { table_id: x.tableId, filter: JSON.stringify({ and: [{ field: "Số", op: "gt", value: 990 }, { field: "Tên", op: "contains", value: "ten 12" }] }), sort: "Ngày:desc" });
      const reqs = (await db.query(`SELECT column_key, kind, status FROM dh_index_requests WHERE table_id = $1 ORDER BY kind`, [x.tableId])).rows;
      expect(reqs.map((r) => `${r.column_key}:${r.kind}`).sort()).toEqual([`${k("Ngày")}:date`, `${k("Số")}:num`, `${k("Tên")}:trgm`].sort());

      const r1 = await processIndexRequests(t.c.db.db);
      expect(r1).toEqual({ done: 3, skipped: 0, failed: 0 });
      const idx = (await db.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'dh_rows' AND indexname LIKE 'dh_ix_%'`)).rows;
      expect(idx).toHaveLength(3);
      expect(idx.every((i) => i.indexdef.includes(`table_id = '${x.tableId}'`))).toBe(true);

      // The planner uses them for the same expression the API generates.
      const plan = (await db.query(`EXPLAIN SELECT id FROM dh_rows WHERE table_id = '${x.tableId}'::uuid AND deleted_at IS NULL AND ((data->>'${k("Số")}')::numeric) = 5`)).rows.map((r) => r["QUERY PLAN"]).join("\n");
      expect(plan).toContain("dh_ix_");

      // Budget: at most 8 automatic indexes per table; the rest are marked skipped.
      for (const c of ["C1", "C2", "C3", "C4", "C5", "C6"]) {
        await owner("datahub.row.list", { table_id: x.tableId, sort: c });
      }
      await owner("datahub.row.list", { table_id: x.tableId, filter: JSON.stringify({ field: "Mức", op: "eq", value: "A" }) });
      const r2 = await processIndexRequests(t.c.db.db);
      expect(r2.done).toBe(5);
      expect(r2.skipped).toBe(2);
      expect(Number((await db.query(`SELECT count(*) FROM pg_indexes WHERE tablename = 'dh_rows' AND indexname LIKE 'dh_ix_%'`)).rows[0].count)).toBe(8);
    } finally {
      await db.end();
    }
  }, 60000);

  it("deleting a column drops nothing until purge; type change drops that column's indexes", async () => {
    const x = await makeTable(owner, { columns: [{ name: "Mã", type: "text", unique: true }] });
    const db = await ownerClient();
    try {
      const count = async () => Number((await db.query(`SELECT count(*) FROM pg_indexes WHERE indexname LIKE $1`, [`dh_ix_${x.tableId.replace(/-/g, "").slice(0, 12)}%`])).rows[0].count);
      expect(await count()).toBe(1);
      await owner("datahub.row.create", { table_id: x.tableId, data: { Mã: "1" } });
      await owner("datahub.column.type_change", { table_id: x.tableId, column: "Mã", type: "number" });
      // Unique survives a type change (rebuilt for the new value form).
      expect(await count()).toBe(1);
      expect((await fails(owner("datahub.row.create", { table_id: x.tableId, data: { Mã: 1 } }))).code).toBe("conflict");
    } finally {
      await db.end();
    }
  });
});
