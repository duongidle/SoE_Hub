import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, businessDate } from "@soe/shared";
import { createSnapshot, type Db, type Executor } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { Id } from "../datahub/shared";
import type { SelectOption } from "../datahub/types";

/**
 * Forecast and snapshot of the deals (design module4 11), one place that computes them:
 * - `deal.forecast`: two parts by deal type and month: SIGNED (planned amount of the instalments not yet paid whose due date falls in the range) and
 *   UNSIGNED (the expected revenue of open deals with no schedule whose expected closing date falls in the range);
 * - `deal.snapshot.create` and the job `deal-quarter-snapshot` (00:05 on the first day of a quarter) copy the open deals with their forecast value;
 * - `deal.snapshot.compare` sorts each deal of a snapshot, at the end of the quarter, into won in the quarter / slipped / lost / still open, and gives the accuracy.
 * Facts are read by ROLE from the tables of the Manager's tree, with system scope, so the command, the job and the dashboard (4.6) read the same numbers.
 */

interface Opt {
  name: string;
  meaning?: string;
}
interface RoleTable {
  tableId: string;
  key: (role: string) => string | null;
  options: (role: string) => Map<string, Opt>;
}
async function roleTable(db: Executor, managerId: string, roleSet: string): Promise<RoleTable | null> {
  const t = await db.execute(sql`SELECT master_table_id FROM dh_templates WHERE /*scope:system*/ manager_id = ${managerId}::uuid AND scope = 'tree' AND role_set = ${roleSet} AND deleted_at IS NULL ORDER BY created_at LIMIT 1`);
  const tableId = (t.rows[0] as { master_table_id: string | null } | undefined)?.master_table_id;
  if (!tableId) return null;
  const c = await db.execute(sql`SELECT role, key, config FROM dh_columns WHERE /*scope:system*/ table_id = ${tableId}::uuid AND role IS NOT NULL AND deleted_at IS NULL`);
  const cols = new Map((c.rows as { role: string; key: string; config: Record<string, unknown> }[]).map((r) => [r.role, r]));
  return {
    tableId,
    key: (role) => cols.get(role)?.key ?? null,
    options: (role) => new Map(((cols.get(role)?.config?.options as (SelectOption & { meaning?: string })[] | undefined) ?? []).map((o) => [o.id, { name: o.name, meaning: o.meaning }])),
  };
}
const dateOf = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const numOf = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export interface DealFact {
  id: string;
  name: string | null;
  type: string;
  meaning: string;
  expectedClose: string | null;
  closing: string | null;
  revenue: number;
  /** Instalments not yet paid: planned amount and due date. */
  openDots: { amount: number; due: string | null }[];
  hasSchedule: boolean;
}

