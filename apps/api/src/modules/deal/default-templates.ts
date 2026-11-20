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
  member_permission: "view",
  columns: [
    { name: "Hiệu lực từ", type: "date", required: true },
    { name: "Nguồn lead", type: "text", description: "ML (Marketing Lead) hoặc SH (Sale Hunt)." },
    { name: "Level", type: "text", description: "Level 0 đến Level 9." },
    { name: "Performance", type: "text", description: "Under KPI, KPI, Goal, Out performance." },
    { name: "Doanh thu tối thiểu", type: "currency" },
    { name: "Tỉ lệ", type: "percent" },
  ],
};

// ------------------------------------------------------------------------------------------------
// Deals (module4 4.1-4.5)
// ------------------------------------------------------------------------------------------------

/** The date a commission policy is looked up at: the closing date, or the expected one while the deal is open. */
const POLICY_DATE = 'IF([Closing date]="",[Ngày dự kiến chốt],[Closing date])';
const latest = (table: string, extra = "") => `MAXIFS([${table}].[Hiệu lực từ],${extra}[${table}].[Hiệu lực từ],"<="&${POLICY_DATE})`;
const TI_LE_COM_SALE =
  `=IF(OR([Loại deal]="POD bán mới",[Loại deal]="POD CSM"),` +
  `SUMIFS([Chính sách com].[Tỉ lệ],[Chính sách com].[Hiệu lực từ],${latest("Chính sách com")},[Chính sách com].[Nguồn lead],[Nguồn lead],[Chính sách com].[Level],[Level BC],[Chính sách com].[Performance],[Performance BC]),` +
  `IF([Nhóm dịch vụ]="PS",SUMIFS([Tham số com].[Giá trị],[Tham số com].[Tên tham số],"Tỉ lệ PS POD",[Tham số com].[Hiệu lực từ],${latest("Tham số com", '[Tham số com].[Tên tham số],"Tỉ lệ PS POD",')}),""))`;

const PEOPLE = "Người tham gia";
const DEALS: DefaultTable = {
  name: "Deals",
  kind: "shared",
  role_set: "deals",
  member_permission: "edit_data",
  split: { columns: [PEOPLE], primary: PEOPLE },
  columns: [
    { name: "Tên công ty", type: "text", required: true, allow_edit: true },
    { name: "Loại deal", type: "single_select", config: opts(LOAI_DEAL), role: "loai_deal", required: true },
    { name: "Start date", type: "date", role: "ngay_bat_dau", required: true, allow_edit: true },
    { name: "Ngày dự kiến chốt", type: "date", role: "ngay_du_kien_chot", allow_edit: true },
    { name: "Status", type: "single_select", config: opts(STATUS, STATUS_MEANING), role: "trang_thai", default_value: "Processing", allow_edit: true, description: "Won chỉ do hệ thống đặt khi tiền về đợt đầu; Huỷ chỉ Manager." },
    { name: "Ngày đổi Status", type: "field_modified", config: { watch: ["Status"] }, hidden: true },
    { name: "Ngày đóng (sửa tay)", type: "date", description: "Manager nhập khi biết ngày chính xác hơn ngày tự tính." },
    { name: "Ngày tiền về đầu tiên", type: "date", hidden: true, description: "Sẽ thành roll-up của bảng Đợt thanh toán." },
    {
      name: "Closing date",
      type: "formula",
      config: { formula: '=IF([Ngày đóng (sửa tay)]<>"",[Ngày đóng (sửa tay)],IF([Status]="Won",[Ngày tiền về đầu tiên],IF(OR([Status]="Lost",[Status]="Disqualified",[Status]="Convert to POD",[Status]="Huỷ"),INT([Ngày đổi Status]),"")))', result_type: "date" },
      role: "ngay_chot",
    },
    { name: "Ghi chú", type: "long_text", allow_edit: true },
    { name: "Sale", type: "text", allow_edit: true, description: "Email hoặc tên sale (sale không phải người dùng SoE Hub)." },
    { name: "Doanh thu dự kiến", type: "currency", allow_edit: true },
    { name: "Đã thu", type: "currency", role: "da_thu", hidden: true, description: "Sẽ thành roll-up của bảng Đợt thanh toán." },
    { name: "Doanh thu", type: "formula", config: { formula: '=IF([Status]="Won",[Đã thu],[Doanh thu dự kiến])', result_type: "number" }, role: "doanh_thu" },
    { name: "Nguồn lead", type: "single_select", config: opts(["ML", "SH"]), allow_edit: true },
    { name: "Level BC", type: "single_select", config: opts(LEVELS), allow_edit: true },
    { name: "Performance BC", type: "single_select", config: opts(["Under KPI", "KPI", "Goal", "Out performance"]), allow_edit: true },
    { name: "Mã số thuế", type: "text", allow_edit: true },
    { name: "Nhóm dịch vụ", type: "formula", config: { formula: '=IF(LEFT([Loại deal],3)="POD","POD",IF(LEFT([Loại deal],2)="PS","PS","Khác"))', result_type: "text" }, hidden: true },
    { name: "Mã deal", type: "formula", config: { formula: '="D-"&TEXT(ROW_NO(),"000000")', result_type: "text" }, role: "ma_deal" },
    { name: "Tỉ lệ com sale", type: "formula", config: { formula: TI_LE_COM_SALE, result_type: "percent" } },
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
  member_permission: "edit_data",
  leader_can_add_columns: true,
  split: { columns: ["Người"], primary: "Người" },
  columns: [
    { name: "Người", type: "user" },
    { name: "Năm", type: "number", required: true, allow_edit: true },
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
    { name: "Trạng thái", type: "single_select", config: opts(["Nháp", "Đã commit"]), default_value: "Nháp", allow_edit: true },
    { name: "Ngày commit", type: "date" },
    ...[1, 2, 3, 4].flatMap((q): DefaultColumn[] => [
      { name: `KPI Q${q}`, type: "formula", config: { formula: `=[KPI tổng]*[% Q${q}]`, result_type: "number" } },
      { name: `Goal Q${q}`, type: "formula", config: { formula: `=[Goal]*[% Q${q}]`, result_type: "number" } },
    ]),
    { name: "Số deal cần thắng", type: "formula", config: { formula: '=IF([Deal size]=0,"",[KPI tổng]/[Deal size])', result_type: "number" } },
    { name: "Lead cần nhận", type: "formula", config: { formula: '=IF([CR1]*[CR2]=0,"",[Số deal cần thắng]/([CR1]*[CR2]))', result_type: "number" } },
  ],
};

/** The built-in default set, in dependency order: a table that a formula reads is made before it. */
export const BUILTIN_DEFAULT_SET: DefaultTable[] = [PARAMS, POLICY, DEALS, INDEX, KPI];
