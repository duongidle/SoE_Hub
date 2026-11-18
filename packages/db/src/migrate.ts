import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export interface MigrateOptions {
  /** Connection string of the schema OWNER (not the runtime role). */
  url: string;
  /** Folder with the SQL migrations. Defaults to `packages/db/drizzle`. */
  folder?: string;
  /** If set, the runtime role gets this password after migrating. */
  appPassword?: string;
  /**
   * Name of the runtime role (default `soe_app`). Roles belong to the whole Postgres cluster, so tests and e2e use
   * their own names (`soe_app_test`, `soe_app_e2e`) and never touch the role of the dev database.
   */
  appRole?: string;
}

export const DEFAULT_APP_ROLE = "soe_app";

/** Copy of the migrations folder with the default role name replaced, for a differently named runtime role. */
function migrationsFor(folder: string, role: string): { folder: string; cleanup: () => void } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "soe-migrations-"));
  fs.cpSync(folder, tmp, { recursive: true });
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) walk(full);
      else if (f.name.endsWith(".sql")) fs.writeFileSync(full, fs.readFileSync(full, "utf8").replace(/\bsoe_app\b/g, role));
    }
  };
  walk(tmp);
  return { folder: tmp, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

export function defaultMigrationsFolder(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
}

/** Runs all pending migrations (forward only) and sets the runtime role password. */
export async function runMigrations(opts: MigrateOptions): Promise<void> {
  const role = opts.appRole ?? DEFAULT_APP_ROLE;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error(`Tên vai trò không hợp lệ: ${role}`);
  const pool = new pg.Pool({ connectionString: opts.url, max: 1 });
  const custom = role === DEFAULT_APP_ROLE ? null : migrationsFor(opts.folder ?? defaultMigrationsFolder(), role);
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: custom?.folder ?? opts.folder ?? defaultMigrationsFolder() });
    if (opts.appPassword) {
      // ALTER ROLE cannot take bind parameters; quote the literal ourselves.
      const literal = `'${opts.appPassword.replace(/'/g, "''")}'`;
      await pool.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${literal}`);
    }
  } finally {
    custom?.cleanup();
    await pool.end();
  }
}
