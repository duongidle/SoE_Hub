import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@soe/shared";
import type { Executor } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import { loadDatahubAccess, loadTableAccess } from "./access";
import { DH_REASON } from "./errors";
import { emitStructure, Id } from "./shared";
import { TableSchema } from "./table-schema";
import { assertColumnKey } from "./types";
import { tableOut, TableOut } from "./structure";

/** Most key columns of the split lock (design module2 section 10). */
export const MAX_KEY_COLUMNS = 5;

/**
 * Settings of the split lock and of shared editing of one table (design module2 section 10): the lock on/off, its key columns (1-5 columns
 * of type Người dùng) and the main key column, and "Thành viên được thêm dòng hàng loạt". Only the owner. Per-column "Cho phép sửa" is a column
 * property (`datahub.column.update`). The Deals dialogs of Stage 4.1d and the template page of Stage 4 call this one command.
 */
export const splitOperations = [
  defineCommand({
    name: "datahub.table.share_options.set",
    summary: "Đặt khoá phân chia (bật/tắt, cột khoá, cột khoá chính) và tuỳ chọn \"Thành viên được thêm dòng hàng loạt\" của bảng (chỉ chủ).",
    description:
      "Khoá phân chia bật: thành viên không phải chủ chỉ thấy dòng có tên mình hoặc người mình quản lý (cây tổ chức hiện tại) ở một trong các cột khoá; chủ thấy mọi dòng. " +
      "`key_columns`: 1–5 cột kiểu Người dùng (mã hoặc tên), thay cả danh sách. `key_primary`: một trong các cột khoá, điền tên người thêm khi thành viên thêm dòng (mặc định cột đầu). " +
      "Tắt khoá thì giữ cấu hình cột khoá để bật lại. Cột khoá không đổi kiểu, không xoá khi còn là khoá.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: ["datahub.structure.changed"],
    input: z.object({
      table_id: Id,
      key_split: z.boolean().optional(),
      key_columns: z.array(z.string().min(1).max(100)).max(MAX_KEY_COLUMNS).optional(),
      key_primary: z.string().min(1).max(100).nullable().optional(),
      members_bulk_create: z.boolean().optional(),
    }),
    output: TableOut,
    http: { method: "PUT", path: "/tables/:table_id/share-options" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "owner");
      if (acc.table.kind === "merged") throw new AppError("forbidden", "Bảng gộp không có khoá phân chia.", { reason: "merged_table_read_only" });
      const schema = await TableSchema.load(ctx.db, acc);
      const cur = acc.table.split;
      let keys = cur.keys;
      if (i.key_columns !== undefined) {
        keys = [];
        for (const ref of i.key_columns) {
          const col = schema.tryResolve(ref);
          if (!col || col.deletedAt) throw new AppError("validation_error", `Không tìm thấy cột "${ref}".`, { reason: DH_REASON.keyColumn });
          if (col.type !== "user") throw new AppError("validation_error", `Cột khoá phải là kiểu Người dùng; cột "${col.name}" không phải.`, { reason: DH_REASON.keyColumn, column: col.name });
          if (!keys.includes(col.key)) keys.push(col.key);
        }
      }
      let primary: string | null = cur.primary;
      if (i.key_primary !== undefined) {
        if (i.key_primary === null) primary = null;
        else {
          const col = schema.tryResolve(i.key_primary);
          if (!col || !keys.includes(col.key)) throw new AppError("validation_error", "Cột khoá chính phải là một trong các cột khoá.", { reason: DH_REASON.keyColumn });
          primary = col.key;
        }
      }
      if (primary && !keys.includes(primary)) primary = null;
      if (!primary && keys.length > 0) primary = keys[0]!;
      const enabled = i.key_split ?? cur.enabled;
      if (enabled && keys.length === 0) throw new AppError("validation_error", "Bật khoá phân chia cần ít nhất một cột khoá kiểu Người dùng.", { reason: DH_REASON.keyColumn });
      await ctx.db.execute(sql`UPDATE dh_tables SET key_split = ${enabled}, key_columns = ${`{${keys.join(",")}}`}::text[], key_primary = ${primary},
        members_bulk_create = ${i.members_bulk_create ?? acc.table.membersBulkCreate}, version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE /*scope*/ id = ${acc.tableId}::uuid`);
      // One index for each key column (the filter is an OR over them); an index nobody else asked for goes when its column stops being a key.
      for (const k of keys) await ctx.db.execute(sql`SELECT soe_dh_ensure_index(${acc.tableId}::uuid, ${assertColumnKey(k)}, 'uuid')`);
      for (const k of cur.keys.filter((x) => !keys.includes(x))) {
        const asked = await ctx.db.execute(sql`SELECT 1 FROM dh_index_requests WHERE /*scope*/ table_id = ${acc.tableId}::uuid AND column_key = ${k} AND kind = 'uuid'`);
        if (asked.rows.length === 0) await ctx.db.execute(sql`SELECT soe_dh_drop_indexes(${acc.tableId}::uuid, ${assertColumnKey(k)}, ARRAY['uuid'])`);
      }
      ctx.audit({ type: "datahub_table", id: acc.tableId, details: { key_split: enabled, key_columns: keys.length, members_bulk_create: i.members_bulk_create } });
      // Who sees which row changed for every member: caches, merged tables and open screens learn it from this one event.
      await emitStructure(ctx, acc.datahub.id, acc.tableId, "table_updated");
      return tableOut(ctx.db, await loadTableAccess(ctx, acc.tableId));
    },
  }),

  defineQuery({
    name: "datahub.prefs.get",
    summary: "Tuỳ chọn datahub của bạn: \"Cho phép leader sửa\" (Leader của bạn sửa được dòng mang tên bạn ở bảng có khoá phân chia).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({}),
    output: z.object({ leader_can_edit: z.boolean() }),
    http: { method: "GET", path: "/datahub/prefs" },
    handler: async (ctx) => {
      const r = await ctx.db.execute(sql`SELECT leader_can_edit FROM dh_user_prefs WHERE user_id = ${ctx.actor.userId}::uuid`);
      return { leader_can_edit: !!(r.rows[0] as { leader_can_edit: boolean } | undefined)?.leader_can_edit };
    },
  }),

  defineCommand({
    name: "datahub.prefs.set",
    summary: "Bật/tắt \"Cho phép leader sửa deal của tôi\" (module1 mục 4.1). Leader sửa được những cột mà chính bạn sửa được, không hơn.",
    description: "Ô cắm cho màn Quản lý Deal (Stage 4): server đã áp luật khi ghi dòng. Mặc định tắt.",
    permission: "datahub:datahub:use",
    aiAllowed: false,
    input: z.object({ leader_can_edit: z.boolean() }),
    output: z.object({ leader_can_edit: z.boolean() }),
    http: { method: "PUT", path: "/datahub/prefs" },
    handler: async (ctx, i) => {
      await ctx.db.execute(sql`INSERT INTO dh_user_prefs (user_id, leader_can_edit) VALUES (${ctx.actor.userId}::uuid, ${i.leader_can_edit})
        ON CONFLICT (user_id) DO UPDATE SET leader_can_edit = EXCLUDED.leader_can_edit, updated_at = now()`);
      ctx.audit({ type: "datahub_prefs", id: ctx.actor.userId, details: { leader_can_edit: i.leader_can_edit } });
      return { leader_can_edit: i.leader_can_edit };
    },
  }),

  defineQuery({
    name: "datahub.share.tagged",
    summary: "Người này đang được tag ở bao nhiêu dòng (ô Người dùng) trong các bảng của chia sẻ? Dùng để cảnh báo trước khi gỡ thành viên (chỉ chủ).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ datahub_id: Id, share_id: Id }),
    output: z.object({ user_id: Id, rows: z.number().int(), tables: z.array(z.object({ table_id: Id, table_name: z.string(), rows: z.number().int() })) }),
    http: { method: "GET", path: "/datahubs/:datahub_id/shares/:share_id/tagged" },
    handler: async (ctx, i) => {
      const dh = await loadDatahubAccess(ctx, i.datahub_id, "owner");
      const r = await ctx.db.execute(sql`SELECT grantee_id, table_id FROM dh_shares WHERE /*scope*/ id = ${i.share_id}::uuid AND datahub_id = ${dh.id}::uuid`);
      const s = r.rows[0] as { grantee_id: string; table_id: string | null } | undefined;
      if (!s) throw new AppError("not_found", "Không tìm thấy chia sẻ.");
      return { user_id: s.grantee_id, ...(await taggedRows(ctx.db, dh.id, s.table_id, s.grantee_id)) };
    },
  }),
];

