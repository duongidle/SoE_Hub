import { z } from "zod";

/**
 * The DEFAULT SET of template tables (design module4 1.2, 3.1, 3.3, 4, 5, 6, 9): declared as data, never as code per table. A new tree (a new Manager)
 * gets a copy of this set; the Admin edits the set in `deal.default_templates` and the edit only reaches trees created afterwards (module4 3.1).
 * Everything here is an ordinary table, column and formula of the Datahub engine: the columns are made by the same commands as any template column,
 * the computed ones are Excel-style formulas (no function of the system knows about deals), and functions of the system find columns by ROLE.
 *
 * Not in this set yet, on purpose (they need the payment schedule or other later steps): Giá trị hợp đồng, Số đợt, Thanh toán, Com dự kiến của tôi, Com của deal,
 * Doanh thu tính cho tôi (a formula per person), Mức ưu tiên (BANT), the Index columns for revenue and forecast, Probation KPI "Đã đạt / Còn thiếu / % đạt".
 * `Ngày tiền về đầu tiên` and `Đã thu` are plain date and money columns for now; the payment step turns them into roll-ups of the payment table.
 * NO real figures of the commission policy are here: the two policy tables are created empty (the Manager fills them).
 */
const NAME = z.string().trim().min(1).max(100);

export const DefaultColumnSchema = z.strictObject({
  name: NAME,
  type: z.string().min(1).max(40),
  config: z.record(z.string(), z.unknown()).optional(),
  /** Template layer: `basic` (everyone) or `role` (only the people with `layer_roles`). */
  layer: z.enum(["basic", "role"]).default("basic"),
  layer_roles: z.array(z.enum(["manager", "leader", "user"])).min(1).optional(),
  storage: z.enum(["shared", "person"]).default("shared"),
  role: z.string().max(60).optional(),
  allow_edit: z.boolean().default(false),
  required: z.boolean().optional(),
  default_value: z.unknown().optional(),
  description: z.string().max(1000).optional(),
  /** Hidden in the default grid view (the column is still there). */
  hidden: z.boolean().optional(),
  autofill: z.strictObject({ column: NAME, attr: z.string().min(1).max(30), sum: z.enum(["team", "tree"]).optional() }).optional(),
});

export const DefaultTableSchema = z.strictObject({
  name: NAME,
  kind: z.enum(["shared", "personal"]),
  role_set: z.string().max(40).optional(),
  member_permission: z.enum(["view", "edit_data"]).default("view"),
  /** "Leader được thêm cột team" (module4 3.8). */
  leader_can_add_columns: z.boolean().default(false),
  /** The split lock: key columns (by name) and the main key. Off when absent. */
  split: z.strictObject({ columns: z.array(NAME).min(1).max(5), primary: NAME.optional() }).optional(),
  columns: z.array(DefaultColumnSchema).min(1).max(150),
  /** Columns added after every table of the set exists (two tables that link to each other: a link column needs its target table first). */
  late_columns: z.array(DefaultColumnSchema).max(50).optional(),
});

export const DefaultSetSchema = z.array(DefaultTableSchema).min(1).max(20);
export type DefaultColumn = z.input<typeof DefaultColumnSchema>;
export type DefaultTable = z.input<typeof DefaultTableSchema>;

// ------------------------------------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------------------------------------

const opts = (names: string[], meaning?: Record<string, string>) => ({ options: names.map((n) => ({ name: n, ...(meaning?.[n] ? { meaning: meaning[n] } : {}) })) });
const LOAI_DEAL = ["POD bán mới", "POD CSM", "POD Express", "PS kèm POD", "PS không kèm POD", "Data"];
const STATUS = ["Processing", "Pending", "Won", "Lost", "Disqualified", "Convert to POD", "Huỷ"];
const STATUS_MEANING = { Processing: "open", Pending: "open", Won: "won", Lost: "lost", Disqualified: "disqualified", "Convert to POD": "converted", Huỷ: "cancelled" };
const LEVELS = Array.from({ length: 10 }, (_, i) => `Level ${i}`);

// ------------------------------------------------------------------------------------------------
// Chính sách com, Tham số com (module4 9): structure only, filled by the Manager
// ------------------------------------------------------------------------------------------------

const PARAMS: DefaultTable = {
  name: "Tham số com",
  kind: "shared",
  role_set: "com_params",
  member_permission: "view",
  columns: [
    { name: "Hiệu lực từ", type: "date", role: "hieu_luc_tu", required: true },
    { name: "Tên tham số", type: "text", role: "ten_tham_so", required: true },
    { name: "Giá trị", type: "number", role: "gia_tri" },
  ],
};

