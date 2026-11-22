import { z } from "zod";
import { getSetting, type Executor } from "@soe/db";

/**
 * Known system settings: their type, default and label. `system.setting.set` validates these keys; other keys
 * (for example `worker.last_heartbeat`, written by jobs) are free-form.
 */
export interface SettingDef<T = unknown> {
  key: string;
  label: string;
  description: string;
  schema: z.ZodType<T>;
  default: T;
}

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Tên miền không hợp lệ, ví dụ base.vn");

export const SETTINGS = {
  allowedDomains: {
    key: "auth.allowed_domains",
    label: "Tên miền email được đăng ký",
    description: "Chỉ email thuộc các tên miền này được đăng ký và đăng nhập.",
    schema: z.array(domain).min(1).max(20),
    default: ["base.vn"],
  } satisfies SettingDef<string[]>,
  autoGuestSale: {
    key: "auth.auto_guest_sale",
    label: "Email ngoài org chart thành Guest Sale",
    description: "Bật: email đúng tên miền nhưng chưa có trong org chart vẫn đăng ký được và thành Guest mẫu Sale (chỉ đọc Knowledge).",
    schema: z.boolean(),
    default: false,
  } satisfies SettingDef<boolean>,
  googleEnabled: {
    key: "auth.google_enabled",
    label: "Cho phép đăng nhập Google",
    description: "Cần cấu hình GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET trên server.",
    schema: z.boolean(),
    default: false,
  } satisfies SettingDef<boolean>,
  trashRetentionDays: {
    key: "trash.retention_days",
    label: "Số ngày giữ thùng rác",
    description: "Dữ liệu đã xoá được khôi phục trong số ngày này, sau đó bị xoá hẳn.",
    schema: z.number().int().min(1).max(365),
    default: 7,
  } satisfies SettingDef<number>,
  auditRetentionDays: {
    key: "audit.retention_days",
    label: "Số ngày giữ nhật ký hệ thống",
    description: "Tối thiểu 730 ngày (2 năm). Nhật ký cũ hơn được dọn mỗi tháng.",
    schema: z.number().int().min(730).max(36500),
    default: 730,
  } satisfies SettingDef<number>,
  aiKilled: {
    key: "ai.killed",
    label: "Tạm tắt mọi kết nối AI / API cá nhân",
    description: "Công tắc khẩn cấp: bật thì mọi lệnh gọi bằng token cá nhân và /mcp bị từ chối.",
    schema: z.boolean(),
    default: false,
  } satisfies SettingDef<boolean>,
  aiGroups: {
    key: "ai.groups_enabled",
    label: "Nhóm thao tác cho phép AI",
    description: "Các nhóm cấm mặc định mà Admin bật cho AI: org, guest_grant, transfer, settings, audit_log. Thao tác cấm cứng không bật được.",
    schema: z.array(z.enum(["org", "guest_grant", "transfer", "settings", "audit_log"])).max(5),
    default: [] as ("org" | "guest_grant" | "transfer" | "settings" | "audit_log")[],
  } satisfies SettingDef<("org" | "guest_grant" | "transfer" | "settings" | "audit_log")[]>,
} as const;

export const SETTING_DEFS: SettingDef[] = Object.values(SETTINGS) as SettingDef[];

/** Settings of other modules register their definitions here (for example the Datahub limits). */
export function registerSettings(...defs: SettingDef[]): void {
  for (const d of defs) if (!SETTING_DEFS.some((x) => x.key === d.key)) SETTING_DEFS.push(d);
}

export function settingDef(key: string): SettingDef | undefined {
  return SETTING_DEFS.find((d) => d.key === key);
}

/** Reads a known setting; falls back to the default when missing or invalid. */
export async function readSetting<T>(ex: Executor, def: SettingDef<T>): Promise<T> {
  const v = await getSetting(ex, def.key);
  if (v === undefined) return def.default;
  const r = def.schema.safeParse(v);
  return r.success ? r.data : def.default;
}
