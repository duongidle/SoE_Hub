import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { files, newId, orgMemberships } from "@soe/db";
import { actorOf, as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { loadTableAccess, rowAudience, scopeKey } from "../src/modules/datahub/access";
import { datahubEvents } from "../src/modules/datahub/events";
import { splitLockTransferHandler } from "../src/modules/datahub/transfer";
import { processJobs } from "../src/modules/datahub";
import { invalidateMetricCache } from "../src/modules/metrics";

/**
 * Stage 4.1a: the split lock (design module2 section 10, module4 19a). Owner = userA2 (under MgrA directly). Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2.
 * Tree B: MgrB > LeaderB > UserB1. Members (all with Edit unless said): MgrA, LeaderA, UserA1, UserB1, and LeaderB with View.
 * Rows: r1 UserA1, r2 UserA2 (owner), r3 LeaderA, r4 UserB1, r5 MgrA, r6 UserA1 + support UserA2, r7 LeaderB.
 */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let mgrA: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userB1: ReturnType<typeof as>;
let leaderB: ReturnType<typeof as>;
let x: Awaited<ReturnType<typeof makeTable>>;
const rid: Record<string, string> = {};
const env = () => ({ db: t.c.db.db, executor: t.c.executor, storage: t.c.storage, logger: t.c.logger, config: t.c.config });

/** Current version of a row, read by the owner (who sees every row). */
const ver = async (id: string) => (await owner("datahub.row.get", { table_id: x.tableId, row_id: id })).version as number;

const names = async (call: ReturnType<typeof as>, tableId = x.tableId) => {
  const r = await call("datahub.row.list", { table_id: tableId, limit: 200, labels: "true" });
  return (r.items as { data: Record<string, unknown> }[]).map((i) => i.data[x.cols["Tên"]!.key] as string).sort();
};

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.leaderB, org.mgrA, org.mgrB]) await unlimit(t, p.id);
  owner = as(t, org.userA2.id);
  mgrA = as(t, org.mgrA.id);
  leaderA = as(t, org.leaderA.id);
  userA1 = as(t, org.userA1.id);
  userB1 = as(t, org.userB1.id);
  leaderB = as(t, org.leaderB.id);
  x = await makeTable(owner, {
    name: "Deals khoá",
    columns: [
      { name: "Tên", type: "text" },
      { name: "Phụ trách", type: "user" },
      { name: "Hỗ trợ", type: "user" },
      { name: "Ghi chú", type: "text" },
      { name: "Doanh thu", type: "number" },
    ],
  });
  for (const [p, perm] of [[org.mgrA, "edit_data"], [org.leaderA, "edit_data"], [org.userA1, "edit_data"], [org.userB1, "edit_data"], [org.leaderB, "view"]] as const) {
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: p.id, permission: perm });
  }
  const mk = async (name: string, who: string, support?: string) => {
    const r = await owner("datahub.row.create", { table_id: x.tableId, data: { Tên: name, "Phụ trách": who, ...(support ? { "Hỗ trợ": support } : {}) } });
    rid[name] = r.id;
  };
  await mk("r1", org.userA1.id);
  await mk("r2", org.userA2.id);
  await mk("r3", org.leaderA.id);
  await mk("r4", org.userB1.id);
  await mk("r5", org.mgrA.id);
  await mk("r6", org.userA1.id, org.userA2.id);
  await mk("r7", org.leaderB.id);
});
afterAll(async () => {
  await t.close();
});

describe("lock off: everyone sees everything (the Stage 2 behaviour)", () => {
  it("every member lists all 7 rows", async () => {
    for (const c of [owner, mgrA, leaderA, userA1, userB1, leaderB]) expect(await names(c)).toHaveLength(7);
  });
});

