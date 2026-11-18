import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { enqueueOutbox, newId, outbox, systemSettings } from "@soe/db";
import { backoffSeconds, dispatchOutboxOnce, type Subscriber } from "../src/core/outbox-dispatcher";
import { sseFanout } from "../src/core/subscribers";
import { jobs, HEARTBEAT_KEY } from "../src/jobs";
import { SseHub, type SseSignal } from "../src/http/sse";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

async function makeEvent(event = "test.thing.happened") {
  const id = newId();
  await enqueueOutbox(t.c.db.db, { event, aggregateType: "thing", aggregateId: id, payload: { id } });
  return id;
}
const load = async (aggId: string) => (await t.c.db.db.select().from(outbox).where(eq(outbox.aggregateId, aggId)))[0]!;
const only = (aggId: string, s: Subscriber): Subscriber => ({ ...s, match: () => true, handle: (ev, db) => (ev.aggregateId === aggId ? s.handle(ev, db) : Promise.resolve()) });

describe("outbox dispatcher", () => {
  it("delivers to every matching subscriber once and marks the event processed", async () => {
    const aggId = await makeEvent();
    const seen: string[] = [];
    const subs: Subscriber[] = [
      { name: "a", match: () => true, handle: async (ev) => void (ev.aggregateId === aggId && seen.push("a")) },
      { name: "b", match: (e) => e.startsWith("test."), handle: async (ev) => void (ev.aggregateId === aggId && seen.push("b")) },
      { name: "c", match: (e) => e.startsWith("other."), handle: async () => void seen.push("c") },
    ];
    await dispatchOutboxOnce(t.c.db.db, subs, t.c.logger, { batchSize: 500 });
    expect(seen.sort()).toEqual(["a", "b"]);
    const row = await load(aggId);
    expect(row.status).toBe("processed");
    expect(row.deliveredTo.sort()).toEqual(["a", "b"]);
    // Not delivered again.
    await dispatchOutboxOnce(t.c.db.db, subs, t.c.logger, { batchSize: 500 });
    expect(seen).toHaveLength(2);
  });

  it("a failing subscriber is retried with backoff while the successful one is not repeated; then goes dead", async () => {
    const aggId = await makeEvent();
    let good = 0;
    let bad = 0;
    const subs: Subscriber[] = [
      only(aggId, { name: "good", match: () => true, handle: async () => void good++ }),
      only(aggId, { name: "bad", match: () => true, handle: async () => { bad++; throw new Error("down"); } }),
    ];
    await dispatchOutboxOnce(t.c.db.db, subs, t.c.logger, { batchSize: 500, maxAttempts: 3 });
    let row = await load(aggId);
    expect(row).toMatchObject({ status: "pending", attempts: 1, deliveredTo: ["good"] });
    expect(row.lastError).toContain("bad: down");
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());

    // Make it due again and run twice more: reaches max attempts -> dead.
    for (let i = 0; i < 2; i++) {
      await t.c.db.db.update(outbox).set({ availableAt: new Date(Date.now() - 1000) }).where(eq(outbox.aggregateId, aggId));
      await dispatchOutboxOnce(t.c.db.db, subs, t.c.logger, { batchSize: 500, maxAttempts: 3 });
    }
    row = await load(aggId);
    expect(row.status).toBe("dead");
    expect(good).toBe(1);
    expect(bad).toBe(3);
  });

  it("an event is not visible to the dispatcher until its transaction commits", async () => {
    const aggId = newId();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tx = t.c.db.db.transaction(async (trx) => {
      await enqueueOutbox(trx, { event: "test.thing.happened", aggregateId: aggId, payload: {} });
      await gate;
    });
    await new Promise((r) => setTimeout(r, 100));
    const seen: string[] = [];
    await dispatchOutboxOnce(t.c.db.db, [only(aggId, { name: "x", match: () => true, handle: async (ev) => void seen.push(ev.id) })], t.c.logger, { batchSize: 500 });
    expect(seen).toHaveLength(0);
    release();
    await tx;
    await dispatchOutboxOnce(t.c.db.db, [only(aggId, { name: "x", match: () => true, handle: async (ev) => void seen.push(ev.id) })], t.c.logger, { batchSize: 500 });
    expect(seen).toHaveLength(1);
  });

  it("backoff grows and is capped", () => {
    expect(backoffSeconds(1)).toBe(2);
    expect(backoffSeconds(4)).toBe(16);
    expect(backoffSeconds(30)).toBe(900);
  });
});

