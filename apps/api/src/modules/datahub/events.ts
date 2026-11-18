import { z } from "zod";
import type { EventDef } from "../../core/events";
import { datahubAudience, tableAudience } from "./access";

/**
 * Datahub events (design module2 sections 6.5, 7, 13). Signals go only to people who can see the table (owner and
 * people it is shared with). They carry ids, never values: clients reload through authorised queries.
 */
const rowPayload = z.object({
  table_id: z.uuid(),
  row_ids: z.array(z.uuid()).max(500),
  /** Keys of the columns whose values changed (lets Stage 2B recalculate only what depends on them). */
  columns: z.array(z.string()),
});

const rowEvent = (name: string, description: string): EventDef => ({
  name,
  version: 1,
  description,
  schema: rowPayload,
  audience: async (p: { table_id: string }, db) => ({ users: await tableAudience(db, p.table_id) }),
});

export const datahubEvents: EventDef[] = [
  rowEvent("datahub.row.created", "Dòng mới được tạo trong một bảng datahub."),
  rowEvent("datahub.row.updated", "Dòng của một bảng datahub được sửa."),
  rowEvent("datahub.row.deleted", "Dòng của một bảng datahub bị chuyển vào thùng rác."),
  rowEvent("datahub.row.restored", "Dòng được khôi phục từ thùng rác."),
  {
    name: "datahub.structure.changed",
    version: 1,
    description: "Cấu trúc đổi: datahub, bảng, cột (thêm, sửa, xoá, khôi phục, đổi chủ). Worker dựng lại view SQL xuất.",
    schema: z.object({
      datahub_id: z.uuid(),
      table_id: z.uuid().nullable(),
      change: z.enum(["datahub_created", "datahub_updated", "datahub_deleted", "datahub_restored", "owner_changed", "table_created", "table_updated", "table_deleted", "table_restored", "column_created", "column_updated", "column_deleted", "column_restored", "column_type_changed"]),
    }),
    audience: async (p: { datahub_id: string; table_id: string | null }, db) => ({ users: p.table_id ? await tableAudience(db, p.table_id) : await datahubAudience(db, p.datahub_id) }),
  },
  {
    name: "datahub.share.changed",
    version: 1,
    description: "Chia sẻ datahub hoặc bảng được thêm, đổi quyền hoặc gỡ.",
    schema: z.object({ datahub_id: z.uuid(), table_id: z.uuid().nullable(), grantee_id: z.uuid() }),
    audience: async (p: { datahub_id: string; grantee_id: string }, db) => ({ users: [...new Set([p.grantee_id, ...(await datahubAudience(db, p.datahub_id))])] }),
  },
];
