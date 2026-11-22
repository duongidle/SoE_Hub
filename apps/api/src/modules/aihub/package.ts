import JSZip from "jszip";
import { AppError } from "@soe/shared";

/** Limits of a skill package (design module8 4.2). */
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 50;
export const ZIP_B64_MAX = 7_500_000;

export interface SkillFile {
  path: string;
  /** `utf8` for text files, `base64` for images. */
  encoding: "utf8" | "base64";
  content: string;
  size: number;
}
export type InFile = { path: string; content: string; encoding?: "utf8" | "base64" };

export const TEXT_EXT = new Set(["md", "txt", "py", "js", "ts", "tsx", "jsx", "sh", "json", "yaml", "yml", "csv", "html", "css", "toml", "xml", "svg", "ini", "cfg", "sql"]);
export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
export const extOf = (path: string): string => (path.includes(".") ? path.split(".").pop()!.toLowerCase() : "");
export const fileKind = (path: string): "text" | "image" | "other" => (TEXT_EXT.has(extOf(path)) ? "text" : IMAGE_EXT.has(extOf(path)) ? "image" : "other");
export const isForbiddenName = (path: string): boolean => {
  const base = path.split("/").pop()!.toLowerCase();
  return base === ".env" || base.startsWith(".env.") || base.endsWith(".pem") || base === "id_rsa" || base.startsWith("id_rsa.");
};

const bad = (path: string, message: string): never => {
  throw new AppError("validation_error", message, { issues: [{ path, message }] });
};

/** Clean relative path, or throws: no absolute path, no `..`, no drive letter, no control characters. */
export function cleanPath(raw: string, at: string): string {
  const p = raw.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  // eslint-disable-next-line no-control-regex
  if (!p || p.startsWith("/") || /^[A-Za-z]:/.test(p) || /[\u0000-\u001f]/.test(p) || p.split("/").some((s) => s === ".." || s === "." || s === "")) return bad(at, `Đường dẫn file không hợp lệ: "${raw.slice(0, 80)}". Dùng đường dẫn tương đối trong gói, không có "..".`);
  if (p.length > 200) return bad(at, "Đường dẫn file quá dài (tối đa 200 ký tự).");
  return p;
}

const byteSize = (f: { encoding: string; content: string }): number => (f.encoding === "base64" ? Buffer.from(f.content, "base64").length : Buffer.byteLength(f.content, "utf8"));

/** Normalises the files an author sends: safe paths, no duplicates, at most 50 files and 5 MB. */
export function normFiles(input: InFile[]): SkillFile[] {
  if (input.length > MAX_FILES) bad("files", `Gói có ${input.length} file, tối đa ${MAX_FILES}.`);
  const seen = new Set<string>();
  let total = 0;
  const out = input.map((f, i) => {
    const path = cleanPath(f.path, `files[${i}].path`);
    if (seen.has(path)) bad(`files[${i}].path`, `Trùng đường dẫn: ${path}.`);
    seen.add(path);
    const encoding = f.encoding ?? (fileKind(path) === "image" ? "base64" : "utf8");
    if (fileKind(path) === "image" && encoding !== "base64") bad(`files[${i}].encoding`, "File ảnh phải gửi dạng base64.");
    const file: SkillFile = { path, encoding, content: f.content, size: 0 };
    file.size = byteSize(file);
    total += file.size;
    return file;
  });
  if (total > MAX_BYTES) bad("files", `Gói nặng ${(total / 1048576).toFixed(1)} MB, tối đa 5 MB.`);
  return out.sort((a, b) => Number(b.path === "SKILL.md") - Number(a.path === "SKILL.md") || a.path.localeCompare(b.path));
}

/**
 * Unpacks a zip sent as base64. Checks the entry count and the declared sizes before extracting anything, refuses paths that leave the folder,
 * and drops a single top folder (a zipped skill folder) and system files.
 */
