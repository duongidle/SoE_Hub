import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, DH_COLUMN_CEILING, FilterSchema, permissionsFor, SHARE_PERMISSIONS, SortItemSchema, TimeFilterSchema } from "@soe/shared";
import { compileFilter, getTrashRetentionDays, newId, type Executor } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { loadDatahubAccess, loadTableAccess, type TableAccess } from "./access";
import { taggedRows } from "./split-ops";
import { getLimits } from "./limits";
import { GROUP_FNS } from "./rows-groups";
import { Id, Ts } from "./shared";
import { TableSchema } from "./table-schema";

type Raw = Record<string, unknown>;
type Ctx = Pick<HandlerCtx, "db" | "actor" | "audit" | "emit">;

// ================================================================================================
// views (design module2 section 5)
// ================================================================================================

const ViewConfigSchema = z
  .strictObject({
    filter: FilterSchema,
    sort: z.array(SortItemSchema).max(5),
    group: z.array(z.strictObject({ field: z.string().min(1).max(100), dir: z.enum(["asc", "desc"]).optional() })).max(3),
    hidden: z.array(z.string().max(100)).max(300),
    widths: z.record(z.string().max(100), z.number().int().min(20).max(2000)),
    frozen: z.number().int().min(0).max(20),
    order: z.array(z.string().max(100)).max(300),
    row_height: z.enum(["short", "medium", "tall"]),
    colors: z.array(z.strictObject({ filter: FilterSchema, color: z.string().max(20) })).max(20),
    /** Ô Thời gian (mục 5.4): cột ngày và khoảng; server dịch sang ngày theo giờ Việt Nam lúc đọc. */
    time_filter: TimeFilterSchema,
    /** Dòng tổng của nhóm: cột → loại tổng (count, sum, avg, min, max). */
    group_aggs: z.record(z.string().max(100), z.enum(GROUP_FNS)),
    /** Nhóm thu gọn (mục 5.1): true = nhóm mới mặc định đóng ("Thu gọn tất cả"); `groups_toggled` = các nhóm (khoá JSON của đường dẫn) ngược với mặc định. */
    groups_collapsed: z.boolean(),
    groups_toggled: z.array(z.string().max(500)).max(500),
    /** "Không theo kỳ chung" (Module 4 mục 11a): bảng Quản lý Deal giữ khoảng thời gian riêng của view thay vì theo thanh chọn kỳ. */
    own_period: z.boolean(),
  })
  .partial();

type ViewConfig = z.infer<typeof ViewConfigSchema>;

const ViewOut = z.object({
  id: Id,
  table_id: Id,
  name: z.string(),
  kind: z.string(),
  position: z.number().int(),
  /** Shared view (everyone with access sees it) or a personal view of its author. */
  shared: z.boolean(),
  owner_id: z.uuid().nullable(),
  /** The configuration you see: the shared one, with your own tweak on top when you have one. */
  config: z.record(z.string(), z.unknown()),
  has_override: z.boolean(),
  version: z.number().int(),
});

