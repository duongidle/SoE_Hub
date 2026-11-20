import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, jsonParam } from "@soe/shared";
import { parseStored, toDisplayFormula, walk, type Node } from "@soe/formula";
import { defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { loadTableAccess } from "./access";
import { OwnerIndex } from "./computed";
import { Id } from "./shared";
import { TableSchema } from "./table-schema";
import { normalizeOptions } from "./column-types";
import { OPTION_MEANINGS, type DhColumn, type SelectOption } from "./types";

/**
 * Renaming an option of a select column (design module2 section 6, module4 19d). A formula that compares the column with the old name as text
 * (`[Status]="Won"`, `COUNTIFS([Status], "Won")`, `SWITCH`, `XLOOKUP`...) does not fail after the rename: it silently answers wrong. So the server finds
 * those formulas first, the screen lists them, and by default they are rewritten with the new name. The search and the rewrite use the formula parser
 * (the positions of the text literals), never a text pattern over the formula.
 */

export interface OptionRename {
  from: string;
  to: string;
}

const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();

/** Options that kept their id and changed name. */
export function optionRenames(before: SelectOption[], after: SelectOption[]): OptionRename[] {
  const was = new Map(before.map((o) => [o.id, o.name]));
  const out: OptionRename[] = [];
  for (const o of after) {
    const old = was.get(o.id);
    if (old !== undefined && norm(old) !== norm(o.name) && old !== o.name) out.push({ from: old, to: o.name });
  }
  return out;
}

/** Functions whose criteria text follows the range it tests (`COUNTIFS(range, "Won", ...)`). */
const CRITERIA_FNS = new Set(["COUNTIF", "COUNTIFS", "SUMIF", "SUMIFS", "AVERAGEIF", "AVERAGEIFS", "MAXIFS", "MINIFS"]);
/** Functions whose first argument is the value looked for in the column given as second argument. */
const LOOKUP_FNS = new Set(["XLOOKUP", "MATCH", "XMATCH"]);

type Lit = Extract<Node, { t: "str" }>;
export interface Hit {
  node: Lit;
  rename: OptionRename;
  /** The comparison operator written inside a criteria text (`<>Won`), kept when the name is replaced. */
  prefix: string;
}

/** The text literals of a stored formula that compare column `target` with an old option name. */
export function findHits(stored: string, target: { tableId: string; key: string }, formulaTableId: string, renames: OptionRename[]): Hit[] {
  const parsed = parseStored(stored);
  if (!parsed.ok) return [];
  const isCol = (n: Node | undefined) => !!n && n.t === "key" && n.key === target.key && (n.table ?? formulaTableId) === target.tableId;
  const hits = new Map<number, Hit>();
  const lit = (n: Node | undefined, criteria: boolean) => {
    if (!n || n.t !== "str") return;
    const m = criteria ? /^(<>|=)?([\s\S]*)$/.exec(n.v)! : ([n.v, "", n.v] as const);
    const prefix = m[1] ?? "";
    const r = renames.find((x) => norm(x.from) === norm(m[2]!));
    if (r) hits.set(n.s, { node: n, rename: r, prefix });
  };
  walk(parsed.ast, (n) => {
    if (n.t === "bin" && (n.op === "=" || n.op === "<>")) {
      if (isCol(n.l)) lit(n.r, false);
      if (isCol(n.r)) lit(n.l, false);
    } else if (n.t === "call") {
      const fn = n.name.toUpperCase();
      n.args.forEach((a, i) => {
        if (!isCol(a)) return;
        if (CRITERIA_FNS.has(fn)) lit(n.args[i + 1], true);
        else if (LOOKUP_FNS.has(fn) && i === 1) lit(n.args[0], false);
        else if (fn === "SWITCH" && i === 0) for (let j = 1; j < n.args.length - 1; j += 2) lit(n.args[j], false);
      });
    }
  });
  return [...hits.values()];
}

/** The stored formula with the matching literals written with the new names. */
export function rewriteStored(stored: string, hits: Hit[]): string {
  let out = stored;
  for (const h of [...hits].sort((a, b) => b.node.s - a.node.s)) {
    out = `${out.slice(0, h.node.s)}"${(h.prefix + h.rename.to).replace(/"/g, '""')}"${out.slice(h.node.e)}`;
  }
  return out;
}

export interface AffectedFormula {
  column: DhColumn;
  tableId: string;
  tableName: string;
  before: string;
  after: string;
  /** Display text of the rewritten formula (what the column editor shows). */
  afterDisplay: string;
  count: number;
  /** Owner of the table that holds the formula: a template column renamed by a Manager reaches formulas of every person who reads it (module4 19 work 5, 9). */
  ownerId: string;
}

type Ctx = Pick<HandlerCtx, "db" | "actor">;

/** Formulas that depend on the column and compare it with an old option name: those of the owner's tables, and, for a template table, those of everyone who reads it. */
export async function findAffectedFormulas(ctx: Ctx, ownerId: string, col: DhColumn, tableId: string, renames: OptionRename[]): Promise<AffectedFormula[]> {
  if (renames.length === 0) return [];
  const deps = await ctx.db.execute(sql`SELECT DISTINCT c.id AS id, d.owner_id FROM dh_formula_deps f JOIN dh_columns c ON c.id = f.column_id
    JOIN dh_tables t ON t.id = c.table_id JOIN dh_datahubs d ON d.id = t.datahub_id
    WHERE /*scope*/ f.src_table_id = ${tableId}::uuid AND f.src_key = ${col.key} AND c.deleted_at IS NULL AND c.type = 'formula'`);
  const byOwner = new Map<string, string[]>();
  for (const r of deps.rows as { id: string; owner_id: string }[]) byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r.id]);
  if (byOwner.size === 0) return [];
  const out: AffectedFormula[] = [];
  for (const [owner, ids] of byOwner) {
    // Another owner's formulas only count when this is a template table (the owner of those formulas reads it); anything else cannot reach it.
    if (owner !== ownerId && !(await isTemplateTable(ctx, tableId))) continue;
    const ix = await OwnerIndex.load(ctx.db, owner);
    for (const t of ix.tableById.values()) {
      if (t.foreign) continue; // formulas of another owner are found under that owner
      for (const c of t.columns) {
        if (!ids.includes(c.id) || c.type !== "formula" || typeof c.config.expr !== "string") continue;
        const hits = findHits(c.config.expr, { tableId, key: col.key }, t.id, renames);
        if (hits.length === 0) continue;
        const nameOf = (tb: string | null, k: string) => ix.namesOf(t.id, tb, k);
        const after = rewriteStored(c.config.expr, hits);
        out.push({ column: c as unknown as DhColumn, tableId: t.id, tableName: t.name, before: toDisplayFormula(c.config.expr, nameOf), after: toDisplayFormula(after, nameOf), afterDisplay: toDisplayFormula(after, nameOf), count: hits.length, ownerId: owner });
      }
    }
  }
  return out;
}

