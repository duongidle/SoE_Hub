import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import ExcelJS from "exceljs";
import { and, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, TimeFilterSchema, filterParam, jsonParam, type FilterNode } from "@soe/shared";
import { dhJobs, files, newId, type Db } from "@soe/db";
import { systemScope } from "../../auth/access";
import { defineCommand } from "../../core/registry";
import { loadDatahubAccess, loadTableAccess, readableRows } from "./access";
import { resolveLinkTarget } from "./link-targets";
import { assertJobRoom, callAs, cancelRequested, JobCancelled, jobActor, jobOut, JobOut, patchJob, registerJobRunner, type JobEnv, type JobRow } from "./jobs";
import { listRows } from "./rows-read";
import { GROUP_FNS, listGroups, MAX_GROUP_LEVELS, type GroupFn } from "./rows-groups";
import { Id } from "./shared";
import { TableSchema } from "./table-schema";
import { assertColumnKey } from "./types";

export const EXPORT_FORMATS = ["csv", "xlsx", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const PAGE = 500;
const MIME: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json",
};
const VN_OFFSET_MS = 7 * 3600_000;

/** What the job needs to know to export (stored in `dh_jobs.params`). */
export interface ExportParams {
  format: ExportFormat;
  table_id?: string;
  datahub_id?: string;
  filter?: FilterNode;
  sort?: string;
  search?: string;
  time_filter?: unknown;
  /** Columns to export, by name or key, in this order (the visible columns of a view). Empty = all columns. */
  columns?: string[];
  /** Summary export (design module4 section 19b): one line per group of the view with its row count and totals, not the rows. */
  groups_only?: boolean;
  group?: { field: string; dir?: "asc" | "desc" }[];
  aggs?: Record<string, GroupFn>;
}

interface Col {
  key: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
}

type Raw = Record<string, unknown>;

// ------------------------------------------------------------------------------------------------
// cells
// ------------------------------------------------------------------------------------------------

const NO_EXPONENT = { useGrouping: false, maximumFractionDigits: 15 } as const;
const plainNumber = (n: number) => (Number.isInteger(n) && Math.abs(n) < 1e21 ? String(n) : n.toLocaleString("en-US", NO_EXPONENT));

/** Date-only text `YYYY-MM-DD` and the instant of a date-time as `YYYY-MM-DDTHH:mm:ss+07:00` (Vietnam time, the system time zone). */
function vnDateTime(iso: string): { text: string; wall: Date } {
  const ms = Date.parse(iso);
  const wall = new Date(ms + VN_OFFSET_MS);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const text = `${p(wall.getUTCFullYear(), 4)}-${p(wall.getUTCMonth() + 1)}-${p(wall.getUTCDate())}T${p(wall.getUTCHours())}:${p(wall.getUTCMinutes())}:${p(wall.getUTCSeconds())}+07:00`;
  return { text, wall };
}

type Cell = { kind: "empty" } | { kind: "text"; v: string } | { kind: "number"; v: number; fmt?: string } | { kind: "bool"; v: boolean } | { kind: "date"; v: Date; fmt: string };

interface Lookups {
  users: Map<string, string>;
  links: Map<string, string>;
  files: Map<string, string>;
}

