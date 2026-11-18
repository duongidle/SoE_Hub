import { registerPrivateAuditTarget } from "../../core/audit-privacy";
import { registerOwnedTable } from "../../auth/query-guard";
import { registerSettings } from "../system/settings-catalog";
import { columnOperations } from "./columns";
import { viewOperations, shareOperations, limitOperations, trashOperations } from "./collab";
import { datahubEvents } from "./events";
import { formulaOperations } from "./formula-ops";
import { DH_SETTINGS } from "./limits";
import { rowOperations } from "./row-ops";
import { structureOperations } from "./structure";
import "./transfer";

// Datahub rows are private data: the Admin's audit log records the action and the field names, never the values
// (design module1 section 10). Every table that holds datahub data must go through the scoped query helpers.
registerPrivateAuditTarget("datahub_row");
for (const t of ["dh_datahubs", "dh_tables", "dh_columns", "dh_rows", "dh_views", "dh_view_overrides", "dh_table_state", "dh_shares", "dh_formula_deps"]) registerOwnedTable(t);
registerSettings(DH_SETTINGS.maxDatahubs, DH_SETTINGS.maxTables, DH_SETTINGS.maxColumns, DH_SETTINGS.recalcParallel, DH_SETTINGS.consistentWaitMs);

export { datahubEvents };
export const datahubOperations = [...structureOperations, ...columnOperations, ...rowOperations, ...viewOperations, ...shareOperations, ...limitOperations, ...trashOperations, ...formulaOperations];
export { datahubJobs as exportJobs, sqlViewSubscriber } from "./export-views";
export { formulaSubscriber, markVolatilePending, processPendingColumns, resetRunningColumns, startRecalcLoop } from "./recalc";
import { datahubJobs as exportJobs } from "./export-views";
import { markVolatilePending } from "./recalc";
import type { JobDef } from "../../jobs";

/** Scheduled work of the Datahub: automatic indexes, SQL views, and the TODAY() / NOW() columns (design module2 section 6.5). */
export const datahubJobs: JobDef[] = [
  ...exportJobs,
  {
    name: "datahub-formula-today",
    cron: "5 0 * * *",
    tz: "Asia/Ho_Chi_Minh",
    description: "00:05 mỗi ngày (giờ Việt Nam) tính lại các cột công thức dùng TODAY() và mọi cột phụ thuộc.",
    async run({ db, logger }) {
      const n = await markVolatilePending(db);
      logger.info({ job: "datahub-formula-today", columns: n }, "TODAY() columns queued");
    },
  },
  {
    name: "datahub-formula-now",
    cron: "0 * * * *",
    description: "Mỗi giờ tính lại các cột công thức dùng NOW().",
    async run({ db, logger }) {
      const n = await markVolatilePending(db);
      logger.info({ job: "datahub-formula-now", columns: n }, "NOW() columns queued");
    },
  },
];
