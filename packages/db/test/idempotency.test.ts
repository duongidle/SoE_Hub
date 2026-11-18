import { describe, expect, it } from "vitest";
import { beginIdempotent, finishIdempotent, hashRequest, newId } from "../src/index";
import { appDb } from "./helpers";

describe("idempotency keys (db level)", () => {
  it("replays the stored result for the same key and request", async () => {
    const { db } = appDb();
    const key = newId();
    const scope = newId();
    const hash = hashRequest({ a: 1 });
    const first = await db.transaction(async (tx) => {
      const s = await beginIdempotent(tx, { scope, key, command: "x.create", requestHash: hash });
      if (s.state !== "new") throw new Error("expected new");
      await finishIdempotent(tx, s.id, 201, { data: { id: "A" } });
      return s;
    });
    expect(first.state).toBe("new");
    const again = await db.transaction((tx) => beginIdempotent(tx, { scope, key, command: "x.create", requestHash: hash }));
    expect(again).toEqual({ state: "replay", status: 201, body: { data: { id: "A" } } });
  });

  it("rejects the same key with a different request", async () => {
    const { db } = appDb();
    const key = newId();
    const scope = newId();
    await db.transaction(async (tx) => {
      const s = await beginIdempotent(tx, { scope, key, command: "x.create", requestHash: hashRequest({ a: 1 }) });
      if (s.state === "new") await finishIdempotent(tx, s.id, 201, {});
    });
    await expect(db.transaction((tx) => beginIdempotent(tx, { scope, key, command: "x.create", requestHash: hashRequest({ a: 2 }) }))).rejects.toMatchObject({ code: "idempotency_key_reuse" });
  });

  it("a rolled-back first attempt does not leave the key claimed", async () => {
    const { db } = appDb();
    const key = newId();
    const scope = newId();
    await expect(
      db.transaction(async (tx) => {
        await beginIdempotent(tx, { scope, key, command: "x.create", requestHash: "h" });
        throw new Error("handler failed");
      }),
    ).rejects.toThrow("handler failed");
    const retry = await db.transaction((tx) => beginIdempotent(tx, { scope, key, command: "x.create", requestHash: "h" }));
    expect(retry.state).toBe("new");
  });

  it("two concurrent requests with the same key run the handler once", async () => {
    const { db } = appDb();
    const key = newId();
    const scope = newId();
    let handlerRuns = 0;
    const run = () =>
      db.transaction(async (tx) => {
        const s = await beginIdempotent(tx, { scope, key, command: "x.create", requestHash: "h" });
        if (s.state === "replay") return s;
        handlerRuns++;
        await new Promise((r) => setTimeout(r, 150));
        await finishIdempotent(tx, s.id, 201, { ok: true });
        return s;
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(handlerRuns).toBe(1);
    expect([a.state, b.state].sort()).toEqual(["new", "replay"]);
  });
});
