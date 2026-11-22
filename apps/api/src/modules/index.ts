import { and, isNotNull, lt } from "drizzle-orm";
import { files, registerTrashTable } from "@soe/db";
import { systemScope } from "../auth/access";
import type { Config } from "../config";
import { EventRegistry } from "../core/events";
import { Registry } from "../core/registry";
import type { StorageDriver } from "../storage/types";
import { authEvents } from "./auth/events";
import { metricOperations, metricsEvents } from "./metrics";
import { datahubEvents, datahubOperations, exportOperations, importOperations, jobOperations } from "./datahub";
import { attachmentOperations } from "./datahub/attachment-ops";
// Registers the Admin setting `deal.default_templates` in the API process too (the settings page and `system.setting.set` read the catalog here).
import "./deal";
import { dueRuleOperations, cycleOperations, dealDashboardOperations, policyDiffOperations, forecastOperations, paymentOperations, periodOperations } from "./deal";
import { authOperations } from "./auth/operations";
import { tokenOperations } from "./auth/tokens";
import { formOperations } from "./form";
import { knowledgeOperations } from "./knowledge/ops";
import { publishOperations } from "./publish/ops";
import { guestEvents, guestOperations } from "./guest";
import { announcementOperations, notificationEvents, notificationOperations, reminderOperations } from "./notification";
import { orgOperations } from "./org/operations";
import { registerDatahubTrash } from "./datahub/trash";
import { systemEvents } from "./system/events";
import { fileOperations } from "./system/files";
import { systemOperations } from "./system/system";
import { transferEvents, transferOperations } from "./transfer";

export interface ModuleDeps {
  config: Config;
  storage: StorageDriver;
}

/** Every module registers its commands/queries and events here. */
export function buildRegistry(deps: ModuleDeps): { registry: Registry; events: EventRegistry } {
  const events = new EventRegistry().register(...systemEvents, ...authEvents, ...notificationEvents, ...guestEvents, ...transferEvents, ...datahubEvents, ...metricsEvents);
  const registry = new Registry().register(
    ...systemOperations,
    ...fileOperations(deps.config, deps.storage),
    ...authOperations(deps.config),
    ...tokenOperations(),
    ...orgOperations,
    ...notificationOperations,
    ...reminderOperations,
    ...announcementOperations,
    ...formOperations(deps.config, deps.storage),
    ...publishOperations(deps.config, deps.storage),
    ...knowledgeOperations,
    ...guestOperations,
    ...transferOperations,
    ...datahubOperations,
    ...attachmentOperations(deps.config, deps.storage),
    ...jobOperations(deps.config, deps.storage),
    ...exportOperations,
    ...importOperations(deps.config, deps.storage),
    ...metricOperations,
    ...paymentOperations,
    ...periodOperations,
    ...dueRuleOperations,
    ...forecastOperations,
    ...cycleOperations,
    ...dealDashboardOperations,
    ...policyDiffOperations,
  );
  return { registry, events };
}

/** Tables that have a trash. Used by the purge job. Deals (Stage 4) will register with `neverHardDelete: true`. */
export function registerTrashTables(deps: ModuleDeps): void {
  registerDatahubTrash();
  registerTrashTable({ name: "forms" });
  registerTrashTable({
    name: "files",
    beforePurge: async (ex, cutoff) => {
      const doomed = await ex.select({ key: files.storageKey }).from(files).where(and(systemScope(), isNotNull(files.deletedAt), lt(files.deletedAt, cutoff)));
      for (const f of doomed) await deps.storage.delete(f.key);
    },
  });
}
