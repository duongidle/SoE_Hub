import { eq } from "drizzle-orm";
import type { Executor } from "../client";
import { systemSettings } from "../schema/settings";

export async function getSetting<T = unknown>(ex: Executor, key: string): Promise<T | undefined> {
  const rows = await ex.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return rows[0]?.value as T | undefined;
}
