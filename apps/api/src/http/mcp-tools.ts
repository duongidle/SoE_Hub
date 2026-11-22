/**
 * The selective MCP tools (design module5 4.2, 4.4, 12): `deals_list`, `deal_get`, `deal_metrics`, `rows_query`, `rows_write`, `metrics_query`.
 * Each tool only maps an easy input onto registry operations and shapes a compact result; it calls them through the executor (`ctx.call`), so the owner's
 * rights, the connection's menu and level, the split lock and column masking stay in ONE place and no rule lives here.
 *
 * Add a tool: append a `ToolDef` to `selectiveTools()` (design module5 4.8: at most 30 in total; measure first). Mind that every operation the tool calls
 * must pass the menu gate of `core/ai-gate.ts` for the menu in `need`.
 */
import { inArray } from "drizzle-orm";
import { AppError, businessDate, isAppError } from "@soe/shared";
import { users } from "@soe/db";
import { entriesOf, userAttrs } from "../modules/datahub/user-values";
import type { McpCtx, ToolDef } from "./mcp";

type Obj = Record<string, unknown>;
interface Col {
  id: string;
  key: string;
  name: string;
  type: string;
  config: Obj;
  role: string | null;
}
interface Table {
  id: string;
  name: string;
  datahub_id: string;
  columns: Col[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const OBJ = (properties: Obj, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false });
const FILTER_DOC = "Filter: {field,op,value} (op: eq neq gt gte lt lte in nin contains starts_with is_empty is_not_empty between), or {and:[...]} / {or:[...]}. field = column name.";

// ---- columns -------------------------------------------------------------------------------------------------------------

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase().trim();

/** A column by key, name or role (`role:ma_deal`). Unknown: the error lists the names that are closest (module5 4.5). */
function pickCol(cols: Col[], ref: string): Col {
  const r = ref.startsWith("role:") ? ref.slice(5) : ref;
  const hit = cols.find((c) => c.key === ref || c.id === ref) ?? cols.find((c) => norm(c.name) === norm(r)) ?? cols.find((c) => c.role === r);
  if (hit) return hit;
  const near = cols.filter((c) => norm(c.name).includes(norm(r)) || norm(r).includes(norm(c.name))).map((c) => c.name);
  throw new AppError("validation_error", `Không có cột "${ref}".`, { reason: "unknown_column", did_you_mean: near.slice(0, 8), valid_columns: cols.map((c) => c.name).slice(0, 60) });
}
const byRole = (cols: Col[], role: string): Col | undefined => cols.find((c) => c.role === role);

async function loadTable(ctx: McpCtx, tableId: string): Promise<Table> {
  const t = await ctx.call("datahub.table.get", { table_id: tableId });
  return { id: t.id, name: t.name, datahub_id: t.datahub_id, columns: (t.columns as Obj[]).map((c) => ({ id: c.id as string, key: c.key as string, name: c.name as string, type: c.type as string, config: (c.config ?? {}) as Obj, role: (c.role as string | null) ?? null })) };
}

interface HomeTable {
  id: string;
  name: string;
  role_set: string | null;
}
/** The table of a role set (deals, payments, ledger...) among the Deal tables the caller reads. */
async function dealTable(ctx: McpCtx, roleSet: string): Promise<HomeTable | undefined> {
  const home = (await ctx.call("datahub.deal.home", {})) as { tables: HomeTable[] };
  return home.tables.find((t) => t.role_set === roleSet);
}

const optionsOf = (c: Col): { id: string; name: string; meaning?: string | null }[] => (Array.isArray(c.config.options) ? (c.config.options as { id: string; name: string; meaning?: string | null }[]) : []);

// ---- values ------------------------------------------------------------------------------------------------------------------

type PeopleMap = Map<string, { name: string; email: string | null }>;

async function peopleOf(ctx: McpCtx, ids: string[]): Promise<PeopleMap> {
  const m: PeopleMap = new Map();
  const uniq = [...new Set(ids)];
  if (!uniq.length) return m;
  const rows = await ctx.db.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(inArray(users.id, uniq));
  for (const r of rows) m.set(r.id, { name: r.name, email: r.email });
  return m;
}

/** One cell in machine form: people as {name,email,...attributes}, select options already by name (`labels=true`), dates ISO, money as numbers. */
function cellOut(col: Col, v: unknown, people: PeopleMap): unknown {
  if (v === undefined || v === null) return null;
  if (col.type === "user") {
    const attrs = userAttrs(col as never);
    const list = entriesOf(v).map((e) => {
      const p = people.get(e.id);
      const extra: Obj = {};
      for (const a of attrs) if (e.attrs[a.key] !== undefined) extra[a.key] = e.attrs[a.key];
      return { name: p?.name ?? e.id, email: p?.email ?? null, ...extra };
    });
    return typeof v === "string" ? (list[0] ?? null) : list;
  }
  return v;
}

function userIdsIn(cols: Col[], items: { data: Obj }[]): string[] {
  const out: string[] = [];
  for (const c of cols) if (c.type === "user") for (const it of items) for (const e of entriesOf(it.data[c.key])) out.push(e.id);
  return out;
}

interface Page {
  items: { id: string; version?: number; data: Obj; can_edit?: boolean }[];
  nextCursor: string | null;
  total?: number;
  extra?: { consistency?: { stale: boolean; columns: string[] } };
}

/** `{columns, rows, total, next_cursor}` with `_id` and `_version` first (module5 4.4): no field names repeated per row. */
async function tableOut(ctx: McpCtx, cols: Col[], page: Page): Promise<Obj> {
  const people = await peopleOf(ctx, userIdsIn(cols, page.items));
  const stale = page.extra?.consistency?.stale === true;
  return {
    columns: ["_id", "_version", ...cols.map((c) => c.name)],
    rows: page.items.map((it) => [it.id, it.version ?? null, ...cols.map((c) => cellOut(c, it.data[c.key], people))]),
    ...(page.total !== undefined ? { total: page.total } : {}),
    next_cursor: page.nextCursor,
    ...(stale ? { stale: true, pending_columns: page.extra!.consistency!.columns } : {}),
  };
}

function clampLimit(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(v))) : DEFAULT_LIMIT;
}

