import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "@soe/shared";
import { AppError } from "@soe/shared";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { checkOnly, liveFilter, listMine, POST_STATES, readPost, saveDraft, submit, viewerOf } from "../publish/engine";
import { snippetHtml, tsQueryOf } from "../knowledge/search";
import { CLIENTS, GROUPS, skillKind, SkillFields, skillMd } from "./kind";
import type { SkillContent } from "./kind";
import { fileKind, packZip, unpackZip, ZIP_B64_MAX } from "./package";

const Id = z.uuid();
const k = skillKind;
const offsetOf = (cursor: string | undefined): number => {
  const n = cursor ? Number(cursor) : 0;
  if (!Number.isInteger(n) || n < 0) throw new AppError("invalid_filter", "Con trỏ phân trang không hợp lệ.");
  return n;
};
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);

/** The fields an author sends; a zip (web, API) is unpacked here into `files`. */
async function fieldsOf(i: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { id: _id, post_version: _pv, check_only: _co, zip_base64, ...fields } = i;
  if (typeof zip_base64 === "string") {
    if (fields.files !== undefined) throw new AppError("validation_error", "Gửi file zip hoặc danh sách file, không gửi cả hai.", { issues: [{ path: "files", message: "zip_and_files" }] });
    fields.files = await unpackZip(zip_base64);
  }
  return fields;
}
const InputFields = { ...SkillFields, zip_base64: z.string().max(ZIP_B64_MAX).optional() };
const SaveInput = z.strictObject({ id: Id.optional(), post_version: z.number().int().min(1).optional(), ...InputFields });

const card = (x: Raw) => ({
  id: x.id, name: x.live_title, description: x.live_summary, tags: x.live_tags, group: x.live_facets?.group ?? null, clients: x.live_facets?.clients ?? [], version: x.live_facets?.version ?? null,
  author: { id: x.author_id, name: x.author_name }, published_at: iso(x.first_published_at), updated_at: iso(x.live_at), view_count: x.view_count, download_count: x.download_count,
});

async function searchSkills(ctx: HandlerCtx<Actor>, i: { q?: string; group?: string; client?: string; tag?: string; author_id?: string; sort: string; limit: number; offset: number }) {
  const v = await viewerOf(ctx);
  const q = (i.q ?? "").trim();
  const tsq = tsQueryOf(q);
  const where = [liveFilter(v, k)];
  if (q) {
    const nq = sql`soe_unaccent(lower(${q}))`;
    where.push(tsq ? sql`(p.tsv @@ to_tsquery('soe_simple'::regconfig, ${tsq}) OR ${nq} <% soe_unaccent(lower(p.live_title)))` : sql`false`);
  }
  if (i.group) where.push(sql`p.live_facets->>'group' = ${i.group}`);
  if (i.client) where.push(sql`p.live_facets->'clients' @> ${JSON.stringify([i.client])}::jsonb`);
  if (i.tag) where.push(sql`${i.tag.trim().toLowerCase()} = ANY(p.live_tags)`);
  if (i.author_id) where.push(sql`p.author_id = ${i.author_id}::uuid`);
  const score = tsq ? sql`(ts_rank_cd(COALESCE(p.tsv, ''::tsvector), to_tsquery('soe_simple'::regconfig, ${tsq})) + 0.5 * word_similarity(soe_unaccent(lower(${q})), soe_unaccent(lower(p.live_title))))` : sql`0`;
  const order = q && i.sort === "relevance" ? sql`score DESC, p.live_at DESC, p.id` : i.sort === "downloads" ? sql`p.download_count DESC, p.live_at DESC, p.id` : sql`p.live_at DESC, p.id`;
  const head = tsq ? sql`ts_headline('soe_simple'::regconfig, COALESCE(p.live_text, ''), to_tsquery('soe_simple'::regconfig, ${tsq}), 'StartSel=⟦, StopSel=⟧, MaxFragments=1, MaxWords=30, MinWords=12, ShortWord=2')` : sql`NULL`;
  const r = await ctx.db.execute(sql`SELECT p.id, p.author_id, p.live_title, p.live_summary, p.live_tags, p.live_facets, p.live_at, p.first_published_at, p.view_count, p.download_count, u.full_name AS author_name, ${score} AS score, ${head} AS headline
    FROM posts p JOIN users u ON u.id = p.author_id WHERE /*scope:system*/ ${sql.join(where, sql` AND `)} ORDER BY ${order} LIMIT ${i.limit + 1} OFFSET ${i.offset}`);
  const rows = r.rows as Raw[];
  return { items: rows.slice(0, i.limit).map((x) => ({ ...card(x), ...(x.headline ? { snippet: snippetHtml(String(x.headline)) } : {}) })), next: rows.length > i.limit ? i.offset + i.limit : null };
}