const POLICY: DefaultTable = {
  name: "Chính sách com",
  kind: "shared",
  role_set: "com_policy",
  member_permission: "view",
  columns: [
    { name: "Hiệu lực từ", type: "date", role: "hieu_luc_tu", required: true },
    { name: "Nguồn lead", type: "text", role: "nguon_lead", description: "ML (Marketing Lead) hoặc SH (Sale Hunt)." },
    { name: "Level", type: "text", role: "level", description: "Level 0 đến Level 9." },
    { name: "Performance", type: "text", role: "performance", description: "Under KPI, KPI, Goal, Out performance." },
    { name: "Doanh thu tối thiểu", type: "currency", role: "doanh_thu_toi_thieu" },
    { name: "Tỉ lệ", type: "percent", role: "ti_le" },
  ],
};

// ------------------------------------------------------------------------------------------------
// Deals (module4 4.1-4.5)
// ------------------------------------------------------------------------------------------------

/** The date a commission policy is looked up at: the closing date, or the expected one while the deal is open. */
const POLICY_DATE = 'IF([Closing date]="",[Ngày dự kiến chốt],[Closing date])';
const latest = (table: string, extra = "") => `MAXIFS([${table}].[Hiệu lực từ],${extra}[${table}].[Hiệu lực từ],"<="&${POLICY_DATE})`;
const TI_LE_COM_SALE =
  `=IF(OR([Loại deal]="POD bán mới",[Loại deal]="POD CSM"),IF(OR([Nguồn lead]="",[Level BC]="",[Performance BC]=""),"",` +
  `SUMIFS([Chính sách com].[Tỉ lệ],[Chính sách com].[Hiệu lực từ],${latest("Chính sách com")},[Chính sách com].[Nguồn lead],[Nguồn lead],[Chính sách com].[Level],[Level BC],[Chính sách com].[Performance],[Performance BC])),` +
  `IF([Nhóm dịch vụ]="PS",SUMIFS([Tham số com].[Giá trị],[Tham số com].[Tên tham số],"Tỉ lệ PS POD",[Tham số com].[Hiệu lực từ],${latest("Tham số com", '[Tham số com].[Tên tham số],"Tỉ lệ PS POD",')}),""))`;


// ------------------------------------------------------------------------------------------------
// BANT and the queue "Cần chấm lại hôm nay" (module4 8): the rule H-002 is a FORMULA of the template, the Admin or Manager edits it when the criteria change
// ------------------------------------------------------------------------------------------------
const BANT_LEVELS = ["Có bằng chứng", "Chưa rõ", "Âm"];
const PRIORITY = ["P1 – Ưu tiên cao", "P2 – Ưu tiên trung bình", "P3 – Ưu tiên thấp", "Chưa đủ dữ liệu", "Không đánh giá"];
const isNeg = ["Budget", "Authority", "Need", "Timeline"].map((n) => `[${n}]="Âm"`).join(",");
const BANT_AUTO =
  '=IF([Nhóm dịch vụ]<>"POD","Không đánh giá",IF(OR([Budget]="",[Authority]="",[Need]="",[Timeline]=""),"Chưa chấm",' +
  `IF(OR(${isNeg}),"P3 – Ưu tiên thấp",` +
  'IF(OR([Need]="Chưa rõ",AND([Budget]="Chưa rõ",[Authority]="Chưa rõ",[Timeline]="Chưa rõ")),"Chưa đủ dữ liệu",' +
  'IF(AND([Need]="Có bằng chứng",[Authority]="Có bằng chứng",OR([Budget]="Có bằng chứng",[Timeline]="Có bằng chứng")),"P1 – Ưu tiên cao","P2 – Ưu tiên trung bình")))))';
const BANT_ORDER =
  '=IF([Mức ưu tiên]="P1 – Ưu tiên cao",1,IF([Mức ưu tiên]="P2 – Ưu tiên trung bình",2,IF([Mức ưu tiên]="Chưa đủ dữ liệu",3,IF([Mức ưu tiên]="P3 – Ưu tiên thấp",4,5))))';
/** Open POD deals only; never scored, last scored over 7 days ago, closing within 14 days and last scored over 3 days ago, or Status / expected closing date / revenue changed since. */
const BANT_RECHECK =
  '=IF(AND(OR([Status]="Processing",[Status]="Pending"),[Nhóm dịch vụ]="POD",[Mức ưu tiên ghi đè]<>"Không đánh giá"),' +
  'IF([Chấm BANT lần cuối]="","Chưa chấm lần nào",' +
  'IF(TODAY()-INT([Chấm BANT lần cuối])>7,"Quá 7 ngày",' +
  'IF(AND([Ngày dự kiến chốt]<>"",[Ngày dự kiến chốt]-TODAY()<=14,TODAY()-INT([Chấm BANT lần cuối])>3),"Sắp chốt, quá 3 ngày",' +
  'IF(INT([Ngày đổi dữ liệu deal])>INT([Chấm BANT lần cuối]),"Dữ liệu deal đã đổi","")))),"")';
