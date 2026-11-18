import { sql } from "drizzle-orm";
import type { Subscriber } from "./outbox-dispatcher";
import { SSE_CHANNEL, type SseSignal } from "../http/sse";

/** Pushes a signal (never data) to every api process through Postgres NOTIFY; each api fans it out over SSE. */
export const sseFanout: Subscriber = {
  name: "sse.fanout",
  match: () => true,
  async handle(ev, db) {
    const signal: SseSignal = {
      id: ev.id,
      event: ev.event,
      aggregate_type: ev.aggregateType,
      aggregate_id: ev.aggregateId,
      at: ev.createdAt.toISOString(),
    };
    await db.execute(sql`SELECT pg_notify(${SSE_CHANNEL}, ${JSON.stringify(signal)})`);
  },
};

/** Subscribers active in Stage 0. Later modules append theirs (notifications, formula recalculation, Automation, webhooks). */
export const defaultSubscribers: Subscriber[] = [sseFanout];
