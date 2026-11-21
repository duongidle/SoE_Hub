import { sql } from "drizzle-orm";
import type { Subscriber } from "./outbox-dispatcher";
import type { EventRegistry } from "./events";
import { SSE_CHANNEL, type SseSignal } from "../http/sse";
import { formulaSubscriber, refillSubscriber, mergeSubscriber, sqlViewSubscriber, templateSubscriber } from "../modules/datahub";
import { metricCacheSubscriber } from "../modules/metrics";
import { createNotificationSubscriber } from "../modules/notification";

/**
 * Pushes a signal (never data) to every api process through Postgres NOTIFY; each api fans it out over SSE to the
 * connections allowed to see it. The audience comes from the event definition; no audience = no signal.
 */
export function createSseFanout(events: EventRegistry): Subscriber {
  return {
    name: "sse.fanout",
    match: () => true,
    async handle(ev, db) {
      const def = events.get(ev.event);
      const audience = def?.audience ? await def.audience(ev.payload, db) : null;
      if (!audience) return;
      const signal: SseSignal = {
        id: ev.id,
        event: ev.event,
        aggregate_type: ev.aggregateType,
        aggregate_id: ev.aggregateId,
        at: ev.createdAt.toISOString(),
        audience,
      };
      await db.execute(sql`SELECT pg_notify(${SSE_CHANNEL}, ${JSON.stringify(signal)})`);
    },
  };
}

/** Subscribers of the worker. Later modules append theirs (formula recalculation, Automation, webhooks). */
export function defaultSubscribers(events: EventRegistry, authSecret: string): Subscriber[] {
  return [createNotificationSubscriber(authSecret), createSseFanout(events), sqlViewSubscriber, formulaSubscriber, refillSubscriber, mergeSubscriber, templateSubscriber, metricCacheSubscriber];
}