/** Sort as `[{field, dir}]`, or `"Name:desc"` text, onto the JSON the list operation takes. */
function sortParam(raw: unknown, cols: Col[]): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const items: Obj[] = Array.isArray(raw) ? (raw as Obj[]) : String(raw).split(",").map((p) => { const [field = "", dir = "asc"] = p.split(":"); return { field: field.trim(), dir: dir.trim() }; });
  return JSON.stringify(items.map((i) => ({ field: pickCol(cols, String(i.field)).key, dir: i.dir === "desc" ? "desc" : "asc", ...(i.nulls ? { nulls: i.nulls } : {}) })));
}

/** Filter with column names, roles or keys -> keys (the list operation also accepts names; keys survive a renamed column). */
function filterOf(node: unknown, cols: Col[]): unknown {
  if (node === undefined || node === null) return undefined;
  const n = node as Obj;
  if (Array.isArray(n.and)) return { and: n.and.map((x) => filterOf(x, cols)) };
  if (Array.isArray(n.or)) return { or: n.or.map((x) => filterOf(x, cols)) };
  const f = String(n.field ?? "");
  if (f.startsWith("_")) return n;
  return { ...n, field: pickCol(cols, f).key };
}

const and = (list: unknown[]) => (list.length === 0 ? undefined : list.length === 1 ? list[0] : { and: list });

async function listPage(ctx: McpCtx, tableId: string, input: Obj): Promise<Page> {
  return (await ctx.callRaw("datahub.row.list", { table_id: tableId, labels: "true", include_total: "true", consistent: "true", ...input })) as Page;
}

// ---- rows_query / rows_write ---------------------------------------------------------------------------------------------

