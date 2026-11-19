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
  /** Change sequence of the write (design module2 section 6.7). */
  seq: z.number().int().optional(),
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
    name: "datahub.formula.recalculated",
    version: 1,
    description: "Cột công thức, lookup hoặc rollup đang chờ tính (pending), có ô đổi giá trị (changed, kèm danh sách dòng, cột, giá trị cũ → mới, tối đa 500 dòng mỗi sự kiện) hoặc đã tính xong (done). Là sự kiện cho bên nghe (SSE, Automation, cột phụ thuộc), không phải lịch sử dòng.",
    schema: z.object({
      table_id: z.uuid(),
      /** Keys of the computed columns. */
      columns: z.array(z.string()),
      /** `pending` (column waiting), `changed` (a batch of cells changed: `changes`), `done` (the column is finished: `changed_rows` in all). */
      state: z.enum(["pending", "changed", "done"]),
      /** Rows whose stored value changed: in a `changed` event the rows of that event (at most 500), in `done` the total. */
      changed_rows: z.number().int(),
      /** At most 500 cells per event; a computed column that changed more is announced by several events. Error values are `{error: "#DIV/0!"}`. */
      changes: z.array(z.object({ row_id: z.uuid(), column: z.string(), old: z.unknown(), new: z.unknown() })).max(500),
      /** Change sequence the column has incorporated up to (design module2 section 6.7). */
      seq: z.number().int().nullable().optional(),
    }),
    audience: async (p: { table_id: string }, db) => ({ users: await tableAudience(db, p.table_id) }),
  },
  {
    name: "datahub.reconcile.mismatch",
    version: 1,
    description: "Job đối soát hằng đêm thấy ô công thức khác kết quả tính lại cả cột (bug của tính theo phần). Chỉ để tạo thông báo cho Admin; không có SSE, không chứa giá trị.",
    schema: z.object({
      at: z.string(),
      cells: z.number().int(),
      checked_columns: z.number().int(),
      columns: z.array(z.object({ table_id: z.uuid(), column_key: z.string(), column_name: z.string(), cells: z.number().int() })),
      recipient_ids: z.array(z.uuid()),
    }),
  },
  {
    name: "datahub.merge.synced",
    version: 1,
    description: "Bảng gộp vừa đồng bộ xong (ok) hoặc báo lỗi nguồn (error), kèm số dòng thêm/sửa/xoá. Chỉ mang mã và số, không mang giá trị.",
    schema: z.object({ table_id: z.uuid(), status: z.enum(["ok", "error"]), created: z.number().int(), updated: z.number().int(), deleted: z.number().int() }),
    audience: async (p: { table_id: string }, db) => ({ users: await tableAudience(db, p.table_id) }),
  },
  {
    name: "datahub.share.changed",
    version: 1,
    description: "Chia sẻ datahub hoặc bảng được thêm, đổi quyền hoặc gỡ.",
    schema: z.object({ datahub_id: z.uuid(), table_id: z.uuid().nullable(), grantee_id: z.uuid() }),
    audience: async (p: { datahub_id: string; grantee_id: string }, db) => ({ users: [...new Set([p.grantee_id, ...(await datahubAudience(db, p.datahub_id))])] }),
  },
];
