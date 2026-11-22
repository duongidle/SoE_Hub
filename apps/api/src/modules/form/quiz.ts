import { sql } from "drizzle-orm";
import type { Executor } from "@soe/db";
import type { HandlerCtx } from "../../core/types";
import type { TableAccess } from "../datahub/access";
import { createColumn } from "../datahub/columns";
import { isEmptyAnswer, questionsOf, type FormConfig, type Question, type Quiz } from "./config";
import type { LiveColumn } from "./shared";

/** Grading of a quiz (design module7 6.1-6.4). Pure functions: the one place a score is worked out; the submit and the grader both call it. */

export const AUTO_INPUTS = new Set(["single_select", "multi_select", "number", "currency", "percent", "rating", "scale", "text"]);
const NUMERIC = new Set(["number", "currency", "percent", "rating", "scale"]);

export const isManual = (q: Question): boolean => (q.points ?? 0) > 0 && (!AUTO_INPUTS.has(q.input) || q.answer === undefined || q.answer === null);
export const isGraded = (q: Question): boolean => (q.points ?? 0) > 0;

/** Result of one question. `graded: false` is a hand-graded question nobody has scored yet. */
export interface ItemScore {
  question_id: string;
  max: number;
  points: number;
  manual: boolean;
  graded: boolean;
  correct?: boolean | null;
  comment?: string | null;
  /** Rubric: score of each criterion. */
  criteria?: Record<string, number>;
  floor_failed?: boolean;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : isEmptyAnswer(v) ? [] : [v]);

const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").normalize("NFC");
export function normText(s: unknown, accents: boolean): string {
  let t = String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!accents) t = stripAccents(t);
  return t;
}

/** The option a value (id or name) stands for, as an id; unknown values stay as typed. */
function optionId(q: Question, v: unknown): string {
  const s = String(v ?? "").trim();
  const o = (q.options ?? []).find((x) => x.id === s || x.label.trim().toLowerCase() === s.toLowerCase());
  return o?.id ?? s.toLowerCase();
}

/** Points of one auto-graded question. */
function autoPoints(q: Question, given: unknown): { points: number; correct: boolean } {
  const max = q.points ?? 0;
  if (isEmptyAnswer(given)) return { points: 0, correct: false };
  const key = q.answer;
  if (q.input === "single_select") return optionId(q, asList(given)[0]) === optionId(q, key) ? { points: max, correct: true } : { points: 0, correct: false };
  if (q.input === "multi_select") {
    const want = new Set(asList(key).map((x) => optionId(q, x)));
    const have = new Set(asList(given).map((x) => optionId(q, x)));
    const hit = [...have].filter((x) => want.has(x)).length;
    const wrong = have.size - hit;
    if (hit === want.size && wrong === 0) return { points: max, correct: true };
    if (q.partial && want.size > 0) return { points: Math.max(0, (hit - wrong) / want.size) * max, correct: false };
    return { points: 0, correct: false };
  }
  if (NUMERIC.has(q.input)) {
    const v = num(given);
    if (v === null) return { points: 0, correct: false };
    const k = key as unknown;
    const ok = typeof k === "object" && k !== null ? (num((k as { min?: unknown }).min) ?? -Infinity) <= v && v <= (num((k as { max?: unknown }).max) ?? Infinity) : num(k) !== null && Math.abs(v - (num(k) as number)) < 1e-9;
    return ok ? { points: max, correct: true } : { points: 0, correct: false };
  }
  // short text: a list of accepted answers
  const acc = !!q.match_accents;
  const got = normText(given, acc);
  const ok = asList(key).some((a) => normText(a, acc) === got);
  return ok ? { points: max, correct: true } : { points: 0, correct: false };
}

export interface Graded {
  items: ItemScore[];
  score: number;
  max: number;
  pending: boolean;
  floorFailed: boolean;
}

/** Totals of a list of item scores. */
export function totals(items: ItemScore[]): Omit<Graded, "items"> {
  return {
    score: items.reduce((n, i) => n + i.points, 0),
    max: items.reduce((n, i) => n + i.max, 0),
    pending: items.some((i) => i.manual && !i.graded),
    floorFailed: items.some((i) => i.floor_failed),
  };
}

/** Scores the answers (only the questions that were shown). Hand-graded questions start as not graded. */
export function gradeAnswers(cfg: FormConfig, visible: Set<string>, answers: Record<string, unknown>): Graded {
  const items: ItemScore[] = [];
  for (const q of questionsOf(cfg)) {
    if (!isGraded(q) || !visible.has(q.id)) continue;
    if (isManual(q)) items.push({ question_id: q.id, max: q.points!, points: 0, manual: true, graded: false });
    else {
      const r = autoPoints(q, answers[q.id]);
      items.push({ question_id: q.id, max: q.points!, points: r.points, manual: false, graded: true, correct: r.correct });
    }
  }
  return { items, ...totals(items) };
}