async function isTemplateTable(ctx: Ctx, tableId: string): Promise<boolean> {
  const res = await ctx.db.execute(sql`SELECT 1 FROM dh_tables WHERE /*scope*/ id = ${tableId}::uuid AND template_id IS NOT NULL`);
  return res.rows.length > 0;
}

const OptionIn = z.object({ id: z.string().max(100).optional(), name: z.string().min(1).max(100), color: z.string().max(20).optional(), meaning: z.enum(OPTION_MEANINGS).optional() });

export const optionRenameOperations = [
  defineQuery({
    name: "datahub.column.option_impact",
    summary: "Đổi tên lựa chọn của cột chọn thì công thức nào so chữ với tên cũ? Xem trước, chưa ghi gì (chỉ chủ).",
    description:
      "Gửi danh sách lựa chọn mới của cột (mỗi lựa chọn có `id` để biết cái nào được đổi tên). Trả các lựa chọn bị đổi tên và các công thức so sánh cột với tên cũ dạng chữ " +
      "(`[Status]=\"Won\"`, `COUNTIFS([Status],\"Won\")`, `SWITCH`, `XLOOKUP`). Công thức không lỗi mà ra sai im lặng nếu không cập nhật; " +
      "`datahub.column.update` với `update_formulas: true` viết lại chúng bằng tên mới.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ table_id: Id, column: z.string().min(1).max(100), options: jsonParam(z.array(OptionIn).max(200)) }),
    output: z.object({
      renames: z.array(z.object({ from: z.string(), to: z.string() })),
      formulas: z.array(z.object({ table_id: Id, table_name: z.string(), column_id: Id, column_name: z.string(), before: z.string(), after: z.string(), occurrences: z.number().int() })),
    }),
    http: { method: "GET", path: "/tables/:table_id/columns/:column/option-impact" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "owner");
      const schema = await TableSchema.load(ctx.db, acc);
      const col = schema.tryResolve(i.column);
      if (!col || col.deletedAt) throw new AppError("not_found", `Không tìm thấy cột "${i.column}".`);
      if (col.type !== "single_select" && col.type !== "multi_select") throw new AppError("validation_error", "Chỉ cột chọn có lựa chọn để đổi tên.");
      const renames = optionRenames((col.config.options as SelectOption[] | undefined) ?? [], normalizeOptions(i.options ?? []));
      const found = await findAffectedFormulas(ctx, acc.datahub.ownerId, col, acc.tableId, renames);
      return {
        renames,
        formulas: found.map((f) => ({ table_id: f.tableId, table_name: f.tableName, column_id: f.column.id, column_name: f.column.name, before: f.before, after: f.after, occurrences: f.count })),
      };
    },
  }),
];
