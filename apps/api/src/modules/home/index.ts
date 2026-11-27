import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@soe/shared";
import type { Db } from "@soe/db";
import { ownedBy } from "../../auth/access";
import { registerOwnedTable } from "../../auth/query-guard";
import { defineCommand, defineQuery } from "../../core/registry";
import { asRecent, RECENT_TYPES, type RecentType } from "./recent";
import type { HandlerCtx } from "../../core/types";
import { loadDatahubAccess } from "../datahub/access";
import { Id, Ts } from "../datahub/shared";
import { loadOwnForm } from "../form/shared";
import { articleKind } from "../knowledge/kind";
import { viewDash } from "../metrics/dashboard-access";
import { canReadLive, isReviewer, loadPost, loadVersion, viewerOf, workingVersion } from "../publish/engine";

registerOwnedTable("user_prefs");

/**
 * Per-person preferences (design module12 1, stage 12D-1): the pinned dashboard tabs of the home page and the "recent" list.
 * A person reads and writes only their own rows (`ownedBy`). Nothing here is open to AI connections (no menu in `ai-policy.ts`).
 */
export const TABS_MAX = 20;

/** Keys a person may write with `home.prefs.set`. `recent` is kept by the server only (`noteOpened`, called by the read commands). */
export const PREF_SCHEMAS = {
  "home.dashboard_tabs": z.array(Id).max(TABS_MAX).describe("Id các dashboard của mình được ghim làm tab ở trang Tổng quan, theo thứ tự."),
} as const;
export type PrefKey = keyof typeof PREF_SCHEMAS;
const PrefKey = z.enum(Object.keys(PREF_SCHEMAS) as [PrefKey, ...PrefKey[]]);

type Raw = Record<string, unknown>;
type HomeCtx = HandlerCtx;

async function readPref(db: Db, userId: string, key: string): Promise<unknown | null> {
  const res = await db.execute(sql`SELECT value FROM user_prefs WHERE ${ownedBy(sql.raw("user_id"), userId)} AND key = ${key}`);
  return (res.rows[0] as { value: unknown } | undefined)?.value ?? null;
}