const rowsQuery: ToolDef = {
  name: "rows_query",
  description: "Read rows of a table (any Datahub or Deal table). Columns by name. Returns {columns,rows,total,next_cursor}; _id and _version come first. Waits up to 5 s for formulas after a write (stale:true if not done).",
  inputSchema: OBJ(
    {
      table_id: { type: "string", description: "Table id (see datahub_list or soe_whoami)." },
      filter: { type: "object", description: FILTER_DOC },
      sort: { type: "array", items: OBJ({ field: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } }, ["field"]) },
      fields: { type: "array", items: { type: "string" }, description: "Column names to return. Default: all you can see." },
      search: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, description: `Default ${DEFAULT_LIMIT}.` },
      cursor: { type: "string", description: "next_cursor of the previous page." },
    },
    ["table_id"],
  ),
  annotations: { readOnlyHint: true, title: "Query rows" },
  need: { menus: ["deal", "datahub"], access: "read" },
  async run(ctx, a) {
    const t = await loadTable(ctx, String(a.table_id ?? ""));
    const cols = Array.isArray(a.fields) && a.fields.length ? (a.fields as string[]).map((f) => pickCol(t.columns, f)) : t.columns;
    const page = await listPage(ctx, t.id, {
      fields: ["_version", ...cols.map((c) => c.key)].join(","),
      filter: filterOf(a.filter, t.columns),
      sort: sortParam(a.sort, t.columns),
      search: typeof a.search === "string" && a.search ? a.search : undefined,
      limit: clampLimit(a.limit),
      cursor: typeof a.cursor === "string" ? a.cursor : undefined,
    });
    return tableOut(ctx, cols, page);
  },
};

interface WriteRow {
  id?: string;
  version?: number;
  base?: Obj;
  data?: Obj;
}
const MAX_WRITE_ROWS = 500;

const rowsWrite: ToolDef = {
  name: "rows_write",
  description: "Create, update or upsert up to 500 rows of a table. A row with an error is skipped whole (never half written); the rest are saved. Returns written ids, skipped rows with reasons, and seq.",
  inputSchema: OBJ(
    {
      table_id: { type: "string" },
      rows: {
        type: "array",
        maxItems: MAX_WRITE_ROWS,
        items: OBJ(
          {
            id: { type: "string", description: "Set to update this row. Needs version (from rows_query _version) or base." },
            version: { type: "integer" },
            base: { type: "object", description: "Values you read, by column name (instead of version)." },
            data: { type: "object", description: "Cells by column name. People: email. Select: option name. Empty/null clears." },
          },
          ["data"],
        ),
      },
      key: { type: "string", description: "Unique column name: rows without id are upserted by it instead of created." },
    },
    ["table_id", "rows"],
  ),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, title: "Write rows" },
  need: { menus: ["deal", "datahub"], access: "write" },
  async run(ctx, a) {
    const tableId = String(a.table_id ?? "");
    const rows = (Array.isArray(a.rows) ? a.rows : []) as WriteRow[];
    if (rows.length === 0) throw new AppError("validation_error", "Cần ít nhất một dòng trong rows.");
    if (rows.length > MAX_WRITE_ROWS) throw new AppError("validation_error", `Tối đa ${MAX_WRITE_ROWS} dòng một lần; gọi nhiều lần.`, { reason: "too_many_rows", max: MAX_WRITE_ROWS });
    const key = typeof a.key === "string" && a.key ? a.key : null;
    const skipped: { row: number; reason: string; column?: string }[] = [];
    // `live` keeps the position of each row in the caller's list; the engine reports positions in what we send.
    let live: { at: number; op: Obj }[] = [];
    rows.forEach((r, at) => {
      if (!r || typeof r.data !== "object" || r.data === null) return void skipped.push({ row: at, reason: "Thiếu data." });
      if (r.id) {
        if (r.version === undefined && !r.base) return void skipped.push({ row: at, reason: "Sửa dòng cần version (từ _version của rows_query) hoặc base." });
        live.push({ at, op: { op: "update", id: r.id, data: r.data, ...(r.version !== undefined ? { version: r.version } : {}), ...(r.base ? { base: r.base } : {}) } });
      } else live.push({ at, op: key ? { op: "upsert", key, data: r.data } : { op: "create", data: r.data } });
    });
    for (let round = 0; round < 5 && live.length > 0; round++) {
      try {
        const r = (await ctx.call("datahub.row.batch", { table_id: tableId, ops: live.map((x) => x.op), labels: "true" })) as { results: { outcome: string; id: string }[]; seq: number };
        const results = live.map((x, i) => ({ row: x.at, id: r.results[i]!.id, outcome: r.results[i]!.outcome }));
        return { written: results.length, results, skipped, seq: r.seq };
      } catch (e) {
        const bad = badRows(e, live);
        if (!bad) throw e;
        for (const b of bad) skipped.push({ row: live[b.index]!.at, reason: b.reason, ...(b.column ? { column: b.column } : {}) });
        const drop = new Set(bad.map((b) => b.index));
        live = live.filter((_, i) => !drop.has(i));
      }
    }
    if (live.length > 0) throw new AppError("validation_error", "Còn lỗi sau nhiều lần bỏ dòng sai; kiểm tra skipped.", { skipped });
    return { written: 0, results: [], skipped, seq: null };
  },
};

