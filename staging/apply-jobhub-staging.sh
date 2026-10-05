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

INSPECT_ONLY=0
if [[ $# -gt 1 ]]; then
  fail 'Usage: bash staging/apply-jobhub-staging.sh [--inspect-only]'
fi
if [[ $# -eq 1 ]]; then
  [[ "$1" == '--inspect-only' ]] || fail 'Usage: bash staging/apply-jobhub-staging.sh [--inspect-only]'
  INSPECT_ONLY=1
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'Run this from the Job Hub Git checkout.'
cd "$ROOT"
[[ "$(git branch --show-current)" == "$EXPECTED_BRANCH" ]] || fail "Checkout must be exactly $EXPECTED_BRANCH."
command -v npx >/dev/null 2>&1 || fail 'Node/npm npx is unavailable.'

# Prove the script and branch match the latest branch tip before contacting
# Cloudflare. Fetch only updates local Git metadata; it does not touch Cloudflare.
git cat-file -e "HEAD:$SCRIPT_REL" 2>/dev/null || fail 'This checkout does not contain the committed staging runner.'
git diff --quiet HEAD -- "$SCRIPT_REL" "$BASELINE_REL" "$MIGRATION_SOURCE" || fail 'A migration input or the local runner differs from its committed version; restore/sync the branch and retry.'
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

# Inspect schema before any schema write. This makes reruns after the baseline or
# after one or more successful migrations resume from a known boundary. Unknown
# or partially-applied states stop without attempting a repair.
STATE_SQL="WITH counts AS (
  SELECT
    (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%' AND substr(name,1,4) <> '_cf_' AND name <> 'd1_migrations') AS t,
    (SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%' AND substr(name,1,4) <> '_cf_') AS i
), markers AS (
  SELECT
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='jobs') AS has_jobs,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='enquiries') AS has_enquiries,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='customer_invoice_versions') AS has_invoice_versions,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_books') AS has_books,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_accounts') AS has_accounts,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_bank_accounts') AS has_bank_accounts,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_bank_feed_transactions') AS has_bank_feed,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_supplier_invoice_inbox') AS has_supplier_inbox,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_supplier_invoice_events') AS has_supplier_events,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_job_books') AS has_job_books,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_transactions'
      AND instr(sql, 'allowable_input_gst') > 0) AS has_input_gst_column,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='jobs'
      AND instr(sql, 'supplier_reference') > 0) AS has_supplier_reference_column,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='job_materials'
      AND instr(sql, 'customer_markup_percent') > 0
      AND instr(sql, 'supplier_invoice_inbox_id') > 0) AS has_material_v18_columns,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='index' AND name='idx_jobs_supplier_reference_unique') AS has_job_ref_index,
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='index' AND name='idx_job_materials_supplier_inbox') AS has_material_inbox_index
)
SELECT CASE
  WHEN t=0 AND i=0 THEN 'JOBHUB_STATE_EMPTY'
  WHEN t=18 AND i=10 AND has_jobs AND has_enquiries AND has_invoice_versions
    THEN 'JOBHUB_STATE_BASELINE'
  WHEN t=32 AND i=17 AND has_books AND has_accounts AND NOT has_bank_accounts
    THEN 'JOBHUB_STATE_0015'
  WHEN t=38 AND i=21 AND has_bank_accounts AND has_bank_feed AND has_input_gst_column
    AND NOT has_supplier_inbox
    THEN 'JOBHUB_STATE_0016'
  WHEN t=42 AND i=25 AND has_supplier_inbox AND has_supplier_events AND has_job_books
    AND has_input_gst_column AND NOT has_supplier_reference_column
    THEN 'JOBHUB_STATE_0017'
  WHEN t=42 AND i=27 AND has_supplier_inbox AND has_input_gst_column
    AND has_supplier_reference_column AND has_material_v18_columns
    AND has_job_ref_index AND has_material_inbox_index
    THEN 'JOBHUB_STATE_0018'
  ELSE 'JOBHUB_STATE_UNKNOWN'
