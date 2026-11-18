import { runMigrations } from "./migrate";

const url = process.env.DATABASE_MIGRATE_URL;
if (!url) {
  console.error("DATABASE_MIGRATE_URL is required (connection string of the schema owner).");
  process.exit(1);
}

await runMigrations({
  url,
  folder: process.env.MIGRATIONS_DIR,
  appPassword: process.env.APP_DB_PASSWORD,
  appRole: process.env.APP_DB_ROLE || undefined,
});
console.log("Migrations applied.");
