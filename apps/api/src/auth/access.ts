import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import {
  ALL_PERMISSIONS,
  AppError,
  SERVICE_ACCOUNT_PERMISSIONS,
  isTokenAllowedPermission,
  permissionsFor,
  type Actor,
  type Permission,
  type Role,
} from "@soe/shared";
import { orgMemberships, serviceAccounts, userPermissions, users, type Executor } from "@soe/db";
import type { AuthDecision, Authorizer, AuthTarget } from "../core/types";

/** Everything the permission engine needs to know about the account behind an actor. */
export interface Principal {
  userId: string;
  kind: "person" | "service" | "system";
  status: "inactive" | "active" | "locked";
  email: string | null;
  fullName: string;
  roles: Role[];
  guestPreset: string | null;
  mustSetPassword: boolean;
  /** Permissions of the account (roles + guest preset + supplementary; for service accounts their scopes). */
  permissions: Set<Permission>;
  /** Current place in the org chart. A manager's own row has managerId = userId. */
  managerId: string | null;
  leaderId: string | null;
  /** Service accounts: the trees they are limited to. */
  serviceTrees: string[];
}

export async function loadPrincipal(db: Executor, userId: string): Promise<Principal | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;
  const [m] = await db
    .select({ managerId: orgMemberships.managerId, leaderId: orgMemberships.leaderId })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, userId), isNull(orgMemberships.validTo)))
    .limit(1);
  let permissions: Set<Permission>;
  let serviceTrees: string[] = [];
  if (u.kind === "system") {
    // The internal account runs jobs and server commands; it cannot be reached from HTTP (no session or token).
    permissions = new Set(ALL_PERMISSIONS);
  } else if (u.kind === "service") {
    const [sa] = await db.select().from(serviceAccounts).where(eq(serviceAccounts.userId, userId)).limit(1);
    permissions = new Set((sa?.scopes ?? []).filter((p): p is Permission => SERVICE_ACCOUNT_PERMISSIONS.includes(p as Permission)));
    serviceTrees = sa?.treeManagerIds ?? [];
  } else {
    const extra = await db
      .select({ p: userPermissions.permission })
      .from(userPermissions)
      .where(and(eq(userPermissions.userId, userId), isNull(userPermissions.revokedAt)));
    permissions = permissionsFor(u.roles, u.guestPreset, extra.map((e) => e.p));
    // A Guest with a table grant may call the Datahub read commands; what they reach is decided per table by the grant (modules/datahub/guest-access.ts).
    if (u.roles.includes("guest")) {
      const g = await db.execute(sql`SELECT 1 FROM data_grants g WHERE g.guest_user_id = ${u.id}::uuid AND g.data_type = 'datahub_table' AND g.revoked_at IS NULL AND g.deleted_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now()) LIMIT 1`);
      if (g.rows.length > 0) permissions.add("datahub:datahub:use");
    }
  }
  return {
    userId: u.id,
    kind: u.kind as Principal["kind"],
    status: u.status as Principal["status"],
    email: u.email,
    fullName: u.fullName,
    roles: u.roles as Role[],
    guestPreset: u.guestPreset,
    mustSetPassword: u.mustSetPassword,
    permissions,
    managerId: m?.managerId ?? null,
    leaderId: m?.leaderId ?? null,
    serviceTrees,
  };
}

/** Permissions still usable before a first-Google-login user has set a password. */
const SETUP_ALLOWED = new Set<string>(["auth:self", "system:whoami", "notification:read", "events:subscribe"]);

/** Effective permissions: the account's permissions, intersected with the token scopes when a token is used. */
export function effectivePermissions(p: Principal, actor: Actor): Set<Permission> {
  // A personal token is a connection: menus and levels are checked by the executor (`core/ai-gate.ts`), not by scopes.
  if (actor.connectionKind === "personal") return new Set([...p.permissions].filter((x) => isTokenAllowedPermission(x)));
  const tokenUsed = actor.connectionId !== null || actor.scopes.length > 0;
  if (!tokenUsed) return p.permissions;
  const scopes = new Set(actor.scopes);
  return new Set([...p.permissions].filter((x) => scopes.has(x) && (p.kind === "system" || isTokenAllowedPermission(x))));
}

/** Data a scope covers: everything, or the rows owned by these users. */
export type Scope = { all: true } | { all: false; userIds: string[] };

/**
 * Kinds of data scope (design module1 section 4).
 * - `deal`: Admin every tree (read only), Manager own tree, Leader self + team, User self, service account its trees.
 * - `org`: who you may see in the org chart: Admin all; others their own tree (guests only themselves).
 * - `org_write`: whom you may edit in the org chart: Admin all; Manager own tree.
 * - `owner`: private data (datahub, files, notifications): only yourself.
 */
export type ScopeKind = "deal" | "org" | "org_write" | "owner";

async function treeMembers(db: Executor, managerId: string): Promise<string[]> {
  const rows = await db.select({ id: orgMemberships.userId }).from(orgMemberships).where(and(eq(orgMemberships.managerId, managerId), isNull(orgMemberships.validTo)));
  return [...new Set([managerId, ...rows.map((r) => r.id)])];
}

async function teamMembers(db: Executor, leaderId: string): Promise<string[]> {
  const rows = await db.select({ id: orgMemberships.userId }).from(orgMemberships).where(and(eq(orgMemberships.leaderId, leaderId), isNull(orgMemberships.validTo)));
  return [leaderId, ...rows.map((r) => r.id)];
}