function parseConfig(raw: unknown): ViewConfig {
  const r = ViewConfigSchema.safeParse(raw ?? {});
  if (!r.success) throw new AppError("validation_error", "Cấu hình view không hợp lệ.", { issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  if (JSON.stringify(r.data).length > 50_000) throw new AppError("validation_error", "Cấu hình view quá lớn.");
  return r.data;
}

/** The filters of a view must be valid for the table (columns exist, operators fit the type). */
function checkConfigAgainst(schema: TableSchema, cfg: ViewConfig): void {
  const fields = schema.fieldMap();
  if (cfg.filter) compileFilter(schema.normalizeFilter(cfg.filter), fields);
  cfg.colors?.forEach((c) => compileFilter(schema.normalizeFilter(c.filter), fields));
  cfg.sort?.forEach((s) => schema.fieldFor(s.field));
  cfg.group?.forEach((g) => schema.fieldFor(g.field));
  Object.keys(cfg.group_aggs ?? {}).forEach((k) => schema.fieldFor(k));
  cfg.time_filter?.columns.forEach((c) => schema.fieldFor(c));
}

/** Merges an autosave patch into a config: a key set to `null` is removed. */
function mergeConfig(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

function viewOut(r: Raw, override: Record<string, unknown> | null): z.infer<typeof ViewOut> {
  return {
    id: r.id as string,
    table_id: r.table_id as string,
    name: r.name as string,
    kind: r.kind as string,
    position: r.position as number,
    shared: r.owner_id === null,
    owner_id: (r.owner_id as string | null) ?? null,
    config: override ?? (r.config as Record<string, unknown>),
    has_override: override !== null,
    version: r.version as number,
  };
}

async function visibleViews(db: Executor, acc: TableAccess): Promise<z.infer<typeof ViewOut>[]> {
  const res = await db.execute(sql`SELECT v.*, o.config AS override FROM dh_views v
    LEFT JOIN dh_view_overrides o ON o.view_id = v.id AND o.user_id = ${acc.actorId}::uuid
    WHERE ${acc.scope("v")} AND v.deleted_at IS NULL AND (v.owner_id IS NULL OR v.owner_id = ${acc.actorId}::uuid)
    ORDER BY v.owner_id NULLS FIRST, v.position, v.created_at`);
  return (res.rows as Raw[]).map((r) => viewOut(r, (r.override as Record<string, unknown> | null) ?? null));
}

/** Finds a view the actor may see and the access to its table. A personal view of someone else does not exist for them. */
async function loadView(ctx: Ctx, viewId: string): Promise<{ acc: TableAccess; view: Raw }> {
  // Only the table id is read here; the table access check below decides whether the actor may go on.
  const probe = await ctx.db.execute(sql`SELECT table_id FROM dh_views WHERE /*scope*/ id = ${viewId}::uuid AND deleted_at IS NULL`);
  const tableId = (probe.rows[0] as { table_id?: string } | undefined)?.table_id;
  if (!tableId) throw new AppError("not_found", "Không tìm thấy view.");
  const acc = await loadTableAccess(ctx, tableId);
  const res = await ctx.db.execute(sql`SELECT * FROM dh_views WHERE ${acc.scope()} AND id = ${viewId}::uuid AND deleted_at IS NULL AND (owner_id IS NULL OR owner_id = ${acc.actorId}::uuid)`);
  const view = res.rows[0] as Raw | undefined;
  if (!view) throw new AppError("not_found", "Không tìm thấy view.");
  return { acc, view };
}

const ConfigIn = z.record(z.string(), z.unknown());

export const viewOperations = [
  defineQuery({
    name: "datahub.view.list",
    summary: "Các view của bảng: view chung và view cá nhân của bạn, kèm view mở lần cuối.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ table_id: Id }),
    output: z.object({ views: z.array(ViewOut), last_view_id: z.uuid().nullable() }),
    http: { method: "GET", path: "/tables/:table_id/views" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id);
      const views = await visibleViews(ctx.db, acc);
      const st = await ctx.db.execute(sql`SELECT last_view_id FROM dh_table_state WHERE ${acc.scope()} AND user_id = ${acc.actorId}::uuid`);
      const last = (st.rows[0] as { last_view_id: string | null } | undefined)?.last_view_id ?? null;
      return { views, last_view_id: last && views.some((v) => v.id === last) ? last : null };
    },
  }),

  defineCommand({
    name: "datahub.view.create",
    summary: "Tạo view. View chung chỉ chủ bảng tạo; ai cũng tạo được view cá nhân.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ table_id: Id, name: z.string().normalize("NFC").trim().min(1).max(100), shared: z.boolean().default(false), config: ConfigIn.optional() }),
    output: ViewOut,
    http: { method: "POST", path: "/tables/:table_id/views", status: 201 },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id);
      if (i.shared) acc.require("owner");
      const cfg = parseConfig(i.config);
      checkConfigAgainst(await TableSchema.load(ctx.db, acc), cfg);
      const id = newId();
      const pos = await ctx.db.execute(sql`SELECT coalesce(max(position), -1) + 1 AS next FROM dh_views WHERE ${acc.scope()} AND deleted_at IS NULL`);
      await ctx.db.execute(sql`INSERT INTO dh_views (id, table_id, owner_id, name, kind, position, config, created_by, updated_by)
        VALUES (${id}::uuid, ${acc.tableId}::uuid, ${i.shared ? null : acc.actorId}::uuid, ${i.name}, 'grid', ${(pos.rows[0] as { next: number }).next}::int, ${JSON.stringify(cfg)}::jsonb, ${acc.actorId}::uuid, ${acc.actorId}::uuid)`);
      ctx.audit({ type: "datahub_view", id, details: { table_id: acc.tableId, name: i.name, shared: i.shared } });
      return (await visibleViews(ctx.db, acc)).find((v) => v.id === id)!;
    },
  }),

  defineCommand({
    name: "datahub.view.update",
    summary: "Sửa view và TỰ LƯU (đổi lọc, sắp xếp, nhóm, ẩn cột, độ rộng, cố định, thứ tự cột, tô màu).",
    description:
      "Gửi các mục `config` đổi (mục đặt `null` thì bị bỏ). Chủ bảng sửa view chung → mọi người thấy. Người được chia sẻ sửa view chung → lưu thành bản riêng của họ, không ảnh hưởng ai (`datahub.view.reset` để về mặc định). Sửa view cá nhân → lưu vào view đó. Đổi tên/vị trí view chung chỉ chủ bảng.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ view_id: Id, name: z.string().normalize("NFC").trim().min(1).max(100).optional(), position: z.number().int().min(0).max(100).optional(), config: ConfigIn.optional() }),
    output: ViewOut,
    http: { method: "PATCH", path: "/views/:view_id" },
    handler: async (ctx, i) => {
      const { acc, view } = await loadView(ctx, i.view_id);
      const shared = view.owner_id === null;
      const mine = view.owner_id === acc.actorId;
      let patch: ViewConfig | null = null;
      if (i.config) {
        const current = shared ? (await visibleViews(ctx.db, acc)).find((v) => v.id === view.id)!.config : (view.config as Record<string, unknown>);
        const merged = parseConfig(mergeConfig(current, i.config));
        checkConfigAgainst(await TableSchema.load(ctx.db, acc), merged);
        patch = merged;
      }
      if (shared && acc.level !== "owner") {
        if (i.name !== undefined || i.position !== undefined) throw new AppError("forbidden", "Chỉ chủ bảng đổi tên hoặc vị trí view chung.");
        if (patch) {
          await ctx.db.execute(sql`INSERT INTO dh_view_overrides (view_id, user_id, config) VALUES (${view.id as string}::uuid, ${acc.actorId}::uuid, ${JSON.stringify(patch)}::jsonb)
            ON CONFLICT (view_id, user_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`);
        }
      } else if (shared || mine) {
        await ctx.db.execute(sql`UPDATE dh_views SET name = ${i.name ?? (view.name as string)}, position = ${i.position ?? (view.position as number)}::int,
          config = ${JSON.stringify(patch ?? view.config)}::jsonb, version = version + 1, updated_at = now(), updated_by = ${acc.actorId}::uuid
          WHERE ${acc.scope()} AND id = ${view.id as string}::uuid`);
      }
      ctx.audit({ type: "datahub_view", id: view.id as string, details: { table_id: acc.tableId, name: i.name, config_keys: i.config ? Object.keys(i.config) : [] } });
      return (await visibleViews(ctx.db, acc)).find((v) => v.id === view.id)!;
    },
  }),

  defineCommand({
    name: "datahub.view.reset",
    summary: "Bỏ bản riêng của bạn trên view chung, về cấu hình mặc định của chủ bảng.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ view_id: Id }),
    output: ViewOut,
    http: { method: "POST", path: "/views/:view_id/reset" },
    handler: async (ctx, i) => {
      const { acc, view } = await loadView(ctx, i.view_id);
      await ctx.db.execute(sql`DELETE FROM dh_view_overrides o USING dh_views v WHERE v.id = o.view_id AND ${acc.scope("v")} AND o.view_id = ${view.id as string}::uuid AND o.user_id = ${acc.actorId}::uuid`);
      return (await visibleViews(ctx.db, acc)).find((v) => v.id === view.id)!;
    },
  }),

  defineCommand({
    name: "datahub.view.delete",
    summary: "Xoá view. View chung: chỉ chủ bảng. View cá nhân: người tạo.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ view_id: Id }),
    output: z.object({ id: Id, deleted: z.literal(true) }),
    http: { method: "DELETE", path: "/views/:view_id" },
    handler: async (ctx, i) => {
      const { acc, view } = await loadView(ctx, i.view_id);
      if (view.owner_id === null) acc.require("owner");
      await ctx.db.execute(sql`UPDATE dh_views SET deleted_at = now(), deleted_by = ${acc.actorId}::uuid, version = version + 1, updated_at = now() WHERE ${acc.scope()} AND id = ${view.id as string}::uuid`);
      ctx.audit({ type: "datahub_view", id: view.id as string, details: { table_id: acc.tableId, name: view.name } });
      return { id: view.id as string, deleted: true as const };
    },
  }),

  defineCommand({
    name: "datahub.view.open",
    summary: "Ghi nhớ view bạn vừa mở của bảng (lần sau mở đúng view đó).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    audit: "none",
    input: z.object({ table_id: Id, view_id: Id }),
    output: z.object({ table_id: Id, last_view_id: Id }),
    http: { method: "PUT", path: "/tables/:table_id/last-view" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id);
      const views = await visibleViews(ctx.db, acc);
      if (!views.some((v) => v.id === i.view_id)) throw new AppError("not_found", "Không tìm thấy view.");
      await ctx.db.execute(sql`INSERT INTO dh_table_state (table_id, user_id, last_view_id) VALUES (${acc.tableId}::uuid, ${acc.actorId}::uuid, ${i.view_id}::uuid)
        ON CONFLICT (table_id, user_id) DO UPDATE SET last_view_id = EXCLUDED.last_view_id, updated_at = now()`);
      return { table_id: acc.tableId, last_view_id: i.view_id };
    },
  }),
];

