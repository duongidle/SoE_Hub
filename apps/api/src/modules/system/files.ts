import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@soe/shared";
import { files, newId, softDelete, type Executor } from "@soe/db";
import type { Config } from "../../config";
import { ownedBy } from "../../auth/access";
import { defineCommand, defineQuery } from "../../core/registry";
import type { StorageDriver } from "../../storage/types";

const FileOut = z.object({
  id: z.uuid(),
  filename: z.string(),
  content_type: z.string(),
  size_bytes: z.number().int(),
  status: z.enum(["pending", "ready"]),
  version: z.number().int(),
});

function toOut(r: typeof files.$inferSelect) {
  return { id: r.id, filename: r.filename, content_type: r.contentType, size_bytes: r.sizeBytes, status: r.status as "pending" | "ready", version: r.version };
}

/** Strips path parts and control characters from a user-supplied file name. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 200);
  return cleaned || "file";
}

export function fileOperations(cfg: Config, storage: StorageDriver) {
  // A file is private to its owner (design module1 section 4.3). Files attached to an object (a deal, an article)
  // become readable by whoever can read that object: the owning module adds that rule when it attaches files.
  async function loadOwned(ctx: { db: Executor; actor: { userId: string } }, id: string) {
    const [row] = await ctx.db.select().from(files).where(and(eq(files.id, id), ownedBy(files.ownerId, ctx.actor.userId), isNull(files.deletedAt))).limit(1);
    if (!row) throw new AppError("not_found", "Không tìm thấy file.");
    return row;
  }

  return [
    defineCommand({
      name: "file.upload.init",
      summary: "Bắt đầu tải file lên: tạo bản ghi và trả link tải lên có hạn.",
      description: "Client gửi file bằng PUT tới `upload.url` kèm header trong `upload.headers`, rồi gọi `file.upload.complete`.",
      permission: "file:write",
      aiAllowed: true,
      input: z.object({
        filename: z.string().min(1).max(255),
        content_type: z.string().min(3).max(150),
        size_bytes: z.number().int().min(1),
      }),
      output: z.object({
        file: FileOut,
        upload: z.object({ url: z.string(), method: z.literal("PUT"), headers: z.record(z.string(), z.string()), expires_at: z.string() }),
      }),
      http: { method: "POST", path: "/files", status: 201 },
      handler: async (ctx, i) => {
        if (i.size_bytes > cfg.FILE_MAX_BYTES) throw new AppError("payload_too_large", `File tối đa ${cfg.FILE_MAX_BYTES} byte.`, { max_bytes: cfg.FILE_MAX_BYTES });
        if (!cfg.allowedFileTypes.includes(i.content_type)) throw new AppError("unsupported_media_type", `Không nhận loại file ${i.content_type}.`, { allowed: cfg.allowedFileTypes });
        const [used] = await ctx.db
          .select({ total: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::float8` })
          .from(files)
          .where(and(ownedBy(files.ownerId, ctx.actor.userId), isNull(files.deletedAt)));
        if ((used?.total ?? 0) + i.size_bytes > cfg.FILE_USER_QUOTA_BYTES) {
          throw new AppError("quota_exceeded", "Vượt hạn mức lưu trữ của tài khoản.", { quota_bytes: cfg.FILE_USER_QUOTA_BYTES });
        }
        const id = newId();
        const [row] = await ctx.db
          .insert(files)
          .values({
            id,
            ownerId: ctx.actor.userId,
            createdBy: ctx.actor.userId,
            updatedBy: ctx.actor.userId,
            storageKey: `files/${id}`,
            filename: sanitizeFilename(i.filename),
            contentType: i.content_type,
            sizeBytes: i.size_bytes,
          })
          .returning();
        const up = await storage.createUploadUrl({ key: row!.storageKey, contentType: i.content_type, sizeBytes: i.size_bytes, ttlSeconds: cfg.UPLOAD_URL_TTL_SECONDS });
        ctx.audit({ type: "file", id, details: { filename: row!.filename, size_bytes: i.size_bytes } });
        return { file: toOut(row!), upload: { url: up.url, method: up.method, headers: up.headers, expires_at: up.expiresAt.toISOString() } };
      },
    }),

    defineCommand({
      name: "file.upload.complete",
      summary: "Xác nhận file đã tải lên xong.",
      permission: "file:write",
      aiAllowed: true,
      emits: ["file.file.uploaded"],
      input: z.object({ id: z.uuid() }),
      output: FileOut,
      http: { method: "POST", path: "/files/:id/complete" },
      handler: async (ctx, i) => {
        const row = await loadOwned(ctx, i.id);
        if (row.status === "ready") return toOut(row);
        const st = await storage.stat(row.storageKey);
        if (!st) throw new AppError("validation_error", "Chưa thấy file trên kho lưu trữ. Hãy tải lên trước.");
        if (st.sizeBytes !== row.sizeBytes) {
          throw new AppError("validation_error", "Dung lượng file tải lên không khớp với khai báo.", { declared: row.sizeBytes, actual: st.sizeBytes });
        }
        const [upd] = await ctx.db
          .update(files)
          .set({ status: "ready", version: sql`${files.version} + 1`, updatedAt: sql`now()`, updatedBy: ctx.actor.userId })
          .where(and(eq(files.id, row.id), ownedBy(files.ownerId, ctx.actor.userId)))
          .returning();
        ctx.audit({ type: "file", id: row.id });
        await ctx.emit("file.file.uploaded", { aggregateType: "file", aggregateId: row.id, payload: { file_id: row.id, size_bytes: row.sizeBytes } });
        return toOut(upd!);
      },
    }),

    defineQuery({
      name: "file.download.url",
      summary: "Lấy link tải file có hạn (mặc định 5 phút).",
      permission: "file:read",
      aiAllowed: true,
      audit: "always",
      input: z.object({ id: z.uuid() }),
      output: z.object({ url: z.string(), expires_at: z.string() }),
      http: { method: "GET", path: "/files/:id/download-url" },
      handler: async (ctx, i) => {
        const row = await loadOwned(ctx, i.id);
        if (row.status !== "ready") throw new AppError("not_found", "File chưa tải lên xong.");
        const d = await storage.createDownloadUrl({ key: row.storageKey, filename: row.filename, contentType: row.contentType, ttlSeconds: cfg.DOWNLOAD_URL_TTL_SECONDS });
        ctx.audit({ type: "file", id: row.id, details: { filename: row.filename } });
        return { url: d.url, expires_at: d.expiresAt.toISOString() };
      },
    }),

    defineCommand({
      name: "file.delete",
      summary: "Chuyển file vào thùng rác (khôi phục được trong thời hạn thùng rác).",
      permission: "file:write",
      aiAllowed: true,
      emits: ["file.file.deleted"],
      input: z.object({ id: z.uuid(), version: z.coerce.number().int().min(1) }),
      output: z.object({ id: z.uuid(), deleted: z.literal(true) }),
      http: { method: "DELETE", path: "/files/:id" },
      handler: async (ctx, i) => {
        await loadOwned(ctx, i.id);
        await softDelete(ctx.db, files, {
          id: i.id,
          expectedVersion: i.version,
          actor: { userId: ctx.actor.userId, via: ctx.actor.via, connectionId: ctx.actor.connectionId, automationId: ctx.actor.automationId },
          historyTableId: "files",
          where: ownedBy(files.ownerId, ctx.actor.userId),
        });
        ctx.audit({ type: "file", id: i.id });
        await ctx.emit("file.file.deleted", { aggregateType: "file", aggregateId: i.id, payload: { file_id: i.id } });
        return { id: i.id, deleted: true as const };
      },
    }),
  ];
}
