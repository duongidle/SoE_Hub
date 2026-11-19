import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { z } from "zod";
import { AppError, type Actor } from "@soe/shared";
import { dhJobs, type Db, type Executor } from "@soe/db";
import type { Config } from "../../config";
import type { OperationExecutor } from "../../core/executor";
import { defineCommand, defineQuery } from "../../core/registry";
import type { StorageDriver } from "../../storage/types";
import { Id, Ts } from "./shared";

export type JobRow = typeof dhJobs.$inferSelect;

/** What a job needs to do its work: the same executor the api uses (the job runs as the person who asked), storage and config. */
export interface JobEnv {
  db: Db;
  executor: OperationExecutor;
  storage: StorageDriver;
  logger: Logger;
  config: Config;
}

/** The person who asked, as an actor for the executor and for access checks. */
export function jobActor(ownerId: string): Actor {
  return { userId: ownerId, via: "api", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: "soe-worker-job" };
}

export async function callAs<T = unknown>(env: JobEnv, ownerId: string, name: string, input: Record<string, unknown>): Promise<T> {
  const r = await env.executor.execute(name, input, { actor: jobActor(ownerId), requestId: randomUUID() });
  return r.result as T;
}

export const JOB_ACTIVE_MAX = 5;
/** Export results are kept this long; the worker deletes older files. */
export const JOB_RESULT_TTL_HOURS = 24;

export const JobOut = z.object({
  id: Id,
  kind: z.enum(["import", "export"]),
  status: z.enum(["draft", "pending", "running", "done", "failed", "cancelled"]),
  phase: z.string().nullable(),
  progress: z.object({ done: z.number().int(), total: z.number().int() }),
  datahub_id: Id.nullable(),
  table_id: Id.nullable(),
  params: z.record(z.string(), z.unknown()).describe("Tham số đã gửi khi tạo việc."),
  report: z.unknown().nullable().describe("Báo cáo: số dòng nhập, dòng lỗi, cột công thức dịch được hay không (import); số dòng xuất (export)."),
  error: z.string().nullable(),
  source_name: z.string().nullable(),
  result: z.object({ name: z.string(), type: z.string(), size_bytes: z.number().int() }).nullable().describe("File kết quả (export) khi đã xong và chưa hết hạn."),
  created_at: Ts,
  started_at: Ts.nullable(),
  finished_at: Ts.nullable(),
});

export function jobOut(j: JobRow) {
  return {
    id: j.id,
    kind: j.kind as "import" | "export",
    status: j.status as z.infer<typeof JobOut>["status"],
    phase: j.phase,
    progress: { done: j.progressDone, total: j.progressTotal },
    datahub_id: j.datahubId,
    table_id: j.tableId,
    params: (j.params ?? {}) as Record<string, unknown>,
    report: j.report ?? null,
    error: j.error,
    source_name: j.sourceName,
    result: j.resultKey && j.resultName ? { name: j.resultName, type: j.resultType ?? "application/octet-stream", size_bytes: j.resultSize ?? 0 } : null,
    created_at: j.createdAt,
    started_at: j.startedAt,
    finished_at: j.finishedAt,
  };
}

export async function loadJob(db: Executor, id: string, ownerId: string): Promise<JobRow> {
  const [row] = await db.select().from(dhJobs).where(and(eq(dhJobs.id, id), eq(dhJobs.ownerId, ownerId))).limit(1);
  if (!row) throw new AppError("not_found", "Không tìm thấy việc.");
  return row;
}

/** A person can have a few jobs waiting or running at once; this keeps one person from filling the queue. */
export async function assertJobRoom(db: Executor, ownerId: string): Promise<void> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(dhJobs)
    .where(and(eq(dhJobs.ownerId, ownerId), inArray(dhJobs.status, ["pending", "running"])));
  if ((r?.n ?? 0) >= JOB_ACTIVE_MAX) throw new AppError("quota_exceeded", `Bạn đang có ${JOB_ACTIVE_MAX} việc import/export chạy hoặc chờ. Đợi một việc xong rồi thử lại.`);
}

export type Runner = (env: JobEnv, job: JobRow) => Promise<void>;
const runners = new Map<string, Runner>();
export const registerJobRunner = (kind: "import" | "export", run: Runner) => runners.set(kind, run);