// ================================================================================================
// sharing (design module2 section 10)
// ================================================================================================

const ShareOut = z.object({
  id: Id,
  datahub_id: Id,
  /** Null = the whole datahub. */
  table_id: z.uuid().nullable(),
  grantee_id: Id,
  grantee_name: z.string().nullable(),
  grantee_email: z.string().nullable(),
  permission: z.enum(SHARE_PERMISSIONS),
});

function shareOut(r: Raw): z.infer<typeof ShareOut> {
  return { id: r.id as string, datahub_id: r.datahub_id as string, table_id: (r.table_id as string | null) ?? null, grantee_id: r.grantee_id as string, grantee_name: (r.full_name as string | null) ?? null, grantee_email: (r.email as string | null) ?? null, permission: r.permission as "view" | "edit_data" };
}

export const shareOperations = [
  defineQuery({
    name: "datahub.share.list",
    summary: "Danh sách người được chia sẻ datahub (chỉ chủ xem).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ datahub_id: Id }),
    output: z.array(ShareOut),
    http: { method: "GET", path: "/datahubs/:datahub_id/shares" },
    handler: async (ctx, i) => {
      const dh = await loadDatahubAccess(ctx, i.datahub_id, "owner");
      const res = await ctx.db.execute(sql`SELECT s.*, u.full_name, u.email FROM dh_shares s JOIN users u ON u.id = s.grantee_id WHERE /*scope*/ s.datahub_id = ${dh.id}::uuid ORDER BY s.created_at`);
      return (res.rows as Raw[]).map(shareOut);
    },
  }),

  defineCommand({
    name: "datahub.share.set",
    summary: "Chia sẻ cả datahub hoặc một bảng cho một người, quyền Xem hoặc Sửa dữ liệu. Chia lại thì đổi quyền.",
    description: "Bỏ `table_id` = cả datahub (kể cả bảng tạo sau này). Có `table_id` = chỉ bảng đó; người nhận thấy datahub trong mục \"Được chia sẻ với tôi\" nhưng chỉ thấy bảng được chia sẻ. Chỉ chủ chia sẻ; chủ không bị Leader/Manager/Admin thay thế.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: ["datahub.share.changed"],
    input: z.object({ datahub_id: Id, grantee_id: Id, table_id: Id.nullable().optional(), permission: z.enum(SHARE_PERMISSIONS) }),
    output: ShareOut,
    http: { method: "PUT", path: "/datahubs/:datahub_id/shares" },
    handler: async (ctx, i) => {
      const dh = await loadDatahubAccess(ctx, i.datahub_id, "owner");
      if (i.grantee_id === dh.ownerId) throw new AppError("validation_error", "Không chia sẻ cho chính chủ datahub.");
      const [u] = (await ctx.db.execute(sql`SELECT id, kind, status, roles, guest_preset, email, full_name FROM users WHERE id = ${i.grantee_id}::uuid`)).rows as Raw[];
      if (!u || u.kind !== "person" || u.status !== "active") throw new AppError("validation_error", "Chỉ chia sẻ được cho người đang hoạt động.");
      if (!permissionsFor(u.roles as string[], (u.guest_preset as string | null) ?? null).has("datahub:datahub:use")) throw new AppError("validation_error", "Người này không dùng được datahub (Guest).");
      if (i.table_id) {
        const t = await ctx.db.execute(sql`SELECT 1 FROM dh_tables WHERE /*scope*/ id = ${i.table_id}::uuid AND datahub_id = ${dh.id}::uuid AND deleted_at IS NULL`);
        if (t.rows.length === 0) throw new AppError("not_found", "Không tìm thấy bảng trong datahub này.");
      }
      const id = newId();
      const res = i.table_id
        ? await ctx.db.execute(sql`INSERT INTO dh_shares (id, datahub_id, table_id, grantee_id, permission, created_by) VALUES (${id}::uuid, ${dh.id}::uuid, ${i.table_id}::uuid, ${i.grantee_id}::uuid, ${i.permission}, ${ctx.actor.userId}::uuid)
            ON CONFLICT (table_id, grantee_id) WHERE table_id IS NOT NULL DO UPDATE SET permission = EXCLUDED.permission, updated_at = now() RETURNING *`)
        : await ctx.db.execute(sql`INSERT INTO dh_shares (id, datahub_id, table_id, grantee_id, permission, created_by) VALUES (${id}::uuid, ${dh.id}::uuid, NULL, ${i.grantee_id}::uuid, ${i.permission}, ${ctx.actor.userId}::uuid)
            ON CONFLICT (datahub_id, grantee_id) WHERE table_id IS NULL DO UPDATE SET permission = EXCLUDED.permission, updated_at = now() RETURNING *`);
      const row = res.rows[0] as Raw;
      ctx.audit({ type: "datahub_share", id: row.id as string, details: { datahub_id: dh.id, table_id: i.table_id ?? null, grantee_id: i.grantee_id, permission: i.permission } });
      await ctx.emit("datahub.share.changed", { aggregateType: "datahub", aggregateId: dh.id, payload: { datahub_id: dh.id, table_id: i.table_id ?? null, grantee_id: i.grantee_id } });
      return shareOut({ ...row, full_name: u.full_name, email: u.email });
    },
  }),

  defineCommand({
    name: "datahub.share.remove",
    summary: "Gỡ một chia sẻ (chỉ chủ).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: ["datahub.share.changed"],
    input: z.object({ datahub_id: Id, share_id: Id }),
    output: z.object({ id: Id, removed: z.literal(true), tagged_rows: z.number().int().describe("Số dòng đang tag người vừa bị gỡ ở ô Người dùng: tag giữ nguyên, ô hiện \"không còn quyền\".") }),
    http: { method: "DELETE", path: "/datahubs/:datahub_id/shares/:share_id" },
    handler: async (ctx, i) => {
      const dh = await loadDatahubAccess(ctx, i.datahub_id, "owner");
      const res = await ctx.db.execute(sql`DELETE FROM dh_shares WHERE /*scope*/ id = ${i.share_id}::uuid AND datahub_id = ${dh.id}::uuid RETURNING grantee_id, table_id`);
      const row = res.rows[0] as { grantee_id: string; table_id: string | null } | undefined;
      if (!row) throw new AppError("not_found", "Không tìm thấy chia sẻ.");
      ctx.audit({ type: "datahub_share", id: i.share_id, details: { datahub_id: dh.id, table_id: row.table_id, grantee_id: row.grantee_id } });
      await ctx.emit("datahub.share.changed", { aggregateType: "datahub", aggregateId: dh.id, payload: { datahub_id: dh.id, table_id: row.table_id, grantee_id: row.grantee_id } });
      // The tags stay (no history is lost); the person only stops seeing the table. `datahub.share.tagged` gives the same number BEFORE removing.
      const tagged = await taggedRows(ctx.db, dh.id, row.table_id, row.grantee_id);
      return { id: i.share_id, removed: true as const, tagged_rows: tagged.rows };
    },
  }),
];

