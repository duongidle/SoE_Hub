import { sql } from "drizzle-orm";
import type { Executor } from "@soe/db";
import type { Actor } from "@soe/shared";
import { readableRows } from "./access";
import { resolveLinkTarget } from "./link-targets";
import { hasAttrs } from "./user-values";
import type { CellIssue, ResolvedCol } from "./import-plan";

/**
 * Cells of an import that name PEOPLE or LINKED ROWS (design module2 import, Stage 4.7): the file holds text, the row writer needs ids.
 * - A user cell: emails or full names, separated by `,` `;` `|`. Unknown email, unknown name or a name two people share is a problem of that row
 *   (never a guess). Whether the person may be in the cell (a member of the table) is checked by the row writer, as for any channel.
 * - A relation cell: values of the KEY column of the target table (the mapping's `link_by`, else the target's only unique column), separated the same way.
 *   A value that matches no row, or more than one row, is a problem of that row.
 * Formula, lookup and rollup columns are still not imported.
 */
type Ctx = { db: Executor; actor: Actor };

export interface RefCell {
  col: ResolvedCol;
  tokens: string[];
}

export const REF_TYPES = ["user", "relation"] as const;
export const isRefType = (t: string): t is (typeof REF_TYPES)[number] => (REF_TYPES as readonly string[]).includes(t);

export const splitTokens = (text: string): string[] =>
  [...new Set(text.split(/[,;|\n]/).map((x) => x.normalize("NFC").replace(/\s+/g, " ").trim()).filter(Boolean))];

type Hit = { id: string } | { error: string };
const TEXTUAL_KEYS = new Set(["text", "long_text", "number", "email", "phone", "url", "auto_number"]);

export class RefResolver {
  private people = new Map<string, Hit>();
  /** `${table}|${key}` -> value -> hit. */
  private links = new Map<string, Map<string, Hit>>();
  private keyCols = new Map<string, { key: string; name: string } | { error: string }>();

  constructor(
    private readonly ctx: Ctx,
    private readonly ownerId: string,
  ) {}

  private async loadPeople(tokens: string[]): Promise<void> {
    const fresh = tokens.filter((t) => !this.people.has(t.toLowerCase()));
    if (fresh.length === 0) return;
    const lower = [...new Set(fresh.map((t) => t.toLowerCase()))];
    const arr = `{${lower.map((x) => `"${x.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
    const res = await this.ctx.db.execute(sql`SELECT id, lower(email) AS email, lower(regexp_replace(btrim(full_name), '[[:space:]]+', ' ', 'g')) AS name FROM users
      WHERE kind = 'person' AND deleted_at IS NULL AND (lower(email) = ANY(${arr}::text[]) OR lower(regexp_replace(btrim(full_name), '[[:space:]]+', ' ', 'g')) = ANY(${arr}::text[]))`);
    const byEmail = new Map<string, string>();
    const byName = new Map<string, string[]>();
    for (const r of res.rows as { id: string; email: string; name: string }[]) {
      byEmail.set(r.email, r.id);
      byName.set(r.name, [...(byName.get(r.name) ?? []), r.id]);
    }
    for (const t of lower) {
      if (t.includes("@")) this.people.set(t, byEmail.has(t) ? { id: byEmail.get(t)! } : { error: `Không có người dùng nào có email "${t}".` });
      else {
        const ids = byName.get(t) ?? [];
        this.people.set(t, ids.length === 1 ? { id: ids[0]! } : ids.length === 0 ? { error: `Không có người dùng tên "${t}".` } : { error: `Có ${ids.length} người dùng tên "${t}". Dùng email để chọn đúng người.` });
      }
    }
  }

  private async keyColumnOf(target: string, linkBy: string | undefined): Promise<{ key: string; name: string } | { error: string }> {
    const ck = `${target}|${linkBy ?? ""}`;
    const cached = this.keyCols.get(ck);
    if (cached) return cached;
    const res = await this.ctx.db.execute(sql`SELECT key, name, type, is_unique FROM dh_columns WHERE /*scope:system*/ table_id = ${target}::uuid AND deleted_at IS NULL ORDER BY position`);
    const cols = res.rows as { key: string; name: string; type: string; is_unique: boolean }[];
    let out: { key: string; name: string } | { error: string };
    if (linkBy) {
      const c = cols.find((x) => x.key === linkBy || x.name.toLowerCase() === linkBy.trim().toLowerCase());
      out = !c ? { error: `Bảng đích không có cột "${linkBy}" để khớp liên kết.` } : !TEXTUAL_KEYS.has(c.type) ? { error: `Cột "${c.name}" của bảng đích không dùng để khớp liên kết được (kiểu cột).` } : { key: c.key, name: c.name };
    } else {
      const uniq = cols.filter((x) => x.is_unique && TEXTUAL_KEYS.has(x.type));
      out = uniq.length === 1 ? { key: uniq[0]!.key, name: uniq[0]!.name } : { error: uniq.length === 0 ? "Bảng đích không có cột Duy nhất để khớp liên kết. Chọn cột khớp bằng `link_by`." : "Bảng đích có nhiều cột Duy nhất. Chọn cột khớp bằng `link_by`." };
    }
    this.keyCols.set(ck, out);
    return out;
  }