describe("structure rules of the lock", () => {
  it("key columns must be 1-5 user columns; only the owner sets them; the lock needs a key", async () => {
    expect((await fails(owner("datahub.table.share_options.set", { table_id: x.tableId, key_split: true }))).details.reason).toBe("key_column_rule");
    expect((await fails(owner("datahub.table.share_options.set", { table_id: x.tableId, key_columns: ["Tên"] }))).message).toContain("Người dùng");
    expect((await fails(owner("datahub.table.share_options.set", { table_id: x.tableId, key_columns: ["a", "b", "c", "d", "e", "f"] }))).code).toBe("validation_error");
    expect((await fails(userA1("datahub.table.share_options.set", { table_id: x.tableId, key_split: true, key_columns: ["Phụ trách"] }))).code).toBe("forbidden");
    expect((await fails(owner("datahub.table.share_options.set", { table_id: x.tableId, key_columns: ["Phụ trách"], key_primary: "Hỗ trợ" }))).message).toContain("khoá chính");
  });

  it("turn it on: two key columns, main key Phụ trách; the table reports the config; indexes exist", async () => {
    const tb = await owner("datahub.table.share_options.set", { table_id: x.tableId, key_split: true, key_columns: ["Phụ trách", "Hỗ trợ"], key_primary: "Phụ trách" });
    expect(tb.key_split.enabled).toBe(true);
    expect(tb.key_split.key_columns.map((c: { name: string }) => c.name)).toEqual(["Phụ trách", "Hỗ trợ"]);
    expect(tb.key_split.primary).toBe(x.cols["Phụ trách"]!.key);
    expect(tb.members_bulk_create).toBe(true);
    const ix = await t.c.db.db.execute(sql`SELECT indexname FROM pg_indexes WHERE indexname LIKE ${`dh_ix_%${x.cols["Hỗ trợ"]!.key}_ids`}`);
    expect(ix.rows.length).toBe(1);
  });

  it("a key column cannot be deleted or change type while it is a key", async () => {
    expect((await fails(owner("datahub.column.delete", { table_id: x.tableId, column: "Phụ trách" }))).details.reason).toBe("key_column_rule");
    expect((await fails(owner("datahub.column.type_change", { table_id: x.tableId, column: "Hỗ trợ", type: "text" }))).details.reason).toBe("key_column_rule");
    expect((await fails(owner("datahub.column.type_preview", { table_id: x.tableId, column: "Hỗ trợ", type: "text" }))).details.reason).toBe("key_column_rule");
  });
});

