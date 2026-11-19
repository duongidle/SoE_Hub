import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, DhNameSchema } from "@soe/shared";
import { newId, type Executor } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { loadDatahubAccess, loadTableAccess } from "./access";
import { columnTypeDef, newColumnKey, normalizeConfig, normalizeDisplay } from "./column-types";
import { rethrowNameConflict } from "./errors";
import { getLimits, quotaExceeded } from "./limits";
import {
  MERGE_MAX_SOURCES, MERGE_STRATEGIES, MergeConfigSchema, mergedType, ORIGIN_COLUMN_KEY, ORIGIN_COLUMN_NAME, SOURCE_COLUMN_KEY, SOURCE_COLUMN_NAME,
  type MergeConfig,
} from "./merge-plan";
import { loadPlanInputs, loadSource, mergeableColumns, planWithWarnings, PROBLEM_TEXT, requestSync, type SourceProblem } from "./merge-sync";
import { emitStructure, Id, STRUCTURE_EVENT, Ts } from "./shared";
import { normName, TableSchema } from "./table-schema";
import { TableOut, tableOut } from "./structure";

type Ctx = Pick<HandlerCtx, "db" | "actor" | "emit" | "audit" | "requestId">;
type Raw = Record<string, unknown>;

// ------------------------------------------------------------------------------------------------
// input shapes
// ------------------------------------------------------------------------------------------------

const ColumnSpec = z.object({
  name: DhNameSchema,
  from: z.record(z.string(), z.string().min(1).max(100)).describe("Bảng nguồn (mã) → cột nguồn (mã hoặc tên) đưa vào cột này. Nguồn không có mục thì ô để trống."),
});

const MergeBody = {
  sources: z.array(Id).min(1).max(MERGE_MAX_SOURCES).describe("Bảng nguồn, thứ tự = mức ưu tiên (đầu tiên cao nhất). Tối đa 10, đều của bạn, không phải bảng gộp."),
  columns: z.array(ColumnSpec).min(1).max(150).optional().describe("Ghép cột tay. Bỏ qua = tự ghép các cột cùng tên (không phân biệt hoa thường) của mọi nguồn."),
  dedup: z
    .object({
      columns: z.array(z.string().min(1).max(100)).min(1).max(5).describe("Tên cột (của bảng gộp) làm khoá chống trùng. So khớp bỏ dấu, không phân biệt hoa thường, bỏ khoảng trắng thừa."),
      strategy: z.enum(MERGE_STRATEGIES).describe("priority: giữ dòng của nguồn ưu tiên cao hơn; latest: giữ dòng sửa gần nhất; cell_merge: mỗi cột lấy giá trị không rỗng đầu tiên theo thứ tự ưu tiên."),
    })
    .nullable()
    .optional()
    .describe("Chống trùng. null hoặc bỏ qua = không chống trùng (chẩn đoán sẽ cảnh báo)."),
};

const SourceProblemOut = z.object({ table_id: Id, name: z.string().nullable(), reason: z.string(), message: z.string().optional() });

const DiagnosticsOut = z.object({
  sources: z.array(z.object({ table_id: Id, name: z.string(), rows: z.number().int(), kept: z.number().int(), dropped: z.number().int() })),
  total_read: z.number().int(),
  total_kept: z.number().int(),
  dropped: z.number().int(),
  duplicate_groups: z.number().int(),
  empty_key_rows: z.number().int(),
  strategy: z.enum(MERGE_STRATEGIES).nullable(),
  warnings: z.array(z.object({ code: z.string(), message: z.string(), source_table_id: Id.optional(), column: z.string().optional() })),
  duplicate_sample: z.array(z.object({ key: z.string(), rows: z.array(z.object({ source_table_id: Id, source_name: z.string(), row_id: Id, row_no: z.number().int(), kept: z.boolean() })) })),
  summary: z.string().describe("Câu chẩn đoán đọc được, ví dụ \"Gộp 3 bảng: 1.240 dòng, loại 87 dòng trùng khoá\"."),
});

