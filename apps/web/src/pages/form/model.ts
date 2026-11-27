// Form configuration `soe-form/1` as the web sees it, and the pure helpers shared by the editor and the filler (design module7 2, 8).
import { api } from "@/lib/api";

export type Cond = { field: string; op: string; value?: unknown } | { and: Cond[] } | { or: Cond[] };
export interface Opt { id?: string; label: string }
export interface Rubric { id: string; label: string; min: number; max: number; weight: number; floor?: number }
export interface Block {
  id: string;
  type: "question" | "heading" | "text" | "image" | "divider" | "page_break" | "group";
  [k: string]: unknown;
}
export interface Question extends Block {
  type: "question";
  input: string;
  label: string;
  description?: string;
  hint?: string;
  required?: boolean;
  default?: unknown;
  column_id?: string | null;
  param?: string;
  hidden?: boolean;
  show_if?: Cond;
  options?: Opt[];
  reveal?: Record<string, string[]>;
  scale?: { min: number; max: number; min_label?: string; max_label?: string };
  answer?: unknown;
  points?: number;
  partial?: boolean;
  match_accents?: boolean;
  rubric?: Rubric[];
}
export interface Quiz { enabled: boolean; scale: "100" | "raw"; pass?: { type: "points" | "percent"; value: number } | null; max_attempts: number; show: "none" | "score" | "score_answers" }
export interface Appearance { cover?: string; logo?: string; accent?: string; width?: "narrow" | "medium" | "wide"; thank_you?: { text?: string; redirect_url?: string; again?: boolean } }
export interface FormConfig { schema?: string; title: string; description: string; appearance: Appearance; quiz?: Quiz; blocks: Block[] }

export const ACCENTS: Record<string, { label: string; hex: string }> = {
  blue: { label: "Xanh dương", hex: "#2563eb" },
  green: { label: "Xanh lá", hex: "#15803d" },
  orange: { label: "Cam", hex: "#c2410c" },
  purple: { label: "Tím", hex: "#7e22ce" },
  red: { label: "Đỏ", hex: "#b91c1c" },
  slate: { label: "Xám đen", hex: "#334155" },
};
export const WIDTHS = { narrow: "max-w-md", medium: "max-w-2xl", wide: "max-w-4xl" } as const;

export const QUESTION_KINDS: { input: string; label: string }[] = [
  { input: "text", label: "Văn bản ngắn" },
  { input: "long_text", label: "Văn bản dài" },
  { input: "number", label: "Số" },
  { input: "currency", label: "Tiền" },
  { input: "percent", label: "Phần trăm" },
  { input: "date", label: "Ngày" },
  { input: "datetime", label: "Ngày giờ" },
  { input: "checkbox", label: "Hộp tích" },
  { input: "rating", label: "Đánh giá sao" },
  { input: "scale", label: "Thang điểm" },
  { input: "single_select", label: "Một lựa chọn" },
  { input: "multi_select", label: "Nhiều lựa chọn" },
  { input: "email", label: "Email" },
  { input: "phone", label: "Điện thoại" },
  { input: "url", label: "Đường dẫn" },
  { input: "attachment", label: "Đính kèm" },
  { input: "user", label: "Người dùng" },
  { input: "relation", label: "Liên kết dòng" },
];
export const kindLabel = (input: string) => QUESTION_KINDS.find((k) => k.input === input)?.label ?? input;
export const isSelect = (input: string) => input === "single_select" || input === "multi_select";
export const isNumeric = (input: string) => ["number", "currency", "percent", "rating", "scale"].includes(input);

/** Operators offered for a question, by its kind (design module7 2.4). */
export function opsFor(input: string): { op: string; label: string; noValue?: boolean }[] {
  const empty = [{ op: "is_empty", label: "để trống", noValue: true }, { op: "is_not_empty", label: "đã điền", noValue: true }];
  if (isSelect(input)) return [{ op: "eq", label: "là" }, { op: "neq", label: "không là" }, ...(input === "multi_select" ? [{ op: "contains", label: "có chứa" }] : []), ...empty];
  if (isNumeric(input)) return [{ op: "eq", label: "bằng" }, { op: "neq", label: "khác" }, { op: "gt", label: "lớn hơn" }, { op: "gte", label: "từ" }, { op: "lt", label: "nhỏ hơn" }, { op: "lte", label: "tối đa" }, ...empty];
  if (input === "checkbox") return [{ op: "eq", label: "là" }];
  return [{ op: "eq", label: "bằng" }, { op: "neq", label: "khác" }, { op: "contains", label: "có chứa" }, ...empty];
}

export const rid = (p = "b") => `${p}${Math.random().toString(36).slice(2, 8)}`;

// ---------- tree helpers ----------
export interface Flat { block: Block; parent: Block | null; index: number }
export function flat(blocks: Block[]): Flat[] {
  const out: Flat[] = [];
  const walk = (list: Block[], parent: Block | null) => list.forEach((b, i) => { out.push({ block: b, parent, index: i }); if (b.type === "group") walk(((b as unknown as { blocks: Block[] }).blocks) ?? [], b); });
  walk(blocks, null);
  return out;
}
export const questions = (cfg: FormConfig): Question[] => flat(cfg.blocks).filter((f) => f.block.type === "question").map((f) => f.block as Question);
const kids = (b: Block) => ((b as unknown as { blocks?: Block[] }).blocks ?? []);

