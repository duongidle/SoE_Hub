import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { newId, standardColumns } from "./columns";

/** Fixed id of the internal system account used by the worker and server commands (design module1 section 7). */
export const SYSTEM_USER_ID = "00000000-0000-7000-8000-000000000000";

/**
 * People, service accounts and the internal system account (design module1 sections 2 and 7).
 * A person row is created only through the org chart (status `inactive`) and activated with a code or Google.
 * Rows are never deleted: removing someone from the org chart locks the account.
 */
export const users = pgTable(
  "users",
  {
    ...standardColumns(),
    /** `person` | `service` (external system, token only) | `system` (internal, never logs in). */
    kind: text("kind").notNull().default("person"),
    /** Lower-cased. Required for people; null for service/system accounts. */
    email: text("email"),
    fullName: text("full_name").notNull(),
    title: text("title"),
    phone: text("phone"),
    avatarFileId: uuid("avatar_file_id"),
    /** Subset of admin, manager, leader, user, guest. */
    roles: text("roles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** For guests: `sale` | `data`. */
    guestPreset: text("guest_preset"),
    /** `inactive` (Chưa kích hoạt) | `active` (Đang hoạt động) | `locked` (Đã khoá). */
    status: text("status").notNull().default("inactive"),
    passwordHash: text("password_hash"),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true, mode: "date" }),
    /** Set after the first Google login: the person must choose a password before doing anything else. */
    mustSetPassword: boolean("must_set_password").notNull().default(false),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "date" }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "date" }),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "date" }),
    googleSub: text("google_sub"),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    index("users_status_idx").on(t.status),
    check("users_kind_chk", sql`${t.kind} IN ('person', 'service', 'system')`),
    check("users_status_chk", sql`${t.status} IN ('inactive', 'active', 'locked')`),
    check("users_email_chk", sql`(${t.kind} <> 'person') OR (${t.email} IS NOT NULL AND ${t.email} = lower(${t.email}))`),
    check("users_roles_chk", sql`${t.roles} <@ ARRAY['admin', 'manager', 'leader', 'user', 'guest']::text[]`),
    check("users_guest_preset_chk", sql`${t.guestPreset} IS NULL OR ${t.guestPreset} IN ('sale', 'data')`),
  ],
);

export type UserRow = typeof users.$inferSelect;

/**
 * Org chart history (design module1 section 2.3). One row per period a person sits at one place in a tree.
 * The current place has `valid_to IS NULL`. Permissions use the current tree; period reports use the tree at that time.
 * A manager's own row has `manager_id = user_id`.
 */
export const orgMemberships = pgTable(
  "org_memberships",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    managerId: uuid("manager_id")
      .notNull()
      .references((): AnyPgColumn => users.id),
    leaderId: uuid("leader_id").references((): AnyPgColumn => users.id),
    validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    validTo: timestamp("valid_to", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
  },
  (t) => [
    uniqueIndex("org_memberships_current_uq").on(t.userId).where(sql`${t.validTo} IS NULL`),
    index("org_memberships_manager_idx").on(t.managerId).where(sql`${t.validTo} IS NULL`),
    index("org_memberships_leader_idx").on(t.leaderId).where(sql`${t.validTo} IS NULL`),
    index("org_memberships_history_idx").on(t.userId, t.validFrom),
  ],
);

/** Supplementary permissions (design module1 section 3.3), chosen from the catalogue in packages/shared. */
export const userPermissions = pgTable(
  "user_permissions",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    permission: text("permission").notNull(),
    note: text("note"),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    grantedBy: uuid("granted_by").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedBy: uuid("revoked_by").references(() => users.id),
  },
  (t) => [uniqueIndex("user_permissions_active_uq").on(t.userId, t.permission).where(sql`${t.revokedAt} IS NULL`)],
);