END AS recovery_state
FROM counts, markers;"

STATE_OUTPUT="$(wrangler_execute --command "$STATE_SQL" 2>&1)" || {
  printf '%s\n' "$STATE_OUTPUT" >&2
  fail 'Could not read the staging schema state; no schema write was attempted.'
}
STATE="$(printf '%s\n' "$STATE_OUTPUT" | sed -n 's/.*JOBHUB_STATE_\([A-Z0-9_]*\).*/\1/p' | tail -n 1)"
[[ -n "$STATE" ]] || fail 'Could not parse the staging schema state; no schema write was attempted.'
printf 'Detected existing schema state: %s\n' "$STATE"

if [[ "$INSPECT_ONLY" == 1 && "$STATE" == 'EMPTY' ]]; then
  printf 'Inspect-only mode: database is empty; baseline and migrations were not written.\n'
  exit 0
fi

case "$STATE" in
  EMPTY)
    printf '\n[1/5] Database is empty. Apply the pre-0015 baseline once.\n'
    pause_for 'Did the previous check show app_tables = 0? Type yes to apply the baseline: '
    printf '\nApplying baseline to %s.\n' "$DATABASE"
    wrangler_execute --file "$ROOT/$BASELINE_REL"
    STATE="BASELINE"
    ;;
  BASELINE|0015|0016|0017|0018)
    printf 'Baseline will not be reapplied. Existing staging schema is retained.\n'
    ;;
  *)
    fail 'Staging schema is not at a recognized empty/baseline/migration boundary. No baseline or migration was run. Inspect the staging D1 schema and migration history before proceeding.'
    ;;
esac

case "$STATE" in
  BASELINE) EXPECTED_PENDING='0015, 0016, 0017, 0018' ;;
  0015) EXPECTED_PENDING='0016, 0017, 0018' ;;
  0016) EXPECTED_PENDING='0017, 0018' ;;
  0017) EXPECTED_PENDING='0018' ;;
  0018)
    printf '\nAll four schema signatures are present. No migration will be applied.\n'
    EXPECTED_PENDING=''
    ;;
esac

printf '\n[2/5] Read-only verification of the detected checkpoint: %s.\n' "$STATE"
wrangler_execute --command "$STATE_SQL"

if [[ -n "$EXPECTED_PENDING" ]]; then
  printf '\n[3/5] Wrangler migration history (expected pending: %s).\n' "$EXPECTED_PENDING"
  wrangler_migrations list
  if [[ "$INSPECT_ONLY" == 1 ]]; then
    printf 'Inspect-only mode: no baseline or migration write was run.\n'
    exit 0
  fi
  printf 'Continue only if the Wrangler list shows exactly these pending migrations: %s.\n' "$EXPECTED_PENDING"
  pause_for 'Does the pending list match that exact sequence? Type yes to apply only pending migrations: '
  printf '\n[4/5] Applying pending migration files from 0015-0018 to %s.\n' "$DATABASE"
  wrangler_migrations apply
else
  printf '\n[3/5] Verifying Wrangler migration history for an already-complete schema.\n'
  wrangler_migrations list
  printf 'The migration history must show 0015-0018 applied. No migration write will be run.\n'
  pause_for 'Does Wrangler show 0015-0018 applied? Type yes to run final read-only checks: '
fi

printf '\n[5/5] Read-only post-migration verification.\n'
wrangler_migrations list
wrangler_execute --command "SELECT type, name FROM sqlite_schema WHERE type IN ('table','index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND substr(name,1,4) <> '_cf_' ORDER BY type, name;"
wrangler_execute --command "PRAGMA table_info(jobs);"
wrangler_execute --command "PRAGMA table_info(job_materials);"
wrangler_execute --command "PRAGMA integrity_check;"
wrangler_execute --command "PRAGMA foreign_key_check;"
printf '\nReview that 0015-0018 are applied, integrity_check is ok, and foreign_key_check returns no rows.\n'
printf 'Finished. Every D1 SQL/migration command explicitly named %s and used the isolated temporary config.\n' "$DATABASE"
