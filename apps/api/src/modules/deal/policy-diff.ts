import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, businessDate } from "@soe/shared";
import { defineQuery } from "../../core/registry";
import { Id } from "../datahub/shared";
import { dealFacts, managerOf, roleTable } from "./forecast";

/**
 * Compare two versions of the commission policy (design module4 9, "Màn so sánh phiên bản"): the version in force just before the new one next to the
 * new one, so the Manager (or an AI of the Manager) confirms before it counts. Read-only; versions are the distinct `Hiệu lực từ` dates of the table
 * (role set `com_policy`) and of the parameter table (`com_params`).
 */
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD.");
const fold = (v: unknown) => String(v ?? "").trim().toLowerCase();
type Data = Record<string, unknown>;

async function versions(db: Parameters<typeof roleTable>[0], managerId: string, roleSet: string, valueRoles: string[]) {
  const t = await roleTable(db, managerId, roleSet);
  if (!t) return null;
  const kFrom = t.key("hieu_luc_tu");
  if (!kFrom) return null;
  const rows = (await db.execute(sql`SELECT data FROM dh_rows WHERE /*scope:system*/ table_id = ${t.tableId}::uuid AND deleted_at IS NULL`)).rows as { data: Data }[];
  const keys = Object.fromEntries(valueRoles.map((r) => [r, t.key(r)]));
  const out = rows.flatMap((r) => {
    const d = typeof r.data[kFrom] === "string" ? (r.data[kFrom] as string).slice(0, 10) : null;
    return d ? [{ from: d, get: (role: string) => (keys[role] ? r.data[keys[role]!] : undefined) }] : [];
  });
  return { dates: [...new Set(out.map((x) => x.from))].sort(), rows: out };
}

export const policyDiffOperations = [
  defineQuery({
    name: "commission.policy.diff",
    summary: "So sánh bản chính sách com mới với bản hiệu lực ngay trước nó: dòng thêm, đổi, bỏ; tỉ lệ cũ → mới; số deal mở bị ảnh hưởng.",
    description:
      "Chỉ Manager của cây. Bản = các dòng có cùng `Hiệu lực từ`. `new_from` bỏ trống thì lấy bản mới nhất; bản cũ là bản có `Hiệu lực từ` lớn nhất nhỏ hơn `new_from`. Khoá so dòng: Nguồn lead + Level + Performance. " +
      "Deal mở bị ảnh hưởng: deal đang mở có (Nguồn lead, Level BC, Performance BC) trùng một dòng thêm/đổi/bỏ và ngày tra chính sách (Ngày dự kiến chốt, bỏ trống thì hôm nay) từ `new_from` trở đi. Kèm khác biệt của bảng Tham số com.",
    permission: "deal:policy:write",
    aiAllowed: true,
    input: z.object({ new_from: ymd.optional() }),
    output: z.object({
      old_from: z.string().nullable(),
      new_from: z.string().nullable(),
      versions: z.array(z.string()),
      rows: z.array(z.object({ kind: z.enum(["added", "changed", "removed"]), lead: z.string(), level: z.string(), performance: z.string(), old_rate: z.number().nullable(), new_rate: z.number().nullable() })),
      unchanged: z.number().int(),
      params: z.array(z.object({ kind: z.enum(["added", "changed", "removed"]), name: z.string(), old_value: z.number().nullable(), new_value: z.number().nullable() })),
      affected_open_deals: z.number().int(),
      affected_deal_ids: z.array(Id),
    }),
    http: { method: "GET", path: "/deal/commission/policy-diff" },
    handler: async (ctx, i) => {
      const m = await managerOf(ctx);
      const pol = await versions(ctx.db, m, "com_policy", ["nguon_lead", "level", "performance", "ti_le"]);
      if (!pol) throw new AppError("conflict", "Cây chưa có bảng Chính sách com đủ vai trò (bộ com_policy).", { reason: "payment_table_missing", role_set: "com_policy" });
      const newFrom = i.new_from ?? pol.dates[pol.dates.length - 1] ?? null;
      const oldFrom = newFrom ? ([...pol.dates].reverse().find((d) => d < newFrom) ?? null) : null;
      const keyOf = (r: { get: (x: string) => unknown }) => [fold(r.get("nguon_lead")), fold(r.get("level")), fold(r.get("performance"))].join("|");
      const rate = (r: { get: (x: string) => unknown }) => (typeof r.get("ti_le") === "number" ? (r.get("ti_le") as number) : null);
      const side = (d: string | null) => new Map(pol.rows.filter((r) => r.from === d).map((r) => [keyOf(r), r]));
      const [a, b] = [side(oldFrom), side(newFrom)];
      const rows: { kind: "added" | "changed" | "removed"; lead: string; level: string; performance: string; old_rate: number | null; new_rate: number | null; key: string }[] = [];
      let unchanged = 0;
      const label = (r: { get: (x: string) => unknown }) => ({ lead: String(r.get("nguon_lead") ?? ""), level: String(r.get("level") ?? ""), performance: String(r.get("performance") ?? "") });
      for (const [k, r] of b) {
        const o = a.get(k);
        if (!o) rows.push({ kind: "added", ...label(r), old_rate: null, new_rate: rate(r), key: k });
        else if (rate(o) !== rate(r)) rows.push({ kind: "changed", ...label(r), old_rate: rate(o), new_rate: rate(r), key: k });
        else unchanged++;
      }
      for (const [k, o] of a) if (!b.has(k)) rows.push({ kind: "removed", ...label(o), old_rate: rate(o), new_rate: null, key: k });
      // parameters
      const par = await versions(ctx.db, m, "com_params", ["ten_tham_so", "gia_tri"]);
      const params: { kind: "added" | "changed" | "removed"; name: string; old_value: number | null; new_value: number | null }[] = [];
      if (par) {
        const pNew = newFrom && par.dates.includes(newFrom) ? newFrom : null;
        const pOld = pNew ? ([...par.dates].reverse().find((d) => d < pNew) ?? null) : null;
        const ps = (d: string | null) => new Map(par.rows.filter((r) => r.from === d).map((r) => [fold(r.get("ten_tham_so")), r]));
        const val = (r: { get: (x: string) => unknown }) => (typeof r.get("gia_tri") === "number" ? (r.get("gia_tri") as number) : null);
        const [pa, pb] = [ps(pOld), ps(pNew)];
        if (pNew) {
          for (const [k, r] of pb) {
            const o = pa.get(k);
            if (!o) params.push({ kind: "added", name: String(r.get("ten_tham_so")), old_value: null, new_value: val(r) });
            else if (val(o) !== val(r)) params.push({ kind: "changed", name: String(r.get("ten_tham_so")), old_value: val(o), new_value: val(r) });
          }
          for (const [k, o] of pa) if (!pb.has(k)) params.push({ kind: "removed", name: String(o.get("ten_tham_so")), old_value: val(o), new_value: null });
        }
      }
      // open deals that the changed lines reach
      const touched = new Set(rows.map((r) => r.key));
      const today = businessDate(new Date());
      const affected = newFrom && touched.size
        ? (await dealFacts(ctx.db, m)).filter((d) => d.meaning === "open" && (d.expectedClose ?? today) >= newFrom && touched.has([fold(d.lead), fold(d.level), fold(d.perf)].join("|")))
        : [];
      return {
        old_from: oldFrom,
        new_from: newFrom,
        versions: pol.dates,
        rows: rows.map(({ key: _k, ...r }) => r),
        unchanged,
        params,
        affected_open_deals: affected.length,
        affected_deal_ids: affected.slice(0, 200).map((d) => d.id),
      };
    },
  }),
];
