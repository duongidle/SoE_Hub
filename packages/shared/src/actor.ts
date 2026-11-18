import { z } from "zod";

/** Channels a command can come through. `automation` is reserved; nothing uses it yet (design section 19). */
export const VIA_VALUES = ["web", "api", "mcp", "worker", "automation"] as const;
export type Via = (typeof VIA_VALUES)[number];

/**
 * Who runs a command (design section 3.4).
 * `userId` is a plain uuid without a foreign key until Stage 1 adds the users table.
 */
export const ActorSchema = z.object({
  userId: z.uuid(),
  via: z.enum(VIA_VALUES),
  connectionId: z.uuid().nullable().default(null),
  automationId: z.uuid().nullable().default(null),
  scopes: z.array(z.string()).default([]),
  ip: z.string().nullable().default(null),
  userAgent: z.string().nullable().default(null),
});

export type Actor = z.infer<typeof ActorSchema>;

/** Subset of the actor that is safe to store in history/outbox rows (no scopes, no ip). */
export interface ActorRef {
  userId: string;
  via: Via;
  connectionId: string | null;
  automationId: string | null;
}

export function toActorRef(actor: Actor): ActorRef {
  return {
    userId: actor.userId,
    via: actor.via,
    connectionId: actor.connectionId,
    automationId: actor.automationId,
  };
}