// ================================================================================================
// limits (design module2 section 11)
// ================================================================================================

const LimitsOut = z.object({ datahubs: z.number().int(), tables: z.number().int(), columns: z.number().int() });

export const limitOperations = [
  defineQuery({
    name: "datahub.limit.mine",
    summary: "Giới hạn datahub của bạn và mức đã dùng.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({}),
    output: z.object({ limits: LimitsOut, used: z.object({ datahubs: z.number().int() }), column_ceiling: z.number().int() }),
    http: { method: "GET", path: "/datahub/limits" },
    handler: async (ctx) => {
      const me = ctx.actor.userId;
      const n = await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_datahubs WHERE /*scope*/ owner_id = ${me}::uuid AND deleted_at IS NULL`);
      return { limits: await getLimits(ctx.db, me), used: { datahubs: (n.rows[0] as { n: number }).n }, column_ceiling: DH_COLUMN_CEILING };
    },
  }),

  defineQuery({
    name: "datahub.limit.user.list",
    summary: "Admin xem các giới hạn riêng đã đặt cho từng người.",
    permission: "system:setting:read",
    aiAllowed: true,
    input: z.object({}),
    output: z.array(z.object({ user_id: Id, full_name: z.string(), email: z.string().nullable(), max_datahubs: z.number().int().nullable(), max_tables: z.number().int().nullable(), max_columns: z.number().int().nullable() })),
    http: { method: "GET", path: "/admin/datahub/limits" },
    handler: async (ctx) => {
      const res = await ctx.db.execute(sql`SELECT l.user_id, u.full_name, u.email, l.max_datahubs, l.max_tables, l.max_columns FROM dh_user_limits l JOIN users u ON u.id = l.user_id ORDER BY u.full_name`);
      return res.rows as never;
    },
  }),

  defineCommand({
    name: "datahub.limit.user.set",
    summary: "Admin đặt giới hạn riêng cho một người. Giá trị `null` = dùng mặc định của hệ thống. Cột tối đa 200.",
    permission: "system:setting:write",
    aiAllowed: true,
    input: z.object({
      user_id: Id,
      max_datahubs: z.number().int().min(1).max(1000).nullable().optional(),
      max_tables: z.number().int().min(1).max(1000).nullable().optional(),
      max_columns: z.number().int().min(1).max(DH_COLUMN_CEILING, `Cột mỗi bảng tối đa ${DH_COLUMN_CEILING}.`).nullable().optional(),
    }),
    output: LimitsOut.extend({ overrides: z.object({ max_datahubs: z.number().int().nullable(), max_tables: z.number().int().nullable(), max_columns: z.number().int().nullable() }) }),
    http: { method: "PUT", path: "/admin/datahub/limits/:user_id" },
    handler: async (ctx, i) => {
      const u = await ctx.db.execute(sql`SELECT 1 FROM users WHERE id = ${i.user_id}::uuid AND kind = 'person'`);
      if (u.rows.length === 0) throw new AppError("not_found", "Không tìm thấy người dùng.");
      const cur = await ctx.db.execute(sql`SELECT max_datahubs, max_tables, max_columns FROM dh_user_limits WHERE user_id = ${i.user_id}::uuid`);
      const c = (cur.rows[0] as { max_datahubs: number | null; max_tables: number | null; max_columns: number | null } | undefined) ?? { max_datahubs: null, max_tables: null, max_columns: null };
      const next = {
        max_datahubs: i.max_datahubs === undefined ? c.max_datahubs : i.max_datahubs,
        max_tables: i.max_tables === undefined ? c.max_tables : i.max_tables,
        max_columns: i.max_columns === undefined ? c.max_columns : i.max_columns,
      };
      await ctx.db.execute(sql`INSERT INTO dh_user_limits (user_id, max_datahubs, max_tables, max_columns, updated_by) VALUES (${i.user_id}::uuid, ${next.max_datahubs}, ${next.max_tables}, ${next.max_columns}, ${ctx.actor.userId}::uuid)
        ON CONFLICT (user_id) DO UPDATE SET max_datahubs = EXCLUDED.max_datahubs, max_tables = EXCLUDED.max_tables, max_columns = EXCLUDED.max_columns, updated_by = EXCLUDED.updated_by, updated_at = now()`);
      ctx.audit({ type: "datahub_limit", id: i.user_id, details: next });
      return { ...(await getLimits(ctx.db, i.user_id)), overrides: next };
    },
  }),
];

// ================================================================================================
// trash
// ================================================================================================

export const trashOperations = [
  defineQuery({
    name: "datahub.trash.list",
    summary: "Thùng rác datahub: datahub, bảng của bạn; với `table_id` còn thêm cột và dòng đã xoá của bảng đó.",
    description: "Khôi phục bằng `datahub.datahub.restore`, `datahub.table.restore`, `datahub.column.restore`, `datahub.row.restore`. Quá hạn (mặc định 7 ngày) thì worker xoá hẳn.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ table_id: Id.optional() }),
    output: z.object({
      retention_days: z.number().int(),
      datahubs: z.array(z.object({ id: Id, name: z.string(), deleted_at: Ts, purge_at: Ts })),
      tables: z.array(z.object({ id: Id, datahub_id: Id, datahub_name: z.string(), name: z.string(), deleted_at: Ts, purge_at: Ts })),
      columns: z.array(z.object({ id: Id, key: z.string(), name: z.string(), type: z.string(), deleted_at: Ts, purge_at: Ts })),
      rows: z.array(z.object({ id: Id, row_no: z.number().int(), deleted_at: Ts, deleted_by: z.uuid().nullable(), purge_at: Ts })),
    }),
    http: { method: "GET", path: "/datahub/trash" },
    handler: async (ctx, i) => {
      const me = ctx.actor.userId;
      const days = await getTrashRetentionDays(ctx.db);
      const purge = (d: Date | string) => new Date(new Date(d).getTime() + days * 86400_000);
      const dhs = await ctx.db.execute(sql`SELECT id, name, deleted_at FROM dh_datahubs WHERE /*scope*/ owner_id = ${me}::uuid AND deleted_at IS NOT NULL AND system_key IS NULL ORDER BY deleted_at DESC`);
      const tbs = await ctx.db.execute(sql`SELECT t.id, t.datahub_id, d.name AS datahub_name, t.name, t.deleted_at FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id
        WHERE /*scope*/ d.owner_id = ${me}::uuid AND d.deleted_at IS NULL AND t.deleted_at IS NOT NULL AND NOT t.archived ORDER BY t.deleted_at DESC`);
      let columns: Raw[] = [];
      let rows: Raw[] = [];
      if (i.table_id) {
        const acc = await loadTableAccess(ctx, i.table_id, "edit_data");
        if (acc.level === "owner") columns = (await ctx.db.execute(sql`SELECT id, key, name, type, deleted_at FROM dh_columns WHERE ${acc.scope()} AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`)).rows as Raw[];
        rows = (await ctx.db.execute(sql`SELECT id, row_no, deleted_at, deleted_by FROM dh_rows WHERE ${acc.rows()} AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500`)).rows as Raw[];
      }
      const withPurge = <T extends Raw>(list: Raw[]) => list.map((r) => ({ ...r, purge_at: purge(r.deleted_at as Date | string) }) as unknown as T);
      return {
        retention_days: days,
        datahubs: withPurge(dhs.rows as Raw[]) as never,
        tables: withPurge(tbs.rows as Raw[]) as never,
        columns: withPurge(columns) as never,
        rows: withPurge(rows) as never,
      };
    },
  }),
];
