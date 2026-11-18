import { integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

/** Generates a UUIDv7 (time-ordered, not guessable). Used for every record id. */
export function newId(): string {
  return uuidv7();
}

/**
 * Standard columns for every business table (design section 5):
 * id, created_at/by, updated_at/by, version, deleted_at/by.
 * `*_by` are plain uuid columns; Stage 1 adds foreign keys to users.
 */
export function standardColumns() {
  return {
    id: uuid("id").primaryKey().$defaultFn(newId),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    deletedBy: uuid("deleted_by"),
  };
}
