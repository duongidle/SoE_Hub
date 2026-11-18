import { defineConfig } from "tsup";

// One self-contained ESM bundle per process, so the production image needs no node_modules.
export default defineConfig({
  entry: {
    server: "src/server.ts",
    worker: "src/worker.ts",
    // Migration runner (schema owner). Reads SQL files from MIGRATIONS_DIR.
    migrate: "../../packages/db/src/migrate-cli.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/.*/],
  external: ["pg-native"],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
