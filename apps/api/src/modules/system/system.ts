import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, listParamsShape } from "@soe/shared";
import { auditLog, listPage, recordRowHistory, diffRows, systemSettings, versionedUpdate, type FieldMap } from "@soe/db";
import { maskAuditDetails } from "../../core/audit-privacy";
import { defineCommand, defineQuery } from "../../core/registry";
import type { ListOutput } from "../../core/types";
import { SETTING_DEFS, settingDef } from "./settings-catalog";

const SettingOut = z.object({
  key: z.string(),
  value: z.unknown(),
  version: z.number().int(),
  updated_at: z.date().or(z.string()),
});

const settingFields: FieldMap = {
  id: { type: "uuid", expr: systemSettings.id, selectable: false },
  key: { type: "text", expr: systemSettings.key },
  // jsonb, so the API returns the real JSON value (number, boolean, array) and not its text form.
  value: { type: "text", expr: sql`${systemSettings.value}`, sortable: false },
  version: { type: "number", expr: systemSettings.version },
  updated_at: { type: "datetime", expr: systemSettings.updatedAt },
};

const auditFields: FieldMap = {
  id: { type: "uuid", expr: auditLog.id },
  at: { type: "datetime", expr: auditLog.at },
  request_id: { type: "text", expr: auditLog.requestId },
  actor_user_id: { type: "uuid", expr: auditLog.actorUserId },
  actor_name: { type: "text", expr: sql`(SELECT u.full_name FROM users u WHERE u.id = ${auditLog.actorUserId})` },
  actor_email: { type: "text", expr: sql`(SELECT u.email FROM users u WHERE u.id = ${auditLog.actorUserId})` },
  via: { type: "enum", expr: auditLog.via, values: ["web", "api", "mcp", "worker", "automation"] },
  connection_id: { type: "uuid", expr: auditLog.connectionId },
  command: { type: "text", expr: auditLog.command },
  result: { type: "enum", expr: auditLog.result, values: ["success", "denied", "error"] },
  error_code: { type: "text", expr: auditLog.errorCode },
  target_type: { type: "text", expr: auditLog.targetType },
  target_id: { type: "text", expr: auditLog.targetId },
  ip: { type: "text", expr: auditLog.ip, sortable: false },
  user_agent: { type: "text", expr: auditLog.userAgent, sortable: false },
  details: { type: "text", expr: sql`${auditLog.details}`, sortable: false },
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
    aiAllowed: true,
    emits: ["system.setting.changed"],
    input: z.object({
      key: settingKey,
      value: z.json(),
      version: z.number().int().min(1).optional(),
    }),
    output: SettingOut,
    http: { method: "PUT", path: "/system/settings/:key" },
    handler: async (ctx, i) => {
      const def = settingDef(i.key);
      if (def) {
        const r = def.schema.safeParse(i.value);
        if (!r.success) throw new AppError("validation_error", `Giá trị không hợp lệ cho "${def.label}".`, { issues: r.error.issues.map((x) => ({ path: x.path.join("."), message: x.message })) });
        i.value = r.data as typeof i.value;
      }
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
    description: "Chỉ Admin được xem (quyền `system:audit:read`). Việc đọc cũng được ghi log. Lọc theo `at`, `actor_user_id`, `via`, `connection_id`, `command`, `result`, `target_type`, `target_id`.",
    permission: "system:audit:read",
    aiAllowed: true,
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
      }).then(maskPage);
    },
  }),

  defineQuery({
    name: "system.audit.get",
    summary: "Chi tiết một dòng nhật ký hệ thống.",
    permission: "system:audit:read",
    aiAllowed: true,
    audit: "always",
    input: z.object({ id: z.uuid() }),
    output: z.record(z.string(), z.unknown()),
    http: { method: "GET", path: "/system/audit-log/:id" },
    handler: async (ctx, i) => {
      ctx.audit({ type: "audit_log", id: i.id });
      const page = await listPage(ctx.db, { from: sql`audit_log`, fields: auditFields, baseWhere: sql`${auditLog.id} = ${i.id}`, defaultSort: [{ field: "at", dir: "desc" }], limit: 1 });
      const row = (await maskPage(page)).items[0];
      if (!row) throw new AppError("not_found", "Không có dòng nhật ký này.");
      return row;
    },
  }),

  defineQuery({
    name: "system.audit.export",
    summary: "Xuất nhật ký hệ thống ra file CSV (theo bộ lọc, tối đa 50.000 dòng). Việc xuất được ghi log.",
    description: "File ghi tên người xuất và thời điểm ở dòng đầu. REST trả `text/csv` để tải về.",
    permission: "system:audit:read",
    aiAllowed: true,
    audit: "always",
    input: z.object({ filter: listParamsShape.filter, sort: listParamsShape.sort }),
    output: z.object({ filename: z.string(), csv: z.string(), rows: z.number().int() }),
    http: {
      method: "GET",
      path: "/system/audit-log/export",
      respond: (r: { filename: string; csv: string }, res) => res.sendRaw(r.csv, "text/csv; charset=utf-8", r.filename),
    },
    handler: async (ctx, i) => {
      const me = await ctx.access.requirePrincipal();
      const cols = ["at", "actor_name", "actor_email", "via", "connection_id", "command", "result", "error_code", "target_type", "target_id", "ip", "user_agent", "request_id", "details"];
      const out: Record<string, unknown>[] = [];
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<typeof listPage>> = await listPage(ctx.db, { from: sql`audit_log`, fields: auditFields, filter: i.filter, sort: i.sort, defaultSort: [{ field: "at", dir: "desc" }], limit: 500, cursor });
        out.push(...(await maskPage(page as { items: Record<string, unknown>[] })).items);
        cursor = page.nextCursor;
      } while (cursor && out.length < 50_000);
      const now = new Date();
      const esc = (v: unknown) => {
        const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [
        `# Xuất bởi ${me.fullName} (${me.email ?? me.userId}) lúc ${now.toISOString()}`,
        cols.join(","),
        ...out.map((r) => cols.map((c) => esc(r[c])).join(",")),
      ];
      ctx.audit({ type: "audit_log", details: { filter: i.filter ?? null, rows: out.length } });
      return { filename: `nhat-ky-${now.toISOString().slice(0, 10)}.csv`, csv: `\uFEFF${lines.join("\r\n")}\r\n`, rows: out.length };
    },
  }),

  defineQuery({
    name: "system.setting.catalog",
    summary: "Danh mục cài đặt hệ thống đã biết: tên, mô tả, giá trị mặc định.",
    permission: "system:setting:read",
    aiAllowed: true,
    input: z.object({}),
    output: z.array(z.object({ key: z.string(), label: z.string(), description: z.string(), default: z.unknown(), schema: z.unknown() })),
    http: { method: "GET", path: "/system/settings-catalog" },
    handler: async () =>
      SETTING_DEFS.map((d) => ({ key: d.key, label: d.label, description: d.description, default: d.default, schema: z.toJSONSchema(d.schema, { unrepresentable: "any" }) })),
  }),
];

/** Defence in depth: values of private targets are hidden again on read (they are already stripped on write). */
async function maskPage<T extends { items: Record<string, unknown>[] }>(page: T): Promise<T> {
  return { ...page, items: page.items.map((r) => ("details" in r ? { ...r, details: maskAuditDetails(r.target_type as string, r.details) } : r)) };
}
