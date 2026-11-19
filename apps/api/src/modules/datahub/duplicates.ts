import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { AppError, DH_BATCH_MAX } from "@soe/shared";
import { exprOf } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import { loadTableAccess, type TableAccess } from "./access";
import { columnTypeDef } from "./column-types";
import { applyRowOps, type RowOp } from "./rows";
import { rowFromDb, TableSchema } from "./table-schema";
import { Id, ROW_EVENTS } from "./shared";
import type { Stored } from "./types";

/**
 * Find duplicate rows (design module2 section 7a). The key of a row is its values in the chosen columns, normalised the
 * way the search is: accents removed, lower case, runs of spaces collapsed, ends trimmed. A row whose key columns are all
 * empty has no key and never counts as a duplicate. Everything is computed by one SQL aggregate over the table.
 */

export const MAX_KEY_COLUMNS = 5;
/** Rows listed per group in the answer; `count` still holds the true size. */
export const MAX_IDS_PER_GROUP = 50;
export const MAX_GROUPS_PER_PAGE = 200;
/** Groups one `resolve` with `all` handles per call (the caller repeats while `remaining_groups` > 0). */
export const RESOLVE_ALL_CHUNK = 1000;
/** Largest group `all` resolves in one go. */
const ALL_GROUP_ROWS_CAP = 2000;
const SEP = "\u001f";

/** SQL of the normalised key of every row, and of its "has a key" test. */
function keySql(schema: TableSchema, columns: string[]): { key: SQL; keyed: SQL; columns: { key: string; name: string }[] } {
  if (columns.length === 0 || columns.length > MAX_KEY_COLUMNS) throw new AppError("validation_error", `Chọn từ 1 đến ${MAX_KEY_COLUMNS} cột để so.`);
  const fields = schema.fieldMap();
  const picked: { key: string; name: string }[] = [];
  const parts: SQL[] = [];
  for (const ref of columns) {
    const col = schema.resolve(ref);
    if (picked.some((p) => p.key === col.key)) throw new AppError("validation_error", `Cột "${col.name}" được chọn hai lần.`);
    const spec = fields[col.key];
    const def = columnTypeDef(col.type);
    if (!spec || !def.fieldType || col.type === "attachment") throw new AppError("validation_error", `Không so được theo cột "${col.name}" (${def.label}).`, { column: col.name });
    picked.push({ key: col.key, name: col.name });
    parts.push(sql`coalesce(soe_unaccent(lower(btrim(regexp_replace((${exprOf(spec)})::text, '\\s+', ' ', 'g')))), '')`);
  }
  const key = sql`concat_ws(${SEP}, ${sql.join(parts, sql`, `)})`;
  // Not keyed when every part is empty (concat of empty parts is only separators).
  const keyed = sql`replace(${key}, ${SEP}, '') <> ''`;
  return { key, keyed, columns: picked };
}

interface GroupRef {
  ids: string[];
  count: number;
}

/** The groups in display order (largest first, then by the first row number), a page of them, plus the totals. */
async function readGroups(ctx: { db: import("@soe/db").Executor }, access: TableAccess, schema: TableSchema, columns: string[], offset: number, limit: number, idCap = MAX_IDS_PER_GROUP) {
  const k = keySql(schema, columns);
  const base = sql`SELECT id, row_no, ${k.key} AS dk FROM dh_rows WHERE ${access.scope()} AND deleted_at IS NULL AND ${k.keyed}`;
  const totals = await ctx.db.execute(sql`WITH k AS (${base}), g AS (SELECT dk, count(*) AS n FROM k GROUP BY dk HAVING count(*) > 1) SELECT count(*)::int AS groups, coalesce(sum(n), 0)::int AS rows FROM g`);
  const t = totals.rows[0] as { groups: number; rows: number };
  const page = await ctx.db.execute(sql`
    WITH k AS (${base}),
    g AS (SELECT dk, count(*)::int AS n, min(row_no) AS first_no FROM k GROUP BY dk HAVING count(*) > 1 ORDER BY count(*) DESC, min(row_no), dk LIMIT ${limit} OFFSET ${offset})
    SELECT g.n, (SELECT array_agg(x.id ORDER BY x.row_no) FROM (SELECT k.id, k.row_no FROM k WHERE k.dk = g.dk ORDER BY k.row_no LIMIT ${idCap}) x) AS ids
    FROM g ORDER BY g.n DESC, g.first_no, g.dk`);
  const groups: GroupRef[] = (page.rows as { n: number; ids: string[] }[]).map((r) => ({ ids: r.ids, count: r.n }));
  return { columns: k.columns, total_groups: t.groups, total_rows: t.rows, groups };
}

