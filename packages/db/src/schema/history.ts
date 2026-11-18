import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { newId } from "./columns";

/** Generic row history (design section 9.1). Append-only, kept forever. */
export const rowHistory = pgTable(
  "row_history",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    /** Logical table name or id, e.g. `deals` or a Datahub table uuid. */
    tableId: text("table_id").notNull(),
    rowId: uuid("row_id").notNull(),
    /** Row version after this change. */
    version: integer("version").notNull(),
    /** `create` | `update` | `delete` | `restore` */
    op: text("op").notNull(),
    /** Array of `{ field, old, new }`. */
    changes: jsonb("changes").notNull(),
    /** ActorRef: who, through which channel, which connection. */
    actor: jsonb("actor"),
    at: timestamp("at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("row_history_row_version_uq").on(t.tableId, t.rowId, t.version),
    index("row_history_row_idx").on(t.tableId, t.rowId, t.at.desc()),
  ],
);
