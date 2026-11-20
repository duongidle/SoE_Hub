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
  dh_columns_custom_name_uq: "Bạn đã có một cột riêng tên này trong bảng. Hãy đặt tên khác.",
  dh_columns_role_uq: "Đã có một cột khác giữ vai trò này.",
  dh_templates_name_uq: "Cây này đã có một bảng template tên này. Hãy đặt tên khác.",
  mt_sources_name_uq: "Datahub này đã có một nguồn dữ liệu tên này. Hãy đặt tên khác.",
  mt_metrics_name_uq: "Datahub này đã có một chỉ số tên này. Hãy đặt tên khác.",
  mt_dashboards_name_uq: "Datahub này đã có một dashboard tên này. Hãy đặt tên khác.",
};

/** Turns a unique violation on a name index into a Vietnamese `conflict`; rethrows everything else. */
export function rethrowNameConflict(e: unknown): never {
  const p = pgError(e);
  if (p.code === "23505" && p.constraint && UNIQUE_MESSAGES[p.constraint]) {
    throw new AppError("conflict", UNIQUE_MESSAGES[p.constraint], { reason: "duplicate_name" });
  }
  throw e;
}

/**
 * Refusals of the split lock and shared editing (design module2 section 10). Each is `forbidden` (or `validation_error` for a bad value) with a
 * stable `reason` the screen can react to. The message never holds a cell value.
 */
export const DH_REASON = {
  columnNotEditable: "column_not_editable",
  rowNotEditable: "row_not_editable",
  bulkCreateOff: "bulk_create_off",
  userNotMember: "user_not_member",
  rowOutsideScope: "row_outside_scope",
  keyColumn: "key_column_rule",
} as const;

export const columnNotEditable = (names: string[]): never => {
  throw new AppError("forbidden", `Cột ${names.map((n) => `"${n}"`).join(", ")} không cho phép bạn sửa. Chỉ chủ bảng sửa được.`, { reason: DH_REASON.columnNotEditable, columns: names });
};

export const rowNotEditable = (rowId: string): never => {
  throw new AppError("forbidden", "Bạn thấy dòng này nhưng chưa được sửa: dòng của người khác chỉ Manager (hoặc Leader khi người đó cho phép) mới sửa được.", { reason: DH_REASON.rowNotEditable, row_id: rowId });
};

export const bulkCreateOff = (): never => {
  throw new AppError("forbidden", "Chủ bảng không cho thành viên thêm nhiều dòng một lúc (nhập file, dán, API hàng loạt). Hãy thêm từng dòng.", { reason: DH_REASON.bulkCreateOff });
};

export const rowOutsideScope = (): never => {
  throw new AppError("forbidden", "Dòng mới phải thuộc về bạn hoặc người bạn quản lý, nếu không bạn sẽ không thấy nó.", { reason: DH_REASON.rowOutsideScope });
};