const BANT_COLUMNS: DefaultColumn[] = [
  { name: "Budget", type: "single_select", config: opts(BANT_LEVELS), role: "bant_b", allow_edit: true },
  { name: "Authority", type: "single_select", config: opts(BANT_LEVELS), role: "bant_a", allow_edit: true },
  { name: "Need", type: "single_select", config: opts(BANT_LEVELS), role: "bant_n", allow_edit: true },
  { name: "Timeline", type: "single_select", config: opts(BANT_LEVELS), role: "bant_t", allow_edit: true },
  { name: "Chấm BANT lần cuối", type: "field_modified", config: { watch: ["Budget", "Authority", "Need", "Timeline"] }, role: "bant_cham", description: "Lúc người dùng sửa một trong bốn cột B, A, N, T lần cuối. Lịch sử mỗi lần chấm nằm trong lịch sử dòng." },
  { name: "Ngày đổi dữ liệu deal", type: "field_modified", config: { watch: ["Status", "Ngày dự kiến chốt", "Doanh thu dự kiến"] }, hidden: true },
  { name: "Mức ưu tiên tự tính", type: "formula", config: { formula: BANT_AUTO, result_type: "text" }, description: "Quy tắc H-002 (Module 4 mục 8). Sửa công thức khi có tiêu chí mới." },
  { name: "Mức ưu tiên ghi đè", type: "single_select", config: opts(PRIORITY), allow_edit: true, description: "Chọn để ghi đè mức tự tính." },
  { name: "Mức ưu tiên", type: "formula", config: { formula: '=IF([Mức ưu tiên ghi đè]<>"",[Mức ưu tiên ghi đè],[Mức ưu tiên tự tính])', result_type: "text" }, role: "muc_uu_tien" },
  { name: "Thứ tự ưu tiên", type: "formula", config: { formula: BANT_ORDER, result_type: "number" }, role: "thu_tu_uu_tien", hidden: true, description: "Để sắp view \"Ưu tiên hôm nay\": 1 = P1 ... 5 = còn lại." },
  { name: "Cần chấm lại", type: "formula", config: { formula: BANT_RECHECK, result_type: "text" }, role: "can_cham_lai", description: "Hàng chờ \"Cần chấm lại hôm nay\": khác rỗng là deal cần chấm lại (lý do ghi trong ô)." },
];

