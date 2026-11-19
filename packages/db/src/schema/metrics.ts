import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { standardColumns } from "./columns";
import { dhDatahubs } from "./datahub";

/**
 * Metric layer (design module3 sections 1, 3, 5, 8). Everything belongs to a datahub and so to its owner; the names are unique
 * per datahub and unique among live rows (soft delete). `config` holds the JSON the person or the AI wrote; the api checks its
 * shape. `table_ids` lists the tables the definition reads, so a person who was given only some tables sees only what they may use.
 */
const norm = (col: string) => sql.raw(`lower(btrim(${col}))`);

/** A saved data source: one table, or a table joined with others of the same datahub (design module3 section 3). */
export const mtSources = pgTable(
  "mt_sources",
  {
    ...standardColumns(),
    datahubId: uuid("datahub_id").notNull().references(() => dhDatahubs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameNorm: text("name_norm").generatedAlwaysAs(norm("name")),
    config: jsonb("config").notNull(),
    tableIds: uuid("table_ids").array().notNull().default(sql`'{}'::uuid[]`),
  },
  (t) => [
    uniqueIndex("mt_sources_name_uq").on(t.datahubId, t.nameNorm).where(sql`${t.deletedAt} IS NULL`),
    index("mt_sources_datahub_idx").on(t.datahubId),
    check("mt_sources_name_chk", sql`char_length(btrim(${t.name})) BETWEEN 1 AND 100 AND ${t.name} !~ '[\\[\\]]'`),
  ],
);

/** A saved metric: how to compute one number (or one number per group) from a source (design module3 section 5). */
export const mtMetrics = pgTable(
  "mt_metrics",
  {
    ...standardColumns(),
    datahubId: uuid("datahub_id").notNull().references(() => dhDatahubs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameNorm: text("name_norm").generatedAlwaysAs(norm("name")),
    config: jsonb("config").notNull(),
    tableIds: uuid("table_ids").array().notNull().default(sql`'{}'::uuid[]`),
  },
  (t) => [
    uniqueIndex("mt_metrics_name_uq").on(t.datahubId, t.nameNorm).where(sql`${t.deletedAt} IS NULL`),
    index("mt_metrics_datahub_idx").on(t.datahubId),
    check("mt_metrics_name_chk", sql`char_length(btrim(${t.name})) BETWEEN 1 AND 100 AND ${t.name} !~ '[\\[\\]]'`),
  ],
);

/** A dashboard of a datahub (layout and common filters in `config`; API and screens come in 3C). */
export const mtDashboards = pgTable(
  "mt_dashboards",
  {
    ...standardColumns(),
    datahubId: uuid("datahub_id").notNull().references(() => dhDatahubs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameNorm: text("name_norm").generatedAlwaysAs(norm("name")),
    position: integer("position").notNull().default(0),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex("mt_dashboards_name_uq").on(t.datahubId, t.nameNorm).where(sql`${t.deletedAt} IS NULL`),
    index("mt_dashboards_datahub_idx").on(t.datahubId),
    check("mt_dashboards_name_chk", sql`char_length(btrim(${t.name})) BETWEEN 1 AND 100`),
  ],
);

/** A chart on a dashboard: its type, how it reads a metric or a source, and how it is drawn (3C). */
export const mtCharts = pgTable(
  "mt_charts",
  {
    ...standardColumns(),
    dashboardId: uuid("dashboard_id").notNull().references(() => mtDashboards.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("mt_charts_dashboard_idx").on(t.dashboardId)],
);

/**
 * A dashboard shared with one person (3C-2, design module3 section 9): the person sees the numbers, which are computed with the
 * owner's rights. Only the owner of the datahub adds or removes shares.
 */
export const mtDashboardShares = pgTable(
  "mt_dashboard_shares",
  {
    id: uuid("id").primaryKey(),
    dashboardId: uuid("dashboard_id").notNull().references(() => mtDashboards.id, { onDelete: "cascade" }),
    granteeId: uuid("grantee_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
  },
  (t) => [uniqueIndex("mt_dashboard_shares_uq").on(t.dashboardId, t.granteeId), index("mt_dashboard_shares_grantee_idx").on(t.granteeId)],
);

/** The common filters a viewer set on a dashboard (their own copy; the dashboard keeps its default in `config.filters`). */
export const mtDashboardPrefs = pgTable(
  "mt_dashboard_prefs",
  {
    dashboardId: uuid("dashboard_id").notNull().references(() => mtDashboards.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.dashboardId, t.userId] })],
);
