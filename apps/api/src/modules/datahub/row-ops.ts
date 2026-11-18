import { z } from "zod";
import { DH_BATCH_MAX, filterParam, MAX_PAGE_LIMIT } from "@soe/shared";
import { defineCommand, defineQuery } from "../../core/registry";
import type { ListOutput } from "../../core/types";
import { loadTableAccess } from "./access";
import { applyRowOps, restoreRows, type RowOp } from "./rows";
import { getRow, listRows, rowHistory } from "./rows-read";
import { Id, ROW_EVENTS, Ts } from "./shared";
import { TableSchema } from "./table-schema";

const Cells = z.record(z.string(), z.unknown()).describe("Giá trị theo cột: khoá là mã cột hoặc tên cột. Giá trị rỗng/null xoá ô.");
const Labels = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true")
  .describe("true = trả tên lựa chọn thay vì mã lựa chọn.");

const RowOut = z.object({
  id: Id,
  row_no: z.number().int().optional(),
  version: z.number().int().optional(),
  created_at: Ts.optional(),
  created_by: z.uuid().nullable().optional(),
  updated_at: Ts.optional(),
  updated_by: z.uuid().nullable().optional(),
  data: z.record(z.string(), z.unknown()),
});

const BatchOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), data: Cells }),
  z.object({ op: z.literal("update"), id: Id, data: Cells, base: Cells.optional(), version: z.number().int().min(1).optional() }),
  z.object({ op: z.literal("delete"), id: Id, version: z.number().int().min(1).optional() }),
  z.object({ op: z.literal("upsert"), key: z.string().min(1).max(100), data: Cells }),
]);

const OpResultOut = z.object({ op: z.string(), outcome: z.enum(["created", "updated", "unchanged", "deleted"]), id: Id, row: RowOut.nullable() });

const writeDoc = "Sửa dòng gửi `base` (giá trị các ô bạn đã đọc): chỉ khi CÙNG một ô đã bị người khác sửa mới trả 409 `conflict` kèm giá trị hiện tại; sửa hai ô khác nhau của một dòng thì server gộp. Không có `base` thì bắt buộc gửi `version`.";