/** Rows a failed batch blames, by position in what was sent (issues of cell checks, or one named row); null = the failure is not about particular rows. */
function badRows(e: unknown, live: { op: Obj }[]): { index: number; reason: string; column?: string }[] | null {
  if (!isAppError(e)) return null;
  const d = (e.details ?? {}) as Obj;
  if (e.code === "validation_error" && Array.isArray(d.issues) && d.issues.length) {
    const out = new Map<number, { index: number; reason: string; column?: string }>();
    for (const i of d.issues as { row?: number; column?: string; message?: string }[]) {
      if (typeof i.row !== "number" || i.row < 0 || i.row >= live.length) return null;
      if (!out.has(i.row)) out.set(i.row, { index: i.row, reason: String(i.message ?? e.message), ...(i.column ? { column: i.column } : {}) });
    }
    return [...out.values()];
  }
  const rowNo = typeof d.row === "number" ? d.row : null;
  if (rowNo !== null && rowNo >= 0 && rowNo < live.length) return [{ index: rowNo, reason: e.message }];
  const rid = typeof d.row_id === "string" ? d.row_id : null;
  if (rid) {
    const i = live.findIndex((x) => x.op.id === rid);
    if (i >= 0) return [{ index: i, reason: e.message }];
  }
  if (e.code === "conflict" || e.code === "validation_error") {
    const conflicts = [...(Array.isArray(d.conflicts) ? d.conflicts : []), ...(Array.isArray(d.version_conflicts) ? d.version_conflicts : [])] as { row_id?: string }[];
    const idx = conflicts.map((c) => live.findIndex((x) => x.op.id === c.row_id)).filter((i) => i >= 0);
    if (idx.length) return [...new Set(idx)].map((index) => ({ index, reason: "Dòng đã bị người khác sửa. Đọc lại rồi ghi lại." }));
  }
  return null;
}

// ---- Deals -----------------------------------------------------------------------------------------------------------------------

const DEAL_DEFAULT_ROLES = ["ma_deal", "ten_cong_ty", "trang_thai", "loai_deal", "doanh_thu", "doanh_thu_duoc_tinh", "ngay_bat_dau", "ngay_chot", "ngay_du_kien_chot", "nguoi_tham_gia"];
const STATUS_MEANINGS = ["open", "won", "lost", "disqualified", "converted", "cancelled"];

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** A period word onto `[from, to]` (Việt Nam date): this_quarter, last_quarter, this_month, last_month, YYYY-MM, YYYY-Qn, YYYY. */
function periodRange(p: unknown, today: string): { from: string; to: string } {
  if (p && typeof p === "object") {
    const o = p as { from?: string; to?: string };
    if (o.from && o.to) return { from: o.from, to: o.to };
  }
  const s = String(p ?? "");
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const quarter = (yy: number, q: number) => ({ from: `${yy}-${pad(q * 3 + 1)}-01`, to: `${yy}-${pad(q * 3 + 3)}-${pad(lastDay(yy, q * 3 + 3))}` });
  const month = (yy: number, mm: number) => ({ from: `${yy}-${pad(mm)}-01`, to: `${yy}-${pad(mm)}-${pad(lastDay(yy, mm))}` });
  const q0 = Math.floor((m - 1) / 3);
  if (s === "this_quarter") return quarter(y, q0);
  if (s === "last_quarter") return q0 === 0 ? quarter(y - 1, 3) : quarter(y, q0 - 1);
  if (s === "this_month") return month(y, m);
  if (s === "last_month") return m === 1 ? month(y - 1, 12) : month(y, m - 1);
  let g = /^(\d{4})-(\d{2})$/.exec(s);
  if (g) return month(Number(g[1]), Number(g[2]));
  g = /^(\d{4})-Q([1-4])$/i.exec(s);
  if (g) return quarter(Number(g[1]), Number(g[2]) - 1);
  g = /^(\d{4})$/.exec(s);
  if (g) return { from: `${g[1]}-01-01`, to: `${g[1]}-12-31` };
  throw new AppError("validation_error", `Kỳ "${s}" không hợp lệ.`, { reason: "bad_period", valid: ["this_quarter", "last_quarter", "this_month", "last_month", "YYYY-MM", "YYYY-Qn", "YYYY", "{from,to}"] });
}

