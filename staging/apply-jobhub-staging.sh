#!/usr/bin/env bash
set -Eeuo pipefail

# Fail-closed staging migration runner. It contains no Pages, R2, export,
# production database, or deployment commands. The D1 name is immutable.
readonly EXPECTED_BRANCH='codex/jobhub-staging-migrations-0015-0018'
readonly SCRIPT_REL='staging/apply-jobhub-staging.sh'
readonly DATABASE='jobhub-staging'
readonly FORBIDDEN_DATABASE='solectrics-enquiries'
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
command -v npx >/dev/null 2>&1 || fail 'Node/npm npx is unavailable.'

# Prove the script and branch match the latest branch tip before contacting
# Cloudflare. Fetch only updates local Git metadata; it does not touch Cloudflare.
git cat-file -e "HEAD:$SCRIPT_REL" 2>/dev/null || fail 'This checkout does not contain the committed staging runner.'
git diff --quiet HEAD -- "$SCRIPT_REL" || fail 'The local runner differs from its committed version; restore/sync the branch and retry.'
git fetch --quiet origin "$EXPECTED_BRANCH" || fail 'Could not verify the branch against origin; no Cloudflare command was run.'
REMOTE_HEAD="$(git rev-parse FETCH_HEAD 2>/dev/null)" || fail 'Could not read the fetched branch commit; no Cloudflare command was run.'
LOCAL_HEAD="$(git rev-parse HEAD 2>/dev/null)" || fail 'Could not read the current commit; no Cloudflare command was run.'
[[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]] || fail "Codespace is not at the latest branch commit. Run: git pull --ff-only origin $EXPECTED_BRANCH ; then rerun this script. No Cloudflare command was run."
[[ -f "$BASELINE_REL" ]] || fail "Missing $BASELINE_REL."

# Require exactly one source migration for each intended version.
for version in 0015 0016 0017 0018; do
  shopt -s nullglob
  matches=("$MIGRATION_SOURCE/$version"_*.sql)
  shopt -u nullglob
  [[ ${#matches[@]} -eq 1 ]] || fail "Expected exactly one $version migration under $MIGRATION_SOURCE/."
done

RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jobhub-staging-run.XXXXXX")"
cleanup() { rm -rf -- "$RUN_DIR"; }
trap cleanup EXIT

# Read-only control-plane lookup. This lists D1 metadata only; it does not run
# SQL, export, or change any database. Emit only the selected UUID to the shell.
D1_LIST_JSON="$RUN_DIR/d1-list.json"
if ! npx wrangler d1 list --json >"$D1_LIST_JSON"; then
  fail 'Wrangler could not list D1 metadata; no database SQL or write was run.'
fi
if ! DATABASE_ID="$(node - "$D1_LIST_JSON" "$DATABASE" "$FORBIDDEN_DATABASE" <<'NODE'
const fs = require('node:fs');
const [file, expected, forbidden] = process.argv.slice(2);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
try {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('D1 list output is not a JSON array');
  if (rows.some(row => !row || typeof row.name !== 'string' || typeof row.uuid !== 'string')) {
    throw new Error('D1 list contains an incomplete database identity');
  }
  const matches = rows.filter(row => row.name === expected);
  if (matches.length !== 1) throw new Error(`Expected exactly one database named ${expected}; found ${matches.length}`);
  const selected = matches[0];
  if (selected.name === forbidden) throw new Error('Resolved name is the forbidden production database');
  if (!uuidPattern.test(selected.uuid)) throw new Error('Selected database UUID is missing or invalid');
  const sameUuid = rows.filter(row => row.uuid.toLowerCase() === selected.uuid.toLowerCase());
  if (sameUuid.length !== 1 || sameUuid[0].name !== expected) {
    throw new Error('Selected UUID does not map uniquely back to the expected database name');
  }
  process.stdout.write(selected.uuid.toLowerCase());
} catch (error) {
  console.error(`D1 identity check failed: ${error.message}`);
  process.exit(1);
}
NODE
)"; then
  fail 'Could not establish one unambiguous jobhub-staging name/UUID pair; no database SQL or write was run.'
fi
[[ "$DATABASE_ID" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] || fail 'Resolved D1 UUID failed validation.'

# Create an isolated config with one D1 binding and only the four intended
# migration files. Nothing in the repository's normal Wrangler config is read.
mkdir "$RUN_DIR/migrations"
for version in 0015 0016 0017 0018; do
  cp -- "$MIGRATION_SOURCE/$version"_*.sql "$RUN_DIR/migrations/"
done
[[ "$(find "$RUN_DIR/migrations" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')" == 4 ]] || fail 'Temporary migration directory is not exactly four SQL files.'
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

# Independently resolve the configured UUID and explicitly verify the remote
# database info reports the exact same UUID and exact expected name.
D1_INFO_JSON="$RUN_DIR/d1-info.json"
if ! npx wrangler d1 info "$DATABASE" --json --config "$CONFIG" >"$D1_INFO_JSON"; then
  fail 'Could not verify the configured D1 identity; no database SQL or write was run.'
fi
if ! node - "$D1_INFO_JSON" "$DATABASE" "$FORBIDDEN_DATABASE" "$DATABASE_ID" <<'NODE'
const fs = require('node:fs');
const [file, expected, forbidden, selectedUuid] = process.argv.slice(2);
try {
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('D1 info output is not a JSON object');
  if (info.name === forbidden) throw new Error('D1 info resolved to the forbidden production database');
  if (info.name !== expected) throw new Error(`D1 info returned name ${String(info.name)}, expected ${expected}`);
  if (typeof info.uuid !== 'string' || info.uuid.toLowerCase() !== selectedUuid.toLowerCase()) {
    throw new Error('D1 info UUID does not match the uniquely selected UUID');
  }
} catch (error) {
  console.error(`D1 info identity check failed: ${error.message}`);
  process.exit(1);
}
NODE
then
  fail 'The configured UUID/name pair is not unambiguous; no database SQL or write was run.'
fi
printf 'Verified one D1 target: %s (UUID confirmed by Wrangler info).\n' "$DATABASE"

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
printf 'Finished. Every D1 SQL/migration command explicitly named %s and used the isolated temporary config.\n' "$DATABASE"