/**
 * Live rows that name `userId` in any user column, over the tables a share covers (one table, or every table of the datahub). Used to warn before
 * a member is removed and to tell the person after (design module2 section 10: the tags stay, the cell shows "không còn quyền").
 */
export async function taggedRows(db: Executor, datahubId: string, tableId: string | null, userId: string): Promise<{ rows: number; tables: { table_id: string; table_name: string; rows: number }[] }> {
  const cols = await db.execute(sql`SELECT c.table_id, t.name, c.key FROM dh_columns c JOIN dh_tables t ON t.id = c.table_id
    WHERE /*scope*/ t.datahub_id = ${datahubId}::uuid AND t.deleted_at IS NULL AND c.deleted_at IS NULL AND c.type = 'user' AND (${tableId}::uuid IS NULL OR c.table_id = ${tableId}::uuid)`);
  const byTable = new Map<string, { name: string; keys: string[] }>();
  for (const c of cols.rows as { table_id: string; name: string; key: string }[]) {
    const e = byTable.get(c.table_id) ?? { name: c.name, keys: [] };
    e.keys.push(c.key);
    byTable.set(c.table_id, e);
  }
  const tables: { table_id: string; table_name: string; rows: number }[] = [];
  for (const [id, e] of byTable) {
    const any = sql.join(e.keys.map((k) => sql`data->>${sql.raw(`'${assertColumnKey(k)}'`)} = ${userId}`), sql` OR `);
    const n = await db.execute(sql`SELECT count(*)::int AS n FROM dh_rows WHERE /*scope*/ table_id = ${id}::uuid AND deleted_at IS NULL AND (${any})`);
    const rows = (n.rows[0] as { n: number }).n;
    if (rows > 0) tables.push({ table_id: id, table_name: e.name, rows });
  }
  return { rows: tables.reduce((a, t) => a + t.rows, 0), tables };
}