const ResolveGroup = z.object({
  keep_id: Id,
  remove_ids: z.array(Id).min(1).max(MAX_IDS_PER_GROUP),
  /** Merge: values to write on the kept row, by column key or name (an empty value clears the cell). */
  values: z.record(z.string(), z.unknown()).optional(),
});

/** Cells the merge may copy: writable, not an attachment (files belong to the person who uploaded them), not a link unless the owner merges. */
function mergeable(schema: TableSchema, access: TableAccess) {
  return schema.alive.filter((c) => {
    const def = columnTypeDef(c.type);
    return def.writable && c.type !== "attachment" && (c.type !== "relation" || access.level === "owner");
  });
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

export const duplicateOperations = [
  defineQuery({
    name: "datahub.row.duplicates",
    summary: "Tìm các nhóm dòng trùng nhau theo một hoặc vài cột (bỏ dấu, không phân biệt hoa thường, bỏ khoảng trắng thừa).",
    description: `Chọn 1 đến ${MAX_KEY_COLUMNS} cột. Dòng có mọi cột khoá đều trống thì không tính là trùng. Mỗi nhóm trả mã các dòng (tối đa ${MAX_IDS_PER_GROUP}, \`count\` là số dòng thật); đọc nội dung dòng bằng \`datahub.row.list\` với bộ lọc \`_id in [...]\`. Xếp nhóm lớn trước. Phân trang bằng \`offset\`. Cần quyền Sửa dữ liệu của bảng.`,
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({
      table_id: Id,
      columns: z.string().min(1).describe("Mã hoặc tên các cột để so, cách nhau bằng dấu phẩy (tên có dấu phẩy thì dùng mã cột)."),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
      limit: z.coerce.number().int().min(1).max(MAX_GROUPS_PER_PAGE).default(50),
    }),
    output: z.object({
      columns: z.array(z.object({ key: z.string(), name: z.string() })),
      total_groups: z.number().int(),
      total_rows: z.number().int().describe("Tổng số dòng nằm trong các nhóm trùng."),
      groups: z.array(z.object({ ids: z.array(Id), count: z.number().int() })),
      has_more: z.boolean(),
    }),
    http: { method: "GET", path: "/tables/:table_id/duplicates" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "edit_data");
      const schema = await TableSchema.load(ctx.db, acc);
      const r = await readGroups(ctx, acc, schema, splitRefs(i.columns, schema), i.offset, i.limit);
      return { ...r, has_more: i.offset + r.groups.length < r.total_groups };
    },
  }),

  defineCommand({
    name: "datahub.row.duplicates.resolve",
    summary: "Xử lý dòng trùng: giữ một dòng và xoá các dòng còn lại (có thể gộp giá trị vào dòng giữ), cho vài nhóm hoặc cho mọi nhóm.",
    description:
      "Dạng 1: `groups` = danh sách {keep_id, remove_ids, values?}; `values` ghi lên dòng giữ trước khi xoá (gộp). Dạng 2: `all` = {columns, keep, fill_empty}: áp một cách cho mọi nhóm trùng theo `columns`; `keep` = first (dòng số nhỏ nhất), last (lớn nhất) hoặc most_filled (nhiều ô có giá trị nhất); `fill_empty` = điền các ô trống của dòng giữ bằng giá trị của dòng bị xoá. Mỗi lần gọi `all` xử lý tối đa " +
      `${RESOLVE_ALL_CHUNK} nhóm; còn \`remaining_groups\` > 0 thì gọi lại. Dòng bị xoá vào thùng rác (khôi phục được); việc gộp ghi lịch sử dòng như sửa tay. Cột Đính kèm không được gộp.`,
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: ROW_EVENTS,
    input: z
      .object({
        table_id: Id,
        groups: z.array(ResolveGroup).min(1).max(200).optional(),
        all: z.object({ columns: z.array(z.string().min(1).max(100)).min(1).max(MAX_KEY_COLUMNS), keep: z.enum(["first", "last", "most_filled"]), fill_empty: z.boolean().default(false) }).optional(),
      })
      .refine((v) => (v.groups ? 1 : 0) + (v.all ? 1 : 0) === 1, { message: "Gửi `groups` hoặc `all`, không gửi cả hai." }),
    output: z.object({ groups_resolved: z.number().int(), rows_removed: z.number().int(), rows_merged: z.number().int(), remaining_groups: z.number().int(), seq: z.number().int() }),
    http: { method: "POST", path: "/tables/:table_id/duplicates/resolve" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "edit_data");
      const schema = await TableSchema.load(ctx.db, acc);
      let plan: { keep: string; version: number; remove: string[]; values: Record<string, unknown> }[];
      let remaining = 0;
      if (i.groups) {
        plan = await explicitPlan(ctx.db, acc, i.groups);
      } else {
        const a = i.all!;
        const r = await readGroups(ctx, acc, schema, a.columns, 0, RESOLVE_ALL_CHUNK, ALL_GROUP_ROWS_CAP);
        plan = await allPlan(ctx.db, acc, schema, r.groups, a.keep, a.fill_empty);
        // Groups bigger than the cap are skipped (their rows are not all listed); the caller stops when nothing was resolved.
        remaining = r.total_groups - plan.length;
      }

      const ops: RowOp[] = [];
      let merged = 0;
      for (const p of plan) {
        if (Object.keys(p.values).length) {
          ops.push({ op: "update", id: p.keep, data: p.values, version: p.version });
          merged++;
        }
      }
      let removed = 0;
      for (const p of plan) for (const id of p.remove) ops.push({ op: "delete", id }), removed++;
      let seq = 0;
      // Updates first so a merge never reads a deleted row; each slice is one call to the row writer in this transaction.
      for (let at = 0; at < ops.length; at += DH_BATCH_MAX) {
        const res = await applyRowOps(ctx, acc, schema, ops.slice(at, at + DH_BATCH_MAX));
        seq = Math.max(seq, res[0]?.seq ?? 0);
      }
      return { groups_resolved: plan.length, rows_removed: removed, rows_merged: merged, remaining_groups: remaining, seq };
    },
  }),
];

