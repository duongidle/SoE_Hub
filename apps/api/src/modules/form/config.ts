import { z } from "zod";
import { FilterSchema, type FilterNode } from "@soe/shared";

/** `soe-form/1`: the configuration of a form (design module7 8). One JSON document, kept as the draft and copied into `form_versions` on publish. */
export const FORM_SCHEMA = "soe-form/1";

/** Input kinds of a question. A column type, or `scale` (a number with labelled ends, design module7 2.3). */
export const INPUTS = ["text", "long_text", "number", "currency", "percent", "date", "datetime", "checkbox", "rating", "single_select", "multi_select", "email", "phone", "url", "attachment", "user", "relation", "scale"] as const;
export type Input = (typeof INPUTS)[number];

/** Column types a question of this input may be connected to (design module7 2.3a: only the types that fit). */
export function compatibleTypes(input: Input): string[] {
  return input === "scale" ? ["number"] : [input];
}
/** The column type a new column gets for this input. */
export const columnTypeOf = (input: Input): string => (input === "scale" ? "number" : input);
export const isSelect = (input: string) => input === "single_select" || input === "multi_select";

const BlockId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Mã khối chỉ gồm chữ, số, - và _ (tối đa 40 ký tự).");
const Option = z.looseObject({ id: z.string().min(1).max(64).optional(), label: z.string().trim().min(1).max(200) });

export const QuestionSchema = z.looseObject({
  id: BlockId,
  type: z.literal("question"),
  input: z.enum(INPUTS),
  label: z.string().max(500).default(""),
  description: z.string().max(2000).optional(),
  hint: z.string().max(300).optional(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  /** Key of the column this question writes (never sent to the person filling the form). */
  column_id: z.string().max(100).nullable().optional(),
  /** Short name of the question in a link (`?cong_ty=...`), design module7 2.3b. */
  param: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
  /** Hidden field: the person does not see it, the value comes from the link and is always written. */
  hidden: z.boolean().optional(),
  /** Hidden "Filler" field (design module9 2): the server writes the person logged in, never the browser. Only a `user` question of an internal form. */
  fill_self: z.boolean().optional(),
  show_if: FilterSchema.optional(),
  options: z.array(Option).max(200).optional(),
  /** "When chosen, show...": option id -> ids of the blocks it reveals. */
  reveal: z.record(z.string(), z.array(BlockId).max(100)).optional(),
  scale: z.looseObject({ min: z.number().int().min(0).max(10), max: z.number().int().min(1).max(10), min_label: z.string().max(100).optional(), max_label: z.string().max(100).optional() }).optional(),
  unique_message: z.string().max(300).optional(),
  /** Quiz (design module7 6): the right answer (a server secret), the points, and the options of the check. */
  answer: z.unknown().optional(),
  points: z.number().min(0).max(1000).optional(),
  /** Multi-select: partial credit (right minus wrong, over the number of right answers). */
  partial: z.boolean().optional(),
  /** Short text: tell accents apart (by default only case and extra spaces are ignored). */
  match_accents: z.boolean().optional(),
  /** Hand-graded question: criteria with a scale, a weight and a floor (design module7 6.2). */
  rubric: z.array(z.looseObject({ id: BlockId, label: z.string().max(200).default(""), min: z.number().min(0).max(100).default(1), max: z.number().min(1).max(100).default(5), weight: z.number().min(0).max(1000).default(1), floor: z.number().min(0).max(100).optional() })).max(30).optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

type BlockT = Question | { id: string; type: "heading" | "text" | "image" | "divider" | "page_break"; [k: string]: unknown } | { id: string; type: "group"; title?: string; show_if?: FilterNode; blocks: BlockT[]; [k: string]: unknown };
export type Block = BlockT;

const PlainBlock = z.looseObject({ id: BlockId, type: z.enum(["heading", "text", "image", "divider", "page_break"]) });
const GroupSchema: z.ZodType<Block> = z.lazy(() => z.looseObject({ id: BlockId, type: z.literal("group"), title: z.string().max(300).optional(), show_if: FilterSchema.optional(), blocks: z.array(z.union([QuestionSchema, PlainBlock])).max(300) })) as z.ZodType<Block>;
const BlockSchema: z.ZodType<Block> = z.union([QuestionSchema as z.ZodType<Block>, PlainBlock as z.ZodType<Block>, GroupSchema]);

/** Quiz mode (design module7 6.3). Only for a form with people logged in. */
export const QuizSchema = z.looseObject({
  enabled: z.boolean().default(false),
  scale: z.enum(["100", "raw"]).default("raw"),
  /** Pass mark: points (on the shown scale) or percent. No pass mark: the result stays empty. */
  pass: z.looseObject({ type: z.enum(["points", "percent"]), value: z.number().min(0) }).nullable().optional(),
  max_attempts: z.number().int().min(1).max(20).default(1),
  /** What the person sees: nothing, the score and pass/fail, or also the right answers once the form is closed. */
  show: z.enum(["none", "score", "score_answers"]).default("none"),
});
export type Quiz = z.infer<typeof QuizSchema>;

export const FormConfigSchema = z.looseObject({
  schema: z.literal(FORM_SCHEMA).default(FORM_SCHEMA),
  title: z.string().max(200).default(""),
  description: z.string().max(5000).default(""),
  appearance: z.looseObject({}).default({}),
  quiz: QuizSchema.optional(),
  blocks: z.array(BlockSchema).max(500).default([]),
});
export type FormConfig = z.infer<typeof FormConfigSchema>;

export const emptyConfig = (title = ""): FormConfig => FormConfigSchema.parse({ title });

/** Every block in reading order with its position and parent group. A group comes before its children. */
export interface Flat {
  block: Block;
  pos: number;
  group: Flat | null;
}
export function flatten(blocks: Block[]): Flat[] {
  const out: Flat[] = [];
  const walk = (list: Block[], group: Flat | null) => {
    for (const b of list) {
      const f: Flat = { block: b, pos: out.length, group };
      out.push(f);
      if (b.type === "group") walk((b as { blocks: Block[] }).blocks, f);
    }
  };
  walk(blocks, null);
  return out;
}
export const questionsOf = (cfg: FormConfig): Question[] => flatten(cfg.blocks).filter((f) => f.block.type === "question").map((f) => f.block as Question);

// ---------------------------------------------------------------------------------------------
// conditions (design module7 2.4)
// ---------------------------------------------------------------------------------------------

const SUPPORTED_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "contains", "starts_with", "is_empty", "is_not_empty", "between"]);

export function isEmptyAnswer(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  const x = num(a);
  const y = num(b);
  if (x !== null && y !== null && typeof a !== "boolean" && typeof b !== "boolean") return x === y;
  return String(a).toLowerCase() === String(b).toLowerCase();
};
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : isEmptyAnswer(v) ? [] : [v]);

