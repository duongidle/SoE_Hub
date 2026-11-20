import { AppError, isAppError } from "@soe/shared";
import type { HandlerCtx } from "../../core/types";
import { loadTableAccess, type TableAccess } from "./access";
import { ownerOfTable } from "./reader-scope";

type Ctx = Pick<HandlerCtx, "db" | "actor">;

/**
 * Where a Relation cell may point (design module4 1.1, 19 work 9): a table of the same owner, or a TEMPLATE table the owner can read (for
 * example the shared Deals of their Manager). The first needs no check beyond the owner; the second gives the access of the OWNER of the
 * linking table, so which rows can be linked and which labels show are exactly the rows that person sees (split lock included).
 * Lookup, Rollup and formulas into a template table of someone else stay unsupported here (they need per-reader recalculation of the owner's own table).
 */
export type LinkTarget = { own: true } | { own: false; acc: TableAccess };

export async function resolveLinkTarget(ctx: Ctx, sourceOwnerId: string, targetId: string): Promise<LinkTarget | null> {
  const owner = await ownerOfTable(ctx.db, targetId);
  if (!owner) return null;
  if (owner === sourceOwnerId) return { own: true };
  try {
    const acc = await loadTableAccess({ db: ctx.db, actor: { ...ctx.actor, userId: sourceOwnerId } }, targetId);
    return acc.table.templateId ? { own: false, acc } : null;
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") return null;
    throw e;
  }
}

export const notLinkable = () => new AppError("validation_error", "Bảng liên kết phải là bảng của bạn hoặc bảng template bạn đọc được (bảng người khác chia sẻ không dùng được).", { code: "#PERM!" });
