import { z } from "zod";
import type { EventDef } from "../../core/events";

export const systemEvents: EventDef[] = [
  {
    name: "system.setting.changed",
    version: 1,
    description: "Một cài đặt hệ thống được tạo hoặc sửa.",
    schema: z.object({ key: z.string(), version: z.number().int() }),
  },
  {
    name: "file.file.uploaded",
    version: 1,
    description: "Một file đã tải lên xong và được xác nhận.",
    schema: z.object({ file_id: z.uuid(), size_bytes: z.number().int() }),
  },
  {
    name: "file.file.deleted",
    version: 1,
    description: "Một file bị chuyển vào thùng rác.",
    schema: z.object({ file_id: z.uuid() }),
  },
];
