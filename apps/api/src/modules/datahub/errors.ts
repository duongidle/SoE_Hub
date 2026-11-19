import { AppError } from "@soe/shared";

/** Postgres error code and constraint name, whether the error is raw or wrapped by Drizzle (`cause`). */
export function pgError(e: unknown): { code?: string; constraint?: string; message?: string } {
  const x = e as { code?: string; constraint?: string; message?: string; cause?: unknown };
  if (x?.code && /^[0-9A-Z]{5}$/.test(x.code)) return { code: x.code, constraint: x.constraint, message: x.message };
  if (x?.cause) return pgError(x.cause);
  return {};
}

const UNIQUE_MESSAGES: Record<string, string> = {
  dh_datahubs_owner_name_uq: "Bạn đã có một datahub tên này. Hãy đặt tên khác.",
  dh_tables_name_uq: "Datahub này đã có một bảng tên này. Hãy đặt tên khác.",
  dh_columns_name_uq: "Bảng này đã có một cột tên này. Hãy đặt tên khác.",
  mt_sources_name_uq: "Datahub này đã có một nguồn dữ liệu tên này. Hãy đặt tên khác.",
  mt_metrics_name_uq: "Datahub này đã có một chỉ số tên này. Hãy đặt tên khác.",
};

/** Turns a unique violation on a name index into a Vietnamese `conflict`; rethrows everything else. */
export function rethrowNameConflict(e: unknown): never {
  const p = pgError(e);
  if (p.code === "23505" && p.constraint && UNIQUE_MESSAGES[p.constraint]) {
    throw new AppError("conflict", UNIQUE_MESSAGES[p.constraint], { reason: "duplicate_name" });
  }
  throw e;
}