const PEOPLE = "Người tham gia";
const DOT_TABLE = "Đợt thanh toán";
const DOT_LINK = "Đợt thanh toán";
/** `Com dự kiến` = value of the deal (contract value, or Doanh thu when no schedule) × commission rate × the person's share. */
const COM_DU_KIEN = (pct: string): string => `=IF([Tỉ lệ com sale]="",0,IF([Giá trị hợp đồng]>0,[Giá trị hợp đồng],[Doanh thu])*[Tỉ lệ com sale]*[${pct}])`;
/** `Com chờ nhận` = the part of the contract not yet paid × commission rate × the person's share. */
const COM_CHO_NHAN = (pct: string): string => `=IF([Tỉ lệ com sale]="",0,MAX(0,[Giá trị hợp đồng]-[Đã thu])*[Tỉ lệ com sale]*[${pct}])`;
const DEALS: DefaultTable = {
  name: "Deals",
  kind: "shared",
  role_set: "deals",
  member_permission: "edit_data",
  split: { columns: [PEOPLE], primary: PEOPLE },
  columns: [
    { name: "Tên công ty", type: "text", role: "ten_cong_ty", required: true, allow_edit: true },
    { name: "Loại deal", type: "single_select", config: opts(LOAI_DEAL), role: "loai_deal", required: true },
    { name: "Start date", type: "date", role: "ngay_bat_dau", required: true, allow_edit: true },
    { name: "Ngày dự kiến chốt", type: "date", role: "ngay_du_kien_chot", allow_edit: true },
    { name: "Status", type: "single_select", config: opts(STATUS, STATUS_MEANING), role: "trang_thai", default_value: "Processing", allow_edit: true, description: "Won chỉ do hệ thống đặt khi tiền về đợt đầu; Huỷ chỉ Manager." },
    { name: "Ngày đổi Status", type: "field_modified", config: { watch: ["Status"] }, hidden: true },
    { name: "Ngày đóng (sửa tay)", type: "date", role: "ngay_dong_tay", description: "Manager nhập khi biết ngày chính xác hơn ngày tự tính." },
    { name: DOT_LINK, type: "relation", config: { target_table: DOT_TABLE, multiple: true }, role: "dot_thanh_toan", hidden: true, description: "Ghi bởi lệnh lập lịch thanh toán." },
    { name: "Ngày tiền về đầu tiên", type: "rollup", config: { relation: DOT_LINK, target_column: "Ngày tiền về", fn: "min" }, hidden: true, description: "Ngày tiền về sớm nhất trong các đợt của deal (bảng Đợt thanh toán)." },
    {
      name: "Closing date",
      type: "formula",
      config: { formula: '=IF([Ngày đóng (sửa tay)]<>"",[Ngày đóng (sửa tay)],IF([Status]="Won",[Ngày tiền về đầu tiên],IF(OR([Status]="Lost",[Status]="Disqualified",[Status]="Convert to POD",[Status]="Huỷ"),INT([Ngày đổi Status]),"")))', result_type: "date" },
      role: "ngay_chot",
    },
    { name: "Ghi chú", type: "long_text", allow_edit: true },
    { name: "Sale", type: "text", allow_edit: true, description: "Email hoặc tên sale (sale không phải người dùng SoE Hub)." },
    { name: "Doanh thu dự kiến", type: "currency", allow_edit: true },
    { name: "Đã thu", type: "rollup", config: { relation: DOT_LINK, target_column: "Số tiền về (chưa VAT)", fn: "sum" }, role: "da_thu", hidden: true, description: "Tổng số tiền về (chưa VAT) của các đợt của deal." },
    { name: "Doanh thu", type: "formula", config: { formula: '=IF([Status]="Won",[Đã thu],[Doanh thu dự kiến])', result_type: "number" }, role: "doanh_thu" },
    { name: "Nguồn lead", type: "single_select", role: "nguon_lead", config: opts(["ML", "SH"]), allow_edit: true },
    { name: "Level BC", type: "single_select", role: "level_bc", config: opts(LEVELS), allow_edit: true },
    { name: "Performance BC", type: "single_select", role: "performance_bc", config: opts(["Under KPI", "KPI", "Goal", "Out performance"]), allow_edit: true },
    { name: "Mã số thuế", type: "text", allow_edit: true },
    { name: "Nhóm dịch vụ", type: "formula", config: { formula: '=IF(LEFT([Loại deal],3)="POD","POD",IF(LEFT([Loại deal],2)="PS","PS","Khác"))', result_type: "text" }, hidden: true },
    { name: "Mã deal", type: "formula", config: { formula: '="D-"&TEXT(ROW_NO(),"000000")', result_type: "text" }, role: "ma_deal" },
    { name: "Tỉ lệ com sale", type: "formula", config: { formula: TI_LE_COM_SALE, result_type: "percent" } },
    ...BANT_COLUMNS,
    {
      name: PEOPLE,
      type: "user",
      role: "nguoi_tham_gia",
      config: {
        attrs: [
          { key: "vai_tro", label: "Vai trò", kind: "select", options: ["Leading", "Associate", "Advisor"] },
          { key: "ty_le_dt", label: "% doanh thu", kind: "percent", default: 0, sum_max: 1, default_when: { attr: "vai_tro", value: "Leading", set: 1, only_one: true } },
          { key: "ty_le_com", label: "% com", kind: "percent", default: 0, cap_param: "Tỉ lệ SoE" },
          { key: "tinh_deal", label: "Tính vào số deal", kind: "boolean", default: false, default_when: { attr: "vai_tro", value: "Leading", set: true } },
        ],
      },
    },
    // "Gửi xuống": the system fills these from the people above, one value per reader (module4 4.5).
    { name: "Vai trò của tôi", type: "text", storage: "person", autofill: { column: PEOPLE, attr: "vai_tro" }, hidden: true },
    { name: "% doanh thu của tôi", type: "percent", storage: "person", autofill: { column: PEOPLE, attr: "ty_le_dt" }, hidden: true },
    { name: "% Com cá nhân", type: "percent", storage: "person", autofill: { column: PEOPLE, attr: "ty_le_com" }, hidden: true },
    { name: "Tính vào số deal của tôi", type: "checkbox", storage: "person", autofill: { column: PEOPLE, attr: "tinh_deal" }, hidden: true },
    { name: "Tổng % com đã chia", type: "percent", storage: "person", autofill: { column: PEOPLE, attr: "ty_le_com", sum: "tree" }, layer: "role", layer_roles: ["manager"] },
    { name: "% com của team", type: "percent", storage: "person", autofill: { column: PEOPLE, attr: "ty_le_com", sum: "team" }, layer: "role", layer_roles: ["leader"] },
    { name: "% doanh thu của team", type: "percent", storage: "person", autofill: { column: PEOPLE, attr: "ty_le_dt", sum: "team" }, layer: "role", layer_roles: ["leader"] },
    { name: "Giá trị hợp đồng", type: "rollup", config: { relation: DOT_LINK, target_column: "Số tiền dự kiến (chưa VAT)", fn: "sum" }, role: "gia_tri_hop_dong", description: "Tổng số tiền dự kiến (chưa VAT) của các đợt. Deal chưa có lịch thì 0." },
    // One value per reader (the formulas read person-stored columns, module4 3.4): each person sees their own figure.
    { name: "Doanh thu tính cho tôi", type: "formula", config: { formula: "=[Doanh thu]*[% doanh thu của tôi]", result_type: "number" }, role: "doanh_thu_duoc_tinh", description: "Doanh thu của deal × % doanh thu của mình. Mỗi người một giá trị." },
    { name: "Com dự kiến của tôi", type: "formula", config: { formula: COM_DU_KIEN("% Com cá nhân"), result_type: "number" }, description: "Tạm tính: giá trị hợp đồng (deal chưa có lịch thì Doanh thu) × Tỉ lệ com sale × % Com cá nhân. Mỗi người một giá trị." },
    { name: "Com chờ nhận của tôi", type: "formula", config: { formula: COM_CHO_NHAN("% Com cá nhân"), result_type: "number" }, description: "Các đợt chưa về × Tỉ lệ com sale × % Com cá nhân." },
    { name: "Doanh thu của team", type: "formula", config: { formula: "=[Doanh thu]*[% doanh thu của team]", result_type: "number" }, layer: "role", layer_roles: ["leader"] },
    { name: "Com dự kiến của team", type: "formula", config: { formula: COM_DU_KIEN("% com của team"), result_type: "number" }, layer: "role", layer_roles: ["leader"] },
    { name: "Com chờ nhận của team", type: "formula", config: { formula: COM_CHO_NHAN("% com của team"), result_type: "number" }, layer: "role", layer_roles: ["leader"] },
  ],
  // Columns that read the ledger, a table made after Deals.
  late_columns: [
    { name: "Sổ com", type: "relation", config: { target_table: "Sổ com", multiple: true }, role: "so_com", hidden: true, description: "Ghi bởi lệnh xác nhận tiền về và điều chỉnh com." },
    { name: "Com đã nhận của tôi", type: "rollup", config: { relation: "Sổ com", target_column: "Com đã nhận", fn: "sum" }, description: "Dòng Sổ com đã chốt hoặc điều chỉnh mà bạn đọc được (Sổ com theo khoá phân chia)." },
    { name: "Com tạm tính của tôi", type: "rollup", config: { relation: "Sổ com", target_column: "Com tạm tính", fn: "sum" }, description: "Dòng Sổ com Tạm tính mà bạn đọc được." },
    { name: "Com của deal", type: "rollup", config: { relation: "Sổ com", target_column: "Com", fn: "sum" }, layer: "role", layer_roles: ["manager"], description: "Mọi dòng Sổ com của deal (chỉ Manager thấy)." },
  ],
};

