import { sql } from "drizzle-orm";
import { AppError, type Actor } from "@soe/shared";
import type { HandlerCtx } from "../../core/types";
import { loadTableAccess } from "../datahub/access";
import { setShare } from "../datahub/collab";
import { updateColumn } from "../datahub/columns";
import { setShareOptions } from "../datahub/split-ops";
import { TableSchema } from "../datahub/table-schema";
import { FILLER_COLUMN_DEFAULT, type PlanRow } from "./shared";

type Ctx = Pick<HandlerCtx, "db" | "actor" | "emit" | "audit" | "requestId">;

interface FormUse {
  formId: string;
  ownerId: string;
  tableId: string | null;
  access: string;
  share: boolean;
  fillerColumn: string;
  leaderColumns: string[];
}

/** Forms attached to the items of a plan, with what to do to their tables. One entry per form (the same form may serve many items). */
async function formsOf(ctx: Ctx, plan: PlanRow): Promise<FormUse[]> {
  const rows = (await ctx.db.execute(sql`/*scope:system*/ SELECT i.form_id, i.share_table, i.filler_column, i.leader_columns, f.owner_id, f.table_id, f.access
    FROM onb_items i JOIN forms f ON f.id = i.form_id AND f.deleted_at IS NULL WHERE i.plan_id = ${plan.id}::uuid AND i.form_id IS NOT NULL`)).rows as Record<string, unknown>[];
  const by = new Map<string, FormUse>();
  for (const r of rows) {
    const id = r.form_id as string;
    const u = by.get(id) ?? { formId: id, ownerId: r.owner_id as string, tableId: (r.table_id as string | null) ?? null, access: r.access as string, share: false, fillerColumn: FILLER_COLUMN_DEFAULT, leaderColumns: [] };
    if (r.share_table) {
      u.share = true;
      if (r.filler_column) u.fillerColumn = r.filler_column as string;
      u.leaderColumns = [...new Set([...u.leaderColumns, ...((r.leader_columns as string[] | null) ?? [])])];
    }
    by.set(id, u);
  }
  return [...by.values()];
}

export const ownerOf = <T extends { actor: Actor }>(ctx: T, ownerId: string): T => ({ ...ctx, actor: { userId: ownerId, via: "web", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: null } as Actor });

/**
 * What assigning a plan gives the person (design module9 2), done as the owner of each form with the Datahub commands themselves:
 * the person joins the audience of every form of the plan; for a form marked "share the table", the table is shared with the Sửa permission,
 * the split lock follows the filler column (the person sees only their own rows) and the columns of the leader stay closed to them.
 * `down` (stop, end): the table goes back to Xem and the person leaves the audience.
 */
export async function applyGrants(ctx: Ctx, plan: PlanRow, staffId: string, mode: "up" | "down"): Promise<void> {
  for (const f of await formsOf(ctx, plan)) {
    const o = ownerOf(ctx, f.ownerId);
    if (f.access === "selected") {
      await ctx.db.execute(sql`/*scope:system*/ UPDATE forms SET audience = jsonb_set(audience, '{user_ids}', (
          SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(audience->'user_ids', '[]'::jsonb)) x WHERE x <> ${staffId}) ${mode === "up" ? sql`|| to_jsonb(${staffId}::text)` : sql``}, true),
        version = version + 1, updated_at = now() WHERE id = ${f.formId}::uuid`);
    }
    if (!f.share || !f.tableId || staffId === f.ownerId) continue;
    const acc = await loadTableAccess(o, f.tableId, "owner");
    if (mode === "up") {
      const schema = await TableSchema.load(ctx.db, acc);
      const filler = schema.tryResolve(f.fillerColumn);
      if (!filler || filler.deletedAt || filler.type !== "user") {
        throw new AppError("validation_error", `Bảng của form chưa có cột Người dùng "${f.fillerColumn}" để khoá phân chia: thêm câu ẩn "Người điền" vào form.`, { reason: "filler_column_missing", column: f.fillerColumn });
      }
      const keys = acc.table.split.keys.includes(filler.key) ? acc.table.split.keys : [...acc.table.split.keys, filler.key];
      if (!acc.table.split.enabled || keys.length !== acc.table.split.keys.length) await setShareOptions(o, { table_id: f.tableId, key_split: true, key_columns: keys });
      for (const name of f.leaderColumns) {
        const col = schema.tryResolve(name);
        if (col && !col.deletedAt && col.allowEdit) await updateColumn(o, acc, col, { allow_edit: false });
      }
    }
    await setShare(o, { datahub_id: acc.datahub.id, grantee_id: staffId, table_id: f.tableId, permission: mode === "up" ? "edit_data" : "view" });
  }
}
