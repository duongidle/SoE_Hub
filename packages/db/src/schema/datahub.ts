import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, index, integer, jsonb, pgSequence, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { newId, standardColumns } from "./columns";
import { users } from "./users";

/**
 * Datahub storage (design module2 section 3). Rows of every table share `dh_rows`; values live in `data` (JSONB)
 * under the stable column key. Names are normalised by the database itself (`name_norm`: trimmed, lower-cased), so
 * the unique indexes hold on every write path.
 */
const norm = (col: string) => sql.raw(`lower(btrim(${col}))`);

export const dhDatahubs = pgTable(
  "dh_datahubs",
  {
    ...standardColumns(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    nameNorm: text("name_norm").generatedAlwaysAs(norm("name")),
    description: text("description"),
  },
  (t) => [
    uniqueIndex("dh_datahubs_owner_name_uq").on(t.ownerId, t.nameNorm).where(sql`${t.deletedAt} IS NULL`),
    index("dh_datahubs_owner_idx").on(t.ownerId),
    check("dh_datahubs_name_chk", sql`char_length(btrim(${t.name})) BETWEEN 1 AND 100 AND ${t.name} !~ '[\\[\\]]'`),
  ],
);

export const dhTables = pgTable(
  "dh_tables",
  {
    ...standardColumns(),
    datahubId: uuid("datahub_id")
      .notNull()
      .references(() => dhDatahubs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameNorm: text("name_norm").generatedAlwaysAs(norm("name")),
    description: text("description"),
    position: integer("position").notNull().default(0),
    /** Next `row_no` to hand out. Updated in the same statement as `row_count`, which serialises inserts per table. */
    nextRowNo: integer("next_row_no").notNull().default(1),
    /** Number of live (not trashed) rows. Drives the auto-index threshold and cheap totals. */
    rowCount: integer("row_count").notNull().default(0),
    /** Name of the export view in schema `dh_views` (design section 3). Set by `soe_dh_regenerate_view`. */
    sqlView: text("sql_view"),
  },
  (t) => [
    uniqueIndex("dh_tables_name_uq").on(t.datahubId, t.nameNorm).where(sql`${t.deletedAt} IS NULL`),
    index("dh_tables_datahub_idx").on(t.datahubId),
    check("dh_tables_name_chk", sql`char_length(btrim(${t.name})) BETWEEN 1 AND 100 AND ${t.name} !~ '[\\[\\]]'`),
  ],
);

export const dhColumns = pgTable(
  "dh_columns",
  {
    ...standardColumns(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => dhTables.id, { onDelete: "cascade" }),
    /** Stable key used inside `dh_rows.data`. Never changes, so renaming a column touches no data. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    nameNorm: text("name_norm").generatedAlwaysAs(norm("name")),
    type: text("type").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    position: integer("position").notNull().default(0),
    required: boolean("required").notNull().default(false),
    isUnique: boolean("is_unique").notNull().default(false),
    defaultValue: jsonb("default_value"),
    description: text("description"),
    /** Display format: decimals, thousands separator, unit... (shape depends on the type). */
    display: jsonb("display").notNull().default(sql`'{}'::jsonb`),
    /**
     * Recalculation state of a computed column (formula, lookup, rollup): `ready`, `pending` (waiting for the worker) or
     * `running`. Other column types stay `ready`. `calc_done` / `calc_total` drive the progress bar.
     */
    calcStatus: text("calc_status").notNull().default("ready"),
    calcTotal: integer("calc_total"),
    calcDone: integer("calc_done"),
    /** When the stored values were last computed (catch-up of TODAY()/NOW() columns compares against it). */
    calcAt: timestamp("calc_at", { withTimezone: true, mode: "date" }),
    calcRequestedAt: timestamp("calc_requested_at", { withTimezone: true, mode: "date" }),
    /** `today` | `now` when the formula uses TODAY() / NOW(); null otherwise. */
    calcVolatile: text("calc_volatile"),
    /** Highest change sequence (`dh_change_seq`) this column has fully incorporated (design module2 section 6.7). */
    calcSeq: bigint("calc_seq", { mode: "number" }).notNull().default(0),
    /** When the nightly reconciliation last recomputed this column and compared it with the stored values (design module2 section 6.7). */
    reconciledAt: timestamp("reconciled_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("dh_columns_key_uq").on(t.tableId, t.key),
    uniqueIndex("dh_columns_name_uq").on(t.tableId, t.nameNorm).where(sql`${t.deletedAt} IS NULL`),
    index("dh_columns_table_idx").on(t.tableId),
    check("dh_columns_name_chk", sql`char_length(btrim(${t.name})) BETWEEN 1 AND 100 AND ${t.name} !~ '[\\[\\]]'`),
    check("dh_columns_key_chk", sql`${t.key} ~ '^[a-z][a-z0-9_]{0,40}$'`),
    check("dh_columns_calc_status_chk", sql`${t.calcStatus} IN ('ready', 'pending', 'running')`),
    index("dh_columns_calc_idx").on(t.calcStatus).where(sql`${t.calcStatus} <> 'ready'`),
  ],
);

/**
 * What a computed column reads (design module2 section 6.5): drives the cycle check at save and the recalculation
 * of dependants. `cell` = another column of the same row; `range` = a whole column of a table (this one or another).
 */
export const dhFormulaDeps = pgTable(
  "dh_formula_deps",
  {
    columnId: uuid("column_id")
      .notNull()
      .references(() => dhColumns.id, { onDelete: "cascade" }),
    /** Table of the computed column. */
    tableId: uuid("table_id")
      .notNull()
      .references(() => dhTables.id, { onDelete: "cascade" }),
    /** Table the data is read from (equals `table_id` for `cell`). No foreign key: a deleted source gives `#REF!`, not a cascade. */
    srcTableId: uuid("src_table_id").notNull(),
    srcKey: text("src_key").notNull(),
    /** `cell` | `range` */
    kind: text("kind").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.columnId, t.srcTableId, t.srcKey, t.kind] }),
    index("dh_formula_deps_src_idx").on(t.srcTableId, t.srcKey),
    index("dh_formula_deps_table_idx").on(t.tableId),
    check("dh_formula_deps_kind_chk", sql`${t.kind} IN ('cell', 'range')`),
  ],
);