/** One cell as plain, typed content. Used by all three formats so they always agree. */
function toCell(col: Col, v: unknown, lk: Lookups): Cell {
  if (v === null || v === undefined || v === "") return { kind: "empty" };
  const resultType = col.type === "formula" || col.type === "lookup" || col.type === "rollup" ? ((col.config.result_type as string | undefined) ?? "text") : col.type;
  const arr = Array.isArray(v) ? v : null;
  switch (col.type) {
    case "user":
      return { kind: "text", v: typeof v === "string" ? (lk.users.get(v) ?? v) : String(v) };
    case "relation":
      return { kind: "text", v: (arr ?? [v]).map((id) => lk.links.get(String(id)) ?? String(id)).join(", ") };
    case "attachment":
      return { kind: "text", v: (arr ?? [v]).map((id) => lk.files.get(String(id)) ?? String(id)).join(", ") };
    case "created_by":
    case "modified_by":
      return { kind: "text", v: lk.users.get(String(v)) ?? String(v) };
    case "multi_select":
      return { kind: "text", v: (arr ?? [v]).map(String).join(", ") };
    default:
  }
  if (arr) return { kind: "text", v: arr.map(String).join(", ") };
  switch (resultType) {
    case "number":
    case "currency":
    case "rating":
    case "auto_number":
      return typeof v === "number" ? { kind: "number", v } : { kind: "text", v: String(v) };
    case "percent":
      return typeof v === "number" ? { kind: "number", v, fmt: "0.##%" } : { kind: "text", v: String(v) };
    case "checkbox":
      return typeof v === "boolean" ? { kind: "bool", v } : { kind: "text", v: String(v) };
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      return m ? { kind: "date", v: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))), fmt: "dd/mm/yyyy" } : { kind: "text", v: String(v) };
    }
    case "datetime":
    case "field_modified":
    case "created_time":
    case "modified_time": {
      if (Number.isNaN(Date.parse(String(v)))) return { kind: "text", v: String(v) };
      return { kind: "date", v: vnDateTime(String(v)).wall, fmt: "dd/mm/yyyy hh:mm:ss" };
    }
    default:
      return { kind: "text", v: String(v) };
  }
}

/** Cells that start like a formula are prefixed with an apostrophe in CSV, so a spreadsheet never runs text someone typed. */
const csvSafe = (t: string) => (/^[=+@\-\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t) ? `'${t}` : t);

