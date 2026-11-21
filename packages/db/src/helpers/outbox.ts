import { sql } from "drizzle-orm";
import type { ActorRef } from "@soe/shared";
import type { Executor } from "../client";
import { outbox } from "../schema/outbox";

export interface OutboxEntry {
  event: string;
  eventVersion?: number;
  aggregateType?: string | null;
  aggregateId?: string | null;
  payload: unknown;
  actor?: ActorRef | null;
  requestId?: string | null;
  availableAt?: Date;
  /**
   * The event only says "this aggregate changed, look again" (its handlers read the database when they run). An identical event (same name, aggregate, payload and
   * actor) still waiting in the outbox then adds nothing, so it is not written twice and the id of the waiting one is returned. A waiting event a dispatcher
   * has claimed is locked and skipped, so a change made after the claim always gets its own event. Without this, building one table with 30 columns writes
   * 60 identical events that every subscriber handles one by one, and the dispatcher is busy for seconds while the events behind them (activation codes) wait.
   */
  coalesce?: boolean;
}

/**
 * Writes an event to the outbox. MUST be called with the same transaction handle that writes the data,
 * so the event exists if and only if the data was committed.
 */
export async function enqueueOutbox(ex: Executor, e: OutboxEntry): Promise<string> {
  if (e.coalesce) {
    const payload = JSON.stringify(e.payload ?? {});
    const actor = e.actor ? JSON.stringify(e.actor) : null;
    const res = await ex.execute(sql`SELECT id FROM outbox WHERE status = 'pending' AND event = ${e.event} AND event_version = ${e.eventVersion ?? 1}
      AND aggregate_type IS NOT DISTINCT FROM ${e.aggregateType ?? null} AND aggregate_id IS NOT DISTINCT FROM ${e.aggregateId ?? null}
      AND payload = ${payload}::jsonb AND actor IS NOT DISTINCT FROM ${actor}::jsonb LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const found = res.rows[0] as { id: string } | undefined;
    if (found) return found.id;
  }
  const [row] = await ex
    .insert(outbox)
    .values({
      event: e.event,
      eventVersion: e.eventVersion ?? 1,
      aggregateType: e.aggregateType ?? null,
      aggregateId: e.aggregateId ?? null,
      payload: e.payload ?? {},
      actor: e.actor ?? null,
      requestId: e.requestId ?? null,
      ...(e.availableAt ? { availableAt: e.availableAt } : {}),
    })
    .returning({ id: outbox.id });
  return row!.id;
}
