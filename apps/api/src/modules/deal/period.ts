import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@soe/shared";
import { lockPeriod, unlockPeriod } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import { currentChangeSeq } from "../datahub/change-queue";
import { waitConsistent } from "../datahub/consistency";
import { sourceOf } from "../datahub/column-source";
import { capFor } from "../datahub/people-caps";
import { activeLocks } from "../datahub/period-guard";
import { rowFromDb } from "../datahub/table-schema";
import { userIdsOf } from "../datahub/user-values";
import { ROW_EVENTS, Id } from "../datahub/shared";
import type { PersonEntry, SelectOption, Stored } from "../datahub/types";
import { COM_ATTR, cellOf, cells, confirmed, idsOf, loadTree, numOf, optionByMeaning, readRows, roleCol, statusMeaning, write, type Ctx, type RowData, type T, type Tree } from "./payments";

/**
 * Period closing (design module4 12): `period.close`, `period.reopen`, and the queries of the closing screen `period.review`, `period.com`, `period.list`.
 * The freeze itself is a period lock on the Đợt thanh toán and Deals tables (scope = the Manager of the tree) that `applyRowOps` meets in
 * `apps/api/src/modules/datahub/period-guard.ts`; closing also turns the month's `Tạm tính` commission lines into fixed values (`Đã chốt`).
 * The lists of "Cần xử lý trước khi chốt" are computed here, once; the web only shows them.
 */

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Tháng dạng YYYY-MM.");
const lastDay = (ym: string): string => {
  const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const label = (ym: string) => `Tháng ${ym.slice(5, 7)}/${ym.slice(0, 4)}`;

/** Rows of a template table as its owner sees them, filtered by a SQL condition. */
async function selectRows(ctx: Ctx, t: T, cond: SQL, limit = 20000): Promise<RowData[]> {
  const res = await ctx.db.execute(sql`SELECT id, row_no, version, data, created_at, created_by, updated_at, updated_by FROM dh_rows WHERE ${t.acc.rows()} AND deleted_at IS NULL AND ${cond} LIMIT ${limit}`);
  return (res.rows as Record<string, unknown>[]).map((r) => {
    const row = rowFromDb(r);
    return { id: row.id, version: row.version, data: row.data };
  });
}
const text = (t: T, role: string): SQL => {
  const c = roleCol(t, role)!;
  return sourceOf(c).cellExpr(c, "data", "text");
};
/** Condition "the date column of the role falls in YYYY-MM". */
const inMonth = (t: T, role: string, ym: string): SQL => sql`substr(coalesce(${text(t, role)}, ''), 1, 7) = ${ym}`;

async function dealName(deals: T, row: RowData | undefined): Promise<string | null> {
  const c = roleCol(deals, "ten_cong_ty", false);
  const v = c && row ? row.data[c.key] : null;
  return typeof v === "string" ? v : null;
}
const optionName = (t: T, role: string, v: Stored): string | null => {
  const c = roleCol(t, role, false);
  return ((c?.config.options as SelectOption[] | undefined) ?? []).find((o) => o.id === v)?.name ?? null;
};

export interface ReviewItem {
  kind: "overdue_payment" | "unmatched_receipt" | "com_cap_mismatch" | "com_blank" | "unchecked_source" | "stale_processing";
  row_id: string;
  table: "payments" | "receipts" | "ledger" | "deals";
  deal_id: string | null;
  deal_name: string | null;
  detail: Record<string, unknown>;
}

async function review(ctx: Ctx, tree: Tree, ym: string, staleDays: number): Promise<{ items: ReviewItem[]; stale: boolean }> {
  const seq = await currentChangeSeq(ctx.db);
  let stale = false;
  for (const t of [tree.dots, tree.ledger, tree.deals]) stale = (await waitConsistent(ctx.db, t.acc.tableId, seq, 5000)).stale || stale;
  const end = lastDay(ym);
  const items: ReviewItem[] = [];
  const dealIds = new Set<string>();
  const dealOfDot = (r: RowData) => idsOf(cellOf(tree.dots, r, "deal"))[0] ?? null;

  // 1. instalments past due and not confirmed
  const noDate = sql`(${text(tree.dots, "ngay_tien_ve")} IS NULL OR ${text(tree.dots, "ngay_tien_ve")} = '')`;
  const overdue = await selectRows(ctx, tree.dots, sql`${noDate} AND coalesce(${text(tree.dots, "han")}, '') <> '' AND ${text(tree.dots, "han")} <= ${end}`);
  // 2. instalments of the month (the Kỳ column) for the checks 3 and 5
  const inPeriod = await selectRows(ctx, tree.dots, inMonth(tree.dots, "ky", ym));
  for (const r of [...overdue, ...inPeriod]) {
    const d = dealOfDot(r);
    if (d) dealIds.add(d);
  }
  // 6. open deals whose first instalment has been due for a long time
  const staleCut = addDays(end, -staleDays);
  const staleDots = overdue.filter((r) => (dateStr(cellOf(tree.dots, r, "han")) ?? "9") <= staleCut);
  for (const r of staleDots) {
    const d = dealOfDot(r);
    if (d) dealIds.add(d);
  }
  const deals = await readRows(ctx, tree.deals, [...dealIds]);
  const base = (kind: ReviewItem["kind"], table: ReviewItem["table"], row_id: string, deal_id: string | null, detail: Record<string, unknown>): ReviewItem => ({ kind, table, row_id, deal_id, deal_name: null, detail });
  for (const r of overdue) items.push(base("overdue_payment", "payments", r.id, dealOfDot(r), { due: dateStr(cellOf(tree.dots, r, "han")), planned: numOf(cellOf(tree.dots, r, "so_tien_du_kien")) }));

  // 2'. receipts not matched to any instalment
  const rl = roleCol(tree.receipts, "dot")!;
  const rlink = sourceOf(rl).cellExpr(rl, "data", "json");
  const unmatched = await selectRows(ctx, tree.receipts, sql`jsonb_array_length(coalesce(${rlink}, '[]'::jsonb)) = 0 AND coalesce(${text(tree.receipts, "ngay_nhan")}, '') <= ${end}`);
  for (const r of unmatched) items.push(base("unmatched_receipt", "receipts", r.id, null, { received_on: dateStr(cellOf(tree.receipts, r, "ngay_nhan")), amount: numOf(cellOf(tree.receipts, r, "so_tien")), payer: cellOf(tree.receipts, r, "nguoi_tra") }));

  // 3. confirmed instalments whose commission shares do not add up to the cap `Tỉ lệ SoE`
  const cap = await capFor(ctx.db, tree.dots.acc.datahub.id, "Tỉ lệ SoE", end);
  if (cap !== null) {
    for (const r of inPeriod) {
      if (!confirmed(tree.dots, r)) continue;
      const split = (cellOf(tree.dots, r, "chia_com_dot") as unknown as PersonEntry[] | null) ?? [];
      const total = (Array.isArray(split) ? split : []).reduce((s, e) => s + Number(e?.attrs?.[COM_ATTR] ?? 0), 0);
      if (Math.abs(total - cap) > 1e-9) items.push(base("com_cap_mismatch", "payments", r.id, dealOfDot(r), { total, cap }));
    }
  }
  // 4. commission left blank (missing policy input: Level BC, Performance BC)
  const lines = await selectRows(ctx, tree.ledger, inMonth(tree.ledger, "ky", ym));
  const tmp = optionByMeaning(tree.ledger, "trang_thai_com", "ledger_temp") ?? optionNamedSafe(tree.ledger, "Tạm tính");
  for (const l of lines) {
    if (cellOf(tree.ledger, l, "trang_thai_com") !== tmp) continue;
    const com = cellOf(tree.ledger, l, "com");
    if (com === null || com === "" || com === undefined) items.push(base("com_blank", "ledger", l.id, idsOf(cellOf(tree.ledger, l, "deal"))[0] ?? null, { person_ids: userIdsOf(cellOf(tree.ledger, l, "nguoi")) }));
  }
  // 5. rows typed by an AI or the API and not yet checked
  const unchecked = (t: T, rows: RowData[], tab: ReviewItem["table"], dealOf: (r: RowData) => string | null) => {
    for (const r of rows) {
      const src = optionName(t, "nguon_nhap", cellOf(t, r, "nguon_nhap"));
      if (src && src !== "Tay" && cellOf(t, r, "da_kiem") !== true) items.push(base("unchecked_source", tab, r.id, dealOf(r), { source: src }));
    }
  };
  unchecked(tree.dots, inPeriod, "payments", dealOfDot);
  const monthReceipts = await selectRows(ctx, tree.receipts, inMonth(tree.receipts, "ngay_nhan", ym));
  unchecked(tree.receipts, monthReceipts, "receipts", () => null);
  // 6'. long overdue first instalment of a deal still open
  const seen = new Set<string>();
  for (const r of staleDots) {
    const d = dealOfDot(r);
    if (!d || seen.has(d)) continue;
    const deal = deals.get(d);
    if (!deal || statusMeaning(tree.deals, deal) !== "open") continue;
    seen.add(d);
    items.push(base("stale_processing", "deals", d, d, { due: dateStr(cellOf(tree.dots, r, "han")), days: staleDays }));
  }
  for (const it of items) if (it.deal_id) it.deal_name = await dealName(tree.deals, deals.get(it.deal_id));
  return { items, stale };
}
const dateStr = (v: Stored): string | null => (typeof v === "string" && v ? v.slice(0, 10) : null);
function optionNamedSafe(t: T, name: string): string | null {
  const c = roleCol(t, "trang_thai_com", false);
  return ((c?.config.options as SelectOption[] | undefined) ?? []).find((o) => o.name === name)?.id ?? null;
}

const ReviewItemOut = z.object({
  kind: z.enum(["overdue_payment", "unmatched_receipt", "com_cap_mismatch", "com_blank", "unchecked_source", "stale_processing"]),
  table: z.enum(["payments", "receipts", "ledger", "deals"]),
  row_id: Id,
  deal_id: Id.nullable(),
  deal_name: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()),
});