export async function dealFacts(db: Executor, managerId: string): Promise<DealFact[]> {
  const deals = await roleTable(db, managerId, "deals");
  const dots = await roleTable(db, managerId, "payments");
  if (!deals) return [];
  const k = (role: string) => deals.key(role);
  const [kType, kStatus, kName, kExp, kClose, kRev] = ["loai_deal", "trang_thai", "ten_cong_ty", "ngay_du_kien_chot", "ngay_chot", "doanh_thu"].map(k);
  const types = deals.options("loai_deal");
  const statuses = deals.options("trang_thai");
  const rows = (await db.execute(sql`SELECT id, data FROM dh_rows WHERE /*scope:system*/ table_id = ${deals.tableId}::uuid AND deleted_at IS NULL`)).rows as { id: string; data: Record<string, unknown> }[];
  const byDeal = new Map<string, { amount: number; due: string | null }[]>();
  const scheduled = new Set<string>();
  if (dots) {
    const [kDeal, kPlan, kDue, kPaid] = ["deal", "so_tien_du_kien", "han", "ngay_tien_ve"].map((r) => dots.key(r));
    if (kDeal) {
      const drows = (await db.execute(sql`SELECT data FROM dh_rows WHERE /*scope:system*/ table_id = ${dots.tableId}::uuid AND deleted_at IS NULL`)).rows as { data: Record<string, unknown> }[];
      for (const r of drows) {
        const d = Array.isArray(r.data[kDeal]) ? (r.data[kDeal] as unknown[])[0] : null;
        if (typeof d !== "string") continue;
        scheduled.add(d);
        if (kPaid && dateOf(r.data[kPaid])) continue;
        byDeal.set(d, [...(byDeal.get(d) ?? []), { amount: kPlan ? numOf(r.data[kPlan]) : 0, due: kDue ? dateOf(r.data[kDue]) : null }]);
      }
    }
  }
  return rows.map((r) => ({
    id: r.id,
    name: kName && typeof r.data[kName] === "string" ? (r.data[kName] as string) : null,
    type: (kType && types.get(String(r.data[kType]))?.name) || "Khác",
    meaning: (kStatus && statuses.get(String(r.data[kStatus]))?.meaning) || "open",
    expectedClose: kExp ? dateOf(r.data[kExp]) : null,
    closing: kClose ? dateOf(r.data[kClose]) : null,
    revenue: kRev ? numOf(r.data[kRev]) : 0,
    openDots: byDeal.get(r.id) ?? [],
    hasSchedule: scheduled.has(r.id),
  }));
}

const inRange = (d: string | null, from: string, to: string) => d !== null && d >= from && d <= to;
export interface ForecastPart {
  type: string;
  month: string;
  signed: number;
  unsigned: number;
}
/** The two parts of the forecast of a range (design module4 11). A deal that is closed (lost, disqualified, converted, cancelled) has none. */
export function forecastParts(facts: DealFact[], from: string, to: string): ForecastPart[] {
  const out = new Map<string, ForecastPart>();
  const add = (type: string, month: string, part: "signed" | "unsigned", v: number) => {
    const key = `${type}|${month}`;
    const e = out.get(key) ?? { type, month, signed: 0, unsigned: 0 };
    e[part] += v;
    out.set(key, e);
  };
  for (const d of facts) {
    if (d.meaning !== "open" && d.meaning !== "won") continue;
    for (const p of d.openDots) if (inRange(p.due, from, to)) add(d.type, p.due!.slice(0, 7), "signed", p.amount);
    if (d.meaning === "open" && !d.hasSchedule && inRange(d.expectedClose, from, to)) add(d.type, d.expectedClose!.slice(0, 7), "unsigned", d.revenue);
  }
  return [...out.values()].sort((a, b) => a.month.localeCompare(b.month) || a.type.localeCompare(b.type));
}

