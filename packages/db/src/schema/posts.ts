import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { standardColumns } from "./columns";
import { users } from "./users";

/**
 * A post of the shared engine (design module8 2): a Knowledge article or an AI Hub skill. The `live_*` columns copy the published version
 * for search and lists; the `tsv` search vector is built when a version is published (`apps/api/src/modules/publish/engine.ts`).
 * `status`: draft | pending | returned (never published) | published (has a live version). Archive is `archived_at`.
 */
export const posts = pgTable(
  "posts",
  {
    ...standardColumns(),
    kind: text("kind").notNull(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("draft"),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    publishedVersion: integer("published_version"),
    lastVersion: integer("last_version").notNull().default(1),
    viewCount: integer("view_count").notNull().default(0),
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true, mode: "date" }),
    liveAt: timestamp("live_at", { withTimezone: true, mode: "date" }),
    liveTitle: text("live_title"),
    liveSummary: text("live_summary"),
    liveTags: text("live_tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    liveText: text("live_text"),
    liveFacets: jsonb("live_facets")
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [index("posts_author_idx").on(t.authorId, t.kind, t.updatedAt.desc()), index("posts_kind_status_idx").on(t.kind, t.status, t.archivedAt)],
);

/** One saved copy of a post. At most one "working" copy (draft | pending | returned) per post next to the published one. */
export const postVersions = pgTable(
  "post_versions",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** draft | pending | returned | published | superseded (an older published copy) | withdrawn (unpublished). */
    status: text("status").notNull(),
    content: jsonb("content").notNull(),
    /** Copied from the content so lists and the review queue do not load it. */
    title: text("title").notNull().default(""),
    summary: text("summary").notNull().default(""),
    textContent: text("text_content").notNull().default(""),
    checkResult: jsonb("check_result")
      .notNull()
      .default(sql`'{"errors":[],"warnings":[]}'::jsonb`),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decidedVia: text("decided_via"),
    returnReason: text("return_reason"),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    selfPublished: boolean("self_published").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.postId, t.version] })],
);