export const dhRows = pgTable(
  "dh_rows",
  {
    ...standardColumns(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => dhTables.id, { onDelete: "cascade" }),
    /** Readable number inside the table (`#1024`). Never reused. */
    rowNo: integer("row_no").notNull(),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    /** Text of all text-like cells, for table-wide search (trigram index on `soe_unaccent(lower(search))`). */
    search: text("search").notNull().default(""),
  },
  (t) => [
    uniqueIndex("dh_rows_table_row_no_uq").on(t.tableId, t.rowNo),
    index("dh_rows_deleted_idx").on(t.tableId, t.deletedAt).where(sql`${t.deletedAt} IS NOT NULL`),
  ],
);

/** A view of a table: shared (`owner_id` null, edited by the table owner) or personal (`owner_id` = its author). */
export const dhViews = pgTable(
  "dh_views",
  {
    ...standardColumns(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => dhTables.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").references(() => users.id),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("grid"),
    position: integer("position").notNull().default(0),
    /** Filter, sort, group, hidden columns, widths, frozen columns, row height, colours. Shape checked by the API. */
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("dh_views_table_idx").on(t.tableId)],
);

/** A user's own tweak of a shared view (design section 5.2). Overrides the shared config for that user only. */
export const dhViewOverrides = pgTable(
  "dh_view_overrides",
  {
    viewId: uuid("view_id")
      .notNull()
      .references(() => dhViews.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    config: jsonb("config").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.viewId, t.userId] })],
);

