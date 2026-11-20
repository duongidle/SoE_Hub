import { registerPrivateAuditTarget } from "../../core/audit-privacy";
import { registerOwnedTable } from "../../auth/query-guard";
import { registerSettings } from "../system/settings-catalog";
import { columnOperations } from "./columns";
import { viewOperations, shareOperations, limitOperations, trashOperations } from "./collab";
import { datahubEvents } from "./events";
import { formulaOperations } from "./formula-ops";
import { lookupOperations } from "./lookup-ops";
import { DH_SETTINGS } from "./limits";
import { duplicateOperations } from "./duplicates";
import { mergeOperations } from "./merge-ops";
import { rowOperations } from "./row-ops";
import { splitOperations } from "./split-ops";
import { optionRenameOperations } from "./option-rename";
import { structureOperations } from "./structure";
import { templateOperations } from "./template-ops";
import "./transfer";
import "./export-job";
import "./import-job";

// Datahub rows are private data: the Admin's audit log records the action and the field names, never the values
// (design module1 section 10). Every table that holds datahub data must go through the scoped query helpers.
registerPrivateAuditTarget("datahub_row");
for (const t of ["dh_datahubs", "dh_tables", "dh_columns", "dh_rows", "dh_views", "dh_view_overrides", "dh_table_state", "dh_shares", "dh_formula_deps", "dh_personal_rows", "dh_person_cells", "dh_templates", "dh_merges", "dh_merge_rows"]) registerOwnedTable(t);
registerSettings(DH_SETTINGS.maxDatahubs, DH_SETTINGS.maxTables, DH_SETTINGS.maxColumns, DH_SETTINGS.recalcParallel, DH_SETTINGS.consistentWaitMs, DH_SETTINGS.fiscalStartMonth, DH_SETTINGS.templatesPerScope);

export { datahubEvents };
export const datahubOperations = [...structureOperations, ...columnOperations, ...rowOperations, ...duplicateOperations, ...viewOperations, ...shareOperations, ...limitOperations, ...trashOperations, ...formulaOperations, ...lookupOperations, ...mergeOperations, ...splitOperations, ...optionRenameOperations, ...templateOperations];
export { exportOperations } from "./export-job";
export { importOperations } from "./import-job";
export { jobOperations, processJobs, resetRunningJobs, startJobLoop, purgeJobFiles } from "./jobs";
export { datahubJobs as exportJobs, sqlViewSubscriber } from "./export-views";
export { reconcileColumns } from "./reconcile";
export { formulaSubscriber, markVolatilePending, processPendingColumns, resetRunningColumns, startRecalcLoop } from "./recalc";
import { datahubJobs as exportJobs } from "./export-views";
import { markVolatilePending } from "./recalc";
import { reconcileColumns } from "./reconcile";
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
  {
    name: "datahub-reconcile",
    cron: "45 3 * * *",
    tz: "Asia/Ho_Chi_Minh",
    description: "Mỗi đêm tính lại cả cột cho một phần các cột công thức (luân phiên, tối đa 1.000.000 dòng) và so với giá trị đang lưu. Lệch thì ghi giá trị đúng, ghi log và báo Admin.",
    async run({ db, logger }) {
      const r = await reconcileColumns(db, { log: logger });
      logger.info({ job: "datahub-reconcile", columns: r.columns, rows: r.rows, mismatched_columns: r.mismatches.length }, "reconciliation done");
    },
  },
];
export { templateSubscriber } from "./template-ops";
export { syncTemplate, syncAllTemplates } from "./template-sync";
export { mergeSubscriber, processPendingMerges, startMergeLoop, requestRescope } from "./merge-sync";
