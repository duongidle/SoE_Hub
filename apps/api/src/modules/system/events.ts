import { and } from "drizzle-orm";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { files, type Db } from "@soe/db";
import { systemScope } from "../../auth/access";
import type { EventDef } from "../../core/events";

async function fileOwner(db: Db, fileId: string) {
  const [f] = await db.select({ ownerId: files.ownerId }).from(files).where(and(systemScope(), eq(files.id, fileId))).limit(1);
  return { users: f?.ownerId ? [f.ownerId] : [] };
}

export const systemEvents: EventDef[] = [
  {
    name: "system.setting.changed",
    version: 1,
    description: "Một cài đặt hệ thống được tạo hoặc sửa.",
    schema: z.object({ key: z.string(), version: z.number().int() }),
    audience: () => ({ permission: "system:setting:read" }),
  },
  {
    name: "file.file.uploaded",
    version: 1,
    description: "Một file đã tải lên xong và được xác nhận.",
    schema: z.object({ file_id: z.uuid(), size_bytes: z.number().int() }),
    audience: (p: { file_id: string }, db) => fileOwner(db, p.file_id),
  },
  {
    name: "file.file.deleted",
    version: 1,
    description: "Một file bị chuyển vào thùng rác.",
    schema: z.object({ file_id: z.uuid() }),
    audience: (p: { file_id: string }, db) => fileOwner(db, p.file_id),
  },
];
