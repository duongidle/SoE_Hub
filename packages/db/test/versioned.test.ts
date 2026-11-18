import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  newId,
  registerTrashTable,
  restoreRow,
  rowHistory,
  purgeTrash,
  softDelete,
  versionedUpdate,
  getTrashRetentionDays,
  systemSettings,
} from "../src/index";
import { actorRef, appDb, testItems } from "./helpers";

registerTrashTable({ name: "test_items" });

async function makeItem(name = "item") {
  const { db } = appDb();
  const id = newId();
  await db.insert(testItems).values({ id, name });
  return id;
}

describe("versionedUpdate (optimistic locking)", () => {
  it("bumps version and writes history", async () => {
    const { db } = appDb();
    const id = await makeItem("v1");
    const row = await versionedUpdate(db, testItems, { id, expectedVersion: 1, set: { name: "v2" }, actor: actorRef, historyTableId: "test_items" });
    expect(row.version).toBe(2);
    expect(row.name).toBe("v2");
    expect(row.updatedBy).toBe(actorRef.userId);
    const hist = await db.select().from(rowHistory).where(and(eq(rowHistory.tableId, "test_items"), eq(rowHistory.rowId, id)));
    expect(hist).toHaveLength(1);
    expect(hist[0]!.version).toBe(2);
    expect(hist[0]!.changes).toEqual([{ field: "name", old: "v1", new: "v2" }]);
  });

  it("a stale version fails with conflict (409) and changes nothing", async () => {
    const { db } = appDb();
    const id = await makeItem("c1");
    await versionedUpdate(db, testItems, { id, expectedVersion: 1, set: { name: "c2" }, actor: actorRef });
    await expect(versionedUpdate(db, testItems, { id, expectedVersion: 1, set: { name: "c3" }, actor: actorRef })).rejects.toMatchObject({
      code: "conflict",
      details: { current_version: 2, sent_version: 1 },
    });
    const [row] = await db.select().from(testItems).where(eq(testItems.id, id));
    expect(row!.name).toBe("c2");
  });

  it("unknown id gives not_found", async () => {
    const { db } = appDb();
    await expect(versionedUpdate(db, testItems, { id: newId(), expectedVersion: 1, set: { name: "x" }, actor: actorRef })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("soft delete, restore and purge", () => {
  beforeEach(async () => {
    const { db } = appDb();
    await db.delete(systemSettings).where(eq(systemSettings.key, "trash.retention_days"));
  });

  it("soft delete hides the row from normal updates; restore brings it back", async () => {
    const { db } = appDb();
    const id = await makeItem("sd");
    const del = await softDelete(db, testItems, { id, expectedVersion: 1, actor: actorRef, historyTableId: "test_items" });
    expect(del.deletedAt).toBeInstanceOf(Date);
    expect(del.deletedBy).toBe(actorRef.userId);
    await expect(versionedUpdate(db, testItems, { id, expectedVersion: 2, set: { name: "n" }, actor: actorRef })).rejects.toMatchObject({ code: "not_found" });
    const back = await restoreRow(db, testItems, { id, expectedVersion: 2, actor: actorRef, historyTableId: "test_items" });
    expect(back.deletedAt).toBeNull();
    expect(back.version).toBe(3);
    const ops = (await db.select().from(rowHistory).where(eq(rowHistory.rowId, id))).map((h) => h.op).sort();
    expect(ops).toEqual(["delete", "restore"]);
  });

  it("purge removes only rows older than the retention period", async () => {
    const { db } = appDb();
    const oldId = await makeItem("old");
    const freshId = await makeItem("fresh");
    const liveId = await makeItem("live");
    const day = 24 * 3600 * 1000;
    await db.update(testItems).set({ deletedAt: new Date(Date.now() - 8 * day) }).where(eq(testItems.id, oldId));
    await db.update(testItems).set({ deletedAt: new Date(Date.now() - 2 * day) }).where(eq(testItems.id, freshId));

    const days = await getTrashRetentionDays(db, 7);
    expect(days).toBe(7);
    const res = await purgeTrash(db, days);
    expect(res.find((r) => r.table === "test_items")!.purged).toBeGreaterThanOrEqual(1);

    const left = (await db.select({ id: testItems.id }).from(testItems)).map((r) => r.id);
    expect(left).not.toContain(oldId);
    expect(left).toContain(freshId);
    expect(left).toContain(liveId);
  });

  it("retention is configurable through system_settings", async () => {
    const { db } = appDb();
    await db.insert(systemSettings).values({ key: "trash.retention_days", value: 1 });
    expect(await getTrashRetentionDays(db, 7)).toBe(1);
    const id = await makeItem("two-days");
    await db.update(testItems).set({ deletedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000) }).where(eq(testItems.id, id));
    await purgeTrash(db, await getTrashRetentionDays(db, 7));
    expect(await db.select().from(testItems).where(eq(testItems.id, id))).toHaveLength(0);
  });

  it("tables marked neverHardDelete are never purged", async () => {
    const { db } = appDb();
    registerTrashTable({ name: "test_items", neverHardDelete: true });
    try {
      const id = await makeItem("deal-like");
      await db.update(testItems).set({ deletedAt: new Date(Date.now() - 400 * 24 * 3600 * 1000) }).where(eq(testItems.id, id));
      await purgeTrash(db, 7);
      expect(await db.select().from(testItems).where(eq(testItems.id, id))).toHaveLength(1);
    } finally {
      registerTrashTable({ name: "test_items" });
    }
  });
});

