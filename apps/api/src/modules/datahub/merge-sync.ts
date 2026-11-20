import { sql } from "drizzle-orm";
import type { Logger } from "pino";
import { AppError, type Actor } from "@soe/shared";
import { enqueueOutbox, newId, type Db, type Executor, type OutboxRow } from "@soe/db";
import type { Subscriber } from "../../core/outbox-dispatcher";
import { loadTableAccess, readableRows, type TableAccess } from "./access";
import { effectiveType } from "./cell-values";
import { nextChangeSeq } from "./change-queue";
import { buildSearchText } from "./column-types";
import {
  familyOf, mergedType, MergeConfigSchema, ORIGIN_COLUMN_KEY, planMerge, SOURCE_COLUMN_KEY,
  type MergeConfig, type PlanRow, type PlanSource, type PlanSourceColumn, type PlannedRow,
} from "./merge-plan";
import { recordChanges, type RowChange } from "./partial";
import { RowFormulas } from "./row-formulas";
import { TableSchema } from "./table-schema";
import type { Stored } from "./types";

/**
 * The merged table at work (design module3 section 4): the worker copies the rows of the source tables into the merged table, de-duplicates
 * them, and keeps them current. Everything here is data written BY THE SYSTEM: no row history, no audit entry, no `version` or "Ngày sửa"
 * change (the same rule as computed values, Module 2 section 6.5). Other people's reads, formulas, metrics and SSE follow from the
 * same events a normal row write emits.
 *
 * Which rows are copied is decided in ONE place: the rows the OWNER of the merged table may read, `readableRows(access)` of the source table
 * loaded with the owner as the actor. Today that is every live row of a table the owner owns; when the split lock arrives (Stage 4.1) only
 * `access.ts` changes, and `requestRescope` below (the single entry that says "who sees which rows may have changed") already syncs again
 * when sharing or the organization tree change.
 */

const PAGE = 5000;
const WRITE_CHUNK = 2000;
const EVENT_ROWS = 500;
export const MERGE_SYNCED_EVENT = "datahub.merge.synced";

type Cell = string | number | boolean | null;

export function ownerActor(ownerId: string): Actor {
  return { userId: ownerId, via: "worker", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: null };
}

export interface SourceProblem {
  table_id: string;
  name: string | null;
  /** `deleted` (in the trash or gone), `no_access` (the owner no longer owns or may read it), `merged` (a merged table cannot be a source). */
  reason: "deleted" | "no_access" | "merged";
}

export const PROBLEM_TEXT: Record<SourceProblem["reason"], string> = {
  deleted: "đã bị xoá hoặc nằm trong thùng rác",
  no_access: "bạn không còn quyền chủ với bảng này",
  merged: "là bảng gộp (bảng gộp không làm nguồn của bảng gộp khác)",
};

/** Loads a source table as the owner of the merged table. Anything but "the owner owns it" is a problem, never a copy of someone else's rows. */
export async function loadSource(db: Executor, ownerId: string, tableId: string): Promise<{ access: TableAccess } | { problem: SourceProblem }> {
  try {
    const ctx = { db, actor: ownerActor(ownerId) };
    let access: TableAccess;
    try {
      access = await loadTableAccess(ctx, tableId, "owner");
    } catch (e) {
      if (!(e instanceof AppError) || e.code !== "forbidden") throw e;
      // Not the owner: allowed only when the source is a table with the split lock on (a shared deals table, design module3 section 4.1). The merged
      // table then copies what its owner SEES of it (`readableRows` = the owner's rows), never the whole table.
      access = await loadTableAccess(ctx, tableId, "view");
      if (!access.table.split.enabled) throw e;
    }
    if (access.table.kind === "merged") return { problem: { table_id: tableId, name: access.table.name, reason: "merged" } };
    return { access };
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    const r = await db.execute(sql`SELECT name, deleted_at FROM dh_tables WHERE /*scope:system*/ id = ${tableId}::uuid`);
    const row = r.rows[0] as { name: string; deleted_at: Date | null } | undefined;
    // `not_found` covers a trashed table and a table the owner cannot see; the owner of a trashed table still sees its name.
    return { problem: { table_id: tableId, name: row?.name ?? null, reason: e.code === "not_found" && (!row || row.deleted_at) ? "deleted" : "no_access" } };
  }
}

