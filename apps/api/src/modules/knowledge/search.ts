import { sql } from "drizzle-orm";
import type { Actor } from "@soe/shared";
import type { HandlerCtx } from "../../core/types";
import { liveFilter, viewerOf } from "../publish/engine";
import { articleKind } from "./kind";

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);
/** Marks around matched words in a headline; swapped for <b> after the text is escaped. */
const OPEN = "⟦";
const CLOSE = "⟧";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const snippetHtml = (s: string): string => escapeHtml(s.replaceAll(OPEN, "\u0001").replaceAll(CLOSE, "\u0002")).replaceAll("\u0001", "<b>").replaceAll("\u0002", "</b>").replace(/\s+/g, " ").trim();

/** Words of a query as a prefix `tsquery` string: `huong dan` -> `huong:* & dan:*`. Letters and digits only, so nothing can break the syntax. */
export function tsQueryOf(q: string): string | null {
  const toks = (q.normalize("NFC").match(/[\p{L}\p{N}\p{M}]+/gu) ?? []).slice(0, 8);
  return toks.length ? toks.map((t) => `${t}:*`).join(" & ") : null;
}

export interface SearchInput {
  q?: string;
  category?: string;
  type?: string;
  tag?: string;
  author_id?: string;
  for_sale?: boolean;
  sort: "relevance" | "newest" | "views";
  limit: number;
  offset: number;
}

const card = (x: Raw) => ({
  id: x.id, title: x.live_title, summary: x.live_summary, tags: x.live_tags, category: x.live_facets?.category ?? null, type: x.live_facets?.type ?? null, for_sale: x.live_facets?.for_sale === true,
  author: { id: x.author_id, name: x.author_name }, published_at: iso(x.first_published_at), updated_at: iso(x.live_at), view_count: x.view_count,
});

/**
 * Full-text search of live articles (design module8 3.2): `simple` + `unaccent` text search (title A, summary and tags B, body C), plus trigram
 * similarity on the title for a small typo. Without a query it is a list (newest, or most viewed). A Guest only gets "Cho sale" articles.
 */
export async function searchArticles(ctx: HandlerCtx<Actor>, i: SearchInput): Promise<{ items: Raw[]; next: number | null }> {
  const v = await viewerOf(ctx);
  const q = (i.q ?? "").trim();
  const tsq = tsQueryOf(q);
  const where = [liveFilter(v, articleKind)];
  if (q) {
    const nq = sql`soe_unaccent(lower(${q}))`;
    where.push(tsq ? sql`(p.tsv @@ to_tsquery('soe_simple'::regconfig, ${tsq}) OR ${nq} <% soe_unaccent(lower(p.live_title)))` : sql`false`);
  }
  if (i.category) where.push(sql`p.live_facets->>'category' = ${i.category}`);
  if (i.type) where.push(sql`p.live_facets->>'type' = ${i.type}`);
  if (i.tag) where.push(sql`${i.tag.trim().toLowerCase()} = ANY(p.live_tags)`);
  if (i.author_id) where.push(sql`p.author_id = ${i.author_id}::uuid`);
  if (i.for_sale !== undefined) where.push(i.for_sale ? sql`p.live_facets->>'for_sale' = 'true'` : sql`COALESCE(p.live_facets->>'for_sale', 'false') <> 'true'`);
  const score = tsq ? sql`(ts_rank_cd(COALESCE(p.tsv, ''::tsvector), to_tsquery('soe_simple'::regconfig, ${tsq})) + 0.5 * word_similarity(soe_unaccent(lower(${q})), soe_unaccent(lower(p.live_title))))` : sql`0`;
  const order = q && i.sort === "relevance" ? sql`score DESC, p.live_at DESC, p.id` : i.sort === "views" ? sql`p.view_count DESC, p.live_at DESC, p.id` : sql`p.live_at DESC, p.id`;
  const head = tsq ? sql`ts_headline('soe_simple'::regconfig, COALESCE(p.live_text, ''), to_tsquery('soe_simple'::regconfig, ${tsq}), ${`StartSel=${OPEN}, StopSel=${CLOSE}, MaxFragments=1, MaxWords=30, MinWords=12, ShortWord=2`})` : sql`NULL`;
  const r = await ctx.db.execute(sql`SELECT p.id, p.author_id, p.live_title, p.live_summary, p.live_tags, p.live_facets, p.live_at, p.first_published_at, p.view_count, u.full_name AS author_name, ${score} AS score, ${head} AS headline
    FROM posts p JOIN users u ON u.id = p.author_id WHERE /*scope:system*/ ${sql.join(where, sql` AND `)} ORDER BY ${order} LIMIT ${i.limit + 1} OFFSET ${i.offset}`);
  const rows = r.rows as Raw[];
  return {
    items: rows.slice(0, i.limit).map((x) => ({ ...card(x), ...(x.headline ? { snippet: snippetHtml(String(x.headline)) } : {}) })),
    next: rows.length > i.limit ? i.offset + i.limit : null,
  };
}

/** Tags already used by live articles, most used first, optionally starting with what is typed. */
export async function suggestTags(ctx: HandlerCtx<Actor>, prefix: string | undefined, limit: number): Promise<{ tag: string; count: number }[]> {
  const v = await viewerOf(ctx);
  const pre = (prefix ?? "").trim().toLowerCase();
  const r = await ctx.db.execute(sql`SELECT t.tag, count(*)::int AS n FROM posts p, unnest(p.live_tags) AS t(tag)
    WHERE /*scope:system*/ ${liveFilter(v, articleKind)} ${pre ? sql`AND starts_with(soe_unaccent(t.tag), soe_unaccent(${pre}))` : sql``} GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT ${limit}`);
  return (r.rows as { tag: string; n: number }[]).map((x) => ({ tag: x.tag, count: x.n }));
}

/** Live articles that share tags (then the category) with this one. Empty when this one is not live. */
export async function relatedArticles(ctx: HandlerCtx<Actor>, id: string, limit: number): Promise<Raw[]> {
  const v = await viewerOf(ctx);
  const r = await ctx.db.execute(sql`SELECT p.id, p.author_id, p.live_title, p.live_summary, p.live_tags, p.live_facets, p.live_at, p.first_published_at, p.view_count, u.full_name AS author_name
    FROM posts p JOIN users u ON u.id = p.author_id, posts c
    WHERE /*scope:system*/ c.id = ${id}::uuid AND c.status = 'published' AND p.id <> c.id AND ${liveFilter(v, articleKind)}
      AND (p.live_tags && c.live_tags OR p.live_facets->>'category' = c.live_facets->>'category')
    ORDER BY cardinality(ARRAY(SELECT unnest(p.live_tags) INTERSECT SELECT unnest(c.live_tags))) DESC, (p.live_facets->>'category' = c.live_facets->>'category') DESC, p.view_count DESC, p.live_at DESC LIMIT ${limit}`);
  return (r.rows as Raw[]).map(card);
}
