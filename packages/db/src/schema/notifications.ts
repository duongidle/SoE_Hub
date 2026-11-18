import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt.desc()),
    index("notifications_unread_idx").on(t.userId).where(sql`${t.readAt} IS NULL`),
    uniqueIndex("notifications_source_uq").on(t.sourceEventId, t.userId),
  ],
);
