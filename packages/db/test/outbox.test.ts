import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { enqueueOutbox, newId, outbox } from "../src/index";
import { actorRef, appDb, testItems } from "./helpers";

describe("outbox is written in the same transaction as the data", () => {
  it("commit: data and event both exist", async () => {
    const { db } = appDb();
    const id = newId();
    await db.transaction(async (tx) => {
      await tx.insert(testItems).values({ id, name: "outbox-commit" });
      await enqueueOutbox(tx, { event: "test.item.created", aggregateType: "test_item", aggregateId: id, payload: { id }, actor: actorRef });
    });
    expect(await db.select().from(testItems).where(eq(testItems.id, id))).toHaveLength(1);
    const ev = await db.select().from(outbox).where(eq(outbox.aggregateId, id));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.status).toBe("pending");
    expect(ev[0]!.event).toBe("test.item.created");
  });

  it("rollback: neither data nor event exist", async () => {
    const { db } = appDb();
    const id = newId();
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(testItems).values({ id, name: "outbox-rollback" });
        await enqueueOutbox(tx, { event: "test.item.created", aggregateType: "test_item", aggregateId: id, payload: { id } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.select().from(testItems).where(eq(testItems.id, id))).toHaveLength(0);
    expect(await db.select().from(outbox).where(eq(outbox.aggregateId, id))).toHaveLength(0);
  });
});

describe("coalesce: an identical event still waiting is written once", () => {
  const entry = (id: string, payload: unknown, extra: { coalesce?: boolean } = {}) => ({ event: "test.item.changed", aggregateType: "test_item", aggregateId: id, payload, actor: actorRef, ...extra });

  it("the same event in one transaction is written once; another payload or without the flag is written", async () => {
    const { db } = appDb();
    const id = newId();
    await db.transaction(async (tx) => {
      const a = await enqueueOutbox(tx, entry(id, { change: "column_created" }, { coalesce: true }));
      const b = await enqueueOutbox(tx, entry(id, { change: "column_created" }, { coalesce: true }));
      expect(b).toBe(a);
      await enqueueOutbox(tx, entry(id, { change: "column_updated" }, { coalesce: true }));
      await enqueueOutbox(tx, entry(id, { change: "column_created" })); // no flag: always written
    });
    expect(await db.select().from(outbox).where(eq(outbox.aggregateId, id))).toHaveLength(3);
  });

  it("an event already claimed (locked) or processed gets its own event: the change after the claim is not lost", async () => {
    const { db } = appDb();
    const id = newId();
    const first = await enqueueOutbox(db, entry(id, { n: 1 }, { coalesce: true }));
    await db.update(outbox).set({ status: "processed" }).where(eq(outbox.id, first));
    expect(await enqueueOutbox(db, entry(id, { n: 1 }, { coalesce: true }))).not.toBe(first);
    const second = await enqueueOutbox(db, entry(id, { n: 2 }, { coalesce: true }));
    await db.transaction(async (claim) => {
      await claim.select().from(outbox).where(eq(outbox.id, second)).for("update"); // a dispatcher holds the claim
      expect(await enqueueOutbox(db, entry(id, { n: 2 }, { coalesce: true }))).not.toBe(second);
    });
  });
});
