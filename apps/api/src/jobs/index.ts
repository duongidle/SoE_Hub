import { sql } from "drizzle-orm";
import { getTrashRetentionDays, purgeIdempotencyKeys, purgeTrash, writeAudit, type Db } from "@soe/db";
import { BUSINESS_TIMEZONE, type Actor } from "@soe/shared";
import type { Logger } from "pino";
import type { Config } from "../config";

/** Account used for audit rows written by the worker. Stage 1 creates this as a real system user. */
export const SYSTEM_USER_ID = "00000000-0000-7000-8000-000000000000";

export const systemActor: Actor = {
  userId: SYSTEM_USER_ID,
  via: "worker",
  connectionId: null,
  automationId: null,
  scopes: [],
  ip: null,
  userAgent: "soe-worker",
};

export interface JobContext {
  db: Db;
  config: Config;
  logger: Logger;
}

export interface JobDef {
  name: string;
  /** Cron expression (pg-boss, 5 fields). */
  cron: string;
  tz?: string;
  description: string;
  run(ctx: JobContext): Promise<void>;
}

export const HEARTBEAT_KEY = "worker.last_heartbeat";

export const jobs: JobDef[] = [
  {
    name: "system-heartbeat",
    cron: "* * * * *",
    description: "Job mẫu: ghi mốc 'worker còn sống' để /health đọc.",
    async run({ db, logger }) {
      const now = new Date().toISOString();
      await db.execute(sql`
        INSERT INTO system_settings (id, key, value, created_at, updated_at, version)
        VALUES (gen_random_uuid(), ${HEARTBEAT_KEY}, to_jsonb(${now}::text), now(), now(), 1)
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = now(), version = system_settings.version + 1`);
      logger.info({ job: "system-heartbeat", at: now }, "heartbeat");
    },
  },
  {
    name: "system-trash-purge",
    cron: "0 3 * * *",
    tz: BUSINESS_TIMEZONE,
    description: "Mỗi đêm xoá hẳn dòng nằm trong thùng rác quá thời hạn (mặc định 7 ngày, chỉnh bằng cài đặt trash.retention_days).",
    async run({ db, config, logger }) {
      const days = await getTrashRetentionDays(db, config.TRASH_RETENTION_DAYS);
      const results = await purgeTrash(db, days);
      logger.info({ job: "system-trash-purge", days, results }, "trash purged");
      await writeAudit(db, { command: "system.trash.purge", result: "success", actor: systemActor, details: { retention_days: days, results } });
    },
  },
  {
    name: "system-idempotency-purge",
    cron: "15 * * * *",
    description: "Mỗi giờ xoá Idempotency-Key quá 24 giờ.",
    async run({ db, logger }) {
      const n = await purgeIdempotencyKeys(db);
      logger.info({ job: "system-idempotency-purge", purged: n }, "idempotency keys purged");
    },
  },
  {
    name: "system-outbox-cleanup",
    cron: "30 3 * * *",
    tz: BUSINESS_TIMEZONE,
    description: "Mỗi đêm xoá sự kiện outbox đã xử lý quá 14 ngày (sự kiện `dead` được giữ lại để xem).",
    async run({ db, logger }) {
      const res = await db.execute(sql`DELETE FROM outbox WHERE status = 'processed' AND processed_at < now() - interval '14 days'`);
      logger.info({ job: "system-outbox-cleanup", purged: res.rowCount ?? 0 }, "outbox cleaned");
    },
  },
];
