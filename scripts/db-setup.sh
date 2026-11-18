#!/usr/bin/env bash
# Creates the local development database and applies migrations. Safe to run again.
# Needs a local PostgreSQL 17 (brew install postgresql@17 && brew services start postgresql@17)
# and a `.env` copied from `.env.example`.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${DATABASE_MIGRATE_URL:?Missing DATABASE_MIGRATE_URL. Copy .env.example to .env first.}"
ADMIN_URL="${DATABASE_ADMIN_URL:-postgres://localhost:5432/postgres}"
DB_NAME="$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "$DATABASE_MIGRATE_URL")"

PSQL="${PSQL:-psql}"
if ! command -v "$PSQL" >/dev/null 2>&1 && [ -x /opt/homebrew/opt/postgresql@17/bin/psql ]; then PSQL=/opt/homebrew/opt/postgresql@17/bin/psql; fi

if ! "$PSQL" "$ADMIN_URL" -Atc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  "$PSQL" "$ADMIN_URL" -c "CREATE DATABASE \"$DB_NAME\""
  echo "Created database $DB_NAME"
fi

pnpm db:migrate
