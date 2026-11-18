import { and, desc, eq, gt, sql } from "drizzle-orm";
import { AppError, primaryRole, type Role } from "@soe/shared";
import { authCodes, users, type Executor, type UserRow } from "@soe/db";
import { activeUsersWithRole } from "../../auth/access";
import { encrypt, hmac, sixDigitCode } from "../../auth/crypto";
import { currentMembership } from "../org/view";

/** Design module1 section 6.4. */
export const CODE_TTL_HOURS = 6;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_MAX_PER_HOUR = 3;

export type CodePurpose = "activate" | "reset";

export function codeHash(secret: string, codeId: string, code: string): string {
  return hmac(secret, `code:${codeId}:${code}`);
}

/**
 * Who receives the code (design module1 section 6.4), by the requester's highest role:
 * User → direct leader, tree manager, every Admin; Leader → manager, Admins; Manager → Admins;
 * Admin → the other Admins; Guest (also self-registering) → Admins. Only active people; never the requester.
 */
export async function codeRecipients(ex: Executor, requester: UserRow | null): Promise<{ id: string; fullName: string }[]> {
  const admins = await activeUsersWithRole(ex, "admin");
  const out = new Map<string, string>();
  const add = (id: string | null | undefined, name: string) => {
    if (id && id !== requester?.id) out.set(id, name);
  };
  const role: Role | null = requester ? primaryRole(requester.roles) : "guest";
  if (requester && (role === "user" || role === "leader")) {
    const m = await currentMembership(ex, requester.id);
    const ids = [role === "user" ? m?.leaderId : null, m?.managerId].filter((x): x is string => !!x);
    if (ids.length) {
      const people = await ex.select().from(users).where(sql`${users.id} = ANY(${`{${ids.join(",")}}`}::uuid[])`);
      for (const p of people) if (p.status === "active" && p.kind === "person") add(p.id, p.fullName);
    }
  }
  for (const a of admins) add(a.id, a.fullName);
  return [...out].map(([id, fullName]) => ({ id, fullName }));
}

export async function countRecentRequests(ex: Executor, email: string): Promise<number> {
  const [r] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(authCodes)
    .where(and(eq(authCodes.email, email), gt(authCodes.createdAt, sql`now() - interval '1 hour'`)));
  return r?.n ?? 0;
}

export interface IssuedCode {
  id: string;
  code: string;
  codeEnc: string;
  expiresAt: Date;
}

/**
 * Creates a code: enforces 3 requests per email per hour (web only), cancels earlier pending codes for the email,
 * stores only the HMAC. The clear code is returned once (for the notification event or the server command).
 */
export async function issueCode(
  ex: Executor,
  secret: string,
  i: { purpose: CodePurpose; email: string; userId: string | null; source: "web" | "cli"; ip: string | null },
): Promise<IssuedCode> {
  if (i.source === "web" && (await countRecentRequests(ex, i.email)) >= CODE_MAX_PER_HOUR) {
    throw new AppError("rate_limited", `Mỗi email chỉ được yêu cầu mã ${CODE_MAX_PER_HOUR} lần mỗi giờ. Thử lại sau.`);
  }
  await ex.update(authCodes).set({ status: "cancelled" }).where(and(eq(authCodes.email, i.email), eq(authCodes.status, "pending")));
  const code = sixDigitCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_HOURS * 3600_000);
  const [row] = await ex
    .insert(authCodes)
    .values({ purpose: i.purpose, email: i.email, userId: i.userId, codeHash: "pending", source: i.source, requestedIp: i.ip, expiresAt })
    .returning({ id: authCodes.id });
  await ex.update(authCodes).set({ codeHash: codeHash(secret, row!.id, code) }).where(eq(authCodes.id, row!.id));
  return { id: row!.id, code, codeEnc: encrypt(secret, code), expiresAt };
}

/**
 * The pending code of an email for a purpose (the newest; older ones are cancelled when a new one is issued).
 * Not locked: a wrong try is counted on a separate connection, which a row lock here would deadlock. Using the code
 * is a conditional update (`status = 'pending'`), so two concurrent correct tries cannot both win.
 */
export async function pendingCode(ex: Executor, email: string, purpose: CodePurpose) {
  const [row] = await ex
    .select()
    .from(authCodes)
    .where(and(eq(authCodes.email, email), eq(authCodes.purpose, purpose), eq(authCodes.status, "pending")))
    .orderBy(desc(authCodes.createdAt))
    .limit(1);
  return row ?? null;
}