describe("reading: every channel shows a member only the rows they may see", () => {
  it("list: owner all; UserA1 own; LeaderA own + team; MgrA the whole tree; other tree and a View member see theirs", async () => {
    expect(await names(owner)).toHaveLength(7);
    expect(await names(userA1)).toEqual(["r1", "r6"]);
    expect(await names(leaderA)).toEqual(["r1", "r3", "r6"]);
    expect(await names(mgrA)).toEqual(["r1", "r2", "r3", "r5", "r6"]);
    expect(await names(userB1)).toEqual(["r4"]);
    expect(await names(leaderB)).toEqual(["r4", "r7"]);
  });

  it("a filter, a search or a sort cannot reach past the lock (and the second key column counts)", async () => {
    const r = await userA1("datahub.row.list", { table_id: x.tableId, search: "r", limit: 50, sort: "Tên:desc" });
    expect(r.items.map((i: { data: Record<string, unknown> }) => i.data[x.cols["Tên"]!.key])).toEqual(["r6", "r1"]);
    const asSupport = await as(t, org.userA2.id)("datahub.row.list", { table_id: x.tableId, filter: JSON.stringify({ field: "Hỗ trợ", op: "is_not_empty" }), limit: 10 });
    expect(asSupport.items).toHaveLength(1);
    const total = await userA1("datahub.row.list", { table_id: x.tableId, include_total: "true", limit: 1 });
    expect(total.total ?? total.extra?.total).toBe(2);
  });

  it("one row: a hidden row is not_found, whatever its id; history of it too", async () => {
    expect((await userA1("datahub.row.get", { table_id: x.tableId, row_id: rid.r1! })).id).toBe(rid.r1);
    expect((await fails(userA1("datahub.row.get", { table_id: x.tableId, row_id: rid.r2! }))).code).toBe("not_found");
    expect((await fails(userA1("datahub.row.history", { table_id: x.tableId, row_id: rid.r4! }))).code).toBe("not_found");
    expect((await mgrA("datahub.row.history", { table_id: x.tableId, row_id: rid.r1! })).items.length).toBeGreaterThan(0);
  });

  it("groups and totals count only the reader's rows", async () => {
    const g = await userA1("datahub.row.groups", { table_id: x.tableId, group: JSON.stringify([{ field: "Phụ trách" }]), aggs: JSON.stringify({ "Doanh thu": "count" }) });
    expect(g.groups.reduce((n: number, r: { count: number }) => n + r.count, 0)).toBe(2);
    const gm = await mgrA("datahub.row.groups", { table_id: x.tableId, group: JSON.stringify([{ field: "Phụ trách" }]) });
    expect(gm.groups.reduce((n: number, r: { count: number }) => n + r.count, 0)).toBe(5);
  });

  it("table row count and the table list tell a member only what they see", async () => {
    expect((await userA1("datahub.table.get", { table_id: x.tableId })).row_count).toBe(2);
    expect((await owner("datahub.table.get", { table_id: x.tableId })).row_count).toBe(7);
    const dh = (await userA1("datahub.datahub.get", { datahub_id: x.dhId })).tables.find((tb: { id: string }) => tb.id === x.tableId);
    expect(dh.row_count).toBe(2);
  });

  it("duplicates only compare the rows the reader sees", async () => {
    await owner("datahub.row.create", { table_id: x.tableId, data: { Tên: "dup", "Phụ trách": org.userB1.id } });
    await owner("datahub.row.create", { table_id: x.tableId, data: { Tên: "dup", "Phụ trách": org.userA2.id } });
    const own = await owner("datahub.row.duplicates", { table_id: x.tableId, columns: "Tên" });
    expect(own.total_groups).toBeGreaterThanOrEqual(1);
    const mine = await userA1("datahub.row.duplicates", { table_id: x.tableId, columns: "Tên" });
    expect(mine.total_groups).toBe(0);
    for (const r of (await owner("datahub.row.list", { table_id: x.tableId, search: "dup", limit: 10 })).items) await owner("datahub.row.delete", { table_id: x.tableId, row_id: r.id, version: r.version });
  });

  it("trash: a reader sees and restores only the deleted rows that were theirs to see", async () => {
    await owner("datahub.row.delete", { table_id: x.tableId, row_id: rid.r6! });
    const own = await userA1("datahub.trash.list", { table_id: x.tableId });
    expect(own.rows.map((r: { id: string }) => r.id)).toEqual([rid.r6]);
    expect((await userB1("datahub.trash.list", { table_id: x.tableId })).rows.map((r: { id: string }) => r.id)).not.toContain(rid.r6);
    expect((await fails(userB1("datahub.row.restore", { table_id: x.tableId, row_id: rid.r6! }))).code).toBe("not_found");
    expect((await fails(userB1("datahub.row.restore_batch", { table_id: x.tableId, row_ids: [rid.r6!] }))).code).toBe("not_found");
    await userA1("datahub.row.restore", { table_id: x.tableId, row_id: rid.r6! });
    expect(await names(userA1)).toEqual(["r1", "r6"]);
  });

  it("export (a worker job run as the person) holds only the requester's rows", async () => {
    const job = await userA1("datahub.export.create", { table_id: x.tableId, format: "json" });
    await processJobs(env());
    const done = await userA1("datahub.job.get", { job_id: job.id });
    expect(done.status).toBe("done");
    expect(Object.values(done.report.rows)).toEqual([2]);
  });

  it("people picker with the table: only the owner and members are suggested; a former member shows as not a member", async () => {
    const some = await userA1("datahub.people.lookup", { q: "User", table_id: x.tableId, limit: 50 });
    const ids = some.map((p: { id: string }) => p.id);
    expect(ids).toContain(org.userA1.id);
    expect(ids).toContain(org.userB1.id);
    expect(ids).not.toContain(org.guestData.id);
    const all = await userA1("datahub.people.lookup", { q: `GuestData ${org.tag}` });
    expect(all.length).toBe(1);
    const none = await userA1("datahub.people.lookup", { q: `GuestData ${org.tag}`, table_id: x.tableId });
    expect(none).toHaveLength(0);
    const byId = await userA1("datahub.people.lookup", { ids: org.guestData.id, table_id: x.tableId });
    expect(byId[0].member).toBe(false);
  });
});

