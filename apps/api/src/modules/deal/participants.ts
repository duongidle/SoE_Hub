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
import { COM_CAP_PARAM, COM_CAP_ROLE } from "./com-cap";
import { cellOf, roleCol, type Ctx, type RowData, type T } from "./payments";

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
/** The role a people entry carries in its attributes (the base the `vai_tro_cua_toi` formula reads): one place that reads it, for the money commands and the due-date rules. */
export const entryRole = (attrs: Record<string, unknown> | undefined | null): string | null => {
  const r = attrs?.[LEGACY.role];
  return typeof r === "string" && r.trim() ? r : null;
};
/** Is this role Leading (any letter case, any Unicode form)? */
export const isLeadingRole = (role: string | null): boolean => !!role && role.normalize("NFC").trim().toLowerCase() === "leading";
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

/**
 * The value of a column as each of the given people hold it, for many rows at once (one SQL per kind of storage): their own cell (`dh_person_cells`),
 * their computed value (`dh_personal_rows`) or the shared cell. The one place that reads a "của tôi" value for a person, for the money commands
 * (`participantsOf`) and the due-date rules (`deal/due.ts`).
 */
export async function personValues(db: Ctx["db"], ownerId: string, col: Pick<DhColumn, "key" | "storage" | "readerScoped">, rows: { id: string; data: RowData["data"] }[], ids: string[]): Promise<Map<string, Map<string, Stored>>> {
  const out = new Map<string, Map<string, Stored>>(rows.map((r) => [r.id, new Map<string, Stored>()]));
  if (rows.length === 0 || ids.length === 0) return out;
  const rowIds = `{${rows.map((r) => r.id).join(",")}}`;
  const idList = `{${ids.join(",")}}`;
  if (col.storage === "person") {
    const res = await db.execute(sql`SELECT row_id, user_id, data -> ${col.key} AS v FROM dh_person_cells WHERE /*scope:system*/ row_id = ANY(${rowIds}::uuid[]) AND user_id = ANY(${idList}::uuid[])`);
    for (const r of res.rows as { row_id: string; user_id: string; v: Stored }[]) out.get(r.row_id)?.set(r.user_id, r.v ?? null);
    return out;
  }
  for (const r of rows) {
    const shared = (r.data[col.key] ?? null) as Stored;
    // Shared column: everyone holds the shared cell. Reader-scoped: only the owner does; the others hold their own computed value (below).
    for (const id of ids) if (!col.readerScoped || id === ownerId) out.get(r.id)!.set(id, shared);
  }
  const others = ids.filter((id) => id !== ownerId);
  if (col.readerScoped && others.length) {
    const res = await db.execute(sql`SELECT row_id, user_id, data -> ${col.key} AS v FROM dh_personal_rows WHERE /*scope:system*/ row_id = ANY(${rowIds}::uuid[]) AND user_id = ANY(${`{${others.join(",")}}`}::uuid[])`);
    for (const r of res.rows as { row_id: string; user_id: string; v: Stored }[]) out.get(r.row_id)?.set(r.user_id, r.v ?? null);
  }
  return out;
}

/** The role text each person holds on each row, read in bulk from what is stored (the `vai_tro_cua_toi` column). Null where nothing is stored. */
export async function storedRoles(db: Ctx["db"], ownerId: string, col: Pick<DhColumn, "key" | "storage" | "readerScoped">, rows: { id: string; data: RowData["data"] }[], ids: string[]): Promise<Map<string, Map<string, string | null>>> {
  const vals = await personValues(db, ownerId, col, rows, ids);
  return new Map([...vals].map(([row, m]) => [row, new Map([...m].map(([id, v]) => [id, typeof v === "string" && v.trim() ? v : null]))]));
}

async function valuesAsPeople(ctx: Ctx, deals: T, row: RowData, col: DhColumn, ids: string[]): Promise<Map<string, Stored>> {
  return (await personValues(ctx.db, deals.acc.datahub.ownerId, col, [row], ids)).get(row.id)!;
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
    if (!c) return (id) => (role === "role" ? entryRole(legacy.get(id)) : legacy.get(id)?.[LEGACY[role]]);
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

/**
 * The total `% com` of the people of a deal may not exceed the cap of that deal: the value of its `tran_com` column (a formula of the template: PS
 * `Trần chia PS`, else `Tỉ lệ SoE`; module4 mục 9). A tree without that column falls back to `Tỉ lệ SoE`. Checked here, on the shares each person holds,
 * so it holds for any layout of the people columns (module4 4.6E). No value: no limit, a tree that has not entered the parameter is not blocked.
 */
export async function assertComCap(ctx: Ctx, deals: T, parts: Participant[], deal: RowData): Promise<void> {
  if (parts.length === 0) return;
  await assertComTotal(ctx, deals, parts.reduce((a, p) => a + p.com, 0), deal);
}

/** The cap of a deal: its `tran_com` cell; null = none. */
export async function comCapOf(ctx: Ctx, deals: T, deal: RowData): Promise<{ cap: number | null; name: string }> {
  if (roleCol(deals, COM_CAP_ROLE, false)) {
    const v = cellOf(deals, deal, COM_CAP_ROLE);
    return { cap: typeof v === "number" ? v : null, name: "Trần % com" };
  }
  return { cap: await capFor(ctx.db, deals.acc.datahub.id, COM_CAP_PARAM, businessDate(new Date())), name: COM_CAP_PARAM };
}

/** Same cap for a total given by hand (`com_split` of a call). */
export async function assertComTotal(ctx: Ctx, deals: T, total: number, deal: RowData): Promise<void> {
  const { cap, name } = await comCapOf(ctx, deals, deal);
  if (cap !== null && total > cap + 1e-9) {
    throw new AppError("validation_error", `Tổng % com của người tham gia deal là ${Math.round(total * 10000) / 100}%, vượt "${name}" (${Math.round(cap * 10000) / 100}%). Sửa % com của deal trước.`, { reason: "com_over_cap", deal_id: deal.id, total, cap });
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
