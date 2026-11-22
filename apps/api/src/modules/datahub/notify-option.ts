import { sql } from "drizzle-orm";
import type { Executor } from "@soe/db";

/** Columns of a table with the "tell the people in column X" option (design module9 5), remembered for a minute: most row events are on tables with no such option and must cost no more than this one lookup. */
export interface NotifyOption { key: string; name: string; peopleKey: string }
const cache = new Map<string, { opts: NotifyOption[]; at: number }>();

export async function notifyOptionsOf(db: Executor, tableId: string): Promise<NotifyOption[]> {
  const hit = cache.get(tableId);
  if (hit && Date.now() - hit.at < 60_000) return hit.opts;
  const rows = (await db.execute(sql`SELECT key, name, notify_on_change->>'people_column' AS people FROM dh_columns WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL AND notify_on_change IS NOT NULL`)).rows as { key: string; name: string; people: string }[];
  const opts = rows.map((r) => ({ key: r.key, name: r.name, peopleKey: r.people }));
  cache.set(tableId, { opts, at: Date.now() });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return opts;
}
/** Called when the option changes in this process; another process (the worker) sees the change within a minute. */
export const forgetNotifyOptions = (tableId: string): void => void cache.delete(tableId);