/** Columns of a source table the merge can read, with their effective type (computed columns give their result type). */
export function mergeableColumns(schema: TableSchema): Map<string, PlanSourceColumn & { name: string; config: Record<string, unknown>; display: Record<string, unknown> }> {
  const out = new Map<string, PlanSourceColumn & { name: string; config: Record<string, unknown>; display: Record<string, unknown> }>();
  for (const c of schema.alive) {
    const type = effectiveType(c);
    if (!familyOf(type)) continue;
    const options = (type === "single_select" || type === "multi_select") && Array.isArray(c.config.options) ? new Map((c.config.options as { id: string; name: string }[]).map((o) => [o.id, o.name])) : undefined;
    out.set(c.key, { type, ...(options ? { options } : {}), name: c.name, config: c.config, display: c.display });
  }
  return out;
}

/** Every live row of a source table the owner may read, in pages by id. */
async function* pagesOf(db: Executor, access: TableAccess): AsyncGenerator<PlanRow[]> {
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const res = await db.execute(sql`SELECT r.id, r.row_no, r.updated_at, r.data FROM ${access.rel()} r WHERE ${readableRows(access, "r")} AND r.id > ${last}::uuid ORDER BY r.id LIMIT ${PAGE}`);
    const rows = res.rows as { id: string; row_no: number; updated_at: Date | string; data: Record<string, unknown> }[];
    if (rows.length === 0) return;
    yield rows.map((r) => ({ id: r.id, rowNo: r.row_no, updatedAt: new Date(r.updated_at).getTime(), data: r.data }));
    last = rows[rows.length - 1]!.id;
    if (rows.length < PAGE) return;
  }
}

export interface PlanInputs {
  sources: PlanSource[];
  problems: SourceProblem[];
  /** Mapped columns that no longer fit (type changed to another family): left empty and reported. */
  mismatches: { source_table_id: string; source_name: string; column: string }[];
}

/**
 * Reads the sources of a configuration as the owner. A problem on ANY source means the whole answer is withheld (`problems` filled,
 * `sources` empty): a half-merged table would silently drop the rows of the lost source.
 */
export async function loadPlanInputs(db: Executor, ownerId: string, config: MergeConfig): Promise<PlanInputs> {
  const problems: SourceProblem[] = [];
  const loaded: { access: TableAccess; schema: TableSchema }[] = [];
  for (const s of config.sources) {
    const r = await loadSource(db, ownerId, s.table_id);
    if ("problem" in r) problems.push(r.problem);
    else loaded.push({ access: r.access, schema: await TableSchema.load(db, r.access) });
  }
  if (problems.length) return { sources: [], problems, mismatches: [] };
  const mismatches: PlanInputs["mismatches"] = [];
  const sources: PlanSource[] = [];
  for (const { access, schema } of loaded) {
    const cols = mergeableColumns(schema);
    // A mapped column whose type no longer fits the merged column is dropped for this source.
    for (const c of config.columns) {
      const key = c.from[access.tableId];
      const sc = key ? cols.get(key) : undefined;
      if (key && sc && !mergedType([sc.type, c.type]).ok) {
        cols.delete(key);
        mismatches.push({ source_table_id: access.tableId, source_name: access.table.name, column: c.name });
      }
    }
    const rows: PlanRow[] = [];
    for await (const page of pagesOf(db, access)) rows.push(...page);
    // The label of a source is "Datahub – Bảng": table names alone repeat across datahubs (every first table is "Bảng 1").
    sources.push({ tableId: access.tableId, name: `${access.datahub.name} – ${access.table.name}`, columns: cols, rows });
  }
  return { sources, problems, mismatches };
}

/** Plans the merge and adds the warnings about columns that stopped fitting. */
export function planWithWarnings(config: MergeConfig, inputs: PlanInputs) {
  const plan = planMerge(config, inputs.sources);
  for (const m of inputs.mismatches) plan.diagnostics.warnings.push({ code: "type_mismatch", message: `Cột "${m.column}" ở bảng "${m.source_name}" đã đổi sang kiểu không còn khớp: ô này để trống.`, source_table_id: m.source_table_id, column: m.column });
  return plan;
}

// ------------------------------------------------------------------------------------------------
// requests to sync
// ------------------------------------------------------------------------------------------------

const uuidArray = (ids: string[]) => `{${ids.join(",")}}`;

