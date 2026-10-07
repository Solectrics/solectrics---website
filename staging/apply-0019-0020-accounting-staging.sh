#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_BRANCH='codex/jobhub-staging-migrations-0015-0018'
readonly DATABASE='jobhub-staging'
readonly FORBIDDEN_DATABASE='solectrics-enquiries'
readonly SEED='staging/seed-initial-businesses.sql'
readonly -a MIGRATIONS=(
  migrations/0019_business_identity_and_modules.sql
  migrations/0020_accountant_controls.sql
)

fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }

[[ "${1:-}" == '--apply-staging' && $# -eq 1 ]] ||
  fail 'Usage: bash staging/apply-0019-0020-accounting-staging.sh --apply-staging'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'Run from the Job Hub checkout.'
cd "$ROOT"
[[ "$(git branch --show-current)" == "$EXPECTED_BRANCH" ]] || fail "Checkout must be exactly $EXPECTED_BRANCH."
command -v npx >/dev/null 2>&1 || fail 'npx is unavailable.'
for f in "${MIGRATIONS[@]}" "$SEED"; do [[ -f "$f" ]] || fail "Missing $f"; done
git diff --quiet HEAD -- "${MIGRATIONS[@]}" "$SEED" "$0" || fail 'Staging inputs have uncommitted changes.'
git fetch --quiet origin "$EXPECTED_BRANCH" || fail 'Could not verify branch tip.'
[[ "$(git rev-parse HEAD)" == "$(git rev-parse FETCH_HEAD)" ]] || fail 'Checkout is not at latest branch tip.'

RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jobhub-accounting-staging.XXXXXX")"
trap 'rm -rf "$RUN_DIR"' EXIT

npx wrangler d1 list --json > "$RUN_DIR/list.json"
DATABASE_ID="$(node - "$RUN_DIR/list.json" "$DATABASE" "$FORBIDDEN_DATABASE" <<'NODE'
const fs=require('node:fs');
const [file,expected,forbidden]=process.argv.slice(2);
const rows=JSON.parse(fs.readFileSync(file,'utf8'));
const matches=rows.filter(r=>r?.name===expected);
if(matches.length!==1) throw new Error(`Expected exactly one ${expected}; found ${matches.length}`);
const selected=matches[0];
if(selected.name===forbidden) throw new Error('Forbidden production database selected');
if(!/^[0-9a-f-]{36}$/i.test(selected.uuid||'')) throw new Error('Invalid staging D1 UUID');
const aliases=rows.filter(r=>String(r?.uuid||'').toLowerCase()===selected.uuid.toLowerCase());
if(aliases.length!==1) throw new Error('Staging D1 UUID is not unique');
process.stdout.write(selected.uuid);
NODE
)" || fail 'Could not establish unique staging D1 identity.'

mkdir "$RUN_DIR/migrations"
cp "${MIGRATIONS[@]}" "$RUN_DIR/migrations/"
cat > "$RUN_DIR/wrangler.toml" <<TOML
name = "jobhub-accounting-staging"
compatibility_date = "2026-10-07"
[[d1_databases]]
binding = "DB"
database_name = "jobhub-staging"
database_id = "$DATABASE_ID"
migrations_dir = "./migrations"
TOML

exec_sql(){ npx wrangler d1 execute "$DATABASE" --remote --config "$RUN_DIR/wrangler.toml" "$@"; }

printf '\nRead-only preflight on %s\n' "$DATABASE"
PRE="$(exec_sql --command "SELECT
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_supplier_invoice_inbox') AS has_0018,
 EXISTS(SELECT 1 FROM pragma_table_info('bookkeeping_books') WHERE name='business_id') AS has_0019,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_period_locks') AS has_0020;" 2>&1)"
printf '%s\n' "$PRE"
printf '%s\n' "$PRE" | grep -Eq '"has_0018"[[:space:]]*:[[:space:]]*1' || fail 'Staging is not confirmed through 0018.'

printf '\nMigration history:\n'
npx wrangler d1 migrations list "$DATABASE" --remote --config "$RUN_DIR/wrangler.toml"

if printf '%s\n' "$PRE" | grep -Eq '"has_0019"[[:space:]]*:[[:space:]]*0|"has_0020"[[:space:]]*:[[:space:]]*0'; then
  printf 'Explicit --apply-staging authorization present. Applying only pending 0019/0020 migrations.\n'
  npx wrangler d1 migrations apply "$DATABASE" --remote --config "$RUN_DIR/wrangler.toml"
else
  printf '0019 and 0020 signatures already present; no schema migration write needed.\n'
fi

POST="$(exec_sql --command "SELECT
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='jobhub_businesses') AS businesses,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='jobhub_business_memberships') AS memberships,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_period_locks') AS locks,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_credit_notes') AS credits,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_accountant_adjustments') AS adjustments;" 2>&1)"
printf '%s\n' "$POST"
for k in businesses memberships locks credits adjustments; do
  printf '%s\n' "$POST" | grep -Eq "\"$k\"[[:space:]]*:[[:space:]]*1" || fail "Post-migration verification failed at $k."
done

printf '\nExisting active books before seed:\n'
exec_sql --command "SELECT id,name,legal_name,business_id,book_code,book_role FROM bookkeeping_books WHERE active=1 ORDER BY created_at,id;"
printf 'Applying only the committed initial-business seed to jobhub-staging.\n'
exec_sql --file "$ROOT/$SEED"

printf '\nRead-only business/book verification:\n'
exec_sql --command "SELECT id,slug,legal_name,business_type,currency FROM jobhub_businesses ORDER BY slug;"
exec_sql --command "SELECT business_id,module_code,enabled FROM jobhub_business_modules ORDER BY business_id,module_code;"
exec_sql --command "SELECT id,name,legal_name,business_id,book_code,book_role FROM bookkeeping_books WHERE active=1 ORDER BY name;"
exec_sql --command "SELECT business_id,default_book_id,supplier_inbox_book_id,sales_book_id FROM jobhub_business_book_settings ORDER BY business_id;"

printf '\nSafety checks:\n'
exec_sql --command "SELECT CASE
 WHEN EXISTS(SELECT 1 FROM bookkeeping_books WHERE id IN (
   SELECT default_book_id FROM jobhub_business_book_settings WHERE business_id='business-sol-espresso'
 ) AND business_id='business-solectrics') THEN 'FAIL' ELSE 'OK' END AS company_book_separation;"
exec_sql --command "PRAGMA integrity_check;"
exec_sql --command "PRAGMA foreign_key_check;"

printf '\nDONE: staging schema/config prepared. No production resource was named or modified.\n'
printf 'Next UI action: deploy the latest branch to protected solectrics-jobhub-staging Pages, sign in, claim Solectrics Limited, then run synthetic accountant acceptance.\n'
