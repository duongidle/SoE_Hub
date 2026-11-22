import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@soe/shared";
import { findSecrets, hasEmail } from "../publish/secrets";
import { registerKind } from "../publish/kinds";
import type { CheckResult, PostIssue, PostKind } from "../publish/types";
import { normTags } from "../knowledge/kind";
import { cleanPath, fileKind, frontmatter, isForbiddenName, normFiles, PERSONAL_PATH_RE, referencedPaths, type SkillFile } from "./package";

export const GROUPS = ["sales", "data", "docs", "dev", "other"] as const;
export const GROUP_LABEL: Record<(typeof GROUPS)[number], string> = { sales: "Sales", data: "Data", docs: "Tài liệu", dev: "Lập trình", other: "Khác" };
export const CLIENTS = ["claude_code", "claude_desktop", "claude_ai", "other"] as const;
export const SIMILAR = 0.6;
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Stored content of a skill version (design module8 4.1). `name` and `description` are read from the YAML header of SKILL.md. */
export interface SkillContent {
  files: SkillFile[];
  name: string;
  description: string;
  group: (typeof GROUPS)[number] | null;
  tags: string[];
  clients: (typeof CLIENTS)[number][];
  version: string;
  change_note: string;
  /** Post id of the published skill this one replaces (a new version of "skill X" made as its own post). */
  replaces: string | null;
}

export const SkillFields = {
  files: z.array(z.strictObject({ path: z.string().max(300), content: z.string(), encoding: z.enum(["utf8", "base64"]).optional() })).max(200).optional(),
  group: z.enum(GROUPS).nullable().optional(),
  tags: z.array(z.string().max(60)).max(10).optional(),
  clients: z.array(z.enum(CLIENTS)).max(4).optional(),
  version: z.string().max(30).optional(),
  change_note: z.string().max(2000).optional(),
  replaces: z.uuid().nullable().optional(),
};
const Patch = z.strictObject(SkillFields);

const empty = (): SkillContent => ({ files: [], name: "", description: "", group: null, tags: [], clients: [], version: "1.0.0", change_note: "", replaces: null });
export const skillMd = (c: Pick<SkillContent, "files">): SkillFile | undefined => c.files.find((f) => f.path === "SKILL.md");

