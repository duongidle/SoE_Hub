import { api, apiList, qs, type Page } from "@/lib/api";
import type { BatchResult, Column, DatahubBrief, HistoryItem, Limits, Person, Row, TableDetail } from "./types";

/** Calls of the Datahub API used by the screens. Every number and name shown comes from these answers; nothing is computed here. */

export const dhKeys = {
  list: ["datahubs"] as const,
  datahub: (id: string) => ["datahub", id] as const,
  table: (id: string) => ["dh-table", id] as const,
  limits: ["dh-limits"] as const,
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
  limit?: number;
  cursor?: string | null;
  includeTotal?: boolean;
}

export const fetchRows = (tableId: string, q: RowQuery = {}): Promise<Page<Row>> =>
  apiList<Row>(`/tables/${tableId}/rows${qs({ filter: q.filter as object | undefined, sort: q.sort, search: q.search, limit: q.limit ?? 200, cursor: q.cursor, include_total: q.includeTotal ? true : undefined })}`);

export const fetchRowsByIds = async (tableId: string, ids: string[]): Promise<Row[]> => (await fetchRows(tableId, { filter: { field: "_id", op: "in", value: ids }, limit: Math.min(500, Math.max(1, ids.length)) })).data;

export const batchRows = (tableId: string, ops: unknown[]) => api<BatchResult>("POST", `/tables/${tableId}/rows/batch`, { ops });
export const restoreRowsBatch = (tableId: string, rowIds: string[]) => api<{ rows: Row[]; seq: number }>("POST", `/tables/${tableId}/rows/restore-batch`, { row_ids: rowIds });
export const getHistory = (tableId: string, rowId: string, cursor?: string | null) => api<{ items: HistoryItem[]; next_cursor: string | null }>("GET", `/tables/${tableId}/rows/${rowId}/history${qs({ limit: 30, cursor })}`);

export const lookupPeople = (opts: { ids?: string[]; q?: string }) => api<Person[]>("GET", `/datahub/people${qs({ ids: opts.ids?.join(","), q: opts.q })}`);
export const relationLabels = (tableId: string, column: string, ids: string[]) => api<{ id: string; row_no: number; label: string }[]>("GET", `/tables/${tableId}/relation-labels${qs({ column, ids: ids.join(",") })}`);

export type { Column };