async function lockOf(ctx: Ctx, tree: Tree, ym: string) {
  const start = `${ym}-01`;
  return (await activeLocks(ctx.db, tree.dots.acc.tableId)).find((l) => l.start === start && l.end === lastDay(ym)) ?? null;
}

export const periodOperations = [
  defineQuery({
    name: "period.review",
    summary: "Màn Chốt kỳ: danh sách \"Cần xử lý trước khi chốt\" của một tháng (6 loại), kỳ đã chốt chưa.",
    description:
      "Chỉ Manager của cây. Sáu loại: `overdue_payment` (đợt quá hạn chưa xác nhận), `unmatched_receipt` (Tiền về chưa ghép), `com_cap_mismatch` (đợt đã về, tổng % com khác `Tỉ lệ SoE`), `com_blank` (dòng Sổ com tạm tính còn trống com: thiếu Level BC / Performance BC), " +
      "`unchecked_source` (dòng AI/API nhập chưa `Đã kiểm`), `stale_processing` (deal đang mở có đợt quá hạn quá `stale_days` ngày). Chờ công thức tính xong tối đa 5 giây; `stale: true` là số liệu có thể còn cũ.",
    permission: "deal:payment:write",
    aiAllowed: true,
    input: z.object({ month, stale_days: z.coerce.number().int().min(1).max(365).default(30) }),
    output: z.object({ month: z.string(), closed: z.boolean(), lock_id: Id.nullable(), stale: z.boolean(), total: z.number().int(), counts: z.record(z.string(), z.number()), items: z.array(ReviewItemOut) }),
    http: { method: "GET", path: "/deal/periods/review" },
    handler: async (ctx, i) => {
      const tree = await loadTree(ctx);
      const lock = await lockOf(ctx, tree, i.month);
      const { items, stale } = await review(ctx, tree, i.month, i.stale_days);
      const counts: Record<string, number> = {};
      for (const it of items) counts[it.kind] = (counts[it.kind] ?? 0) + 1;
      return { month: i.month, closed: !!lock, lock_id: lock?.id ?? null, stale, total: items.length, counts, items };
    },
  }),

  defineQuery({
    name: "period.com",
    summary: "Com của một tháng theo người (đã gồm dòng điều chỉnh); có `person_id` thì trả từng dòng Sổ com của người đó.",
    description: "Chỉ Manager của cây. Cộng cột `Com` của các dòng Sổ com có `Kỳ` là tháng (Tạm tính, Đã chốt, Điều chỉnh). Xuất XLSX cho kế toán: gọi `datahub.export.create` với `table_id` = `ledger_table_id` và `filter` theo cột Kỳ.",
    permission: "deal:payment:write",
    aiAllowed: true,
    input: z.object({ month, person_id: Id.optional() }),
    output: z.object({
      month: z.string(),
      ledger_table_id: Id,
      people: z.array(z.object({ person_id: Id, total: z.number(), lines: z.number().int(), blank_lines: z.number().int() })),
      lines: z.array(z.object({ id: Id, deal_id: Id.nullable(), payment_id: Id.nullable(), status: z.string().nullable(), com: z.number().nullable(), pct: z.number().nullable(), reason: z.string().nullable() })),
    }),
    http: { method: "GET", path: "/deal/periods/com" },
    handler: async (ctx, i) => {
      const tree = await loadTree(ctx);
      const rows = await selectRows(ctx, tree.ledger, inMonth(tree.ledger, "ky", i.month));
      const by = new Map<string, { total: number; lines: number; blank: number }>();
      const lines: { id: string; deal_id: string | null; payment_id: string | null; status: string | null; com: number | null; pct: number | null; reason: string | null }[] = [];
      for (const r of rows) {
        const com = cellOf(tree.ledger, r, "com");
        const num = typeof com === "number" ? com : null;
        for (const p of userIdsOf(cellOf(tree.ledger, r, "nguoi"))) {
          const e = by.get(p) ?? { total: 0, lines: 0, blank: 0 };
          e.total += num ?? 0;
          e.lines++;
          if (num === null) e.blank++;
          by.set(p, e);
          if (p === i.person_id) {
            const reason = cellOf(tree.ledger, r, "ly_do");
            const pct = cellOf(tree.ledger, r, "ty_le_com");
            lines.push({ id: r.id, deal_id: idsOf(cellOf(tree.ledger, r, "deal"))[0] ?? null, payment_id: idsOf(cellOf(tree.ledger, r, "dot"))[0] ?? null, status: optionName(tree.ledger, "trang_thai_com", cellOf(tree.ledger, r, "trang_thai_com")), com: num, pct: typeof pct === "number" ? pct : null, reason: typeof reason === "string" ? reason : null });
          }
        }
      }
      return {
        month: i.month,
        ledger_table_id: tree.ledger.acc.tableId,
        people: [...by].map(([person_id, e]) => ({ person_id, total: e.total, lines: e.lines, blank_lines: e.blank })).sort((a, b) => b.total - a.total),
        lines,
      };
    },
  }),

  defineQuery({
    name: "period.list",
    summary: "Các tháng đã chốt của cây (và lúc chốt, người chốt).",
    permission: "deal:payment:write",
    aiAllowed: true,
    input: z.object({}),
    output: z.array(z.object({ month: z.string(), lock_id: Id, locked_at: z.string(), locked_by: Id.nullable() })),
    http: { method: "GET", path: "/deal/periods" },
    handler: async (ctx) => {
      const tree = await loadTree(ctx);
      const r = await ctx.db.execute(sql`SELECT id, substr(period_start::text, 1, 7) AS month, locked_at::text AS locked_at, locked_by FROM period_locks WHERE table_id = ${tree.dots.acc.tableId} AND scope = ${tree.managerId} AND unlocked_at IS NULL ORDER BY period_start DESC`);
      return (r.rows as { id: string; month: string; locked_at: string; locked_by: string | null }[]).map((x) => ({ month: x.month, lock_id: x.id, locked_at: x.locked_at, locked_by: x.locked_by }));
    },
  }),

  defineCommand({
    name: "period.close",
    summary: "Chốt kỳ (tháng) của cây: khoá đợt thanh toán và deal đóng trong tháng, đổi dòng Sổ com Tạm tính của tháng thành số cứng Đã chốt.",
    description:
      "Chỉ Manager của cây. Còn mục ở `period.review` thì lỗi `conflict` (`reason: period_pending_items`, kèm số mục theo loại) trừ khi gửi `close_anyway: true` (\"Chốt dù còn N mục\"). " +
      "Sau khi chốt: đợt thanh toán có tiền về trong tháng không sửa, không huỷ xác nhận (`period_locked`); Status, Ngày đóng sửa tay, Loại deal và % doanh thu của deal đóng trong tháng bị khoá (người tham gia, % com vẫn sửa); dòng Sổ com `Đã chốt` không sửa. " +
      "Tiền về có ngày thuộc tháng đã chốt vào kỳ đang mở (`Về muộn`); điều chỉnh com vào kỳ đang mở. Dòng AI/API nhập chưa `Đã kiểm` được đánh dấu đã kiểm khi chốt (ghi vào nhật ký kèm kênh gọi). Công thức chưa tính xong thì lỗi `conflict` (`recalc_pending`), thử lại sau. Cần `Idempotency-Key`.",
    permission: "deal:period:lock",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z.object({ month, close_anyway: z.boolean().default(false), stale_days: z.number().int().min(1).max(365).default(30) }),
    output: z.object({ month: z.string(), lock_ids: z.array(Id), closed_ledger_ids: z.array(Id), blank_com_ids: z.array(Id), checked_on_close: z.number().int(), pending: z.number().int() }),
    http: { method: "POST", path: "/deal/periods/close", status: 200 },
    handler: async (ctx, i) => {
      const tree = await loadTree(ctx);
      if (await lockOf(ctx, tree, i.month)) throw new AppError("conflict", `${label(i.month)} đã chốt.`, { reason: "period_already_closed" });
      const { items, stale } = await review(ctx, tree, i.month, i.stale_days);
      if (stale) throw new AppError("conflict", "Công thức chưa tính xong, thử chốt lại sau ít giây.", { reason: "recalc_pending" });
      if (items.length && !i.close_anyway) {
        const counts: Record<string, number> = {};
        for (const it of items) counts[it.kind] = (counts[it.kind] ?? 0) + 1;
        throw new AppError("conflict", `Còn ${items.length} mục cần xử lý. Gửi close_anyway để chốt dù còn.`, { reason: "period_pending_items", total: items.length, counts });
      }
      // rows typed by an AI/API and not checked: checked when the Manager closes (design 7.4)
      const checkOps = new Map<string, string[]>();
      for (const it of items) if (it.kind === "unchecked_source") checkOps.set(it.table, [...(checkOps.get(it.table) ?? []), it.row_id]);
      let checked = 0;
      for (const [tab, ids] of checkOps) {
        const t = tab === "payments" ? tree.dots : tree.receipts;
        if (!roleCol(t, "da_kiem", false)) continue;
        await write(ctx, t, ids.map((id) => ({ op: "update" as const, id, data: cells(t, [["da_kiem", true]]) })), true);
        checked += ids.length;
      }
      // the month's tentative commission lines become fixed values
      const lines = await selectRows(ctx, tree.ledger, inMonth(tree.ledger, "ky", i.month));
      const tmp = optionByMeaning(tree.ledger, "trang_thai_com", "ledger_temp") ?? optionNamedSafe(tree.ledger, "Tạm tính");
      const closed = optionByMeaning(tree.ledger, "trang_thai_com", "ledger_closed") ?? optionNamedSafe(tree.ledger, "Đã chốt");
      if (!closed) throw new AppError("conflict", "Cột Trạng thái của Sổ com chưa có lựa chọn Đã chốt.", { reason: "status_option_missing", meaning: "ledger_closed" });
      const mine = lines.filter((l) => cellOf(tree.ledger, l, "trang_thai_com") === tmp);
      const blank: string[] = [];
      const ky = roleCol(tree.ledger, "ky_ghi_nhan", false) ? [["ky_ghi_nhan", `${i.month}-01`] as [string, Stored]] : [];
      if (mine.length) {
        await write(
          ctx,
          tree.ledger,
          mine.map((l) => {
            const com = cellOf(tree.ledger, l, "com");
            if (typeof com !== "number") blank.push(l.id);
            return { op: "update" as const, id: l.id, data: cells(tree.ledger, [["com_co_dinh", typeof com === "number" ? com : 0], ["trang_thai_com", closed], ...ky]) };
          }),
          true,
        );
      }
      const actor = ctx.actor;
      const start = `${i.month}-01`;
      const end = lastDay(i.month);
      const lockIds: string[] = [];
      for (const t of [tree.dots, tree.deals]) {
        const l = await lockPeriod(ctx.db, { tableId: t.acc.tableId, scope: tree.managerId, label: label(i.month), periodStart: start, periodEnd: end, actor, requestId: ctx.requestId });
        lockIds.push(l.id);
      }
      ctx.audit({ type: "deal_period", id: lockIds[0]!, details: { operation: "close", month: i.month, lines: mine.length, blank_com: blank.length, pending: items.length, checked_on_close: checked, via: actor.via, connection_id: actor.connectionId } });
      return { month: i.month, lock_ids: lockIds, closed_ledger_ids: mine.map((l) => l.id), blank_com_ids: blank, checked_on_close: checked, pending: items.length };
    },
  }),

  defineCommand({
    name: "period.reopen",
    summary: "Mở lại kỳ (tháng) đã chốt, ghi nhật ký kèm lý do. Dòng Sổ com Đã chốt không tính lại.",
    description: "Chỉ Manager của cây, không cần người thứ hai duyệt. Dùng để sửa Status, Closing date hoặc chuyển vai trò cột. Dòng Sổ com `Đã chốt` vẫn đứng yên; chênh lệch đi qua `commission.adjust`. Cần `Idempotency-Key`.",
    permission: "deal:period:lock",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z.object({ month, reason: z.string().trim().min(1, "Cần ghi lý do mở lại kỳ.").max(500) }),
    output: z.object({ month: z.string(), lock_ids: z.array(Id) }),
    http: { method: "POST", path: "/deal/periods/reopen", status: 200 },
    handler: async (ctx, i) => {
      const tree = await loadTree(ctx);
      const ids: string[] = [];
      for (const t of [tree.dots, tree.deals]) {
        const l = (await activeLocks(ctx.db, t.acc.tableId)).find((x) => x.start === `${i.month}-01` && x.end === lastDay(i.month));
        if (l) ids.push((await unlockPeriod(ctx.db, { id: l.id, reason: i.reason, actor: ctx.actor, requestId: ctx.requestId })).id);
      }
      if (!ids.length) throw new AppError("not_found", `${label(i.month)} chưa chốt.`, { reason: "period_not_closed" });
      ctx.audit({ type: "deal_period", id: ids[0]!, details: { operation: "reopen", month: i.month, reason: i.reason } });
      return { month: i.month, lock_ids: ids };
    },
  }),
];
