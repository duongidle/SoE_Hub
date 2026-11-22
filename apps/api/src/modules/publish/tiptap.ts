/** Tiptap JSON helpers for posts: plain text for search, compact Markdown for AI, and a small Markdown to Tiptap converter for AI input. */
type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: Node[] };

export const BODY_MAX_BYTES = 500_000;
const BLOCK_TYPES = new Set(["paragraph", "heading", "listItem", "codeBlock", "blockquote", "tableRow", "callout", "horizontalRule"]);

/** True for a Tiptap document `{type:"doc", content:[...]}`. */
export function isDoc(v: unknown): v is Node {
  return !!v && typeof v === "object" && (v as Node).type === "doc" && Array.isArray((v as Node).content);
}

/** The text of a document: one line per block, no marks. Used for search and for the length rule. */
export function extractText(doc: unknown): string {
  if (!isDoc(doc)) return "";
  const out: string[] = [];
  const walk = (n: Node): void => {
    if (typeof n.text === "string") out.push(n.text);
    if (n.type === "hardBreak") out.push("\n");
    for (const c of n.content ?? []) walk(c);
    if (n.type && BLOCK_TYPES.has(n.type)) out.push("\n");
  };
  walk(doc);
  return out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function inline(n: Node): string {
  if (n.type === "hardBreak") return "  \n";
  if (n.type === "image") return `![${String(n.attrs?.alt ?? "")}](${String(n.attrs?.src ?? "")})`;
  let t = typeof n.text === "string" ? n.text : (n.content ?? []).map(inline).join("");
  for (const m of n.marks ?? []) {
    if (m.type === "bold") t = `**${t}**`;
    else if (m.type === "italic") t = `*${t}*`;
    else if (m.type === "code") t = `\`${t}\``;
    else if (m.type === "link") t = `[${t}](${String(m.attrs?.href ?? "")})`;
  }
  return t;
}

function block(n: Node, indent = ""): string {
  const kids = n.content ?? [];
  switch (n.type) {
    case "heading":
      return `${"#".repeat(Math.min(6, Math.max(1, Number(n.attrs?.level ?? 2))))} ${kids.map(inline).join("")}`;
    case "paragraph":
      return indent + kids.map(inline).join("");
    case "bulletList":
    case "orderedList":
      return kids
        .map((li, i) => {
          const mark = n.type === "orderedList" ? `${i + 1}. ` : "- ";
          const parts = (li.content ?? []).map((c) => block(c, indent + "  "));
          return `${indent}${mark}${(parts[0] ?? "").trimStart()}${parts.length > 1 ? "\n" + parts.slice(1).join("\n") : ""}`;
        })
        .join("\n");
    case "codeBlock":
      return "```" + String(n.attrs?.language ?? "") + "\n" + kids.map((c) => c.text ?? "").join("") + "\n```";
    case "blockquote":
    case "callout":
      return kids.map((c) => block(c)).join("\n\n").split("\n").map((l) => `> ${l}`).join("\n");
    case "horizontalRule":
      return "---";
    case "image":
      return inline(n);
    case "table": {
      const rows = kids.map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => (p.content ?? []).map(inline).join("")).join(" ").replace(/\|/g, "\\|")));
      if (!rows.length) return "";
      const head = rows[0]!;
      return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`)].join("\n");
    }
    default:
      return kids.map((c) => block(c, indent)).join("\n\n") || (typeof n.text === "string" ? n.text : "");
  }
}

/** Compact Markdown of a document, for AI readers. */
export function toMarkdown(doc: unknown): string {
  if (!isDoc(doc)) return "";
  return (doc.content ?? []).map((n) => block(n)).filter((s) => s !== "").join("\n\n");
}

const text = (t: string, marks?: Node["marks"]): Node => ({ type: "text", text: t, ...(marks && marks.length ? { marks } : {}) });

/** Inline Markdown (`**bold**`, `*italic*`, `` `code` ``, `[label](url)`) to text nodes. */
function inlineNodes(s: string): Node[] {
  const out: Node[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push(text(s.slice(last, m.index)));
    if (m[1] !== undefined) out.push(text(m[1], [{ type: "bold" }]));
    else if (m[2] !== undefined) out.push(text(m[2], [{ type: "italic" }]));
    else if (m[3] !== undefined) out.push(text(m[3], [{ type: "code" }]));
    else out.push(text(m[4]!, [{ type: "link", attrs: { href: m[5] } }]));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(text(s.slice(last)));
  return out;
}

const para = (s: string): Node => ({ type: "paragraph", content: inlineNodes(s) });

/** Markdown (headings, paragraphs, lists, quotes, fenced code, rules) to a Tiptap document. Tables and images stay text. */
export function fromMarkdown(md: string): Node {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const content: Node[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]!); i++) body.push(lines[i]!);
      i++;
      content.push({ type: "codeBlock", ...(fence[1] ? { attrs: { language: fence[1] } } : {}), ...(body.length ? { content: [text(body.join("\n"))] } : {}) });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      content.push({ type: "heading", attrs: { level: h[1]!.length }, content: inlineNodes(h[2]!.trim()) });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      content.push({ type: "horizontalRule" });
      i++;
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.)\s+/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]!);
      const items: Node[] = [];
      for (; i < lines.length; i++) {
        const m = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (!m || /\d/.test(/^\s*([-*]|\d+\.)/.exec(lines[i]!)![1]!) !== ordered) break;
        items.push({ type: "listItem", content: [para(m[1]!)] });
      }
      content.push({ type: ordered ? "orderedList" : "bulletList", content: items });
      continue;
    }
    if (line.startsWith(">")) {
      const q: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith(">"); i++) q.push(lines[i]!.replace(/^>\s?/, ""));
      content.push({ type: "blockquote", content: [para(q.join(" "))] });
      continue;
    }
    const p: string[] = [];
    for (; i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|>|\s*([-*]|\d+\.)\s)/.test(lines[i]!); i++) p.push(lines[i]!.trim());
    content.push(para(p.join(" ")));
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
