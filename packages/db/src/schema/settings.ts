import { jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { standardColumns } from "./columns";

/** System settings (key -> JSON value), for example `trash.retention_days`. */
export const systemSettings = pgTable(
  "system_settings",
  {
    ...standardColumns(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
  },
  (t) => [uniqueIndex("system_settings_key_uq").on(t.key)],
);
