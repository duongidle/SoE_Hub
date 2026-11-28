import { createHash } from "node:crypto";
import { and, inArray, sql } from "drizzle-orm";
import type { ActorRef } from "@soe/shared";
import { enqueueOutbox, notificationSettings, notifications, type Db, type OutboxRow } from "@soe/db";
import { systemScope } from "../../auth/access";
import { registerOwnedTable } from "../../auth/query-guard";

registerOwnedTable("reminders");
registerOwnedTable("notification_settings");

/**
 * The one door for notifications (design module6 3.1 and 14). A module declares a type once with `defineNotification` and, when an outbox
 * event arrives, the subscriber turns it into one `notify.send` call. Code that has no event (a job, the reminders) calls `notify.send` itself.
 */
export type Priority = "normal" | "important";

export interface NotifyContent {
  title: string;
  body: string;
  link?: string | null;
  data?: Record<string, unknown>;
}

/** A recipient, optionally with a key that tells apart several notifications of one type for one person from one event (one per deal) and data for `render`. */
export type Target = string | { userId: string; key?: string; ctx?: unknown };

export interface NotifyDeps {
  db: Db;
  secret: string;
}

export interface NotificationDef {
  type: string;
  category: string;
  /** Tên tiếng Việt hiện ở trang Cài đặt thông báo. */
  label: string;
  /** Một dòng giải thích loại này báo khi nào. */
  description: string;
  /** Outbox event that triggers it. Omit for a type that is only sent directly with `notify.send`. */
  on?: string | string[];
  recipients?: (ev: OutboxRow, deps: NotifyDeps) => Target[] | Promise<Target[]>;
  /** Content for one recipient. `by` is who did it ("Dương", "Dương (qua Claude Desktop)", or "Hệ thống"). Return null to skip this person. */
  render: (ev: OutboxRow, recipient: string, by: string, ctx: unknown, deps: NotifyDeps) => NotifyContent | null | Promise<NotifyContent | null>;
  priority?: Priority;
  /** True: cannot be switched off in the person's settings. */
  mandatory?: boolean;
  /** The object the notification is about (for filtering and later muting). */
  object?: (ev: OutboxRow) => { type: string; id: string } | null;
  /** Does the person still see the object? Called per recipient (design module6 5.4). */
  canView?: (ev: OutboxRow, recipient: string, ctx: unknown, deps: NotifyDeps) => boolean | Promise<boolean>;
  /** The person who caused it is told too (a reminder is for yourself). */
  selfNotify?: boolean;
  /** Merges events into one notification: same key (and same person) = one row whose text is rewritten (and shown as unread) by the later event (onboarding daily summary). */
  mergeKey?: (ev: OutboxRow) => string;
}

const defs: NotificationDef[] = [];
const byType = new Map<string, NotificationDef>();
const byEvent = new Map<string, NotificationDef[]>();

export function defineNotification(def: NotificationDef): NotificationDef {
  if (byType.has(def.type)) throw new Error(`Loại thông báo "${def.type}" đã khai báo.`);
  defs.push(def);
  byType.set(def.type, def);
  for (const e of def.on === undefined ? [] : Array.isArray(def.on) ? def.on : [def.on]) byEvent.set(e, [...(byEvent.get(e) ?? []), def]);
  return def;
}

export const notificationDefs = (): readonly NotificationDef[] => defs;
export const notificationDef = (type: string): NotificationDef | undefined => byType.get(type);
export const notificationEventsOf = (): string[] => [...byEvent.keys()];
export const defsForEvent = (event: string): readonly NotificationDef[] => byEvent.get(event) ?? [];

