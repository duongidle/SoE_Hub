import { api, apiList, qs, type Page } from "@/lib/api";
import type { TimeFilter, TimeRange } from "@soe/shared";
import type { ConversionReport, TypeInfo } from "./column-config";
import type { FnInfo } from "./formula-assist";
import type { BatchResult, Column, DatahubBrief, GroupResult, HistoryItem, Limits, Person, Row, TableDetail, TimeRangeInfo } from "./types";
import type { GroupFn, ViewConfig, ViewDto } from "./view-config";

/** Calls of the Datahub API used by the screens. Every number and name shown comes from these answers; nothing is computed here. */

export const dhKeys = {
  list: ["datahubs"] as const,
  datahub: (id: string) => ["datahub", id] as const,
  table: (id: string) => ["dh-table", id] as const,
  limits: ["dh-limits"] as const,
  views: (tableId: string) => ["dh-views", tableId] as const,
  timeRange: (range: unknown) => ["dh-time-range", range] as const,
};

export const listDatahubs = (scope: "mine" | "shared" | "all" = "all") => api<DatahubBrief[]>("GET", `/datahubs${qs({ scope })}`);
export const getDatahub = (id: string) => api<DatahubBrief>("GET", `/datahubs/${id}`);
export const getTable = (id: string) => api<TableDetail>("GET", `/tables/${id}`);
export const getLimits = () => api<Limits>("GET", "/datahub/limits");

export const createDatahub = (name: string, description?: string) => api<DatahubBrief>("POST", "/datahubs", { name, description: description || undefined });
export const updateDatahub = (id: string, body: { name?: string; description?: string | null; version?: number }) => api<DatahubBrief>("PATCH", `/datahubs/${id}`, body);
export const deleteDatahub = (id: string) => api("DELETE", `/datahubs/${id}`);
export const restoreDatahub = (id: string, name?: string) => api("POST", `/datahubs/${id}/restore`, name ? { name } : {});

export const createTable = (datahubId: string, name: string) => api<{ id: string; name: string }>("POST", `/datahubs/${datahubId}/tables`, { name });
export const updateTable = (id: string, body: { name?: string; position?: number; version?: number }) => api("PATCH", `/tables/${id}`, body);
export const deleteTable = (id: string) => api("DELETE", `/tables/${id}`);
export const restoreTable = (id: string, name?: string) => api("POST", `/tables/${id}/restore`, name ? { name } : {});

export interface RowQuery {
  filter?: unknown;
  sort?: string;
  search?: string;
  timeFilter?: TimeFilter;
  marks?: unknown[];
  limit?: number;
  cursor?: string | null;
  /** Window read: skip this many rows (counted from the end of the list with `reverse`). */
  offset?: number;
  reverse?: boolean;
  includeTotal?: boolean;
}

const json = (v: unknown) => (v === undefined ? undefined : (v as object));

export const fetchRows = (tableId: string, q: RowQuery = {}): Promise<Page<Row>> =>
  apiList<Row>(
    `/tables/${tableId}/rows${qs({
      filter: json(q.filter),
      sort: q.sort,
      search: q.search,
      time_filter: json(q.timeFilter),
      marks: q.marks?.length ? (q.marks as object) : undefined,
      limit: q.limit ?? 200,
      cursor: q.cursor,
      offset: q.offset,
      reverse: q.reverse ? true : undefined,
      include_total: q.includeTotal ? true : undefined,
    })}`,
  );

export const fetchGroups = (tableId: string, q: { filter?: unknown; timeFilter?: TimeFilter; search?: string; group: { field: string; dir: "asc" | "desc" }[]; aggs?: Record<string, GroupFn> }) =>
  api<GroupResult>("GET", `/tables/${tableId}/row-groups${qs({ filter: json(q.filter), time_filter: json(q.timeFilter), search: q.search, group: q.group as unknown as object, aggs: q.aggs && Object.keys(q.aggs).length ? q.aggs : undefined })}`);

export const resolveTimeRange = (range: TimeRange) => api<TimeRangeInfo>("GET", `/datahub/time-range${qs({ range: range as unknown as object })}`);