const needCol = (cols: Col[], role: string): Col => {
  const c = byRole(cols, role);
  if (!c) throw new AppError("validation_error", `Bảng Deals chưa có cột giữ vai trò "${role}".`, { reason: "role_missing", role });
  return c;
};

async function dealsTable(ctx: McpCtx): Promise<Table> {
  const t = await dealTable(ctx, "deals");
  if (!t) throw new AppError("not_found", "Bạn chưa có bảng Deals (cây của bạn chưa được dựng bảng mặc định).");
  return loadTable(ctx, t.id);
}

const dealsList: ToolDef = {
  name: "deals_list",
  description: "List deals you can see (same rows as the Deals grid). Filter by status meaning, deal type, period, mine/team, text. Returns {columns,rows,total,next_cursor}; _id and _version first.",
  inputSchema: OBJ({
    status: { type: "string", description: `Status meaning (${STATUS_MEANINGS.join(", ")}) or an option name.` },
    deal_type: { type: "string", description: "Deal type option name." },
    period: { description: "this_quarter, last_quarter, this_month, last_month, YYYY-MM, YYYY-Qn, YYYY or {from,to}." },
    period_mode: { type: "string", enum: ["related", "received", "closed", "expected"], description: "related (default): started by period end and still open or closed in/after it; received: Start date in period; closed: Closing date in period; expected: open, expected close in period." },
    scope: { type: "string", enum: ["mine", "team"], description: "mine: deals I take part in. team (default): everything my role may see." },
    search: { type: "string" },
    filter: { type: "object", description: FILTER_DOC },
    fields: { type: "array", items: { type: "string" }, description: "Column names or roles (role:doanh_thu). Default: a compact set." },
    sort: { type: "array", items: OBJ({ field: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } }, ["field"]) },
    limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    cursor: { type: "string" },
  }),
  annotations: { readOnlyHint: true, title: "List deals" },
  need: { menus: ["deal"], access: "read" },
  async run(ctx, a) {
    const t = await dealsTable(ctx);
    const cols = Array.isArray(a.fields) && a.fields.length ? (a.fields as string[]).map((f) => pickCol(t.columns, f)) : DEAL_DEFAULT_ROLES.map((r) => byRole(t.columns, r)).filter((c): c is Col => !!c);
    const f: unknown[] = [];
    const today = businessDate(new Date());
    const status = byRole(t.columns, "trang_thai");
    const namesOf = (meaning: string) => (status ? optionsOf(status).filter((o) => o.meaning === meaning).map((o) => o.name) : []);
    const openNames = namesOf("open");
    if (typeof a.status === "string" && a.status) {
      const s = needCol(t.columns, "trang_thai");
      const want = STATUS_MEANINGS.includes(a.status) ? namesOf(a.status) : optionsOf(s).filter((o) => norm(o.name) === norm(String(a.status))).map((o) => o.name);
      if (!want.length) throw new AppError("validation_error", `Không có trạng thái "${a.status}".`, { reason: "unknown_status", meanings: STATUS_MEANINGS, options: optionsOf(s).map((o) => o.name) });
      f.push({ field: s.key, op: "in", value: want });
    }
    if (typeof a.deal_type === "string" && a.deal_type) {
      const c = needCol(t.columns, "loai_deal");
      const want = optionsOf(c).filter((o) => norm(o.name) === norm(String(a.deal_type))).map((o) => o.name);
      if (!want.length) throw new AppError("validation_error", `Không có loại deal "${a.deal_type}".`, { reason: "unknown_option", options: optionsOf(c).map((o) => o.name) });
      f.push({ field: c.key, op: "in", value: want });
    }
    if (a.period !== undefined && a.period !== null && a.period !== "") {
      const r = periodRange(a.period, today);
      const mode = typeof a.period_mode === "string" ? a.period_mode : "related";
      const start = needCol(t.columns, "ngay_bat_dau");
      const close = needCol(t.columns, "ngay_chot");
      const closedNames = status ? optionsOf(status).filter((o) => o.meaning !== "open").map((o) => o.name) : [];
      if (mode === "received") f.push({ field: start.key, op: "between", value: [r.from, r.to] });
      else if (mode === "closed") f.push({ field: needCol(t.columns, "trang_thai").key, op: "in", value: closedNames }, { field: close.key, op: "between", value: [r.from, r.to] });
      else if (mode === "expected") f.push({ field: needCol(t.columns, "trang_thai").key, op: "in", value: openNames }, { field: needCol(t.columns, "ngay_du_kien_chot").key, op: "between", value: [r.from, r.to] });
      else f.push({ field: start.key, op: "lte", value: r.to }, { or: [{ field: needCol(t.columns, "trang_thai").key, op: "in", value: openNames }, { field: close.key, op: "gte", value: r.from }] });
    }
    if (a.scope === "mine") {
      const people = t.columns.filter((c) => c.role === "nguoi_tham_gia");
      if (!people.length) throw new AppError("validation_error", "Bảng Deals chưa có cột Người tham gia.", { reason: "role_missing", role: "nguoi_tham_gia" });
      f.push(people.length === 1 ? { field: people[0]!.key, op: "eq", value: ctx.actor.userId } : { or: people.map((c) => ({ field: c.key, op: "eq", value: ctx.actor.userId })) });
    }
    const own = filterOf(a.filter, t.columns);
    if (own) f.push(own);
    const page = await listPage(ctx, t.id, {
      fields: ["_version", ...cols.map((c) => c.key)].join(","),
      filter: and(f),
      sort: sortParam(a.sort, t.columns),
      search: typeof a.search === "string" && a.search ? a.search : undefined,
      limit: clampLimit(a.limit),
      cursor: typeof a.cursor === "string" ? a.cursor : undefined,
    });
    return tableOut(ctx, cols, page);
  },
};

