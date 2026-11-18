import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export type Db = NodePgDatabase<typeof schema>;
/** Transaction handle passed to the callback of `db.transaction`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the db itself or a transaction. */
export type Executor = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  max?: number;
  applicationName?: string;
}

// Postgres `bigint` (int8) is returned as a string by default. Money columns use bigint with mode "number"
// in Drizzle, which parses itself, so we leave the driver default untouched.

export function createDb(connectionString: string, opts: CreateDbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    application_name: opts.applicationName ?? "soe-hub",
  });
  // An idle client error must not crash the process.
  pool.on("error", () => {});
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export { schema };