export const quarterOf = (date: string): { id: string; start: string; end: string } => {
  const y = Number(date.slice(0, 4));
  const q = Math.floor((Number(date.slice(5, 7)) - 1) / 3);
  const sm = q * 3 + 1;
  const endDay = new Date(Date.UTC(y, sm + 2, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { id: `${y}-Q${q + 1}`, start: `${y}-${p(sm)}-01`, end: `${y}-${p(sm + 2)}-${p(endDay)}` };
};

interface SnapData {
  name: string | null;
  type: string;
  revenue: number;
  expected_close: string | null;
  has_schedule: boolean;
  signed_in_quarter: number;
  value: number;
}
/** What a deal is worth to the forecast of the quarter at the moment of the snapshot. */
function snapOf(d: DealFact, q: { start: string; end: string }): SnapData {
  const signed = d.openDots.filter((p) => inRange(p.due, q.start, q.end)).reduce((s, p) => s + p.amount, 0);
  const value = d.hasSchedule ? signed : inRange(d.expectedClose, q.start, q.end) ? d.revenue : 0;
  return { name: d.name, type: d.type, revenue: d.revenue, expected_close: d.expectedClose, has_schedule: d.hasSchedule, signed_in_quarter: signed, value };
}

const KIND = "deal_forecast";
/** Takes the snapshot of the open deals of a tree for the quarter of `today`. `auto` snapshots are one per quarter. */
export async function snapshotTree(db: Db, managerId: string, takenBy: string | null, today: string, o: { auto: boolean; note?: string }) {
  const q = quarterOf(today);
  const dealsT = await roleTable(db, managerId, "deals");
  if (!dealsT) return null;
  if (o.auto) {
    const have = await db.execute(sql`SELECT 1 FROM snapshots WHERE kind = ${KIND} AND scope = ${managerId} AND note LIKE ${`%"auto":true,"quarter":"${q.id}"%`} LIMIT 1`);
    if (have.rows.length) return null;
  }
  const facts = (await dealFacts(db, managerId)).filter((d) => d.meaning === "open");
  const note = JSON.stringify({ auto: o.auto, quarter: q.id, start: q.start, end: q.end, taken_on: today, text: o.note ?? null });
  return db.transaction(async (tx) => {
    const rows = facts.map((d) => ({ rowId: d.id, data: snapOf(d, q) }));
    const snap = await createSnapshot(tx, { name: o.auto ? `Dự báo đầu quý ${q.id}` : `Dự báo ${today}`, kind: KIND, tableId: dealsT.tableId, scope: managerId, takenBy, note, rows });
    return { snapshot: snap, forecast: rows.reduce((s, r) => s + r.data.value, 0) };
  });
}
/** The job: one snapshot per tree (every Manager with a Deals table), once a quarter. */
export async function snapshotAllTrees(db: Db, now: Date = new Date()): Promise<number> {
  const res = await db.execute(sql`SELECT DISTINCT manager_id FROM dh_templates WHERE /*scope:system*/ scope = 'tree' AND role_set = 'deals' AND deleted_at IS NULL`);
  let n = 0;
  for (const r of res.rows as { manager_id: string }[]) if (await snapshotTree(db, r.manager_id, null, businessDate(now), { auto: true })) n++;
  return n;
}

function managerOf(ctx: Pick<HandlerCtx, "access">) {
  return ctx.access.requirePrincipal().then((p) => {
    if (!p.roles.includes("manager")) throw new AppError("forbidden", "Chỉ Manager của cây xem và chụp dự báo.", { reason: "manager_only" });
    return p.userId;
  });
}
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD.");

export const forecastOperations = [
  defineQuery({
    name: "deal.forecast",
    summary: "Forecast của cây theo loại deal và tháng, hai phần: đã ký chờ tiền về, chưa ký.",
    description:
      "Chỉ Manager của cây. `signed`: tổng `Số tiền dự kiến` của các đợt chưa về có hạn trong khoảng (deal mở hoặc Won). `unsigned`: `Doanh thu` của deal đang mở chưa có lịch thanh toán, có Ngày dự kiến chốt trong khoảng. Deal đã đóng (Lost, Disqualified, Convert, Huỷ) không tính.",
    permission: "deal:snapshot:create",
    aiAllowed: true,
    input: z.object({ from: ymd, to: ymd, deal_type: z.string().max(100).optional() }),
    output: z.object({
      from: z.string(),
      to: z.string(),
      signed: z.number(),
      unsigned: z.number(),
      by_type: z.array(z.object({ type: z.string(), signed: z.number(), unsigned: z.number() })),
      by_month: z.array(z.object({ month: z.string(), signed: z.number(), unsigned: z.number() })),
      parts: z.array(z.object({ type: z.string(), month: z.string(), signed: z.number(), unsigned: z.number() })),
    }),
    http: { method: "GET", path: "/deal/forecast" },
    handler: async (ctx, i) => {
      const m = await managerOf(ctx);
      if (i.to < i.from) throw new AppError("validation_error", "Ngày kết thúc phải sau ngày bắt đầu.");
      const parts = forecastParts(await dealFacts(ctx.db, m), i.from, i.to).filter((p) => !i.deal_type || p.type === i.deal_type);
      const sum = (key: "type" | "month") => {
        const g = new Map<string, { signed: number; unsigned: number }>();
        for (const p of parts) {
          const e = g.get(p[key]) ?? { signed: 0, unsigned: 0 };
          e.signed += p.signed;
          e.unsigned += p.unsigned;
          g.set(p[key], e);
        }
        return [...g].map(([k, v]) => ({ [key]: k, ...v }));
      };
      return {
        from: i.from,
        to: i.to,
        signed: parts.reduce((s, p) => s + p.signed, 0),
        unsigned: parts.reduce((s, p) => s + p.unsigned, 0),
        by_type: sum("type") as { type: string; signed: number; unsigned: number }[],
        by_month: sum("month") as { month: string; signed: number; unsigned: number }[],
        parts,
      };
    },
  }),

  defineCommand({
    name: "deal.snapshot.create",
    summary: "Chụp thêm snapshot dự báo: các deal đang mở của cây, kèm giá trị dự báo của quý hiện tại.",
    description: "Chỉ Manager của cây. Ngoài snapshot tự động 00:05 ngày đầu mỗi quý. Snapshot chỉ đọc, không sửa được. Cần `Idempotency-Key`.",
    permission: "deal:snapshot:create",
    aiAllowed: true,
    input: z.object({ note: z.string().trim().max(300).optional() }),
    output: z.object({ id: Id, name: z.string(), quarter: z.string(), row_count: z.number().int(), forecast: z.number() }),
    http: { method: "POST", path: "/deal/snapshots", status: 201 },
    handler: async (ctx, i) => {
      const m = await managerOf(ctx);
      const today = businessDate(new Date());
      const r = await snapshotTree(ctx.db as unknown as Db, m, ctx.actor.userId, today, { auto: false, note: i.note });
      if (!r) throw new AppError("conflict", "Cây chưa có bảng Deals.", { reason: "payment_table_missing", role_set: "deals" });
      ctx.audit({ type: "deal_snapshot", id: r.snapshot.id, details: { operation: "create", rows: r.snapshot.rowCount } });
      return { id: r.snapshot.id, name: r.snapshot.name, quarter: quarterOf(today).id, row_count: r.snapshot.rowCount, forecast: r.forecast };
    },
  }),

  defineQuery({
    name: "deal.snapshot.list",
    summary: "Các snapshot dự báo của cây (mới nhất trước).",
    permission: "deal:snapshot:create",
    aiAllowed: true,
    input: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
    output: z.array(z.object({ id: Id, name: z.string(), taken_at: z.string(), row_count: z.number().int(), auto: z.boolean(), quarter: z.string().nullable(), note: z.string().nullable() })),
    http: { method: "GET", path: "/deal/snapshots" },
    handler: async (ctx, i) => {
      const m = await managerOf(ctx);
      const r = await ctx.db.execute(sql`SELECT id, name, taken_at::text AS taken_at, row_count, note FROM snapshots WHERE kind = ${KIND} AND scope = ${m} ORDER BY taken_at DESC LIMIT ${i.limit}`);
      return (r.rows as { id: string; name: string; taken_at: string; row_count: number; note: string | null }[]).map((x) => {
        const n = x.note ? (JSON.parse(x.note) as { auto?: boolean; quarter?: string; text?: string | null }) : {};
        return { id: x.id, name: x.name, taken_at: x.taken_at, row_count: x.row_count, auto: !!n.auto, quarter: n.quarter ?? null, note: n.text ?? null };
      });
    },
  }),

  defineQuery({
    name: "deal.snapshot.compare",
    summary: "So snapshot đầu quý với hiện tại: mỗi deal trong snapshot rơi vào Won trong quý, trượt sang quý sau, Lost/Disqualified, hay vẫn mở; độ chính xác.",
    description:
      "Chỉ Manager của cây. Won trong quý: Won và Closing date trong quý của snapshot. Trượt: vẫn mở với Ngày dự kiến chốt sau quý, hoặc Won sau quý. Lost/Disqualified: Lost, Disqualified, Convert to POD, Huỷ, hoặc deal đã bị xoá. Vẫn mở: còn lại. " +
      "Độ chính xác = Doanh thu thực tế của deal Won trong quý ÷ forecast lúc chụp (tổng `value` của snapshot). Trả theo loại deal.",
    permission: "deal:snapshot:create",
    aiAllowed: true,
    input: z.object({ snapshot_id: Id }),
    output: z.object({
      snapshot_id: Id,
      quarter: z.string(),
      forecast: z.number(),
      actual: z.number(),
      accuracy: z.number().nullable(),
      groups: z.array(z.object({ group: z.enum(["won", "slipped", "lost", "open"]), count: z.number().int(), forecast: z.number(), actual: z.number() })),
      by_type: z.array(z.object({ type: z.string(), forecast: z.number(), actual: z.number(), accuracy: z.number().nullable() })),
      deals: z.array(z.object({ deal_id: Id, name: z.string().nullable(), type: z.string(), group: z.enum(["won", "slipped", "lost", "open"]), forecast: z.number(), actual: z.number() })),
    }),
    http: { method: "GET", path: "/deal/snapshots/compare" },
    handler: async (ctx, i) => {
      const m = await managerOf(ctx);
      const s = (await ctx.db.execute(sql`SELECT id, note FROM snapshots WHERE id = ${i.snapshot_id}::uuid AND kind = ${KIND} AND scope = ${m}`)).rows[0] as { id: string; note: string | null } | undefined;
      if (!s) throw new AppError("not_found", "Không tìm thấy snapshot.", { reason: "snapshot_not_found" });
      const meta = JSON.parse(s.note ?? "{}") as { quarter: string; start: string; end: string };
      const snap = (await ctx.db.execute(sql`SELECT row_id, data FROM snapshot_rows WHERE snapshot_id = ${s.id}::uuid`)).rows as { row_id: string; data: SnapData }[];
      const now = new Map((await dealFacts(ctx.db, m)).map((d) => [d.id, d]));
      const deals = snap.map((r) => {
        const cur = now.get(r.row_id);
        let group: "won" | "slipped" | "lost" | "open";
        if (!cur) group = "lost";
        else if (cur.meaning === "won") group = inRange(cur.closing, meta.start, meta.end) ? "won" : cur.closing && cur.closing > meta.end ? "slipped" : "open";
        else if (cur.meaning === "open") group = cur.expectedClose && cur.expectedClose > meta.end ? "slipped" : "open";
        else group = "lost";
        return { deal_id: r.row_id, name: r.data.name, type: r.data.type, group, forecast: r.data.value, actual: group === "won" ? (cur?.revenue ?? 0) : 0 };
      });
      const sumBy = <K extends string>(key: (d: (typeof deals)[number]) => K) => {
        const g = new Map<K, { count: number; forecast: number; actual: number }>();
        for (const d of deals) {
          const e = g.get(key(d)) ?? { count: 0, forecast: 0, actual: 0 };
          e.count++;
          e.forecast += d.forecast;
          e.actual += d.actual;
          g.set(key(d), e);
        }
        return g;
      };
      const forecast = deals.reduce((a, d) => a + d.forecast, 0);
      const actual = deals.reduce((a, d) => a + d.actual, 0);
      const ratio = (a: number, f: number) => (f > 0 ? a / f : null);
      return {
        snapshot_id: s.id,
        quarter: meta.quarter,
        forecast,
        actual,
        accuracy: ratio(actual, forecast),
        groups: (["won", "slipped", "lost", "open"] as const).map((g) => ({ group: g, ...(sumBy((d) => d.group).get(g) ?? { count: 0, forecast: 0, actual: 0 }) })),
        by_type: [...sumBy((d) => d.type)].map(([type, e]) => ({ type, forecast: e.forecast, actual: e.actual, accuracy: ratio(e.actual, e.forecast) })),
        deals,
      };
    },
  }),
];