// ---- views (design module2 section 5)
export const listViews = (tableId: string) => api<{ views: ViewDto[]; last_view_id: string | null }>("GET", `/tables/${tableId}/views`);
export const createView = (tableId: string, body: { name: string; shared?: boolean; config?: ViewConfig }) => api<ViewDto>("POST", `/tables/${tableId}/views`, body);
export const updateView = (viewId: string, body: { name?: string; position?: number; config?: Record<string, unknown> }) => api<ViewDto>("PATCH", `/views/${viewId}`, body);
export const resetView = (viewId: string) => api<ViewDto>("POST", `/views/${viewId}/reset`, {});
export const deleteView = (viewId: string) => api<{ id: string; deleted: true }>("DELETE", `/views/${viewId}`);
export const rememberView = (tableId: string, viewId: string) => api("PUT", `/tables/${tableId}/last-view`, { view_id: viewId });

export const fetchRowsByIds = async (tableId: string, ids: string[]): Promise<Row[]> => (await fetchRows(tableId, { filter: { field: "_id", op: "in", value: ids }, limit: Math.min(500, Math.max(1, ids.length)) })).data;

export const batchRows = (tableId: string, ops: unknown[]) => api<BatchResult>("POST", `/tables/${tableId}/rows/batch`, { ops });
export const restoreRowsBatch = (tableId: string, rowIds: string[]) => api<{ rows: Row[]; seq: number }>("POST", `/tables/${tableId}/rows/restore-batch`, { row_ids: rowIds });
export const getHistory = (tableId: string, rowId: string, cursor?: string | null) => api<{ items: HistoryItem[]; next_cursor: string | null }>("GET", `/tables/${tableId}/rows/${rowId}/history${qs({ limit: 30, cursor })}`);

/** With `tableId`, `q` suggests only the owner and members of that table, and `ids` also say who is still a member. */
export const lookupPeople = (opts: { ids?: string[]; q?: string; tableId?: string }) => api<Person[]>("GET", `/datahub/people${qs({ ids: opts.ids?.join(","), q: opts.q, table_id: opts.tableId })}`);
export const relationLabels = (tableId: string, column: string, ids: string[]) => api<{ id: string; row_no: number; label: string }[]>("GET", `/tables/${tableId}/relation-labels${qs({ column, ids: ids.join(",") })}`);

export type { Column };

// ---- columns (design module2 sections 4 and 6; only the owner changes structure)
export interface ColumnBody {
  name?: string;
  type?: string;
  config?: Record<string, unknown>;
  required?: boolean;
  allow_edit?: boolean;
  unique?: boolean;
  default_value?: unknown;
  description?: string | null;
  display?: Record<string, unknown>;
  version?: number;
}
export const columnTypes = () => api<TypeInfo[]>("GET", "/datahub/column-types");
export const createColumn = (tableId: string, body: ColumnBody) => api<Column>("POST", `/tables/${tableId}/columns`, body);
export const updateColumn = (tableId: string, column: string, body: ColumnBody) => api<Column>("PATCH", `/tables/${tableId}/columns/${encodeURIComponent(column)}`, body);
export const deleteColumn = (tableId: string, column: string) => api<{ id: string; deleted: true }>("DELETE", `/tables/${tableId}/columns/${encodeURIComponent(column)}`);
export const restoreColumn = (tableId: string, column: string, name?: string) => api<Column>("POST", `/tables/${tableId}/columns/${encodeURIComponent(column)}/restore`, name ? { name } : {});
export const previewTypeChange = (tableId: string, column: string, type: string, config?: Record<string, unknown>) =>
  api<ConversionReport & { new_config: Record<string, unknown> }>("POST", `/tables/${tableId}/columns/${encodeURIComponent(column)}/type-preview`, { type, config });
export const changeColumnType = (tableId: string, column: string, type: string, config: Record<string, unknown> | undefined, acceptDataLoss: boolean) =>
  api<{ column: Column; report: ConversionReport }>("POST", `/tables/${tableId}/columns/${encodeURIComponent(column)}/type`, { type, config, accept_data_loss: acceptDataLoss });

export interface FormulaPreview {
  ok: boolean;
  formula: string | null;
  errors: { message: string; start: number; end: number }[];
  result_type: string | null;
  volatile: "today" | "now" | null;
  reads: { columns: string[]; tables: string[]; grouped_calls: number; scanned_tables: { name: string; rows: number }[] };
  rows: { row_id: string; row_no: number; value: unknown; error: string | null; error_message: string | null }[];
}
export const formulaFunctions = () => api<{ functions: FnInfo[]; errors: { code: string; message: string }[] }>("GET", "/datahub/formula-functions");
export const previewFormula = (tableId: string, body: { formula: string; result_type?: string; column?: string }) => api<FormulaPreview>("POST", `/tables/${tableId}/formula/preview`, body);