const vn = (n: number) => n.toLocaleString("vi-VN");

/** The readable diagnosis of design module3 section 4.2. */
export function summarize(d: { sources: unknown[]; total_kept: number; dropped: number; duplicate_groups: number }, hasKey: boolean): string {
  const base = `Gộp ${d.sources.length} bảng: ${vn(d.total_kept)} dòng`;
  if (!hasKey) return `${base}. Chưa có khoá chống trùng, số liệu có thể bị đếm hai lần.`;
  return d.dropped > 0 ? `${base}, loại ${vn(d.dropped)} dòng trùng khoá (${vn(d.duplicate_groups)} nhóm trùng).` : `${base}, không có dòng trùng khoá.`;
}

// ------------------------------------------------------------------------------------------------
// resolving a request into a stored configuration
// ------------------------------------------------------------------------------------------------

interface Resolved {
  config: MergeConfig;
  /** Config and display of each merged column, taken from the first source column that feeds it (so a Tiền column keeps its format). */
  look: Map<string, { config: Record<string, unknown>; display: Record<string, unknown> }>;
  /** Source column names by merged column key, then source table id (for the preview). */
  fromNames: Map<string, Record<string, string>>;
}

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new AppError("validation_error", message, details);
}

/** Loads the sources as the owner and turns the request into a configuration (column keys reused by name when `existing` is given). */
async function resolveConfig(ctx: Ctx, ownerId: string, i: { sources: string[]; columns?: z.infer<typeof ColumnSpec>[]; dedup?: { columns: string[]; strategy: (typeof MERGE_STRATEGIES)[number] } | null }, existing: MergeConfig | null): Promise<Resolved> {
  if (new Set(i.sources).size !== i.sources.length) invalid("Một bảng nguồn chỉ được chọn một lần.", { reason: "duplicate_source" });
  const loaded: { id: string; name: string; schema: TableSchema; cols: ReturnType<typeof mergeableColumns> }[] = [];
  const problems: SourceProblem[] = [];
  for (const id of i.sources) {
    const r = await loadSource(ctx.db, ownerId, id);
    if ("problem" in r) {
      problems.push(r.problem);
      continue;
    }
    const schema = await TableSchema.load(ctx.db, r.access);
    loaded.push({ id, name: r.access.table.name, schema, cols: mergeableColumns(schema) });
  }
  if (problems.length) {
    const p = problems[0]!;
    // A table that is not the owner's (shared from someone else) is refused with its own reason; a missing table is not found.
    throw new AppError(p.reason === "deleted" ? "not_found" : "validation_error", `Bảng nguồn${p.name ? ` "${p.name}"` : ""}: ${PROBLEM_TEXT[p.reason]}.`, { reason: p.reason === "no_access" ? "source_not_owned" : p.reason === "merged" ? "source_is_merged" : "source_not_found", sources: problems });
  }
  const byId = new Map(loaded.map((l) => [l.id, l]));
  const keyByName = new Map((existing?.columns ?? []).map((c) => [normName(c.name), c]));
  const columns: MergeConfig["columns"] = [];
  const look: Resolved["look"] = new Map();
  const fromNames: Resolved["fromNames"] = new Map();
  const reserved = new Set([normName(SOURCE_COLUMN_NAME), normName(ORIGIN_COLUMN_NAME)]);

  const add = (name: string, from: Record<string, string>) => {
    const feeders = Object.entries(from).map(([t, k]) => ({ t, k, col: byId.get(t)!.cols.get(k)! }));
    const merged = mergedType(feeders.map((f) => f.col.type));
    if (!merged.ok) invalid(`Cột "${name}": ${merged.reason}`, { reason: "incompatible_types", column: name, types: feeders.map((f) => ({ table_id: f.t, name: byId.get(f.t)!.name, type: f.col.type })) });
    // Reuse the key of a column that had this name and this type, so its place in views, formulas and metrics is kept.
    const old = keyByName.get(normName(name));
    const key = old && old.type === merged.type ? old.key : newColumnKey();
    const first = feeders[0]!.col;
    columns.push({ key, name, type: merged.type, from });
    fromNames.set(key, Object.fromEntries(feeders.map((f) => [f.t, f.col.name])));
    look.set(key, feeders[0]!.col.type === merged.type ? { config: first.config, display: first.display } : { config: {}, display: {} });
  };

  if (i.columns) {
    const seen = new Set<string>();
    for (const spec of i.columns) {
      const nn = normName(spec.name);
      if (seen.has(nn) || reserved.has(nn)) invalid(`Tên cột "${spec.name}" bị trùng (hoặc trùng cột có sẵn "${SOURCE_COLUMN_NAME}" / "${ORIGIN_COLUMN_NAME}").`, { reason: "duplicate_column", column: spec.name });
      seen.add(nn);
      const from: Record<string, string> = {};
      for (const [t, ref] of Object.entries(spec.from)) {
        const src = byId.get(t);
        if (!src) invalid(`Cột "${spec.name}" lấy từ bảng không nằm trong danh sách nguồn.`, { reason: "unknown_source", table_id: t });
        const col = src.schema.tryResolve(ref);
        if (!col || col.deletedAt || !src.cols.has(col.key)) invalid(`Bảng "${src.name}" không có cột "${ref}" ghép được (kiểu đính kèm, liên kết, hệ thống không ghép).`, { reason: "unknown_column", table_id: t, column: ref });
        from[t] = col.key;
      }
      if (Object.keys(from).length === 0) invalid(`Cột "${spec.name}" chưa lấy từ nguồn nào.`, { reason: "empty_column", column: spec.name });
      add(spec.name, from);
    }
  } else {
    // Same name (accent and case sensitive after trimming: "Doanh thu" = "doanh thu ") joins the columns of different sources.
    const groups = new Map<string, { name: string; from: Record<string, string> }>();
    for (const l of loaded) {
      for (const [key, c] of l.cols) {
        const nn = normName(c.name);
        if (reserved.has(nn)) continue;
        const g = groups.get(nn) ?? { name: c.name, from: {} };
        if (!g.from[l.id]) g.from[l.id] = key; // a source with two columns of the same name cannot exist (names are unique per table)
        groups.set(nn, g);
      }
    }
    for (const g of groups.values()) add(g.name, g.from);
  }
  if (columns.length === 0) invalid("Chưa có cột nào để ghép. Các bảng nguồn cần ít nhất một cột kiểu văn bản, số, ngày, checkbox, lựa chọn hoặc người dùng.", { reason: "no_columns" });
  const limits = await getLimits(ctx.db, ownerId);
  if (columns.length + 2 > limits.columns) quotaExceeded("cột trong một bảng (đã tính cột Nguồn và Mã dòng gốc)", limits.columns);

  let dedup: MergeConfig["dedup"] = null;
  if (i.dedup) {
    const keys = i.dedup.columns.map((name) => {
      const c = columns.find((x) => normName(x.name) === normName(name));
      if (!c) invalid(`Khoá chống trùng "${name}" không phải cột của bảng gộp.`, { reason: "unknown_key_column", column: name, available: columns.map((x) => x.name) });
      return c.key;
    });
    if (new Set(keys).size !== keys.length) invalid("Cột khoá bị chọn hai lần.", { reason: "duplicate_key_column" });
    dedup = { columns: keys, strategy: i.dedup.strategy };
  }
  const config: MergeConfig = { sources: i.sources.map((table_id) => ({ table_id })), columns, dedup };
  return { config: MergeConfigSchema.parse(config), look, fromNames };
}