/** Marks the job running and returns it, or null when nothing is waiting. Safe with several workers. */
async function takeNext(db: Db): Promise<JobRow | null> {
  const res = await db.execute(sql`UPDATE dh_jobs SET status = 'running', started_at = now(), updated_at = now(), phase = 'starting'
    WHERE id = (SELECT id FROM dh_jobs WHERE status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id`);
  const id = (res.rows[0] as { id: string } | undefined)?.id;
  if (!id) return null;
  const [row] = await db.select().from(dhJobs).where(eq(dhJobs.id, id)).limit(1);
  return row ?? null;
}

export async function patchJob(db: Db, id: string, patch: Partial<typeof dhJobs.$inferInsert>): Promise<void> {
  await db.update(dhJobs).set({ ...patch, updatedAt: new Date() }).where(eq(dhJobs.id, id));
}

/** True when the owner asked to stop (checked between batches). */
export async function cancelRequested(db: Db, id: string): Promise<boolean> {
  const [r] = await db.select({ c: dhJobs.cancelRequested }).from(dhJobs).where(eq(dhJobs.id, id)).limit(1);
  return !!r?.c;
}

export class JobCancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

/** Runs one job to the end and records how it ended. */
async function runOne(env: JobEnv, job: JobRow): Promise<void> {
  const run = runners.get(job.kind);
  try {
    if (!run) throw new Error(`Không có bộ chạy cho việc "${job.kind}".`);
    await run(env, job);
    const [after] = await env.db.select({ status: dhJobs.status }).from(dhJobs).where(eq(dhJobs.id, job.id)).limit(1);
    if (after?.status === "running") await patchJob(env.db, job.id, { status: "done", finishedAt: new Date(), phase: "done" });
  } catch (e) {
    if (e instanceof JobCancelled) {
      await patchJob(env.db, job.id, { status: "cancelled", finishedAt: new Date(), phase: "cancelled" });
      return;
    }
    env.logger.error({ err: e, job: job.id, kind: job.kind }, "datahub job failed");
    const msg = e instanceof AppError ? e.message : "Việc bị lỗi ngoài dự kiến. Thử lại; nếu vẫn lỗi hãy báo quản trị.";
    await patchJob(env.db, job.id, { status: "failed", error: msg, finishedAt: new Date() });
  }
}

/** Runs every waiting job, one after another. Returns how many were run. */
export async function processJobs(env: JobEnv): Promise<number> {
  let n = 0;
  for (;;) {
    const job = await takeNext(env.db);
    if (!job) return n;
    await runOne(env, job);
    n++;
  }
}

/** A job left `running` by a crash: an export is simply queued again, an import (which may have written rows) is failed with a clear message. */
export async function resetRunningJobs(db: Db): Promise<void> {
  await db.execute(sql`UPDATE dh_jobs SET status = 'pending', phase = NULL, updated_at = now() WHERE status = 'running' AND kind = 'export'`);
  await db.execute(sql`UPDATE dh_jobs SET status = 'failed', error = 'Máy chủ dừng giữa chừng khi đang nhập. Một phần dòng có thể đã vào bảng; kiểm tra bảng rồi nhập lại phần còn thiếu.', finished_at = now(), updated_at = now() WHERE status = 'running' AND kind = 'import'`);
}

export function startJobLoop(env: JobEnv, pollMs: number): { stop(): Promise<void> } {
  let stopped = false;
  let busy: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    if (stopped) return;
    busy = busy.then(() => processJobs(env)).catch((err) => env.logger.error({ err }, "job loop error"));
  }, pollMs);
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await busy;
    },
  };
}

/** Deletes export files older than the retention time and import sources of finished jobs. */
export async function purgeJobFiles(db: Db, storage: StorageDriver, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - JOB_RESULT_TTL_HOURS * 3600_000);
  const old = await db.select().from(dhJobs).where(and(lt(dhJobs.updatedAt, cutoff), sql`(${dhJobs.resultKey} IS NOT NULL OR ${dhJobs.sourceKey} IS NOT NULL)`)).limit(500);
  for (const j of old) {
    if (j.status === "pending" || j.status === "running") continue;
    // A source that came from the person's own upload (`files/<id>`) belongs to the files module, not to the job.
    const ownSource = (j.params as { own_source?: boolean } | null)?.own_source !== false;
    for (const key of [j.resultKey, ownSource ? j.sourceKey : null]) if (key) await storage.delete(key);
    await db.update(dhJobs).set({ resultKey: null, sourceKey: null }).where(eq(dhJobs.id, j.id));
  }
  // Old finished rows are kept 30 days for the history, then removed.
  const res = await db.execute(sql`DELETE FROM dh_jobs WHERE status IN ('done', 'failed', 'cancelled', 'draft') AND updated_at < now() - interval '30 days'`);
  return (res.rowCount ?? 0) + old.length;
}

