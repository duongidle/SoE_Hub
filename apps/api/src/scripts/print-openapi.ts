import { buildRegistry } from "../modules";
import { buildOpenApi } from "../http/openapi";
import { loadConfig } from "../config";
import { createStorage } from "../storage";

// Prints the OpenAPI document without needing a database: `pnpm --filter @soe/api openapi > openapi.json`
const config = loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "postgres://unused" });
const { registry } = buildRegistry({ config, storage: createStorage(config) });
process.stdout.write(`${JSON.stringify(buildOpenApi(registry, config.PUBLIC_URL), null, 2)}\n`);
