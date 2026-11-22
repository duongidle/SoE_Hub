import { sql } from "drizzle-orm";
import { SYSTEM_USER_ID, auditMinRetentionDays, getTrashRetentionDays, purgeAuditBefore, purgeIdempotencyKeys, purgeTrash, writeAudit, type Db } from "@soe/db";
import { BUSINESS_TIMEZONE, type Actor } from "@soe/shared";
import type { Logger } from "pino";
import type { Config } from "../config";
import { purgeSessions } from "../auth/sessions";
import { datahubJobs } from "../modules/datahub";
import { addIndexMonths, snapshotAllTrees } from "../modules/deal";
import { notifyExpiringConnections, purgeNotifications, runDueReminders, scrubExpiredCodes } from "../modules/notification";

/** The internal system account (a row of `users`, kind `system`, created by migration 0003). */
export { SYSTEM_USER_ID };

export const systemActor: Actor = {
  userId: SYSTEM_USER_ID,
  via: "worker",
  connectionId: null,
  automationId: null,
  sessionId: null,
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
  {
    name: "system-audit-purge",
    cron: "0 4 1 * *",
    tz: BUSINESS_TIMEZONE,
    description: "Ngày 1 hằng tháng xoá nhật ký audit cũ hơn thời hạn giữ (cài đặt audit.retention_days, tối thiểu 730 ngày) qua hàm có kiểm soát soe_purge_audit_before.",
    async run({ db, logger }) {
      const days = await auditMinRetentionDays(db);
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const purged = await purgeAuditBefore(db, cutoff);
      logger.info({ job: "system-audit-purge", days, cutoff, purged }, "audit log purged");
      // Written after the purge, so this record itself is kept.
      await writeAudit(db, { command: "system.audit.purge", result: "success", actor: systemActor, details: { retention_days: days, cutoff: cutoff.toISOString(), purged } });
    },
  },
  {
    name: "auth-session-purge",
    cron: "45 3 * * *",
    tz: BUSINESS_TIMEZONE,
    description: "Mỗi đêm xoá phiên đăng nhập đã hết hạn hoặc bị thu hồi quá 30 ngày.",
    async run({ db, config, logger }) {
      const n = await purgeSessions(db, config.SESSION_IDLE_DAYS);
      logger.info({ job: "auth-session-purge", purged: n }, "sessions purged");
    },
  },
  {
    name: "notification-code-scrub",
    cron: "5 * * * *",
    description: "Mỗi giờ xoá mã xác thực khỏi thông báo đã quá 6 giờ (mã chỉ hiện trong 6 giờ).",
    async run({ db, logger }) {
      const n = await scrubExpiredCodes(db);
      logger.info({ job: "notification-code-scrub", scrubbed: n }, "verification codes scrubbed");
    },
  },
  {
    name: "notification-reminders",
    cron: "* * * * *",
    description: "Mỗi phút gửi các nhắc hẹn đã đến giờ rồi tính lần nhắc kế tiếp (nhắc lặp).",
    async run({ db, logger }) {
      const n = await runDueReminders(db);
      if (n > 0) logger.info({ job: "notification-reminders", sent: n }, "reminders sent");
    },
  },
  {
    name: "notification-purge",
    cron: "40 3 * * *",
    tz: BUSINESS_TIMEZONE,
    description: "Mỗi đêm xoá thông báo đã đọc quá 90 ngày và chưa đọc quá 180 ngày.",
    async run({ db, logger }) {
      const n = await purgeNotifications(db);
      logger.info({ job: "notification-purge", purged: n }, "notifications purged");
    },
  },
  {
    name: "notification-ai-expiring",
    cron: "0 8 * * *",
    tz: BUSINESS_TIMEZONE,
    description: "08:00 mỗi ngày báo chủ kết nối AI sắp hết hạn trong 7 ngày (một lần cho mỗi kết nối).",
    async run({ db, logger }) {
      const n = await notifyExpiringConnections(db);
      logger.info({ job: "notification-ai-expiring", notified: n }, "expiring connections notified");
    },
  },
  ...datahubJobs,
  {
    name: "deal-index-months",
    cron: "10 0 * * *",
    tz: BUSINESS_TIMEZONE,
    description: "Mỗi ngày thêm dòng tháng mới vào bảng Index của mọi người khi sang tháng (Module 4 mục 5).",
    async run({ db, logger }) {
      await addIndexMonths(db, new Date(), logger);
    },
  },
  {
    name: "deal-quarter-snapshot",
    cron: "5 0 1 1,4,7,10 *",
    tz: BUSINESS_TIMEZONE,
    description: "00:05 ngày đầu mỗi quý: chụp snapshot dự báo các deal đang mở của mọi cây (Module 4 mục 11).",
    async run({ db, logger }) {
      const n = await snapshotAllTrees(db, new Date());
      logger.info({ job: "deal-quarter-snapshot", trees: n }, "quarter snapshots taken");
    },
  },
];