function splitRefs(columns: string, schema: TableSchema): string[] {
  const whole = schema.tryResolve(columns.trim());
  if (whole) return [whole.key];
  return columns.split(",").map((s) => s.trim()).filter(Boolean);
}

type Db = import("@soe/db").Executor;

async function loadRows(db: Db, acc: TableAccess, ids: string[]) {
  const res = await db.execute(sql`SELECT id, row_no, version, data, created_at, created_by, updated_at, updated_by FROM dh_rows WHERE ${acc.scope()} AND deleted_at IS NULL AND id = ANY(${`{${ids.join(",")}}`}::uuid[])`);
  return new Map((res.rows as Record<string, unknown>[]).map((r) => [r.id as string, rowFromDb(r)]));
}

async function explicitPlan(db: Db, acc: TableAccess, groups: z.infer<typeof ResolveGroup>[]) {
  const all = groups.flatMap((g) => [g.keep_id, ...g.remove_ids]);
  if (new Set(all).size !== all.length) throw new AppError("validation_error", "Một dòng chỉ nằm trong một nhóm và không vừa giữ vừa xoá.");
  const found = await loadRows(db, acc, all);
  for (const id of all) if (!found.has(id)) throw new AppError("not_found", "Không tìm thấy dòng (có thể đã bị xoá).", { row_id: id });
  return groups.map((g) => ({ keep: g.keep_id, version: found.get(g.keep_id)!.version, remove: g.remove_ids, values: g.values ?? {} }));
}

async function allPlan(db: Db, acc: TableAccess, schema: TableSchema, groups: GroupRef[], keep: "first" | "last" | "most_filled", fillEmpty: boolean) {
  const cols = mergeable(schema, acc);
  const ids = groups.flatMap((g) => (g.count > g.ids.length ? [] : g.ids));
  const rows = new Map<string, ReturnType<typeof rowFromDb>>();
  for (let at = 0; at < ids.length; at += 5000) for (const [k, v] of await loadRows(db, acc, ids.slice(at, at + 5000))) rows.set(k, v);
  const filled = (id: string) => cols.filter((c) => !isEmpty(rows.get(id)?.data[c.key])).length;
  const plan: { keep: string; version: number; remove: string[]; values: Record<string, unknown> }[] = [];
  for (const g of groups) {
    if (g.count > g.ids.length) continue;
    const ordered = g.ids; // by row number ascending
    let keepId = ordered[0]!;
    if (keep === "last") keepId = ordered[ordered.length - 1]!;
    if (keep === "most_filled") {
      let best = -1;
      for (const id of ordered) {
        const n = filled(id);
        if (n > best) (best = n), (keepId = id);
      }
    }
    const remove = ordered.filter((id) => id !== keepId);
    const values: Record<string, unknown> = {};
    if (fillEmpty) {
      const kept = rows.get(keepId)!;
      for (const c of cols) {
        if (!isEmpty(kept.data[c.key])) continue;
        for (const id of remove) {
          const v = rows.get(id)?.data[c.key] as Stored | undefined;
          if (!isEmpty(v)) {
            values[c.key] = v;
            break;
          }
        }
      }
    }
    plan.push({ keep: keepId, version: rows.get(keepId)!.version, remove, values });
  }
  return plan;
}
