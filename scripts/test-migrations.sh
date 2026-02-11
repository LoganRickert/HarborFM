#!/usr/bin/env bash
# Create a fresh test database and run all migrations to verify they apply cleanly.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DB_DIR="${ROOT}/.tmp/migration-test"
rm -rf "$TEST_DB_DIR"
mkdir -p "$TEST_DB_DIR"
export DATA_DIR="$TEST_DB_DIR"
pnpm --filter server run db:migrate
echo "Migrations OK (fresh DB at ${TEST_DB_DIR})"
rm -rf "$TEST_DB_DIR"
