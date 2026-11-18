import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, listParamsShape } from "@soe/shared";
import { auditLog, listPage, recordRowHistory, diffRows, systemSettings, versionedUpdate, type FieldMap } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import type { ListOutput } from "../../core/types";

const SettingOut = z.object({
  key: z.string(),
  value: z.unknown(),
  version: z.number().int(),
  updated_at: z.date().or(z.string()),
});

const settingFields: FieldMap = {
  id: { type: "uuid", expr: systemSettings.id, selectable: false },
  key: { type: "text", expr: systemSettings.key },
  value: { type: "text", expr: sql`${systemSettings.value}::text`, sortable: false },
  version: { type: "number", expr: systemSettings.version },
  updated_at: { type: "datetime", expr: systemSettings.updatedAt },
};

const auditFields: FieldMap = {
  id: { type: "uuid", expr: auditLog.id },
  at: { type: "datetime", expr: auditLog.at },
  request_id: { type: "text", expr: auditLog.requestId },
  actor_user_id: { type: "uuid", expr: auditLog.actorUserId },
  via: { type: "enum", expr: auditLog.via, values: ["web", "api", "mcp", "worker", "automation"] },
  connection_id: { type: "uuid", expr: auditLog.connectionId },
  command: { type: "text", expr: auditLog.command },
  result: { type: "enum", expr: auditLog.result, values: ["success", "denied", "error"] },
  error_code: { type: "text", expr: auditLog.errorCode },
  target_type: { type: "text", expr: auditLog.targetType },
  target_id: { type: "text", expr: auditLog.targetId },
  ip: { type: "text", expr: auditLog.ip, sortable: false },
  user_agent: { type: "text", expr: auditLog.userAgent, sortable: false },
  details: { type: "text", expr: sql`${auditLog.details}::text`, sortable: false },
};

const settingKey = z.string().min(1).max(100).regex(/^[a-z0-9_.]+$/, "Khoá chỉ gồm chữ thường, số, dấu chấm và gạch dưới.");

