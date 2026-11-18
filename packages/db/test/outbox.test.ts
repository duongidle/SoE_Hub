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
