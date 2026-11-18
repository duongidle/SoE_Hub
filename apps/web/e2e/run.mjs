// Runs the browser tests against a real stack: an empty test database, api + worker + web (Vite), then Playwright.
//   pnpm test:e2e [playwright args]
// Needs a local PostgreSQL where the current OS user is a superuser (same as `pnpm test`). Override with E2E_ADMIN_URL.
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DB = "soe_hub_e2e";
const API_PORT = 3100;
const WEB_PORT = 5273;
const APP_PASSWORD = "soe_app_test"; // the runtime role is shared by the whole cluster; same value as the test suite

const adminUrl = process.env.E2E_ADMIN_URL ?? `postgres://${os.userInfo().username}@localhost:5432/postgres`;
const ownerUrl = new URL(adminUrl);
ownerUrl.pathname = `/${DB}`;
const appUrl = new URL(ownerUrl);
appUrl.username = "soe_app";
appUrl.password = APP_PASSWORD;

const env = {
  ...process.env,
  NODE_ENV: "development",
  PORT: String(API_PORT),
  PUBLIC_URL: `http://localhost:${API_PORT}`,
  LOG_LEVEL: "warn",
  DATABASE_URL: appUrl.toString(),
  DATABASE_MIGRATE_URL: ownerUrl.toString(),
  APP_DB_PASSWORD: APP_PASSWORD,
  RATE_LIMIT_MAX: "100000",
  STORAGE_LOCAL_DIR: path.join(root, ".local-storage-e2e"),
  VITE_API_TARGET: `http://localhost:${API_PORT}`,
  E2E_API_URL: `http://localhost:${API_PORT}`,
  E2E_WEB_URL: `http://localhost:${WEB_PORT}`,
};

const children = [];
function start(name, cmd, args) {
  const child = spawn(cmd, args, { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const tag = (d) => process.stdout.write(`[${name}] ${d}`);
  child.stdout.on("data", tag);
  child.stderr.on("data", tag);
  children.push(child);
  return child;
}
function stopAll() {
  for (const c of children) {
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}
process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

async function waitFor(url, check, label, timeoutMs = 90_000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok && (!check || (await check(res)))) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label} không khởi động được sau ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

let code = 1;
try {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  await admin.end();
  const mig = spawnSync("pnpm", ["db:migrate"], { cwd: root, env, stdio: "inherit" });
  if (mig.status !== 0) throw new Error("Chạy migration thất bại");

  start("api", "pnpm", ["--filter", "@soe/api", "exec", "tsx", "src/server.ts"]);
  start("worker", "pnpm", ["--filter", "@soe/api", "exec", "tsx", "src/worker.ts"]);
  start("web", "pnpm", ["--filter", "@soe/web", "exec", "vite", "--port", String(WEB_PORT), "--strictPort"]);
  await waitFor(`http://localhost:${API_PORT}/health`, async (r) => (await r.json()).db === "ok", "api");
  await waitFor(`http://localhost:${WEB_PORT}/`, null, "web");

  const pw = spawn("pnpm", ["--filter", "@soe/web", "exec", "playwright", "test", ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit" });
  code = await new Promise((resolve) => pw.on("exit", (c) => resolve(c ?? 1)));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
} finally {
  stopAll();
}
process.exit(code);
