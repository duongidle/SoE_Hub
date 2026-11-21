import { AppError } from "@soe/shared";
import type { TableAccess } from "./access";
import type { LoadedRow } from "./column-source";
import type { TableSchema } from "./table-schema";
import type { SelectOption, Stored } from "./types";

/**
 * Guard of the column with role `trang_thai` (design module4 4.4), by the MEANING of the option, never by its name (the Admin renames options):
 * `won` is set (and left) only by the system, in the payment commands (a deal is Won when money arrives); `cancelled` is the Manager's (the owner of the table).
 * Applies to every table whose status column has the role, so no condition names a table.
 */
export function guardStatusMeaning(
  access: TableAccess,
  schema: TableSchema,
  plans: { kind: "create" | "update" | "delete"; id: string; cells: Map<string, Stored> }[],
  loaded: Map<string, LoadedRow>,
  system: boolean,
): void {
  if (system) return;
  const col = schema.alive.find((c) => c.role === "trang_thai" && c.type === "single_select");
  if (!col) return;
  const options = (col.config.options as SelectOption[] | undefined) ?? [];
  const meaning = (v: unknown) => (typeof v === "string" ? options.find((o) => o.id === v)?.meaning : undefined);
  for (const p of plans) {
    if (p.kind === "delete" || !p.cells.has(col.key)) continue;
    const next = p.cells.get(col.key) ?? null;
    const prev = p.kind === "update" ? (loaded.get(p.id)?.data[col.key] ?? null) : null;
    if (next === prev) continue;
    const [nm, pm] = [meaning(next), meaning(prev)];
    if (nm === "won" || pm === "won") {
      throw new AppError("forbidden", "Trạng thái Won do hệ thống đặt khi tiền về đợt đầu (xác nhận tiền về ở bảng Đợt thanh toán). Không chọn tay.", { reason: "status_won_system_only", column: col.name });
    }
    if ((nm === "cancelled" || pm === "cancelled") && access.level !== "owner") {
      throw new AppError("forbidden", "Chỉ Manager đặt hoặc bỏ trạng thái Huỷ.", { reason: "status_cancel_manager_only", column: col.name });
    }
  }
}

/**
 * Plan committed (module4 6): in a table with a column of role `trang_thai_commit`, a row whose status has the meaning `committed` can be changed only
 * by the Manager (the owner of the table), and the change must carry a reason (the column of role `ly_do_sua`). Going from draft to committed is the person's own.
 */
export function guardCommitted(
  access: TableAccess,
  schema: TableSchema,
  plans: { kind: "create" | "update" | "delete"; id: string; cells: Map<string, Stored> }[],
  loaded: Map<string, LoadedRow>,
  system: boolean,
): void {
  if (system) return;
  const col = schema.alive.find((c) => c.role === "trang_thai_commit" && c.type === "single_select");
  if (!col) return;
  const options = (col.config.options as SelectOption[] | undefined) ?? [];
  const reason = schema.alive.find((c) => c.role === "ly_do_sua");
  for (const p of plans) {
    if (p.kind === "create") continue;
    const cur = loaded.get(p.id)?.data[col.key];
    if (options.find((o) => o.id === cur)?.meaning !== "committed") continue;
    if (access.level !== "owner") {
      throw new AppError("forbidden", "Kế hoạch đã commit, chỉ Manager sửa được (kèm lý do).", { reason: "plan_committed_manager_only", row_id: p.id });
    }
    const why = reason ? p.cells.get(reason.key) : null;
    if (p.kind === "update" && reason && !(typeof why === "string" && why.trim())) {
      throw new AppError("validation_error", `Sửa kế hoạch đã commit cần ghi lý do ở cột "${reason.name}".`, { reason: "plan_committed_reason_required", row_id: p.id });
    }
  }
}