/** Points of a rubric question from the score of each criterion: sum of (score / scale top x weight) over the weights, times the question's points. A criterion below its floor sets `floor_failed`. */
export function rubricPoints(q: Question, criteria: Record<string, number>): { points: number; floor_failed: boolean } {
  const rubric = q.rubric ?? [];
  const wsum = rubric.reduce((n, c) => n + (c.weight ?? 1), 0);
  if (wsum <= 0) return { points: 0, floor_failed: false };
  let acc = 0;
  let floorFailed = false;
  for (const c of rubric) {
    const s = Math.min(Math.max(criteria[c.id] ?? 0, 0), c.max ?? 5);
    acc += ((s / (c.max ?? 5)) * (c.weight ?? 1)) / wsum;
    if (c.floor !== undefined && s < c.floor) floorFailed = true;
  }
  return { points: round(acc * (q.points ?? 0)), floor_failed: floorFailed };
}

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export type Result = "pass" | "fail" | "pending" | "none";

/** The shown score and the result of a quiz response (design module7 6.1, 6.3). */
export function summarize(quiz: Quiz, t: Omit<Graded, "items">): { score: number; max: number; result: Result } {
  const hundred = quiz.scale === "100";
  const score = round(hundred ? (t.max > 0 ? (t.score / t.max) * 100 : 0) : t.score);
  const max = hundred ? 100 : round(t.max);
  let result: Result = "none";
  if (t.pending) result = "pending";
  else if (t.floorFailed) result = "fail";
  else if (quiz.pass) {
    const pct = t.max > 0 ? (t.score / t.max) * 100 : 0;
    const ok = quiz.pass.type === "percent" ? pct + 1e-9 >= quiz.pass.value : score + 1e-9 >= quiz.pass.value;
    result = ok ? "pass" : "fail";
  }
  return { score, max, result };
}

export const RESULT_LABEL: Record<Result, string | null> = { pass: "Đạt", fail: "Không đạt", pending: "Chờ chấm", none: null };

// ---------------------------------------------------------------------------------------------
// the columns of the target table (design module7 6.4)
// ---------------------------------------------------------------------------------------------

export const QUIZ_COLUMNS = {
  score: { name: "Điểm", type: "number" },
  max: { name: "Điểm tối đa", type: "number" },
  result: { name: "Kết quả", type: "single_select" },
  attempt: { name: "Lần làm", type: "number" },
  grader: { name: "Người chấm", type: "text" },
  gradedAt: { name: "Ngày chấm", type: "datetime" },
} as const;
export type QuizColumn = keyof typeof QUIZ_COLUMNS;

/** Looks the columns up by name and type (like the version column); a person may have renamed one, then it is simply not written. */
export function quizColumnKeys(cols: Map<string, LiveColumn>): Partial<Record<QuizColumn, string>> {
  const out: Partial<Record<QuizColumn, string>> = {};
  for (const [k, def] of Object.entries(QUIZ_COLUMNS) as [QuizColumn, { name: string; type: string }][]) {
    const c = [...cols.values()].find((x) => x.type === def.type && x.name.toLowerCase() === def.name.toLowerCase());
    if (c) out[k] = c.key;
  }
  return out;
}

/** Creates the quiz columns the table does not have yet (publish of a quiz). */
export async function ensureQuizColumns(ctx: HandlerCtx, acc: TableAccess, cols: Map<string, LiveColumn>): Promise<void> {
  const have = quizColumnKeys(cols);
  for (const [k, def] of Object.entries(QUIZ_COLUMNS) as [QuizColumn, { name: string; type: string }][]) {
    if (have[k]) continue;
    const config = k === "result" ? { options: [{ name: "Đạt" }, { name: "Không đạt" }, { name: "Chờ chấm" }] } : {};
    await createColumn(ctx, acc, { name: def.name, type: def.type as never, config, allow_edit: false, description: "Cột của bài kiểm tra: do hệ thống ghi." }, {});
  }
}

/** The cells a score writes into the target table. */
export function scoreCells(cols: Map<string, LiveColumn>, s: { score: number; max: number; result: Result; attempt?: number; graderName?: string | null; gradedAt?: Date | null }): Record<string, unknown> {
  const k = quizColumnKeys(cols);
  const data: Record<string, unknown> = {};
  const set = (c: QuizColumn, v: unknown) => {
    if (k[c]) data[k[c]!] = v;
  };
  set("score", s.score);
  set("max", s.max);
  set("result", RESULT_LABEL[s.result]);
  if (s.attempt !== undefined) set("attempt", s.attempt);
  set("grader", s.graderName ?? null);
  set("gradedAt", s.gradedAt ? s.gradedAt.toISOString() : null);
  return data;
}

export async function attemptsOf(db: Executor, formId: string, userId: string): Promise<number> {
  const r = await db.execute(sql`SELECT count(*)::int AS n FROM form_responses WHERE form_id = ${formId}::uuid AND user_id = ${userId}::uuid`);
  return (r.rows[0] as { n: number }).n;
}