// ------------------------------------------------------------------------------------------------
// output
// ------------------------------------------------------------------------------------------------

const MergeOut = z.object({
  table_id: Id,
  status: z.enum(["pending", "ok", "error"]),
  /** A request to sync is waiting (or running): the table may not show the latest source rows yet. */
  syncing: z.boolean(),
  synced_at: Ts.nullable(),
  version: z.number().int(),
  /** Lost sources, one entry each (owner: names; others: reasons only). Data of the last good sync is kept. */
  errors: z.array(SourceProblemOut),
  /** Owner: the full diagnosis. Others: totals only. */
  diagnostics: DiagnosticsOut.nullable(),
  /** Owner only. */
  config: z
    .object({
      sources: z.array(z.object({ table_id: Id, name: z.string().nullable(), datahub_name: z.string().nullable() })),
      columns: z.array(z.object({ key: z.string(), name: z.string(), type: z.string(), from: z.record(z.string(), z.object({ column_key: z.string(), column_name: z.string().nullable() })) })),
      dedup: z.object({ columns: z.array(z.string()), strategy: z.enum(MERGE_STRATEGIES) }).nullable(),
    })
    .nullable(),
});

async function mergeOut(db: Executor, tableId: string, owner: boolean): Promise<z.infer<typeof MergeOut>> {
  const res = await db.execute(sql`SELECT * FROM dh_merges WHERE /*scope:system*/ table_id = ${tableId}::uuid`);
  const m = res.rows[0] as Raw | undefined;
  if (!m) throw new AppError("not_found", "Đây không phải bảng gộp.");
  const config = MergeConfigSchema.parse(m.config);
  const errors = ((m.error as (SourceProblem & { message?: string })[] | null) ?? []).map((e) => ({ ...e, ...(owner ? {} : { name: null }) }));
  const raw = m.diagnostics as (z.infer<typeof DiagnosticsOut> & Record<string, unknown>) | null;
  let diagnostics: z.infer<typeof DiagnosticsOut> | null = null;
  if (raw) {
    diagnostics = owner
      ? { ...raw, summary: summarize(raw, !!config.dedup) }
      : { ...raw, sources: [], warnings: [], duplicate_sample: [], summary: summarize(raw, !!config.dedup) };
  }
  let cfg: z.infer<typeof MergeOut>["config"] = null;
  if (owner) {
    const ids = config.sources.map((s) => s.table_id);
    const names = await db.execute(sql`SELECT t.id, t.name, d.name AS datahub_name FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ t.id = ANY(${`{${ids.join(",")}}`}::uuid[])`);
    const nameOf = new Map((names.rows as { id: string; name: string; datahub_name: string }[]).map((r) => [r.id, r]));
    const colNames = new Map<string, string>();
    const cols = await db.execute(sql`SELECT table_id, key, name FROM dh_columns WHERE /*scope:system*/ table_id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND deleted_at IS NULL`);
    for (const c of cols.rows as { table_id: string; key: string; name: string }[]) colNames.set(`${c.table_id}:${c.key}`, c.name);
    cfg = {
      sources: ids.map((id) => ({ table_id: id, name: nameOf.get(id)?.name ?? null, datahub_name: nameOf.get(id)?.datahub_name ?? null })),
      columns: config.columns.map((c) => ({ key: c.key, name: c.name, type: c.type, from: Object.fromEntries(Object.entries(c.from).map(([t, k]) => [t, { column_key: k, column_name: colNames.get(`${t}:${k}`) ?? null }])) })),
      dedup: config.dedup ? { columns: config.dedup.columns.map((k) => config.columns.find((c) => c.key === k)?.name ?? k), strategy: config.dedup.strategy } : null,
    };
  }
  return {
    table_id: tableId,
    status: m.status as "pending" | "ok" | "error",
    syncing: Number(m.request_seq) > Number(m.synced_seq),
    synced_at: (m.synced_at as Date | null) ?? null,
    version: m.version as number,
    errors,
    diagnostics,
    config: cfg,
  };
}

