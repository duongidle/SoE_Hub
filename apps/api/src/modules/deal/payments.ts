import { assertComCap, assertComTotal, peopleCell, peopleIds, participantsOf, type Participant } from "./participants";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, businessDate } from "@soe/shared";
import { assertPeriodOpen } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import type { TableAccess } from "../datahub/access";
import { sourceOf } from "../datahub/column-source";
import { applyRowOps, type RowOp } from "../datahub/rows";
import { Id, ROW_EVENTS } from "../datahub/shared";
import { activeLocks } from "../datahub/period-guard";
import { masterAccess } from "../datahub/template-ops";
import { loadTemplate, type Template } from "../datahub/template-sync";
import { rowFromDb, TableSchema } from "../datahub/table-schema";
import type { DhColumn, PersonEntry, SelectOption, Stored } from "../datahub/types";
import { scoreCandidates, fold, type MatchMemory, type PaymentFacts } from "./payment-match";

/**
 * Payments and commission by instalment (design module4 7.4): `payment.schedule`, `payment.confirm`, `payment.unconfirm`, `commission.adjust`, and the query
 * `payment.match_candidates`. They write the template tables of the Manager's tree (Deals, Đợt thanh toán, Tiền về, Sổ com) through `applyRowOps` as the OWNER of
 * the tables, and find every table by its role set and every column by its ROLE, never by name (the Manager renames and re-formats them freely).
 * They write plain columns only; totals, status, period and commission are formulas, lookups and roll-ups that the engine recalculates.
 */

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD.");
const money = z.number().finite().min(0).max(1e13);
const pct = z.number().min(0).max(1);
export const COM_ATTR = "ty_le_com";

/** One table of the tree as the commands use it: its access (as owner), schema and the columns by role. */
export interface T {
  tpl: Template;
  acc: TableAccess;
  schema: TableSchema;
  name: string;
}
export interface Tree {
  managerId: string;
  deals: T;
  dots: T;
  receipts: T;
  ledger: T;
  /** "Doanh thu theo người": absent in a tree built before the table was added (it gets it on the next beat of the defaults loop). */
  revenue: T | null;
}
export type Ctx = Pick<HandlerCtx, "db" | "actor" | "emit" | "audit" | "requestId" | "access">;

const ROLE_OF_TABLE = { deals: "deals", dots: "payments", receipts: "receipts", ledger: "ledger", revenue: "revenue" } as const;

async function loadT(ctx: Ctx, managerId: string, roleSet: string, label: string): Promise<T>;
async function loadT(ctx: Ctx, managerId: string, roleSet: string, label: string, optional: true): Promise<T | null>;
async function loadT(ctx: Ctx, managerId: string, roleSet: string, label: string, optional = false): Promise<T | null> {
  const r = await ctx.db.execute(sql`SELECT id FROM dh_templates WHERE /*scope:system*/ manager_id = ${managerId}::uuid AND scope = 'tree' AND role_set = ${roleSet} AND deleted_at IS NULL ORDER BY created_at LIMIT 1`);
  const id = (r.rows[0] as { id: string } | undefined)?.id;
  const tpl = id ? await loadTemplate(ctx.db, id) : null;
  if (!tpl?.masterTableId && optional) return null;
  if (!tpl?.masterTableId) throw new AppError("conflict", `Cây của bạn chưa có bảng "${label}" (bộ vai trò ${roleSet}). Chờ hệ thống dựng bộ bảng mặc định hoặc tạo bảng ở trang Template.`, { reason: "payment_table_missing", role_set: roleSet });
  const acc = await masterAccess(ctx as never, tpl);
  const schema = await TableSchema.load(ctx.db, acc);
  return { tpl, acc, schema, name: tpl.name };
}

export async function loadTree(ctx: Ctx): Promise<Tree> {
  const p = await ctx.access.requirePrincipal();
  if (!p.roles.includes("manager")) throw new AppError("forbidden", "Chỉ Manager của cây ghi thanh toán và com.", { reason: "manager_only" });
  const m = p.userId;
  return {
    managerId: m,
    deals: await loadT(ctx, m, ROLE_OF_TABLE.deals, "Deals"),
    dots: await loadT(ctx, m, ROLE_OF_TABLE.dots, "Đợt thanh toán"),
    receipts: await loadT(ctx, m, ROLE_OF_TABLE.receipts, "Tiền về"),
    ledger: await loadT(ctx, m, ROLE_OF_TABLE.ledger, "Sổ com"),
    revenue: await loadT(ctx, m, ROLE_OF_TABLE.revenue, "Doanh thu theo người", true),
  };
}

/** The live column that holds a role; a missing required role is a clear error, a missing optional one is `null`. */
export function roleCol(t: T, role: string, required = true): DhColumn | null {
  const c = t.schema.alive.find((x) => x.role === role);
  if (!c && required) throw new AppError("conflict", `Bảng "${t.name}" chưa có cột giữ vai trò "${role}". Gán vai trò cho một cột ở trang Template.`, { reason: "role_missing", role, table: t.name });
  return c ?? null;
}

export type Cells = Record<string, Stored>;
export interface RowData {
  id: string;
  version: number;
  data: Cells;
}

/** Rows by id, as the owner of the table sees them. */
export async function readRows(ctx: Ctx, t: T, ids: string[]): Promise<Map<string, RowData>> {
  const out = new Map<string, RowData>();
  if (!ids.length) return out;
  const res = await ctx.db.execute(sql`SELECT id, row_no, version, data, created_at, created_by, updated_at, updated_by FROM dh_rows WHERE ${t.acc.rows()} AND deleted_at IS NULL AND id = ANY(${`{${ids.join(",")}}`}::uuid[])`);
  for (const r of res.rows as Record<string, unknown>[]) {
    const row = rowFromDb(r);
    out.set(row.id, { id: row.id, version: row.version, data: row.data });
  }
  return out;
}

export const cellOf = (t: T, row: RowData, role: string): Stored => {
  const c = roleCol(t, role, false);
  return c ? (sourceOf(c).readCell({ data: row.data } as never, c) ?? null) : null;
};
export const empty = (v: Stored | undefined): boolean => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
export const idsOf = (v: Stored): string[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : []);
export const numOf = (v: Stored): number => (typeof v === "number" ? v : 0);
export const dateOf = (v: Stored): string | null => (typeof v === "string" && v ? v.slice(0, 10) : null);

/** Cells by role; an optional role the table does not have is skipped. */
export function cells(t: T, pairs: [string, Stored | undefined][]): Cells {
  const out: Cells = {};
  for (const [role, v] of pairs) {
    if (v === undefined) continue;
    const c = roleCol(t, role, false);
    if (c) out[c.key] = v;
  }
  return out;
}

/** The one way these commands write: through `applyRowOps`. An update that names no version gets the current one (the command read the row in this transaction). */
export async function write(ctx: Ctx, t: T, ops: RowOp[], system = false) {
  const need = ops.filter((o): o is Extract<RowOp, { op: "update" }> => o.op === "update" && o.version === undefined && o.base === undefined);
  if (need.length) {
    const cur = await readRows(ctx, t, need.map((o) => o.id));
    for (const o of need) o.version = cur.get(o.id)?.version;
  }
  return applyRowOps(ctx as never, t.acc, t.schema, ops, { system });
}

