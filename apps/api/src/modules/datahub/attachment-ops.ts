import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@soe/shared";
import { files, type Executor } from "@soe/db";
import { systemScope } from "../../auth/access";
import type { Config } from "../../config";
import { defineQuery } from "../../core/registry";
import type { StorageDriver } from "../../storage/types";
import { loadTableAccess, type TableAccess } from "./access";
import { Id } from "./shared";
import { TableSchema } from "./table-schema";
import { assertColumnKey } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FileBrief = z.object({ id: Id, filename: z.string(), content_type: z.string(), size_bytes: z.number().int() });

/** Ids among `ids` that sit in an attachment cell of a live row of this table. Only these files are readable through the table. */
async function attached(db: Executor, acc: TableAccess, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const schema = await TableSchema.load(db, acc);
  const keys = schema.alive.filter((c) => c.type === "attachment").map((c) => assertColumnKey(c.key));
  if (keys.length === 0) return new Set();
  const found = new Set<string>();
  for (const key of keys) {
    const res = await db.execute(sql`SELECT DISTINCT f.id FROM unnest(${`{${ids.join(",")}}`}::uuid[]) AS f(id)
      WHERE EXISTS (SELECT 1 FROM dh_rows r WHERE ${acc.rows("r")} AND r.deleted_at IS NULL AND r.data->${sql.raw(`'${key}'`)} ? f.id::text)`);
    (res.rows as { id: string }[]).forEach((r) => found.add(r.id));
  }
  return found;
}

/**
 * Files in attachment cells. A file is private to the person who uploaded it (system files module); once it sits in a cell, whoever may
 * read the table may read the file (design module1 section 4.3: files attached to an object are readable by whoever reads the object).
 */
export function attachmentOperations(cfg: Config, storage: StorageDriver) {
  return [
    defineQuery({
      name: "datahub.attachment.list",
      summary: "Tên, loại và dung lượng của các file đang nằm trong ô Đính kèm của bảng.",
      description: "Chỉ trả file đang được gắn vào một dòng chưa xoá của bảng này; mã khác bị bỏ qua. Người xem bảng đều đọc được.",
      permission: "datahub:datahub:use",
      aiAllowed: true,
      input: z.object({ table_id: Id, ids: z.string().max(8000).describe("Mã file, ngăn cách bằng dấu phẩy (tối đa 200).") }),
      output: z.array(FileBrief),
      http: { method: "GET", path: "/tables/:table_id/attachments" },
      handler: async (ctx, i) => {
        const acc = await loadTableAccess(ctx, i.table_id);
        const ids = [...new Set(i.ids.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))];
        if (ids.length > 200) throw new AppError("validation_error", "Tối đa 200 mã file mỗi lần.");
        if (ids.some((x) => !UUID_RE.test(x))) throw new AppError("validation_error", "Mã file không hợp lệ.");
        const ok = [...(await attached(ctx.db, acc, ids))];
        if (ok.length === 0) return [];
        // The access to the file comes from the table (checked above), not from who uploaded it.
        const rows = await ctx.db
          .select({ id: files.id, filename: files.filename, contentType: files.contentType, sizeBytes: files.sizeBytes })
          .from(files)
          .where(and(systemScope(), isNull(files.deletedAt), eq(files.status, "ready"), sql`${files.id} = ANY(${`{${ok.join(",")}}`}::uuid[])`));
        return rows.map((r) => ({ id: r.id, filename: r.filename, content_type: r.contentType, size_bytes: r.sizeBytes }));
      },
    }),

    defineQuery({
      name: "datahub.attachment.download_url",
      summary: "Link tải một file đang nằm trong ô Đính kèm của bảng (có hạn, mặc định 5 phút).",
      description: "Người xem bảng tải được file đang gắn vào dòng của bảng đó, dù file do người khác tải lên.",
      permission: "datahub:datahub:use",
      aiAllowed: true,
      audit: "always",
      input: z.object({ table_id: Id, file_id: Id }),
      output: z.object({ url: z.string(), expires_at: z.string(), filename: z.string() }),
      http: { method: "GET", path: "/tables/:table_id/attachments/:file_id/download-url" },
      handler: async (ctx, i) => {
        const acc = await loadTableAccess(ctx, i.table_id);
        const fileId = i.file_id.toLowerCase();
        if (!(await attached(ctx.db, acc, [fileId])).has(fileId)) throw new AppError("not_found", "Không tìm thấy file trong bảng này.");
        const [row] = await ctx.db.select().from(files).where(and(systemScope(), eq(files.id, fileId), isNull(files.deletedAt), eq(files.status, "ready"))).limit(1);
        if (!row) throw new AppError("not_found", "Không tìm thấy file.");
        const d = await storage.createDownloadUrl({ key: row.storageKey, filename: row.filename, contentType: row.contentType, ttlSeconds: cfg.DOWNLOAD_URL_TTL_SECONDS });
        ctx.audit({ type: "file", id: row.id, details: { filename: row.filename, table_id: acc.tableId } });
        return { url: d.url, expires_at: d.expiresAt.toISOString(), filename: row.filename };
      },
    }),
  ];
}
