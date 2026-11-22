import { z } from "zod";

/** Channels a command can come through. `automation` is reserved; nothing uses it yet (design section 19). `form` = a row written by someone filling a form (design module7 5.1). */
export const VIA_VALUES = ["web", "api", "mcp", "worker", "automation", "form"] as const;
export type Via = (typeof VIA_VALUES)[number];

/**
 * Who runs a command (design section 3.4).
 * `userId` is a row of `users` (a person, a service account, or the internal system account).
 * `connectionId` is the bearer token (personal or service) or, from Stage 5, the AI connection used.
 * `scopes` are the token scopes; for a token the real permissions are the intersection with the owner's permissions.
 */
export const ActorSchema = z.object({
  userId: z.uuid(),
  via: z.enum(VIA_VALUES),
  connectionId: z.uuid().nullable().default(null),
  automationId: z.uuid().nullable().default(null),
  /** Login session behind a web request (null for tokens, the worker and server commands). */
  sessionId: z.uuid().nullable().default(null),
  /** Kind of the bearer token behind this call (null for sessions, the worker and dev actors). Personal tokens carry menus, not scopes. */
  connectionKind: z.enum(["personal", "service"]).nullable().optional(),
  /** Name of the connection (token), written to the audit log and to the source column of Deal tables. */
  connectionName: z.string().nullable().optional(),
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