function compare(have: unknown, want: unknown): number | null {
  const x = num(have);
  const y = num(want);
  if (x !== null && y !== null) return x - y;
  if (typeof have === "string" && typeof want === "string") return have < want ? -1 : have > want ? 1 : 0;
  return null;
}

/** Evaluates a filter node on the answers (question id -> value). Unsupported operators are rejected when the form is published, so they never get here. */
export function evalCondition(node: FilterNode, answers: Record<string, unknown>): boolean {
  if ("and" in node) return node.and.every((n) => evalCondition(n, answers));
  if ("or" in node) return node.or.some((n) => evalCondition(n, answers));
  const have = answers[node.field];
  const want = node.value;
  switch (node.op) {
    case "is_empty":
      return isEmptyAnswer(have);
    case "is_not_empty":
      return !isEmptyAnswer(have);
    case "eq":
      return Array.isArray(have) ? have.some((h) => same(h, want)) : !isEmptyAnswer(have) && same(have, want);
    case "neq":
      return Array.isArray(have) ? !have.some((h) => same(h, want)) : isEmptyAnswer(have) || !same(have, want);
    case "in":
      return asList(have).some((h) => asList(want).some((w) => same(h, w)));
    case "nin":
      return !asList(have).some((h) => asList(want).some((w) => same(h, w)));
    case "contains":
      return Array.isArray(have) ? have.some((h) => same(h, want)) : typeof have === "string" && typeof want === "string" && have.toLowerCase().includes(want.toLowerCase());
    case "starts_with":
      return typeof have === "string" && typeof want === "string" && have.toLowerCase().startsWith(want.toLowerCase());
    case "gt":
      return (compare(have, want) ?? NaN) > 0;
    case "gte":
      return (compare(have, want) ?? NaN) >= 0;
    case "lt":
      return (compare(have, want) ?? NaN) < 0;
    case "lte":
      return (compare(have, want) ?? NaN) <= 0;
    case "between": {
      const [a, b] = asList(want);
      return (compare(have, a) ?? NaN) >= 0 && (compare(have, b) ?? NaN) <= 0;
    }
    default:
      return false;
  }
}

