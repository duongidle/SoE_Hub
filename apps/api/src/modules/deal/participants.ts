import { sql } from "drizzle-orm";
import { AppError, businessDate } from "@soe/shared";
import { collectDeps } from "@soe/formula";
import { capFor } from "../datahub/people-caps";
import { OwnerIndex } from "../datahub/computed";
import { computeFormulasForRow } from "../datahub/recalc";
import { idsOf as readerIdsOf, membersOfDatahub } from "../datahub/reader-scope";
import { parsedExpr } from "../datahub/row-formulas";
import { userAttrs, userIdsOf } from "../datahub/user-values";
import type { DhColumn, PersonEntry, Stored } from "../datahub/types";
import { roleCol, type Ctx, type RowData, type T } from "./payments";

/**
 * The people of a deal and what each of them gets, for the money commands (design module4 4.1 "Sửa 22/11/2026").
 *
 * The commands do not know how the Manager laid the people out. They take the people from EVERY column that holds the role `nguoi_tham_gia`
 * (one column with attributes, Leading/Associate columns, ...) and each person's share from the value that person's own columns hold:
 * `pct_com_cua_toi`, `pct_doanh_thu_cua_toi`, `vai_tro_cua_toi`, `tinh_deal_cua_toi`, which are formulas of the viewer functions (ME, ISME, ATTR),
 * so the value computed for a person is what that person sees. A tree built before these roles existed falls back to the attributes of the people cell.
 */
export interface Participant {
  id: string;
  role: string | null;
  /** Share of the commission base (0..1). */
  com: number;
  /** Share of the revenue (0..1). */
  rev: number;
  countsDeal: boolean;
}

const ROLES = { role: "vai_tro_cua_toi", rev: "pct_doanh_thu_cua_toi", com: "pct_com_cua_toi", deal: "tinh_deal_cua_toi" } as const;
const LEGACY = { role: "vai_tro", rev: "ty_le_dt", com: "ty_le_com", deal: "tinh_deal" } as const;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** People columns of a table, in table order. */
export const peopleColumns = (deals: T): DhColumn[] => deals.schema.alive.filter((c) => c.role === "nguoi_tham_gia" && c.type === "user");

/** Everyone in the people columns of a row. */
export function peopleIds(deals: T, row: RowData): string[] {
  return [...new Set(peopleColumns(deals).flatMap((c) => userIdsOf(row.data[c.key])))];
}

const indexCache = new WeakMap<object, Promise<OwnerIndex>>();
/** The owner's index of tables and columns, loaded once per command. */
const indexOf = (ctx: Ctx, ownerId: string): Promise<OwnerIndex> => {
  let p = indexCache.get(ctx);
  if (!p) {
    p = OwnerIndex.load(ctx.db, ownerId);
    indexCache.set(ctx, p);
  }
  return p;
};

/** The formula columns to run for a person, in dependency order: the formula role columns and the formulas of the same table they read. */
function formulaOrder(deals: T, roleCols: DhColumn[]): DhColumn[] {
  const byKey = new Map(deals.schema.alive.map((c) => [c.key, c]));
  const out: DhColumn[] = [];
  const done = new Set<string>();
  const visit = (c: DhColumn, path: Set<string>) => {
    if (done.has(c.key) || path.has(c.key) || c.type !== "formula" || typeof c.config.expr !== "string") return;
    path.add(c.key);
    const ast = parsedExpr(c.config.expr);
    for (const k of ast ? collectDeps(ast).cells : []) {
      const dep = byKey.get(k);
      if (dep) visit(dep, path);
    }
    done.add(c.key);
    out.push(c);
  };
  roleCols.forEach((c) => visit(c, new Set()));
  return out;
}

/** The value of a column as each of the given people hold it: their own cell (`dh_person_cells`), their computed value (`dh_personal_rows`) or the shared cell. */
async function valuesAsPeople(ctx: Ctx, deals: T, row: RowData, col: DhColumn, ids: string[]): Promise<Map<string, Stored>> {
  const owner = deals.acc.datahub.ownerId;
  const out = new Map<string, Stored>();
  const shared = (row.data[col.key] ?? null) as Stored;
  if (col.storage === "person") {
    const res = await ctx.db.execute(sql`SELECT user_id, data -> ${col.key} AS v FROM dh_person_cells WHERE /*scope:system*/ row_id = ${row.id}::uuid AND user_id = ANY(${`{${ids.join(",")}}`}::uuid[])`);
    for (const r of res.rows as { user_id: string; v: Stored }[]) out.set(r.user_id, r.v ?? null);
    return out;
  }
  if (!col.readerScoped) {
    for (const id of ids) out.set(id, shared);
    return out;
  }
  const others = ids.filter((id) => id !== owner);
  if (ids.includes(owner)) out.set(owner, shared);
  if (others.length) {
    const res = await ctx.db.execute(sql`SELECT user_id, data -> ${col.key} AS v FROM dh_personal_rows WHERE /*scope:system*/ row_id = ${row.id}::uuid AND user_id = ANY(${`{${others.join(",")}}`}::uuid[])`);
    for (const r of res.rows as { user_id: string; v: Stored }[]) out.set(r.user_id, r.v ?? null);
  }
  return out;
}

