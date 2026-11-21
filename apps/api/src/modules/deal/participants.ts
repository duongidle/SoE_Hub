import { sql } from "drizzle-orm";
import { AppError } from "@soe/shared";
import { pendingCells } from "../datahub/consistency";
import { membersOfDatahub } from "../datahub/reader-scope";
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
const WAIT_MS = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** People columns of a table, in table order. */
export const peopleColumns = (deals: T): DhColumn[] => deals.schema.alive.filter((c) => c.role === "nguoi_tham_gia" && c.type === "user");

/** Everyone in the people columns of a row. */
export function peopleIds(deals: T, row: RowData): string[] {
  return [...new Set(peopleColumns(deals).flatMap((c) => userIdsOf(row.data[c.key])))];
}

/**
 * Waits (at most 5 s) until the person-dependent columns of these deals have no pending recalculation, so the values read are those of the people now in
 * the deal. Call it BEFORE the command writes anything: the queue entries of the command's own writes cannot be processed until it commits.
 */
export async function waitParticipantValues(ctx: Ctx, deals: T, dealIds: string[]): Promise<void> {
  const keys = new Set(Object.values(ROLES).flatMap((r) => { const c = roleCol(deals, r, false); return c ? [c.key] : []; }));
  if (keys.size === 0 || dealIds.length === 0) return;
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const pending = await pendingCells(ctx.db, deals.acc.tableId, dealIds, keys);
    if (Object.keys(pending).length === 0) return;
    if (Date.now() >= deadline) throw new AppError("conflict", "Hệ thống đang tính lại phần chia của người tham gia. Thử lại sau vài giây.", { reason: "participants_recalculating" });
    await sleep(100);
  }
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
  const read = async (role: keyof typeof ROLES): Promise<(id: string) => unknown> => {
    const c = roleCol(deals, ROLES[role], false);
    if (!c) return (id) => legacy.get(id)?.[LEGACY[role]];
    const m = await valuesAsPeople(ctx, deals, row, c, ids);
    return (id) => m.get(id) ?? null;
  };
  const [role, rev, com, deal] = [await read("role"), await read("rev"), await read("com"), await read("deal")];
  return ids.map((id) => {
    const r = role(id);
    return { id, role: typeof r === "string" && r ? r : null, com: num(com(id)), rev: num(rev(id)), countsDeal: deal(id) === true };
  });
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
