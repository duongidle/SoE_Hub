import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, listParamsShape, type ActorRef } from "@soe/shared";
import { feedback, feedbackMessages, listPage, newId, softDelete, versionedUpdate, type Executor, type FieldMap } from "@soe/db";
import { ownedBy, systemScope } from "../../auth/access";
import type { Config } from "../../config";
import type { StorageDriver } from "../../storage/types";
import { registerOwnedTable } from "../../auth/query-guard";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx, ListOutput } from "../../core/types";
import { notify, NOTIFICATION_TYPES, stableId } from "../notification";
import { namesOf } from "../org/view";
import type { Actor } from "@soe/shared";

registerOwnedTable("feedback");
registerOwnedTable("feedback_messages");

/** Module 11 (Stage 11A): feedback of the app. Design `module11-cai-dat-feedback.md` 1-3. */
export const FEEDBACK_KINDS = ["bug", "suggestion", "feature"] as const;
export const FEEDBACK_STATUSES = ["new", "viewing", "planned", "done", "wont_do"] as const;
export const FEEDBACK_BODY_MAX = 5000;
export const FEEDBACK_MAX_FILES = 3;
export const FEEDBACK_FILE_MAX_BYTES = 5 * 1024 * 1024;
const MANAGE = "feedback:inbox:manage" as const;

type Ctx = HandlerCtx<Actor>;
type Row = typeof feedback.$inferSelect;
const Id = z.uuid();
const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);
const actorRef = (a: Actor): ActorRef => ({ userId: a.userId, via: a.via, connectionId: a.connectionId, automationId: a.automationId });
const BodyField = z.string().trim().min(1, "Nội dung không được để trống.").max(FEEDBACK_BODY_MAX);

/** The handlers of the inbox: every active person who holds `feedback:inbox:manage` by role (Admin) or by a supplementary grant. */
export async function inboxManagerIds(db: Executor): Promise<string[]> {
  const r = await db.execute(sql`SELECT u.id FROM users u WHERE /*scope:system*/ u.kind = 'person' AND u.status = 'active'
    AND ('admin' = ANY(u.roles) OR EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id AND up.permission = ${MANAGE} AND up.revoked_at IS NULL))`);
  return (r.rows as { id: string }[]).map((x) => x.id);
}

async function canManage(ctx: Ctx): Promise<boolean> {
  return (await ctx.access.permissions()).has(MANAGE);
}

async function requireManage(ctx: Ctx): Promise<void> {
  if (!(await canManage(ctx))) throw new AppError("forbidden", "Bạn không có quyền xử lý feedback.");
}

/** Loads a feedback the caller may see: its author, or a handler. Anyone else gets `not_found` (no hint that it exists). */
async function loadVisible(ctx: Ctx, id: string): Promise<{ row: Row; manage: boolean }> {
  const [row] = await ctx.db.select().from(feedback).where(and(systemScope(), eq(feedback.id, id), isNull(feedback.deletedAt))).limit(1);
  const manage = await canManage(ctx);
  if (!row || (row.authorId !== ctx.actor.userId && !manage)) throw new AppError("not_found", "Không tìm thấy góp ý này.");
  return { row, manage };
}

/** Up to 3 images, each the sender's own, uploaded (ready), not deleted, at most 5 MB (design 1). */
async function checkImages(db: Executor, authorId: string, ids: string[]): Promise<string[]> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return [];
  const r = await db.execute(sql`SELECT id, content_type, size_bytes FROM files WHERE /*scope:system*/ id = ANY(${`{${uniq.join(",")}}`}::uuid[]) AND owner_id = ${authorId}::uuid AND status = 'ready' AND deleted_at IS NULL`);
  const ok = new Map((r.rows as { id: string; content_type: string; size_bytes: number }[]).map((x) => [x.id, x]));
  for (const id of uniq) {
    const f = ok.get(id);
    if (!f) throw new AppError("validation_error", "Ảnh không có, chưa tải xong, hoặc không phải của bạn.", { reason: "attachment_invalid", file_id: id });
    if (!f.content_type.startsWith("image/")) throw new AppError("validation_error", "Chỉ đính ảnh.", { reason: "attachment_not_image", file_id: id });
    if (Number(f.size_bytes) > FEEDBACK_FILE_MAX_BYTES) throw new AppError("validation_error", "Mỗi ảnh tối đa 5 MB.", { reason: "attachment_too_large", file_id: id });
  }
  return uniq;
}

