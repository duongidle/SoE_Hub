import { registerSettings } from "../system/settings-catalog";
import type { Config } from "../../config";
import type { StorageDriver } from "../../storage/types";
import { fillOperations } from "./fill";
import { formManageOperations } from "./ops";
import { gradeOperations } from "./grade";
import { formIoOperations } from "./io";
import "./transfer";

export { fillToken, resetSpamState, SPAM } from "./fill";
export { checkPublish, columnNameFor } from "./ops";

/** Module 7 (Stage 7A1): forms, versions, fill drafts, submissions, the public endpoints. */
export function formOperations(cfg: Config, storage: StorageDriver) {
  return [...formManageOperations, ...fillOperations(cfg, storage), ...gradeOperations, ...formIoOperations];
}
void registerSettings;