describe("metrics read through the same rows() and never share a cached answer between different scopes", () => {
  it("each reader's number is the sum of the rows they see; owner first, then members, then after a change", async () => {
    const m = await owner("metrics.metric.create", { datahub_id: x.dhId, metric: { name: "Tổng DT", source: x.tableId, measure: { agg: "sum", field: "Doanh thu" } } });
    const sumOf = async (c: ReturnType<typeof as>) => {
      const r = await c("datahub.row.list", { table_id: x.tableId, limit: 200 });
      return (r.items as { data: Record<string, number | undefined> }[]).reduce((n, i) => n + (i.data[x.cols["Doanh thu"]!.key] ?? 0), 0);
    };
    const val = async (c: ReturnType<typeof as>) => (await c("metrics.query", { metric_id: m.id })).rows[0].value as number;
    // distinct revenue per row so that every scope has its own total
    const all = (await owner("datahub.row.list", { table_id: x.tableId, limit: 200 })).items as { id: string; version: number }[];
    for (const [i, r] of all.entries()) await owner("datahub.row.update", { table_id: x.tableId, row_id: r.id, data: { "Doanh thu": 10 ** (i % 6) * (i + 1) }, version: r.version });
    await drainOutbox(t);
    const ownerTotal = await val(owner); // fills the cache for the owner first
    expect(ownerTotal).toBe(await sumOf(owner));
    for (const c of [userA1, leaderA, mgrA, userB1]) expect(await val(c)).toBe(await sumOf(c));
    expect(new Set([ownerTotal, await val(userA1), await val(leaderA), await val(mgrA)]).size).toBe(4);
    // a change a reader may not see leaves their cached number alone; one they may see moves it, after the outbox ran
    const before = await val(userA1);
    const r1 = (await owner("datahub.row.get", { table_id: x.tableId, row_id: rid.r1! })).version;
    await owner("datahub.row.update", { table_id: x.tableId, row_id: rid.r1!, data: { "Doanh thu": 7777 }, version: r1 });
    await drainOutbox(t);
    invalidateMetricCache({ tables: [x.tableId] }); // what the api process does when the worker tells it (SSE hub is not running in tests)
    expect(await val(userA1)).not.toBe(before);
    expect(await val(userA1)).toBe(await sumOf(userA1));
    expect(await val(leaderA)).toBe(await sumOf(leaderA));
  });
});

describe("files in attachment cells follow the row", () => {
  it("a member lists and downloads only files of rows they see", async () => {
    const mkFile = async (name: string) => {
      const id = newId();
      await t.c.db.db.insert(files).values({ id, ownerId: org.userA2.id, createdBy: org.userA2.id, updatedBy: org.userA2.id, storageKey: `files/${id}`, filename: name, contentType: "application/pdf", sizeBytes: 12, status: "ready" });
      return id;
    };
    const col = await owner("datahub.column.create", { table_id: x.tableId, name: "Hồ sơ", type: "attachment" });
    const mine = await mkFile("của A1.pdf");
    const theirs = await mkFile("của B1.pdf");
    await owner("datahub.row.update", { table_id: x.tableId, row_id: rid.r1!, data: { [col.key]: [mine] }, version: await ver(rid.r1!) });
    await owner("datahub.row.update", { table_id: x.tableId, row_id: rid.r4!, data: { [col.key]: [theirs] }, version: await ver(rid.r4!) });
    const list = await userA1("datahub.attachment.list", { table_id: x.tableId, ids: `${mine},${theirs}` });
    expect(list.map((f: { id: string }) => f.id)).toEqual([mine]);
    expect((await userA1("datahub.attachment.download_url", { table_id: x.tableId, file_id: mine })).url).toContain("sig=");
    expect((await fails(userA1("datahub.attachment.download_url", { table_id: x.tableId, file_id: theirs }))).code).toBe("not_found");
  });
});