describe("SSE fanout (worker -> NOTIFY -> api)", () => {
  it("delivers a signal without row data to listeners", async () => {
    const hub = new SseHub(t.c.config.DATABASE_URL, t.c.logger);
    await hub.start();
    try {
      const got: SseSignal[] = [];
      hub.subscribe((s) => got.push(s));
      const aggId = await makeEvent("test.sse.signaled");
      await dispatchOutboxOnce(t.c.db.db, [only(aggId, sseFanout)], t.c.logger, { batchSize: 500 });
      await new Promise((r) => setTimeout(r, 300));
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ event: "test.sse.signaled", aggregate_id: aggId, aggregate_type: "thing" });
      expect(Object.keys(got[0]!).sort()).toEqual(["aggregate_id", "aggregate_type", "at", "event", "id"]);
    } finally {
      await hub.stop();
    }
  });

  it("HTTP stream: ready event, then the signal, filtered by topic", async () => {
    const hub = new SseHub(t.c.config.DATABASE_URL, t.c.logger);
    await hub.start();
    const app = (await import("../src/http/app")).buildApp;
    const server = await app({ ...t.c, sse: hub });
    await server.listen({ port: 0, host: "127.0.0.1" });
    const port = (server.server.address() as { port: number }).port;
    const ctl = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/events?topics=test.sse`, { signal: ctl.signal, headers: { "x-dev-actor": "01900000-0000-7000-8000-0000000000aa" } });
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const reader = res.body!.getReader();
      let text = "";
      const readUntil = async (needle: string) => {
        const end = Date.now() + 5000;
        while (!text.includes(needle) && Date.now() < end) {
          const { value } = await reader.read();
          text += new TextDecoder().decode(value);
        }
      };
      await readUntil("event: ready");
      const a1 = await makeEvent("test.other.happened");
      const a2 = await makeEvent("test.sse.signaled");
      await dispatchOutboxOnce(t.c.db.db, [only(a1, sseFanout), only(a2, sseFanout)], t.c.logger, { batchSize: 500 });
      await readUntil(a2);
      expect(text).toContain(a2);
      expect(text).not.toContain(a1);
    } finally {
      ctl.abort();
      await server.close();
      await hub.stop();
    }
  });
});

describe("scheduled jobs", () => {
  it("the sample heartbeat job writes the worker marker that /health reads", async () => {
    const job = jobs.find((j) => j.name === "system-heartbeat")!;
    await job.run({ db: t.c.db.db, config: t.c.config, logger: t.c.logger });
    const [row] = await t.c.db.db.select().from(systemSettings).where(eq(systemSettings.key, HEARTBEAT_KEY));
    expect(new Date(row!.value as string).getTime()).toBeGreaterThan(Date.now() - 5000);
    const health = await t.app.inject({ method: "GET", url: "/health" });
    expect(health.json().worker.status).toBe("ok");
    // Running again updates the same row and bumps its version.
    await job.run({ db: t.c.db.db, config: t.c.config, logger: t.c.logger });
    const [row2] = await t.c.db.db.select().from(systemSettings).where(eq(systemSettings.key, HEARTBEAT_KEY));
    expect(row2!.version).toBe(row!.version + 1);
  });

  it("every job has a cron expression and a description", () => {
    for (const j of jobs) {
      expect(j.cron.split(" ")).toHaveLength(5);
      expect(j.description.length).toBeGreaterThan(5);
    }
    expect(jobs.map((j) => j.name)).toEqual(expect.arrayContaining(["system-heartbeat", "system-trash-purge"]));
  });

  it("the trash purge job uses the configured retention and writes an audit row", async () => {
    const job = jobs.find((j) => j.name === "system-trash-purge")!;
    await job.run({ db: t.c.db.db, config: t.c.config, logger: t.c.logger });
    const rows = await t.c.db.db.execute(sql`SELECT 1 FROM audit_log WHERE command = 'system.trash.purge' AND via = 'worker' LIMIT 1`);
    expect(rows.rows.length).toBe(1);
  });
});
