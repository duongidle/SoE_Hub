import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, ROLES, USER_STATUSES } from "@soe/shared";
import { orgMemberships, users, type Executor, type UserRow } from "@soe/db";

export const UserOut = z.object({
  id: z.uuid(),
  kind: z.enum(["person", "service", "system"]),
  email: z.string().nullable(),
  full_name: z.string(),
  title: z.string().nullable(),
  phone: z.string().nullable(),
  roles: z.array(z.enum(ROLES)),
  guest_preset: z.enum(["sale", "data"]).nullable(),
  status: z.enum(USER_STATUSES),
  manager_id: z.uuid().nullable(),
  leader_id: z.uuid().nullable(),
  last_login_at: z.date().or(z.string()).nullable(),
  activated_at: z.date().or(z.string()).nullable(),
  created_at: z.date().or(z.string()),
  version: z.number().int(),
});
export type UserView = z.infer<typeof UserOut>;

export function toUserView(u: UserRow, m: { managerId: string; leaderId: string | null } | null | undefined): UserView {
  return {
    id: u.id,
    kind: u.kind as UserView["kind"],
    email: u.email,
    full_name: u.fullName,
    title: u.title,
    phone: u.phone,
    roles: u.roles as UserView["roles"],
    guest_preset: (u.guestPreset as UserView["guest_preset"]) ?? null,
    status: u.status as UserView["status"],
    manager_id: m?.managerId ?? null,
    leader_id: m?.leaderId ?? null,
    last_login_at: u.lastLoginAt,
    activated_at: u.activatedAt,
    created_at: u.createdAt,
    version: u.version,
  };
}

export async function currentMembership(ex: Executor, userId: string) {
  const [m] = await ex
    .select()
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, userId), isNull(orgMemberships.validTo)))
    .limit(1);
  return m ?? null;
}

export async function getUserView(ex: Executor, id: string): Promise<UserView | null> {
  const [u] = await ex.select().from(users).where(eq(users.id, id)).limit(1);
  if (!u) return null;
  return toUserView(u, await currentMembership(ex, id));
}

export async function getPerson(ex: Executor, id: string, lock = false): Promise<UserRow> {
  const q = ex.select().from(users).where(and(eq(users.id, id), eq(users.kind, "person"))).limit(1);
  const [u] = lock ? await q.for("update") : await q;
  if (!u) throw new AppError("not_found", "Không tìm thấy người này trong org chart.");
  return u;
}

export async function findPersonByEmail(ex: Executor, email: string): Promise<UserRow | null> {
  const [u] = await ex.select().from(users).where(and(eq(users.email, email), eq(users.kind, "person"))).limit(1);
  return u ?? null;
}

export async function namesOf(ex: Executor, ids: string[]): Promise<Map<string, { full_name: string; email: string | null }>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const rows = await ex.select({ id: users.id, fullName: users.fullName, email: users.email }).from(users).where(inArray(users.id, uniq));
  return new Map(rows.map((r) => [r.id, { full_name: r.fullName, email: r.email }]));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Email không hợp lệ.").max(254));

/** The domain part must be in the allowed list (setting auth.allowed_domains). */
export function assertAllowedDomain(email: string, allowed: string[]): void {
  const domain = email.split("@")[1] ?? "";
  if (!allowed.includes(domain)) {
    throw new AppError("forbidden", `Chỉ email thuộc ${allowed.map((d) => `@${d}`).join(", ")} được dùng.`, { allowed_domains: allowed });
  }
}

export const nowSql = sql`now()`;
