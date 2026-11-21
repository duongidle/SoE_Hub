import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processJobs } from "../src/modules/datahub";
import { as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Stage 4.7A: a Manager gives a Guest ONE table with the columns the Guest may read (`data_grants.options`), a general mechanism (module1 5.2).
 * The Guest reads only those columns through every path: table shape, rows, groups, filter, sort, export. Invented data only.
 * Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2. Guest "Data" (GuestData) belongs to tree A.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let mgrB: ReturnType<typeof as>;
let guest: ReturnType<typeof as>;
let x: Awaited<ReturnType<typeof makeTable>>;
const env = () => ({ db: t.c.db.db, executor: t.c.executor, storage: t.c.storage, logger: t.c.logger, config: t.c.config });
const k = (name: string) => x.cols[name]!.key;
let grantAll = "";

async function csvOf(call: ReturnType<typeof as>, jobId: string): Promise<string> {
  await processJobs(env());
  const r = (await t.c.db.db.execute(sql`SELECT result_key FROM dh_jobs WHERE id = ${jobId}::uuid`)).rows[0] as { result_key: string };
  const chunks: Buffer[] = [];
  for await (const c of (t.c.storage as unknown as { read(key: string): AsyncIterable<Buffer> }).read(r.result_key)) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.leaderA, org.mgrA, org.mgrB]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  mgrB = as(t, org.mgrB.id);
  guest = as(t, org.guestData.id);
  x = await makeTable(mgrA, {
    columns: [
      { name: "Tên", type: "text" },
      { name: "Doanh thu", type: "number" },
      { name: "Ghi chú nội bộ", type: "text" },
      { name: "Phụ trách", type: "user" },
      { name: "Gấp đôi", type: "formula", config: { formula: "=[Doanh thu]*2" } },
    ],
  });
  await mgrA("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA1.id, permission: "view" });
  await mgrA("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
  await mgrA("datahub.table.share_options.set", { table_id: x.tableId, key_split: true, key_columns: ["Phụ trách"], key_primary: "Phụ trách" });
  const mk = (name: string, rev: number, who: string) => mgrA("datahub.row.create", { table_id: x.tableId, data: { Tên: name, "Doanh thu": rev, "Ghi chú nội bộ": `bí mật ${name}`, "Phụ trách": who } });
  await mk("d1", 100, org.userA1.id); // LeaderA's team
  await mk("d2", 200, org.userA2.id); // MgrA's, not LeaderA's team
  await drainOutbox(t);
});
afterAll(async () => {
  await t.close();
});

describe("grant: validation", () => {
  it("only the Manager's own table, real columns, no personal or attachment column, options required", async () => {
    const base = { guest_user_id: org.guestData.id, data_type: "datahub_table", channels: ["web"] };
    expect((await fails(mgrA("guest.grant.create", base))).details.reason).toBe("grant_options");
    expect((await fails(mgrA("guest.grant.create", { ...base, options: { table_id: x.tableId, columns: [] } }))).details.reason).toBe("grant_options");
    expect((await fails(mgrA("guest.grant.create", { ...base, options: { table_id: x.tableId, columns: ["Không có"] } }))).details.reason).toBe("grant_column_unknown");
    expect((await fails(mgrB("guest.grant.create", { ...base, options: { table_id: x.tableId, columns: ["Tên"] } }))).code).toMatch(/validation_error|forbidden/);
    const own = await makeTable(mgrA, { columns: [{ name: "Tên", type: "text" }, { name: "File", type: "attachment" }] });
    expect((await fails(mgrA("guest.grant.create", { ...base, options: { table_id: own.tableId, columns: ["File"] } }))).details.reason).toBe("grant_column_attachment");
    expect((await fails(mgrA("guest.grant.create", { guest_user_id: org.guestData.id, data_type: "dashboard", channels: ["web"], options: { a: 1 } }))).details.reason).toBe("grant_options");
    // Without a grant the Guest cannot even call the Datahub commands.
    expect((await fails(guest("datahub.table.get", { table_id: x.tableId }))).code).toBe("forbidden");
  });
});

describe("whole-tree grant, columns Tên and Doanh thu", () => {
  it("the Guest reads exactly those columns, every row", async () => {
    const g = await mgrA("guest.grant.create", { guest_user_id: org.guestData.id, data_type: "datahub_table", channels: ["web", "export", "api"], options: { table_id: x.tableId, columns: ["Tên", "Doanh thu"] } });
    grantAll = g.id;
    expect(g.options).toEqual({ table_id: x.tableId, columns: [k("Tên"), k("Doanh thu")] });
    const tb = await guest("datahub.table.get", { table_id: x.tableId });
    expect(tb.columns.map((c: { name: string }) => c.name)).toEqual(["Tên", "Doanh thu"]);
    const rows = await guest("datahub.row.list", { table_id: x.tableId, limit: 50 });
    expect(rows.items).toHaveLength(2);
    for (const r of rows.items as { data: Record<string, unknown> }[]) expect(Object.keys(r.data).sort()).toEqual([k("Doanh thu"), k("Tên")].sort());
    expect((rows.items as { data: Record<string, unknown> }[]).map((r) => r.data[k("Doanh thu")]).sort()).toEqual([100, 200]);
    const one = await guest("datahub.row.get", { table_id: x.tableId, row_id: rows.items[0].id });
    expect(JSON.stringify(one)).not.toContain("bí mật");
  });

  it("hidden columns cannot be filtered, sorted, grouped, searched or selected; nothing can be written; nothing else can be read", async () => {
    const hidden = "Ghi chú nội bộ";
    expect((await fails(guest("datahub.row.list", { table_id: x.tableId, filter: JSON.stringify({ field: hidden, op: "contains", value: "bí mật" }) }))).code).toMatch(/invalid_filter|validation_error/);
    expect((await fails(guest("datahub.row.list", { table_id: x.tableId, sort: JSON.stringify([{ field: hidden }]) }))).code).toMatch(/invalid_filter|validation_error/);
    expect((await fails(guest("datahub.row.list", { table_id: x.tableId, fields: hidden }))).code).toMatch(/invalid_filter|validation_error/);
    expect((await fails(guest("datahub.row.groups", { table_id: x.tableId, group: JSON.stringify([{ field: hidden }]) }))).code).toMatch(/invalid_filter|validation_error/);
    expect((await fails(guest("datahub.row.list", { table_id: x.tableId, search: "bí mật" }))).details.reason).toBe("guest_search");
    const ok = await guest("datahub.row.groups", { table_id: x.tableId, group: JSON.stringify([{ field: "Tên" }]), aggs: JSON.stringify({ "Doanh thu": "sum" }) });
    expect(ok.groups).toHaveLength(2);
    // read only
    expect((await fails(guest("datahub.row.create", { table_id: x.tableId, data: { Tên: "x" } }))).code).toMatch(/forbidden|not_found/);
    // not shared structure: history, views, columns of other tables, the datahub
    expect((await fails(guest("datahub.row.history", { table_id: x.tableId, row_id: (await guest("datahub.row.list", { table_id: x.tableId, limit: 1 })).items[0].id }))).code).toMatch(/not_found|forbidden/);
    const other = await makeTable(mgrA, { columns: [{ name: "Tên", type: "text" }] });
    expect((await fails(guest("datahub.table.get", { table_id: other.tableId }))).code).toBe("not_found");
    expect((await fails(guest("datahub.datahub.get", { datahub_id: x.dhId }))).code).toBe("not_found");
  });

  it("export: only the granted columns, and only when the grant allows the export channel", async () => {
    const job = await guest("datahub.export.create", { table_id: x.tableId, format: "csv" });
    const text = await csvOf(guest, job.id);
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Tên,Doanh thu");
    expect(lines.slice(1).sort()).toEqual(["d1,100", "d2,200"]);
    expect(text).not.toContain("bí mật");
    expect((await fails(guest("datahub.export.create", { table_id: x.tableId, format: "csv", search: "d1" }))).details.reason).toBe("guest_search");
  });

  it("revoking the grant closes everything at once; a grant without the export channel cannot export", async () => {
    const webOnly = await mgrA("guest.grant.create", { guest_user_id: org.guestData.id, data_type: "datahub_table", channels: ["web", "api"], options: { table_id: x.tableId, columns: ["Tên"] } });
    await mgrA("guest.grant.revoke", { id: grantAll, version: (await mgrA("guest.grant.list", {})).find((g: { id: string }) => g.id === grantAll).version });
    // Only the grant without the export channel (column Tên) is left: the Guest sees Tên, cannot export.
    const tb = await guest("datahub.table.get", { table_id: x.tableId });
    expect(tb.columns.map((c: { name: string }) => c.name)).toEqual(["Tên"]);
    expect((await fails(guest("datahub.export.create", { table_id: x.tableId, format: "csv" }))).code).toBe("not_found");
    await mgrA("guest.grant.revoke", { id: webOnly.id, version: webOnly.version });
    expect((await fails(guest("datahub.table.get", { table_id: x.tableId }))).code).toBe("forbidden");
  });
});

describe("team scope", () => {
  it("a grant for LeaderA's team shows only the rows of that team; the rest stay hidden", async () => {
    const g = await mgrA("guest.grant.create", { guest_user_id: org.guestData.id, data_type: "datahub_table", scope_leader_id: org.leaderA.id, channels: ["web", "api"], options: { table_id: x.tableId, columns: ["Tên", "Doanh thu", "Phụ trách"] } });
    const rows = await guest("datahub.row.list", { table_id: x.tableId, limit: 50 });
    expect((rows.items as { data: Record<string, unknown> }[]).map((r) => r.data[k("Tên")])).toEqual(["d1"]);
    const groups = await guest("datahub.row.groups", { table_id: x.tableId, group: JSON.stringify([{ field: "Tên" }]) });
    expect(groups.groups.map((r: { path: unknown[] }) => r.path[0])).toEqual(["d1"]);
    await mgrA("guest.grant.revoke", { id: g.id, version: g.version });
  });

  it("another Manager's Guest, or a Guest of nobody, gets nothing even with the table id", async () => {
    const other = as(t, org.guestSale.id);
    expect((await fails(other("datahub.table.get", { table_id: x.tableId }))).code).toBe("forbidden");
  });
});
