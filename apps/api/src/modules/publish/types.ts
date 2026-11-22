import type { Permission } from "@soe/shared";
import type { Executor } from "@soe/db";

/** A rule result with a structure an AI can act on (design module8 2). */
export interface PostIssue {
  code: string;
  message: string;
  path: string;
  hint: string;
  [extra: string]: unknown;
}
export interface CheckResult {
  errors: PostIssue[];
  warnings: PostIssue[];
}

export interface Summary {
  title: string;
  summary: string;
  tags: string[];
  /** Plain text for search (the body, and for skills the SKILL.md). */
  text: string;
  /** Filter fields copied to the post: category, type, for_sale... */
  facets: Record<string, unknown>;
}

export interface Viewer {
  userId: string;
  roles: string[];
  permissions: ReadonlySet<Permission>;
}

/**
 * One kind of post (design module8 2): its content, its rules, its rights. To add a kind (the skill of 8B): write one `PostKind` and call
 * `registerKind` (see `modules/knowledge/kind.ts`); the lifecycle, review queue, versions and notifications come from the engine.
 */
export interface PostKind<C = Record<string, unknown>> {
  kind: string;
  /** AI menu a connection needs for this kind. */
  menu: "knowledge" | "aihub";
  label: string;
  perms: { read: Permission; post: Permission; review: Permission };
  /** A facet a Guest needs to read a live post (Knowledge: `for_sale`). Null = guests never read it. */
  guestFacet: string | null;
  /** Normalises untrusted input into the stored content (partial allowed: a draft may be incomplete). Throws `validation_error`. */
  parse(input: unknown, current: C | null): C;
  summarize(c: C): Summary;
  check(ctx: { db: Executor; authorId: string; postId: string | null }, c: C): Promise<CheckResult>;
  /** Link of the post in the web app (notifications). */
  webPath(postId: string): string;
  /** Compact Markdown for AI readers. */
  markdown(c: C): string;
  /** Ids of the files of `files` attached to the content. */
  fileIds(c: C): string[];
}
