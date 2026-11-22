import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@soe/shared";
import { BODY_MAX_BYTES, extractText, fromMarkdown, isDoc, toMarkdown } from "../publish/tiptap";
import { findSecrets, hasEmail, hasPhone } from "../publish/secrets";
import { registerKind } from "../publish/kinds";
import type { CheckResult, PostIssue, PostKind } from "../publish/types";

export const CATEGORIES = ["base_app", "business"] as const;
export const ARTICLE_TYPES = ["guide", "use_case"] as const;
export const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = { base_app: "Ứng dụng Base", business: "Nghiệp vụ" };
export const TYPE_LABEL: Record<(typeof ARTICLE_TYPES)[number], string> = { guide: "Hướng dẫn", use_case: "Use case" };
export const TITLE_MAX = 150;
export const SUMMARY_MAX = 300;
export const BODY_MIN_CHARS = 200;
export const MAX_FILES = 10;
export const SIMILAR_TITLE = 0.6;

/** Stored content of an article (design module8 3.1). A draft may be incomplete: the rules in `check` decide when it may be sent. */
export interface ArticleContent {
  title: string;
  summary: string;
  /** Tiptap document. */
  body: Record<string, unknown> | null;
  category: (typeof CATEGORIES)[number] | null;
  type: (typeof ARTICLE_TYPES)[number] | null;
  tags: string[];
  for_sale: boolean;
  file_ids: string[];
}

/** The fields an author sends. Every one is optional: a patch over the current content. `body` is a Tiptap document or Markdown text. */
export const ArticleFields = {
  title: z.string().max(1000).optional(),
  summary: z.string().max(3000).optional(),
  body: z.union([z.string().max(BODY_MAX_BYTES), z.record(z.string(), z.unknown())]).nullable().optional(),
  category: z.enum(CATEGORIES).nullable().optional(),
  type: z.enum(ARTICLE_TYPES).nullable().optional(),
  tags: z.array(z.string().max(60)).max(10).optional(),
  for_sale: z.boolean().optional(),
  file_ids: z.array(z.uuid()).max(MAX_FILES).optional(),
};
const Patch = z.strictObject(ArticleFields);

const empty = (): ArticleContent => ({ title: "", summary: "", body: null, category: null, type: null, tags: [], for_sale: false, file_ids: [] });

export function normTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const t of tags) {
    const n = t.trim().replace(/\s+/g, " ").toLowerCase();
    if (n) seen.add(n.slice(0, 30));
  }
  return [...seen];
}

