import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { newId } from "./columns";

/** Transactional outbox (design section 13): written in the same transaction as the data. */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    /** `<module>.<object>.<past-tense verb>`, e.g. `datahub.row.updated`. */
    event: text("event").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    aggregateType: text("aggregate_type"),
    aggregateId: text("aggregate_id"),
    payload: jsonb("payload").notNull(),
    actor: jsonb("actor"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** `pending` | `processed` | `dead` */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Subscribers that already handled this event; retries only run the others. */
    deliveredTo: text("delivered_to")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("outbox_pending_idx")
      .on(t.availableAt, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    index("outbox_event_idx").on(t.event, t.createdAt.desc()),
  ],
);

export type OutboxRow = typeof outbox.$inferSelect;
