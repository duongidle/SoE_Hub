import { and, eq, lte, sql } from "drizzle-orm";
import { outbox, type Db, type OutboxRow } from "@soe/db";
import type { Logger } from "pino";

/**
 * A listener of outbox events (design section 13): notifications, formula recalculation, SSE, webhooks, and later Automation.
 * Delivery is at-least-once, so handlers must be idempotent. Handlers get the plain db (not the dispatch
 * transaction), so a failing side effect cannot poison the claim transaction.
 */
export interface Subscriber {
  name: string;
  match(event: string): boolean;
  handle(event: OutboxRow, db: Db): Promise<void>;
}

export type Lane = "interactive" | "derived" | "bulk";

export interface DispatchOptions {
  batchSize?: number;
  maxAttempts?: number;
  /** Which events this call takes: `interactive` (`auth.*`, `notification.*`), `derived` (what the recalculation and the merges announce), `bulk` (all others), default all. */
  lane?: Lane;
}

/**
 * Three lanes, each its own loop in the worker, so one kind of event never holds up the others.
 * - `interactive`: `auth.*` (the activation code) and `notification.*`, a person is waiting for them.
 * - `derived`: `datahub.formula.recalculated`, `datahub.merge.synced`. The recalculation writes them by the tens of thousands (a default template set alone: ~600), only listeners
 *   (SSE, merges, metric cache) read them. Alone in `bulk` they delayed the events that START a recalculation (a new row) by 3-8 seconds.
 * - `bulk`: the rest, which can be heavy too (a new member gets the default tables copied: seconds per batch).
 * Handlers read the database when they run and the lanes share no event, so none depends on the order between lanes.
 */
const interactive = sql`(event LIKE 'auth.%' OR event LIKE 'notification.%')`;
const derived = sql`event IN ('datahub.formula.recalculated', 'datahub.merge.synced')`;
const laneWhere = (lane: Lane | undefined) => (lane === "interactive" ? interactive : lane === "derived" ? derived : lane === "bulk" ? sql`NOT (${interactive} OR ${derived})` : undefined);

const MAX_BACKOFF_SECONDS = 15 * 60;

export function backoffSeconds(attempt: number): number {
  return Math.min(2 ** attempt, MAX_BACKOFF_SECONDS);
}

/**
 * Claims a batch of pending events (`FOR UPDATE SKIP LOCKED`, so several workers can run) and delivers each event to the
 * subscribers that have not yet received it. Failed subscribers are retried with exponential backoff;
 * after `maxAttempts` the event is marked `dead` and stays for inspection.
 * Returns the number of events looked at.
 */
export async function dispatchOutboxOnce(db: Db, subscribers: Subscriber[], log: Logger, opts: DispatchOptions = {}): Promise<number> {
  const batchSize = opts.batchSize ?? 50;
  const maxAttempts = opts.maxAttempts ?? 8;

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outbox)
      .where(and(eq(outbox.status, "pending"), lte(outbox.availableAt, sql`now()`), laneWhere(opts.lane)))
      .orderBy(outbox.createdAt, outbox.id)
      .limit(batchSize)
      .for("update", { skipLocked: true });

    for (const ev of rows) {
      const targets = subscribers.filter((s) => s.match(ev.event) && !ev.deliveredTo.includes(s.name));
      const delivered = [...ev.deliveredTo];
      const errors: string[] = [];
      for (const s of targets) {
        try {
          await s.handle(ev, db);
          delivered.push(s.name);
        } catch (e) {
          errors.push(`${s.name}: ${(e as Error).message}`);
          log.warn({ err: e, event: ev.event, eventId: ev.id, subscriber: s.name }, "outbox subscriber failed");
        }
      }
      if (errors.length === 0) {
        await tx.update(outbox).set({ status: "processed", processedAt: sql`now()`, deliveredTo: delivered, lastError: null }).where(eq(outbox.id, ev.id));
      } else {
        const attempts = ev.attempts + 1;
        const dead = attempts >= maxAttempts;
        await tx
          .update(outbox)
          .set({
            attempts,
            deliveredTo: delivered,
            lastError: errors.join("; ").slice(0, 2000),
            status: dead ? "dead" : "pending",
            availableAt: sql`now() + make_interval(secs => ${backoffSeconds(attempts)})`,
          })
          .where(eq(outbox.id, ev.id));
        if (dead) log.error({ event: ev.event, eventId: ev.id }, "outbox event is dead after max attempts");
      }
    }
    return rows.length;
  });
}

/** Runs `dispatchOutboxOnce` in a loop until `stop()` is called: one loop per lane (see `Lane`) unless `opts.lane` is given. */
export function startOutboxDispatcher(db: Db, subscribers: Subscriber[], log: Logger, pollMs: number, opts: DispatchOptions = {}) {
  if (!opts.lane) {
    const lanes = (["interactive", "derived", "bulk"] as const).map((lane) => startOutboxDispatcher(db, subscribers, log, pollMs, { ...opts, lane }));
    return { stop: async () => void (await Promise.all(lanes.map((l) => l.stop()))) };
  }
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> = Promise.resolve();

  const tick = async () => {
    try {
      const n = await dispatchOutboxOnce(db, subscribers, log, opts);
      // A full batch means there is probably more: go again without waiting.
      if (n >= (opts.batchSize ?? 50) && !stopped) return tick();
    } catch (e) {
      log.error({ err: e }, "outbox dispatch failed");
    }
    if (!stopped) timer = setTimeout(() => (running = tick()), pollMs);
  };
  running = tick();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