/** A stable uuid from some parts, so the same event/occurrence never makes a second notification for the same person. */
export function stableId(...parts: string[]): string {
  const h = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface SendInput {
  type: string;
  recipients: Target[];
  render: (recipient: string, by: string, ctx: unknown) => NotifyContent | null | Promise<NotifyContent | null>;
  /** Defaults to the declared type. */
  category?: string;
  priority?: Priority;
  object?: { type: string; id: string } | null;
  actor?: ActorRef | null;
  /** Free text channel, e.g. `mcp`; the connection name is read from the actor's connection. */
  via?: string | null;
  canView?: (recipient: string, ctx: unknown) => boolean | Promise<boolean>;
  /** Makes the send idempotent: same source + same person = one notification. */
  sourceEventId?: string | null;
  /** With `sourceEventId`: a second send of the same source + person rewrites the text and marks it unread, instead of being dropped. */
  merge?: boolean;
}

/** Who did it, as text, and the channel. */
async function describeActor(db: Db, actor: ActorRef | null | undefined, via?: string | null): Promise<{ by: string; actorId: string | null; via: string | null; connection: string | null }> {
  if (!actor) return { by: "Hệ thống", actorId: null, via: via ?? null, connection: null };
  const [u] = (await db.execute(sql`SELECT full_name, kind FROM users WHERE id = ${actor.userId}::uuid`)).rows as { full_name: string | null; kind: string }[];
  let connection: string | null = null;
  if (actor.connectionId) {
    const [t] = (await db.execute(sql`SELECT name FROM api_tokens WHERE /*scope:system*/ id = ${actor.connectionId}::uuid`)).rows as { name: string }[];
    connection = t?.name ?? null;
  }
  const name = u?.kind === "system" || !u?.full_name ? "Hệ thống" : u.full_name;
  const channel = connection ? `${actor.via} (${connection})` : (via ?? actor.via);
  return { by: connection ? `${name} (qua ${connection})` : name, actorId: u?.kind === "system" ? null : actor.userId, via: channel, connection };
}

/**
 * Creates the notifications and queues the SSE signal for each. Drops, in this order: people who are not persons or are locked; the actor
 * (unless `selfNotify`); people who switched the type off (never a mandatory type); people who lost the right to see the object.
 * Returns the number created.
 */
export async function sendNotification(db: Db, input: SendInput, opts: { selfNotify?: boolean } = {}): Promise<number> {
  const def = byType.get(input.type);
  const category = input.category ?? def?.category ?? "system";
  const priority = input.priority ?? def?.priority ?? "normal";
  const mandatory = def?.mandatory ?? false;
  const selfNotify = opts.selfNotify ?? def?.selfNotify ?? false;

  const targets = new Map<string, Target & object>();
  for (const t of input.recipients) {
    const o = typeof t === "string" ? { userId: t } : t;
    targets.set(`${o.userId}\u0000${o.key ?? ""}`, o);
  }
  if (targets.size === 0) return 0;
  const ids = [...new Set([...targets.values()].map((t) => t.userId))];
  const people = (await db.execute(sql`SELECT id FROM users WHERE id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND kind = 'person' AND status <> 'locked'`)).rows as { id: string }[];
  const alive = new Set(people.map((p) => p.id));
  const off = new Set<string>();
  if (!mandatory) {
    const rows = await db
      .select({ userId: notificationSettings.userId })
      .from(notificationSettings)
      .where(and(systemScope(), inArray(notificationSettings.userId, ids), sql`${input.type} = ANY(${notificationSettings.disabledTypes})`));
    rows.forEach((r) => off.add(r.userId));
  }
  const actor = await describeActor(db, input.actor, input.via);
  const made: { userId: string; content: NotifyContent; key: string }[] = [];
  for (const t of targets.values()) {
    if (!alive.has(t.userId) || off.has(t.userId)) continue;
    if (!selfNotify && actor.actorId === t.userId) continue;
    if (input.canView && !(await input.canView(t.userId, (t as { ctx?: unknown }).ctx))) continue;
    const content = await input.render(t.userId, actor.by, (t as { ctx?: unknown }).ctx);
    if (!content) continue;
    made.push({ userId: t.userId, content, key: (t as { key?: string }).key ?? "" });
  }
  if (made.length === 0) return 0;
  let created = 0;
  await db.transaction(async (tx) => {
    for (const m of made) {
      const [row] = await tx
        .insert(notifications)
        .values({
          userId: m.userId,
          type: input.type,
          title: m.content.title,
          body: m.content.body,
          data: m.content.data ?? {},
          category,
          priority,
          link: m.content.link ?? null,
          objectType: input.object?.type ?? null,
          objectId: input.object?.id ?? null,
          actorId: actor.actorId,
          via: actor.via,
          sourceEventId: input.sourceEventId ? (m.key ? stableId(input.sourceEventId, m.key) : input.sourceEventId) : null,
        })
        .onConflictDoUpdate({ target: [notifications.sourceEventId, notifications.userId], set: { title: m.content.title, body: m.content.body, data: m.content.data ?? {}, readAt: null, link: m.content.link ?? null }, setWhere: sql`${input.merge === true}` })
        .returning({ id: notifications.id });
      if (!row) continue;
      created++;
      await enqueueOutbox(tx, {
        event: "notification.notification.created",
        aggregateType: "notification",
        aggregateId: row.id,
        payload: { notification_id: row.id, user_id: m.userId, type: input.type, priority },
      });
    }
  });
  return created;
}

export const notify = { send: sendNotification };

/** Builds the notifications of one outbox event from every type declared for it. */
export async function deliverEvent(ev: OutboxRow, deps: NotifyDeps): Promise<void> {
  for (const def of defsForEvent(ev.event)) {
    const recipients = def.recipients ? await def.recipients(ev, deps) : [];
    if (recipients.length === 0) continue;
    await sendNotification(
      deps.db,
      {
        type: def.type,
        recipients,
        actor: (ev.actor as ActorRef | null) ?? null,
        object: def.object?.(ev) ?? null,
        sourceEventId: stableId(def.mergeKey ? def.mergeKey(ev) : ev.id, def.type),
        merge: !!def.mergeKey,
        render: (r, by, ctx) => def.render(ev, r, by, ctx, deps),
        canView: def.canView ? (r, ctx) => def.canView!(ev, r, ctx, deps) : undefined,
      },
      { selfNotify: def.selfNotify },
    );
  }
}

/** Every active Admin. */
export async function adminIds(db: Db): Promise<string[]> {
  const res = await db.execute(sql`SELECT id FROM users WHERE kind = 'person' AND status = 'active' AND 'admin' = ANY(roles)`);
  return (res.rows as { id: string }[]).map((r) => r.id);
}