export async function participantsOf(ctx: Ctx, deals: T, row: RowData): Promise<Participant[]> {
  const ids = peopleIds(deals, row);
  if (ids.length === 0) return [];
  const owner = deals.acc.datahub.ownerId;
  const members = new Set(await membersOfDatahub(ctx.db, deals.acc.datahub.id));
  const stranger = ids.find((id) => id !== owner && !members.has(id));
  if (stranger) throw new AppError("conflict", "Người tham gia của deal chưa là thành viên của bảng Deals nên chưa có phần chia riêng. Thêm người đó vào cây trước.", { reason: "participant_not_member", user_id: stranger });

  // legacy: the attributes of the people cells, for a tree whose "của tôi" columns have no role
  const legacy = new Map<string, Record<string, unknown>>();
  for (const c of peopleColumns(deals)) {
    if (userAttrs(c).length === 0) continue;
    const v = row.data[c.key];
    if (Array.isArray(v)) for (const e of v as PersonEntry[]) if (e && typeof e.id === "string") legacy.set(e.id, { ...(legacy.get(e.id) ?? {}), ...e.attrs });
  }
  // The formula role columns are computed now, for each person, from the row as it is (not from the recalculation queue): the command reads what the person would see.
  const roleCols = (Object.values(ROLES) as string[]).flatMap((r) => { const c = roleCol(deals, r, false); return c ? [c] : []; });
  const order = formulaOrder(deals, roleCols);
  const live = new Map<string, Record<string, Stored>>();
  if (order.length) {
    const ix = await indexOf(ctx, owner);
    for (const id of ids) live.set(id, await computeFormulasForRow(ctx.db, ix, deals.acc.tableId, order, row.id, id === owner ? null : { userId: id, ids: await readerIdsOf(ctx.db, id) }));
  }
  const read = async (role: keyof typeof ROLES): Promise<(id: string) => unknown> => {
    const c = roleCol(deals, ROLES[role], false);
    if (!c) return (id) => legacy.get(id)?.[LEGACY[role]];
    if (c.type === "formula") return (id) => live.get(id)?.[c.key] ?? null;
    const m = await valuesAsPeople(ctx, deals, row, c, ids);
    return (id) => m.get(id) ?? null;
  };
  const [role, rev, com, deal] = [await read("role"), await read("rev"), await read("com"), await read("deal")];
  return ids.map((id) => {
    const r = role(id);
    return { id, role: typeof r === "string" && r ? r : null, com: num(com(id)), rev: num(rev(id)), countsDeal: deal(id) === true };
  });
}

/** The parameter (table `Tham số com`) that the total of the commission shares of a deal may not exceed. */
export const COM_CAP_PARAM = "Tỉ lệ SoE";

/**
 * The total `% com` of the people of a deal may not exceed `Tỉ lệ SoE` (the value in force today). Checked here, on the shares each person holds, so it
 * holds for any layout of the people columns (design module4 4.6E, Opus decision 22/11/2026); the cap of the attribute (`cap_param`) stays for the
 * one-column layout. No parameter yet: no limit.
 */
export async function assertComCap(ctx: Ctx, deals: T, parts: Participant[], dealId: string): Promise<void> {
  if (parts.length === 0) return;
  const cap = await capFor(ctx.db, deals.acc.datahub.id, COM_CAP_PARAM, businessDate(new Date()));
  const total = parts.reduce((a, p) => a + p.com, 0);
  if (cap !== null && total > cap + 1e-9) {
    throw new AppError("validation_error", `Tổng % com của người tham gia deal là ${Math.round(total * 10000) / 100}%, vượt "${COM_CAP_PARAM}" (${Math.round(cap * 10000) / 100}%). Sửa % com của deal trước.`, { reason: "com_over_cap", deal_id: dealId, total, cap });
  }
}

/** The people of a deal as the cell of an instalment (`Người tham gia` of Đợt thanh toán), with the attributes that cell has. */
export function peopleCell(target: T, parts: Participant[]): PersonEntry[] {
  const col = peopleColumns(target)[0];
  const keys = new Set(col ? userAttrs(col).map((a) => a.key) : []);
  const options = new Map((col ? userAttrs(col) : []).filter((a) => a.kind === "select").map((a) => [a.key, new Set(a.options ?? [])]));
  return parts.map((p) => {
    const attrs: PersonEntry["attrs"] = {};
    if (keys.has(LEGACY.rev)) attrs[LEGACY.rev] = p.rev;
    if (keys.has(LEGACY.com)) attrs[LEGACY.com] = p.com;
    if (keys.has(LEGACY.deal)) attrs[LEGACY.deal] = p.countsDeal;
    if (keys.has(LEGACY.role) && p.role && options.get(LEGACY.role)?.has(p.role)) attrs[LEGACY.role] = p.role;
    return { id: p.id, attrs };
  });
}