// ---- linked rows and attached files
export const searchRelation = (tableId: string, column: string, o: { q?: string; after?: number | null; limit?: number } = {}) =>
  api<{ data: { id: string; row_no: number; label: string }[]; next_after: number | null }>("GET", `/tables/${tableId}/relation-search${qs({ column, q: o.q, after: o.after ?? undefined, limit: o.limit })}`);

export interface FileBrief {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
}
export const attachmentInfo = (tableId: string, ids: string[]) => api<FileBrief[]>("GET", `/tables/${tableId}/attachments${qs({ ids: ids.join(",") })}`);
export const attachmentUrl = (tableId: string, fileId: string) => api<{ url: string; expires_at: string; filename: string }>("GET", `/tables/${tableId}/attachments/${fileId}/download-url`);

/** The local (dev) storage driver signs addresses with the API's own host; the page reaches it through its own origin. S3 addresses are left alone. */
export function storageAddress(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.startsWith("/api/v1/storage/local/") ? `${u.pathname}${u.search}` : url;
  } catch {
    return url;
  }
}

/** Uploads one file with the storage flow of Stage 0 (init, PUT to the signed address, complete) and returns its record. */
export async function uploadFile(file: File, contentType?: string): Promise<FileBrief> {
  const init = await api<{ file: FileBrief; upload: { url: string; method: "PUT"; headers: Record<string, string> } }>("POST", "/files", { filename: file.name, content_type: contentType ?? (file.type || "application/octet-stream"), size_bytes: file.size });
  // The signed address is the credential: no session cookie (the API refuses a cookie-bearing write that has no CSRF header).
  const put = await fetch(storageAddress(init.upload.url), { method: "PUT", headers: init.upload.headers, body: file, credentials: "omit" });
  if (!put.ok) throw new Error("Không tải được file lên. Thử lại sau ít phút.");
  await api("POST", `/files/${init.file.id}/complete`, {});
  return init.file;
}

// ---- duplicate rows (design module2 section 7a) ----------------------------------------------------
export interface DuplicateGroup {
  ids: string[];
  /** True size of the group (`ids` lists at most 50). */
  count: number;
}
export interface DuplicatePage {
  columns: { key: string; name: string }[];
  total_groups: number;
  total_rows: number;
  groups: DuplicateGroup[];
  has_more: boolean;
}
export const findDuplicates = (tableId: string, columns: string[], offset = 0, limit = 20) => api<DuplicatePage>("GET", `/tables/${tableId}/duplicates${qs({ columns: columns.join(","), offset, limit })}`);
export interface ResolveResult {
  groups_resolved: number;
  rows_removed: number;
  rows_merged: number;
  remaining_groups: number;
  seq: number;
}
export const resolveDuplicates = (tableId: string, body: { groups: { keep_id: string; remove_ids: string[]; values?: Record<string, unknown> }[] } | { all: { columns: string[]; keep: "first" | "last" | "most_filled"; fill_empty: boolean } }) =>
  api<ResolveResult>("POST", `/tables/${tableId}/duplicates/resolve`, body);

export interface Share {
  id: string;
  datahub_id: string;
  table_id: string | null;
  grantee_id: string;
  grantee_name: string | null;
  grantee_email: string | null;
  permission: "view" | "edit_data";
}
export const listShares = (datahubId: string) => api<Share[]>("GET", `/datahubs/${datahubId}/shares`);
export const setShare = (datahubId: string, body: { grantee_id: string; table_id: string | null; permission: "view" | "edit_data" }) => api<Share>("PUT", `/datahubs/${datahubId}/shares`, body);
export const removeShare = (datahubId: string, shareId: string) => api<{ id: string; removed: true; tagged_rows: number }>("DELETE", `/datahubs/${datahubId}/shares/${shareId}`);
/** How many rows name this person in a Người dùng cell, asked before the share is removed. */
export const sharedTagged = (datahubId: string, shareId: string) =>
  api<{ user_id: string; rows: number; tables: { table_id: string; table_name: string; rows: number }[] }>("GET", `/datahubs/${datahubId}/shares/${shareId}/tagged`);
export interface ShareOptionsBody {
  key_split?: boolean;
  key_columns?: string[];
  key_primary?: string | null;
  members_bulk_create?: boolean;
}
export const setShareOptions = (tableId: string, body: ShareOptionsBody) => api<TableDetail>("PUT", `/tables/${tableId}/share-options`, body);

