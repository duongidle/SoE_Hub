import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { newId } from "./columns";

/** Stored results of commands sent with an Idempotency-Key. Kept 24 hours (design section 7). */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    /** Who owns the key (actor user id). A key is only unique per owner. */
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    command: text("command").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idempotency_scope_key_uq").on(t.scope, t.key)],
);
