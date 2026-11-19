import { sql } from "drizzle-orm";
import { DH_AUTO_INDEX_MAX_PER_TABLE } from "@soe/shared";
import type { Db } from "@soe/db";
import type { Subscriber } from "../../core/outbox-dispatcher";
import type { JobDef } from "../../jobs";

type Raw = Record<string, unknown>;

/**
 * SQL export views (design module2 section 3): one view per table in schema `dh_views`, with the column names users chose.
 * The database function `soe_dh_regenerate_view` (migration 0005) builds it; only the schema owner can read the result.
 * Runs in the worker when the structure changes.
 */
export async function regenerateViews(db: Db, datahubId: string, tableId: string | null): Promise<string[]> {
  const ids = tableId
    ? [tableId]
    : ((await db.execute(sql`SELECT id FROM dh_tables WHERE /*scope:system*/ datahub_id = ${datahubId}::uuid`)).rows as { id: string }[]).map((r) => r.id);
  const names: string[] = [];
  for (const id of ids) {
    const res = await db.execute(sql`SELECT soe_dh_regenerate_view(${id}::uuid) AS v`);
    const v = (res.rows[0] as { v: string | null }).v;
    if (v) names.push(v);
  }
  await db.execute(sql`SELECT soe_dh_sync_views()`);
  return names;
}

export const sqlViewSubscriber: Subscriber = {
  name: "datahub.sql_views",
  match: (event) => event === "datahub.structure.changed",
  async handle(ev, db) {
    const p = ev.payload as { datahub_id: string; table_id: string | null };
    await regenerateViews(db, p.datahub_id, p.table_id);
  },
};

/**
 * Auto index (Module 0 section 6.2). Budget: a table must have at least `DH_AUTO_INDEX_MIN_ROWS` rows, and gets at most
 * `DH_AUTO_INDEX_MAX_PER_TABLE` automatic indexes (each costs write time and disk). Requests beyond the budget are
 * marked `skipped`. Indexes are partial (one table only) expression indexes built by `soe_dh_ensure_index`.
 */
export async function processIndexRequests(db: Db): Promise<{ done: number; skipped: number; failed: number }> {
  const out = { done: 0, skipped: 0, failed: 0 };
  const pending = (await db.execute(sql`SELECT table_id, column_key, kind FROM dh_index_requests WHERE status = 'pending' ORDER BY requested_at LIMIT 50`)).rows as Raw[];
  for (const r of pending) {
    const key = { t: r.table_id as string, c: r.column_key as string, k: r.kind as string };
    const count = (await db.execute(sql`SELECT count(*)::int AS n FROM dh_index_requests WHERE table_id = ${key.t}::uuid AND status = 'done'`)).rows[0] as { n: number };
    let status = "done";
    let note: string | null = null;
    if (count.n >= DH_AUTO_INDEX_MAX_PER_TABLE) {
      status = "skipped";
      note = `Đã đủ ${DH_AUTO_INDEX_MAX_PER_TABLE} index tự động cho bảng này.`;
    } else {
      try {
        const res = await db.execute(sql`SELECT soe_dh_ensure_index(${key.t}::uuid, ${key.c}, ${key.k}) AS name`);
        note = (res.rows[0] as { name: string }).name;
      } catch (e) {
        status = "failed";
        note = String((e as Error).message).slice(0, 300);
      }
    }
    await db.execute(sql`UPDATE dh_index_requests SET status = ${status}, note = ${note}, done_at = now() WHERE table_id = ${key.t}::uuid AND column_key = ${key.c} AND kind = ${key.k}`);
    out[status as "done" | "skipped" | "failed"]++;
  }
  return out;
}

export const datahubJobs: JobDef[] = [
  {
    name: "datahub-autoindex",
    cron: "* * * * *",
    description: "Mỗi phút tạo index cho cột datahub hay bị lọc/sắp xếp trên bảng trên 5.000 dòng (tối đa 8 index tự động mỗi bảng).",
    async run({ db, logger }) {
      const r = await processIndexRequests(db);
      if (r.done + r.skipped + r.failed > 0) logger.info({ job: "datahub-autoindex", ...r }, "datahub indexes processed");
    },
  },
  {
    name: "datahub-views-sync",
    cron: "20 3 * * *",
    tz: "Asia/Ho_Chi_Minh",
    description: "Mỗi đêm dựng lại view SQL xuất của mọi bảng và xoá view mồ côi (bảng đã xoá hẳn).",
    async run({ db, logger }) {
      const tables = (await db.execute(sql`SELECT id FROM dh_tables WHERE /*scope:system*/ true`)).rows as { id: string }[];
      for (const t of tables) await db.execute(sql`SELECT soe_dh_regenerate_view(${t.id}::uuid)`);
      const dropped = (await db.execute(sql`SELECT soe_dh_sync_views() AS n`)).rows[0] as { n: number };
      logger.info({ job: "datahub-views-sync", tables: tables.length, dropped: dropped.n }, "datahub SQL views synced");
    },
  },
  {
    name: "datahub-jobs-purge",
    cron: "10 * * * *",
    description: "Mỗi giờ xoá file kết quả export và file nguồn import quá 24 giờ, và bản ghi việc quá 30 ngày.",
    async run({ db, config, logger }) {
      const { purgeJobFiles } = await import("./jobs");
      const { createStorage } = await import("../../storage");
      const n = await purgeJobFiles(db, createStorage(config));
      if (n > 0) logger.info({ job: "datahub-jobs-purge", purged: n }, "datahub job files purged");
    },
  },
];