export interface TrashList {
  retention_days: number;
  datahubs: { id: string; name: string; deleted_at: string; purge_at: string }[];
  tables: { id: string; datahub_id: string; datahub_name: string; name: string; deleted_at: string; purge_at: string }[];
  columns: { id: string; key: string; name: string; type: string; deleted_at: string; purge_at: string }[];
  rows: { id: string; row_no: number; deleted_at: string; deleted_by: string | null; purge_at: string }[];
}
export const getTrash = (tableId?: string) => api<TrashList>("GET", `/datahub/trash${qs({ table_id: tableId })}`);
export const restoreRow = (tableId: string, rowId: string) => api("POST", `/tables/${tableId}/rows/${rowId}/restore`, {});

export interface UserLimit {
  user_id: string;
  full_name: string;
  email: string | null;
  max_datahubs: number | null;
  max_tables: number | null;
  max_columns: number | null;
}
export const listUserLimits = () => api<UserLimit[]>("GET", "/admin/datahub/limits");
export const setUserLimit = (userId: string, body: { max_datahubs?: number | null; max_tables?: number | null; max_columns?: number | null }) => api("PUT", `/admin/datahub/limits/${userId}`, body);

// ---- import and export (design module2 sections 8, 9): background jobs the screen follows ---------------------------
export interface JobDto {
  id: string;
  kind: "import" | "export";
  status: "draft" | "pending" | "running" | "done" | "failed" | "cancelled";
  phase: string | null;
  progress: { done: number; total: number };
  datahub_id: string | null;
  table_id: string | null;
  report: unknown;
  error: string | null;
  source_name: string | null;
  result: { name: string; type: string; size_bytes: number } | null;
}
export const jobFinished = (j: Pick<JobDto, "status">) => j.status === "done" || j.status === "failed" || j.status === "cancelled";
export const getJob = (id: string) => api<JobDto>("GET", `/datahub/jobs/${id}`);
export const cancelJob = (id: string) => api<JobDto>("POST", `/datahub/jobs/${id}/cancel`, {});
export const jobDownload = (id: string) => api<{ url: string; expires_at: string; filename: string }>("GET", `/datahub/jobs/${id}/download-url`);

export interface ExportBody {
  table_id?: string;
  datahub_id?: string;
  format: "csv" | "xlsx" | "json";
  filter?: unknown;
  sort?: string;
  search?: string;
  time_filter?: unknown;
  columns?: string[];
  /** Summary: one line per group of the view (with its row count and totals) instead of the rows. */
  groups_only?: boolean;
  group?: { field: string; dir: "asc" | "desc" }[];
  aggs?: Record<string, string>;
}
export const createExport = (body: ExportBody) => api<JobDto>("POST", "/datahub/exports", body);

export interface ImportColumnGuess {
  index: number;
  letter: string;
  header: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  non_empty: number;
  formula_count: number;
  sample: string[];
}
export interface ImportSheetInfo {
  name: string;
  hidden: boolean;
  header_row: number;
  row_count: number;
  col_count: number;
  has_formulas: boolean;
  columns: ImportColumnGuess[];
  preview: { row: number; cells: string[] }[];
}
export interface ImportMappingBody {
  datahub: { id: string } | { name: string };
  import_formulas: boolean;
  sheets: {
    sheet: string;
    header_row: number;
    table: { mode: "new"; name: string } | { mode: "existing"; table_id: string };
    columns: { index: number; target?: string; name?: string; type?: string }[];
    write: "add" | "upsert" | "replace";
    key?: string;
    on_error: "skip_row" | "blank_cell";
  }[];
}
export interface ImportColumnReport {
  name: string;
  type: string;
  source: "new" | "existing" | "formula";
  formula: { status: "formula" | "value"; reason: string | null; code: string | null; warnings: string[] } | null;
}
export interface ImportIssue {
  row: number;
  column: string | null;
  message: string;
}
export interface ImportPreview {
  ok: boolean;
  blocking: string[];
  sheets: { sheet: string; table: string; new_table: boolean; rows_total: number; rows_checked: number; sampled: boolean; valid: number; invalid: number; errors: ImportIssue[]; columns: ImportColumnReport[] }[];
}
export interface ImportSheetReport {
  sheet: string;
  table_id: string | null;
  table_name: string;
  new_table: boolean;
  rows_total: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  deleted: number;
  error_count: number;
  errors: ImportIssue[];
  columns: ImportColumnReport[];
}
export const analyzeImport = (src: { file_id?: string; url?: string; text?: string; filename?: string }) => api<{ job: JobDto; sheets: ImportSheetInfo[] }>("POST", "/datahub/imports", src);
export const importSheet = (jobId: string, sheet: string, headerRow: number) => api<ImportSheetInfo>("POST", `/datahub/imports/${jobId}/sheet`, { sheet, header_row: headerRow });
export const previewImport = (jobId: string, mapping: ImportMappingBody) => api<ImportPreview>("POST", `/datahub/imports/${jobId}/preview`, { mapping });
export const startImport = (jobId: string, mapping: ImportMappingBody) => api<JobDto>("POST", `/datahub/imports/${jobId}/start`, { mapping });

