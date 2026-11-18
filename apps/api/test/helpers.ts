import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createContainer, type Container } from "../src/bootstrap";
import type { Config } from "../src/config";
import { buildApp } from "../src/http/app";
import { SseHub } from "../src/http/sse";

export const DEV_USER = "01900000-0000-7000-8000-0000000000aa";

export interface TestApp {
  app: FastifyInstance;
  c: Container;
  sse: SseHub | null;
  close(): Promise<void>;
}

export async function makeApp(overrides: Partial<Config> = {}, opts: { sse?: boolean; extra?: (c: Container) => void } = {}): Promise<TestApp> {
  const dir = mkdtempSync(path.join(tmpdir(), "soe-test-storage-"));
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const c = createContainer({ NODE_ENV: "test", STORAGE_LOCAL_DIR: dir, RATE_LIMIT_MAX: 10_000, DB_POOL_MAX: 5, ...overrides } as Partial<Config>);
  opts.extra?.(c);
  const sse = opts.sse ? new SseHub(c.config.DATABASE_URL, c.logger) : null;
  if (sse) await sse.start();
  const app = await buildApp({ ...c, sse });
  await app.ready();
  return {
    app,
    c,
    sse,
    close: async () => {
      await app.close();
      await sse?.stop();
      await c.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const devHeaders = (userId = DEV_USER, extra: Record<string, string> = {}) => ({ "x-dev-actor": userId, ...extra });