export function jobOperations(cfg: Config, storage: StorageDriver) {
  return [
    defineQuery({
      name: "datahub.job.get",
      summary: "Trạng thái và tiến độ của một việc import hoặc export (hỏi lại mỗi 1–2 giây đến khi `status` là done, failed hoặc cancelled).",
      permission: "datahub:datahub:use",
      aiAllowed: true,
      input: z.object({ job_id: Id }),
      output: JobOut,
      http: { method: "GET", path: "/datahub/jobs/:job_id" },
      handler: async (ctx, i) => jobOut(await loadJob(ctx.db, i.job_id, ctx.actor.userId)),
    }),

    defineQuery({
      name: "datahub.job.list",
      summary: "Các việc import/export gần đây của bạn (mới nhất trước, tối đa 50).",
      permission: "datahub:datahub:use",
      aiAllowed: true,
      input: z.object({ kind: z.enum(["import", "export"]).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }),
      output: z.array(JobOut),
      http: { method: "GET", path: "/datahub/jobs" },
      handler: async (ctx, i) => {
        const where = [eq(dhJobs.ownerId, ctx.actor.userId)];
        if (i.kind) where.push(eq(dhJobs.kind, i.kind));
        const rows = await ctx.db.select().from(dhJobs).where(and(...where)).orderBy(desc(dhJobs.createdAt)).limit(i.limit);
        return rows.map(jobOut);
      },
    }),

    defineCommand({
      name: "datahub.job.cancel",
      summary: "Huỷ một việc đang chờ hoặc đang chạy. Import đã ghi dòng nào thì dòng đó giữ nguyên (xoá được từ lịch sử/thùng rác).",
      permission: "datahub:datahub:use",
      aiAllowed: true,
      input: z.object({ job_id: Id }),
      output: JobOut,
      http: { method: "POST", path: "/datahub/jobs/:job_id/cancel" },
      handler: async (ctx, i) => {
        const job = await loadJob(ctx.db, i.job_id, ctx.actor.userId);
        if (["done", "failed", "cancelled"].includes(job.status)) return jobOut(job);
        const db = ctx.db;
        if (job.status === "running") await db.update(dhJobs).set({ cancelRequested: true, updatedAt: new Date() }).where(eq(dhJobs.id, job.id));
        else await db.update(dhJobs).set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() }).where(eq(dhJobs.id, job.id));
        ctx.audit({ type: "datahub_job", id: job.id, details: { kind: job.kind } });
        return jobOut(await loadJob(ctx.db, i.job_id, ctx.actor.userId));
      },
    }),

    defineQuery({
      name: "datahub.job.download_url",
      summary: "Link tải file kết quả của một việc export (có hạn, mặc định 5 phút; file giữ 24 giờ).",
      permission: "datahub:datahub:use",
      aiAllowed: true,
      audit: "always",
      input: z.object({ job_id: Id }),
      output: z.object({ url: z.string(), expires_at: z.string(), filename: z.string() }),
      http: { method: "GET", path: "/datahub/jobs/:job_id/download-url" },
      handler: async (ctx, i) => {
        const job = await loadJob(ctx.db, i.job_id, ctx.actor.userId);
        if (job.status !== "done" || !job.resultKey || !job.resultName) throw new AppError("not_found", "File chưa sẵn sàng hoặc đã hết hạn (giữ 24 giờ). Hãy xuất lại.");
        const d = await storage.createDownloadUrl({ key: job.resultKey, filename: job.resultName, contentType: job.resultType ?? "application/octet-stream", ttlSeconds: cfg.DOWNLOAD_URL_TTL_SECONDS });
        ctx.audit({ type: "datahub_job", id: job.id, details: { filename: job.resultName } });
        return { url: d.url, expires_at: d.expiresAt.toISOString(), filename: job.resultName };
      },
    }),
  ];
}