const installFor = (name: string) => ({
  claude_code: `mkdir -p ~/.claude/skills/${name} && unzip -o ${name}.zip -d ~/.claude/skills/${name}`,
  claude_code_path: `~/.claude/skills/${name}/`,
  claude_desktop: "Tải file zip, vào Cài đặt > Skills (Capabilities), chọn tải skill lên và chọn file zip.",
  claude_ai: "Tải file zip, vào Settings > Capabilities > Skills, tải skill lên bằng file zip.",
});

/** Module 8 (Stage 8B): AI Hub skills on the post engine. Rules of a skill: `kind.ts`; zip and header handling: `package.ts`. */
export const aihubOperations = [
  defineCommand({
    name: "skill.package.save",
    summary: "Tạo skill AI Hub (nháp) hoặc sửa nháp của chính mình. Gửi zip (zip_base64) hoặc danh sách file {path, content, encoding?}; gửi files là gửi cả gói. name và description lấy từ đầu YAML của SKILL.md.",
    description: "Ảnh gửi dạng base64. Tối đa 5 MB, 50 file; đường dẫn tương đối, không có \"..\". Trả về kết quả kiểm tra tự động (errors, warnings).",
    permission: "aihub:skill:post",
    aiAllowed: true,
    input: SaveInput,
    http: { method: "POST", path: "/aihub/skills" },
    handler: async (ctx, i) => saveDraft(ctx, k, { postId: i.id, expectedVersion: i.post_version, input: await fieldsOf(i) }),
  }),
  defineCommand({
    name: "skill.package.submit",
    summary: "Gửi skill chờ duyệt (kiểm tra tự động chạy trước). Kèm gói thì lưu nháp rồi gửi; check_only chỉ kiểm tra, không lưu gì.",
    description: "Lỗi thì không gửi và không lưu, trả errors [{code,message,path,hint}] kèm warnings. Cảnh báo không chặn, đi kèm tới người duyệt.",
    permission: "aihub:skill:post",
    aiAllowed: true,
    input: z.strictObject({ id: Id.optional(), post_version: z.number().int().min(1).optional(), check_only: z.boolean().default(false), ...InputFields }),
    http: { method: "POST", path: "/aihub/skills/submit" },
    handler: async (ctx, i) => {
      const fields = await fieldsOf(i);
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
    name: "skill.package.get",
    summary: "Đọc một skill: thông tin, cây file, nội dung SKILL.md, lệnh cài. include_files=true trả toàn bộ file (để AI tự cài); path trả một file. Đọc bản đang xuất bản tính một lượt xem.",
    permission: "aihub:skill:read",
    aiAllowed: true,
    input: z.object({ id: Id, version: z.coerce.number().int().min(1).optional(), source: z.enum(["live", "working"]).optional(), include_files: z.coerce.boolean().default(false), path: z.string().max(300).optional() }),
    http: { method: "GET", path: "/aihub/skills/:id" },
    handler: async (ctx, i) => {
      const d = await readPost(ctx, k, i.id, { version: i.version, source: i.source });
      const c = d.content as unknown as SkillContent;
      const { content: _c, markdown: _m, ...head } = d;
      const out: Raw = {
        ...head, name: c.name, description: c.description, group: c.group, tags: c.tags, clients: c.clients, package_version: c.version, change_note: c.change_note, replaces: c.replaces,
        tree: c.files.map((f) => ({ path: f.path, size: f.size, type: fileKind(f.path) })), skill_md: skillMd(c)?.content ?? null, install: installFor(c.name || "skill"),
      };
      const dl = await ctx.db.execute(sql`SELECT download_count FROM posts WHERE /*scope:system*/ id = ${i.id}::uuid`);
      out.download_count = Number((dl.rows[0] as Raw | undefined)?.download_count ?? 0);
      if (i.path !== undefined) {
        const f = c.files.find((x) => x.path === i.path);
        if (!f) throw new AppError("not_found", "Không có file này trong gói.");
        out.file = { path: f.path, encoding: f.encoding, content: f.content, size: f.size };
      }
      if (i.include_files) out.files = c.files.map((f) => ({ path: f.path, encoding: f.encoding, content: f.content }));
      return out;
    },
  }),
  defineQuery({
    name: "skill.package.mine",
    summary: "Skill của tôi, kèm trạng thái bản đang sửa (nháp, chờ duyệt, bị trả lại kèm lý do). Lọc theo trạng thái.",
    permission: "aihub:skill:read",
    aiAllowed: true,
    list: true,
    input: z.object({ state: z.enum(POST_STATES).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(20).optional() }),
    http: { method: "GET", path: "/aihub/mine" },
    handler: async (ctx, i) => {
      const r = await listMine(ctx, k, { state: i.state, limit: i.limit, offset: offsetOf(i.cursor) });
      return { items: r.items, nextCursor: r.next === null ? null : String(r.next) };
    },
  }),
  defineQuery({
    name: "skill.package.search",
    summary: "Tìm và lọc skill đã xuất bản: tìm toàn văn trên tên, mô tả, thẻ, SKILL.md (không dấu); lọc nhóm, client, thẻ, tác giả; sắp theo độ khớp, mới nhất, lượt tải.",
    description: "Không có q thì là danh sách. Kết quả có snippet (HTML đã thoát, từ khoá trong <b>).",
    permission: "aihub:skill:read",
    aiAllowed: true,
    list: true,
    input: z.object({
      q: z.string().max(200).optional(),
      group: z.enum(GROUPS).optional(),
      client: z.enum(CLIENTS).optional(),
      tag: z.string().max(60).optional(),
      author_id: Id.optional(),
      sort: z.enum(["relevance", "newest", "downloads"]).default("relevance"),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().max(20).optional(),
    }),
    http: { method: "GET", path: "/aihub/search" },
    handler: async (ctx, i) => {
      const r = await searchSkills(ctx, { ...i, offset: offsetOf(i.cursor) });
      return { items: r.items, nextCursor: r.next === null ? null : String(r.next) };
    },
  }),
  defineCommand({
    name: "skill.package.download",
    summary: "Tải gói skill (bản đang xuất bản) dạng zip, trả base64, tăng lượt tải. Giải nén vào ~/.claude/skills/<name>/ để cài cho Claude Code.",
    permission: "aihub:skill:read",
    aiAllowed: false,
    audit: "always",
    input: z.object({ id: Id }),
    http: { method: "POST", path: "/aihub/skills/:id/download" },
    handler: async (ctx, i) => {
      const d = await readPost(ctx, k, i.id, { source: "live" });
      if (d.version_status !== "published") throw new AppError("not_found", "Skill chưa xuất bản.");
      const c = d.content as unknown as SkillContent;
      const zip = await packZip(c.files);
      await ctx.db.execute(sql`UPDATE posts SET download_count = download_count + 1 WHERE /*scope:system*/ id = ${i.id}::uuid`);
      return { filename: `${c.name}.zip`, content_type: "application/zip", size_bytes: zip.length, content_base64: zip.toString("base64"), install: installFor(c.name) };
    },
  }),
];
