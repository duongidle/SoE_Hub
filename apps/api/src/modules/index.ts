import { and, isNotNull, lt } from "drizzle-orm";
import { files, registerTrashTable } from "@soe/db";
import type { Config } from "../config";
import { EventRegistry } from "../core/events";
import { Registry } from "../core/registry";
import type { StorageDriver } from "../storage/types";
import { systemEvents } from "./system/events";
import { fileOperations } from "./system/files";
import { systemOperations } from "./system/system";

export interface ModuleDeps {
  config: Config;
  storage: StorageDriver;
}

/** Every module registers its commands/queries and events here. Stage 1+ add their modules to this list. */
export function buildRegistry(deps: ModuleDeps): { registry: Registry; events: EventRegistry } {
  const events = new EventRegistry().register(...systemEvents);
  const registry = new Registry().register(...systemOperations, ...fileOperations(deps.config, deps.storage));
  return { registry, events };
}

/** Tables that have a trash. Used by the purge job. Deals (Stage 4) will register with `neverHardDelete: true`. */
export function registerTrashTables(deps: ModuleDeps): void {
  registerTrashTable({
    name: "files",
    beforePurge: async (ex, cutoff) => {
      const doomed = await ex.select({ key: files.storageKey }).from(files).where(and(isNotNull(files.deletedAt), lt(files.deletedAt, cutoff)));
      for (const f of doomed) await deps.storage.delete(f.key);
    },
  });
}
