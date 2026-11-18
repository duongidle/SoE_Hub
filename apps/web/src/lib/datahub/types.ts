/** Shapes the Datahub API returns (see docs/api/openapi.json). Only what the screens read. */

export type Level = "owner" | "edit_data" | "view";

export interface TableBrief {
  id: string;
  name: string;
  position: number;
  row_count: number;
  access: Level;
}

export interface DatahubBrief {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  owner_name: string | null;
  access: Level;
  version: number;
  created_at: string;
  updated_at: string;
  tables: TableBrief[];
}

export interface SelectOption {
  id: string;
  name: string;
  color?: string;
}

export interface Column {
  id: string;
  key: string;
  name: string;
  type: string;
  config: Record<string, unknown> & { options?: SelectOption[]; result_type?: string; precision?: number; max?: number; multiple?: boolean; target_table_id?: string };
  position: number;
  required: boolean;
  unique: boolean;
  default_value: unknown;
  description: string | null;
  display: { decimals?: number; thousands?: boolean; unit?: string; date_format?: string; color?: string };
  version: number;
  calc: { status: "ready" | "pending" | "running"; done: number | null; total: number | null; at: string | null; seq: number } | null;
}

export interface TableDetail {
  id: string;
  datahub_id: string;
  datahub_name: string;
  name: string;
  description: string | null;
  position: number;
  row_count: number;
  access: Level;
  version: number;
  owner_id: string;
  columns: Column[];
  max_columns: number;
}

export interface Row {
  id: string;
  row_no?: number;
  version?: number;
  created_at?: string;
  created_by?: string | null;
  updated_at?: string;
  updated_by?: string | null;
  data: Record<string, unknown>;
  /** Keys of the computed columns of this row that are waiting to be recalculated. */
  pending?: string[];
}

export interface RowPage {
  data: Row[];
  next_cursor: string | null;
  total?: number;
}

export interface HistoryItem {
  version: number;
  op: string;
  at: string;
  actor: { userId?: string | null; via?: string } | null;
  changes: { field: string; field_name: string | null; old: unknown; new: unknown }[];
}

export interface Limits {
  limits: { datahubs: number; tables: number; columns: number };
  used: { datahubs: number };
  column_ceiling: number;
}

export interface Person {
  id: string;
  full_name: string;
  email: string | null;
}

/** Result of `datahub.row.batch`. */
export interface BatchResult {
  results: { op: string; outcome: string; id: string; row: Row | null; seq: number }[];
  seq: number;
}
