import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId, standardColumns } from "./columns";
import { users } from "./users";

/** A feedback of one person (design module11 3): a bug report, a suggestion or a feature request, with up to 3 images and a two-way thread. */
export const feedback = pgTable(
  "feedback",
  {
    ...standardColumns(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    /** `bug` | `suggestion` | `feature`. */
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    fileIds: uuid("file_ids").array().notNull().default(sql`'{}'`),
    /** `{ url, user_agent, viewport }`, written by the app, not typed by the person. */
    context: jsonb("context")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** `new` | `viewing` | `planned` | `done` | `wont_do`. */
    status: text("status").notNull().default("new"),
  },
  (t) => [index("feedback_inbox_idx").on(t.status, t.createdAt.desc(), t.id.desc()), index("feedback_author_idx").on(t.authorId, t.createdAt.desc(), t.id.desc())],
);

export const feedbackMessages = pgTable(
  "feedback_messages",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("feedback_messages_idx").on(t.feedbackId, t.createdAt, t.id)],
);