// ------------------------------------------------------------------------------------------------
// Index (module4 5): one row per month, count columns over Deals. Revenue and forecast columns come with the payment step.
// ------------------------------------------------------------------------------------------------

const GROUPS: { name: string; types: string[] }[] = [
  { name: "Tổng", types: LOAI_DEAL.filter((t) => t !== "Data") },
  { name: "POD", types: ["POD bán mới", "POD CSM"] },
  { name: "PS", types: ["PS kèm POD", "PS không kèm POD"] },
  { name: "POD Express", types: ["POD Express"] },
];
const MONTH = (col: string) => `[Deals].[${col}],">="&[Tháng],[Deals].[${col}],"<"&EDATE([Tháng],1)`;
/** Count of the deals of the given types in the month, by the date column; `mine`: only deals the reader counts as theirs (a person's own Index). */
function count(types: string[], dateCol: string, status: string | null, mine: boolean): string {
  const flag = mine ? ',[Deals].[Tính vào số deal của tôi],TRUE' : "";
  const st = status ? `,[Deals].[Status],"${status}"` : "";
  return types.map((t) => `COUNTIFS([Deals].[Loại deal],"${t}",${MONTH(dateCol)}${st}${flag})`).join("+");
}

function indexColumns(): DefaultColumn[] {
  const cols: DefaultColumn[] = [{ name: "Tháng", type: "date", role: "thang", required: true, description: "Ngày đầu tháng. Worker thêm dòng tháng mới vào ngày 1." }];
  const f = (name: string, formula: string, result: string, extra: Partial<DefaultColumn> = {}): void => {
    cols.push({ name, type: "formula", config: { formula: `=${formula}`, result_type: result }, ...extra });
  };
  for (const g of GROUPS) {
    const n = (label: string) => `${label} ${g.name}`;
    f(n("Nhận"), count(g.types, "Start date", null, true), "number");
    f(n("Disqualified"), count(g.types, "Start date", "Disqualified", true), "number");
    f(n("Pending"), count(g.types, "Start date", "Pending", true), "number");
    f(n("Qualified"), `[${n("Nhận")}]-[${n("Disqualified")}]`, "number");
    f(n("Lost"), count(g.types, "Closing date", "Lost", true), "number");
    f(n("Won"), count(g.types, "Closing date", "Won", true), "number");
  }
  f("CR1", 'IF([Nhận Tổng]=0,"",[Qualified Tổng]/[Nhận Tổng])', "percent");
  f("CR2", 'IF([Qualified Tổng]=0,"",[Won Tổng]/[Qualified Tổng])', "percent");
  // Leader and Manager also see the team / the tree: every deal they see once, not only the ones they count as theirs.
  const team = { layer: "role" as const, layer_roles: ["leader", "manager"] as ("leader" | "manager")[] };
  const g0 = GROUPS[0]!;
  f("Nhận (team)", count(g0.types, "Start date", null, false), "number", team);
  f("Disqualified (team)", count(g0.types, "Start date", "Disqualified", false), "number", team);
  f("Qualified (team)", "[Nhận (team)]-[Disqualified (team)]", "number", team);
  f("Lost (team)", count(g0.types, "Closing date", "Lost", false), "number", team);
  f("Won (team)", count(g0.types, "Closing date", "Won", false), "number", team);
  f("CR1 (team)", 'IF([Nhận (team)]=0,"",[Qualified (team)]/[Nhận (team)])', "percent", team);
  f("CR2 (team)", 'IF([Qualified (team)]=0,"",[Won (team)]/[Qualified (team)])', "percent", team);
  return cols;
}

