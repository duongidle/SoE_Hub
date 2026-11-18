import { createDb, type DbHandle } from "@soe/db";
import type { Logger } from "pino";
import { createAuthKit, type AuthKit } from "./auth";
import { loadConfig, type Config } from "./config";
import { OperationExecutor } from "./core/executor";
import type { EventRegistry } from "./core/events";
import type { Registry } from "./core/registry";
import { createLogger } from "./logger";
import { buildRegistry } from "./modules";
import { createStorage, type StorageDriver } from "./storage";

export interface Container {
  config: Config;
  logger: Logger;
  db: DbHandle;
  storage: StorageDriver;
  registry: Registry;
  events: EventRegistry;
  executor: OperationExecutor;
  auth: AuthKit;
}

/** Wires config, database, storage, registry and executor. Shared by the api and the worker. */
export function createContainer(overrides: Partial<Config> = {}, role = "api"): Container {
  const config = { ...loadConfig(), ...overrides };
  const logger = createLogger(config, role);
  const db = createDb(config.DATABASE_URL, { max: config.DB_POOL_MAX, applicationName: `soe-${role}` });
  const storage = createStorage(config);
  const { registry, events } = buildRegistry({ config, storage });
  const auth = createAuthKit(config);
  const executor = new OperationExecutor({
    db: db.db,
    registry,
    events,
    authorizer: auth.authorizer,
    logger,
    validateOutput: !config.isProduction,
  });
  return { config, logger, db, storage, registry, events, executor, auth };
}