/** Starts the browser's download of an address from the storage (also the local development one). */
export function saveFromUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = storageAddress(url);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---- merged tables (design module3 section 4)
export type MergeStrategy = "priority" | "latest" | "cell_merge";
export const MERGE_STRATEGY_LABELS: Record<MergeStrategy, string> = {
  priority: "Giữ dòng của nguồn ưu tiên cao hơn",
  latest: "Giữ dòng sửa gần nhất",
  cell_merge: "Gộp từng ô (lấy giá trị không rỗng đầu tiên theo ưu tiên)",
};
export interface MergeInput {
  sources: string[];
  /** Manual column mapping; absent = same-name columns are merged automatically. */
  columns?: { name: string; from: Record<string, string> }[];
  dedup?: { columns: string[]; strategy: MergeStrategy } | null;
}
export interface MergeDuplicateGroup {
  key: string;
  rows: { source_table_id: string; source_name: string; row_id: string; row_no: number; kept: boolean }[];
}
export interface MergeDiagnostics {
  sources: { table_id: string; name: string; rows: number; kept: number; dropped: number }[];
  total_read: number;
  total_kept: number;
  dropped: number;
  duplicate_groups: number;
  empty_key_rows: number;
  strategy: MergeStrategy | null;
  warnings: { code: string; message: string; source_table_id?: string; column?: string }[];
  duplicate_sample: MergeDuplicateGroup[];
  summary: string;
}
export interface MergeInfo {
  table_id: string;
  status: "pending" | "ok" | "error";
  syncing: boolean;
  synced_at: string | null;
  version: number;
  errors: { table_id: string; name: string | null; reason: string; message?: string }[];
  diagnostics: MergeDiagnostics | null;
  config: {
    sources: { table_id: string; name: string | null; datahub_name: string | null }[];
    columns: { key: string; name: string; type: string; from: Record<string, { column_key: string; column_name: string | null }> }[];
    dedup: { columns: string[]; strategy: MergeStrategy } | null;
  } | null;
}
export interface MergePreview {
  columns: { name: string; type: string; from: Record<string, string> }[];
  diagnostics: MergeDiagnostics;
}

export const mergeKeys = { info: (tableId: string) => ["dh-merge", tableId] as const };
export const getMerge = (tableId: string) => api<MergeInfo>("GET", `/tables/${tableId}/merge`);
export const createMerged = (datahubId: string, body: MergeInput & { name: string }) => api<{ table: { id: string; name: string }; merge: MergeInfo }>("POST", `/datahubs/${datahubId}/merged-tables`, body);
export const updateMerged = (tableId: string, body: MergeInput & { version?: number }) => api<MergeInfo>("PUT", `/tables/${tableId}/merge`, body);
export const previewMerge = (datahubId: string, body: MergeInput) => api<MergePreview>("POST", `/datahubs/${datahubId}/merge-preview`, body);
export const syncMerged = (tableId: string) => api<MergeInfo>("POST", `/tables/${tableId}/merge/sync`, {});
export const mergeDuplicates = (tableId: string, offset = 0, limit = 20) => api<{ total: number; groups: MergeDuplicateGroup[] }>("GET", `/tables/${tableId}/merge/duplicates${qs({ offset, limit })}`);
export const mergeOrigin = (tableId: string, rowId: string) => api<{ source_datahub_id: string | null; source_table_id: string; source_table_name: string | null; source_row_id: string; source_row_no: number | null }>("GET", `/tables/${tableId}/merge/origin/${rowId}`);
