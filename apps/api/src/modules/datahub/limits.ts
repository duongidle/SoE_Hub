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