const INDEX: DefaultTable = { name: "Index", kind: "personal", role_set: "index", leader_can_add_columns: true, columns: indexColumns() };

// ------------------------------------------------------------------------------------------------
// Probation KPI (module4 6): the plan. "Đã đạt / Còn thiếu / % đạt" come with the payment step.
// ------------------------------------------------------------------------------------------------

const KPI: DefaultTable = {
  name: "Probation KPI",
  kind: "shared",
  role_set: "kpi",
  member_permission: "edit_data",
  leader_can_add_columns: true,
  split: { columns: ["Người"], primary: "Người" },
  columns: [
    { name: "Người", type: "user" },
    { name: "Năm", type: "number", role: "nam", required: true, allow_edit: true },
    { name: "KPI Software", type: "currency", allow_edit: true },
    { name: "KPI Non-software", type: "currency", allow_edit: true },
    { name: "KPI tổng", type: "formula", config: { formula: "=[KPI Software]+[KPI Non-software]", result_type: "number" } },
    { name: "Hệ số Goal", type: "number", default_value: 1.5, allow_edit: true },
    { name: "Goal", type: "formula", config: { formula: "=[KPI tổng]*[Hệ số Goal]", result_type: "number" } },
    { name: "% Q1", type: "percent", allow_edit: true },
    { name: "% Q2", type: "percent", allow_edit: true },
    { name: "% Q3", type: "percent", allow_edit: true },
    { name: "% Q4", type: "percent", allow_edit: true },
    { name: "Deal size", type: "currency", allow_edit: true },
    { name: "CR1", type: "percent", default_value: 0.9, allow_edit: true },
    { name: "CR2", type: "percent", allow_edit: true },
    { name: "Cycle (ngày) cam kết", type: "number", allow_edit: true },
    { name: "Trạng thái", type: "single_select", config: opts(["Nháp", "Đã commit"], { "Đã commit": "committed" }), role: "trang_thai_commit", default_value: "Nháp", allow_edit: true },
    { name: "Ngày commit", type: "field_modified", config: { watch: ["Trạng thái"] }, description: "Ngày đổi Trạng thái lần cuối (lúc commit)." },
    { name: "Lý do sửa sau commit", type: "text", role: "ly_do_sua", allow_edit: true, description: "Manager ghi khi sửa kế hoạch đã commit." },
    ...[1, 2, 3, 4].flatMap((q): DefaultColumn[] => [
      { name: `KPI Q${q}`, type: "formula", config: { formula: `=[KPI tổng]*[% Q${q}]`, result_type: "number" } },
      { name: `Goal Q${q}`, type: "formula", config: { formula: `=[Goal]*[% Q${q}]`, result_type: "number" } },
    ]),
    { name: "Số deal cần thắng", type: "formula", config: { formula: '=IF([Deal size]=0,"",[KPI tổng]/[Deal size])', result_type: "number" } },
    { name: "Lead cần nhận", type: "formula", config: { formula: '=IF([CR1]*[CR2]=0,"",[Số deal cần thắng]/([CR1]*[CR2]))', result_type: "number" } },
  ],
};


