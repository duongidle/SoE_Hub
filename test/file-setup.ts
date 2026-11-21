import pg from "pg";
import { beforeAll } from "vitest";

/**
 * Every test file starts with an empty work queue. All files share one database, and a file can leave work behind (events it
 * never delivered, columns it never recomputed, merged tables it never synced). `drainOutbox` runs the whole queue, so the file
 * that runs next would do the work of the files before it: the cost grows through the run and a test late in the run timed out
 * (20 s) on 350 columns of big tables left by earlier files (design/module4-quyet-dinh-khi-code.md, 4.6C).
 * Only the work of finished files is dropped: the data stays, and the product's own queues are not touched.
 */
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return; // a test that does not use the shared database
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(`UPDATE outbox SET status = 'processed', processed_at = now() WHERE status = 'pending'`);
    await c.query(`DELETE FROM dh_change_queue`);
    await c.query(`UPDATE dh_columns SET calc_status = 'ready' WHERE calc_status <> 'ready'`);
    await c.query(`UPDATE dh_merges SET synced_seq = request_seq WHERE request_seq > synced_seq`);
    await c.query(`UPDATE dh_tables SET refill_pending_at = NULL WHERE refill_pending_at IS NOT NULL`);
  } finally {
    await c.end();
  }
});
