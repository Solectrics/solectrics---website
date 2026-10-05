#!/usr/bin/env bash
set -Eeuo pipefail

# Fail-closed staging migration runner. This script contains no Pages, R2,
# production, or deployment commands. The D1 name is intentionally immutable.
readonly EXPECTED_BRANCH='codex/jobhub-staging-migrations-0015-0018'
readonly DATABASE='jobhub-staging'
readonly BASELINE_REL='staging/pre-0015-baseline.sql'
readonly MIGRATION_SOURCE='migrations'

fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
pause_for() {
  local prompt="$1" answer
  read -r -p "$prompt" answer
  [[ "$answer" == 'yes' ]] || fail 'Confirmation did not match; no further action taken.'
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'Run this from the Job Hub Git checkout.'
cd "$ROOT"
[[ "$(git branch --show-current)" == "$EXPECTED_BRANCH" ]] || fail "Checkout must be exactly $EXPECTED_BRANCH."
[[ -f "$BASELINE_REL" ]] || fail "Missing $BASELINE_REL."
command -v npx >/dev/null 2>&1 || fail 'Node/npm npx is unavailable.'

# Require exactly one source migration for each intended version, and copy only
# those four files into an isolated Wrangler migration directory.
for version in 0015 0016 0017 0018; do
  shopt -s nullglob
  matches=("$MIGRATION_SOURCE/$version"_*.sql)
  shopt -u nullglob
  [[ ${#matches[@]} -eq 1 ]] || fail "Expected exactly one $version migration under $MIGRATION_SOURCE/."
done

printf '\nThis runner can only operate on the D1 name: %s\n' "$DATABASE"
printf 'It will not run migrations 0001-0014 and contains no deployment or R2 commands.\n'
read -r -p 'Paste the D1 database UUID shown in the Cloudflare settings for jobhub-staging: ' DATABASE_ID
[[ "$DATABASE_ID" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] || fail 'That does not look like a D1 UUID.'
read -r -p 'Confirm you checked that UUID on the jobhub-staging database details page; type jobhub-staging: ' CONFIRM_DB
[[ "$CONFIRM_DB" == "$DATABASE" ]] || fail 'Database confirmation did not match; no D1 command was run.'

RUN_DIR="$(mktemp -d "$ROOT/.jobhub-staging-run.XXXXXX")"
cleanup() { rm -rf -- "$RUN_DIR"; }
trap cleanup EXIT
mkdir "$RUN_DIR/migrations"
for version in 0015 0016 0017 0018; do
  cp -- "$MIGRATION_SOURCE/$version"_*.sql "$RUN_DIR/migrations/"
done

CONFIG="$RUN_DIR/wrangler.toml"
cat > "$CONFIG" <<TOML
name = "jobhub-staging-migrations"
compatibility_date = "2026-10-05"

[[d1_databases]]
binding = "DB"
database_name = "jobhub-staging"
database_id = "$DATABASE_ID"
migrations_dir = "./migrations"
TOML

# The configured database name is fixed above and is also passed explicitly to
# every Wrangler D1 command. The temporary config has exactly one D1 binding.
wrangler_execute() {
  npx wrangler d1 execute "$DATABASE" --remote --config "$CONFIG" "$@"
}
wrangler_migrations() {
  local action="$1"
  npx wrangler d1 migrations "$action" "$DATABASE" --remote --config "$CONFIG"
}

printf '\n[1/5] Read-only check: application tables before baseline.\n'
wrangler_execute --command "SELECT COUNT(*) AS app_tables FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND substr(name,1,4) <> '_cf_';"
printf 'Expected app_tables = 0. If the result is not zero, stop here.\n'
pause_for 'Did the result show app_tables = 0? Type yes to apply the baseline: '

printf '\n[2/5] Applying the schema-only baseline to %s.\n' "$DATABASE"
wrangler_execute --file "$ROOT/$BASELINE_REL"

printf '\n[3/5] Read-only baseline verification.\n'
wrangler_execute --command "SELECT (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND substr(name,1,4) <> '_cf_') AS app_tables, (SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND substr(name,1,4) <> '_cf_') AS explicit_indexes;"
printf 'Expected app_tables = 18 and explicit_indexes = 10.\n'
pause_for 'Did the baseline counts match 18 tables and 10 indexes? Type yes to continue: '

printf '\n[4/5] Confirming pending migrations, then applying only 0015-0018.\n'
wrangler_migrations list
printf 'The list must contain only 0015, 0016, 0017 and 0018 as pending.\n'
pause_for 'Does the migration list show only 0015-0018 pending? Type yes to apply them: '
wrangler_migrations apply

printf '\n[5/5] Read-only post-migration verification.\n'
wrangler_migrations list
wrangler_execute --command "SELECT type, name FROM sqlite_schema WHERE type IN ('table','index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND substr(name,1,4) <> '_cf_' ORDER BY type, name;"
wrangler_execute --command "PRAGMA table_info(jobs);"
wrangler_execute --command "PRAGMA table_info(job_materials);"
wrangler_execute --command "PRAGMA integrity_check;"
wrangler_execute --command "PRAGMA foreign_key_check;"
printf '\nReview that 0015-0018 are applied, integrity_check is ok, and foreign_key_check returns no rows.\n'
printf 'Finished. All D1 operations in this script named %s and used the isolated temporary config.\n' "$DATABASE"