export async function unpackZip(b64: string): Promise<InFile[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
  } catch {
    return bad("zip", "Không đọc được file zip.");
  }
  const entries = Object.values(zip.files).filter((e) => !e.dir && !e.name.startsWith("__MACOSX/") && !e.name.endsWith(".DS_Store"));
  if (entries.length > MAX_FILES) bad("zip", `Gói có ${entries.length} file, tối đa ${MAX_FILES}.`);
  const declared = entries.reduce((n, e) => n + ((e as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (declared > MAX_BYTES) bad("zip", `Gói giải nén nặng ${(declared / 1048576).toFixed(1)} MB, tối đa 5 MB.`);
  // JSZip resolves ".." in `name`; the original spelling is what must be checked.
  const names = entries.map((e) => cleanPath((e as unknown as { unsafeOriginalName?: string }).unsafeOriginalName ?? e.name, "zip"));
  const tops = new Set(names.map((n) => n.split("/")[0]));
  const strip = tops.size === 1 && names.every((n) => n.includes("/")) && !names.includes("SKILL.md") ? `${[...tops][0]}/` : "";
  const out: InFile[] = [];
  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    const path = strip ? names[i]!.slice(strip.length) : names[i]!;
    const buf = await entries[i]!.async("nodebuffer");
    total += buf.length;
    if (total > MAX_BYTES) bad("zip", "Gói giải nén vượt 5 MB.");
    if (fileKind(path) === "image") out.push({ path, encoding: "base64", content: buf.toString("base64") });
    else {
      if (fileKind(path) === "text" && buf.includes(0)) bad(`zip:${path}`, `File ${path} có nội dung nhị phân.`);
      out.push({ path, encoding: "utf8", content: buf.toString("utf8") });
    }
  }
  return out;
}

export async function packZip(files: SkillFile[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, f.encoding === "base64" ? Buffer.from(f.content, "base64") : f.content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export interface Frontmatter {
  ok: boolean;
  name: string;
  description: string;
  error?: string;
  /** Text after the YAML header. */
  body: string;
}

/** The YAML header of SKILL.md: `key: value` lines, quoted values and block scalars (`>`, `|`). Enough for `name` and `description`. */
export function frontmatter(text: string): Frontmatter {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { ok: false, name: "", description: "", error: "SKILL.md phải bắt đầu bằng đầu YAML giữa hai dòng ---.", body: text };
  const lines = m[1]!.split(/\r?\n/);
  const kv: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trim() || l.trim().startsWith("#")) continue;
    const k = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(l);
    if (!k) {
      if (/^\s/.test(l)) continue;
      return { ok: false, name: "", description: "", error: `Dòng YAML không hợp lệ: "${l.slice(0, 60)}".`, body: text.slice(m[0].length) };
    }
    let v = k[2]!.trim();
    if (/^[>|][+-]?$/.test(v)) {
      const parts: string[] = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]!) || !lines[i + 1]!.trim())) parts.push(lines[++i]!.trim());
      v = parts.join(v.startsWith(">") ? " " : "\n").trim();
    } else if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    kv[k[1]!] = v;
  }
  return { ok: true, name: kv.name ?? "", description: kv.description ?? "", body: text.slice(m[0].length) };
}

/** Relative paths SKILL.md points to: markdown links, and `references/...`, `scripts/...`, `assets/...` in backticks. */
export function referencedPaths(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\]\(([^)\s]+?)(?:#[^)\s]*)?\)/g)) {
    const t = m[1]!;
    if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("/") || t.startsWith("#")) continue;
    out.add(t.replace(/^(\.\/)+/, ""));
  }
  for (const m of body.matchAll(/`((?:\.\/)?(?:references|scripts|assets)\/[^`\s]+)`/g)) out.add(m[1]!.replace(/^(\.\/)+/, "").replace(/[.,;:]+$/, ""));
  return [...out];
}

export const PERSONAL_PATH_RE = /(\/Users\/[^\s/"'`]+|\/home\/[^\s/"'`]+|[A-Za-z]:\\Users\\|~\/(?:Desktop|Downloads|Documents)\b)/;
