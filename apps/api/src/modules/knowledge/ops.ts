import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@soe/shared";
import { defineCommand, defineQuery } from "../../core/registry";
import { checkOnly, listMine, loadPost, POST_STATES, readPost, saveDraft, submit } from "../publish/engine";
import { articleKind, ArticleFields, ARTICLE_TYPES, CATEGORIES } from "./kind";
import { noteOpened } from "../home/recent";
import { relatedArticles, searchArticles, suggestTags } from "./search";

const Id = z.uuid();
const offsetOf = (cursor: string | undefined): number => {
  const n = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(n) || n < 0) throw new AppError("invalid_filter", "Con trỏ phân trang không hợp lệ.");
  return n;
};
const k = articleKind;
const fieldsOf = (i: Record<string, unknown>) => {
  const { id: _id, post_version: _pv, check_only: _co, ...fields } = i;
  return fields;
};
const SaveInput = z.strictObject({ id: Id.optional(), post_version: z.number().int().min(1).optional(), ...ArticleFields });

/** Module 8 (Stage 8A): Knowledge articles on the post engine (`modules/publish`). Rules of an article: `kind.ts`; search: `search.ts`. */
export const knowledgeOperations = [
  defineCommand({
    name: "knowledge.article.save",
    summary: "Tạo bài Knowledge (nháp) hoặc sửa nháp của chính mình. Chỉ gửi những trường cần đổi. Sửa bài đã xuất bản tạo bản sửa, bản đang xuất bản vẫn hiện.",
    description: "body là Markdown hoặc tài liệu Tiptap. Trả về kết quả kiểm tra tự động (errors, warnings) của bản vừa lưu.",
    permission: "knowledge:article:post",
    aiAllowed: true,
    input: SaveInput,
    http: { method: "POST", path: "/knowledge/articles" },
    handler: async (ctx, i) => saveDraft(ctx, k, { postId: i.id, expectedVersion: i.post_version, input: fieldsOf(i) }),
  }),
  defineCommand({
    name: "knowledge.article.submit",
    summary: "Gửi bài Knowledge chờ duyệt (kiểm tra tự động chạy trước). Kèm nội dung thì lưu nháp rồi gửi; check_only chỉ kiểm tra, không lưu gì.",
    description: "Lỗi thì không gửi và không lưu, trả errors [{code,message,path,hint}] kèm warnings. Cảnh báo không chặn, đi kèm bài tới người duyệt. Người có quyền duyệt Knowledge đăng bài của mình thì xuất bản ngay.",
    permission: "knowledge:article:post",
    aiAllowed: true,
    input: z.strictObject({ id: Id.optional(), post_version: z.number().int().min(1).optional(), check_only: z.boolean().default(false), ...ArticleFields }),
    http: { method: "POST", path: "/knowledge/articles/submit" },
    handler: async (ctx, i) => {
      const fields = fieldsOf(i);
      if (i.check_only) {
        const c = await checkOnly(ctx, k, { postId: i.id, input: fields });
        return { check_only: true, ok: c.errors.length === 0, errors: c.errors, warnings: c.warnings };
      }
      let id = i.id;
      if (Object.keys(fields).length || !id) id = (await saveDraft(ctx, k, { postId: id, expectedVersion: i.post_version, input: fields })).post_id;
      return submit(ctx, k, id!);
    },
  }),
  defineQuery({
    name: "knowledge.article.get",
    summary: "Đọc một bài Knowledge (bản đang xuất bản; tác giả đọc được bản đang sửa bằng source=working). Đọc bản đang xuất bản tính một lượt xem.",
    permission: "knowledge:article:read",
    aiAllowed: true,
    input: z.object({ id: Id, version: z.coerce.number().int().min(1).optional(), source: z.enum(["live", "working"]).optional() }),
    http: { method: "GET", path: "/knowledge/articles/:id" },
    handler: async (ctx, i) => {
      const d = await readPost(ctx, k, i.id, { version: i.version, source: i.source });
      await noteOpened(ctx, "article", i.id);
      const ids = articleKind.fileIds(d.content);
      const files = ids.length
        ? ((await ctx.db.execute(sql`SELECT id, filename, content_type, size_bytes FROM files WHERE /*scope:system*/ id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND status = 'ready' AND deleted_at IS NULL`)).rows as Record<string, unknown>[])
        : [];
      return { ...d, attachments: files.map((f) => ({ id: f.id, filename: f.filename, content_type: f.content_type, size_bytes: Number(f.size_bytes) })) };
    },
  }),
  defineQuery({
    name: "knowledge.article.mine",
    summary: "Bài Knowledge của tôi, kèm trạng thái bản đang sửa (nháp, chờ duyệt, bị trả lại kèm lý do). Lọc theo trạng thái.",
    permission: "knowledge:article:read",
    aiAllowed: true,
    list: true,
    input: z.object({ state: z.enum(POST_STATES).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(20).optional() }),
    http: { method: "GET", path: "/knowledge/mine" },
    handler: async (ctx, i) => {
      const r = await listMine(ctx, k, { state: i.state, limit: i.limit, offset: offsetOf(i.cursor) });
      return { items: r.items, nextCursor: r.next === null ? null : String(r.next) };
    },
  }),
  defineQuery({
    name: "knowledge.article.search",
    summary: "Tìm và lọc bài Knowledge đã xuất bản: tìm toàn văn (không dấu, sai chính tả nhẹ vẫn ra), lọc danh mục, loại, thẻ, tác giả, cho sale; sắp theo độ khớp, mới nhất, xem nhiều.",
    description: "Không có q thì là danh sách. Kết quả có snippet (HTML đã thoát, từ khoá trong <b>).",
    permission: "knowledge:article:read",
    aiAllowed: true,
    list: true,
    input: z.object({
      q: z.string().max(200).optional(),
      category: z.enum(CATEGORIES).optional(),
      type: z.enum(ARTICLE_TYPES).optional(),
      tag: z.string().max(60).optional(),
      author_id: Id.optional(),
      for_sale: z.coerce.boolean().optional(),
      sort: z.enum(["relevance", "newest", "views"]).default("relevance"),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().max(20).optional(),
    }),
    http: { method: "GET", path: "/knowledge/search" },
    handler: async (ctx, i) => {
      const r = await searchArticles(ctx, { ...i, offset: offsetOf(i.cursor) });
      return { items: r.items, nextCursor: r.next === null ? null : String(r.next) };
    },
  }),
  defineQuery({
    name: "knowledge.tag.suggest",
    summary: "Gợi ý thẻ đã có trong các bài đã xuất bản, theo ký tự đang gõ.",
    permission: "knowledge:article:read",
    aiAllowed: true,
    input: z.object({ q: z.string().max(30).optional(), limit: z.coerce.number().int().min(1).max(50).default(15) }),
    http: { method: "GET", path: "/knowledge/tags" },
    handler: async (ctx, i) => ({ items: await suggestTags(ctx, i.q, i.limit) }),
  }),
  defineQuery({
    name: "knowledge.article.related",
    summary: "Bài liên quan (cùng thẻ, cùng danh mục) của một bài đã xuất bản.",
    permission: "knowledge:article:read",
    aiAllowed: true,
    input: z.object({ id: Id, limit: z.coerce.number().int().min(1).max(20).default(5) }),
    http: { method: "GET", path: "/knowledge/articles/:id/related" },
    handler: async (ctx, i) => {
      await loadPost(ctx.db, i.id);
      return { items: await relatedArticles(ctx, i.id, i.limit) };
    },
  }),
];
