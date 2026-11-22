import { registerSettings } from "../system/settings-catalog";
import { DEAL_SETTINGS } from "./tree-templates";

registerSettings(DEAL_SETTINGS.defaultTemplates);

export { addIndexMonths } from "./index-months";
export { BUILTIN_DEFAULT_SET } from "./default-templates";
export { DEAL_SETTINGS, startDealDefaultsLoop, ensureAllTrees, ensureMissingTables, ensureTreeTemplates } from "./tree-templates";
export { paymentOperations } from "./payments";
export { periodOperations } from "./period";
export { forecastOperations, snapshotAllTrees, snapshotTree, quarterOf } from "./forecast";
export { cycleOperations } from "./cycle";
export { dealDashboardOperations } from "./dashboard-ref";
export { policyDiffOperations } from "./policy-diff";
export { ensureDealDashboard, ensureDealDashboardForTree, DEAL_DASHBOARD_NAME, DEAL_DASHBOARD_CHARTS, DEAL_DASHBOARD_METRICS } from "./default-dashboard";
