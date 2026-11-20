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
    /** `deal` = the protected datahub "Quản lý Deal" of a person (module4 1.1, Stage 4.1c): not renamed, not deleted, not counted in the limit. Null = ordinary. */
    systemKey: text("system_key"),
  },
  (t) => [
    uniqueIndex("dh_datahubs_system_uq").on(t.ownerId, t.systemKey).where(sql`${t.systemKey} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    uniqueIndex("dh_datahubs_owner_name_uq").on(t.ownerId, t.nameNorm).where(sql`${t.deletedAt} IS NULL`),
    index("dh_datahubs_owner_idx").on(t.ownerId),
    check("dh_datahubs_name_chk", sql`char_length(btrim(${t.name})) BETWEEN 1 AND 100 AND ${t.name} !~ '[\\[\\]]'`),
  ],
);

/**
 * A template table (design module4 3.5, Stage 4.1c): a table a Manager (whole tree) or a Leader (one team) defines once and the system keeps in the
 * datahub "Quản lý Deal" of everyone in scope. `shared` = ONE physical table (rows in `dh_rows`, the creator owns it, the people in scope are
 * members through automatic shares; split lock decides who sees which row). `personal` = one physical copy per person, same structure, private data
 * (Index). `master_table_id` is the table that holds the definition: the shared table itself, or the creator's own copy for a personal template.
 */
export const dhTemplates = pgTable(
  "dh_templates",
  {
    ...standardColumns(),
    kind: text("kind").notNull(),
    scope: text("scope").notNull(),
    /** The tree (a Manager). For a team template also the Manager of that team's Leader at creation. */
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id),
    /** Team template: the Leader. The template belongs to the TEAM: a new Leader inherits it (design module4 3.5). */
    leaderId: uuid("leader_id").references(() => users.id),
    name: text("name").notNull(),
    nameNorm: text("name_norm").generatedAlwaysAs(norm("name")),
    masterTableId: uuid("master_table_id"),
    /** Permission the members get on a shared template table: `view` | `edit_data`. */
    memberPermission: text("member_permission").notNull().default("view"),
    /** "Leader được thêm cột team" (design module4 3.8). */
    leaderCanAddColumns: boolean("leader_can_add_columns").notNull().default(false),
    /** Which set of column roles the table uses (module4 3.7): `deals` ... Null = no roles. */
    roleSet: text("role_set"),
  },
  (t) => [
    uniqueIndex("dh_templates_name_uq").on(t.managerId, t.nameNorm).where(sql`${t.deletedAt} IS NULL`),
    index("dh_templates_leader_idx").on(t.leaderId),
    check("dh_templates_kind_chk", sql`${t.kind} IN ('shared', 'personal')`),
    check("dh_templates_scope_chk", sql`(${t.scope} = 'tree' AND ${t.leaderId} IS NULL) OR (${t.scope} = 'team' AND ${t.leaderId} IS NOT NULL)`),
    check("dh_templates_perm_chk", sql`${t.memberPermission} IN ('view', 'edit_data')`),
    check("dh_templates_name_chk", sql`char_length(btrim(${t.name})) BETWEEN 1 AND 100 AND ${t.name} !~ '[\\[\\]]'`),
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
    /** `normal` | `merged` (design module3 section 4): a merged table is read-only, its rows are copied from source tables by the worker. */
    kind: text("kind").notNull().default("normal"),
    /**
     * Split lock (design module2 section 10, Stage 4.1a): when `key_split` is on, a member who is not the owner sees only the rows whose
     * key columns (`key_columns`: keys of 1-5 columns of type user) hold their own id or the id of a person they manage.
     * `key_primary` (one of `key_columns`) is filled with the adder's id on a row a member adds. The configuration is kept when the lock is off.
     */
    keySplit: boolean("key_split").notNull().default(false),
    keyColumns: text("key_columns")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    keyPrimary: text("key_primary"),
    /** May members who are not the owner create more than one row in one go (import, paste, batch)? Default on; template tables turn it off (module4 3.5). */
    membersBulkCreate: boolean("members_bulk_create").notNull().default(true),
    /** Protected (template) table: no rename, no delete from the table commands; only the template commands change it (design module4 1.3, Stage 4.1c). */
    protected: boolean("protected").notNull().default(false),
    /** The template this table was made from (the shared table, or one person's copy of a personal template). */
    templateId: uuid("template_id").references(() => dhTemplates.id),
    /** Personal template: the person this copy belongs to. */
    templateUserId: uuid("template_user_id").references(() => users.id),
    /** Hidden and kept (the person left the template's scope): soft-deleted too, but never purged and restored only by the template sync. */
    archived: boolean("archived").notNull().default(false),
    /** Same as `dh_templates.role_set` (column roles of this table). */
    roleSet: text("role_set"),
  },
  (t) => [
    index("dh_tables_template_idx").on(t.templateId),
    check("dh_tables_key_cols_chk", sql`cardinality(${t.keyColumns}) <= 5`),
    check("dh_tables_kind_chk", sql`${t.kind} IN ('normal', 'merged')`),
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
    /** May a member (not the owner) with the Edit permission write this column's cells? Default on; template tables start off (design module2 section 10). */
    allowEdit: boolean("allow_edit").notNull().default(true),
    /** Computed column whose value depends on who reads it (it reads a split-lock table, or another such column): design module2 section 10. Kept by `reader-scope.ts`. */
    readerScoped: boolean("reader_scoped").notNull().default(false),
    /**
     * Template layer (design module4 3.1, Stage 4.1c): null = an ordinary table's column; `basic` | `role` | `team` | `custom`. `layer_ref`: for `team` the Leader
     * whose team sees the column, for `custom` the person who made it (nobody else sees it). `layer_roles`: for `role` the roles that see it.
     */
    layer: text("layer"),
    layerRef: uuid("layer_ref").references(() => users.id),
    layerRoles: text("layer_roles").array(),
    /** `shared` = one value per row in `dh_rows.data`; `person` = one value per person, kept in `dh_person_cells` (design module4 3.4). */
    storage: text("storage").notNull().default("shared"),
    /** Column role (design module4 3.7): unique per table. */
    role: text("role"),
    /**
     * "Gửi xuống" (design module4 4.5): a column of storage `person` that the system fills from the attributes of the people named in a user column of the
     * same row: `{ column, attr, sum? }`. Nobody types into it. See `apps/api/src/modules/datahub/pushdown.ts`.
     */
    autofill: jsonb("autofill"),
    /** A copy of a personal template: the column of the master table this one follows (same name, type, formula by names). */
    templateColumnId: uuid("template_column_id"),
    /** Protected (template) column: no rename, delete, type change or edit from the column commands. */
    protected: boolean("protected").notNull().default(false),
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
    uniqueIndex("dh_columns_name_uq").on(t.tableId, t.nameNorm).where(sql`${t.deletedAt} IS NULL AND ${t.layer} IS DISTINCT FROM 'custom'`),
    uniqueIndex("dh_columns_custom_name_uq").on(t.tableId, t.layerRef, t.nameNorm).where(sql`${t.deletedAt} IS NULL AND ${t.layer} = 'custom'`),
    uniqueIndex("dh_columns_role_uq").on(t.tableId, t.role).where(sql`${t.deletedAt} IS NULL AND ${t.role} IS NOT NULL`),
    check("dh_columns_layer_chk", sql`${t.layer} IS NULL OR ${t.layer} IN ('basic', 'role', 'team', 'custom')`),
    check("dh_columns_storage_chk", sql`${t.storage} IN ('shared', 'person')`),
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
    /** Made by the template sync (module4 3.5, Stage 4.1c): follows the organization tree, removed when the person leaves the scope. */
    auto: boolean("auto").notNull().default(false),
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

/**
 * Per-person datahub preferences. `leader_can_edit`: "Cho phép leader sửa deal của tôi" (module1 section 4.1): the person's Leader may
 * edit the rows that carry this person's name in a split-lock table, with the columns the person may edit. Default off. The Deals screen
 * of Stage 4 shows the switch; the command `datahub.prefs.set` already stores it.
 */
export const dhUserPrefs = pgTable("dh_user_prefs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  leaderCanEdit: boolean("leader_can_edit").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * The values of the reader-scoped computed columns of a row, one set per member who is not the owner (design module2 section 10:
 * "mỗi thành viên một giá trị"). `data` has the same shape as `dh_rows.data` (value under the column key, error under `!key`) but only
 * holds reader-scoped columns. The owner's values stay in `dh_rows.data`.
 */
export const dhPersonalRows = pgTable(
  "dh_personal_rows",
  {
    rowId: uuid("row_id")
      .notNull()
      .references(() => dhRows.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tableId: uuid("table_id")
      .notNull()
      .references(() => dhTables.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [primaryKey({ columns: [t.rowId, t.userId] }), index("dh_personal_rows_user_idx").on(t.tableId, t.userId)],
);

/**
 * The values of the person-stored columns (`dh_columns.storage = 'person'`: custom columns, "mỗi người một giá trị" template columns), one set per
 * person per row. Same shape as `dh_rows.data` but only holds those columns' keys. Never in `dh_rows.data`, so no row read, history, export or event of
 * someone else can carry them; read through `TableAccess.rel()`, which lays the reader's own values over `data`. Kept when a person leaves a table.
 */
export const dhPersonCells = pgTable(
  "dh_person_cells",
  {
    rowId: uuid("row_id")
      .notNull()
      .references(() => dhRows.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tableId: uuid("table_id")
      .notNull()
      .references(() => dhTables.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [primaryKey({ columns: [t.rowId, t.userId] }), index("dh_person_cells_user_idx").on(t.tableId, t.userId)],
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

/**
 * Background jobs of the Datahub the user waits for (design module2 sections 8, 9): imports and exports. The api creates the row,
 * the worker takes `pending` rows one at a time (`FOR UPDATE SKIP LOCKED`), reports progress here and leaves the result.
 * Status: `draft` (import analysed, waiting for the mapping) | `pending` | `running` | `done` | `failed` | `cancelled`.
 * `owner_id` is the person who asked; the job runs with that person's rights (the worker calls the same registry operations).
 */
export const dhJobs = pgTable(
  "dh_jobs",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    datahubId: uuid("datahub_id"),
    tableId: uuid("table_id"),
    params: jsonb("params").notNull().default(sql`'{}'::jsonb`),
    phase: text("phase"),
    progressDone: bigint("progress_done", { mode: "number" }).notNull().default(0),
    progressTotal: bigint("progress_total", { mode: "number" }).notNull().default(0),
    report: jsonb("report"),
    error: text("error"),
    sourceKey: text("source_key"),
    sourceName: text("source_name"),
    sourceKind: text("source_kind"),
    resultKey: text("result_key"),
    resultName: text("result_name"),
    resultType: text("result_type"),
    resultSize: bigint("result_size", { mode: "number" }),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("dh_jobs_owner_idx").on(t.ownerId, t.createdAt),
    index("dh_jobs_pending_idx").on(t.status, t.createdAt),
    check("dh_jobs_kind_chk", sql`${t.kind} IN ('import', 'export')`),
    check("dh_jobs_status_chk", sql`${t.status} IN ('draft', 'pending', 'running', 'done', 'failed', 'cancelled')`),
  ],
);

/**
 * Configuration and state of a merged table (design module3 section 4). `config`: sources in priority order, column mapping, key and
 * strategy (shape checked by the api). `source_ids` repeats the source tables for the index the worker uses to find the merged tables a
 * change affects. `request_seq` rises on every request to sync; `synced_seq` is the request the last finished sync started from, so a
 * request that arrives during a sync is never lost. `status`: `pending` (never synced) | `ok` | `error` (a source is lost: the data of the
 * last good sync is kept).
 */
export const dhMerges = pgTable(
  "dh_merges",
  {
    tableId: uuid("table_id")
      .primaryKey()
      .references(() => dhTables.id, { onDelete: "cascade" }),
    config: jsonb("config").notNull(),
    sourceIds: uuid("source_ids").array().notNull().default(sql`'{}'::uuid[]`),
    status: text("status").notNull().default("pending"),
    error: jsonb("error"),
    diagnostics: jsonb("diagnostics"),
    requestSeq: bigint("request_seq", { mode: "number" }).notNull().default(1),
    syncedSeq: bigint("synced_seq", { mode: "number" }).notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("dh_merges_sources_idx").using("gin", t.sourceIds),
    index("dh_merges_pending_idx").on(t.requestSeq).where(sql`${t.requestSeq} > ${t.syncedSeq}`),
    check("dh_merges_status_chk", sql`${t.status} IN ('pending', 'ok', 'error')`),
  ],
);

/** Which source row a merged row came from (the "Mã dòng gốc" and "Nguồn" cells hold text; this keeps the ids for the link back). `ident` identifies the merged row across syncs. */
export const dhMergeRows = pgTable(
  "dh_merge_rows",
  {
    tableId: uuid("table_id")
      .notNull()
      .references(() => dhTables.id, { onDelete: "cascade" }),
    ident: text("ident").notNull(),
    rowId: uuid("row_id").notNull(),
    sourceTableId: uuid("source_table_id").notNull(),
    sourceRowId: uuid("source_row_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tableId, t.ident] }), uniqueIndex("dh_merge_rows_row_uq").on(t.rowId)],
);
