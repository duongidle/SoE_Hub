import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { newId, standardColumns } from "./columns";
import { dhTables } from "./datahub";
import { users } from "./users";

/** Fixed id of the account that owns the rows written through a public form (design module7 3.1). */
export const PUBLIC_FORM_USER_ID = "00000000-0000-7000-8000-000000000f01";

/**
 * A form (design module7). `draft` is the configuration being edited (`soe-form/1`), the published copies live in `form_versions`;
 * `status` is what the owner chose, what people meet is derived from it (the dates, the response limit and the state of the table).
 */
export const forms = pgTable(
  "forms",
  {
    ...standardColumns(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    tableId: uuid("table_id").references(() => dhTables.id),
    status: text("status").notNull().default("draft"),
    code: text("code").notNull(),
    access: text("access").notNull().default("all_accounts"),
    /** `selected`: `{ user_ids, team_ids (Leader ids), roles, guest_ids, guest_presets }`. */
    audience: jsonb("audience")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** `{ one_per_user, open_at, close_at, max_responses, closed_message, daily_limit }`. */
    options: jsonb("options")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Reserved (design module7 14): stored, not used yet. */
    notifyNewResponse: boolean("notify_new_response").notNull().default(false),
    draft: jsonb("draft")
      .notNull()
      .default(sql`'{}'::jsonb`),
    publishedVersion: integer("published_version").notNull().default(0),
  },
  (t) => [uniqueIndex("forms_code_uq").on(t.code), index("forms_owner_idx").on(t.ownerId, t.createdAt.desc()), index("forms_table_idx").on(t.tableId)],
);

export const formVersions = pgTable(
  "form_versions",
  {
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    config: jsonb("config").notNull(),
    publishedBy: uuid("published_by")
      .notNull()
      .references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.formId, t.version] })],
);

export const formDrafts = pgTable(
  "form_drafts",
  {
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    answers: jsonb("answers")
      .notNull()
      .default(sql`'{}'::jsonb`),
    formVersion: integer("form_version").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.formId, t.userId] })],
);

/** One row per submission: the link between a form and the row it wrote (`user_id` null = a public form). `attempt_id` is the fill's own code (no double submit). */
export const formResponses = pgTable(
  "form_responses",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    formVersion: integer("form_version").notNull(),
    tableId: uuid("table_id"),
    rowId: uuid("row_id"),
    userId: uuid("user_id").references(() => users.id),
    attemptId: text("attempt_id").notNull(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("form_responses_attempt_uq").on(t.formId, t.attemptId), index("form_responses_form_idx").on(t.formId, t.createdAt.desc()), index("form_responses_user_idx").on(t.formId, t.userId)],
);

/** A file a person uploaded through a form: the link ties it to one fill (`attempt_id`) and one question (design module7 5.4). */
export const formUploads = pgTable(
  "form_uploads",
  {
    fileId: uuid("file_id").primaryKey(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id").notNull(),
    questionId: text("question_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("form_uploads_attempt_idx").on(t.formId, t.attemptId, t.questionId)],
);