export const systemOperations = [
  defineQuery({
    name: "system.ping",
    summary: "Kiểm tra API còn sống (không cần đăng nhập).",
    permission: null,
    aiAllowed: true,
    input: z.object({}),
    output: z.object({ pong: z.literal(true), time: z.string() }),
    http: { method: "GET", path: "/system/ping" },
    handler: async () => ({ pong: true as const, time: new Date().toISOString() }),
  }),

  defineQuery({
    name: "system.whoami",
    summary: "Trả về tác nhân (actor) đang gọi API.",
    permission: "system:whoami",
    aiAllowed: true,
    input: z.object({}),
    output: z.object({ user_id: z.uuid(), via: z.string(), scopes: z.array(z.string()) }),
    http: { method: "GET", path: "/system/whoami" },
    handler: async (ctx) => ({ user_id: ctx.actor.userId, via: ctx.actor.via, scopes: ctx.actor.scopes }),
  }),

  defineQuery({
    name: "system.setting.list",
    summary: "Danh sách cài đặt hệ thống.",
    permission: "system:setting:read",
    aiAllowed: true,
    list: true,
    input: z.object(listParamsShape),
    output: SettingOut,
    http: { method: "GET", path: "/system/settings" },
    handler: async (ctx, i): Promise<ListOutput> =>
      listPage(ctx.db, {
        from: sql`system_settings`,
        fields: settingFields,
        baseWhere: sql`deleted_at IS NULL`,
        filter: i.filter,
        sort: i.sort,
        defaultSort: [{ field: "key", dir: "asc" }],
        select: i.fields,
        limit: i.limit,
        cursor: i.cursor,
        includeTotal: i.include_total,
      }),
  }),

  defineQuery({
    name: "system.setting.get",
    summary: "Đọc một cài đặt hệ thống.",
    permission: "system:setting:read",
    aiAllowed: true,
    input: z.object({ key: settingKey }),
    output: SettingOut,
    http: { method: "GET", path: "/system/settings/:key" },
    handler: async (ctx, i) => {
      const [row] = await ctx.db.select().from(systemSettings).where(eq(systemSettings.key, i.key)).limit(1);
      if (!row || row.deletedAt) throw new AppError("not_found", `Không có cài đặt "${i.key}".`);
      return { key: row.key, value: row.value, version: row.version, updated_at: row.updatedAt };
    },
  }),

  defineCommand({
    name: "system.setting.set",
    summary: "Tạo hoặc sửa một cài đặt hệ thống.",
    description: "Tạo mới: không gửi `version`. Sửa: bắt buộc gửi `version` đang có, lệch thì trả 409 `conflict`.",
    permission: "system:setting:write",
    aiAllowed: false,
    emits: ["system.setting.changed"],
    input: z.object({
      key: settingKey,
      value: z.json(),
      version: z.number().int().min(1).optional(),
    }),
    output: SettingOut,
    http: { method: "PUT", path: "/system/settings/:key" },
    handler: async (ctx, i) => {
      const actorRef = { userId: ctx.actor.userId, via: ctx.actor.via, connectionId: ctx.actor.connectionId, automationId: ctx.actor.automationId };
      const [existing] = await ctx.db.select().from(systemSettings).where(eq(systemSettings.key, i.key)).limit(1);
      let row: typeof systemSettings.$inferSelect;
      let changes;
      if (!existing || existing.deletedAt) {
        if (i.version !== undefined) throw new AppError("not_found", `Không có cài đặt "${i.key}" để sửa.`);
        try {
          const ins = await ctx.db
            .insert(systemSettings)
            .values({ key: i.key, value: i.value, createdBy: ctx.actor.userId, updatedBy: ctx.actor.userId })
            .returning();
          row = ins[0]!;
        } catch (e) {
          if ((e as { code?: string }).code === "23505") throw new AppError("conflict", "Cài đặt này vừa được tạo bởi người khác.");
          throw e;
        }
        changes = diffRows(null, { value: row.value });
        await recordRowHistory(ctx.db, { tableId: "system_settings", rowId: row.id, version: row.version, op: "create", changes, actor: actorRef });
      } else {
        if (i.version === undefined) throw new AppError("validation_error", "Sửa cài đặt phải gửi kèm `version`.", { issues: [{ path: "version", code: "required", message: "Bắt buộc khi sửa." }] });
        const updated = await versionedUpdate(ctx.db, systemSettings, {
          id: existing.id,
          expectedVersion: i.version,
          set: { value: i.value },
          actor: actorRef,
          historyTableId: "system_settings",
        });
        row = updated as typeof row;
        changes = diffRows({ value: existing.value }, { value: row.value });
      }
      ctx.audit({ type: "system_setting", id: row.id, details: { key: i.key, changes } });
      await ctx.emit("system.setting.changed", { aggregateType: "system_setting", aggregateId: row.id, payload: { key: i.key, version: row.version } });
      return { key: row.key, value: row.value, version: row.version, updated_at: row.updatedAt };
    },
  }),

  defineQuery({
    name: "system.audit.list",
    summary: "Nhật ký hệ thống (audit log), lọc và phân trang keyset.",
    description: "Chỉ Admin được xem (quyền `system:audit:read`; Stage 1 gắn quyền này vào vai trò Admin). Việc đọc cũng được ghi log.",
    permission: "system:audit:read",
    aiAllowed: false,
    audit: "always",
    list: true,
    input: z.object(listParamsShape),
    output: z.record(z.string(), z.unknown()),
    http: { method: "GET", path: "/system/audit-log" },
    handler: async (ctx, i): Promise<ListOutput> => {
      ctx.audit({ type: "audit_log", details: { filter: i.filter ?? null, sort: i.sort ?? null } });
      return listPage(ctx.db, {
        from: sql`audit_log`,
        fields: auditFields,
        filter: i.filter,
        sort: i.sort,
        defaultSort: [{ field: "at", dir: "desc" }],
        select: i.fields,
        limit: i.limit,
        cursor: i.cursor,
        includeTotal: i.include_total,
      });
    },
  }),
];