/** The rows of a Deal side table (payments, ledger) that belong to one deal, through its `deal` relation column. */
async function sideRows(ctx: McpCtx, roleSet: string, dealId: string): Promise<Obj | null> {
  const ht = await dealTable(ctx, roleSet);
  if (!ht) return null;
  const t = await loadTable(ctx, ht.id);
  const rel = byRole(t.columns, "deal");
  if (!rel) return null;
  const page = await listPage(ctx, t.id, { filter: { field: rel.key, op: "eq", value: dealId }, limit: 100, fields: ["_version", ...t.columns.map((c) => c.key)].join(",") });
  return { table: t.name, ...(await tableOut(ctx, t.columns, page)) };
}

const dealGet: ToolDef = {
  name: "deal_get",
  description: "One deal: every column you may see, participants, payment instalments, your commission ledger lines and the last changes.",
  inputSchema: OBJ(
    {
      deal_id: { type: "string", description: "_id from deals_list." },
      include: { type: "array", items: { type: "string", enum: ["payments", "com", "history"] }, description: "Default all three." },
    },
    ["deal_id"],
  ),
  annotations: { readOnlyHint: true, title: "Get deal" },
  need: { menus: ["deal"], access: "read" },
  async run(ctx, a) {
    const id = String(a.deal_id ?? "");
    const t = await dealsTable(ctx);
    const row = (await ctx.call("datahub.row.get", { table_id: t.id, row_id: id, labels: "true", consistent: "true" })) as { id: string; version: number; data: Obj; can_edit?: boolean; consistency?: { stale: boolean; columns: string[] } };
    const people = await peopleOf(ctx, userIdsIn(t.columns, [row]));
    const data: Obj = {};
    for (const c of t.columns) if (row.data[c.key] !== undefined && row.data[c.key] !== null) data[c.name] = cellOut(c, row.data[c.key], people);
    const participants = t.columns.filter((c) => c.role === "nguoi_tham_gia").flatMap((c) => {
      const v = cellOut(c, row.data[c.key], people);
      return Array.isArray(v) ? v : v ? [v] : [];
    });
    const want = Array.isArray(a.include) ? (a.include as string[]) : ["payments", "com", "history"];
    const out: Obj = { id: row.id, version: row.version, can_edit: row.can_edit ?? true, data, participants, ...(row.consistency?.stale ? { stale: true } : {}) };
    if (want.includes("payments")) out.payments = await sideRows(ctx, "payments", id);
    if (want.includes("com")) out.com = await sideRows(ctx, "ledger", id);
    if (want.includes("history")) {
      const h = (await ctx.call("datahub.row.history", { table_id: t.id, row_id: id, limit: 10 })) as { items: { version: number; op: string; at: string; changes: { field_name: string | null; old: unknown; new: unknown }[] }[] };
      out.history = h.items.map((x) => ({ version: x.version, op: x.op, at: x.at, changes: x.changes.map((c) => ({ column: c.field_name, old: c.old, new: c.new })) }));
    }
    return out;
  },
};