// ------------------------------------------------------------------------------------------------
// writing the columns of a merged table
// ------------------------------------------------------------------------------------------------

async function insertColumn(ctx: Ctx, tableId: string, c: { key: string; name: string; type: string; config: Record<string, unknown>; display: Record<string, unknown>; position: number; system: boolean }): Promise<void> {
  const def = columnTypeDef(c.type);
  let config: Record<string, unknown>;
  try {
    config = normalizeConfig(c.type, c.config);
  } catch {
    config = def.defaultConfig();
  }
  const display = normalizeDisplay(c.display);
  try {
    await ctx.db.execute(sql`INSERT INTO dh_columns (id, table_id, key, name, type, config, position, display, description, created_by, updated_by)
      VALUES (${newId()}::uuid, ${tableId}::uuid, ${c.key}, ${c.name}, ${c.type}, ${JSON.stringify({ ...config, __merged: c.system ? "system" : "data" })}::jsonb, ${c.position}::int, ${JSON.stringify(display)}::jsonb,
        ${c.system ? (c.key === SOURCE_COLUMN_KEY ? "Bảng nguồn của dòng này." : "Mã dòng ở bảng nguồn (mở dòng gốc để sửa).") : null}, ${ctx.actor.userId}::uuid, ${ctx.actor.userId}::uuid)`);
  } catch (e) {
    rethrowNameConflict(e);
  }
}

