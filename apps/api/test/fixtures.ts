import { randomUUID } from "node:crypto";
import { orgMemberships, apiTokens, users, newId } from "@soe/db";
import type { Role } from "@soe/shared";
import { hashPassword } from "../src/auth/password";
import { sha256 } from "../src/auth/crypto";
import type { TestApp } from "./helpers";

export const PASSWORD = "ngua-van-bay-42";
let pwHash: Promise<string> | null = null;

export interface Person {
  id: string;
  email: string;
  name: string;
}

/**
 * A small organisation (design module1 section 2.3):
 *   tree A: mgrA -> leaderA -> userA1 ; userA2 directly under mgrA ; guestData (Guest Data) in tree A
 *   tree B: mgrB -> leaderB -> userB1
 *   admin, admin2 outside the trees ; guestSale outside the trees
 * Every person is active with password PASSWORD. Emails are unique per call.
 */
export async function seedOrg(t: TestApp) {
  pwHash ??= hashPassword(PASSWORD);
  const hash = await pwHash;
  const tag = randomUUID().slice(0, 8);
  const db = t.c.db.db;
  const mk = async (key: string, roles: Role[], extra: Partial<typeof users.$inferInsert> = {}): Promise<Person> => {
    const email = `${key.toLowerCase()}.${tag}@base.vn`;
    const name = `${key} ${tag}`;
    const [u] = await db.insert(users).values({ email, fullName: name, roles, status: "active", passwordHash: hash, ...extra }).returning({ id: users.id });
    return { id: u!.id, email, name };
  };
  const place = (userId: string, managerId: string, leaderId: string | null = null) => db.insert(orgMemberships).values({ userId, managerId, leaderId });

  const admin = await mk("Admin", ["admin"]);
  const admin2 = await mk("Admin2", ["admin"]);
  const mgrA = await mk("MgrA", ["manager"]);
  const mgrB = await mk("MgrB", ["manager"]);
  await place(mgrA.id, mgrA.id);
  await place(mgrB.id, mgrB.id);
  const leaderA = await mk("LeaderA", ["leader"]);
  const leaderB = await mk("LeaderB", ["leader"]);
  await place(leaderA.id, mgrA.id);
  await place(leaderB.id, mgrB.id);
  const userA1 = await mk("UserA1", ["user"]);
  const userA2 = await mk("UserA2", ["user"]);
  const userB1 = await mk("UserB1", ["user"]);
  await place(userA1.id, mgrA.id, leaderA.id);
  await place(userA2.id, mgrA.id);
  await place(userB1.id, mgrB.id, leaderB.id);
  const guestData = await mk("GuestData", ["guest"], { guestPreset: "data" });
  await place(guestData.id, mgrA.id);
  const guestSale = await mk("GuestSale", ["guest"], { guestPreset: "sale" });
  return { tag, admin, admin2, mgrA, mgrB, leaderA, leaderB, userA1, userA2, userB1, guestData, guestSale };
}

export type Org = Awaited<ReturnType<typeof seedOrg>>;

export interface WebSession {
  cookie: string;
  csrf: string;
  /** Headers for a read (cookie only). */
  read: Record<string, string>;
  /** Headers for a write (cookie + CSRF header). */
  write: Record<string, string>;
}

function cookiesFrom(setCookie: string | string[] | undefined): Record<string, string> {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const out: Record<string, string> = {};
  for (const c of list) {
    const [kv] = c.split(";");
    const i = kv!.indexOf("=");
    out[kv!.slice(0, i)] = kv!.slice(i + 1);
  }
  return out;
}

/** Real login through the API; returns cookie + CSRF headers. */
export async function login(t: TestApp, email: string, password = PASSWORD): Promise<WebSession> {
  const r = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login failed for ${email}: ${r.body}`);
  return sessionFrom(r.headers["set-cookie"]);
}

export function sessionFrom(setCookie: string | string[] | undefined): WebSession {
  const c = cookiesFrom(setCookie);
  const cookie = `soe_session=${c.soe_session}; soe_csrf=${c.soe_csrf}`;
  return { cookie, csrf: c.soe_csrf!, read: { cookie }, write: { cookie, "x-csrf-token": c.soe_csrf! } };
}

/** An active personal token for a user (inserted directly, as if an Admin had approved it). */
export async function activeToken(t: TestApp, userId: string, scopes: string[], o: { kind?: "personal" | "service"; expiresAt?: Date; menus?: Record<string, "read" | "write" | "full">; name?: string; status?: "pending" | "active" } = {}): Promise<{ id: string; token: string; headers: Record<string, string> }> {
  const prefix = o.kind === "service" ? "soe_svc_" : "soe_pat_";
  const token = `${prefix}${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
  const id = newId();
  await t.c.db.db.insert(apiTokens).values({
    id,
    userId,
    kind: o.kind ?? "personal",
    name: o.name ?? "test",
    tokenPrefix: token.slice(0, 12),
    tokenHash: sha256(token),
    // A personal token carries menus (module5); `scopes` only count for service tokens. Default: every menu at the top level, so the owner's own permissions decide.
    scopes: o.kind === "service" ? scopes : [],
    menus: o.menus ?? { deal: "full", datahub: "full", form: "full", knowledge: "full", aihub: "full", workspace: "full", notify: "full", feedback: "full", admin: "full" },
    status: o.status ?? "active",
    expiresAt: o.expiresAt ?? new Date(Date.now() + 86400_000),
  });
  return { id, token, headers: { authorization: `Bearer ${token}` } };
}

/** Admin's AI policy (module5 6): which forbidden groups are switched on, and the emergency switch. */
export async function setAiPolicy(t: TestApp, admin: WebSession, p: { groups?: string[]; killed?: boolean }): Promise<void> {
  const put = async (key: string, value: unknown) => {
    const cur = await t.app.inject({ method: "GET", url: `/api/v1/system/settings/${key}`, headers: admin.read });
    const version = cur.statusCode === 200 ? (cur.json().data.version as number) : undefined;
    const r = await t.app.inject({ method: "PUT", url: `/api/v1/system/settings/${key}`, headers: admin.write, payload: { value, ...(version ? { version } : {}) } });
    if (r.statusCode >= 300) throw new Error(`setting ${key}: ${r.body}`);
  };
  if (p.groups) await put("ai.groups_enabled", p.groups);
  if (p.killed !== undefined) await put("ai.killed", p.killed);
}