describe("scope key (metrics cache) and SSE audience", () => {
  it("two readers who see different rows never share a cache key; the owner keeps the plain key; a tree change moves the key", async () => {
    const key = async (id: string) => scopeKey(await loadTableAccess({ db: t.c.db.db, actor: actorOf(id) }, x.tableId));
    const [k1, kl, km, ko, kb] = [await key(org.userA1.id), await key(org.leaderA.id), await key(org.mgrA.id), await key(org.userA2.id), await key(org.userB1.id)];
    expect(new Set([k1, kl, km, kb]).size).toBe(4);
    expect(ko).toBe(`${x.tableId}:owner`);
    // UserA1 leaves LeaderA's team: LeaderA sees a different set, so the key changes by itself.
    await t.c.db.db.update(orgMemberships).set({ leaderId: null }).where(eq(orgMemberships.userId, org.userA1.id));
    expect(await key(org.leaderA.id)).not.toBe(kl);
    await t.c.db.db.update(orgMemberships).set({ leaderId: org.leaderA.id }).where(eq(orgMemberships.userId, org.userA1.id));
    expect(await key(org.leaderA.id)).toBe(kl);
  });

  it("SSE: a row event goes to the owner and the members who see the row, not to the others", async () => {
    const db = t.c.db.db;
    const a1 = await rowAudience(db, x.tableId, [rid.r1!]);
    expect(new Set(a1)).toEqual(new Set([org.userA2.id, org.userA1.id, org.leaderA.id, org.mgrA.id]));
    const a4 = await rowAudience(db, x.tableId, [rid.r4!]);
    expect(new Set(a4)).toEqual(new Set([org.userA2.id, org.userB1.id, org.leaderB.id]));
    const both = await rowAudience(db, x.tableId, [rid.r1!, rid.r4!]);
    expect(both).toContain(org.userB1.id);
    // key moved: the old holder still hears of it through key_users
    const moved = await rowAudience(db, x.tableId, [rid.r4!], [org.userA1.id]);
    expect(moved).toContain(org.userA1.id);
    const ev = datahubEvents.find((e) => e.name === "datahub.row.updated")!;
    const aud = await ev.audience!({ table_id: x.tableId, row_ids: [rid.r3!], columns: [] }, db);
    expect(new Set(aud!.users)).toEqual(new Set([org.userA2.id, org.leaderA.id, org.mgrA.id]));
  });

  it("SSE: a write that moves a row to another person tells the old holder too (key_users in the event)", async () => {
    await mgrA("datahub.row.update", { table_id: x.tableId, row_id: rid.r5!, data: { "Phụ trách": org.userA1.id }, version: await ver(rid.r5!) });
    const ev = (await t.c.db.db.execute(sql`SELECT payload FROM outbox WHERE event = 'datahub.row.updated' AND aggregate_id = ${x.tableId} ORDER BY created_at DESC LIMIT 1`)).rows[0] as { payload: { key_users: string[] } };
    expect(ev.payload.key_users).toEqual(expect.arrayContaining([org.mgrA.id, org.userA1.id]));
    await mgrA("datahub.row.update", { table_id: x.tableId, row_id: rid.r5!, data: { "Phụ trách": org.mgrA.id }, version: await ver(rid.r5!) });
  });
});