export function mapBlocks(blocks: Block[], fn: (b: Block) => Block | null): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const r = fn(b);
    if (!r) continue;
    out.push(r.type === "group" ? ({ ...r, blocks: mapBlocks(kids(r), fn) } as Block) : r);
  }
  return out;
}
export const patchBlock = (cfg: FormConfig, id: string, patch: Record<string, unknown>): FormConfig => ({ ...cfg, blocks: mapBlocks(cfg.blocks, (b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)) });
export const removeBlock = (cfg: FormConfig, id: string): FormConfig => ({ ...cfg, blocks: mapBlocks(cfg.blocks, (b) => (b.id === id ? null : b)) });
export function insertBlock(cfg: FormConfig, block: Block, afterId?: string | null): FormConfig {
  if (afterId) {
    const f = flat(cfg.blocks).find((x) => x.block.id === afterId);
    if (f) {
      // after a group: after the whole group at top level; after a child: inside the same group
      const insert = (list: Block[]): Block[] => list.flatMap((b) => (b.id === afterId ? [b, block] : b.type === "group" ? [{ ...b, blocks: insert(kids(b)) } as Block] : [b]));
      if (block.type !== "group" || !f.parent) return { ...cfg, blocks: insert(cfg.blocks) };
    }
  }
  return { ...cfg, blocks: [...cfg.blocks, block] };
}
/** Puts `block` at `index` of the top-level list (`parentId` null) or of the group `parentId`. */
export function insertAt(cfg: FormConfig, block: Block, parentId: string | null, index: number): FormConfig {
  const put = (list: Block[]): Block[] => { const c = [...list]; c.splice(Math.max(0, Math.min(index, c.length)), 0, block); return c; };
  if (!parentId) return { ...cfg, blocks: put(cfg.blocks) };
  return { ...cfg, blocks: cfg.blocks.map((b) => (b.id === parentId && b.type === "group" ? ({ ...b, blocks: put(kids(b)) } as Block) : b)) };
}
/** A copy with fresh ids. A copy has no column (two questions may not share one), no link parameter and no reveal rules (they name other blocks). */
export function cloneBlock(b: Block): Block {
  if (b.type === "group") return { ...b, id: rid("g"), blocks: kids(b).map(cloneBlock) } as Block;
  if (b.type !== "question") return { ...b, id: rid() };
  const q = b as Question;
  const map = new Map<string, string>();
  const options = q.options?.map((o) => { const id = o.id ? rid("o_") : undefined; if (o.id && id) map.set(o.id, id); return { ...o, id }; });
  const { column_id: _c, param: _p, reveal: _r, ...rest } = q;
  const answer = Array.isArray(q.answer) ? q.answer.map((a) => map.get(String(a)) ?? a) : typeof q.answer === "string" ? map.get(q.answer) ?? q.answer : q.answer;
  return { ...rest, id: rid("q"), ...(options ? { options } : {}), ...(q.answer !== undefined ? { answer } : {}) } as Question;
}
/** Moves a block up or down inside its own list. */
export function moveBlock(cfg: FormConfig, id: string, dir: -1 | 1): FormConfig {
  const swap = (list: Block[]): Block[] => {
    const i = list.findIndex((b) => b.id === id);
    if (i >= 0) {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const c = [...list];
      [c[i], c[j]] = [c[j]!, c[i]!];
      return c;
    }
    return list.map((b) => (b.type === "group" ? ({ ...b, blocks: swap(kids(b)) } as Block) : b));
  };
  return { ...cfg, blocks: swap(cfg.blocks) };
}
/**
 * Drag end: put `activeId` where `overId` is. Over a group header means into that group (at the end); over a child means next to it
 * (inside its group); over a top-level block means next to it at top level. A group never goes inside a group.
 */
export function dropBlock(cfg: FormConfig, activeId: string, overId: string): FormConfig {
  if (activeId === overId) return cfg;
  const all = flat(cfg.blocks);
  const a = all.find((x) => x.block.id === activeId);
  const o = all.find((x) => x.block.id === overId);
  if (!a || !o) return cfg;
  if (a.block.type === "group" && o.parent) return cfg;
  if (o.parent?.id === activeId) return cfg;
  const down = all.indexOf(a) < all.indexOf(o);
  const without = removeBlock(cfg, activeId);
  const moved = a.block;
  const place = (list: Block[]): Block[] => {
    const res: Block[] = [];
    for (const b of list) {
      if (b.id === overId && o.block.type === "group" && moved.type !== "group" && !(a.parent && a.parent.id === overId)) {
        res.push({ ...b, blocks: [...kids(b), moved] } as Block);
        continue;
      }
      if (b.id === overId && !down) res.push(moved);
      res.push(b.type === "group" ? ({ ...b, blocks: place(kids(b)) } as Block) : b);
      if (b.id === overId && down) res.push(moved);
    }
    return res;
  };
  return { ...without, blocks: place(without.blocks) };
}