/** The questions a node reads (`field`), or the operators it uses that a form does not support. */
export function conditionRefs(node: FilterNode, fields: string[] = [], badOps: string[] = []): { fields: string[]; badOps: string[] } {
  if ("and" in node) node.and.forEach((n) => conditionRefs(n, fields, badOps));
  else if ("or" in node) node.or.forEach((n) => conditionRefs(n, fields, badOps));
  else {
    fields.push(node.field);
    if (!SUPPORTED_OPS.has(node.op)) badOps.push(node.op);
  }
  return { fields, badOps };
}

// ---------------------------------------------------------------------------------------------
// option ids (design module7 2.4: conditions, "when chosen, show", answers and submitted values hold the option ID, never the name)
// ---------------------------------------------------------------------------------------------

/** The id of the option a value (an id, or a name as the link or an old form wrote it) stands for; null when the question has no such option. */
export function optionIdOf(q: Question, v: unknown): string | null {
  const s = String(v ?? "").trim();
  const o = (q.options ?? []).find((x) => x.id === s) ?? (q.options ?? []).find((x) => x.label.trim().toLowerCase() === s.toLowerCase());
  return o?.id ?? null;
}
/** A submitted value of a select question as option ids. Values that match nothing stay as they are (the column refuses them later). */
export function canonValue(q: Question, v: unknown): unknown {
  if (!isSelect(q.input) || isEmptyAnswer(v)) return v;
  const one = (x: unknown) => optionIdOf(q, x) ?? x;
  return Array.isArray(v) ? v.map(one) : one(v);
}
/** What a stored value of a select question shows as: the option names (an id nobody knows stays as it is). */
export function labelValue(q: Question, v: unknown): unknown {
  if (!isSelect(q.input) || isEmptyAnswer(v)) return v;
  const one = (x: unknown) => (q.options ?? []).find((o) => o.id === x)?.label ?? x;
  return Array.isArray(v) ? v.map(one) : one(v);
}
/** The leaves (`field op value`) of a condition. */
export function conditionLeaves(node: FilterNode, out: { field: string; op: string; value?: unknown }[] = []): { field: string; op: string; value?: unknown }[] {
  if ("and" in node) node.and.forEach((n) => conditionLeaves(n, out));
  else if ("or" in node) node.or.forEach((n) => conditionLeaves(n, out));
  else out.push(node as { field: string; op: string; value?: unknown });
  return out;
}
/** The same condition with the values of select questions turned into option ids (a value that is no option stays, and just never matches). */
function canonCondition(node: FilterNode, byId: Map<string, Question>): FilterNode {
  if ("and" in node) return { and: node.and.map((n) => canonCondition(n, byId)) } as FilterNode;
  if ("or" in node) return { or: node.or.map((n) => canonCondition(n, byId)) } as FilterNode;
  const q = byId.get(node.field);
  if (!q || !isSelect(q.input) || !("value" in node)) return node;
  const v = (node as { value?: unknown }).value;
  return { ...node, value: Array.isArray(v) ? v.map((x) => optionIdOf(q, x) ?? x) : (optionIdOf(q, v) ?? v) } as FilterNode;
}

/**
 * After the options of a question took the ids of a column (create, link, import), every reference to its options follows them (matched by label):
 * the "when chosen, show" keys, the right answer, and the conditions of any block that reads this question.
 */
