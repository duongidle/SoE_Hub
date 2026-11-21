import { PgBoss } from "pg-boss";
import { createContainer } from "./bootstrap";
import { startOutboxDispatcher } from "./core/outbox-dispatcher";
import { defaultSubscribers } from "./core/subscribers";
import { jobs } from "./jobs";
import { registerTrashTables } from "./modules";
import { ensureAllTrees, startDealDefaultsLoop } from "./modules/deal";
import { markVolatilePending, resetRunningColumns, resetRunningJobs, startJobLoop, startMergeLoop, startRecalcLoop } from "./modules/datahub";

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

// Formula columns: columns left `running` by a crash go back in the queue, TODAY()/NOW() columns missed while the worker was
// down are queued now (catch-up), and the loop recomputes whatever is pending.
// Managers that were in the org chart before the default template set existed get it now (a new Manager gets it from the org event).
await ensureAllTrees(c.db.db).catch((e) => c.logger.error({ err: e }, "default templates for existing trees failed"));
await resetRunningColumns(c.db.db);
await markVolatilePending(c.db.db);
const recalc = startRecalcLoop(c.db.db, c.logger, c.config.WORKER_OUTBOX_POLL_MS);

const dealDefaults = startDealDefaultsLoop(c.db.db, c.logger, c.config.WORKER_OUTBOX_POLL_MS);

// Merged tables (Module 3 section 4): copy the rows of the source tables whenever a change asked for it.
const merges = startMergeLoop(c.db.db, c.logger, c.config.WORKER_OUTBOX_POLL_MS);

// Imports and exports: jobs the owner is waiting for, run one at a time.
await resetRunningJobs(c.db.db);
const jobLoop = startJobLoop({ db: c.db.db, executor: c.executor, storage: c.storage, logger: c.logger, config: c.config }, c.config.WORKER_OUTBOX_POLL_MS);

const dispatcher = startOutboxDispatcher(c.db.db, defaultSubscribers(c.events, c.config.AUTH_SECRET), c.logger, c.config.WORKER_OUTBOX_POLL_MS);
c.logger.info("worker started");

const shutdown = async (signal: string) => {
  c.logger.info({ signal }, "worker shutting down");
  await dispatcher.stop();
  await recalc.stop();
  await dealDefaults.stop();
  await merges.stop();
  await jobLoop.stop();
  await boss.stop({ graceful: true, timeout: 10_000 });
  await c.db.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