// ---------- conditions: the same rules the server applies (apps/api/src/modules/form/config.ts) ----------
export const isEmptyAnswer = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const same = (a: unknown, b: unknown) => {
  if (a === b) return true;
  const x = num(a), y = num(b);
  if (x !== null && y !== null && typeof a !== "boolean" && typeof b !== "boolean") return x === y;
  return String(a).toLowerCase() === String(b).toLowerCase();
};
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : isEmptyAnswer(v) ? [] : [v]);
const cmp = (h: unknown, w: unknown): number | null => {
  const x = num(h), y = num(w);
  if (x !== null && y !== null) return x - y;
  return typeof h === "string" && typeof w === "string" ? (h < w ? -1 : h > w ? 1 : 0) : null;
};
export function evalCond(n: Cond, ans: Record<string, unknown>): boolean {
  if ("and" in n) return n.and.every((c) => evalCond(c, ans));
  if ("or" in n) return n.or.some((c) => evalCond(c, ans));
  const have = ans[n.field];
  const want = n.value;
  switch (n.op) {
    case "is_empty": return isEmptyAnswer(have);
    case "is_not_empty": return !isEmptyAnswer(have);
    case "eq": return Array.isArray(have) ? have.some((h) => same(h, want)) : !isEmptyAnswer(have) && same(have, want);
    case "neq": return Array.isArray(have) ? !have.some((h) => same(h, want)) : isEmptyAnswer(have) || !same(have, want);
    case "in": return asList(have).some((h) => asList(want).some((w) => same(h, w)));
    case "nin": return !asList(have).some((h) => asList(want).some((w) => same(h, w)));
    case "contains": return Array.isArray(have) ? have.some((h) => same(h, want)) : typeof have === "string" && typeof want === "string" && have.toLowerCase().includes(want.toLowerCase());
    case "starts_with": return typeof have === "string" && typeof want === "string" && have.toLowerCase().startsWith(want.toLowerCase());
    case "gt": return (cmp(have, want) ?? NaN) > 0;
    case "gte": return (cmp(have, want) ?? NaN) >= 0;
    case "lt": return (cmp(have, want) ?? NaN) < 0;
    case "lte": return (cmp(have, want) ?? NaN) <= 0;
    default: return false;
  }
}
/** Which blocks the answers show (same as the server's `visibleBlocks`; the server has the last word). */
export function visibleIds(cfg: FormConfig, given: Record<string, unknown>): Set<string> {
  const all = flat(cfg.blocks);
  const revealers = new Map<string, { q: string; opt: string; label?: string }[]>();
  for (const f of all) {
    const q = f.block as Question;
    if (q.type !== "question") continue;
    for (const [opt, targets] of Object.entries(q.reveal ?? {})) for (const t of targets) revealers.set(t, [...(revealers.get(t) ?? []), { q: q.id, opt, label: q.options?.find((o) => o.id === opt)?.label }]);
  }
  const visible = new Set<string>();
  const shown = new Map<string, boolean>();
  const ans: Record<string, unknown> = {};
  for (const f of all) {
    const b = f.block;
    let ok = !f.parent || shown.get(f.parent.id) === true;
    const own = (b as { show_if?: Cond }).show_if;
    if (ok && own) ok = evalCond(own, ans);
    const rv = revealers.get(b.id);
    if (ok && rv) ok = rv.some((r) => asList(ans[r.q]).some((h) => same(h, r.opt) || (r.label !== undefined && same(h, r.label))));
    if (b.type === "question" && (b as Question).hidden) ok = true;
    shown.set(b.id, ok);
    if (ok) visible.add(b.id);
    if (b.type === "question" && ok && !isEmptyAnswer(given[b.id])) ans[b.id] = given[b.id];
  }
  return visible;
}

// ---------- API ----------
export interface FormBrief {
  id: string; name: string; status: "draft" | "open" | "paused" | "closed"; state: string; state_reason: string | null; code: string; link_path: string;
  access: "public" | "all_accounts" | "selected"; audience: { user_ids: string[]; team_ids: string[]; roles: string[]; guest_ids: string[]; guest_presets: string[] };
  options: { one_per_user?: boolean; open_at?: string | null; close_at?: string | null; max_responses?: number | null; closed_message?: string | null; graders?: string[] };
  notify_new_response: boolean; table_id: string | null; table_name: string | null; datahub_id: string | null; published_version: number; has_unpublished: boolean; response_count: number; last_response_at: string | null; version: number; deleted_at: string | null;
}
export interface FormDetail extends FormBrief { draft: FormConfig; published: FormConfig | null; disabled_question_ids: string[]; max_columns: number | null }
export interface PublishIssue { code: string; message: string; block_id?: string; column?: string }
export const formKeys = { list: (trashed: boolean) => ["forms", trashed] as const, one: (id: string) => ["form", id] as const, targets: ["form-targets"] as const };
export const listForms = (trashed = false) => api<FormBrief[]>("GET", `/forms${trashed ? "?trashed=true" : ""}`);