function parse(input: unknown, current: SkillContent | null): SkillContent {
  const r = Patch.safeParse(input ?? {});
  if (!r.success) throw new AppError("validation_error", "Gói skill không hợp lệ.", { issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  const p = r.data;
  const out: SkillContent = { ...(current ?? empty()) };
  if (p.files !== undefined) out.files = normFiles(p.files);
  if (p.group !== undefined) out.group = p.group;
  if (p.tags !== undefined) out.tags = normTags(p.tags);
  if (p.clients !== undefined) out.clients = [...new Set(p.clients)];
  if (p.version !== undefined) out.version = p.version.trim();
  if (p.change_note !== undefined) out.change_note = p.change_note.trim();
  if (p.replaces !== undefined) out.replaces = p.replaces;
  const md = skillMd(out);
  const fm = md && md.encoding === "utf8" ? frontmatter(md.content) : null;
  out.name = fm?.ok ? fm.name.trim() : "";
  out.description = fm?.ok ? fm.description.trim() : "";
  return out;
}

const issue = (code: string, path: string, message: string, hint: string, extra: Record<string, unknown> = {}): PostIssue => ({ code, message, path, hint, ...extra });

async function check(ctx: Parameters<PostKind<SkillContent>["check"]>[0], c: SkillContent): Promise<CheckResult> {
  const errors: PostIssue[] = [];
  const warnings: PostIssue[] = [];
  const md = skillMd(c);
  const paths = new Set(c.files.map((f) => f.path));
  if (!c.files.length) errors.push(issue("files_required", "files", "Gói chưa có file nào.", "Gửi các file của skill, trong đó có SKILL.md ở gốc."));
  if (!md) {
    if (c.files.length) errors.push(issue("skill_md_missing", "SKILL.md", "Thiếu SKILL.md ở gốc gói.", "Thêm file SKILL.md ở gốc, đầu file có YAML với name và description."));
  } else {
    const fm = frontmatter(md.content);
    if (!fm.ok) errors.push(issue("frontmatter_invalid", "SKILL.md", fm.error ?? "Đầu YAML không hợp lệ.", "Đầu SKILL.md dạng: ---\\nname: ten-skill\\ndescription: Mô tả khi nào dùng\\n---"));
    else {
      if (!/^[a-z0-9-]{1,64}$/.test(c.name)) errors.push(issue("name_invalid", "SKILL.md#name", `name "${c.name.slice(0, 70)}" không hợp lệ.`, "Chỉ chữ thường, số, gạch ngang; 1-64 ký tự."));
      if (c.description.length < 20 || c.description.length > 1024) errors.push(issue("description_length", "SKILL.md#description", `description dài ${c.description.length} ký tự, cần 20-1024.`, "Mô tả skill làm gì và dùng khi nào."));
      else if (!/\b(khi|dùng khi|when|use when)\b/i.test(c.description)) warnings.push(issue("description_no_trigger", "SKILL.md#description", "description chưa nói khi nào nên dùng skill.", "Thêm câu như \"Dùng khi ...\" để AI biết lúc nào gọi skill."));
      for (const ref of referencedPaths(fm.body)) {
        let p: string;
        try {
          p = cleanPath(ref, "SKILL.md");
        } catch {
          errors.push(issue("reference_missing", "SKILL.md", `SKILL.md nhắc tới "${ref}" nhưng đường dẫn không hợp lệ.`, "Dùng đường dẫn tương đối trong gói.", { ref }));
          continue;
        }
        if (!paths.has(p)) errors.push(issue("reference_missing", "SKILL.md", `SKILL.md nhắc tới "${p}" nhưng gói không có file này.`, "Thêm file vào gói hoặc sửa đường dẫn.", { ref: p }));
      }
      if (md.content.split("\n").length > 500) warnings.push(issue("skill_md_long", "SKILL.md", "SKILL.md dài hơn 500 dòng.", "Tách phần chi tiết sang references/ và chỉ dẫn tới đó."));
    }
  }
  if (!c.group) errors.push(issue("group_required", "group", "Chưa chọn nhóm.", `Chọn một trong: ${GROUPS.join(", ")}.`));
  if (!SEMVER.test(c.version)) errors.push(issue("version_invalid", "version", `Phiên bản "${c.version.slice(0, 20)}" không đúng dạng 1.0.0.`, "Dùng dạng số.số.số, ví dụ 1.0.0."));
  let emailAt: string | null = null;
  for (const f of c.files) {
    if (isForbiddenName(f.path)) errors.push(issue("forbidden_file", f.path, `File ${f.path} thường chứa bí mật (.env, .pem, id_rsa).`, "Xoá file khỏi gói."));
    const kind = fileKind(f.path);
    if (kind === "other") errors.push(issue("file_type_not_allowed", f.path, `Không nhận loại file của ${f.path}.`, "Chỉ nhận file chữ (.md, .txt, .py, .js, .ts, .sh, .json, .yaml, .csv...) và ảnh."));
    if (kind !== "text" || f.encoding !== "utf8") continue;
    const found = findSecrets(f.content);
    if (found.length) errors.push(issue("secret_found", f.path, `Có chuỗi giống key/token/khoá riêng (${found.join(", ")}) trong ${f.path}.`, "Xoá chuỗi đó, thay bằng chỗ giữ chỗ như <API_KEY>. Nếu là key thật, đổi key ngay.", { kinds: found }));
    const pm = PERSONAL_PATH_RE.exec(f.content);
    if (pm) warnings.push(issue("personal_path", f.path, `${f.path} có đường dẫn máy cá nhân ("${pm[0].slice(0, 40)}").`, "Đổi thành đường dẫn chung hoặc biến, ví dụ <thư-mục-làm-việc>."));
    if (!emailAt && hasEmail(f.content)) emailAt = f.path;
  }
  if (emailAt) warnings.push(issue("contains_email", emailAt, `${emailAt} có địa chỉ email.`, "Bỏ thông tin cá nhân nếu không cần."));
  if (c.replaces) {
    const r = await ctx.db.execute(sql`SELECT live_title FROM posts WHERE /*scope:system*/ id = ${c.replaces}::uuid AND kind = 'skill' AND status = 'published' AND archived_at IS NULL AND deleted_at IS NULL AND id <> ${ctx.postId ?? "00000000-0000-0000-0000-000000000000"}::uuid`);
    if (!r.rows.length) errors.push(issue("replaces_invalid", "replaces", "Skill được đánh dấu thay thế không có hoặc chưa xuất bản.", "Bỏ đánh dấu, hoặc chọn một skill đang xuất bản."));
  }
  if (c.name) {
    const r = await ctx.db.execute(sql`SELECT id, live_title, live_summary,
        GREATEST(similarity(soe_unaccent(lower(live_title)), soe_unaccent(lower(${c.name}))), similarity(soe_unaccent(lower(live_summary)), soe_unaccent(lower(${c.description})))) AS sim
      FROM posts WHERE /*scope:system*/ kind = 'skill' AND status = 'published' AND archived_at IS NULL AND deleted_at IS NULL
        ${ctx.postId ? sql`AND id <> ${ctx.postId}::uuid` : sql``} ${c.replaces ? sql`AND id <> ${c.replaces}::uuid` : sql``}
        AND (live_title = ${c.name} OR similarity(soe_unaccent(lower(live_title)), soe_unaccent(lower(${c.name}))) >= ${SIMILAR} OR similarity(soe_unaccent(lower(live_summary)), soe_unaccent(lower(${c.description}))) >= ${SIMILAR})
      ORDER BY sim DESC LIMIT 3`);
    const similar = (r.rows as { id: string; live_title: string; sim: number }[]).map((x) => ({ id: x.id, name: x.live_title, similarity: Math.round(Number(x.sim) * 100) / 100 }));
    if (similar.length) warnings.push(issue("similar_skill", "SKILL.md#name", `Tên hoặc mô tả gần giống skill đã xuất bản: "${similar[0]!.name}".`, "Xem skill đó trước. Nếu đây là bản mới của nó, đánh dấu \"phiên bản mới của skill\" (replaces); nếu khác thì đổi tên, mô tả cho rõ.", { similar }));
  }
  return { errors, warnings };
}

const MD_FILE_CAP = 4000;
const MD_TOTAL_CAP = 60_000;

const skill: PostKind<SkillContent> = {
  kind: "skill",
  menu: "aihub",
  label: "skill AI Hub",
  perms: { read: "aihub:skill:read", post: "aihub:skill:post", review: "aihub:skill:review" },
  guestFacet: null,
  parse,
  summarize: (c) => ({
    title: c.name,
    summary: c.description,
    tags: c.tags,
    text: [skillMd(c)?.content ?? "", c.files.map((f) => f.path).join(" ")].join("\n"),
    facets: { name: c.name, group: c.group, clients: c.clients, version: c.version, replaces: c.replaces },
  }),
  check,
  webPath: (id) => `/ai-hub/${id}`,
  markdown: (c) => {
    const meta = [c.group ? GROUP_LABEL[c.group] : null, `v${c.version}`, c.clients.length ? `client: ${c.clients.join(", ")}` : null, c.tags.length ? `thẻ: ${c.tags.join(", ")}` : null].filter(Boolean).join(" · ");
    let left = MD_TOTAL_CAP;
    const others = c.files
      .filter((f) => f.path !== "SKILL.md" && fileKind(f.path) === "text")
      .map((f) => {
        const t = f.content.slice(0, Math.min(MD_FILE_CAP, left));
        left -= t.length;
        return `### ${f.path}${t.length < f.content.length ? " (cắt bớt)" : ""}\n\`\`\`\n${t}\n\`\`\``;
      });
    return [`# ${c.name || "(chưa có name)"}`, `_${meta}_`, c.change_note ? `Ghi chú thay đổi: ${c.change_note}` : "", `Cây file: ${c.files.map((f) => f.path).join(", ")}`, `## SKILL.md\n${skillMd(c)?.content ?? ""}`, ...others].filter(Boolean).join("\n\n");
  },
  fileIds: () => [],
  async beforePublish(ctx, c) {
    if (!c.name) return;
    const r = await ctx.db.execute(sql`SELECT id FROM posts WHERE /*scope:system*/ kind = 'skill' AND status = 'published' AND archived_at IS NULL AND deleted_at IS NULL AND live_title = ${c.name} AND id <> ${ctx.postId}::uuid`);
    const other = (r.rows[0] as { id: string } | undefined)?.id;
    if (!other) return;
    if (c.replaces !== other) throw new AppError("conflict", `Đã có skill xuất bản tên "${c.name}". Trả lại để tác giả đổi tên, hoặc để tác giả đánh dấu đây là phiên bản mới của skill đó.`, { reason: "skill_name_taken", existing_post_id: other });
    await ctx.db.execute(sql`UPDATE posts SET archived_at = now(), updated_at = now(), version = version + 1 WHERE /*scope:system*/ id = ${other}::uuid`);
  },
};

registerKind(skill);
export const skillKind = skill as unknown as PostKind;
