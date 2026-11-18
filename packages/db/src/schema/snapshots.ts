import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "./columns";
import { users } from "./users";

/**
 * Snapshot skeleton (design section 10): a named, read-only copy of a data set at one moment.
 * Both tables are insert-only (no UPDATE/DELETE for the app role).
 */
export const snapshots = pgTable(
  "snapshots",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    name: text("name").notNull(),
    /** What kind of data set, e.g. `deal_pipeline`. */
    kind: text("kind").notNull(),
    tableId: text("table_id"),
    scope: text("scope").notNull().default("global"),
    takenAt: timestamp("taken_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    takenBy: uuid("taken_by").references(() => users.id),
    rowCount: integer("row_count").notNull().default(0),
    note: text("note"),
  },
  (t) => [index("snapshots_kind_idx").on(t.kind, t.scope, t.takenAt.desc())],
);

export const snapshotRows = pgTable(
  "snapshot_rows",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => snapshots.id),
    rowId: uuid("row_id").notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.rowId] })],
);