// ------------------------------------------------------------------------------------------------
// operations
// ------------------------------------------------------------------------------------------------

export const mergeOperations = [
  defineCommand({
    name: "datahub.merge.create",
    summary: "Tạo bảng gộp: bảng chỉ đọc, dòng được worker chép từ tối đa 10 bảng nguồn của bạn, có chống trùng.",
    description:
      "Nguồn là bảng của chính bạn (bất kỳ datahub nào của bạn), không phải bảng gộp, không phải bảng người khác chia sẻ. Cột cùng tên tự ghép; cột khác tên ghép tay bằng `columns`. Có sẵn hai cột `Nguồn` và `Mã dòng gốc`. Chống trùng bằng `dedup`. Đếm vào giới hạn số bảng của datahub. Dòng được chép trong vài giây (xem `datahub.merge.get`); dữ liệu do hệ thống tạo nên không có lịch sử dòng và không có nhật ký.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ datahub_id: Id, name: DhNameSchema, description: z.string().trim().max(1000).optional(), ...MergeBody }),
    output: z.object({ table: TableOut, merge: MergeOut }),
    http: { method: "POST", path: "/datahubs/:datahub_id/merged-tables", status: 201 },
    handler: async (ctx, i) => {
      const dh = await loadDatahubAccess(ctx, i.datahub_id, "owner");
      const limits = await getLimits(ctx.db, ctx.actor.userId);
      const cnt = await ctx.db.execute(sql`SELECT count(*)::int AS n, coalesce(max(position), -1) + 1 AS next FROM dh_tables WHERE /*scope*/ datahub_id = ${dh.id}::uuid AND deleted_at IS NULL`);
      const { n, next } = cnt.rows[0] as { n: number; next: number };
      if (n >= limits.tables) quotaExceeded("bảng trong một datahub", limits.tables);
      const resolved = await resolveConfig(ctx, ctx.actor.userId, i, null);
      const id = newId();
      try {
        await ctx.db.execute(sql`INSERT INTO dh_tables (id, datahub_id, name, description, position, kind, created_by, updated_by) VALUES (${id}::uuid, ${dh.id}::uuid, ${i.name}, ${i.description ?? null}, ${next}::int, 'merged', ${ctx.actor.userId}::uuid, ${ctx.actor.userId}::uuid)`);
      } catch (e) {
        rethrowNameConflict(e);
      }
      await ctx.db.execute(sql`INSERT INTO dh_views (id, table_id, owner_id, name, kind, position, config, created_by, updated_by) VALUES (${newId()}::uuid, ${id}::uuid, NULL, 'Dạng bảng', 'grid', 0, '{}'::jsonb, ${ctx.actor.userId}::uuid, ${ctx.actor.userId}::uuid)`);
      let pos = 0;
      for (const c of resolved.config.columns) {
        const look = resolved.look.get(c.key)!;
        await insertColumn(ctx, id, { key: c.key, name: c.name, type: c.type, config: look.config, display: look.display, position: pos++, system: false });
      }
      await insertColumn(ctx, id, { key: SOURCE_COLUMN_KEY, name: SOURCE_COLUMN_NAME, type: "text", config: {}, display: {}, position: pos++, system: true });
      await insertColumn(ctx, id, { key: ORIGIN_COLUMN_KEY, name: ORIGIN_COLUMN_NAME, type: "text", config: {}, display: {}, position: pos++, system: true });
      await ctx.db.execute(sql`INSERT INTO dh_merges (table_id, config, source_ids) VALUES (${id}::uuid, ${JSON.stringify(resolved.config)}::jsonb, ${`{${i.sources.join(",")}}`}::uuid[])`);
      ctx.audit({ type: "datahub_table", id, details: { datahub_id: dh.id, name: i.name, merged: true, sources: i.sources.length } });
      await emitStructure(ctx, dh.id, id, "table_created");
      const acc = await loadTableAccess(ctx, id);
      return {
        table: await tableOut(ctx.db, acc),
        merge: await mergeOut(ctx.db, id, true),
      };
    },
  }),

  defineCommand({
    name: "datahub.merge.update",
    summary: "Đổi cấu hình bảng gộp (nguồn, thứ tự ưu tiên, ghép cột, khoá chống trùng). Chỉ chủ. Dòng được chép lại sau đó.",
    description: "Gửi lại đủ `sources`, `columns` (hoặc bỏ để tự ghép theo tên), `dedup`. Cột giữ nguyên tên và kiểu thì giữ mã cột (view, công thức, chỉ số đọc cột này không đổi). Cột bị bỏ vào thùng rác của bảng; cột mới được thêm. `version` là phiên bản cấu hình lấy từ `datahub.merge.get`.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    emits: [STRUCTURE_EVENT],
    input: z.object({ table_id: Id, ...MergeBody, version: z.number().int().min(1).optional() }),
    output: MergeOut,
    http: { method: "PUT", path: "/tables/:table_id/merge" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "owner");
      if (acc.table.kind !== "merged") throw new AppError("validation_error", "Đây không phải bảng gộp.", { reason: "not_merged" });
      const cur = await ctx.db.execute(sql`SELECT config, version FROM dh_merges WHERE /*scope:system*/ table_id = ${acc.tableId}::uuid FOR UPDATE`);
      const row = cur.rows[0] as { config: unknown; version: number };
      if (i.version !== undefined && i.version !== row.version) throw new AppError("conflict", undefined, { current_version: row.version, sent_version: i.version });
      const existing = MergeConfigSchema.parse(row.config);
      const resolved = await resolveConfig(ctx, ctx.actor.userId, i, existing);
      const schema = await TableSchema.load(ctx.db, acc);
      const keep = new Set(resolved.config.columns.map((c) => c.key));
      // Columns that are no longer part of the merge go to the trash of the table (data kept by the engine until purge).
      for (const c of existing.columns) {
        if (keep.has(c.key)) continue;
        await ctx.db.execute(sql`UPDATE dh_columns SET deleted_at = now(), deleted_by = ${ctx.actor.userId}::uuid, version = version + 1, updated_at = now() WHERE ${acc.scope()} AND key = ${c.key} AND deleted_at IS NULL`);
      }
      const have = new Set(schema.alive.map((c) => c.key));
      let pos = Math.max(0, ...schema.alive.map((c) => c.position)) + 1;
      for (const c of resolved.config.columns) {
        if (have.has(c.key) && existing.columns.some((x) => x.key === c.key)) continue;
        const look = resolved.look.get(c.key)!;
        await insertColumn(ctx, acc.tableId, { key: c.key, name: c.name, type: c.type, config: look.config, display: look.display, position: pos++, system: false });
      }
      await ctx.db.execute(sql`UPDATE dh_merges SET config = ${JSON.stringify(resolved.config)}::jsonb, source_ids = ${`{${i.sources.join(",")}}`}::uuid[], version = version + 1, updated_at = now() WHERE /*scope:system*/ table_id = ${acc.tableId}::uuid`);
      await requestSync(ctx.db, [acc.tableId]);
      ctx.audit({ type: "datahub_table", id: acc.tableId, details: { merged: true, sources: i.sources.length, columns: resolved.config.columns.length } });
      await emitStructure(ctx, acc.datahub.id, acc.tableId, "column_updated");
      return mergeOut(ctx.db, acc.tableId, true);
    },
  }),

  defineQuery({
    name: "datahub.merge.get",
    summary: "Cấu hình, trạng thái đồng bộ và chẩn đoán của bảng gộp.",
    description: "Chủ xem đủ (nguồn, ghép cột, khoá, chẩn đoán, các nhóm trùng mẫu). Người được chia sẻ chỉ xem trạng thái và tổng số dòng. `status`: pending (chưa đồng bộ lần nào), ok, error (một nguồn mất: bảng giữ dữ liệu lần đồng bộ cuối, `errors` nói nguồn nào và vì sao).",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ table_id: Id }),
    output: MergeOut,
    http: { method: "GET", path: "/tables/:table_id/merge" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id);
      if (acc.table.kind !== "merged") throw new AppError("not_found", "Đây không phải bảng gộp.");
      return mergeOut(ctx.db, acc.tableId, acc.level === "owner");
    },
  }),

  defineCommand({
    name: "datahub.merge.sync",
    summary: "Đồng bộ lại bảng gộp ngay (xếp yêu cầu cho worker). Chỉ chủ.",
    description: "Bảng gộp tự đồng bộ khi nguồn đổi; lệnh này dùng khi muốn chép lại tay. Trả trạng thái hiện tại, `syncing = true` đến khi worker xong.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    audit: "none",
    input: z.object({ table_id: Id }),
    output: MergeOut,
    http: { method: "POST", path: "/tables/:table_id/merge/sync", status: 202 },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "owner");
      if (acc.table.kind !== "merged") throw new AppError("validation_error", "Đây không phải bảng gộp.", { reason: "not_merged" });
      await requestSync(ctx.db, [acc.tableId]);
      return mergeOut(ctx.db, acc.tableId, true);
    },
  }),

  defineCommand({
    name: "datahub.merge.preview",
    summary: "Xem trước cấu hình bảng gộp: các cột sẽ có, số dòng, bao nhiêu dòng trùng, cảnh báo. Không ghi gì.",
    description: "Cùng đầu vào với `datahub.merge.create` (không cần tên). Đọc các bảng nguồn qua phạm vi của bạn nên nặng ngang một lần đồng bộ; gọi khi người dùng đổi cấu hình, không gọi liên tục.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    audit: "none",
    input: z.object({ datahub_id: Id, ...MergeBody }),
    output: z.object({
      columns: z.array(z.object({ name: z.string(), type: z.string(), from: z.record(z.string(), z.string()) })),
      diagnostics: DiagnosticsOut,
    }),
    http: { method: "POST", path: "/datahubs/:datahub_id/merge-preview" },
    handler: async (ctx, i) => {
      await loadDatahubAccess(ctx, i.datahub_id, "owner");
      const resolved = await resolveConfig(ctx, ctx.actor.userId, i, null);
      const inputs = await loadPlanInputs(ctx.db, ctx.actor.userId, resolved.config);
      if (inputs.problems.length) throw new AppError("validation_error", "Có bảng nguồn không đọc được.", { reason: "source_problem", sources: inputs.problems });
      const plan = planWithWarnings(resolved.config, inputs);
      return {
        columns: resolved.config.columns.map((c) => ({ name: c.name, type: c.type, from: resolved.fromNames.get(c.key) ?? {} })),
        diagnostics: { ...plan.diagnostics, summary: summarize(plan.diagnostics, !!resolved.config.dedup) },
      };
    },
  }),

  defineQuery({
    name: "datahub.merge.duplicates",
    summary: "Các nhóm dòng trùng khoá của bảng gộp: mỗi nhóm là các dòng nguồn, dòng nào được giữ. Chỉ chủ.",
    description: "Tính lại từ các bảng nguồn qua phạm vi của chủ (đúng cách lần đồng bộ làm), phân trang bằng `limit` (tối đa 100) và `offset`.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ table_id: Id, limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0) }),
    output: z.object({ total: z.number().int(), groups: z.array(z.object({ key: z.string(), rows: z.array(z.object({ source_table_id: Id, source_name: z.string(), row_id: Id, row_no: z.number().int(), kept: z.boolean() })) })) }),
    http: { method: "GET", path: "/tables/:table_id/merge/duplicates" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "owner");
      if (acc.table.kind !== "merged") throw new AppError("validation_error", "Đây không phải bảng gộp.", { reason: "not_merged" });
      const cur = await ctx.db.execute(sql`SELECT config FROM dh_merges WHERE /*scope:system*/ table_id = ${acc.tableId}::uuid`);
      const config = MergeConfigSchema.parse((cur.rows[0] as { config: unknown }).config);
      const inputs = await loadPlanInputs(ctx.db, ctx.actor.userId, config);
      if (inputs.problems.length) throw new AppError("validation_error", "Có bảng nguồn không đọc được.", { reason: "source_problem", sources: inputs.problems });
      const { groups } = planWithWarnings(config, inputs);
      return { total: groups.length, groups: groups.slice(i.offset, i.offset + i.limit) };
    },
  }),

  defineQuery({
    name: "datahub.merge.origin",
    summary: "Dòng gốc của một dòng bảng gộp: bảng nào, dòng nào. Chủ dùng để mở dòng gốc và sửa ở đó.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z.object({ table_id: Id, row_id: Id }),
    output: z.object({ source_datahub_id: Id.nullable(), source_table_id: Id, source_table_name: z.string().nullable(), source_row_id: Id, source_row_no: z.number().int().nullable() }),
    http: { method: "GET", path: "/tables/:table_id/merge/origin/:row_id" },
    handler: async (ctx, i) => {
      const acc = await loadTableAccess(ctx, i.table_id, "owner");
      const res = await ctx.db.execute(sql`SELECT mr.source_table_id, mr.source_row_id, t.name AS table_name, t.datahub_id, sr.row_no
        FROM dh_merge_rows mr LEFT JOIN dh_tables t ON t.id = mr.source_table_id AND t.deleted_at IS NULL LEFT JOIN dh_rows sr ON sr.id = mr.source_row_id AND sr.deleted_at IS NULL
        WHERE /*scope:system*/ mr.table_id = ${acc.tableId}::uuid AND mr.row_id = ${i.row_id}::uuid`);
      const r = res.rows[0] as { source_table_id: string; source_row_id: string; table_name: string | null; datahub_id: string | null; row_no: number | null } | undefined;
      if (!r) throw new AppError("not_found", "Không tìm thấy dòng gốc của dòng này.");
      return { source_datahub_id: r.datahub_id, source_table_id: r.source_table_id, source_table_name: r.table_name, source_row_id: r.source_row_id, source_row_no: r.row_no };
    },
  }),
];
