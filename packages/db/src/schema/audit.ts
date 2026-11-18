import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "./columns";

/**
 * Append-only audit log (design section 9.2).
 * Enforced twice: the app role has no UPDATE/DELETE/TRUNCATE, and a trigger rejects them for every role.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    at: timestamp("at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    requestId: text("request_id"),
    actorUserId: uuid("actor_user_id"),
    via: text("via"),
    connectionId: uuid("connection_id"),
    automationId: uuid("automation_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** Command/query name, e.g. `datahub.row.update`. */
    command: text("command").notNull(),
    /** `success` | `denied` | `error` */
    result: text("result").notNull(),
    errorCode: text("error_code"),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details"),
  },
  (t) => [
    index("audit_log_at_idx").on(t.at.desc()),
    index("audit_log_actor_idx").on(t.actorUserId, t.at.desc()),
    index("audit_log_command_idx").on(t.command, t.at.desc()),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