/** Asks for the merged tables to be synced again (accumulates: a request that arrives during a sync is never lost). */
export async function requestSync(db: Executor, tableIds: string[]): Promise<void> {
  if (tableIds.length === 0) return;
  await db.execute(sql`UPDATE dh_merges SET request_seq = request_seq + 1 WHERE /*scope:system*/ table_id = ANY(${uuidArray(tableIds)}::uuid[])`);
}

async function mergesReading(db: Executor, tableIds: string[]): Promise<string[]> {
  if (tableIds.length === 0) return [];
  const res = await db.execute(sql`SELECT table_id FROM dh_merges WHERE /*scope:system*/ source_ids && ${uuidArray(tableIds)}::uuid[]`);
  return (res.rows as { table_id: string }[]).map((r) => r.table_id);
}

async function mergesInDatahub(db: Executor, datahubId: string): Promise<string[]> {
  const res = await db.execute(sql`SELECT m.table_id FROM dh_merges m JOIN dh_tables t ON t.id = m.table_id
    WHERE /*scope:system*/ t.datahub_id = ${datahubId}::uuid
       OR m.source_ids && ARRAY(SELECT id FROM dh_tables WHERE datahub_id = ${datahubId}::uuid)`);
  return (res.rows as { table_id: string }[]).map((r) => r.table_id);
}

/**
 * THE one place that turns "what changed" into "which merged tables must sync again", and so the one place that says when the set of rows
 * the owner may read may have changed: rows or computed values of a source, structure (columns, trash, owner), sharing, the organization
 * tree. Today the answer to a sharing or organization change is "sync again" (a re-read through `readableRows`, which is the whole table);
 * Stage 4.1 (split lock) narrows `readableRows` and adds its own triggers HERE.
 */
export async function requestRescope(db: Executor, ev: Pick<OutboxRow, "event" | "payload">): Promise<string[]> {
  const p = ev.payload as Record<string, unknown>;
  let ids: string[] = [];
  if (ev.event.startsWith("datahub.row.")) ids = await mergesReading(db, [p.table_id as string]);
  else if (ev.event === "datahub.formula.recalculated") ids = p.state === "pending" ? [] : await mergesReading(db, [p.table_id as string]);
  else if (ev.event === "datahub.structure.changed") {
    const t = p.table_id as string | null;
    const change = p.change as string;
    if (t) {
      ids = await mergesReading(db, [t]);
      // The merged table itself: only coming back from the trash needs a sync (its own columns are handled by the column commands).
      if (change === "table_restored") ids.push(t);
    } else ids = await mergesInDatahub(db, p.datahub_id as string);
  } else if (ev.event === "datahub.share.changed") ids = await mergesInDatahub(db, p.datahub_id as string);
  else if (ev.event === "org.member.changed") {
    const res = await db.execute(sql`SELECT table_id FROM dh_merges WHERE /*scope:system*/ true`);
    ids = (res.rows as { table_id: string }[]).map((r) => r.table_id);
  }
  ids = [...new Set(ids)];
  await requestSync(db, ids);
  return ids;
}

/** Outbox subscriber (worker): a change that can alter a merged table asks for a sync; the loop does the work. */
export const mergeSubscriber: Subscriber = {
  name: "datahub.merge",
  match: (e) => e.startsWith("datahub.row.") || e === "datahub.formula.recalculated" || e === "datahub.structure.changed" || e === "datahub.share.changed" || e === "org.member.changed",
  async handle(ev, db) {
    await requestRescope(db, ev);
  },
};

// ------------------------------------------------------------------------------------------------
// the sync
// ------------------------------------------------------------------------------------------------

export type SyncResult = "synced" | "error" | "skipped" | "busy";

