import { PgBoss } from "pg-boss";
import { createContainer } from "./bootstrap";
import { startOutboxDispatcher } from "./core/outbox-dispatcher";
import { defaultSubscribers } from "./core/subscribers";
import { jobs } from "./jobs";
import { registerTrashTables } from "./modules";

const c = createContainer({}, "worker");
registerTrashTables({ config: c.config, storage: c.storage });

// pg-boss keeps its own tables in the `pgboss` schema, which the runtime role owns (created by the migration).
const boss = new PgBoss({ connectionString: c.config.DATABASE_URL, schema: "pgboss", createSchema: false, application_name: "soe-worker" });
boss.on("error", (err) => c.logger.error({ err }, "pg-boss error"));
await boss.start();

for (const job of jobs) {
  await boss.createQueue(job.name, { retryLimit: 3, retryDelay: 30, retryBackoff: true });
  await boss.schedule(job.name, job.cron, null, job.tz ? { tz: job.tz } : undefined);
  await boss.work(job.name, async () => {
    const started = Date.now();
    try {
      await job.run({ db: c.db.db, config: c.config, logger: c.logger });
    } catch (err) {
      c.logger.error({ err, job: job.name }, "job failed");
      throw err; // pg-boss retries with backoff and records the failure
    }
    c.logger.debug({ job: job.name, ms: Date.now() - started }, "job done");
  });
  c.logger.info({ job: job.name, cron: job.cron }, "job scheduled");
}

const dispatcher = startOutboxDispatcher(c.db.db, defaultSubscribers(c.events, c.config.AUTH_SECRET), c.logger, c.config.WORKER_OUTBOX_POLL_MS);
c.logger.info("worker started");

const shutdown = async (signal: string) => {
  c.logger.info({ signal }, "worker shutting down");
  await dispatcher.stop();
  await boss.stop({ graceful: true, timeout: 10_000 });
  await c.db.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