/** The Manager's reason of the source column (module4 7.2): typed by hand, by an AI connection or by the API. */
export const sourceName = (ctx: Ctx): string => (ctx.actor.via === "web" ? "Tay" : ctx.actor.via === "mcp" ? "AI" : "API");
export function sourceValue(t: T, ctx: Ctx): Stored | undefined {
  const c = roleCol(t, "nguon_nhap", false);
  if (!c) return undefined;
  const name = sourceName(ctx);
  const opts = (c.config.options as SelectOption[] | undefined) ?? [];
  // A select holds only the fixed options (Tay / AI / API); a text column also says which connection typed it: `AI (tên kết nối)`, `API (tên kết nối)` (module5 5).
  if (c.type === "single_select") return opts.find((o) => o.name === name)?.id ?? undefined;
  return name !== "Tay" && ctx.actor.connectionName ? `${name} (${ctx.actor.connectionName})` : name;
}

export function optionByMeaning(t: T, role: string, meaning: string): string | null {
  const c = roleCol(t, role, false);
  const opts = (c?.config.options as SelectOption[] | undefined) ?? [];
  return opts.find((o) => o.meaning === meaning)?.id ?? null;
}
export function statusMeaning(t: T, row: RowData): string | undefined {
  const c = roleCol(t, "trang_thai", false);
  const opts = (c?.config.options as SelectOption[] | undefined) ?? [];
  const v = c ? sourceOf(c).readCell({ data: row.data } as never, c) : null;
  return opts.find((o) => o.id === v)?.meaning;
}
export function optionNamed(t: T, role: string, name: string): string {
  const c = roleCol(t, role)!;
  const o = ((c.config.options as SelectOption[] | undefined) ?? []).find((x) => x.name === name);
  if (!o) throw new AppError("conflict", `Cột "${c.name}" thiếu lựa chọn "${name}".`, { reason: "option_missing", role, name });
  return o.id;
}

/** Adds ledger lines to the deal's `so_com` link (the roll-ups "Com đã nhận / tạm tính của tôi" read the ledger through it). A system write: the link is bookkeeping. */
async function linkLedger(ctx: Ctx, tree: Tree, byDeal: Map<string, string[]>): Promise<void> {
  const col = roleCol(tree.deals, "so_com", false);
  if (!col || byDeal.size === 0) return;
  const cur = await readRows(ctx, tree.deals, [...byDeal.keys()]);
  const ops: RowOp[] = [];
  for (const [dealId, added] of byDeal) {
    const row = cur.get(dealId);
    if (!row) continue;
    ops.push({ op: "update", id: dealId, data: { [col.key]: [...new Set([...idsOf(row.data[col.key] ?? null), ...added])] } });
  }
  if (ops.length) await write(ctx, tree.deals, ops, true);
}

/** Takes deleted ledger lines out of the deals' `so_com` link (no orphan ids left in the cell). System write, like `linkLedger`. */
async function unlinkLedger(ctx: Ctx, tree: Tree, dealIds: string[], gone: Set<string>): Promise<void> {
  const col = roleCol(tree.deals, "so_com", false);
  if (!col || dealIds.length === 0 || gone.size === 0) return;
  const cur = await readRows(ctx, tree.deals, dealIds);
  const ops: RowOp[] = [];
  for (const [dealId, row] of cur) {
    const had = idsOf(row.data[col.key] ?? null);
    const left = had.filter((x) => !gone.has(x));
    if (left.length !== had.length) ops.push({ op: "update", id: dealId, data: { [col.key]: left.length ? left : null } });
  }
  if (ops.length) await write(ctx, tree.deals, ops, true);
}

/** Revenue share attribute of `Người tham gia` (module4 4.5). */
export const REVENUE_ATTR = "ty_le_dt";

/**
 * One row of "Doanh thu theo người" per person who has a revenue share in the instalment (design module4 4.6A2): the revenue of ONE named person, the same
 * for every reader, so Probation KPI and the Index of a team can sum it. A tree without the table skips it. System bookkeeping next to the ledger lines.
 */
async function addRevenueLines(ctx: Ctx, tree: Tree, paymentId: string, dealId: string, people: Stored): Promise<void> {
  const t = tree.revenue;
  if (!t || !Array.isArray(people)) return;
  const ops: RowOp[] = (people as unknown as PersonEntry[])
    .filter((e) => e && typeof e.id === "string" && Number(e.attrs?.[REVENUE_ATTR] ?? 0) > 0)
    .map((e) => ({
      op: "create" as const,
      data: cells(t, [
        ["nguoi", e.id],
        ["dot", [paymentId] as Stored],
        ["deal", [dealId] as Stored],
        ["ty_le_dt", Number(e.attrs[REVENUE_ATTR])],
      ]),
    }));
  if (ops.length) await write(ctx, t, ops);
}

/** The rows of "Doanh thu theo người" of these instalments (for `payment.unconfirm`). */
async function revenueLinesOf(ctx: Ctx, tree: Tree, paymentIds: string[]): Promise<string[]> {
  const t = tree.revenue;
  if (!t) return [];
  const dotCol = roleCol(t, "dot")!;
  const link = sourceOf(dotCol).cellExpr(dotCol, "data", "json");
  const res = await ctx.db.execute(sql`SELECT id FROM dh_rows WHERE ${t.acc.rows()} AND deleted_at IS NULL AND ${link} ?| ${`{${paymentIds.join(",")}}`}::text[]`);
  return (res.rows as { id: string }[]).map((r) => r.id);
}

/** The payments of a deal: rows of Đợt thanh toán whose link column holds the deal. */
async function paymentsOfDeal(ctx: Ctx, tree: Tree, dealId: string): Promise<Map<string, RowData>> {
  const c = roleCol(tree.dots, "deal")!;
  const link = sourceOf(c).cellExpr(c, "data", "json");
  const res = await ctx.db.execute(sql`SELECT id FROM dh_rows WHERE ${tree.dots.acc.rows()} AND deleted_at IS NULL AND ${link} @> ${JSON.stringify([dealId])}::jsonb`);
  return readRows(ctx, tree.dots, (res.rows as { id: string }[]).map((r) => r.id));
}


const addMonth = (ym: string): string => {
  const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};
/** The first month (`YYYY-MM-01`) from `from` on that no active lock of the Đợt thanh toán table covers: the OPEN period (design module4 12, "Về muộn"). */
export async function openMonthFrom(ctx: Ctx, tree: Tree, from: string): Promise<string> {
  const locks = await activeLocks(ctx.db, tree.dots.acc.tableId);
  let m = `${from.slice(0, 7)}-01`;
  for (let n = 0; n < 240; n++) {
    if (!locks.some((l) => l.start <= m && m <= l.end)) return m;
    m = addMonth(m);
  }
  throw new AppError("conflict", "Mọi tháng gần đây đều đã chốt.", { reason: "no_open_period" });
}
/** The month (`YYYY-MM-01`) of a date is locked: the money arrived late and is recorded in the open period. */
export async function lockedMonth(ctx: Ctx, tree: Tree, date: string): Promise<boolean> {
  const d = date.slice(0, 7) + "-01";
  return (await activeLocks(ctx.db, tree.dots.acc.tableId)).some((l) => l.start <= d && d <= l.end);
}

export const confirmed = (t: T, row: RowData): boolean => !empty(cellOf(t, row, "ngay_tien_ve"));

/** People of the deal with a commission share, as the cell of `Chia com đợt này` (each person's % as that person's own column holds it: participants.ts). */
const splitFromParts = (parts: Participant[]): PersonEntry[] => parts.filter((p) => p.com > 0).map((p) => ({ id: p.id, attrs: { [COM_ATTR]: p.com } }));
const splitCell = (split: { user_id: string; pct: number }[]): PersonEntry[] => split.map((s) => ({ id: s.user_id, attrs: { [COM_ATTR]: s.pct } }));

