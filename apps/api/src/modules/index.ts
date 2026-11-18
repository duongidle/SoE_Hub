import { and, isNotNull, lt } from "drizzle-orm";
import { files, registerTrashTable } from "@soe/db";
import { systemScope } from "../auth/access";
import type { Config } from "../config";
import { EventRegistry } from "../core/events";
import { Registry } from "../core/registry";
import type { StorageDriver } from "../storage/types";
import { authEvents } from "./auth/events";
import { authOperations } from "./auth/operations";
import { tokenOperations } from "./auth/tokens";
import { guestEvents, guestOperations } from "./guest";
import { notificationEvents, notificationOperations } from "./notification";
import { orgOperations } from "./org/operations";
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
  const events = new EventRegistry().register(...systemEvents, ...authEvents, ...notificationEvents, ...guestEvents, ...transferEvents);
  const registry = new Registry().register(
    ...systemOperations,
    ...fileOperations(deps.config, deps.storage),
    ...authOperations(deps.config),
    ...tokenOperations(),
    ...orgOperations,
    ...notificationOperations,
    ...guestOperations,
    ...transferOperations,
  );
  return { registry, events };
}

/** Tables that have a trash. Used by the purge job. Deals (Stage 4) will register with `neverHardDelete: true`. */
export function registerTrashTables(deps: ModuleDeps): void {
  registerTrashTable({
    name: "files",
    beforePurge: async (ex, cutoff) => {
      const doomed = await ex.select({ key: files.storageKey }).from(files).where(and(systemScope(), isNotNull(files.deletedAt), lt(files.deletedAt, cutoff)));
      for (const f of doomed) await deps.storage.delete(f.key);
    },
  });
}