// ------------------------------------------------------------------------------------------------
// Tiền về, Đợt thanh toán, Sổ com (module4 7): payments and commission by instalment. Rows are written by the payment commands (module4 7.4).
// ------------------------------------------------------------------------------------------------

const SOURCE = opts(["Tay", "AI", "API"]);
const COM_ONLY = { attrs: [{ key: "ty_le_com", label: "% com", kind: "percent", default: 0, cap_param: "Tỉ lệ SoE" }] };
const PEOPLE_ATTRS = DEALS.columns.find((c) => c.name === PEOPLE)!.config!;

/** The bank transfers (module4 7.3a). Manager only: the key column of the split lock is never filled, so a member reads no row. */
const RECEIPTS: DefaultTable = {
  name: "Tiền về",
  kind: "shared",
  role_set: "receipts",
  member_permission: "view",
  split: { columns: ["Người xem"], primary: "Người xem" },
  columns: [
    { name: "Ngày nhận", type: "date", role: "ngay_nhan", required: true },
    { name: "Số tiền (gồm VAT)", type: "currency", role: "so_tien", required: true },
    { name: "Tên đơn vị trả", type: "text", role: "nguoi_tra" },
    { name: "Số tài khoản", type: "text", role: "so_tai_khoan" },
    { name: "Ngân hàng", type: "text", role: "ngan_hang" },
    { name: "Nội dung chuyển khoản", type: "long_text", role: "noi_dung" },
    { name: "Nguồn nhập", type: "single_select", config: SOURCE, role: "nguon_nhap", default_value: "Tay" },
    { name: "Đã kiểm", type: "checkbox", role: "da_kiem" },
    { name: "Người xem", type: "user", hidden: true, description: "Luôn để trống: bảng chỉ Manager đọc." },
  ],
  late_columns: [
    { name: "Đợt", type: "relation", config: { target_table: DOT_TABLE, multiple: true }, role: "dot" },
    { name: "Đã phân bổ", type: "rollup", config: { relation: "Đợt", target_column: "Số tiền nhận (gồm VAT)", fn: "sum" } },
    { name: "Còn lại", type: "formula", config: { formula: "=[Số tiền (gồm VAT)]-[Đã phân bổ]", result_type: "number" } },
    { name: "Trạng thái", type: "formula", config: { formula: '=IF([Đã phân bổ]=0,"Chưa ghép",IF([Còn lại]>0,"Ghép một phần","Đã ghép"))', result_type: "text" } },
  ],
};

/** One row per instalment of a contract (module4 7.2). */
const PAYMENTS: DefaultTable = {
  name: DOT_TABLE,
  kind: "shared",
  role_set: "payments",
  member_permission: "view",
  split: { columns: [PEOPLE], primary: PEOPLE },
  columns: [
    { name: "Pháp nhân", type: "text", role: "phap_nhan" },
    { name: "Mã số thuế", type: "text", role: "ma_so_thue" },
    { name: "Số hợp đồng", type: "text", role: "so_hop_dong" },
    { name: "Đợt số", type: "number", role: "dot_so" },
    { name: "Số tiền dự kiến (chưa VAT)", type: "currency", role: "so_tien_du_kien", required: true },
    { name: "Hạn", type: "date", role: "han", required: true },
    { name: "Ngày tiền về", type: "date", role: "ngay_tien_ve" },
    { name: "Số tiền về (chưa VAT)", type: "currency", role: "so_tien_ve" },
    { name: "Số tiền nhận (gồm VAT)", type: "currency", role: "so_tien_nhan" },
    { name: "Tiền về", type: "relation", config: { target_table: "Tiền về", multiple: false }, role: "tien_ve" },
    { name: "Chia com đợt này", type: "user", config: COM_ONLY, role: "chia_com_dot", layer: "role", layer_roles: ["manager"] },
    {
      name: "Trạng thái",
      type: "formula",
      config: { formula: '=IF([Ngày tiền về]<>"",IF([Số tiền về (chưa VAT)]<[Số tiền dự kiến (chưa VAT)],"Về thiếu","Đã về"),IF([Hạn]="","Chưa đến hạn",IF([Hạn]<TODAY(),"Quá hạn",IF([Hạn]-TODAY()<=7,"Sắp đến hạn","Chưa đến hạn"))))', result_type: "text" },
    },
    { name: "Kỳ ghi nhận", type: "date", role: "ky_ghi_nhan", hidden: true, description: "Chỉ có khi tiền về có ngày thuộc tháng đã chốt (Về muộn): tháng đang mở mà đợt được ghi nhận. Hệ thống đặt." },
    { name: "Kỳ", type: "formula", config: { formula: '=IF([Kỳ ghi nhận]<>"",[Kỳ ghi nhận],IF([Ngày tiền về]="","",DATE(YEAR([Ngày tiền về]),MONTH([Ngày tiền về]),1)))', result_type: "date" }, role: "ky" },
    { name: "Về muộn", type: "formula", config: { formula: '=IF([Kỳ ghi nhận]<>"","Về muộn","")', result_type: "text" } },
    { name: PEOPLE, type: "user", config: PEOPLE_ATTRS, role: "nguoi_tham_gia" },
    { name: "Nguồn nhập", type: "single_select", config: SOURCE, role: "nguon_nhap", default_value: "Tay" },
    { name: "Đã kiểm", type: "checkbox", role: "da_kiem" },
  ],
  late_columns: [{ name: "Deal", type: "relation", config: { target_table: "Deals", multiple: false }, role: "deal", required: true }],
};

