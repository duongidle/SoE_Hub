import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/file-setup.ts"],
    // All integration tests share one Postgres test database, so files run one after another.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
