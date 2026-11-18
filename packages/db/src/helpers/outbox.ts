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
}

/**
 * Writes an event to the outbox. MUST be called with the same transaction handle that writes the data,
 * so the event exists if and only if the data was committed.
 */
export async function enqueueOutbox(ex: Executor, e: OutboxEntry): Promise<string> {
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
