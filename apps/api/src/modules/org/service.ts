import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { AppError, type Role } from "@soe/shared";
import { orgMemberships, users, type Executor, type UserRow } from "@soe/db";
import { currentMembership } from "./view";

export interface Placement {
  managerId: string | null;
  leaderId: string | null;
}

/** Roles must be a valid combination (design module1 section 2.4). */
export function assertRoleSet(roles: Role[], guestPreset: string | null | undefined): void {
  if (roles.length === 0) throw new AppError("validation_error", "Phải có ít nhất một vai trò.");
  if (roles.includes("guest") && roles.length > 1) throw new AppError("validation_error", "Guest không kết hợp với vai trò khác.");
  if (roles.includes("guest") && !guestPreset) throw new AppError("validation_error", "Guest phải chọn mẫu Sale hoặc Data.");
  if (!roles.includes("guest") && guestPreset) throw new AppError("validation_error", "Chỉ Guest mới có mẫu Guest.");
}

/** Where a person with these roles must sit (design module1 section 2.3). Throws when the placement is invalid. */
export async function validatePlacement(ex: Executor, userId: string, roles: Role[], p: Placement): Promise<Placement> {
  const has = (r: Role) => roles.includes(r);
  if (has("manager")) {
    // A manager is the root of their own tree.
    if (p.managerId && p.managerId !== userId) throw new AppError("validation_error", "Manager là gốc của cây của chính mình, không thuộc cây khác.");
    return { managerId: userId, leaderId: null };
  }
  if (!p.managerId) {
    if (has("leader") || has("user")) throw new AppError("validation_error", "Leader và User phải thuộc cây của một Manager.");
    if (p.leaderId) throw new AppError("validation_error", "Chọn Manager trước khi chọn cấp trên trực tiếp.");
    return { managerId: null, leaderId: null };
  }
  const [mgr] = await ex.select().from(users).where(eq(users.id, p.managerId)).limit(1);
  const mgrRow = mgr ? await currentMembership(ex, mgr.id) : null;
  if (!mgr || mgr.kind !== "person" || !mgr.roles.includes("manager") || mgrRow?.managerId !== mgr.id) {
    throw new AppError("validation_error", "Người được chọn làm Manager không phải Manager.");
  }
  if (mgr.status === "locked") throw new AppError("validation_error", "Manager này đã bị khoá.");
  if (has("leader")) {
    if (p.leaderId) throw new AppError("validation_error", "Leader thuộc thẳng Manager, không có cấp trên là Leader khác.");
    return { managerId: p.managerId, leaderId: null };
  }
  if (p.leaderId) {
    if (p.leaderId === userId) throw new AppError("validation_error", "Không thể là cấp trên của chính mình.");
    const [ldr] = await ex.select().from(users).where(eq(users.id, p.leaderId)).limit(1);
    const ldrRow = ldr ? await currentMembership(ex, ldr.id) : null;
    if (!ldr || !ldr.roles.includes("leader") || ldrRow?.managerId !== p.managerId) {
      throw new AppError("validation_error", "Cấp trên trực tiếp phải là một Leader trong cùng cây.");
    }
  }
  return { managerId: p.managerId, leaderId: p.leaderId };
}

/** Number of people whose current direct leader / tree manager is `userId` (other than themselves). */
export async function countReports(ex: Executor, userId: string): Promise<{ team: number; tree: number }> {
  const [team] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.leaderId, userId), isNull(orgMemberships.validTo)));
  const [tree] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.managerId, userId), ne(orgMemberships.userId, userId), isNull(orgMemberships.validTo)));
  return { team: team?.n ?? 0, tree: tree?.n ?? 0 };
}

/**
 * Before a leader/manager loses that role or moves: their people must be moved first, so nobody is left with a
 * leader that is not a leader (and history stays meaningful).
 */
export async function assertNoOrphans(ex: Executor, u: UserRow, nextRoles: Role[], next: Placement): Promise<void> {
  const cur = await currentMembership(ex, u.id);
  const { team, tree } = await countReports(ex, u.id);
  const wasLeader = u.roles.includes("leader");
  const wasManager = u.roles.includes("manager");
  if (wasLeader && team > 0 && (!nextRoles.includes("leader") || (cur?.managerId ?? null) !== next.managerId)) {
    throw new AppError("validation_error", `Leader này còn ${team} người trong team. Chuyển họ sang cấp trên khác trước.`, { team_members: team });
  }
  if (wasManager && tree > 0 && !nextRoles.includes("manager")) {
    throw new AppError("validation_error", `Manager này còn ${tree} người trong cây. Chuyển cây sang Manager khác trước.`, { tree_members: tree });
  }
}

/**
 * Writes the current place of a person, keeping history (design module1 section 2.3): the open row is closed
 * (`valid_to = now`) and a new row starts. No change -> nothing written. Returns true when something changed.
 */
export async function writePlacement(ex: Executor, userId: string, p: Placement, by: string): Promise<boolean> {
  const cur = await currentMembership(ex, userId);
  if ((cur?.managerId ?? null) === p.managerId && (cur?.leaderId ?? null) === p.leaderId) return false;
  // Same instant for close and open, so the history has no gap and no overlap.
  const [{ now: raw }] = (await ex.execute(sql`SELECT now()::text AS now`)).rows as [{ now: string }];
  const now = new Date(raw);
  if (cur) await ex.update(orgMemberships).set({ validTo: now }).where(eq(orgMemberships.id, cur.id));
  if (p.managerId) {
    await ex.insert(orgMemberships).values({ userId, managerId: p.managerId, leaderId: p.leaderId, validFrom: now, createdBy: by });
  }
  return true;
}

/**
 * After someone's permissions shrink (role change, supplementary permission revoked): a personal token is a connection with menus
 * (module5), not a list of permissions, so there is nothing to narrow. The owner's current permissions are intersected with the
 * connection's menus at every call (`core/ai-gate.ts`), and a locked owner loses the connection (`revokeUserTokens`).
 * Kept so callers still report `tokens` in the audit row.
 */
export async function reconcileUserTokens(_ex: Executor, _userId: string, _by: string): Promise<{ narrowed: number; revoked: number }> {
  return { narrowed: 0, revoked: 0 };
}
