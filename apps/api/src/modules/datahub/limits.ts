import { eq } from "drizzle-orm";
import { z } from "zod";
import { AppError, DH_COLUMN_CEILING, DH_LIMIT_DEFAULTS } from "@soe/shared";
import { dhUserLimits, type Executor } from "@soe/db";
import { readSetting, type SettingDef } from "../system/settings-catalog";

/** System settings holding the default Datahub limits (design module2 section 11). Registered in the settings catalog. */
export const DH_SETTINGS = {
  maxDatahubs: {
    key: "datahub.max_datahubs",
    label: "Datahub tối đa mỗi người",
    description: "Số datahub mỗi người được tạo (không tính Quản lý Deal). Chỉnh riêng cho từng người được.",
    schema: z.number().int().min(1).max(1000),
    default: DH_LIMIT_DEFAULTS.datahubs,
  } satisfies SettingDef<number>,
  maxTables: {
    key: "datahub.max_tables",
    label: "Bảng tối đa mỗi datahub",
    description: "Số bảng trong một datahub. Chỉnh riêng cho từng người được.",
    schema: z.number().int().min(1).max(1000),
    default: DH_LIMIT_DEFAULTS.tables,
  } satisfies SettingDef<number>,
  maxColumns: {
    key: "datahub.max_columns",
    label: "Cột tối đa mỗi bảng",
    description: `Số cột trong một bảng, không vượt trần ${DH_COLUMN_CEILING}. Chỉnh riêng cho từng người được.`,
    schema: z.number().int().min(1).max(DH_COLUMN_CEILING),
    default: DH_LIMIT_DEFAULTS.columns,
  } satisfies SettingDef<number>,
  recalcParallel: {
    key: "datahub.recalc_parallel",
    label: "Số cột công thức tính song song",
    description: "Worker tính cùng lúc tối đa chừng này cột độc lập (cột phụ thuộc nhau vẫn tính theo thứ tự). Mặc định 2, tối đa 4.",
    schema: z.number().int().min(1).max(4),
    default: 2,
  } satisfies SettingDef<number>,
  consistentWaitMs: {
    key: "datahub.consistent_wait_ms",
    label: "Thời gian đợi tính xong khi đọc (ms)",
    description: "Đọc dòng với consistent_after / consistent=true: đợi tối đa chừng này mili giây cho các cột công thức tính xong, hết thì trả giá trị hiện có kèm cờ stale.",
    schema: z.number().int().min(0).max(60000),
    default: 5000,
  } satisfies SettingDef<number>,
  fiscalStartMonth: {
    key: "datahub.fiscal_start_month",
    label: "Tháng bắt đầu năm tài chính",
    description: "Quý và năm của ô Thời gian trong Datahub tính từ tháng này (1 = năm dương lịch, quý bắt đầu tháng 1, 4, 7, 10). Năm tài chính mang số năm của tháng bắt đầu.",
    schema: z.number().int().min(1).max(12),
    default: 1,
  } satisfies SettingDef<number>,
  templatesPerScope: {
    key: "datahub.templates_per_scope",
    label: "Bảng template tối đa mỗi cây và mỗi team",
    description: "Số bảng template một Manager (cả cây) hoặc một Leader (một team) được tạo (Module 4 mục 3.5). Không tính vào giới hạn bảng của người nhận.",
    schema: z.number().int().min(1).max(200),
    default: 20,
  } satisfies SettingDef<number>,
} as const;

export interface DhLimits {
  datahubs: number;
  tables: number;
  columns: number;
}

/** Limits of one person: their override if any, else the system default. Columns never exceed the hard ceiling. */
export async function getLimits(ex: Executor, userId: string): Promise<DhLimits> {
  const [o] = await ex.select().from(dhUserLimits).where(eq(dhUserLimits.userId, userId)).limit(1);
  const datahubs = o?.maxDatahubs ?? (await readSetting(ex, DH_SETTINGS.maxDatahubs));
  const tables = o?.maxTables ?? (await readSetting(ex, DH_SETTINGS.maxTables));
  const columns = o?.maxColumns ?? (await readSetting(ex, DH_SETTINGS.maxColumns));
  return { datahubs, tables, columns: Math.min(columns, DH_COLUMN_CEILING) };
}

export function quotaExceeded(what: string, limit: number): never {
  throw new AppError("quota_exceeded", `Đã đạt giới hạn ${limit} ${what}. Liên hệ Admin nếu cần thêm.`, { limit });
}