  private async loadLinks(target: string, key: { key: string; name: string }, tokens: string[]): Promise<Map<string, Hit>> {
    const id = `${target}|${key.key}`;
    let m = this.links.get(id);
    if (!m) this.links.set(id, (m = new Map()));
    const fresh = [...new Set(tokens.filter((t) => !m!.has(t)))];
    if (fresh.length === 0) return m;
    const lt = await resolveLinkTarget(this.ctx as never, this.ownerId, target);
    if (!lt) {
      for (const t of fresh) m.set(t, { error: "Bảng liên kết không còn dùng được." });
      return m;
    }
    const keyExpr = sql.raw(`r.data->>'${key.key.replace(/[^A-Za-z0-9_]/g, "")}'`);
    const arr = `{${fresh.map((x) => `"${x.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
    const res = lt.own
      ? await this.ctx.db.execute(sql`SELECT r.id, btrim(${keyExpr}) AS v FROM dh_rows r JOIN dh_tables t ON t.id = r.table_id JOIN dh_datahubs d ON d.id = t.datahub_id
          WHERE /*scope:rows*/ r.table_id = ${target}::uuid AND r.deleted_at IS NULL AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND d.owner_id = ${this.ownerId}::uuid AND btrim(${keyExpr}) = ANY(${arr}::text[])`)
      : await this.ctx.db.execute(sql`SELECT r.id, btrim(${keyExpr}) AS v FROM dh_rows r WHERE ${readableRows(lt.acc, "r")} AND btrim(${keyExpr}) = ANY(${arr}::text[])`);
    const found = new Map<string, string[]>();
    for (const r of res.rows as { id: string; v: string }[]) found.set(r.v, [...(found.get(r.v) ?? []), r.id]);
    for (const t of fresh) {
      const ids = found.get(t) ?? [];
      m.set(t, ids.length === 1 ? { id: ids[0]! } : ids.length === 0 ? { error: `Không có dòng nào ở bảng đích có "${key.name}" = "${t}".` } : { error: `Có ${ids.length} dòng ở bảng đích có "${key.name}" = "${t}". Chọn cột khớp là cột không trùng.` });
    }
    return m;
  }

  /**
   * Turns the reference cells of one row into stored-ready input (ids), or issues. A cell that cannot be resolved is reported and left out of `values`.
   */
  async resolve(rowNo: number, cells: RefCell[]): Promise<{ values: Record<string, unknown>; issues: CellIssue[] }> {
    const values: Record<string, unknown> = {};
    const issues: CellIssue[] = [];
    for (const { col, tokens } of cells) {
      const key = col.existing?.key ?? col.name;
      const bad = (message: string) => issues.push({ row: rowNo, column: col.name, message });
      if (col.type === "user") {
        await this.loadPeople(tokens);
        const ids: string[] = [];
        let failed = false;
        for (const t of tokens) {
          const h = this.people.get(t.toLowerCase())!;
          if ("error" in h) {
            bad(h.error);
            failed = true;
          } else if (!ids.includes(h.id)) ids.push(h.id);
        }
        if (failed || ids.length === 0) continue;
        if (hasAttrs({ type: "user", config: col.config })) values[key] = ids.map((id) => ({ id, attrs: {} }));
        else if (ids.length > 1) bad("Cột này chỉ nhận một người.");
        else values[key] = ids[0];
      } else {
        const target = col.config.target_table_id;
        if (typeof target !== "string") {
          bad("Cột liên kết chưa trỏ tới bảng nào.");
          continue;
        }
        const k = await this.keyColumnOf(target, col.linkBy);
        if ("error" in k) {
          bad(k.error);
          continue;
        }
        const m = await this.loadLinks(target, k, tokens);
        const ids: string[] = [];
        let failed = false;
        for (const t of tokens) {
          const h = m.get(t)!;
          if ("error" in h) {
            bad(h.error);
            failed = true;
          } else if (!ids.includes(h.id)) ids.push(h.id);
        }
        if (failed || ids.length === 0) continue;
        if (col.config.multiple === false && ids.length > 1) bad("Cột này chỉ liên kết được một dòng.");
        else values[key] = ids;
      }
    }
    return { values, issues };
  }
}