const SplitIn = z.array(z.object({ user_id: Id, pct })).max(20).describe("Chia com đợt này: mỗi người một tỉ lệ trên com sale (0..1, ví dụ 0.15 là 15%). Tổng không vượt `Tỉ lệ SoE` của chính sách.");

// ================================================================================================
// payment.schedule
// ================================================================================================

const ScheduleItem = z.object({
  id: Id.optional().describe("Đợt đã có (chưa về) cần sửa. Không có `id` = đợt mới."),
  legal_entity: z.string().trim().max(200).optional().describe("Pháp nhân theo hợp đồng (không phải tên công ty của deal)."),
  tax_code: z.string().trim().max(40).optional(),
  contract_no: z.string().trim().max(100).optional(),
  seq: z.number().int().min(1).max(999).optional().describe("Đợt số; bỏ trống thì đánh số tiếp theo."),
  amount: money.describe("Số tiền dự kiến, chưa VAT."),
  due: ymd.describe("Hạn thanh toán."),
  com_split: SplitIn.optional(),
  source: z.string().trim().min(1).max(40).optional().describe("Hệ thống ngoài đặt mã (ví dụ `bpm`). Đi cùng `external_id`."),
  external_id: z.string().trim().min(1).max(120).optional().describe("Mã đợt của hệ thống ngoài. Đã có đợt mang mã này (của deal này) thì sửa đợt đó, chưa có thì tạo đợt mới mang mã: gọi lại không sinh đợt trùng. Cần cột `Mã ngoài` ở bảng Đợt thanh toán."),
});

const PaymentOut = z.object({ id: Id, seq: z.number().int().nullable(), amount: z.number(), due: z.string(), created: z.boolean(), external_id: z.string().nullable() });

/** The key an external system's instalment is stored under: `source:external_id`, or the id alone without a source. */
const externalKey = (e: { source?: string; external_id: string }): string => (e.source ? `${e.source}:${e.external_id}` : e.external_id);

