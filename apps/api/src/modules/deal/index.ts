import { registerSettings } from "../system/settings-catalog";
import { DEAL_SETTINGS } from "./tree-templates";

registerSettings(DEAL_SETTINGS.defaultTemplates);

export { addIndexMonths } from "./index-months";
export { BUILTIN_DEFAULT_SET } from "./default-templates";
export { DEAL_SETTINGS, startDealDefaultsLoop, ensureAllTrees, ensureMissingTables, ensureTreeTemplates } from "./tree-templates";
export { paymentOperations } from "./payments";
export { periodOperations } from "./period";
export { forecastOperations, snapshotAllTrees, snapshotTree, quarterOf } from "./forecast";
