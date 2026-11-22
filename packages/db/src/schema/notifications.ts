import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { newId } from "./columns";
import { users } from "./users";

/**
 * Minimal in-app notifications (design module1 section 9; Module 6 extends it).
 * Created by the outbox subscriber, one row per recipient; `source_event_id` makes delivery idempotent.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    data: jsonb("data")
      .notNull()
      .default(sql`'{}'::jsonb`),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** When a secret in the notification (a verification code) was removed. */
    scrubbedAt: timestamp("scrubbed_at", { withTimezone: true, mode: "date" }),
    sourceEventId: uuid("source_event_id"),
    /** Group for filtering: deal, datahub, ai, account, reminder... (design module6 2.1). */
    category: text("category").notNull().default("system"),
    /** `normal` | `important`. */
    priority: text("priority").notNull().default("normal"),
    link: text("link"),
    objectType: text("object_type"),
    objectId: text("object_id"),
    actorId: uuid("actor_id"),
    /** Channel of the actor: `web`, `api`, `mcp (<connection name>)`... */
    via: text("via"),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt.desc()),
    index("notifications_unread_idx").on(t.userId).where(sql`${t.readAt} IS NULL`),
    uniqueIndex("notifications_source_uq").on(t.sourceEventId, t.userId),
  ],
);

/** Per-person notification settings (design module6 14): types switched off (never a mandatory one) and the morning digest flag. */
export const notificationSettings = pgTable("notification_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  disabledTypes: text("disabled_types")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  morningDigest: boolean("morning_digest").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** A person's own reminder (design module6 4). `due_at` is the next time it fires. */
export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    content: text("content").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }).notNull(),
    /** `none` | `daily` | `weekly` | `monthly` */
    repeat: text("repeat").notNull().default("none"),
    /** Weekly: ISO weekdays 1 (Monday) to 7 (Sunday). */
    weekdays: integer("weekdays")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    /** Monthly: the day of month asked for (31 falls on the last day of shorter months). */
    anchorDay: integer("anchor_day").notNull().default(1),
    /** Last day (Vietnam date) the reminder may fire. */
    untilDate: date("until_date", { mode: "string" }),
    objectType: text("object_type"),
    objectId: text("object_id"),
    /** `pending` (waits for `due_at`) | `fired` (sent, not marked done) | `done` */
    status: text("status").notNull().default("pending"),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("reminders_due_idx").on(t.dueAt).where(sql`${t.status} = 'pending'`), index("reminders_user_idx").on(t.userId, t.status, t.dueAt)],
);
