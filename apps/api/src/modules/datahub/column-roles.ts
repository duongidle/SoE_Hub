import { sql } from "drizzle-orm";
import { AppError } from "@soe/shared";
import type { Executor } from "@soe/db";
import { effectiveType } from "./cell-values";
import type { DhColumn } from "./types";

/**
 * Column roles (design module4 3.7, 7.6). A function of the system (lock a period, forecast, snapshot, Index, the external API) finds a column by
 * ROLE, never by name or key, so a Manager renames, re-formats or re-writes a column without touching code. The set of roles is fixed here: a
 * role means something only when code reads it, so people cannot create one. A table declares which set it uses (`role_set`); a role is held by at
 * most one live column of the table, and a role of the set always has a column (`required`): it moves to another column, it is never left empty.
 */
export interface RoleDef {
  key: string;
  label: string;
  /** Types the column must act as (a formula acts as its result type). */
  types: string[];
  /** The role cannot be left without a column. */
  required: boolean;
  /** Who uses the role, for the "đang dùng" warning (module4 3.7). */
  usedBy: string[];
}

const MONEY = ["currency", "number"];

export const ROLE_SETS: Record<string, { label: string; roles: RoleDef[] }> = {
  deals: {
    label: "Deals",
    roles: [
      { key: "ngay_chot", label: "Ngày chốt (Closing date)", types: ["date", "datetime"], required: true, usedBy: ["Khoá kỳ", "Forecast", "Index", "Snapshot"] },
      { key: "ngay_bat_dau", label: "Ngày bắt đầu (Start date)", types: ["date", "datetime"], required: true, usedBy: ["Team của deal", "Cohort CR1/CR2"] },
      { key: "doanh_thu", label: "Doanh thu", types: MONEY, required: true, usedBy: ["Index", "Forecast", "Com"] },
      { key: "trang_thai", label: "Trạng thái (Status)", types: ["single_select"], required: true, usedBy: ["Khoá kỳ", "Forecast", "BANT", "Index"] },
      { key: "loai_deal", label: "Loại deal", types: ["single_select"], required: true, usedBy: ["Com", "Index"] },
      { key: "nguoi_tham_gia", label: "Người tham gia", types: ["user"], required: true, usedBy: ["Phạm vi xem", "Chia doanh thu và com"] },
      { key: "ma_deal", label: "Mã deal", types: ["text"], required: true, usedBy: ["API ngoài", "Liên kết"] },
      { key: "ten_cong_ty", label: "Tên công ty", types: ["text"], required: false, usedBy: ["Ghép tiền về"] },
      { key: "ngay_du_kien_chot", label: "Ngày dự kiến chốt", types: ["date", "datetime"], required: false, usedBy: ["Forecast", "Snapshot"] },
      { key: "doanh_thu_duoc_tinh", label: "Doanh thu được tính", types: MONEY, required: false, usedBy: ["Dashboard hệ thống", "Index", "KPI"] },
      { key: "gia_tri_hop_dong", label: "Giá trị hợp đồng", types: MONEY, required: false, usedBy: ["Thanh toán", "Forecast"] },
      { key: "da_thu", label: "Đã thu", types: MONEY, required: false, usedBy: ["Thanh toán", "Forecast"] },
      { key: "nguon_lead", label: "Nguồn lead", types: ["single_select", "text"], required: false, usedBy: ["So sánh phiên bản chính sách com"] },
      { key: "level_bc", label: "Level BC", types: ["single_select", "text"], required: false, usedBy: ["So sánh phiên bản chính sách com"] },
      { key: "performance_bc", label: "Performance BC", types: ["single_select", "text"], required: false, usedBy: ["So sánh phiên bản chính sách com"] },
      { key: "bant_b", label: "BANT: Budget", types: ["single_select"], required: false, usedBy: ["BANT"] },
      { key: "bant_a", label: "BANT: Authority", types: ["single_select"], required: false, usedBy: ["BANT"] },
      { key: "bant_n", label: "BANT: Need", types: ["single_select"], required: false, usedBy: ["BANT"] },
      { key: "bant_t", label: "BANT: Timeline", types: ["single_select"], required: false, usedBy: ["BANT"] },
      { key: "bant_cham", label: "Chấm BANT lần cuối", types: ["field_modified", "date", "datetime"], required: false, usedBy: ["Hàng chờ chấm lại"] },
      { key: "muc_uu_tien", label: "Mức ưu tiên", types: ["text", "single_select"], required: false, usedBy: ["View Ưu tiên hôm nay"] },
      { key: "can_cham_lai", label: "Cần chấm lại", types: ["text"], required: false, usedBy: ["Hàng chờ chấm lại"] },
      { key: "ngay_dong_tay", label: "Ngày đóng (sửa tay)", types: ["date", "datetime"], required: false, usedBy: ["Khoá kỳ"] },
      { key: "dot_thanh_toan", label: "Đợt thanh toán (liên kết)", types: ["relation"], required: false, usedBy: ["Lệnh thanh toán (ghi hai chiều với bảng Đợt)"] },
    ],
  },
  payments: {
    label: "Đợt thanh toán",
    roles: [
      { key: "deal", label: "Deal", types: ["relation"], required: true, usedBy: ["Thanh toán"] },
      { key: "so_tien_du_kien", label: "Số tiền dự kiến", types: MONEY, required: true, usedBy: ["Thanh toán"] },
      { key: "han", label: "Hạn", types: ["date", "datetime"], required: true, usedBy: ["Thanh toán"] },
      { key: "ngay_tien_ve", label: "Ngày tiền về", types: ["date", "datetime"], required: true, usedBy: ["Thanh toán", "Sổ com"] },
      { key: "so_tien_ve", label: "Số tiền về", types: MONEY, required: true, usedBy: ["Thanh toán", "Sổ com"] },
      { key: "chia_com_dot", label: "Chia com đợt này", types: ["user"], required: true, usedBy: ["Sổ com"] },
      { key: "ky", label: "Kỳ", types: ["text", "date", "number"], required: true, usedBy: ["Chốt kỳ"] },
      { key: "phap_nhan", label: "Pháp nhân", types: ["text"], required: false, usedBy: ["Ghép tiền về"] },
      { key: "ma_so_thue", label: "Mã số thuế", types: ["text"], required: false, usedBy: ["Ghép tiền về"] },
      { key: "so_hop_dong", label: "Số hợp đồng", types: ["text"], required: false, usedBy: ["Ghép tiền về"] },
      { key: "dot_so", label: "Đợt số", types: ["number"], required: false, usedBy: ["Lệnh thanh toán"] },
      { key: "so_tien_nhan", label: "Số tiền nhận (gồm VAT)", types: MONEY, required: false, usedBy: ["Lệnh thanh toán", "Tiền về"] },
      { key: "tien_ve", label: "Tiền về (liên kết)", types: ["relation"], required: false, usedBy: ["Lệnh thanh toán"] },
      { key: "nguoi_tham_gia", label: "Người tham gia", types: ["user"], required: false, usedBy: ["Phạm vi xem"] },
      { key: "nguon_nhap", label: "Nguồn nhập", types: ["single_select", "text"], required: false, usedBy: ["Lệnh thanh toán"] },
      { key: "da_kiem", label: "Đã kiểm", types: ["checkbox"], required: false, usedBy: ["Chốt kỳ"] },
      { key: "ky_ghi_nhan", label: "Kỳ ghi nhận (Về muộn)", types: ["date", "datetime"], required: false, usedBy: ["Lệnh thanh toán (tiền về muộn vào kỳ đang mở)"] },
    ],
  },
  index: {
    label: "Index",
    roles: [{ key: "thang", label: "Tháng", types: ["date"], required: true, usedBy: ["Worker thêm dòng tháng mới", "Dashboard Deals"] }],
  },
  com_policy: {
    label: "Chính sách com",
    roles: [
      { key: "hieu_luc_tu", label: "Hiệu lực từ", types: ["date", "datetime"], required: true, usedBy: ["Phiên bản chính sách", "So sánh phiên bản"] },
      { key: "nguon_lead", label: "Nguồn lead", types: ["text", "single_select"], required: true, usedBy: ["So sánh phiên bản"] },
      { key: "level", label: "Level", types: ["text", "single_select"], required: true, usedBy: ["So sánh phiên bản"] },
      { key: "performance", label: "Performance", types: ["text", "single_select"], required: true, usedBy: ["So sánh phiên bản"] },
      { key: "ti_le", label: "Tỉ lệ", types: ["percent", "number"], required: true, usedBy: ["So sánh phiên bản"] },
      { key: "doanh_thu_toi_thieu", label: "Doanh thu tối thiểu", types: MONEY, required: false, usedBy: ["So sánh phiên bản"] },
    ],
  },
  com_params: {
    label: "Tham số com",
    roles: [
      { key: "hieu_luc_tu", label: "Hiệu lực từ", types: ["date", "datetime"], required: true, usedBy: ["Tỉ lệ com sale", "Ràng buộc % com"] },
      { key: "ten_tham_so", label: "Tên tham số", types: ["text", "single_select"], required: true, usedBy: ["Tỉ lệ com sale", "Ràng buộc % com"] },
      { key: "gia_tri", label: "Giá trị", types: ["number", "percent", "currency"], required: true, usedBy: ["Tỉ lệ com sale", "Ràng buộc % com"] },
    ],
  },
  ledger: {
    label: "Sổ com",
    roles: [
      { key: "nguoi", label: "Người", types: ["user"], required: true, usedBy: ["Phạm vi xem", "Chốt kỳ"] },
      { key: "dot", label: "Đợt", types: ["relation"], required: true, usedBy: ["Chốt kỳ"] },
      { key: "ky", label: "Kỳ", types: ["text", "date", "number"], required: true, usedBy: ["Chốt kỳ"] },
      { key: "com", label: "Com", types: MONEY, required: true, usedBy: ["Chốt kỳ", "Index"] },
      { key: "trang_thai_com", label: "Trạng thái com", types: ["single_select", "text"], required: true, usedBy: ["Chốt kỳ"] },
      { key: "deal", label: "Deal", types: ["relation"], required: false, usedBy: ["Lệnh thanh toán"] },
      { key: "ty_le_com", label: "% com", types: ["percent", "number"], required: false, usedBy: ["Lệnh thanh toán"] },
      { key: "com_co_dinh", label: "Com cố định (đã chốt / điều chỉnh)", types: MONEY, required: false, usedBy: ["Chốt kỳ", "Điều chỉnh com"] },
      { key: "ly_do", label: "Lý do", types: ["text", "long_text"], required: false, usedBy: ["Điều chỉnh com"] },
      { key: "ky_dot", label: "Kỳ của đợt", types: ["text", "date", "number"], required: false, usedBy: ["Chốt kỳ"] },
      { key: "ky_ghi_nhan", label: "Kỳ ghi nhận (điều chỉnh vào kỳ đang mở)", types: ["date", "datetime"], required: false, usedBy: ["Chốt kỳ", "Điều chỉnh com"] },
    ],
  },
  kpi: {
    label: "Probation KPI",
    roles: [
      { key: "trang_thai_commit", label: "Trạng thái commit", types: ["single_select"], required: true, usedBy: ["Khoá sửa sau commit"] },
      { key: "ly_do_sua", label: "Lý do sửa sau commit", types: ["text", "long_text"], required: false, usedBy: ["Khoá sửa sau commit"] },
    ],
  },
  receipts: {
    label: "Tiền về",
    roles: [
      { key: "ngay_nhan", label: "Ngày nhận", types: ["date", "datetime"], required: true, usedBy: ["Ghép tiền về"] },
      { key: "so_tien", label: "Số tiền (gồm VAT)", types: MONEY, required: true, usedBy: ["Ghép tiền về"] },
      { key: "nguoi_tra", label: "Tên đơn vị trả", types: ["text"], required: true, usedBy: ["Ghép tiền về"] },
      { key: "so_tai_khoan", label: "Số tài khoản", types: ["text"], required: true, usedBy: ["Ghép tiền về"] },
      { key: "ngan_hang", label: "Ngân hàng", types: ["text"], required: false, usedBy: ["Lệnh thanh toán"] },
      { key: "noi_dung", label: "Nội dung chuyển khoản", types: ["text", "long_text"], required: true, usedBy: ["Ghép tiền về"] },
      { key: "dot", label: "Đợt (liên kết)", types: ["relation"], required: true, usedBy: ["Ghép tiền về", "Lệnh thanh toán"] },
      { key: "nguon_nhap", label: "Nguồn nhập", types: ["single_select", "text"], required: false, usedBy: ["Lệnh thanh toán"] },
      { key: "da_kiem", label: "Đã kiểm", types: ["checkbox"], required: false, usedBy: ["Chốt kỳ"] },
    ],
  },
};