/** One row per person per instalment (module4 7.3). `Tạm tính` rows are formulas; closed and adjusted rows keep a fixed amount in `Com cố định`. */
const LEDGER: DefaultTable = {
  name: "Sổ com",
  kind: "shared",
  role_set: "ledger",
  member_permission: "view",
  split: { columns: ["Người"], primary: "Người" },
  columns: [
    { name: "Người", type: "user", role: "nguoi", required: true },
    { name: "Đợt", type: "relation", config: { target_table: DOT_TABLE, multiple: false }, role: "dot", required: true },
    { name: "Deal", type: "relation", config: { target_table: "Deals", multiple: false }, role: "deal" },
    { name: "Kỳ của đợt", type: "lookup", config: { relation: "Đợt", target_column: "Kỳ" }, role: "ky_dot" },
    { name: "Kỳ ghi nhận", type: "date", role: "ky_ghi_nhan", hidden: true, description: "Dòng Điều chỉnh: tháng đang mở mà khoản điều chỉnh được ghi vào. Bỏ trống thì theo kỳ của đợt." },
    { name: "Kỳ", type: "formula", config: { formula: '=IF([Kỳ ghi nhận]<>"",[Kỳ ghi nhận],[Kỳ của đợt])', result_type: "date" }, role: "ky" },
    { name: "Số tiền về", type: "lookup", config: { relation: "Đợt", target_column: "Số tiền về (chưa VAT)" } },
    { name: "Tỉ lệ com sale", type: "lookup", config: { relation: "Deal", target_column: "Tỉ lệ com sale" } },
    { name: "Com sale", type: "formula", config: { formula: '=IF([Tỉ lệ com sale]="","",[Số tiền về]*[Tỉ lệ com sale])', result_type: "number" } },
    { name: "% com", type: "percent", role: "ty_le_com" },
    { name: "Com cố định", type: "currency", role: "com_co_dinh", description: "Số cứng của dòng Đã chốt / Điều chỉnh." },
    { name: "Trạng thái", type: "single_select", config: opts(["Tạm tính", "Đã chốt", "Điều chỉnh"], { "Tạm tính": "ledger_temp", "Đã chốt": "ledger_closed", "Điều chỉnh": "ledger_adjust" }), role: "trang_thai_com", default_value: "Tạm tính" },
    { name: "Com", type: "formula", config: { formula: '=IF([Trạng thái]="Tạm tính",IF([Com sale]="","",[Com sale]*[% com]),[Com cố định])', result_type: "number" }, role: "com" },
    { name: "Lý do", type: "text", role: "ly_do" },
    { name: "Com đã nhận", type: "formula", config: { formula: '=IF(OR([Trạng thái]="Đã chốt",[Trạng thái]="Điều chỉnh"),IF([Com]="",0,[Com]),0)', result_type: "number" }, description: "Com của dòng đã chốt hoặc điều chỉnh (Deals cộng cột này)." },
    { name: "Com tạm tính", type: "formula", config: { formula: '=IF([Trạng thái]="Tạm tính",IF([Com]="",0,[Com]),0)', result_type: "number" }, description: "Com của dòng Tạm tính (Deals cộng cột này)." },
  ],
};

/** The built-in default set, in dependency order: a table that a formula reads is made before it. */
export const BUILTIN_DEFAULT_SET: DefaultTable[] = [PARAMS, POLICY, RECEIPTS, PAYMENTS, DEALS, INDEX, KPI, LEDGER];
