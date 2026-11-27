import { sql } from "drizzle-orm";
import type { Db } from "@soe/db";

/** "Mở gần đây" (design module12 1, stage 12D-1): at most this many entries per person, newest first. */
export const RECENT_MAX = 20;
/** The same item opened again within this time does not rewrite the list (a page refreshes its data often; opening must stay cheap). */
const RECENT_MIN_GAP_MS = 60_000;

export const RECENT_TYPES = ["datahub", "form", "dashboard", "article"] as const;
export type RecentType = (typeof RECENT_TYPES)[number];
export interface RecentEntry {
  type: RecentType;
  id: string;
  at: string;
}

export const asRecent = (v: unknown): RecentEntry[] =>
  (Array.isArray(v) ? v : []).filter((e): e is RecentEntry => !!e && typeof e === "object" && RECENT_TYPES.includes((e as RecentEntry).type) && typeof (e as RecentEntry).id === "string" && typeof (e as RecentEntry).at === "string");

/**
 * Called by the READ command of a page right after it proved the person may open it (`datahub.datahub.get`, `form.form.get`,
 * `metrics.dashboard.get`/`view`, `knowledge.article.get`): the list is written on the server, so the page sends nothing extra.
 * Only the web counts as "opening" (an AI or API connection reading a datahub is not the person opening it). The id must already be checked.
 * The newest entry is put in front and an older one of the same item is dropped in ONE statement, so two tabs cannot overwrite each other.
 */
export async function noteOpened(ctx: { db: Db; actor: { userId: string; via: string } }, type: RecentType, id: string): Promise<void> {
  if (ctx.actor.via !== "web") return;
  const me = ctx.actor.userId;
  const cur = await ctx.db.execute(sql`SELECT value->0 AS head FROM user_prefs WHERE /*scope*/ user_id = ${me}::uuid AND key = 'recent'`);
  const head = (cur.rows[0] as { head: RecentEntry | null } | undefined)?.head;
  if (head && head.type === type && head.id === id && Date.now() - Date.parse(head.at) < RECENT_MIN_GAP_MS) return;
  const entry = JSON.stringify([{ type, id, at: new Date().toISOString() }]);
  await ctx.db.execute(sql`INSERT INTO user_prefs (user_id, key, value) VALUES (${me}::uuid, 'recent', ${entry}::jsonb)
    ON CONFLICT (user_id, key) DO UPDATE SET updated_at = now(), value = (
      SELECT coalesce(jsonb_agg(u.e ORDER BY u.o), '[]'::jsonb) FROM (
        SELECT e, o FROM (
          SELECT EXCLUDED.value->0 AS e, 0::bigint AS o
          UNION ALL
          SELECT v.e, v.o FROM jsonb_array_elements(user_prefs.value) WITH ORDINALITY AS v(e, o) WHERE NOT (v.e->>'type' = ${type} AND v.e->>'id' = ${id})
        ) w ORDER BY o LIMIT ${RECENT_MAX}
      ) u)`);
}