function parse(input: unknown, current: ArticleContent | null): ArticleContent {
  const r = Patch.safeParse(input ?? {});
  if (!r.success) throw new AppError("validation_error", "Nội dung bài không hợp lệ.", { issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const p = r.data;
  const out = { ...(current ?? empty()) };
  if (p.title !== undefined) out.title = p.title.trim();
  if (p.summary !== undefined) out.summary = p.summary.trim();
  if (p.body !== undefined) {
    if (p.body === null) out.body = null;
    else if (typeof p.body === "string") out.body = fromMarkdown(p.body) as Record<string, unknown>;
    else if (isDoc(p.body) && JSON.stringify(p.body).length <= BODY_MAX_BYTES) out.body = p.body as Record<string, unknown>;
    else throw new AppError("validation_error", "Nội dung phải là văn bản Markdown hoặc tài liệu Tiptap {type:\"doc\", content:[...]} không quá 500 KB.", { issues: [{ path: "body", message: "invalid_body" }] });
  }
  if (p.category !== undefined) out.category = p.category;
  if (p.type !== undefined) out.type = p.type;
  if (p.tags !== undefined) out.tags = normTags(p.tags);
  if (p.for_sale !== undefined) out.for_sale = p.for_sale;
  if (p.file_ids !== undefined) out.file_ids = [...new Set(p.file_ids)];
  return out;
}

const issue = (code: string, path: string, message: string, hint: string, extra: Record<string, unknown> = {}): PostIssue => ({ code, message, path, hint, ...extra });

async function check(ctx: Parameters<PostKind<ArticleContent>["check"]>[0], c: ArticleContent): Promise<CheckResult> {
  const errors: PostIssue[] = [];
  const warnings: PostIssue[] = [];
  const text = extractText(c.body);
  if (!c.title) errors.push(issue("title_required", "title", "Thiếu tiêu đề.", "Viết tiêu đề ngắn, nêu rõ bài nói về gì (tối đa 150 ký tự)."));
  else if (c.title.length > TITLE_MAX) errors.push(issue("title_too_long", "title", `Tiêu đề dài ${c.title.length} ký tự, tối đa ${TITLE_MAX}.`, "Rút gọn tiêu đề."));
  if (!c.summary) errors.push(issue("summary_required", "summary", "Thiếu tóm tắt.", "Viết 1-2 câu tóm tắt (tối đa 300 ký tự), hiện ở thẻ bài và kết quả tìm."));
  else if (c.summary.length > SUMMARY_MAX) errors.push(issue("summary_too_long", "summary", `Tóm tắt dài ${c.summary.length} ký tự, tối đa ${SUMMARY_MAX}.`, "Rút gọn tóm tắt."));
  if (!c.category) errors.push(issue("category_required", "category", "Chưa chọn danh mục.", `Chọn một trong: ${CATEGORIES.join(", ")}.`));
  if (!c.type) errors.push(issue("type_required", "type", "Chưa chọn loại bài.", `Chọn một trong: ${ARTICLE_TYPES.join(", ")}.`));
  const chars = text.replace(/\s/g, "").length;
  if (chars < BODY_MIN_CHARS) errors.push(issue("body_too_short", "body", `Nội dung mới có ${chars} ký tự chữ, cần tối thiểu ${BODY_MIN_CHARS}.`, "Viết đầy đủ hơn: bối cảnh, các bước, ví dụ."));
  for (const [path, value] of [["title", c.title], ["summary", c.summary], ["body", text]] as const) {
    const found = findSecrets(value);
    if (found.length) errors.push(issue("secret_found", path, `Có chuỗi giống key/token/khoá riêng (${found.join(", ")}).`, "Xoá chuỗi đó khỏi bài, thay bằng chỗ giữ chỗ như <API_KEY>. Nếu là key thật, đổi key ngay.", { kinds: found }));
  }
  if (c.file_ids.length) {
    const r = await ctx.db.execute(sql`SELECT id FROM files WHERE /*scope:system*/ id = ANY(${`{${c.file_ids.join(",")}}`}::uuid[]) AND owner_id = ${ctx.authorId}::uuid AND status = 'ready' AND deleted_at IS NULL`);
    const ok = new Set((r.rows as { id: string }[]).map((x) => x.id));
    for (const f of c.file_ids) if (!ok.has(f)) errors.push(issue("attachment_invalid", "file_ids", `File ${f} không có, chưa tải xong hoặc không phải của tác giả.`, "Tải file lên bằng file.upload.init rồi đính lại.", { file_id: f }));
  }
  if (c.title) {
    const r = await ctx.db.execute(sql`SELECT id, live_title, similarity(soe_unaccent(lower(live_title)), soe_unaccent(lower(${c.title}))) AS sim FROM posts
      WHERE /*scope:system*/ kind = 'article' AND status = 'published' AND archived_at IS NULL AND deleted_at IS NULL ${ctx.postId ? sql`AND id <> ${ctx.postId}::uuid` : sql``}
        AND similarity(soe_unaccent(lower(live_title)), soe_unaccent(lower(${c.title}))) >= ${SIMILAR_TITLE} ORDER BY sim DESC LIMIT 3`);
    const similar = (r.rows as { id: string; live_title: string; sim: number }[]).map((x) => ({ id: x.id, title: x.live_title, similarity: Math.round(Number(x.sim) * 100) / 100 }));
    if (similar.length) warnings.push(issue("similar_title", "title", `Tiêu đề gần giống bài đã xuất bản: "${similar[0]!.title}".`, "Xem bài đó trước: nếu cùng nội dung thì sửa bài cũ thay vì đăng mới, nếu khác thì đổi tiêu đề cho rõ.", { similar }));
  }
  if (c.for_sale) {
    const all = [c.title, c.summary, text].join("\n");
    if (hasEmail(all) || hasPhone(all)) warnings.push(issue("for_sale_contact_info", "body", "Bài mở cho sale nhưng có email hoặc số điện thoại.", "Bỏ thông tin liên hệ cá nhân, hoặc tắt \"Cho sale\"."));
  }
  return { errors, warnings };
}

const article: PostKind<ArticleContent> = {
  kind: "article",
  menu: "knowledge",
  label: "bài Knowledge",
  perms: { read: "knowledge:article:read", post: "knowledge:article:post", review: "knowledge:article:review" },
  guestFacet: "for_sale",
  parse,
  summarize: (c) => ({ title: c.title, summary: c.summary, tags: c.tags, text: extractText(c.body), facets: { category: c.category, type: c.type, for_sale: c.for_sale } }),
  check,
  webPath: (id) => `/knowledge/${id}`,
  markdown: (c) => {
    const meta = [c.category ? CATEGORY_LABEL[c.category] : null, c.type ? TYPE_LABEL[c.type] : null, c.tags.length ? `thẻ: ${c.tags.join(", ")}` : null].filter(Boolean).join(" · ");
    return [`# ${c.title}`, meta ? `_${meta}_` : "", c.summary ? `> ${c.summary}` : "", toMarkdown(c.body)].filter(Boolean).join("\n\n");
  },
  fileIds: (c) => c.file_ids ?? [],
};

registerKind(article);
/** The kind as the engine sees it (content as a plain record). */
export const articleKind = article as unknown as PostKind;