async function filesOf(db: Executor, ids: string[]) {
  if (ids.length === 0) return [];
  const r = await db.execute(sql`SELECT id, filename, content_type, size_bytes FROM files WHERE /*scope:system*/ id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND status = 'ready' AND deleted_at IS NULL`);
  const by = new Map((r.rows as { id: string; filename: string; content_type: string; size_bytes: number }[]).map((x) => [x.id, x]));
  return ids.flatMap((id) => {
    const f = by.get(id);
    return f ? [{ id: f.id, filename: f.filename, content_type: f.content_type, size_bytes: Number(f.size_bytes) }] : [];
  });
}

const excerpt = (s: string, n = 120): string => (s.length > n ? `${s.slice(0, n).trimEnd()}...` : s);

const Summary = z.object({ id: Id, kind: z.string(), status: z.string(), version: z.number().int(), created_at: z.string(), updated_at: z.string() });
const summary = (r: Row) => ({ id: r.id, kind: r.kind, status: r.status, version: r.version, created_at: iso(r.createdAt)!, updated_at: iso(r.updatedAt)! });

const listFields: FieldMap = {
  id: { type: "uuid", expr: sql`f.id` },
  kind: { type: "text", expr: sql`f.kind` },
  status: { type: "text", expr: sql`f.status` },
  excerpt: { type: "text", expr: sql`left(f.body, 160)`, sortable: false },
  author_id: { type: "uuid", expr: sql`f.author_id` },
  author_name: { type: "text", expr: sql`au.full_name`, sortable: false },
  file_count: { type: "number", expr: sql`cardinality(f.file_ids)`, sortable: false },
  message_count: { type: "number", expr: sql`(SELECT count(*)::int FROM feedback_messages fm WHERE fm.feedback_id = f.id)`, sortable: false },
  version: { type: "number", expr: sql`f.version` },
  created_at: { type: "datetime", expr: sql`f.created_at` },
  updated_at: { type: "datetime", expr: sql`f.updated_at` },
};
const listFrom = sql`feedback f JOIN users au ON au.id = f.author_id`;
const NEWEST: { field: string; dir: "asc" | "desc" }[] = [{ field: "created_at", dir: "desc" }, { field: "id", dir: "desc" }];

// ---- notifications (design 2) ---------------------------------------------------------------------------------------------------------------------

async function notifyHandlers(ctx: Ctx, row: Row, o: { title: string; body: string; source: string; onlyAnswered: boolean }): Promise<void> {
  let recipients = await inboxManagerIds(ctx.db);
  if (o.onlyAnswered) {
    // The author wrote again: tell the handlers who already replied; when nobody has, every handler (design 2).
    const r = await ctx.db.execute(sql`SELECT DISTINCT author_id FROM feedback_messages WHERE /*scope:system*/ feedback_id = ${row.id}::uuid AND author_id <> ${row.authorId}::uuid`);
    const answered = new Set((r.rows as { author_id: string }[]).map((x) => x.author_id));
    const still = recipients.filter((id) => answered.has(id));
    if (still.length) recipients = still;
  }
  await notify.send(ctx.db as never, {
    type: NOTIFICATION_TYPES.feedbackNew, recipients, actor: actorRef(ctx.actor), object: { type: "feedback", id: row.id }, sourceEventId: o.source,
    render: () => ({ title: o.title, body: o.body, link: `/quan-tri/feedback?id=${row.id}`, data: { feedback_id: row.id, kind: row.kind } }),
  });
}

async function notifyAuthor(ctx: Ctx, row: Row, o: { title: string; body: string; source: string }): Promise<void> {
  await notify.send(ctx.db as never, {
    type: NOTIFICATION_TYPES.feedbackUpdate, recipients: [row.authorId], actor: actorRef(ctx.actor), object: { type: "feedback", id: row.id }, sourceEventId: o.source,
    render: () => ({ title: o.title, body: o.body, link: `/gop-y?id=${row.id}`, data: { feedback_id: row.id, kind: row.kind } }),
  });
}

