import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { standardColumns } from "./columns";
import { users } from "./users";

/**
 * Data given to a Guest by a Manager (design module1 section 5.2). The data types are registered by the module that owns
 * the data (Deals in Stage 4). Never includes personal columns. Active while `revoked_at` is null and not expired.
 */
export const dataGrants = pgTable(
  "data_grants",
  {
    ...standardColumns(),
    guestUserId: uuid("guest_user_id")
      .notNull()
      .references(() => users.id),
    dataType: text("data_type").notNull(),
    /** The manager tree the data comes from. */
    scopeManagerId: uuid("scope_manager_id")
      .notNull()
      .references(() => users.id),
    /** A team inside that tree (leader id); null = the whole tree. */
    scopeLeaderId: uuid("scope_leader_id").references(() => users.id),
    /** Subset of `web`, `export`, `api`. */
    channels: text("channels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    note: text("note"),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedBy: uuid("revoked_by").references(() => users.id),
  },
  (t) => [index("data_grants_guest_idx").on(t.guestUserId).where(sql`${t.revokedAt} IS NULL`)],
);