/** The instalments of the tree that carry these external keys: key -> payment id. */
async function paymentsByExternal(ctx: Ctx, tree: Tree, keys: string[]): Promise<Map<string, string>> {
  const col = roleCol(tree.dots, "ma_ngoai", false);
  if (!col) throw new AppError("conflict", `Bảng "${tree.dots.name}" chưa có cột giữ vai trò "ma_ngoai" (Mã ngoài của đợt), nên chưa nhận \`external_id\`. Thêm cột và gán vai trò ở trang Template.`, { reason: "external_id_unsupported" });
  const expr = sourceOf(col).cellExpr(col, "data", "text");
  const res = await ctx.db.execute(sql`SELECT id, ${expr} AS k FROM dh_rows WHERE ${tree.dots.acc.rows()} AND deleted_at IS NULL AND ${expr} = ANY(${`{${keys.map((k) => `"${k.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`}::text[])`);
  return new Map((res.rows as { id: string; k: string }[]).map((r) => [r.k, r.id]));
}

/** Instalments with a received date (or amount) but no Tiền về linked: money recorded by an import, never confirmed by `payment.confirm`. */
export function receivedUnconfirmed(tree: Tree, rows: RowData[]): RowData[] {
  const linkable = roleCol(tree.dots, "tien_ve", false);
  if (!linkable) return [];
  return rows.filter((r) => (!empty(cellOf(tree.dots, r, "ngay_tien_ve")) || numOf(cellOf(tree.dots, r, "so_tien_ve")) > 0) && empty(cellOf(tree.dots, r, "tien_ve")));
}

/**
 * Confirms, in one batch, the instalments that an import brought in as already received (design module4 14, 12): each gets a Tiền về row and the link, its
 * deal becomes Won (when open), and the commission and revenue lines are made, EXCEPT where the instalment already has a ledger line (old commission imported
 * as `Com cố định`, `Đã chốt`): those lines are kept as they are and none is added. One write per table, so the recalculation is queued once at the end.
 * Idempotent: a confirmed instalment has its link and is not found again. Returns what was done, for the audit.
 */
export async function confirmReceivedBatch(ctx: Ctx, tree: Tree, rows: RowData[]): Promise<{ payments: number; won_deal_ids: string[]; ledger_ids: string[]; skipped_ledger: number }> {
  const todo = receivedUnconfirmed(tree, rows);
  if (todo.length === 0) return { payments: 0, won_deal_ids: [], ledger_ids: [], skipped_ledger: 0 };
  const dealOf = (r: RowData) => idsOf(cellOf(tree.dots, r, "deal"))[0] ?? null;
  const dealIds = [...new Set(todo.flatMap((r) => (dealOf(r) ? [dealOf(r)!] : [])))];
  const deals = await readRows(ctx, tree.deals, dealIds);
  // The ledger lines these instalments already have.
  const dotCol = roleCol(tree.ledger, "dot")!;
  const link = sourceOf(dotCol).cellExpr(dotCol, "data", "json");
  const have = await ctx.db.execute(sql`SELECT id, ${link} AS dots FROM dh_rows WHERE ${tree.ledger.acc.rows()} AND deleted_at IS NULL AND ${link} ?| ${`{${todo.map((r) => r.id).join(",")}}`}::text[]`);
  const withLedger = new Set((have.rows as { dots: string[] }[]).flatMap((r) => r.dots));
  const partsOf = new Map<string, Participant[]>();
  for (const d of dealIds) if (deals.get(d)) partsOf.set(d, await participantsOf(ctx, tree.deals, deals.get(d)!));
  const dotSrc = sourceValue(tree.dots, ctx);
  const recSrc = sourceValue(tree.receipts, ctx);
  // 1. a Tiền về row per instalment
  const amountOf = (r: RowData) => numOf(cellOf(tree.dots, r, "so_tien_nhan")) || numOf(cellOf(tree.dots, r, "so_tien_ve")) || numOf(cellOf(tree.dots, r, "so_tien_du_kien"));
  const made = await write(ctx, tree.receipts, todo.map((r) => ({ op: "create" as const, data: cells(tree.receipts, [["ngay_nhan", dateOf(cellOf(tree.dots, r, "ngay_tien_ve")) ?? undefined], ["so_tien", amountOf(r)], ["nguon_nhap", recSrc], ["dot", [r.id] as Stored]]) })));
  // 2. the instalments: link, amounts, people (from the deal when the import left them out)
  await write(
    ctx,
    tree.dots,
    todo.map((r, n) => {
      const d = dealOf(r);
      const people = empty(cellOf(tree.dots, r, "nguoi_tham_gia")) && d ? (peopleCell(tree.dots, partsOf.get(d) ?? []) as unknown as Stored) : undefined;
      const split = empty(cellOf(tree.dots, r, "chia_com_dot")) && d ? (splitFromParts(partsOf.get(d) ?? []) as unknown as Stored) : undefined;
      return {
        op: "update" as const,
        id: r.id,
        data: cells(tree.dots, [
          ["tien_ve", [made[n]!.id] as Stored],
          ["so_tien_ve", numOf(cellOf(tree.dots, r, "so_tien_ve")) > 0 ? undefined : amountOf(r)],
          ["so_tien_nhan", numOf(cellOf(tree.dots, r, "so_tien_nhan")) > 0 ? undefined : amountOf(r)],
          ["nguoi_tham_gia", people],
          ["chia_com_dot", split],
          ["nguon_nhap", dotSrc && empty(cellOf(tree.dots, r, "nguon_nhap")) ? dotSrc : undefined],
        ]),
      };
    }),
    true,
  );
  // 3. deals become Won (system write: only the payment commands do it)
  const won = optionByMeaning(tree.deals, "trang_thai", "won");
  const wonIds: string[] = [];
  for (const d of dealIds) {
    const deal = deals.get(d);
    if (deal && statusMeaning(tree.deals, deal) === "open") wonIds.push(d);
  }
  if (wonIds.length) {
    if (!won) throw new AppError("conflict", "Cột Trạng thái của Deals chưa có lựa chọn mang nghĩa Won.", { reason: "status_option_missing", meaning: "won" });
    await write(ctx, tree.deals, wonIds.map((id) => ({ op: "update" as const, id, data: cells(tree.deals, [["trang_thai", won]]) })), true);
  }
  // 4. commission lines (Tạm tính) and revenue lines, only for instalments without a ledger line
  const fresh = todo.filter((r) => !withLedger.has(r.id));
  const ledgerOps: RowOp[] = [];
  const ledgerDeal: string[] = [];
  const temp = fresh.length ? optionNamed(tree.ledger, "trang_thai_com", "Tạm tính") : null;
  for (const r of fresh) {
    const d = dealOf(r);
    if (!d) continue;
    for (const e of splitFromParts(partsOf.get(d) ?? [])) {
      ledgerOps.push({ op: "create", data: cells(tree.ledger, [["nguoi", e.id], ["dot", [r.id] as Stored], ["deal", [d] as Stored], ["ty_le_com", Number(e.attrs[COM_ATTR])], ["trang_thai_com", temp!]]) });
      ledgerDeal.push(d);
    }
  }
  const ledgerIds = ledgerOps.length ? (await write(ctx, tree.ledger, ledgerOps)).map((x) => x.id) : [];
  const byDeal = new Map<string, string[]>();
  ledgerIds.forEach((id, n) => byDeal.set(ledgerDeal[n]!, [...(byDeal.get(ledgerDeal[n]!) ?? []), id]));
  await linkLedger(ctx, tree, byDeal);
  // Revenue by person for EVERY confirmed instalment, those with old ledger lines too (the revenue table is only written by the payment commands).
  for (const r of todo) {
    const d = dealOf(r);
    if (d) await addRevenueLines(ctx, tree, r.id, d, peopleCell(tree.dots, partsOf.get(d) ?? []) as unknown as Stored);
  }
  return { payments: todo.length, won_deal_ids: wonIds, ledger_ids: ledgerIds, skipped_ledger: todo.length - fresh.length };
}

export const paymentOperations = [
  defineCommand({
    name: "payment.schedule",
    summary: "Lập hoặc sửa lịch thanh toán của một deal (các đợt chưa về) trong một lần gọi.",
    description:
      "Chỉ Manager của cây. Một lần gọi cho cả lịch của deal: đợt không có `id` được tạo, đợt có `id` được sửa, `remove_ids` được xoá. Không sửa, không xoá đợt đã xác nhận tiền về. " +
      "Hệ thống điền `Người tham gia` của đợt từ deal (khoá phân chia) và liên kết hai chiều Deals - Đợt thanh toán. Deal đã đóng (Lost, Disqualified, Convert to POD, Huỷ) không lập lịch được; deal Won vẫn thêm được đợt. Cần `Idempotency-Key`.",
    permission: "deal:payment:write",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z.object({ deal_id: Id, payments: z.array(ScheduleItem).max(100).default([]), remove_ids: z.array(Id).max(100).default([]) }),
    output: z.object({ deal_id: Id, payments: z.array(PaymentOut), removed: z.array(Id) }),
    http: { method: "POST", path: "/deal/payments/schedule", status: 200 },
    handler: async (ctx, i) => {
      const tree = await loadTree(ctx);
      const deal = (await readRows(ctx, tree.deals, [i.deal_id])).get(i.deal_id);
      if (!deal) throw new AppError("not_found", "Không tìm thấy deal.", { reason: "deal_not_found" });
      const m = statusMeaning(tree.deals, deal);
      if (m && m !== "open" && m !== "won") throw new AppError("conflict", "Deal đã đóng, không lập lịch thanh toán. Đưa deal về trạng thái mở trước.", { reason: "deal_closed" });
      const have = await paymentsOfDeal(ctx, tree, i.deal_id);
      // An instalment of an external system is found by its own code: a call repeated with the same codes edits what it made instead of making it again.
      const extKeys = i.payments.flatMap((p) => (p.external_id !== undefined ? [externalKey({ source: p.source, external_id: p.external_id })] : []));
      if (new Set(extKeys).size !== extKeys.length) throw new AppError("validation_error", "Hai đợt trong cùng một lần gọi mang cùng mã ngoài.", { reason: "duplicate_external_id" });
      const known = extKeys.length ? await paymentsByExternal(ctx, tree, extKeys) : new Map<string, string>();
      const items = i.payments.map((p) => {
        if (p.external_id === undefined) return p;
        const found = known.get(externalKey({ source: p.source, external_id: p.external_id }));
        if (found && p.id && p.id !== found) throw new AppError("conflict", "Mã ngoài này đã thuộc một đợt khác.", { reason: "external_id_taken", payment_id: found });
        return found ? { ...p, id: found } : p;
      });
      const touched = new Set<string>();
      for (const id of [...i.remove_ids, ...items.flatMap((p) => (p.id ? [p.id] : []))]) {
        const row = have.get(id);
        if (!row) throw new AppError("not_found", "Đợt không thuộc deal này.", { reason: "payment_not_of_deal", payment_id: id });
        if (confirmed(tree.dots, row)) throw new AppError("conflict", "Đợt đã xác nhận tiền về, không sửa hoặc xoá bằng lịch. Huỷ xác nhận trước.", { reason: "payment_confirmed", payment_id: id });
        if (touched.has(id)) throw new AppError("validation_error", "Một đợt chỉ xuất hiện một lần trong một lần gọi.", { payment_id: id });
        touched.add(id);
      }
      // The people of the instalment come from the deal, as each of them holds their share (read before anything is written: participants.ts).
      const needPeople = items.some((p) => !p.id);
      const parts = needPeople ? await participantsOf(ctx, tree.deals, deal) : [];
      if (needPeople) await assertComCap(ctx, tree.deals, parts, deal);
      for (const p of items) if (p.com_split) await assertComTotal(ctx, tree.deals, p.com_split.reduce((a, s) => a + s.pct, 0), deal);
      const people = (needPeople ? peopleCell(tree.dots, parts) : []) as unknown as Stored;
      const nextSeq = Math.max(0, ...[...have.values()].map((r) => numOf(cellOf(tree.dots, r, "dot_so"))));
      let seq = nextSeq;
      const src = sourceValue(tree.dots, ctx);
      const ops: RowOp[] = [];
      const plan: { created: boolean; seq: number | null; amount: number; due: string; external: string | null }[] = [];
      for (const p of items) {
        const external = p.external_id !== undefined ? externalKey({ source: p.source, external_id: p.external_id }) : null;
        const data = cells(tree.dots, [
          ["phap_nhan", p.legal_entity],
          ["ma_so_thue", p.tax_code],
          ["so_hop_dong", p.contract_no],
          ["so_tien_du_kien", p.amount],
          ["han", p.due],
          ["chia_com_dot", p.com_split ? (splitCell(p.com_split) as unknown as Stored) : undefined],
          ["ma_ngoai", external ?? undefined],
        ]);
        if (p.id) {
          const cur = have.get(p.id)!;
          Object.assign(data, cells(tree.dots, [["dot_so", p.seq]]));
          ops.push({ op: "update", id: p.id, data });
          plan.push({ created: false, seq: p.seq ?? (numOf(cellOf(tree.dots, cur, "dot_so")) || null), amount: p.amount, due: p.due, external });
        } else {
          seq = p.seq ?? seq + 1;
          Object.assign(data, cells(tree.dots, [["deal", [i.deal_id] as Stored], ["dot_so", seq], ["nguoi_tham_gia", people], ["nguon_nhap", src]]));
          ops.push({ op: "create", data });
          plan.push({ created: true, seq, amount: p.amount, due: p.due, external });
        }
      }
      for (const id of i.remove_ids) ops.push({ op: "delete", id });
      if (!ops.length) return { deal_id: i.deal_id, payments: [], removed: [] };
      const results = await write(ctx, tree.dots, ops);
      const created = results.filter((r) => r.outcome === "created").map((r) => r.id);
      const keep = [...have.keys()].filter((id) => !i.remove_ids.includes(id));
      const linkCol = roleCol(tree.deals, "dot_thanh_toan", false);
      if (linkCol && (created.length || i.remove_ids.length)) await write(ctx, tree.deals, [{ op: "update", id: i.deal_id, data: { [linkCol.key]: [...keep, ...created] } }]);
      ctx.audit({ type: "deal_payment", id: i.deal_id, details: { operation: "schedule", payments: items.length, removed: i.remove_ids.length } });
      return {
        deal_id: i.deal_id,
        payments: plan.map((x, n) => ({ id: results[n]!.id, seq: x.seq, amount: x.amount, due: x.due, created: x.created, external_id: x.external })),
        removed: i.remove_ids,
      };
    },
  }),

  // ==============================================================================================
  // payment.confirm
  // ==============================================================================================
  defineCommand({
    name: "payment.confirm",
    summary: "Xác nhận tiền về cho một hoặc nhiều đợt. Đợt đầu của deal: deal thành Won. Sinh dòng Sổ com Tạm tính.",
    description:
      "Chỉ Manager của cây. `receipt` là khoản tiền vào tài khoản (một dòng bảng Tiền về): tạo mới từ thông tin UNC, hoặc dùng dòng có sẵn bằng `receipt.id` (hàng Tiền về chưa ghép). " +
      "`allocations`: mỗi phần chia vào một đợt chưa về; tổng `amount_received` (gồm VAT) của các phần phải bằng số tiền của khoản. Mỗi phần ghi ngày, số tiền về (chưa VAT) và số tiền nhận (gồm VAT) vào đợt. " +
      "Chia com: `com_split` của phần, hoặc `Chia com đợt này` đã có trên đợt, hoặc lấy từ `Người tham gia` của deal (% com > 0). Mỗi người một dòng Sổ com `Tạm tính`. " +
      "Về thiếu (`amount` nhỏ hơn số tiền dự kiến): `shortfall: split` (mặc định) tách phần còn lại thành đợt mới giữ hạn, `keep` để đợt ở trạng thái Về thiếu. " +
      "Đợt đầu về của deal đang mở: deal thành Won (hệ thống đặt, không chọn tay). Deal đã đóng (Lost, Disqualified, Convert to POD, Huỷ): từ chối. Đợt đã xác nhận: từ chối. Cần `Idempotency-Key`.",
    permission: "deal:payment:write",
    aiAllowed: true,
    emits: [...ROW_EVENTS, "deal.payment.confirmed"],
    input: z.object({
      received_on: ymd.describe("Ngày tiền về."),
      receipt: z.object({
        id: Id.optional().describe("Dòng Tiền về có sẵn."),
        amount: money.optional().describe("Số tiền của khoản (gồm VAT). Bắt buộc khi tạo mới."),
        payer_name: z.string().trim().max(200).optional(),
        account_no: z.string().trim().max(60).optional(),
        bank: z.string().trim().max(100).optional(),
        content: z.string().trim().max(1000).optional(),
      }),
      allocations: z
        .array(
          z.object({
            payment_id: Id.optional().describe("Đợt cần xác nhận. Hoặc dùng `external_id` (kèm `source`)."),
            source: z.string().trim().min(1).max(40).optional(),
            external_id: z.string().trim().min(1).max(120).optional().describe("Mã ngoài của đợt (đặt lúc `payment.schedule`), thay cho `payment_id`."),
            amount: money.describe("Số tiền về của đợt, chưa VAT."),
            amount_received: money.optional().describe("Số tiền nhận của đợt, gồm VAT. Bỏ trống = `amount`."),
            com_split: SplitIn.optional(),
            shortfall: z.enum(["split", "keep"]).default("split"),
          }),
        )
        .min(1)
        .max(50),
    }),
    output: z.object({
      receipt_id: Id,
      payments: z.array(z.object({ id: Id, split_off_id: Id.nullable() })),
      won_deal_ids: z.array(Id),
      ledger_ids: z.array(Id),
    }),
    http: { method: "POST", path: "/deal/payments/confirm", status: 200 },
    handler: async (ctx, input) => {
      const tree = await loadTree(ctx);
      // An instalment may be named by its external code instead of its id.
      for (const a of input.allocations) if ((a.payment_id === undefined) === (a.external_id === undefined)) throw new AppError("validation_error", "Mỗi phần chia cần đúng một trong `payment_id` hoặc `external_id`.", { reason: "payment_ref_required" });
      const byCode = input.allocations.flatMap((a) => (a.external_id !== undefined ? [externalKey({ source: a.source, external_id: a.external_id })] : []));
      const codes = byCode.length ? await paymentsByExternal(ctx, tree, byCode) : new Map<string, string>();
      const i = {
        ...input,
        allocations: input.allocations.map((a) => {
          if (a.external_id === undefined) return { ...a, payment_id: a.payment_id! };
          const id = codes.get(externalKey({ source: a.source, external_id: a.external_id }));
          if (!id) throw new AppError("not_found", "Không có đợt thanh toán mang mã ngoài này.", { reason: "payment_not_found", external_id: a.external_id });
          return { ...a, payment_id: id };
        }),
      };
      const ids = i.allocations.map((a) => a.payment_id);
      if (new Set(ids).size !== ids.length) throw new AppError("validation_error", "Một đợt chỉ nhận một phần trong một lần gọi.", { reason: "duplicate_payment" });
      const dots = await readRows(ctx, tree.dots, ids);
      const dealOf = new Map<string, string>();
      for (const a of i.allocations) {
        const row = dots.get(a.payment_id);
        if (!row) throw new AppError("not_found", "Không tìm thấy đợt thanh toán.", { reason: "payment_not_found", payment_id: a.payment_id });
        if (confirmed(tree.dots, row)) throw new AppError("conflict", "Đợt này đã xác nhận tiền về.", { reason: "payment_already_confirmed", payment_id: a.payment_id });
        const d = idsOf(cellOf(tree.dots, row, "deal"))[0];
        if (!d) throw new AppError("conflict", "Đợt chưa gắn với deal nào.", { reason: "payment_without_deal", payment_id: a.payment_id });
        dealOf.set(a.payment_id, d);
      }
      const deals = await readRows(ctx, tree.deals, [...new Set(dealOf.values())]);
      for (const [pid, d] of dealOf) {
        const deal = deals.get(d);
        if (!deal) throw new AppError("not_found", "Không tìm thấy deal của đợt.", { reason: "deal_not_found", payment_id: pid });
        const m = statusMeaning(tree.deals, deal);
        if (m && m !== "open" && m !== "won") throw new AppError("conflict", "Deal đã đóng, không xác nhận tiền về. Đưa deal về trạng thái mở trước.", { reason: "deal_closed", deal_id: d });
      }
      const total = i.allocations.reduce((s, a) => s + (a.amount_received ?? a.amount), 0);
      // The commission split of a deal is read before anything is written (participants.ts): from the people of the deal, each with their own share.
      const needSplit = [...new Set(i.allocations.filter((a) => !a.com_split && empty(cellOf(tree.dots, dots.get(a.payment_id)!, "chia_com_dot"))).map((a) => dealOf.get(a.payment_id)!))];
      for (const a of i.allocations) if (a.com_split) await assertComTotal(ctx, tree.deals, a.com_split.reduce((x, s) => x + s.pct, 0), deals.get(dealOf.get(a.payment_id)!)!);
      const partsOf = new Map<string, Participant[]>();
      for (const d of needSplit) {
        const parts = await participantsOf(ctx, tree.deals, deals.get(d)!);
        await assertComCap(ctx, tree.deals, parts, deals.get(d)!);
        partsOf.set(d, parts);
      }
      // ---- the receipt (Tiền về)
      let receiptId = i.receipt.id ?? null;
      let receiptRow: RowData | undefined;
      if (receiptId) {
        receiptRow = (await readRows(ctx, tree.receipts, [receiptId])).get(receiptId);
        if (!receiptRow) throw new AppError("not_found", "Không tìm thấy dòng Tiền về.", { reason: "receipt_not_found" });
      }
      const receiptAmount = i.receipt.amount ?? (receiptRow ? numOf(cellOf(tree.receipts, receiptRow, "so_tien")) : undefined);
      if (receiptAmount === undefined) throw new AppError("validation_error", "Thiếu số tiền của khoản tiền về (`receipt.amount`).", { reason: "receipt_amount_required" });
      if (Math.abs(receiptAmount - total) > 0.5) throw new AppError("validation_error", "Tổng số tiền nhận của các đợt phải bằng số tiền của khoản tiền về.", { reason: "allocation_sum_mismatch", receipt_amount: receiptAmount, allocated: total });
      const prevPayments = receiptRow ? idsOf(cellOf(tree.receipts, receiptRow, "dot")) : [];
      const src = sourceValue(tree.receipts, ctx);
      if (!receiptRow) {
        const [r] = await write(ctx, tree.receipts, [
          {
            op: "create",
            data: cells(tree.receipts, [
              ["ngay_nhan", i.received_on],
              ["so_tien", receiptAmount],
              ["nguoi_tra", i.receipt.payer_name],
              ["so_tai_khoan", i.receipt.account_no],
              ["ngan_hang", i.receipt.bank],
              ["noi_dung", i.receipt.content],
              ["nguon_nhap", src],
              ["dot", ids as Stored],
            ]),
          },
        ]);
        receiptId = r!.id;
      } else {
        await write(ctx, tree.receipts, [{ op: "update", id: receiptId!, data: cells(tree.receipts, [["dot", [...new Set([...prevPayments, ...ids])] as Stored]]) }]);
      }
      // ---- the payments
      const outPayments: { id: string; split_off_id: string | null }[] = [];
      const ledgerIds: string[] = [];
      const ledgerByDeal = new Map<string, string[]>();
      const wonDeals: string[] = [];
      const dealPayments = new Map<string, Map<string, RowData>>();
      for (const d of new Set(dealOf.values())) dealPayments.set(d, await paymentsOfDeal(ctx, tree, d));
      const firstOf = new Set<string>();
      // Money that arrives with a date in a closed month is recorded in the open period, labelled "Về muộn" (design module4 12).
      const late = (await lockedMonth(ctx, tree, i.received_on)) ? await openMonthFrom(ctx, tree, businessDate(new Date())) : null;
      if (late) roleCol(tree.dots, "ky_ghi_nhan");
      const dealNew = new Map<string, string[]>();
      const confirmedDeals = new Map<string, { deal_id: string; deal: string; user_ids: string[]; payments: number }>();
      const dotSrc = sourceValue(tree.dots, ctx);
      for (const a of i.allocations) {
        const row = dots.get(a.payment_id)!;
        const dealId = dealOf.get(a.payment_id)!;
        const deal = deals.get(dealId)!;
        const planned = numOf(cellOf(tree.dots, row, "so_tien_du_kien"));
        const split = a.com_split ? splitCell(a.com_split) : !empty(cellOf(tree.dots, row, "chia_com_dot")) ? (cellOf(tree.dots, row, "chia_com_dot") as unknown as PersonEntry[]) : splitFromParts(partsOf.get(dealId) ?? []);
        const shortfall = a.amount < planned - 0.5;
        const splitOff = shortfall && a.shortfall === "split";
        await write(ctx, tree.dots, [
          {
            op: "update",
            id: a.payment_id,
            data: cells(tree.dots, [
              ["ngay_tien_ve", i.received_on],
              ["so_tien_ve", a.amount],
              ["so_tien_nhan", a.amount_received ?? a.amount],
              ["tien_ve", [receiptId!] as Stored],
              ["chia_com_dot", split as unknown as Stored],
              ...(late ? ([["ky_ghi_nhan", late]] as [string, Stored][]) : []),
              ...(splitOff ? ([["so_tien_du_kien", a.amount]] as [string, Stored][]) : []),
            ]),
          },
        ]);
        let splitOffId: string | null = null;
        if (splitOff) {
          const [r] = await write(ctx, tree.dots, [
            {
              op: "create",
              data: cells(tree.dots, [
                ["deal", [dealId] as Stored],
                ["phap_nhan", cellOf(tree.dots, row, "phap_nhan")],
                ["ma_so_thue", cellOf(tree.dots, row, "ma_so_thue")],
                ["so_hop_dong", cellOf(tree.dots, row, "so_hop_dong")],
                ["dot_so", cellOf(tree.dots, row, "dot_so")],
                ["so_tien_du_kien", planned - a.amount],
                ["han", cellOf(tree.dots, row, "han")],
                ["nguoi_tham_gia", cellOf(tree.dots, row, "nguoi_tham_gia")],
                ["nguon_nhap", dotSrc],
              ]),
            },
          ]);
          splitOffId = r!.id;
          dealNew.set(dealId, [...(dealNew.get(dealId) ?? []), splitOffId]);
        }
        outPayments.push({ id: a.payment_id, split_off_id: splitOffId });
        // the first payment of the deal to arrive makes it Won
        const others = [...dealPayments.get(dealId)!.values()].some((r) => r.id !== a.payment_id && confirmed(tree.dots, r));
        if (!others && !firstOf.has(dealId) && statusMeaning(tree.deals, deal) !== "won") {
          const won = optionByMeaning(tree.deals, "trang_thai", "won");
          if (!won) throw new AppError("conflict", "Cột Trạng thái của Deals chưa có lựa chọn mang nghĩa Won.", { reason: "status_option_missing", meaning: "won" });
          await write(ctx, tree.deals, [{ op: "update", id: dealId, data: cells(tree.deals, [["trang_thai", won]]) }], true);
          wonDeals.push(dealId);
        }
        firstOf.add(dealId);
        const mark = confirmedDeals.get(dealId);
        if (mark) mark.payments++;
        else confirmedDeals.set(dealId, { deal_id: dealId, deal: String(cellOf(tree.deals, deal, "ten_cong_ty") ?? ""), user_ids: peopleIds(tree.deals, deal), payments: 1 });
        // commission lines (Tạm tính): one per person with a share
        const ops: RowOp[] = split
          .filter((e) => Number(e.attrs?.[COM_ATTR] ?? 0) > 0)
          .map((e) => ({
            op: "create" as const,
            data: cells(tree.ledger, [
              ["nguoi", e.id],
              ["dot", [a.payment_id] as Stored],
              ["deal", [dealId] as Stored],
              ["ty_le_com", Number(e.attrs[COM_ATTR])],
              ["trang_thai_com", optionNamed(tree.ledger, "trang_thai_com", "Tạm tính")],
            ]),
          }));
        if (ops.length) {
          const made = (await write(ctx, tree.ledger, ops)).map((r) => r.id);
          ledgerIds.push(...made);
          ledgerByDeal.set(dealId, [...(ledgerByDeal.get(dealId) ?? []), ...made]);
        }
        await addRevenueLines(ctx, tree, a.payment_id, dealId, cellOf(tree.dots, row, "nguoi_tham_gia"));
      }
      const linkCol = roleCol(tree.deals, "dot_thanh_toan", false);
      if (linkCol) {
        for (const [dealId, added] of dealNew) {
          const keep = [...dealPayments.get(dealId)!.keys()];
          await write(ctx, tree.deals, [{ op: "update", id: dealId, data: { [linkCol.key]: [...keep, ...added] } }]);
        }
      }
      await linkLedger(ctx, tree, ledgerByDeal);
      if (confirmedDeals.size) await ctx.emit("deal.payment.confirmed", { aggregateType: "datahub_table", aggregateId: tree.deals.acc.tableId, payload: { table_id: tree.deals.acc.tableId, deals: [...confirmedDeals.values()] } });
      ctx.audit({ type: "deal_payment", id: receiptId!, details: { operation: "confirm", payments: ids.length, won: wonDeals.length } });
      return { receipt_id: receiptId!, payments: outPayments, won_deal_ids: wonDeals, ledger_ids: ledgerIds };
    },
  }),

  // ==============================================================================================
  // payment.unconfirm
  // ==============================================================================================
  defineCommand({
    name: "payment.unconfirm",
    summary: "Huỷ xác nhận tiền về của các đợt khi kỳ chưa chốt: xoá dòng Sổ com Tạm tính; đợt duy nhất đã về thì deal về lại trạng thái mở.",
    description:
      "Chỉ Manager của cây. Tháng của ngày tiền về đã chốt (khoá kỳ) thì lỗi `period_locked`; dòng Sổ com đã chốt hoặc điều chỉnh của đợt thì lỗi `conflict` (dùng `commission.adjust`). " +
      "Đợt trở lại chưa về (xoá ngày, số tiền về, số tiền nhận, liên kết Tiền về); khoản Tiền về giữ lại ở trạng thái Chưa ghép. Đợt đã tách khi về thiếu không được gộp lại. Cần `Idempotency-Key`.",
    permission: "deal:payment:write",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z.object({ payment_ids: z.array(Id).min(1).max(50) }),
    output: z.object({ payment_ids: z.array(Id), reopened_deal_ids: z.array(Id), removed_ledger_ids: z.array(Id) }),
    http: { method: "POST", path: "/deal/payments/unconfirm", status: 200 },
    handler: async (ctx, i) => {
      const tree = await loadTree(ctx);
      const dots = await readRows(ctx, tree.dots, i.payment_ids);
      const receipts = new Map<string, string[]>();
      const dealIds = new Set<string>();
      for (const id of i.payment_ids) {
        const row = dots.get(id);
        if (!row) throw new AppError("not_found", "Không tìm thấy đợt thanh toán.", { reason: "payment_not_found", payment_id: id });
        if (!confirmed(tree.dots, row)) throw new AppError("conflict", "Đợt này chưa xác nhận tiền về.", { reason: "payment_not_confirmed", payment_id: id });
        await assertPeriodOpen(ctx.db, { tableId: tree.dots.acc.tableId, scope: tree.managerId, dates: [dateOf(cellOf(tree.dots, row, "ngay_tien_ve"))] });
        for (const r of idsOf(cellOf(tree.dots, row, "tien_ve"))) receipts.set(r, [...(receipts.get(r) ?? []), id]);
        const d = idsOf(cellOf(tree.dots, row, "deal"))[0];
        if (d) dealIds.add(d);
      }
      // ledger lines of the payments: only Tạm tính ones go
      const dotCol = roleCol(tree.ledger, "dot")!;
      const link = sourceOf(dotCol).cellExpr(dotCol, "data", "json");
      const lres = await ctx.db.execute(sql`SELECT id FROM dh_rows WHERE ${tree.ledger.acc.rows()} AND deleted_at IS NULL AND ${link} ?| ${`{${i.payment_ids.join(",")}}`}::text[]`);
      const lines = await readRows(ctx, tree.ledger, (lres.rows as { id: string }[]).map((r) => r.id));
      const temp = optionNamed(tree.ledger, "trang_thai_com", "Tạm tính");
      for (const l of lines.values()) {
        if (cellOf(tree.ledger, l, "trang_thai_com") !== temp) throw new AppError("conflict", "Đợt có dòng Sổ com đã chốt hoặc điều chỉnh. Dùng điều chỉnh com thay vì huỷ.", { reason: "ledger_not_temporary", ledger_id: l.id });
      }
      if (lines.size) await write(ctx, tree.ledger, [...lines.keys()].map((id) => ({ op: "delete" as const, id })));
      await unlinkLedger(ctx, tree, [...dealIds], new Set(lines.keys()));
      const revenueIds = await revenueLinesOf(ctx, tree, i.payment_ids);
      if (revenueIds.length) await write(ctx, tree.revenue!, revenueIds.map((id) => ({ op: "delete" as const, id })));
      await write(
        ctx,
        tree.dots,
        i.payment_ids.map((id) => ({ op: "update" as const, id, data: cells(tree.dots, [["ngay_tien_ve", null], ["so_tien_ve", null], ["so_tien_nhan", null], ["tien_ve", null], ["ky_ghi_nhan", null]]) })),
      );
      for (const [rid, pids] of receipts) {
        const row = (await readRows(ctx, tree.receipts, [rid])).get(rid);
        if (!row) continue;
        const left = idsOf(cellOf(tree.receipts, row, "dot")).filter((x) => !pids.includes(x));
        await write(ctx, tree.receipts, [{ op: "update", id: rid, data: cells(tree.receipts, [["dot", left.length ? (left as Stored) : null]]) }]);
      }
      // a deal with no confirmed payment left goes back to an open status
      const reopened: string[] = [];
      const open = optionByMeaning(tree.deals, "trang_thai", "open");
      for (const d of dealIds) {
        const deal = (await readRows(ctx, tree.deals, [d])).get(d);
        if (!deal || statusMeaning(tree.deals, deal) !== "won") continue;
        const rest = [...(await paymentsOfDeal(ctx, tree, d)).values()].some((r) => confirmed(tree.dots, r));
        if (rest) continue;
        if (!open) throw new AppError("conflict", "Cột Trạng thái của Deals chưa có lựa chọn mang nghĩa mở.", { reason: "status_option_missing", meaning: "open" });
        await write(ctx, tree.deals, [{ op: "update", id: d, data: cells(tree.deals, [["trang_thai", open]]) }], true);
        reopened.push(d);
      }
      ctx.audit({ type: "deal_payment", id: i.payment_ids[0]!, details: { operation: "unconfirm", payments: i.payment_ids.length, reopened: reopened.length } });
      return { payment_ids: i.payment_ids, reopened_deal_ids: reopened, removed_ledger_ids: [...lines.keys()] };
    },
  }),

  // ==============================================================================================
  // commission.adjust
  // ==============================================================================================
  defineCommand({
    name: "commission.adjust",
    summary: "Thêm dòng Sổ com Điều chỉnh (có lý do, có thể âm) cho một người và một đợt.",
    description:
      "Chỉ Manager của cây. Dùng để sửa sai nhập liệu sau khi kỳ đã chốt (số đã chốt không sửa trực tiếp). Dòng Điều chỉnh là số cứng (`Com cố định`), không phải công thức. `reason` bắt buộc. Cần `Idempotency-Key`.",
    permission: "deal:payment:write",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z.object({
      payment_id: Id.describe("Đợt mà khoản điều chỉnh thuộc về (quyết định kỳ và deal)."),
      person_id: Id,
      amount: z.number().finite().min(-1e13).max(1e13).describe("Số tiền com điều chỉnh, có thể âm."),
      reason: z.string().trim().min(1, "Cần ghi lý do.").max(500),
      period: ymd.optional().describe("Tháng ghi nhận (ngày bất kỳ của tháng). Mặc định: kỳ đang mở (tháng hiện tại, hoặc tháng gần nhất chưa chốt)."),
    }),
    output: z.object({ ledger_id: Id, period: z.string() }),
    http: { method: "POST", path: "/deal/commission/adjust", status: 201 },
    handler: async (ctx, i) => {
      const tree = await loadTree(ctx);
      const row = (await readRows(ctx, tree.dots, [i.payment_id])).get(i.payment_id);
      if (!row) throw new AppError("not_found", "Không tìm thấy đợt thanh toán.", { reason: "payment_not_found" });
      const dealId = idsOf(cellOf(tree.dots, row, "deal"))[0];
      roleCol(tree.ledger, "ky_ghi_nhan");
      const period = await openMonthFrom(ctx, tree, i.period ?? businessDate(new Date()));
      const [r] = await write(ctx, tree.ledger, [
        {
          op: "create",
          data: cells(tree.ledger, [
            ["nguoi", i.person_id],
            ["dot", [i.payment_id] as Stored],
            ["deal", dealId ? ([dealId] as Stored) : undefined],
            ["ky_ghi_nhan", period],
            ["com_co_dinh", i.amount],
            ["trang_thai_com", optionNamed(tree.ledger, "trang_thai_com", "Điều chỉnh")],
            ["ly_do", i.reason],
          ]),
        },
      ]);
      if (dealId) await linkLedger(ctx, tree, new Map([[dealId, [r!.id]]]));
      ctx.audit({ type: "deal_payment", id: i.payment_id, details: { operation: "adjust" } });
      return { ledger_id: r!.id, period };
    },
  }),

  // ==============================================================================================
  // payment.match_candidates
  // ==============================================================================================
  defineQuery({
    name: "payment.match_candidates",
    summary: "Xếp hạng các đợt chưa về của cây có thể là đợt mà một khoản tiền vừa về đã trả, kèm lý do.",
    description:
      "Chỉ Manager của cây. Nhập những gì thông báo có (số tiền gồm VAT, tên đơn vị trả, số tài khoản, mã số thuế, nội dung, ngày). Chấm điểm bằng luật cố định ở server (không dùng AI): ghi nhớ các khoản đã ghép (số tài khoản, tên người trả), mã số thuế, số hợp đồng trong nội dung, tên pháp nhân gần đúng, số tiền (bằng số tiền đợt hoặc cộng VAT 0/5/8/10%), hạn. " +
      "`strong: true` là gợi ý đủ chắc để AI tự xác nhận (một dấu hiệu ghi nhớ hoặc mã số thuế VÀ số tiền khớp); AI chỉ tự xác nhận khi có đúng một gợi ý như vậy.",
    permission: "deal:payment:write",
    aiAllowed: true,
    input: z.object({
      amount: z.coerce.number().finite().min(0).max(1e13).optional(),
      payer_name: z.string().trim().max(200).optional(),
      account_no: z.string().trim().max(60).optional(),
      tax_code: z.string().trim().max(40).optional(),
      content: z.string().trim().max(1000).optional(),
      received_on: ymd.optional(),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    }),
    output: z.array(
      z.object({
        payment_id: Id,
        deal_id: Id.nullable(),
        deal_name: z.string().nullable(),
        seq: z.number().int().nullable(),
        planned: z.number().nullable(),
        due: z.string().nullable(),
        score: z.number(),
        strong: z.boolean(),
        reasons: z.array(z.string()),
      }),
    ),
    http: { method: "GET", path: "/deal/payments/match" },
    handler: async (ctx, i) => {
      const tree = await loadTree(ctx);
      // unconfirmed payments only
      const dateCol = roleCol(tree.dots, "ngay_tien_ve")!;
      const dateExpr = sourceOf(dateCol).cellExpr(dateCol, "data", "text");
      const res = await ctx.db.execute(sql`SELECT id FROM dh_rows WHERE ${tree.dots.acc.rows()} AND deleted_at IS NULL AND (${dateExpr} IS NULL OR ${dateExpr} = '') LIMIT 5000`);
      const dots = await readRows(ctx, tree.dots, (res.rows as { id: string }[]).map((r) => r.id));
      const dealIds = [...new Set([...dots.values()].flatMap((r) => idsOf(cellOf(tree.dots, r, "deal"))))];
      const deals = await readRows(ctx, tree.deals, dealIds);
      const nameCol = roleCol(tree.deals, "ten_cong_ty", false);
      const facts: PaymentFacts[] = [...dots.values()].map((r) => {
        const dealId = idsOf(cellOf(tree.dots, r, "deal"))[0] ?? null;
        const dn = dealId && nameCol ? deals.get(dealId)?.data[nameCol.key] : null;
        const text = (role: string) => {
          const v = cellOf(tree.dots, r, role);
          return typeof v === "string" && v ? v : null;
        };
        return {
          id: r.id,
          dealId,
          dealName: typeof dn === "string" ? dn : null,
          legalEntity: text("phap_nhan"),
          taxCode: text("ma_so_thue"),
          contractNo: text("so_hop_dong"),
          seq: numOf(cellOf(tree.dots, r, "dot_so")) || null,
          planned: numOf(cellOf(tree.dots, r, "so_tien_du_kien")) || null,
          due: dateOf(cellOf(tree.dots, r, "han")),
        };
      });
      // memory: the deals that earlier transfers (already linked to a payment) paid, from the same account or the same payer
      const memory: MatchMemory = { accountDeals: new Set(), payerDeals: new Set() };
      if (i.account_no || i.payer_name) {
        const linkCol = roleCol(tree.receipts, "dot")!;
        const link = sourceOf(linkCol).cellExpr(linkCol, "data", "json");
        const rres = await ctx.db.execute(sql`SELECT id FROM dh_rows WHERE ${tree.receipts.acc.rows()} AND deleted_at IS NULL AND jsonb_array_length(coalesce(${link}, '[]'::jsonb)) > 0 ORDER BY updated_at DESC LIMIT 5000`);
        const rrows = await readRows(ctx, tree.receipts, (rres.rows as { id: string }[]).map((r) => r.id));
        const acct = i.account_no ? i.account_no.replace(/\D+/g, "") : "";
        const payer = i.payer_name ? fold(i.payer_name) : "";
        for (const r of rrows.values()) {
          const a = String(cellOf(tree.receipts, r, "so_tai_khoan") ?? "").replace(/\D+/g, "");
          const p = fold(String(cellOf(tree.receipts, r, "nguoi_tra") ?? ""));
          const hitA = !!acct && a === acct;
          const hitP = !!payer && p === payer;
          if (!hitA && !hitP) continue;
          const paidDots = await readRows(ctx, tree.dots, idsOf(cellOf(tree.receipts, r, "dot")));
          for (const d of paidDots.values()) {
            const dealId = idsOf(cellOf(tree.dots, d, "deal"))[0];
            if (!dealId) continue;
            if (hitA) memory.accountDeals.add(dealId);
            if (hitP) memory.payerDeals.add(dealId);
          }
        }
      }
      const input = { amount: i.amount, payer_name: i.payer_name, account_no: i.account_no, tax_code: i.tax_code, content: i.content, received_on: i.received_on };
      return scoreCandidates(input, facts, memory, { limit: i.limit });
    },
  }),
];

