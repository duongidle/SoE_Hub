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
  /** If set, the runtime role `soe_app` gets this password after migrating. */
  appPassword?: string;
}

export function defaultMigrationsFolder(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
}

/** Runs all pending migrations (forward only) and sets the runtime role password. */
export async function runMigrations(opts: MigrateOptions): Promise<void> {
  const pool = new pg.Pool({ connectionString: opts.url, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: opts.folder ?? defaultMigrationsFolder() });
    if (opts.appPassword) {
      // ALTER ROLE cannot take bind parameters; quote the literal ourselves.
      const literal = `'${opts.appPassword.replace(/'/g, "''")}'`;
      await pool.query(`ALTER ROLE soe_app WITH LOGIN PASSWORD ${literal}`);
    }
  } finally {
    await pool.end();
  }
}
