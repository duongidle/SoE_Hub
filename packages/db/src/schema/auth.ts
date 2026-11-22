import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { newId } from "./columns";
import { users } from "./users";

/**
 * Login sessions (design module1 section 6.5). The cookie holds a random token; only its SHA-256 is stored.
 * Expires after 7 days idle (`last_seen_at`) or 30 days absolute (`expires_at`).
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    /** `password` | `google` | `code` (right after activation or reset). */
    method: text("method").notNull().default("password"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedBy: uuid("revoked_by").references(() => users.id),
    revokeReason: text("revoke_reason"),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId).where(sql`${t.revokedAt} IS NULL`)],
);

/**
 * 6-digit codes for first registration (`activate`) and forgotten passwords (`reset`) (design module1 section 6.4).
 * Single use, 6 hours, 5 wrong tries kill it, a new request cancels the previous one. Only an HMAC of the code is stored.
 */
export const authCodes = pgTable(
  "auth_codes",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    purpose: text("purpose").notNull(),
    email: text("email").notNull(),
    /** Null for a self-registering guest (auto_guest_sale): the user row is created when the code is used. */
    userId: uuid("user_id").references(() => users.id),
    codeHash: text("code_hash").notNull(),
    /** `pending` | `used` | `cancelled` | `dead` (too many wrong tries). Expiry is read from `expires_at`. */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** `web` (request from the sign-up / forgot page) | `cli` (server command). */
    source: text("source").notNull().default("web"),
    requestedIp: text("requested_ip"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("auth_codes_email_idx").on(t.email, t.createdAt.desc()),
    check("auth_codes_purpose_chk", sql`${t.purpose} IN ('activate', 'reset')`),
    check("auth_codes_status_chk", sql`${t.status} IN ('pending', 'used', 'cancelled', 'dead')`),
  ],
);

/**
 * Bearer tokens (design module1 section 7): personal (`soe_pat_`, pending until an Admin approves) and
 * service-account tokens (`soe_svc_`, created by an Admin). Only the SHA-256 of the token is stored.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** `personal` | `service` */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    /** First characters, shown in lists so a leaked token can be recognised. */
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Personal tokens (connections): `{menu: "read" | "write" | "full"}` (module5 3). Service tokens use `scopes`. */
    menus: jsonb("menus")
      .$type<Record<string, "read" | "write" | "full">>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** `pending` | `active` | `rejected` | `revoked` */
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decidedBy: uuid("decided_by").references(() => users.id),
    decisionNote: text("decision_note"),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedBy: uuid("revoked_by").references(() => users.id),
    revokeReason: text("revoke_reason"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    lastUsedIp: text("last_used_ip"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_uq").on(t.tokenHash),
    index("api_tokens_user_idx").on(t.userId),
    index("api_tokens_pending_idx").on(t.createdAt).where(sql`${t.status} = 'pending'`),
    check("api_tokens_kind_chk", sql`${t.kind} IN ('personal', 'service')`),
    check("api_tokens_status_chk", sql`${t.status} IN ('pending', 'active', 'rejected', 'revoked')`),
  ],
);

/** Settings of a service account (a `users` row with kind `service`). */
export const serviceAccounts = pgTable("service_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  description: text("description"),
  /** Permissions the account may use (a subset of the service-allowed catalogue). */
  scopes: text("scopes")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** Manager trees the account is limited to (manager user ids). */
  treeManagerIds: uuid("tree_manager_ids")
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
  version: integer("version").notNull().default(1),
});
