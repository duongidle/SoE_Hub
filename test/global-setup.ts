import os from "node:os";
import pg from "pg";
import { runMigrations } from "../packages/db/src/migrate";

/**
 * Creates a fresh `soe_hub_test` database, runs the real migrations, and exposes connection strings to the tests.
 * Needs a local Postgres where the current OS user is a superuser (Homebrew default).
 * Override with TEST_ADMIN_URL (superuser, database `postgres`).
 */
const DB_NAME = "soe_hub_test";

export default async function setup() {
  const adminUrl = process.env.TEST_ADMIN_URL ?? `postgres://${os.userInfo().username}@localhost:5432/postgres`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const base = new URL(adminUrl);
  const ownerUrl = new URL(base);
  ownerUrl.pathname = `/${DB_NAME}`;
  const appUrl = new URL(ownerUrl);
  appUrl.username = "soe_app";
  appUrl.password = "soe_app_test";

  await runMigrations({ url: ownerUrl.toString(), appPassword: "soe_app_test" });

  // A business-like table used by tests (standard columns), created after the migrations so default grants apply.
  const owner = new pg.Client({ connectionString: ownerUrl.toString() });
  await owner.connect();
  await owner.query(`
    CREATE TABLE IF NOT EXISTS test_items (
      id uuid PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid,
      version integer NOT NULL DEFAULT 1,
      deleted_at timestamptz,
      deleted_by uuid,
      name text NOT NULL,
      status text NOT NULL DEFAULT 'new',
      amount bigint,
      closing_date date,
      happened_at timestamptz,
      done boolean NOT NULL DEFAULT false
    )`);
  await owner.end();

  process.env.TEST_DATABASE_URL = appUrl.toString();
  process.env.TEST_OWNER_URL = ownerUrl.toString();
}