export const roleSetOf = (key: string | null | undefined) => (key ? ROLE_SETS[key] ?? null : null);

export const roleDef = (set: string | null | undefined, role: string): RoleDef | null => roleSetOf(set)?.roles.find((r) => r.key === role) ?? null;

/** Does the column still act as a type the role needs (a computed column acts as its result type)? */
export function fitsRole(col: Pick<DhColumn, "type" | "config">, def: RoleDef): boolean {
  return def.types.includes(effectiveType(col));
}

/** The role set of a table; a table without one has no roles. */
export function assertRoleOfSet(set: string | null, role: string): RoleDef {
  const def = roleDef(set, role);
  if (!def) throw new AppError("validation_error", set ? `Vai trò "${role}" không có trong bộ vai trò "${ROLE_SETS[set]?.label ?? set}".` : "Bảng này không dùng vai trò cột.", { reason: "unknown_role" });
  return def;
}

/**
 * Where a column is used (design module4 3.7: "Khoá kỳ, forecast, Dashboard X dùng cột này"): the role and the functions that read it, formulas of any
 * table that read it, views of the table that filter, sort, group or hide it, and metrics and dashboards that point at it. Names only, never values.
 */
export interface ColumnUsage {
  role: { key: string; label: string; used_by: string[] } | null;
  formulas: { table_id: string; table_name: string; column_id: string; column_name: string }[];
  views: { view_id: string; view_name: string }[];
  metrics: { metric_id: string; metric_name: string }[];
  dashboards: { dashboard_id: string; dashboard_name: string }[];
  key_column: boolean;
}

