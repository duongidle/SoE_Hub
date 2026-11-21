/** Shapes the Datahub API returns (see docs/api/openapi.json). Only what the screens read. */

export type Level = "owner" | "edit_data" | "view";

export interface TableBrief {
  id: string;
  name: string;
  position: number;
  row_count: number;
  access: Level;
  /** `merged` = merged table: read-only, rows copied by the worker from source tables (design module3 section 4). */
  kind?: "normal" | "merged";
  /** Members who are not the owner may import or paste new rows (the owner always may). Missing = yes. */
  members_bulk_create?: boolean;
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
  /** Members with the Sửa permission may type into this column (the owner always may). Missing = yes. */
  allow_edit?: boolean;
  /** Template layer (Module 4 mục 3.1): null = column of an ordinary table; `custom` = yours alone. */
  layer?: "basic" | "role" | "team" | "custom" | null;
  layer_ref?: string | null;
  layer_roles?: string[] | null;
  storage?: "shared" | "person";
  role?: string | null;
  /** A column of a template table: not renamed, retyped or deleted from the table, only on the Template page. */
  protected?: boolean;
  /** Filled by the system from the people of a Người dùng column of the same row; nobody types into it. */
  autofill?: { column: string; attr: string; sum?: "team" | "tree" } | null;
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
  kind?: "normal" | "merged";
  owner_id: string;
  columns: Column[];
  max_columns: number;
  key_split?: { enabled: boolean; key_columns: { key: string; name: string }[]; primary: string | null };
  members_bulk_create?: boolean;
  /** Template table (Quản lý Deal): `protected` columns, anyone who sees it adds a column of their own. */
  protected?: boolean;
  template_id?: string | null;
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
  /** Only under the split lock for a non-owner: may this person edit this row (a Leader sees a team member's deal but edits it only when allowed). */
  can_edit?: boolean;
  /** Keys of the computed columns of this row that are waiting to be recalculated. */
  pending?: string[];
  /** Indexes of the colour rules of the view this row satisfies (decided by the server). */
  marks?: number[];
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
  /** Only when the lookup names a table: false = not the owner or a member of it ("không còn quyền"). */
  member?: boolean;
}

/** Result of `datahub.row.batch`. */
export interface BatchResult {
  results: { op: string; outcome: string; id: string; row: Row | null; seq: number }[];
  seq: number;
}

/** `datahub.row.groups`: groups in display order with their row counts and totals. */
export interface GroupResult {
  groups: { depth: number; path: (string | number | boolean | null)[]; count: number; aggs: Record<string, number | string | null> }[];
  truncated: boolean;
}

/** `datahub.time_filter.resolve`: a range as dates, and where today falls. */
export interface TimeRangeInfo {
  from: string | null;
  to: string | null;
  today: string;
  fiscal_start_month: number;
  year: number;
  month: number;
  fiscal_year: number;
  fiscal_quarter: number;
}
