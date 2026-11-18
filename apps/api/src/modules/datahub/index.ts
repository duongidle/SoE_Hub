import { registerPrivateAuditTarget } from "../../core/audit-privacy";
import { registerOwnedTable } from "../../auth/query-guard";
import { registerSettings } from "../system/settings-catalog";
import { columnOperations } from "./columns";
import { viewOperations, shareOperations, limitOperations, trashOperations } from "./collab";
import { datahubEvents } from "./events";
import { DH_SETTINGS } from "./limits";
import { rowOperations } from "./row-ops";
import { structureOperations } from "./structure";
import "./transfer";

// Datahub rows are private data: the Admin's audit log records the action and the field names, never the values
// (design module1 section 10). Every table that holds datahub data must go through the scoped query helpers.
registerPrivateAuditTarget("datahub_row");
for (const t of ["dh_datahubs", "dh_tables", "dh_columns", "dh_rows", "dh_views", "dh_view_overrides", "dh_table_state", "dh_shares"]) registerOwnedTable(t);
registerSettings(DH_SETTINGS.maxDatahubs, DH_SETTINGS.maxTables, DH_SETTINGS.maxColumns);

export { datahubEvents };
export const datahubOperations = [...structureOperations, ...columnOperations, ...rowOperations, ...viewOperations, ...shareOperations, ...limitOperations, ...trashOperations];
export { datahubJobs, sqlViewSubscriber } from "./export-views";