export async function computeScope(db: Executor, p: Principal, kind: ScopeKind): Promise<Scope> {
  const ids = new Set<string>([p.userId]);
  const has = (r: Role) => p.roles.includes(r);
  if (p.kind === "system") return { all: true };
  switch (kind) {
    case "owner":
      return { all: false, userIds: [p.userId] };
    case "deal": {
      if (has("admin")) return { all: true };
      if (p.kind === "service") {
        ids.clear();
        for (const m of p.serviceTrees) for (const id of await treeMembers(db, m)) ids.add(id);
        return { all: false, userIds: [...ids] };
      }
      if (has("manager") && p.managerId === p.userId) for (const id of await treeMembers(db, p.userId)) ids.add(id);
      if (has("leader")) for (const id of await teamMembers(db, p.userId)) ids.add(id);
      return { all: false, userIds: [...ids] };
    }
    case "org": {
      if (has("admin")) return { all: true };
      if (p.roles.length === 1 && has("guest")) return { all: false, userIds: [p.userId] };
      if (p.managerId) for (const id of await treeMembers(db, p.managerId)) ids.add(id);
      return { all: false, userIds: [...ids] };
    }
    case "org_write": {
      if (has("admin")) return { all: true };
      if (has("manager") && p.managerId === p.userId) return { all: false, userIds: await treeMembers(db, p.userId) };
      return { all: false, userIds: [] };
    }
  }
}

export function scopeIncludes(scope: Scope, userId: string | null | undefined): boolean {
  if (scope.all) return true;
  return !!userId && scope.userIds.includes(userId);
}

/**
 * SQL condition "owner column is inside the scope". Every query on a table with an owner MUST use this (or `ownedBy`):
 * the comment marker is what the query guard looks for (see `query-guard.ts`).
 */
export function scopeSql(column: SQL | { name: string } | unknown, scope: Scope): SQL {
  if (scope.all) return sql`/*scope*/ true`;
  if (scope.userIds.length === 0) return sql`/*scope*/ false`;
  return sql`/*scope*/ ${column} = ANY(${`{${scope.userIds.join(",")}}`}::uuid[])`;
}

/** Shortcut for private data: "owner column = this user". */
export function ownedBy(column: unknown, userId: string): SQL {
  return sql`/*scope*/ ${column} = ${userId}::uuid`;
}

/** Marks a deliberate system-wide query on an owned table (jobs, admin tools with their own permission check). */
export function systemScope(): SQL {
  return sql`/*scope:system*/ true`;
}

/**
 * Per-request access helper given to handlers as `ctx.access`. Loads the principal once (cached per actor object).
 */
export class AccessContext {
  private principalP: Promise<Principal | null> | null = null;
  private readonly scopes = new Map<ScopeKind, Promise<Scope>>();

  constructor(
    readonly actor: Actor | null,
    private readonly db: Executor,
    private readonly loader: PrincipalLoader,
  ) {}

  principal(): Promise<Principal | null> {
    if (!this.actor) return Promise.resolve(null);
    this.principalP ??= this.loader.get(this.actor);
    return this.principalP;
  }

  async requirePrincipal(): Promise<Principal> {
    const p = await this.principal();
    if (!p) throw new AppError("unauthenticated");
    return p;
  }

  async permissions(): Promise<Set<Permission>> {
    const p = await this.principal();
    return p && this.actor ? effectivePermissions(p, this.actor) : new Set();
  }

  async can(permission: Permission): Promise<boolean> {
    return (await this.permissions()).has(permission);
  }

  async hasRole(role: Role): Promise<boolean> {
    return (await this.principal())?.roles.includes(role) ?? false;
  }

  scope(kind: ScopeKind): Promise<Scope> {
    let s = this.scopes.get(kind);
    if (!s) {
      s = this.requirePrincipal().then((p) => computeScope(this.db, p, kind));
      this.scopes.set(kind, s);
    }
    return s;
  }
}

/** Loads principals, cached per actor object (each request builds its own actor, so this is a per-request cache). */
export class PrincipalLoader {
  private readonly cache = new WeakMap<Actor, Promise<Principal | null>>();
  constructor(private readonly db: Executor) {}

  get(actor: Actor): Promise<Principal | null> {
    let p = this.cache.get(actor);
    if (!p) {
      p = loadPrincipal(this.db, actor.userId);
      this.cache.set(actor, p);
    }
    return p;
  }
}

/** The real permission check (design module1 sections 1 and 10): account status, role permissions, token scopes. */
export class RoleAuthorizer implements Authorizer {
  constructor(private readonly loader: PrincipalLoader) {}

  async authorize(actor: Actor, target: AuthTarget): Promise<AuthDecision> {
    const p = await this.loader.get(actor);
    if (!p) return { allowed: false, reason: "Tài khoản không tồn tại.", code: "unauthenticated" };
    if (p.status !== "active") return { allowed: false, reason: "Tài khoản không hoạt động.", code: "unauthenticated" };
    if (p.mustSetPassword && !SETUP_ALLOWED.has(target.permission)) {
      return { allowed: false, reason: "Cần đặt mật khẩu trước khi tiếp tục.", code: "password_setup_required" };
    }
    if (effectivePermissions(p, actor).has(target.permission as Permission)) return { allowed: true };
    return { allowed: false, reason: `Thiếu quyền "${target.permission}".` };
  }
}

/** Active, person accounts holding a role (for example every Admin). */
export async function activeUsersWithRole(db: Executor, role: Role): Promise<{ id: string; fullName: string; email: string | null }[]> {
  return db
    .select({ id: users.id, fullName: users.fullName, email: users.email })
    .from(users)
    .where(and(eq(users.kind, "person"), eq(users.status, "active"), sql`${role} = ANY(${users.roles})`));
}

export async function usersByIds(db: Executor, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(users).where(inArray(users.id, ids));
}