async function writePref(db: Db, userId: string, key: string, value: unknown): Promise<void> {
  await db.execute(sql`INSERT INTO user_prefs (user_id, key, value) VALUES (${userId}::uuid, ${key}, ${JSON.stringify(value)}::jsonb)
    ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
}

/** What the person may open right now, with the name to show. Uses each module's own access function; throws `not_found` / `forbidden` when they may not. */
interface Resolved {
  name: string;
  meta: Record<string, string | null>;
}
async function resolve(ctx: HomeCtx, type: RecentType, id: string): Promise<Resolved> {
  const c = ctx;
  switch (type) {
    case "datahub": {
      const d = await loadDatahubAccess(c, id, "view");
      return { name: d.name, meta: { system_key: d.systemKey } };
    }
    case "form": {
      const f = await loadOwnForm(ctx.db, ctx.actor.userId, id);
      return { name: f.name, meta: {} };
    }
    case "dashboard": {
      const v = await viewDash(c, id);
      return { name: v.row.name as string, meta: { datahub_id: v.datahubId, datahub_name: v.datahubName, role: v.role } };
    }
    case "article": {
      const v = await viewerOf(c);
      const post = await loadPost(ctx.db, id);
      if (post.kind !== articleKind.kind) throw new AppError("not_found", "Không tìm thấy bài.");
      const privileged = post.authorId === v.userId || isReviewer(v, articleKind);
      const liveOk = !!post.publishedVersion && !post.archivedAt && canReadLive(v, articleKind, post.liveFacets);
      const row = liveOk || (privileged && post.publishedVersion) ? await loadVersion(ctx.db, post.id, post.publishedVersion!) : post.authorId === v.userId ? await workingVersion(ctx.db, post.id) : null;
      if (!row) throw new AppError("not_found", "Không tìm thấy bài.");
      return { name: row.title, meta: {} };
    }
  }
}

/** `resolve`, or null when the person no longer has the right to open it (or it is gone). Any other error is real and goes up. */
async function tryResolve(ctx: HomeCtx, type: RecentType, id: string): Promise<Resolved | null> {
  try {
    return await resolve(ctx, type, id);
  } catch (e) {
    if (e instanceof AppError && (e.code === "not_found" || e.code === "forbidden")) return null;
    throw e;
  }
}

const TabOut = z.object({ id: Id, name: z.string(), datahub_id: Id, datahub_name: z.string(), role: z.enum(["owner", "shared", "guest"]) });
const MineOut = z.object({ id: Id, name: z.string(), datahub_id: Id, datahub_name: z.string(), updated_at: Ts });
const RecentOut = z.object({
  type: z.enum(RECENT_TYPES),
  id: Id,
  name: z.string(),
  at: z.string(),
  meta: z.record(z.string(), z.string().nullable()).describe("Gợi ý dựng link: datahub có `system_key` (`deal` = Quản lý Deal); dashboard có `datahub_id`, `role`."),
});

export const homeOperations = [
  defineQuery({
    name: "home.prefs.get",
    summary: "Đọc một tuỳ chọn của chính mình (chưa đặt thì trả mặc định rỗng).",
    permission: "system:whoami",
    aiAllowed: false,
    input: z.object({ key: PrefKey }),
    output: z.object({ key: z.string(), value: z.unknown() }),
    http: { method: "GET", path: "/me/prefs/:key" },
    handler: async (ctx, i) => ({ key: i.key, value: (await readPref(ctx.db, ctx.actor.userId, i.key)) ?? [] }),
  }),

  defineCommand({
    name: "home.prefs.set",
    summary: "Ghi một tuỳ chọn của chính mình. Hiện có `home.dashboard_tabs`: dashboard của mình ghim ở trang Tổng quan, theo thứ tự.",
    permission: "system:whoami",
    aiAllowed: false,
    audit: "none",
    input: z.object({ key: PrefKey, value: z.unknown() }),
    output: z.object({ key: z.string(), value: z.unknown() }),
    http: { method: "PUT", path: "/me/prefs/:key" },
    handler: async (ctx, i) => {
      const parsed = PREF_SCHEMAS[i.key].safeParse(i.value);
      if (!parsed.success) throw new AppError("validation_error", "Giá trị tuỳ chọn không hợp lệ.", { reason: "pref_invalid", key: i.key });
      const ids = [...new Set(parsed.data)];
      if (ids.length) {
        const own = await ctx.db.execute(sql`SELECT d.id FROM mt_dashboards d JOIN dh_datahubs h ON h.id = d.datahub_id
          WHERE /*scope*/ d.id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND h.owner_id = ${ctx.actor.userId}::uuid AND d.deleted_at IS NULL AND h.deleted_at IS NULL`);
        if (own.rows.length !== ids.length) throw new AppError("validation_error", "Chỉ ghim được dashboard của chính mình.", { reason: "pin_not_own" });
      }
      await writePref(ctx.db, ctx.actor.userId, i.key, ids);
      return { key: i.key, value: ids };
    },
  }),

  defineQuery({
    name: "home.dashboards.mine",
    summary: "Mọi dashboard của mình (ở các datahub mình sở hữu), để chọn ghim ở trang Tổng quan.",
    permission: "system:whoami",
    aiAllowed: false,
    list: true,
    input: z.object({}),
    output: MineOut,
    http: { method: "GET", path: "/dashboards/mine" },
    handler: async (ctx) => {
      const res = await ctx.db.execute(sql`SELECT d.id, d.name, d.datahub_id, h.name AS datahub_name, d.updated_at
        FROM mt_dashboards d JOIN dh_datahubs h ON h.id = d.datahub_id
        WHERE /*scope*/ h.owner_id = ${ctx.actor.userId}::uuid AND d.deleted_at IS NULL AND h.deleted_at IS NULL ORDER BY h.name, d.position, d.id LIMIT 300`);
      return { items: (res.rows as Raw[]).map((r) => ({ id: r.id as string, name: r.name as string, datahub_id: r.datahub_id as string, datahub_name: r.datahub_name as string, updated_at: r.updated_at as Date })), nextCursor: null };
    },
  }),

  defineQuery({
    name: "home.tabs.list",
    summary: "Các dashboard mình đã ghim ở trang Tổng quan, đúng thứ tự, kèm tên. Dashboard đã xoá hoặc không còn xem được thì bị lọc.",
    permission: "system:whoami",
    aiAllowed: false,
    list: true,
    input: z.object({}),
    output: TabOut,
    http: { method: "GET", path: "/me/home/tabs" },
    handler: async (ctx) => {
      const ids = z.array(Id).catch([]).parse(await readPref(ctx.db, ctx.actor.userId, "home.dashboard_tabs"));
      const items: z.output<typeof TabOut>[] = [];
      for (const id of ids) {
        const r = await tryResolve(ctx, "dashboard", id);
        if (r) items.push({ id, name: r.name, datahub_id: r.meta.datahub_id!, datahub_name: r.meta.datahub_name!, role: r.meta.role as "owner" | "shared" | "guest" });
      }
      return { items, nextCursor: null };
    },
  }),

  defineQuery({
    name: "home.recent.list",
    summary: "\"Mở gần đây\" của mình, mới nhất trước, kèm tên. Mục mình không còn quyền mở (hoặc đã xoá) bị lọc. Máy chủ tự ghi khi trang web đọc chi tiết datahub, form, dashboard, bài Knowledge.",
    permission: "system:whoami",
    aiAllowed: false,
    list: true,
    input: z.object({}),
    output: RecentOut,
    http: { method: "GET", path: "/me/recent" },
    handler: async (ctx) => {
      const items: z.output<typeof RecentOut>[] = [];
      for (const e of asRecent(await readPref(ctx.db, ctx.actor.userId, "recent"))) {
        const r = await tryResolve(ctx, e.type, e.id);
        if (r) items.push({ type: e.type, id: e.id, name: r.name, at: e.at, meta: r.meta });
      }
      return { items, nextCursor: null };
    },
  }),
];
