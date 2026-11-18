import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildRegistry } from "../modules";
import { buildOpenApi } from "../http/openapi";
import { loadConfig } from "../config";
import { createStorage } from "../storage";

/** Server URL written into the exported file. Stable so the committed `docs/api/openapi.json` does not churn. */
export const EXPORT_SERVER_URL = "http://localhost:3000";

export function exportedSpecJson(): string {
  const config = loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "postgres://unused" });
  const { registry } = buildRegistry({ config, storage: createStorage(config) });
  return `${JSON.stringify(buildOpenApi(registry, EXPORT_SERVER_URL), null, 2)}\n`;
}

// Prints the OpenAPI document without needing a database.
//   pnpm --filter @soe/api openapi            -> stdout
//   pnpm docs:openapi                         -> docs/api/openapi.json (handover copy, checked by a test)
if (process.argv[1] && path.basename(process.argv[1]).startsWith("print-openapi")) {
  const i = process.argv.indexOf("--out");
  const json = exportedSpecJson();
  if (i > 0 && process.argv[i + 1]) {
    const out = path.resolve(process.argv[i + 1]!);
    writeFileSync(out, json);
    console.log(`Đã ghi ${out}`);
  } else {
    process.stdout.write(json);
  }
}