export async function columnUsage(db: Executor, tableId: string, col: Pick<DhColumn, "key" | "role">, roleSet: string | null, keyColumns: string[]): Promise<ColumnUsage> {
  const def = col.role ? roleDef(roleSet, col.role) : null;
  const f = await db.execute(sql`SELECT DISTINCT t.id AS table_id, t.name AS table_name, c.id AS column_id, c.name AS column_name
    FROM dh_formula_deps d JOIN dh_columns c ON c.id = d.column_id AND c.deleted_at IS NULL JOIN dh_tables t ON t.id = c.table_id AND t.deleted_at IS NULL
    WHERE /*scope:system*/ d.src_table_id = ${tableId}::uuid AND d.src_key = ${col.key} AND NOT (c.table_id = ${tableId}::uuid AND c.key = ${col.key})`);
  const like = `%"${col.key}"%`;
  const v = await db.execute(sql`SELECT id AS view_id, name AS view_name FROM dh_views WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL AND config::text LIKE ${like}`);
  const m = await db.execute(sql`SELECT id AS metric_id, name AS metric_name FROM mt_metrics WHERE /*scope:system*/ deleted_at IS NULL AND ${tableId}::uuid = ANY(table_ids) AND config::text LIKE ${like}`);
  const dash = await db.execute(sql`SELECT DISTINCT d.id AS dashboard_id, d.name AS dashboard_name FROM mt_charts c JOIN mt_dashboards d ON d.id = c.dashboard_id AND d.deleted_at IS NULL
    WHERE /*scope:system*/ c.deleted_at IS NULL AND c.config::text LIKE ${like} AND c.config::text LIKE ${`%${tableId}%`}`);
  return {
    role: def ? { key: def.key, label: def.label, used_by: def.usedBy } : null,
    formulas: f.rows as ColumnUsage["formulas"],
    views: v.rows as ColumnUsage["views"],
    metrics: m.rows as ColumnUsage["metrics"],
    dashboards: dash.rows as ColumnUsage["dashboards"],
    key_column: keyColumns.includes(col.key),
  };
}