interface ExistingRow {
  ident: string;
  row_id: string;
  source_table_id: string;
  source_row_id: string;
  data: Record<string, Stored>;
  deleted_at: Date | null;
  row_no: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function finish(db: Executor, tableId: string, patch: { status: "ok" | "error"; error: unknown; diagnostics?: unknown; seq: number }): Promise<void> {
  await db.execute(sql`UPDATE dh_merges SET status = ${patch.status}, error = ${patch.error === null ? null : JSON.stringify(patch.error)}::jsonb,
      diagnostics = CASE WHEN ${patch.diagnostics === undefined} THEN diagnostics ELSE ${JSON.stringify(patch.diagnostics ?? null)}::jsonb END,
      synced_seq = ${patch.seq}::bigint, synced_at = CASE WHEN ${patch.status === "ok"} THEN now() ELSE synced_at END, updated_at = now()
    WHERE /*scope:system*/ table_id = ${tableId}::uuid`);
}

/** Copies the rows the owner may read from the sources into the merged table. One transaction; the row of `dh_merges` says what was synced. */
export async function syncMergedTable(db: Db, tableId: string, log?: Logger): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${tableId}, 7)) AS ok`);
    if (!(lock.rows[0] as { ok: boolean }).ok) return "busy";
    const res = await tx.execute(sql`SELECT m.config, m.request_seq::text AS seq, m.synced_seq::text AS synced, t.deleted_at AS t_deleted, d.deleted_at AS d_deleted, d.owner_id, t.datahub_id
      FROM dh_merges m JOIN dh_tables t ON t.id = m.table_id JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ m.table_id = ${tableId}::uuid`);
    const m = res.rows[0] as { config: unknown; seq: string; synced: string; t_deleted: Date | null; d_deleted: Date | null; owner_id: string; datahub_id: string } | undefined;
    if (!m) return "skipped";
    const seq0 = Number(m.seq);
    if (m.t_deleted || m.d_deleted) {
      await finish(tx, tableId, { status: "ok", error: null, seq: seq0 });
      return "skipped";
    }
    const config = MergeConfigSchema.parse(m.config);
    const ownerId = m.owner_id;
    const emitSynced = async (status: "ok" | "error", rows: { created: number; updated: number; deleted: number }) => {
      await enqueueOutbox(tx, { event: MERGE_SYNCED_EVENT, aggregateType: "datahub_table", aggregateId: tableId, payload: { table_id: tableId, status, ...rows } });
    };
    try {
      const inputs = await loadPlanInputs(tx, ownerId, config);
      if (inputs.problems.length) {
        // A lost source: say so, keep what the last good sync wrote.
        await finish(tx, tableId, { status: "error", error: inputs.problems, seq: seq0 });
        await emitSynced("error", { created: 0, updated: 0, deleted: 0 });
        return "error";
      }
      const plan = planWithWarnings(config, inputs);
      const counts = await applyPlan(tx, ownerId, tableId, config, plan.rows, inputs.sources);
      await finish(tx, tableId, { status: "ok", error: null, diagnostics: plan.diagnostics, seq: seq0 });
      await emitSynced("ok", counts);
      return "synced";
    } catch (e) {
      log?.error({ err: e, table: tableId }, "merged table sync failed");
      throw e;
    }
  });
}

async function applyPlan(tx: Executor, ownerId: string, tableId: string, config: MergeConfig, planned: PlannedRow[], sources: PlanSource[]): Promise<{ created: number; updated: number; deleted: number }> {
  const access = await loadTableAccess({ db: tx, actor: ownerActor(ownerId) }, tableId, "owner");
  const schema = await TableSchema.load(tx, access);
  const sourceName = new Map(sources.map((s) => [s.tableId, s.name]));
  const managed = [...config.columns.map((c) => c.key), SOURCE_COLUMN_KEY, ORIGIN_COLUMN_KEY];
  const liveKeys = new Set(schema.alive.map((c) => c.key));
  const managedLive = managed.filter((k) => liveKeys.has(k));
  const formulas = RowFormulas.for(schema);
  const now = new Date();

  const desired = (p: PlannedRow): Record<string, Cell> => {
    const d: Record<string, Cell> = {};
    for (const k of config.columns.map((c) => c.key)) if (p.data[k] !== null && p.data[k] !== undefined && p.data[k] !== "") d[k] = p.data[k]!;
    d[SOURCE_COLUMN_KEY] = sourceName.get(p.sourceTableId) ?? "";
    d[ORIGIN_COLUMN_KEY] = p.sourceRowId;
    return d;
  };

  const ex = await tx.execute(sql`SELECT mr.ident, mr.row_id, mr.source_table_id, mr.source_row_id, r.data, r.deleted_at, r.row_no
    FROM dh_merge_rows mr JOIN dh_rows r ON r.id = mr.row_id WHERE /*scope:system*/ mr.table_id = ${tableId}::uuid`);
  const existing = new Map((ex.rows as unknown as ExistingRow[]).map((r) => [r.ident, r]));

  const inserts: { id: string; row_no: number; data: Record<string, Stored>; search: string }[] = [];
  const updates: { id: string; data: Record<string, Stored>; search: string; restore: boolean }[] = [];
  const mappings: { ident: string; row_id: string; source_table_id: string; source_row_id: string }[] = [];
  const changes: RowChange[] = [];
  const created: string[] = [];
  const updated: string[] = [];
  const restored: string[] = [];
  const deleted: string[] = [];
  const changedKeys = new Set<string>();
  const seen = new Set<string>();
  const rowNoOf = new Map<string, number>();

  // New rows take their numbers in one block, like a batch of creates.
  const fresh = planned.filter((p) => !existing.has(p.ident));
  let firstNo = 0;
  if (fresh.length) {
    const r = await tx.execute(sql`UPDATE dh_tables SET next_row_no = next_row_no + ${fresh.length}::int WHERE /*scope*/ id = ${tableId}::uuid RETURNING next_row_no - ${fresh.length}::int AS first_no`);
    firstNo = (r.rows[0] as { first_no: number }).first_no;
  }
  let n = 0;
  for (const p of planned) {
    seen.add(p.ident);
    const want = desired(p);
    const cur = existing.get(p.ident);
    if (!cur) {
      const id = newId();
      const data: Record<string, Stored> = { ...(want as Record<string, Stored>) };
      const rowNo = firstNo + n++;
      formulas?.compute(data, { id, rowNo, createdAt: now, updatedAt: now, createdBy: ownerId, updatedBy: ownerId }, now);
      inserts.push({ id, row_no: rowNo, data, search: buildSearchText(data, schema.alive) });
      mappings.push({ ident: p.ident, row_id: id, source_table_id: p.sourceTableId, source_row_id: p.sourceRowId });
      changes.push({ rowId: id, kind: "insert", old: null, new: data });
      created.push(id);
      Object.keys(want).forEach((k) => changedKeys.add(k));
      rowNoOf.set(id, rowNo);
      continue;
    }
    const wasDeleted = !!cur.deleted_at;
    const diff = managedLive.filter((k) => !same(cur.data[k], want[k]));
    if (cur.source_table_id !== p.sourceTableId || cur.source_row_id !== p.sourceRowId) mappings.push({ ident: p.ident, row_id: cur.row_id, source_table_id: p.sourceTableId, source_row_id: p.sourceRowId });
    if (!wasDeleted && diff.length === 0) continue;
    const next: Record<string, Stored> = { ...cur.data };
    for (const k of managedLive) {
      if (want[k] === undefined || want[k] === null) delete next[k];
      else next[k] = want[k] as Stored;
    }
    formulas?.compute(next, { id: cur.row_id, rowNo: cur.row_no, createdAt: now, updatedAt: now, createdBy: ownerId, updatedBy: ownerId }, now);
    updates.push({ id: cur.row_id, data: next, search: buildSearchText(next, schema.alive), restore: wasDeleted });
    changes.push(wasDeleted ? { rowId: cur.row_id, kind: "restore", old: null, new: next } : { rowId: cur.row_id, kind: "update", old: cur.data, new: next });
    (wasDeleted ? restored : updated).push(cur.row_id);
    diff.forEach((k) => changedKeys.add(k));
  }
  for (const cur of existing.values()) {
    if (seen.has(cur.ident) || cur.deleted_at) continue;
    deleted.push(cur.row_id);
    changes.push({ rowId: cur.row_id, kind: "delete", old: cur.data, new: null });
  }

  for (let i = 0; i < inserts.length; i += WRITE_CHUNK) {
    await tx.execute(sql`INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
      SELECT v.id, ${tableId}::uuid, v.row_no, v.data, v.search, ${ownerId}::uuid, ${ownerId}::uuid
      FROM jsonb_to_recordset(${JSON.stringify(inserts.slice(i, i + WRITE_CHUNK))}::jsonb) AS v(id uuid, row_no int, data jsonb, search text)`);
  }
  for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
    // No version, no "Ngày sửa": a copy made by the system is not an edit (same rule as computed values).
    await tx.execute(sql`UPDATE dh_rows r SET data = v.data, search = v.search, deleted_at = NULL, deleted_by = NULL
      FROM jsonb_to_recordset(${JSON.stringify(updates.slice(i, i + WRITE_CHUNK))}::jsonb) AS v(id uuid, data jsonb, search text, restore boolean)
      WHERE /*scope*/ r.table_id = ${tableId}::uuid AND r.id = v.id`);
  }
  for (let i = 0; i < deleted.length; i += WRITE_CHUNK) {
    await tx.execute(sql`UPDATE dh_rows SET deleted_at = now(), deleted_by = ${ownerId}::uuid WHERE /*scope*/ table_id = ${tableId}::uuid AND id = ANY(${uuidArray(deleted.slice(i, i + WRITE_CHUNK))}::uuid[])`);
  }
  for (let i = 0; i < mappings.length; i += WRITE_CHUNK) {
    await tx.execute(sql`INSERT INTO dh_merge_rows (table_id, ident, row_id, source_table_id, source_row_id)
      SELECT ${tableId}::uuid, v.ident, v.row_id, v.source_table_id, v.source_row_id
      FROM jsonb_to_recordset(${JSON.stringify(mappings.slice(i, i + WRITE_CHUNK))}::jsonb) AS v(ident text, row_id uuid, source_table_id uuid, source_row_id uuid)
      ON CONFLICT (table_id, ident) DO UPDATE SET row_id = EXCLUDED.row_id, source_table_id = EXCLUDED.source_table_id, source_row_id = EXCLUDED.source_row_id`);
  }
  // Mappings whose row was purged from the trash have nothing left to point at.
  await tx.execute(sql`DELETE FROM dh_merge_rows mr WHERE /*scope:system*/ mr.table_id = ${tableId}::uuid AND NOT EXISTS (SELECT 1 FROM dh_rows r WHERE r.id = mr.row_id)`);
  const live = created.length + restored.length - deleted.length;
  if (live !== 0) await tx.execute(sql`UPDATE dh_tables SET row_count = row_count + ${live}::int WHERE /*scope*/ id = ${tableId}::uuid`);

  if (changes.length) {
    const seq = await nextChangeSeq(tx);
    await recordChanges(tx, tableId, changes, seq);
    const cols = [...changedKeys];
    const emit = async (event: string, ids: string[]) => {
      for (let i = 0; i < ids.length; i += EVENT_ROWS) {
        await enqueueOutbox(tx, { event, aggregateType: "datahub_table", aggregateId: tableId, payload: { table_id: tableId, row_ids: ids.slice(i, i + EVENT_ROWS), columns: cols, seq } });
      }
    };
    await emit("datahub.row.created", created);
    await emit("datahub.row.updated", updated);
    await emit("datahub.row.restored", restored);
    await emit("datahub.row.deleted", deleted);
  }
  return { created: created.length + restored.length, updated: updated.length, deleted: deleted.length };
}

// ------------------------------------------------------------------------------------------------
// the loop
// ------------------------------------------------------------------------------------------------

/** Syncs every merged table that has a request newer than its last sync. Returns how many were looked at. */
export async function processPendingMerges(db: Db, opts: { log?: Logger; max?: number } = {}): Promise<number> {
  const res = await db.execute(sql`SELECT table_id FROM dh_merges WHERE /*scope:system*/ request_seq > synced_seq ORDER BY updated_at LIMIT ${opts.max ?? 20}`);
  let n = 0;
  for (const r of res.rows as { table_id: string }[]) {
    try {
      const out = await syncMergedTable(db, r.table_id, opts.log);
      if (out !== "busy") n++;
    } catch (e) {
      // Do not retry a failing sync every tick: mark it, keep the old data. The next change (or "Đồng bộ lại") asks again.
      opts.log?.error({ err: e, table: r.table_id }, "merged table sync error");
      await db.execute(sql`UPDATE dh_merges SET status = 'error', error = ${JSON.stringify([{ table_id: r.table_id, name: null, reason: "sync_failed", message: (e as Error).message.slice(0, 300) }])}::jsonb, synced_seq = request_seq, updated_at = now() WHERE /*scope:system*/ table_id = ${r.table_id}::uuid`);
      n++;
    }
  }
  return n;
}

export function startMergeLoop(db: Db, log: Logger, intervalMs: number): { stop(): Promise<void> } {
  let stopped = false;
  let busy: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    if (stopped) return;
    busy = busy.then(() => processPendingMerges(db, { log })).catch((err) => log.error({ err }, "merge loop error"));
  }, intervalMs);
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await busy;
    },
  };
}
