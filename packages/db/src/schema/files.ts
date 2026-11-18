import { bigint, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { standardColumns } from "./columns";
import { users } from "./users";

/** Metadata of files kept in object storage (design section 15). Bytes never live in Postgres. */
export const files = pgTable(
  "files",
  {
    ...standardColumns(),
    ownerId: uuid("owner_id").references(() => users.id),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** `pending` (upload URL issued) | `ready` (bytes verified in storage) */
    status: text("status").notNull().default("pending"),
  },
  (t) => [uniqueIndex("files_storage_key_uq").on(t.storageKey), index("files_owner_idx").on(t.ownerId)],
);