export function remapOptionRefs(cfg: FormConfig, qid: string, oldOptions: { id?: string; label: string }[], newOptions: { id?: string; label: string }[]): FormConfig {
  const map = new Map<string, string>();
  for (const o of oldOptions) {
    const now = newOptions.find((n) => n.label.trim().toLowerCase() === o.label.trim().toLowerCase())?.id;
    if (!now) continue;
    if (o.id) map.set(o.id, now);
    map.set(o.label.trim().toLowerCase(), now); // a value written as a name (older forms, the JSON of a hand)
  }
  const one = (v: string) => map.get(v) ?? map.get(v.trim().toLowerCase()) ?? v;
  const m = (v: unknown): unknown => (Array.isArray(v) ? v.map(m) : typeof v === "string" ? one(v) : v);
  const cond = (n: FilterNode): FilterNode => {
    if ("and" in n) return { and: n.and.map(cond) } as FilterNode;
    if ("or" in n) return { or: n.or.map(cond) } as FilterNode;
    return n.field === qid && "value" in n ? ({ ...n, value: m((n as { value?: unknown }).value) } as FilterNode) : n;
  };
  const walk = (list: Block[]): Block[] =>
    list.map((b) => {
      const copy: Record<string, unknown> = { ...b };
      const own = (b as { show_if?: FilterNode }).show_if;
      if (own) copy.show_if = cond(own);
      if (b.type === "question" && b.id === qid) {
        const q = b as Question;
        if (q.reveal) copy.reveal = Object.fromEntries(Object.entries(q.reveal).map(([k, t]) => [one(k), t]));
        if (q.answer !== undefined && q.answer !== null) copy.answer = m(q.answer);
      }
      if (b.type === "group") copy.blocks = walk((b as { blocks: Block[] }).blocks);
      return copy as Block;
    });
  return { ...cfg, blocks: walk(cfg.blocks) };
}

/**
 * Which blocks the answers show (design module7 2.4). The server decides: a hidden question loses its value and is not required.
 * A block is shown when its group is shown, its own `show_if` holds, and (if some option of an earlier question reveals it) one of those options is chosen.
 * A hidden answer counts as empty for the blocks after it. Hidden FIELDS (`hidden: true`) are never subject to this: they are always kept.
 */
export function visibleBlocks(cfg: FormConfig, rawGiven: Record<string, unknown>): { visible: Set<string>; answers: Record<string, unknown> } {
  const flat = flatten(cfg.blocks);
  const byId = new Map(questionsOf(cfg).map((q) => [q.id, q] as const));
  const given: Record<string, unknown> = { ...rawGiven };
  for (const [id, q] of byId) if (id in given) given[id] = canonValue(q, given[id]);
  const revealers = new Map<string, { q: string; opt: string }[]>();
  for (const f of flat) {
    const q = f.block;
    if (q.type !== "question") continue;
    for (const [key, targets] of Object.entries((q as Question).reveal ?? {})) {
      const opt = optionIdOf(q as Question, key) ?? key;
      for (const t of targets) revealers.set(t, [...(revealers.get(t) ?? []), { q: q.id, opt }]);
    }
  }
  const visible = new Set<string>();
  const answers: Record<string, unknown> = {};
  const shown = new Map<string, boolean>();
  for (const f of flat) {
    const b = f.block;
    const own = (b as { show_if?: FilterNode }).show_if;
    let ok = !f.group || shown.get(f.group.block.id) === true;
    if (ok && own) ok = evalCondition(canonCondition(own, byId), answers);
    const rv = revealers.get(b.id);
    if (ok && rv) ok = rv.some((r) => asList(answers[r.q]).some((h) => same(h, r.opt)));
    if (b.type === "question" && (b as Question).hidden) ok = true;
    shown.set(b.id, ok);
    if (ok) visible.add(b.id);
    if (b.type === "question" && ok && !isEmptyAnswer(given[b.id])) answers[b.id] = given[b.id];
  }
  return { visible, answers };
}

// ---------------------------------------------------------------------------------------------
// what the person filling the form gets (design module7 3.3)
// ---------------------------------------------------------------------------------------------

/** Fields of a question that only the server may know. The public copy never holds a table id, a column key, an answer key or the settings of a data source. */
const SERVER_ONLY = ["column_id", "answer", "answers", "correct", "points", "explanation", "grading", "source", "scoring", "rubric", "partial", "match_accents", "fill_self"] as const;

export function publicConfig(cfg: FormConfig, disabled: Set<string>): Record<string, unknown> {
  const clean = (list: Block[]): Block[] =>
    list
      .filter((b) => !(b.type === "question" && disabled.has(b.id)))
      .map((b) => {
        if (b.type === "group") return { ...b, blocks: clean((b as { blocks: Block[] }).blocks) } as Block;
        if (b.type !== "question") return b;
        const copy: Record<string, unknown> = { ...b };
        for (const k of SERVER_ONLY) delete copy[k];
        return copy as Block;
      });
  const { quiz: _quiz, ...rest } = cfg as FormConfig & { quiz?: unknown };
  return { ...rest, blocks: clean(cfg.blocks) };
}
