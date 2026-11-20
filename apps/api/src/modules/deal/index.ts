import { registerSettings } from "../system/settings-catalog";
import { DEAL_SETTINGS } from "./tree-templates";

registerSettings(DEAL_SETTINGS.defaultTemplates);

export { addIndexMonths } from "./index-months";
export { BUILTIN_DEFAULT_SET } from "./default-templates";
export { DEAL_SETTINGS, dealDefaultsSubscriber, ensureAllTrees, ensureTreeTemplates } from "./tree-templates";