function csvText(c: Cell, col: Col): string {
  switch (c.kind) {
    case "empty":
      return "";
    case "number":
      return c.fmt ? `${plainNumber(Number((c.v * 100).toPrecision(12)))}%` : plainNumber(c.v);
    case "bool":
      return c.v ? "true" : "false";
    case "date": {
      const p = (n: number, w = 2) => String(n).padStart(w, "0");
      const d = c.v;
      const day = `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
      return c.fmt.includes("hh") ? `${day}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+07:00` : day;
    }
    default:
      void col;
      return csvSafe(c.v);
  }
}

const csvField = (s: string) => (/[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s);

function jsonValue(c: Cell): unknown {
  switch (c.kind) {
    case "empty":
      return null;
    case "date":
      return csvText(c, null as never);
    default:
      return c.v;
  }
}

// ------------------------------------------------------------------------------------------------
// summary export (groups only)
// ------------------------------------------------------------------------------------------------

const AGG_LABEL: Record<GroupFn, string> = { count: "Đếm", sum: "Tổng", avg: "Trung bình", min: "Nhỏ nhất", max: "Lớn nhất" };

interface GroupExport {
  cols: Col[];
  /** One entry per group line, in display order; each cell sits under its own column. */
  lines: { cells: (unknown | undefined)[]; depth: number }[];
  truncated: boolean;
}

/**
 * The groups and their totals as lines of a sheet. Everything comes from `listGroups`, the one function that also answers the grid, so a
 * number in the file is the number on the screen. Columns: one per grouping level (the group's value sits under its own level), "Số dòng",
 * then one per total the view asks for. The reader's own scope applies (split lock included) because `acc` is the exporter's.
 */
async function buildGroupExport(db: Db, acc: Awaited<ReturnType<typeof loadTableAccess>>, schema: TableSchema, p: ExportParams, all: Col[]): Promise<GroupExport> {
  const res = await listGroups(db, acc, schema, { filter: p.filter, timeFilter: p.time_filter, search: p.search, group: p.group!, aggs: p.aggs });
  const byKey = new Map(all.map((c) => [c.key, c]));
  const levels: Col[] = p.group!.map((g, i) => {
    const real = byKey.get(schema.fieldFor(g.field))!;
    return { ...real, key: `__g${i}` };
  });
  const aggs = Object.entries(p.aggs ?? {}).slice(0, 30).map(([ref, fn]) => {
    const real = byKey.get(schema.fieldFor(ref))!;
    return { key: real.key, fn, col: { key: `__a_${real.key}_${fn}`, name: `${real.name} (${AGG_LABEL[fn]})`, type: fn === "min" || fn === "max" ? real.type : "number", config: real.config } as Col };
  });
  const cols: Col[] = [...levels, { key: "__count", name: "Số dòng", type: "number", config: {} }, ...aggs.map((a) => a.col)];
  const lines = res.groups.map((g) => ({
    depth: g.depth,
    cells: [...levels.map((_, d) => (d === g.depth ? g.path[d] : undefined)), g.count, ...aggs.map((a) => g.aggs[a.key])],
  }));
  return { cols, lines, truncated: res.truncated };
}

// ------------------------------------------------------------------------------------------------
// lookups for one page
// ------------------------------------------------------------------------------------------------

const uuidArray = (ids: string[]) => `{${ids.join(",")}}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadLookups(db: Db, cols: Col[], rows: Raw[], ownerId: string, tableAccessScope: (alias?: string) => ReturnType<typeof sql>, lk: Lookups): Promise<void> {
  const need = { users: new Set<string>(), links: new Map<string, Set<string>>(), files: new Set<string>() };
  for (const r of rows) {
    const data = r.data as Raw;
    for (const c of cols) {
      const v = data[c.key];
      if (v === null || v === undefined) continue;
      if (c.type === "user" || c.type === "created_by" || c.type === "modified_by") {
        if (typeof v === "string" && UUID_RE.test(v) && !lk.users.has(v)) need.users.add(v);
      } else if (c.type === "relation" && Array.isArray(v)) {
        const target = c.config.target_table_id as string | undefined;
        if (!target) continue;
        const set = need.links.get(target) ?? new Set<string>();
        for (const id of v) if (typeof id === "string" && !lk.links.has(id)) set.add(id);
        need.links.set(target, set);
      } else if (c.type === "attachment" && Array.isArray(v)) {
        for (const id of v) if (typeof id === "string" && !lk.files.has(id)) need.files.add(id);
      }
    }
  }
  void tableAccessScope;
  if (need.users.size) {
    const res = await db.execute(sql`SELECT id, full_name FROM users WHERE id = ANY(${uuidArray([...need.users])}::uuid[])`);
    for (const r of res.rows as { id: string; full_name: string }[]) lk.users.set(r.id, r.full_name);
  }
  for (const [target, ids] of need.links) {
    if (ids.size === 0) continue;
    // Same label rule as the grid (`datahub.relation.labels`): first text column of the target table, else `#<row number>`; target must be the owner's.
    const key = (
      await db.execute(sql`SELECT key FROM dh_columns WHERE /*scope*/ table_id = ${target}::uuid AND deleted_at IS NULL AND type IN ('text', 'long_text', 'email', 'phone', 'url') ORDER BY position, created_at, id LIMIT 1`)
    ).rows[0] as { key: string } | undefined;
    const label = key ? sql`COALESCE(NULLIF(r.data->>${sql.raw(`'${assertColumnKey(key.key)}'`)}, ''), '#' || r.row_no::text)` : sql`'#' || r.row_no::text`;
    const lt = await resolveLinkTarget({ db, actor: jobActor(ownerId) }, ownerId, target);
    if (!lt) continue;
    const cond = lt.own ? sql`d.owner_id = ${ownerId}::uuid` : readableRows(lt.acc, "r");
    const res = await db.execute(sql`SELECT r.id, ${label} AS label FROM dh_rows r JOIN dh_tables t ON t.id = r.table_id JOIN dh_datahubs d ON d.id = t.datahub_id
      WHERE /*scope:rows*/ r.table_id = ${target}::uuid AND ${cond} AND r.id = ANY(${uuidArray([...ids])}::uuid[])`);
    for (const r of res.rows as { id: string; label: string }[]) lk.links.set(r.id, r.label);
  }
  if (need.files.size) {
    const rowsF = await db.select({ id: files.id, filename: files.filename }).from(files).where(and(systemScope(), isNull(files.deletedAt), sql`${files.id} = ANY(${uuidArray([...need.files])}::uuid[])`));
    for (const f of rowsF) lk.files.set(f.id, f.filename);
  }
}

// ------------------------------------------------------------------------------------------------
// writers (one per format; each gets header, then rows page by page)
// ------------------------------------------------------------------------------------------------

interface SheetSink {
  header(cols: Col[]): Promise<void>;
  row(cells: Cell[], cols: Col[]): Promise<void>;
  end(): Promise<void>;
}

async function write(stream: ReturnType<typeof createWriteStream>, chunk: string): Promise<void> {
  if (!stream.write(chunk)) await once(stream, "drain");
}

const closeStream = (s: ReturnType<typeof createWriteStream>) => new Promise<void>((res, rej) => (s.once("error", rej), s.end(() => res())));

function csvSink(file: string): SheetSink {
  const out = createWriteStream(file);
  return {
    async header(cols) {
      await write(out, `\uFEFF${cols.map((c) => csvField(c.name)).join(",")}\r\n`);
    },
    async row(cells, cols) {
      await write(out, `${cells.map((c, i) => csvField(csvText(c, cols[i]!))).join(",")}\r\n`);
    },
    end: () => closeStream(out),
  };
}

interface Meta {
  exportedBy: string;
  exportedAt: string;
  datahub: string;
  table: string;
}

function jsonSink(file: string, meta: Meta): SheetSink {
  const out = createWriteStream(file);
  let first = true;
  return {
    async header(cols) {
      await write(out, `{"exported_by":${JSON.stringify(meta.exportedBy)},"exported_at":${JSON.stringify(meta.exportedAt)},"datahub":${JSON.stringify(meta.datahub)},"table":${JSON.stringify(meta.table)},"columns":${JSON.stringify(cols.map((c) => ({ name: c.name, type: c.type })))},"rows":[`);
    },
    async row(cells, cols) {
      const o: Record<string, unknown> = {};
      cells.forEach((c, i) => (o[cols[i]!.name] = jsonValue(c)));
      await write(out, `${first ? "" : ","}\n${JSON.stringify(o)}`);
      first = false;
    },
    async end() {
      await write(out, "\n]}\n");
      await closeStream(out);
    },
  };
}

// ------------------------------------------------------------------------------------------------
// runner
// ------------------------------------------------------------------------------------------------

interface TableOutShape {
  id: string;
  name: string;
  datahub_name: string;
  row_count: number;
  access: string;
  columns: { key: string; name: string; type: string; config: Record<string, unknown> }[];
}

// eslint-disable-next-line no-control-regex
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80) || "export";
const sheetName = (s: string, used: Set<string>) => {
  let base = s.replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "Sheet";
  let n = 1;
  while (used.has(base.toLowerCase())) base = `${s.replace(/[\\/?*[\]:]/g, "_").slice(0, 27)} (${++n})`;
  used.add(base.toLowerCase());
  return base;
};

async function runExport(env: JobEnv, job: JobRow): Promise<void> {
  const p = job.params as unknown as ExportParams;
  const actor = jobActor(job.ownerId);
  const ctx = { db: env.db, actor };
  const [who] = (await env.db.execute(sql`SELECT full_name FROM users WHERE id = ${job.ownerId}::uuid`)).rows as { full_name: string }[];
  const exportedAt = new Date().toISOString();

  // Which tables: one table, or every table of the datahub that this person may see.
  let tableIds: string[];
  let datahubName: string;
  if (p.table_id) {
    const acc = await loadTableAccess(ctx, p.table_id);
    tableIds = [acc.tableId];
    datahubName = acc.datahub.name;
  } else {
    const dh = await loadDatahubAccess(ctx, p.datahub_id!);
    datahubName = dh.name;
    const d = await callAs<{ tables: { id: string }[] }>(env, job.ownerId, "datahub.datahub.get", { datahub_id: dh.id });
    tableIds = d.tables.map((t) => t.id);
  }
  const tables: TableOutShape[] = [];
  for (const id of tableIds) tables.push(await callAs<TableOutShape>(env, job.ownerId, "datahub.table.get", { table_id: id }));

  const dir = await mkdtemp(path.join(tmpdir(), "soe-export-"));
  const ext = p.format;
  const file = path.join(dir, `out.${ext}`);
  try {
    let total = 0;
    for (const t of tables) total += t.row_count;
    await patchJob(env.db, job.id, { phase: "writing", progressTotal: total, progressDone: 0 });

    const xlsx = p.format === "xlsx" ? new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: true, useSharedStrings: false }) : null;
    if (xlsx) {
      xlsx.creator = who?.full_name ?? "SoE Hub";
      xlsx.created = new Date();
    }
    const usedSheets = new Set<string>(["công thức", "thông tin xuất"]);
    const formulaRows: [string, string, string][] = [];
    let done = 0;
    const counts: Record<string, number> = {};
    let groupsTruncated = false;

    for (const t of tables) {
      const acc = await loadTableAccess(ctx, t.id);
      const schema = await TableSchema.load(env.db, acc);
      let cols: Col[] = t.columns.map((c) => ({ key: c.key, name: c.name, type: c.type, config: c.config }));
      if (p.columns?.length) {
        const wanted: Col[] = [];
        for (const ref of p.columns) {
          const sc = schema.tryResolve(ref);
          const c = sc && cols.find((x) => x.key === sc.key);
          if (c && !wanted.includes(c)) wanted.push(c);
        }
        if (wanted.length === 0) throw new AppError("validation_error", "Không cột nào trong `columns` có trong bảng.");
        cols = wanted;
      }
      // Formulas are visible to the owner only (people the table is shared with see values, never the formula text).
      if (acc.level === "owner" && !p.groups_only) {
        for (const c of cols) if (c.type === "formula" && typeof c.config.formula === "string") formulaRows.push([t.name, c.name, c.config.formula]);
      }

      let groupOut: GroupExport | null = null;
      if (p.groups_only) {
        groupOut = await buildGroupExport(env.db, acc, schema, p, t.columns.map((c) => ({ key: c.key, name: c.name, type: c.type, config: c.config })));
        cols = groupOut.cols;
        if (groupOut.truncated) groupsTruncated = true;
      }
      let sink: SheetSink;
      let sheet: ExcelJS.Worksheet | null = null;
      if (xlsx) {
        sheet = xlsx.addWorksheet(sheetName(t.name, usedSheets), { views: [{ state: "frozen", ySplit: 1 }] });
        sheet.columns = cols.map((c) => ({ width: Math.min(60, Math.max(12, c.name.length + 4)) }));
        const head = sheet.addRow(cols.map((c) => c.name));
        head.font = { bold: true };
        head.commit();
        sink = {
          header: async () => {},
          row: async (cells) => {
            const r = sheet!.addRow(cells.map((c) => (c.kind === "empty" ? null : c.v)));
            cells.forEach((c, i) => {
              const fmt = c.kind === "date" || c.kind === "number" ? c.fmt : undefined;
              if (fmt) r.getCell(i + 1).numFmt = fmt;
            });
            r.commit();
          },
          end: async () => {
            sheet!.commit();
          },
        };
      } else if (p.format === "csv") sink = csvSink(file);
      else sink = jsonSink(file, { exportedBy: who?.full_name ?? "", exportedAt, datahub: datahubName, table: t.name });
      await sink.header(cols);

      const lk: Lookups = { users: new Map(), links: new Map(), files: new Map() };
      const hasVirtual = cols.some((c) => ["row_id", "created_time", "created_by", "modified_time", "modified_by"].includes(c.type));
      const fields = p.columns?.length || hasVirtual ? cols.map((c) => c.key).join(",") : undefined;
      let cursor: string | undefined;
      let n = 0;
      if (groupOut) {
        const rows = groupOut.lines.map((l) => ({ data: Object.fromEntries(l.cells.map((v, i) => [cols[i]!.key, v])) }));
        await loadLookups(env.db, cols, rows as unknown as Raw[], acc.datahub.ownerId, () => sql``, lk);
        for (const r of rows) await sink.row(cols.map((c) => toCell(c, r.data[c.key], lk)), cols);
        n = rows.length;
        done += n;
        await patchJob(env.db, job.id, { progressDone: Math.min(done, Math.max(total, done)), progressTotal: Math.max(total, done) });
      }
      for (; !groupOut; ) {
        if (await cancelRequested(env.db, job.id)) throw new JobCancelled();
        const page = await listRows(env.db, acc, schema, { filter: p.filter, sort: p.sort, search: p.search, timeFilter: p.time_filter, fields, limit: PAGE, cursor, labels: true, consistent: true });
        const rows = page.items as unknown as Raw[];
        await loadLookups(env.db, cols, rows, acc.datahub.ownerId, () => sql``, lk);
        for (const r of rows) {
          const data = r.data as Raw;
          await sink.row(
            cols.map((c) => toCell(c, data[c.key], lk)),
            cols,
          );
        }
        n += rows.length;
        done += rows.length;
        await patchJob(env.db, job.id, { progressDone: Math.min(done, Math.max(total, done)), progressTotal: Math.max(total, done) });
        if (!page.nextCursor || rows.length === 0) break;
        cursor = page.nextCursor;
      }
      await sink.end();
      counts[t.name] = n;
      if (p.format !== "xlsx") break; // csv and json hold one table
    }

    if (xlsx) {
      const info = xlsx.addWorksheet("Thông tin xuất");
      info.columns = [{ width: 18 }, { width: 60 }];
      for (const r of [
        ["Người xuất", who?.full_name ?? ""],
        ["Thời điểm", vnDateTime(exportedAt).text],
        ["Datahub", datahubName],
        ["Bảng", tables.map((t) => t.name).join(", ")],
        ["Số dòng", Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join("; ")],
        ["Ghi chú", p.groups_only ? `Dạng tổng hợp: mỗi dòng là một nhóm của view, kèm số dòng và các cột tổng.${groupsTruncated ? " Có hơn 1.000 nhóm ở một cấp nên chỉ có 1.000 nhóm đầu." : ""}` : "Giá trị đã tính sẵn tại thời điểm xuất."],
      ]) info.addRow(r).commit();
      info.commit();
      if (formulaRows.length) {
        const fs = xlsx.addWorksheet("Công thức");
        fs.columns = [{ width: 24 }, { width: 28 }, { width: 90 }];
        const fh = fs.addRow(["Bảng", "Cột", "Công thức"]);
        fh.font = { bold: true };
        fh.commit();
        for (const r of formulaRows) {
          // Written as text (never a live formula): the sheet only shows how each column is calculated.
          fs.addRow(r).commit();
        }
        fs.commit();
      }
      await xlsx.commit();
    }

    const bytes = await readFile(file);
    const first = tables[0]!;
    const base = p.table_id ? `${safeName(datahubName)} - ${safeName(first.name)}` : safeName(datahubName);
    const stamp = vnDateTime(exportedAt).text.slice(0, 10);
    const name = `${base} (${stamp}).${ext}`;
    const key = `files/dh-export/${newId()}`;
    await env.storage.put(key, bytes, MIME[p.format]);
    await patchJob(env.db, job.id, {
      resultKey: key,
      resultName: name,
      resultType: MIME[p.format],
      resultSize: bytes.length,
      report: { rows: counts, tables: tables.map((t) => t.name), formulas_sheet: formulaRows.length > 0 },
      progressDone: done,
      progressTotal: Math.max(total, done),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

registerJobRunner("export", runExport);

// ------------------------------------------------------------------------------------------------
// command
// ------------------------------------------------------------------------------------------------

export const exportOperations = [
  defineCommand({
    name: "datahub.export.create",
    summary: "Xuất bảng (hoặc cả datahub) ra CSV, XLSX hoặc JSON. Chạy nền: gọi `datahub.job.get` đến khi xong rồi lấy `datahub.job.download_url`.",
    description:
      "File chứa **giá trị đã tính sẵn** của cột công thức. XLSX có thêm sheet `Công thức` (chỉ khi bạn là chủ datahub) và `Thông tin xuất` (người xuất, thời điểm). " +
      "Xuất theo view: gửi `filter`, `sort`, `search`, `time_filter` và `columns` (các cột đang hiện, theo thứ tự) giống `datahub.row.list`. Gửi `datahub_id` (không có `table_id`) để xuất mọi bảng bạn thấy: chỉ XLSX (mỗi bảng một sheet). " +
      "Người được chia sẻ (Xem hoặc Sửa) xuất được dữ liệu họ thấy, không có nội dung công thức. Việc xuất được ghi vào nhật ký.",
    permission: "datahub:datahub:use",
    aiAllowed: true,
    input: z
      .object({
        table_id: Id.optional(),
        datahub_id: Id.optional(),
        format: z.enum(EXPORT_FORMATS).default("xlsx"),
        filter: filterParam,
        sort: z.string().max(2000).optional(),
        search: z.string().max(200).optional(),
        time_filter: jsonParam(TimeFilterSchema),
        columns: z.array(z.string().min(1).max(100)).max(200).optional(),
        groups_only: z.boolean().optional().describe("Xuất dạng tổng hợp: mỗi dòng là một nhóm của view (cột nhóm, Số dòng, các cột tổng), không xuất từng dòng. Cần `table_id` và `group`."),
        group: jsonParam(z.array(z.object({ field: z.string().min(1).max(100), dir: z.enum(["asc", "desc"]).optional() })).min(1).max(MAX_GROUP_LEVELS)),
        aggs: jsonParam(z.record(z.string().max(100), z.enum(GROUP_FNS))),
      })
      .refine((v) => !!v.table_id !== !!v.datahub_id, "Gửi đúng một trong `table_id` hoặc `datahub_id`.")
      .refine((v) => !v.datahub_id || v.format === "xlsx", "Xuất cả datahub chỉ dùng được định dạng xlsx (mỗi bảng một sheet).")
      .refine((v) => !v.groups_only || (!!v.table_id && !!v.group), "Xuất tổng hợp cần `table_id` và `group` (cột nhóm của view)."),
    output: JobOut,
    http: { method: "POST", path: "/datahub/exports", status: 202 },
    handler: async (ctx, i) => {
      await assertJobRoom(ctx.db, ctx.actor.userId);
      let datahubId: string;
      let tableId: string | null = null;
      if (i.table_id) {
        const acc = await loadTableAccess(ctx, i.table_id);
        datahubId = acc.datahub.id;
        tableId = acc.tableId;
        // Validate filter/sort/columns now so a mistake is an immediate 400, not a failed job.
        const schema = await TableSchema.load(ctx.db, acc);
        schema.normalizeFilter(i.filter);
        schema.normalizeSort(i.sort);
        for (const c of i.columns ?? []) schema.resolve(c);
        if (i.groups_only) {
          for (const g of i.group ?? []) schema.fieldFor(g.field);
          for (const k of Object.keys(i.aggs ?? {})) schema.fieldFor(k);
        }
      } else {
        datahubId = (await loadDatahubAccess(ctx, i.datahub_id!)).id;
      }
      const params: ExportParams = { format: i.format, ...(i.table_id ? { table_id: i.table_id } : { datahub_id: i.datahub_id }), filter: i.filter as FilterNode | undefined, sort: i.sort, search: i.search, time_filter: i.time_filter, columns: i.columns, ...(i.groups_only ? { groups_only: true, group: i.group, aggs: i.aggs } : {}) };
      const [job] = await ctx.db
        .insert(dhJobs)
        .values({ kind: "export", status: "pending", ownerId: ctx.actor.userId, datahubId, tableId, params: JSON.parse(JSON.stringify(params)) })
        .returning();
      ctx.audit({ type: "datahub_export", id: job!.id, details: { format: i.format, table_id: tableId, datahub_id: datahubId, scope: tableId ? "table" : "datahub", filtered: !!(i.filter || i.search || i.time_filter), columns: i.columns?.length ?? null, groups_only: !!i.groups_only } });
      return jobOut(job!);
    },
  }),
];