const dealMetrics: ToolDef = {
  name: "deal_metrics",
  description: "Deal numbers of your tree's system dashboard \"Deals\" (revenue counted for me, deal count, commission, forecast, CR1/CR2 cohorts, revenue by deal type), computed for you. Same figures as the screen.",
  inputSchema: OBJ({
    names: { type: "array", items: { type: "string" }, description: "Chart titles or parts of them. Default: all KPI figures." },
    filters: { type: "object", description: "Dashboard filter, e.g. {range:{kind:\"preset\",preset:\"this_quarter\"}}." },
  }),
  annotations: { readOnlyHint: true, title: "Deal metrics" },
  need: { menus: ["deal"], access: "read" },
  async run(ctx, a) {
    const ref = (await ctx.call("deal.dashboard", {})) as { dashboard_id: string | null };
    if (!ref.dashboard_id) throw new AppError("not_found", "Cây của bạn chưa có dashboard hệ thống Deals.");
    const view = (await ctx.call("metrics.dashboard.view", { dashboard_id: ref.dashboard_id })) as { charts: { id: string; chart: { type?: string; title?: string } }[] };
    const names = Array.isArray(a.names) ? (a.names as string[]).map(norm) : null;
    const pick = view.charts.filter((c) => (names ? names.some((n) => norm(c.chart.title ?? "").includes(n)) : c.chart.type === "kpi"));
    const metrics: Obj[] = [];
    for (const c of pick) {
      const r = (await ctx.call("metrics.chart.data", { chart_id: c.id, ...(a.filters ? { filters: a.filters } : {}) })) as { series?: { rows?: Obj[] }[] };
      const s = r.series ?? [];
      if (c.chart.type === "kpi") metrics.push({ name: c.chart.title, value: (s[0]?.rows?.[0] as { value?: unknown } | undefined)?.value ?? null });
      else metrics.push({ name: c.chart.title, type: c.chart.type, series: s.map((x) => x.rows ?? []) });
    }
    return { dashboard: "Deals", metrics, available: view.charts.map((c) => c.chart.title).filter(Boolean) };
  },
};

const metricsQuery: ToolDef = {
  name: "metrics_query",
  description: "Compute any metric on a table with JSON (sum/count/avg..., group by, time range, filter). Numbers are computed on the server within your rights; do not add up rows yourself.",
  inputSchema: OBJ({
    metric: { type: "object", description: "{name, source: table name or id, measure:{agg,field}, filter?, time?:{field,bucket?,range?}, group_by?, formula?}. field/group_by may be a column name or role:<role>." },
    metric_id: { type: "string", description: "A saved metric instead of metric." },
    datahub_id: { type: "string", description: "Needed when source is a table name." },
    time: { type: "object" },
    group_by: { type: "array", items: { type: "string" } },
    filter: { type: "object", description: FILTER_DOC },
    order: { type: "string", enum: ["group", "value_desc", "value_asc"] },
    limit: { type: "integer" },
    compare: { type: "string", enum: ["previous_period", "year_ago", "none"] },
    top: { type: "integer" },
  }),
  annotations: { readOnlyHint: true, title: "Metric query" },
  need: { menus: ["deal", "datahub"], access: "read" },
  async run(ctx, a) {
    // A table id as the source needs its datahub to find the menu (core/ai-gate.ts `menuOfTarget`): fill it in so the AI need not know it.
    const src = (a.metric as { source?: unknown } | undefined)?.source;
    if (!a.datahub_id && typeof src === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(src)) {
      return ctx.call("metrics.query", { ...a, datahub_id: (await loadTable(ctx, src)).datahub_id });
    }
    return ctx.call("metrics.query", a);
  },
};

export function selectiveTools(): ToolDef[] {
  return [dealsList, dealGet, dealMetrics, rowsQuery, rowsWrite, metricsQuery];
}
