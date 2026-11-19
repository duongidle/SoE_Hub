import { api, apiList, qs, type Page } from "@/lib/api";
import type { TimeFilter, TimeRange } from "@soe/shared";
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
export const restoreDatahub = (id: string) => api("POST", `/datahubs/${id}/restore`, {});

export const createTable = (datahubId: string, name: string) => api<{ id: string; name: string }>("POST", `/datahubs/${datahubId}/tables`, { name });
export const updateTable = (id: string, body: { name?: string; position?: number; version?: number }) => api("PATCH", `/tables/${id}`, body);
export const deleteTable = (id: string) => api("DELETE", `/tables/${id}`);
export const restoreTable = (id: string) => api("POST", `/tables/${id}/restore`, {});

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

export const lookupPeople = (opts: { ids?: string[]; q?: string }) => api<Person[]>("GET", `/datahub/people${qs({ ids: opts.ids?.join(","), q: opts.q })}`);
export const relationLabels = (tableId: string, column: string, ids: string[]) => api<{ id: string; row_no: number; label: string }[]>("GET", `/tables/${tableId}/relation-labels${qs({ column, ids: ids.join(",") })}`);

export type { Column };
