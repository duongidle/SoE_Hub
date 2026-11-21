import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Bản đồ code (design/ban-do-code.md) phải khớp code thật. Không dùng DB.
const ROOT = path.resolve(__dirname, "../../..");
const text = readFileSync(path.join(ROOT, "design/ban-do-code.md"), "utf8");

const PATH_RE = /^[\w.@\-/[\]]+\/[\w.@\-[\]]+\.(ts|tsx|sql|md)$/;
// Một cụm backtick trông như đường dẫn: có "/" và đuôi .ts, .tsx, .sql hoặc .md.
// Mẫu có "..." (ví dụ trong phần quy định) không phải đường dẫn thật.
const looksLikePath = (s: string) => !s.includes("...") && PATH_RE.test(s);

describe("bản đồ code", () => {
  it("mọi cặp `đường/dẫn` `tênHàm` có file và file chứa tên", () => {
    const errors: string[] = [];
    const cache = new Map<string, string | null>();
    const read = (rel: string) => {
      if (!cache.has(rel)) {
        const abs = path.join(ROOT, rel);
        cache.set(rel, existsSync(abs) ? readFileSync(abs, "utf8") : null);
      }
      return cache.get(rel)!;
    };
    const pair = /`([^`\s]+)` `([^`]+)`/g;
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(pair)) {
        const [, file, name] = m;
        if (!looksLikePath(file!)) continue;
        const body = read(file!);
        if (body === null) errors.push(`dòng ${i + 1}: file không tồn tại: ${file}`);
        else if (!body.includes(name!)) errors.push(`dòng ${i + 1}: ${file} không chứa "${name}"`);
      }
    });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it("mọi đường dẫn trong backtick đều tồn tại", () => {
    const errors: string[] = [];
    const seen = new Set<string>();
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/`([^`]+)`/g)) {
        const s = m[1]!;
        if (!looksLikePath(s) || seen.has(s)) continue;
        seen.add(s);
        if (!existsSync(path.join(ROOT, s))) errors.push(`dòng ${i + 1}: đường dẫn không tồn tại: ${s}`);
      }
    });
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