describe("writing", () => {
  it("a member edits their own row; a hidden row is not_found; a View member cannot write", async () => {
    await userA1("datahub.row.update", { table_id: x.tableId, row_id: rid.r1!, data: { "Doanh thu": 10 }, version: await ver(rid.r1!) });
    expect((await fails(userA1("datahub.row.update", { table_id: x.tableId, row_id: rid.r2!, data: { "Doanh thu": 1 }, version: await ver(rid.r2!) }))).code).toBe("not_found");
    expect((await fails(userA1("datahub.row.delete", { table_id: x.tableId, row_id: rid.r4! }))).code).toBe("not_found");
    expect((await fails(leaderB("datahub.row.update", { table_id: x.tableId, row_id: rid.r4!, data: { "Doanh thu": 1 }, version: await ver(rid.r4!) }))).code).toBe("forbidden");
  });

  it("a Manager edits any row in their tree; a Leader edits a team member's row only when that person allows it", async () => {
    const v = (await userA1("datahub.row.get", { table_id: x.tableId, row_id: rid.r1! })).version;
    await mgrA("datahub.row.update", { table_id: x.tableId, row_id: rid.r1!, data: { "Doanh thu": 11 }, version: v });
    const refused = await fails(leaderA("datahub.row.update", { table_id: x.tableId, row_id: rid.r1!, data: { "Doanh thu": 12 }, version: v + 1 }));
    expect(refused.code).toBe("forbidden");
    expect(refused.details.reason).toBe("row_not_editable");
    expect((await fails(leaderA("datahub.row.delete", { table_id: x.tableId, row_id: rid.r1! }))).details.reason).toBe("row_not_editable");
    expect(await userA1("datahub.prefs.get")).toEqual({ leader_can_edit: false });
    await userA1("datahub.prefs.set", { leader_can_edit: true });
    await leaderA("datahub.row.update", { table_id: x.tableId, row_id: rid.r1!, data: { "Doanh thu": 12 }, version: v + 1 });
    // the Leader's own row is theirs; a row of another team is not visible at all
    await leaderA("datahub.row.update", { table_id: x.tableId, row_id: rid.r3!, data: { "Doanh thu": 5 }, version: await ver(rid.r3!) });
    expect((await fails(leaderA("datahub.row.update", { table_id: x.tableId, row_id: rid.r4!, data: { "Doanh thu": 1 }, version: await ver(rid.r4!) }))).code).toBe("not_found");
    // a Manager cannot edit a row of another tree either
    expect((await fails(mgrA("datahub.row.update", { table_id: x.tableId, row_id: rid.r4!, data: { "Doanh thu": 1 }, version: await ver(rid.r4!) }))).code).toBe("not_found");
    await userA1("datahub.prefs.set", { leader_can_edit: false });
  });

  it("allow_edit per column: a member cannot write a column that is not allowed (update, create, upsert path); the owner can", async () => {
    await owner("datahub.column.update", { table_id: x.tableId, column: "Ghi chú", allow_edit: false });
    const cols = (await userA1("datahub.table.get", { table_id: x.tableId })).columns as { name: string; allow_edit: boolean }[];
    expect(cols.find((c) => c.name === "Ghi chú")!.allow_edit).toBe(false);
    const v = (await userA1("datahub.row.get", { table_id: x.tableId, row_id: rid.r1! })).version;
    const e = await fails(userA1("datahub.row.update", { table_id: x.tableId, row_id: rid.r1!, data: { "Ghi chú": "x" }, version: v }));
    expect(e.details.reason).toBe("column_not_editable");
    expect((await fails(userA1("datahub.row.create", { table_id: x.tableId, data: { "Ghi chú": "x" } }))).details.reason).toBe("column_not_editable");
    // an unchanged value is not an edit; other columns still work
    await userA1("datahub.row.update", { table_id: x.tableId, row_id: rid.r1!, data: { "Doanh thu": 13 }, version: v });
    await owner("datahub.row.update", { table_id: x.tableId, row_id: rid.r1!, data: { "Ghi chú": "chủ sửa" }, version: v + 1 });
    await owner("datahub.column.update", { table_id: x.tableId, column: "Ghi chú", allow_edit: true });
  });

  it("a member's new row carries their name in the main key column; a row they could not see is refused", async () => {
    const r = await userA1("datahub.row.create", { table_id: x.tableId, data: { Tên: "mới của A1" } });
    expect(r.data[x.cols["Phụ trách"]!.key]).toBe(org.userA1.id);
    expect(await names(userA1)).toContain("mới của A1");
    expect((await fails(userA1("datahub.row.create", { table_id: x.tableId, data: { Tên: "cho B1", "Phụ trách": org.userB1.id } }))).details.reason).toBe("row_outside_scope");
    // a Manager adds a row for someone in the tree
    const m = await mgrA("datahub.row.create", { table_id: x.tableId, data: { Tên: "mgr cho A1", "Phụ trách": org.userA1.id } });
    expect(m.id).toBeTruthy();
  });

  it("a user cell takes only members of the table (create, update, batch, upsert); stored non-members stay", async () => {
    const e = await fails(owner("datahub.row.create", { table_id: x.tableId, data: { Tên: "ngoài", "Phụ trách": org.guestData.id } }));
    expect(e.message).toContain("thành viên");
    const v5 = (await mgrA("datahub.row.get", { table_id: x.tableId, row_id: rid.r5! })).version;
    expect((await fails(mgrA("datahub.row.update", { table_id: x.tableId, row_id: rid.r5!, data: { "Hỗ trợ": org.guestSale.id }, version: v5 }))).code).toBe("validation_error");
    expect((await fails(owner("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "create", data: { Tên: "b", "Hỗ trợ": org.userB1.id } }, { op: "create", data: { Tên: "c", "Hỗ trợ": org.guestData.id } }] }))).code).toBe("validation_error");
  });

  it("members_bulk_create off: a member may add rows one by one but not many at once (batch, import); the owner always can", async () => {
    await owner("datahub.table.share_options.set", { table_id: x.tableId, members_bulk_create: false });
    const two = [{ op: "create", data: { Tên: "x1" } }, { op: "create", data: { Tên: "x2" } }];
    expect((await fails(userA1("datahub.row.batch", { table_id: x.tableId, ops: two }))).details.reason).toBe("bulk_create_off");
    await userA1("datahub.row.create", { table_id: x.tableId, data: { Tên: "một dòng" } });
    // a batch of updates (no new rows) and a batch with one create are not bulk creation
    await userA1("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "create", data: { Tên: "x3" } }] });
    const an = await userA1("datahub.import.analyze", { text: "Tên\nA\nB\n", filename: "a.csv" });
    const mapping = { datahub: { id: x.dhId }, sheets: [{ sheet: "a", table: { mode: "existing", table_id: x.tableId }, columns: [{ index: 0, target: "Tên" }] }] };
    const pv = await userA1("datahub.import.preview", { job_id: an.job.id, mapping });
    expect(pv.ok).toBe(false);
    expect((await fails(userA1("datahub.import.start", { job_id: an.job.id, mapping }))).details.reason).toBe("bulk_create_off");
    await owner("datahub.row.batch", { table_id: x.tableId, ops: two });
    await owner("datahub.table.share_options.set", { table_id: x.tableId, members_bulk_create: true });
    await userA1("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "create", data: { Tên: "x4" } }, { op: "create", data: { Tên: "x5" } }] });
  });
});

describe("removing and replacing members", () => {
  it("the owner is told how many rows tag a member; removing keeps the tags and the member loses the table", async () => {
    const shares = await owner("datahub.share.list", { datahub_id: x.dhId });
    const s = shares.find((r: { grantee_id: string }) => r.grantee_id === org.userB1.id);
    const tagged = await owner("datahub.share.tagged", { datahub_id: x.dhId, share_id: s.id });
    expect(tagged.rows).toBe(1);
    expect(tagged.tables[0].table_id).toBe(x.tableId);
    const rm = await owner("datahub.share.remove", { datahub_id: x.dhId, share_id: s.id });
    expect(rm.tagged_rows).toBe(1);
    expect((await fails(userB1("datahub.table.get", { table_id: x.tableId }))).code).toBe("not_found");
    expect((await owner("datahub.row.get", { table_id: x.tableId, row_id: rid.r4! })).data[x.cols["Phụ trách"]!.key]).toBe(org.userB1.id);
    const pe = await owner("datahub.people.lookup", { ids: org.userB1.id, table_id: x.tableId });
    expect(pe[0].member).toBe(false);
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userB1.id, permission: "edit_data" });
  });

  it("transfer: the target gets the source's membership and tags in the lock's key columns, with history", async () => {
    const from = org.userA1.id;
    const to = org.guestData.id;
    const prev = await splitLockTransferHandler.preview(t.c.db.db, from, to);
    expect(prev.some((i) => i.id === x.tableId)).toBe(true);
    await t.c.db.db.transaction(async (tx) => {
      await splitLockTransferHandler.execute(tx as never, from, to, { personal_columns: "move" }, actorOf(org.admin.id));
    });
    const sh = await t.c.db.db.execute(sql`SELECT permission FROM dh_shares WHERE /*scope:system*/ datahub_id = ${x.dhId}::uuid AND grantee_id = ${to}::uuid`);
    expect(sh.rows[0]).toEqual({ permission: "edit_data" });
    const left = await owner("datahub.row.list", { table_id: x.tableId, filter: JSON.stringify({ field: "Phụ trách", op: "eq", value: from }), limit: 10 });
    expect(left.items).toHaveLength(0);
    const moved = await owner("datahub.row.list", { table_id: x.tableId, filter: JSON.stringify({ field: "Phụ trách", op: "eq", value: to }), limit: 50 });
    expect(moved.items.length).toBeGreaterThanOrEqual(2);
    const hist = await owner("datahub.row.history", { table_id: x.tableId, row_id: moved.items[0].id });
    expect(hist.items[0].changes[0]).toMatchObject({ old: from, new: to });
    await drainOutbox(t);
  });
});

describe("turn the lock off: the config stays, members see all again", () => {
  it("off then on", async () => {
    const off = await owner("datahub.table.share_options.set", { table_id: x.tableId, key_split: false });
    expect(off.key_split.key_columns).toHaveLength(2);
    expect((await names(leaderA)).length).toBeGreaterThan(5);
    const on = await owner("datahub.table.share_options.set", { table_id: x.tableId, key_split: true });
    expect(on.key_split.enabled).toBe(true);
    expect((await names(userA1)).length).toBeLessThan(6);
  });
});