const KIND_LABEL: Record<string, string> = { bug: "Báo lỗi", suggestion: "Góp ý", feature: "Yêu cầu tính năng" };
const STATUS_LABEL: Record<string, string> = { new: "Mới", viewing: "Đang xem", planned: "Đã lên kế hoạch", done: "Đã xong", wont_do: "Không làm" };

// ---- operations -------------------------------------------------------------------------------------------------------------------------------

export const feedbackOperations = (cfg: Config, storage: StorageDriver) => [
  defineCommand({
    name: "feedback.create",
    summary: "Gửi một góp ý: báo lỗi, góp ý hoặc yêu cầu tính năng, kèm tối đa 3 ảnh (đã tải lên bằng file.upload.init).",
    description: "Mọi người đã đăng nhập gửi được, kể cả Guest. `context` là thông tin tự ghi (đường dẫn trang, user agent, cỡ màn hình): ứng dụng web tự điền.",
    permission: "feedback:feedback:write",
    aiAllowed: true,
    input: z.object({
      kind: z.enum(FEEDBACK_KINDS),
      body: BodyField,
      file_ids: z.array(Id).max(FEEDBACK_MAX_FILES).default([]),
      context: z.object({ url: z.string().max(500).optional(), user_agent: z.string().max(500).optional(), viewport: z.string().max(40).optional() }).default({}),
    }),
    output: Summary,
    http: { method: "POST", path: "/feedback", status: 201 },
    handler: async (ctx, i) => {
      const me = ctx.actor.userId;
      const fileIds = await checkImages(ctx.db, me, i.file_ids);
      const id = newId();
      const [row] = await ctx.db
        .insert(feedback)
        .values({ id, authorId: me, createdBy: me, updatedBy: me, kind: i.kind, body: i.body, fileIds, context: i.context })
        .returning();
      ctx.audit({ type: "feedback", id, details: { kind: i.kind, files: fileIds.length } });
      const [who] = [...(await namesOf(ctx.db, [me])).values()];
      await notifyHandlers(ctx, row!, {
        title: `Feedback mới: ${KIND_LABEL[i.kind]}`,
        body: `${who?.full_name ?? "Một người"} gửi: ${excerpt(i.body)}`,
        source: stableId("feedback.new", id),
        onlyAnswered: false,
      });
      return summary(row!);
    },
  }),

  defineCommand({
    name: "feedback.withdraw",
    summary: "Rút lại góp ý của mình khi còn trạng thái Mới (xoá mềm).",
    permission: "feedback:feedback:write",
    aiAllowed: true,
    input: z.object({ id: Id, version: z.coerce.number().int().min(1) }),
    output: z.object({ id: Id, withdrawn: z.literal(true) }),
    http: { method: "DELETE", path: "/feedback/:id" },
    handler: async (ctx, i) => {
      const [row] = await ctx.db.select().from(feedback).where(and(ownedBy(feedback.authorId, ctx.actor.userId), eq(feedback.id, i.id), isNull(feedback.deletedAt))).limit(1);
      if (!row) throw new AppError("not_found", "Không tìm thấy góp ý của bạn.");
      if (row.status !== "new") throw new AppError("conflict", "Chỉ rút lại được góp ý còn trạng thái Mới.", { reason: "not_new", status: row.status });
      await softDelete(ctx.db, feedback, { id: i.id, expectedVersion: i.version, actor: actorRef(ctx.actor), historyTableId: "feedback", where: ownedBy(feedback.authorId, ctx.actor.userId) });
      ctx.audit({ type: "feedback", id: i.id });
      return { id: i.id, withdrawn: true as const };
    },
  }),

  defineQuery({
    name: "feedback.mine",
    summary: "Góp ý của tôi, mới nhất trước (phân trang keyset).",
    permission: "feedback:feedback:read",
    aiAllowed: true,
    list: true,
    input: z.object({ ...listParamsShape, kind: z.enum(FEEDBACK_KINDS).optional(), status: z.enum(FEEDBACK_STATUSES).optional() }),
    output: z.record(z.string(), z.unknown()),
    http: { method: "GET", path: "/feedback/mine" },
    handler: async (ctx, i): Promise<ListOutput> =>
      listPage(ctx.db, {
        from: listFrom,
        fields: listFields,
        baseWhere: sql`${ownedBy(sql`f.author_id`, ctx.actor.userId)} AND f.deleted_at IS NULL${i.kind ? sql` AND f.kind = ${i.kind}` : sql``}${i.status ? sql` AND f.status = ${i.status}` : sql``}`,
        filter: i.filter,
        sort: i.sort,
        defaultSort: NEWEST,
        select: i.fields,
        limit: i.limit,
        cursor: i.cursor,
        includeTotal: i.include_total,
      }),
  }),

  defineQuery({
    name: "feedback.list",
    summary: "Hộp feedback của người xử lý: lọc loại và trạng thái (mặc định Mới + Đang xem), mới nhất trước.",
    description: "`status`: một trạng thái, `open` (Mới + Đang xem, mặc định) hoặc `all`.",
    permission: MANAGE,
    aiAllowed: true,
    list: true,
    input: z.object({ ...listParamsShape, kind: z.enum(FEEDBACK_KINDS).optional(), status: z.enum([...FEEDBACK_STATUSES, "open", "all"]).default("open") }),
    output: z.record(z.string(), z.unknown()),
    http: { method: "GET", path: "/feedback" },
    handler: async (ctx, i): Promise<ListOutput> => {
      await requireManage(ctx);
      const st = i.status === "all" ? sql`` : i.status === "open" ? sql` AND f.status IN ('new', 'viewing')` : sql` AND f.status = ${i.status}`;
      return listPage(ctx.db, {
        from: listFrom,
        fields: listFields,
        baseWhere: sql`${systemScope()} AND f.deleted_at IS NULL${i.kind ? sql` AND f.kind = ${i.kind}` : sql``}${st}`,
        filter: i.filter,
        sort: i.sort,
        defaultSort: NEWEST,
        select: i.fields,
        limit: i.limit,
        cursor: i.cursor,
        includeTotal: i.include_total,
      });
    },
  }),

  defineQuery({
    name: "feedback.get",
    summary: "Chi tiết một góp ý: nội dung, ảnh, thông tin tự ghi, người gửi và luồng tin nhắn. Người gửi hoặc người xử lý.",
    description: "Ảnh tải bằng `feedback.file.url`. `can_manage`: người xem là người xử lý. `can_withdraw`: là người gửi và còn trạng thái Mới.",
    permission: "feedback:feedback:read",
    aiAllowed: true,
    input: z.object({ id: Id }),
    http: { method: "GET", path: "/feedback/:id" },
    handler: async (ctx, i) => {
      const { row, manage } = await loadVisible(ctx, i.id);
      const msgs = await ctx.db.select().from(feedbackMessages).where(and(systemScope(), eq(feedbackMessages.feedbackId, row.id))).orderBy(asc(feedbackMessages.createdAt), asc(feedbackMessages.id));
      const names = await namesOf(ctx.db, [row.authorId, ...msgs.map((m) => m.authorId)]);
      const [au] = (await ctx.db.execute(sql`SELECT roles FROM users WHERE id = ${row.authorId}::uuid`)).rows as { roles: string[] }[];
      return {
        ...summary(row),
        body: row.body,
        context: row.context,
        files: await filesOf(ctx.db, row.fileIds),
        author: { id: row.authorId, full_name: names.get(row.authorId)?.full_name ?? null, email: names.get(row.authorId)?.email ?? null, roles: au?.roles ?? [] },
        messages: msgs.map((m) => ({ id: m.id, author_id: m.authorId, author_name: names.get(m.authorId)?.full_name ?? null, from_author: m.authorId === row.authorId, body: m.body, created_at: iso(m.createdAt)! })),
        can_manage: manage,
        can_withdraw: row.authorId === ctx.actor.userId && row.status === "new",
      };
    },
  }),

  defineQuery({
    name: "feedback.file.url",
    summary: "Link tải có hạn một ảnh đính kèm của góp ý (người gửi hoặc người xử lý).",
    permission: "feedback:feedback:read",
    aiAllowed: true,
    audit: "always",
    input: z.object({ feedback_id: Id, file_id: Id }),
    output: z.object({ url: z.string(), expires_at: z.string() }),
    http: { method: "GET", path: "/feedback/:feedback_id/files/:file_id/download-url" },
    handler: async (ctx, i) => {
      const { row } = await loadVisible(ctx, i.feedback_id);
      if (!row.fileIds.includes(i.file_id)) throw new AppError("not_found", "Không tìm thấy file.");
      const r = await ctx.db.execute(sql`SELECT storage_key, filename, content_type FROM files WHERE /*scope:system*/ id = ${i.file_id}::uuid AND status = 'ready' AND deleted_at IS NULL`);
      const f = r.rows[0] as { storage_key: string; filename: string; content_type: string } | undefined;
      if (!f) throw new AppError("not_found", "File chưa sẵn sàng hoặc đã bị xoá.");
      const d = await storage.createDownloadUrl({ key: f.storage_key, filename: f.filename, contentType: f.content_type, ttlSeconds: cfg.DOWNLOAD_URL_TTL_SECONDS });
      ctx.audit({ type: "feedback", id: row.id, details: { file_id: i.file_id } });
      return { url: d.url, expires_at: d.expiresAt.toISOString() };
    },
  }),

  defineCommand({
    name: "feedback.message.create",
    summary: "Nhắn trong một góp ý (người gửi hoặc người xử lý). Chữ, tối đa 5.000 ký tự; không sửa, không xoá.",
    permission: "feedback:feedback:write",
    aiAllowed: true,
    input: z.object({ feedback_id: Id, body: BodyField }),
    output: z.object({ id: Id, feedback_id: Id, created_at: z.string() }),
    http: { method: "POST", path: "/feedback/:feedback_id/messages", status: 201 },
    handler: async (ctx, i) => {
      const { row, manage } = await loadVisible(ctx, i.feedback_id);
      const me = ctx.actor.userId;
      const id = newId();
      const [m] = await ctx.db.insert(feedbackMessages).values({ id, feedbackId: row.id, authorId: me, body: i.body }).returning();
      ctx.audit({ type: "feedback", id: row.id, details: { action: "message", message_id: id } });
      if (me === row.authorId) {
        await notifyHandlers(ctx, row, { title: "Người gửi nhắn lại trong feedback", body: `${excerpt(i.body)}`, source: stableId("feedback.message", id), onlyAnswered: true });
      } else if (manage) {
        await notifyAuthor(ctx, row, { title: "Góp ý của bạn có trả lời", body: excerpt(i.body), source: stableId("feedback.message", id) });
      }
      return { id, feedback_id: row.id, created_at: iso(m!.createdAt)! };
    },
  }),

  defineCommand({
    name: "feedback.status.set",
    summary: "Đổi trạng thái góp ý (người xử lý): Mới, Đang xem, Đã lên kế hoạch, Đã xong, Không làm. Đổi tự do, không ép thứ tự.",
    permission: MANAGE,
    aiAllowed: true,
    input: z.object({ id: Id, status: z.enum(FEEDBACK_STATUSES), version: z.coerce.number().int().min(1) }),
    output: Summary,
    http: { method: "PUT", path: "/feedback/:id/status" },
    handler: async (ctx, i) => {
      await requireManage(ctx);
      const { row } = await loadVisible(ctx, i.id);
      if (row.status === i.status) return summary(row);
      const upd = await versionedUpdate(ctx.db, feedback, { id: i.id, expectedVersion: i.version, set: { status: i.status }, actor: actorRef(ctx.actor), historyTableId: "feedback", where: systemScope() });
      ctx.audit({ type: "feedback", id: i.id, details: { from: row.status, to: i.status } });
      const next = upd as unknown as Row;
      await notifyAuthor(ctx, row, {
        title: "Góp ý của bạn đổi trạng thái",
        body: `Trạng thái: ${STATUS_LABEL[i.status]}.`,
        source: stableId("feedback.status", `${row.id}:${next.version}`),
      });
      return summary(next);
    },
  }),
];