export const rowOperations = [
  defineQuery({
    name: "datahub.row.list",
    summary: "Danh sách dòng: lọc, sắp xếp nhiều cấp, tìm kiếm, chọn cột, phân trang keyset.",
    description:
      "`filter`: cú pháp lọc chung, cột gọi bằng mã hoặc tên (trường chuẩn: `_row_no`, `_created_at`, `_updated_at`, `_created_by`, `_updated_by`, `_id`, `_version`). " +
      "`sort`: JSON `[{\"field\":\"Mức ưu tiên\",\"dir\":\"asc\",\"nulls\":\"last\"}]` hoặc `cột:asc:last,...`; cột Một lựa chọn sắp theo thứ tự lựa chọn. " +
      "`fields`: các cột trả về. `search`: tìm trong mọi ô chữ. `include_total=true` mới đếm tổng.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    list: true,
    input: z.object({
      table_id: Id,
      filter: filterParam,
      sort: z.string().max(2000).optional(),
      fields: z.string().max(2000).optional(),
      search: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(50),
      cursor: z.string().max(2000).optional(),
      include_total: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
      labels: Labels,
    }),
    output: RowOut,
    http: { method: "GET", path: "/tables/:table_id/rows" },
    handler: async (ctx, i): Promise<ListOutput> => {
      const acc = await loadTableAccess(ctx, i.table_id);
      const schema = await TableSchema.load(ctx.db, acc);
      return listRows(ctx.db, acc, schema, { filter: i.filter, sort: i.sort, fields: i.fields, search: i.search, limit: i.limit, cursor: i.cursor, includeTotal: i.include_total, labels: i.labels });
    },
  }),

  defineQuery({
    name: "datahub.row.get",
    summary: "Một dòng.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ table_id: Id, row_id: Id, fields: z.string().max(2000).optional(), labels: Labels }),
    output: RowOut,
    http: { method: "GET", path: "/tables/:table_id/rows/:row_id" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id);
      return getRow(ctx.db, acc, await TableSchema.load(ctx.db, acc), i.row_id, { fields: i.fields, labels: i.labels });
    },
  }),

  defineCommand({
    name: "datahub.row.create",
    summary: "Tạo một dòng. Cần quyền Sửa dữ liệu.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z.object({ table_id: Id, data: Cells.default({}), labels: Labels }),
    output: RowOut,
    http: { method: "POST", path: "/tables/:table_id/rows", status: 201 },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "edit_data");
      const schema = await TableSchema.load(ctx.db, acc);
      const [r] = await applyRowOps(ctx, acc, schema, [{ op: "create", data: i.data }], { labels: i.labels });
      return r!.row!;
    },
  }),

  defineCommand({
    name: "datahub.row.update",
    summary: "Sửa một dòng, gộp theo từng ô.",
    description: writeDoc,
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z.object({ table_id: Id, row_id: Id, data: Cells, base: Cells.optional(), version: z.number().int().min(1).optional(), labels: Labels }),
    output: RowOut,
    http: { method: "PATCH", path: "/tables/:table_id/rows/:row_id" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "edit_data");
      const schema = await TableSchema.load(ctx.db, acc);
      const [r] = await applyRowOps(ctx, acc, schema, [{ op: "update", id: i.row_id, data: i.data, base: i.base, version: i.version }], { labels: i.labels });
      return r!.row!;
    },
  }),

  defineCommand({
    name: "datahub.row.delete",
    summary: "Xoá một dòng vào thùng rác (khôi phục trong 7 ngày).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z.object({ table_id: Id, row_id: Id, version: z.coerce.number().int().min(1).optional() }),
    output: z.object({ id: Id, deleted: z.literal(true) }),
    http: { method: "DELETE", path: "/tables/:table_id/rows/:row_id" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "edit_data");
      const schema = await TableSchema.load(ctx.db, acc);
      await applyRowOps(ctx, acc, schema, [{ op: "delete", id: i.row_id, version: i.version }]);
      return { id: i.row_id, deleted: true as const };
    },
  }),

  defineCommand({
    name: "datahub.row.upsert",
    summary: "Tạo hoặc sửa một dòng theo cột khoá (cột phải có thuộc tính duy nhất).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z.object({ table_id: Id, key: z.string().min(1).max(100).describe("Mã hoặc tên cột khoá."), data: Cells, labels: Labels }),
    output: z.object({ outcome: z.enum(["created", "updated", "unchanged", "deleted"]), row: RowOut }),
    http: { method: "POST", path: "/tables/:table_id/rows/upsert" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "edit_data");
      const schema = await TableSchema.load(ctx.db, acc);
      const [r] = await applyRowOps(ctx, acc, schema, [{ op: "upsert", key: i.key, data: i.data }], { labels: i.labels });
      return { outcome: r!.outcome, row: r!.row! };
    },
  }),

  defineCommand({
    name: "datahub.row.batch",
    summary: `Nhiều thao tác trong MỘT giao dịch (tối đa ${DH_BATCH_MAX}): create, update, delete, upsert. Một thao tác lỗi thì cả lô không ghi.`,
    description: writeDoc,
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z.object({ table_id: Id, ops: z.array(BatchOp).min(1).max(DH_BATCH_MAX), labels: Labels }),
    output: z.object({ results: z.array(OpResultOut) }),
    http: { method: "POST", path: "/tables/:table_id/rows/batch" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "edit_data");
      const schema = await TableSchema.load(ctx.db, acc);
      return { results: await applyRowOps(ctx, acc, schema, i.ops as RowOp[], { labels: i.labels }) };
    },
  }),

  defineCommand({
    name: "datahub.row.restore",
    summary: "Khôi phục dòng từ thùng rác.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z.object({ table_id: Id, row_id: Id }),
    output: RowOut,
    http: { method: "POST", path: "/tables/:table_id/rows/:row_id/restore" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "edit_data");
      const schema = await TableSchema.load(ctx.db, acc);
      const [row] = await restoreRows(ctx, acc, schema, [i.row_id]);
      return row!;
    },
  }),

  defineQuery({
    name: "datahub.row.history",
    summary: "Lịch sử thay đổi của một dòng (mới nhất trước): ai, lúc nào, qua kênh nào, cũ → mới.",
    description: "Chỉ chứa dữ liệu do người, API, form nhập vào; thay đổi do công thức tính lại không có ở đây.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ table_id: Id, row_id: Id, limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(20).optional() }),
    output: z.object({
      items: z.array(z.object({ version: z.number().int(), op: z.string(), at: Ts, actor: z.unknown(), changes: z.array(z.object({ field: z.string(), field_name: z.string().nullable(), old: z.unknown(), new: z.unknown() })) })),
      next_cursor: z.string().nullable(),
    }),
    http: { method: "GET", path: "/tables/:table_id/rows/:row_id/history" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id);
      const schema = await TableSchema.load(ctx.db, acc);
      const r = await rowHistory(ctx.db, acc, schema, i.row_id, { limit: i.limit, before: i.cursor ? Number(i.cursor) : undefined });
      return { items: r.items, next_cursor: r.nextCursor };
    },
  }),
];