/** The view each person opened last on a table. */
export const dhTableState = pgTable(
  "dh_table_state",
  {
    tableId: uuid("table_id")
      .notNull()
      .references(() => dhTables.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    lastViewId: uuid("last_view_id").references(() => dhViews.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tableId, t.userId] })],
);

/** Sharing (design section 10). `table_id` null = the whole datahub, including tables created later. */
export const dhShares = pgTable(
  "dh_shares",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    datahubId: uuid("datahub_id")
      .notNull()
      .references(() => dhDatahubs.id, { onDelete: "cascade" }),
    tableId: uuid("table_id").references(() => dhTables.id, { onDelete: "cascade" }),
    granteeId: uuid("grantee_id")
      .notNull()
      .references(() => users.id),
    /** `view` | `edit_data` */
    permission: text("permission").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dh_shares_datahub_uq").on(t.datahubId, t.granteeId).where(sql`${t.tableId} IS NULL`),
    uniqueIndex("dh_shares_table_uq").on(t.tableId, t.granteeId).where(sql`${t.tableId} IS NOT NULL`),
    index("dh_shares_grantee_idx").on(t.granteeId),
    check("dh_shares_permission_chk", sql`${t.permission} IN ('view', 'edit_data')`),
  ],
);

/** Per-user overrides of the Datahub limits (design section 11). Null = use the system default. */
export const dhUserLimits = pgTable("dh_user_limits", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  maxDatahubs: integer("max_datahubs"),
  maxTables: integer("max_tables"),
  maxColumns: integer("max_columns"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Requests for an automatic expression index (Module 0 section 6.2). The api records a request when a filter or sort
 * uses a column of a table above the row threshold; the worker job builds the index. One row per (table, column, kind).
 */
export const dhIndexRequests = pgTable(
  "dh_index_requests",
  {
    tableId: uuid("table_id")
      .notNull()
      .references(() => dhTables.id, { onDelete: "cascade" }),
    columnKey: text("column_key").notNull(),
    /** `num` | `text` | `date` | `ts` | `bool` | `uuid` | `trgm` */
    kind: text("kind").notNull(),
    /** `pending` | `done` | `skipped` | `failed` */
    status: text("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    doneAt: timestamp("done_at", { withTimezone: true, mode: "date" }),
    note: text("note"),
    rowsAtRequest: bigint("rows_at_request", { mode: "number" }),
  },
  (t) => [primaryKey({ columns: [t.tableId, t.columnKey, t.kind] })],
);

/** Global, monotonic number of source data writes (design module2 section 6.7). Returned by every write; readers wait for it. */
export const dhChangeSeq = pgSequence("dh_change_seq", { startWith: 1, increment: 1 });

/**
 * The shared change queue (design module2 section 6.7): one table for the whole system. Every write of source data
 * adds what it may have changed for each computed column that depends on it; the worker takes a column's whole burst
 * at once, recomputes only the affected rows, then deletes what it took. `mode`:
 * - `rows`: `row_ids` are rows of the column's own table to recompute;
 * - `linked`: `row_ids` are rows of the linked (target) table of a lookup/rollup; the own rows that link to them are found
 *   with the GIN index of the relation column (`?|`);
 * - `keys`: `keys` = `{cols: [own column keys], tuples: [[raw key values]...]}`, the group keys (old and new) of changed
 *   source rows; own rows whose key columns equal a tuple are recomputed;
 * - `full`: recompute the whole column.
 */
export const dhChangeQueue = pgTable(
  "dh_change_queue",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    columnId: uuid("column_id")
      .notNull()
      .references(() => dhColumns.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    mode: text("mode").notNull(),
    rowIds: uuid("row_ids").array(),
    keys: jsonb("keys"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("dh_change_queue_col_idx").on(t.columnId, t.id), index("dh_change_queue_seq_idx").on(t.seq), check("dh_change_queue_mode_chk", sql`${t.mode} IN ('rows', 'linked', 'keys', 'full')`)],
);
