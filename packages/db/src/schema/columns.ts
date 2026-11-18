import { integer, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
// Circular on purpose: `users` uses standardColumns, and standardColumns points its `*_by` columns at `users`.
// Safe because the reference is a lazy callback and the functions here are hoisted declarations.
import { users } from "./users";

/** Generates a UUIDv7 (time-ordered, not guessable). Used for every record id. */
export function newId(): string {
  return uuidv7();
}

/**
 * Standard columns for every business table (design section 5):
 * id, created_at/by, updated_at/by, version, deleted_at/by.
 * `*_by` reference `users(id)` (added in Stage 1).
 */
export function standardColumns() {
  return {
    id: uuid("id").primaryKey().$defaultFn(newId),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references((): AnyPgColumn => users.id),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    deletedBy: uuid("deleted_by").references((): AnyPgColumn => users.id),
  };
}
