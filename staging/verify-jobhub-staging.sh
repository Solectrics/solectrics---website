#!/usr/bin/env bash
set -Eeuo pipefail

# Read-only post-0018 schema verifier. The only permitted D1 target is
# jobhub-staging. It contains no migration, Pages, R2, export, or deploy action.
readonly EXPECTED_BRANCH='codex/jobhub-staging-migrations-0015-0018'
readonly SCRIPT_REL='staging/verify-jobhub-staging.sh'
readonly VERIFY_SQL_REL='staging/post-0018-verify.sql'
readonly DATABASE='jobhub-staging'
readonly FORBIDDEN_DATABASE='solectrics-enquiries'

fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'Run this from the Job Hub Git checkout.'
cd "$ROOT"
[[ "$(git branch --show-current)" == "$EXPECTED_BRANCH" ]] || fail "Checkout must be exactly $EXPECTED_BRANCH."
command -v npx >/dev/null 2>&1 || fail 'Node/npm npx is unavailable.'

# Do not run a stale or locally altered verifier/query.
git cat-file -e "HEAD:$SCRIPT_REL" 2>/dev/null || fail 'This checkout does not contain the committed verifier.'
git diff --quiet HEAD -- "$SCRIPT_REL" "$VERIFY_SQL_REL" || fail 'The verifier or SQL check differs from its committed version.'
git fetch --quiet origin "$EXPECTED_BRANCH" || fail 'Could not verify the development branch; no Cloudflare command was run.'
REMOTE_HEAD="$(git rev-parse FETCH_HEAD 2>/dev/null)" || fail 'Could not read the fetched branch commit.'
LOCAL_HEAD="$(git rev-parse HEAD 2>/dev/null)" || fail "Codespace is behind. Run: git pull --ff-only origin $EXPECTED_BRANCH"
[[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]] || fail "Codespace is behind. Run: git pull --ff-only origin $EXPECTED_BRANCH ; then rerun this verifier. No D1 query was run."
[[ -f "$VERIFY_SQL_REL" ]] || fail "Missing $VERIFY_SQL_REL."

RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jobhub-staging-verify.XXXXXX")"
cleanup() { rm -rf -- "$RUN_DIR"; }
trap cleanup EXIT

# Read-only account metadata lookup. Resolve only one exact staging name.
D1_LIST_JSON="$RUN_DIR/d1-list.json"
if ! npx wrangler d1 list --json >"$D1_LIST_JSON"; then
  fail 'Wrangler could not list D1 metadata; no D1 SQL was run.'
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
  if (selected.name === forbidden) throw new Error('Resolved name is forbidden');
  if (!uuidPattern.test(selected.uuid)) throw new Error('Selected database UUID is invalid');
  const sameUuid = rows.filter(row => row.uuid.toLowerCase() === selected.uuid.toLowerCase());
  if (sameUuid.length !== 1 || sameUuid[0].name !== expected) throw new Error('Selected UUID does not map uniquely to the expected name');
  process.stdout.write(selected.uuid.toLowerCase());
} catch (error) {
  console.error(`D1 identity check failed: ${error.message}`);
  process.exit(1);
}
NODE
)"; then
  fail 'Could not establish one unambiguous jobhub-staging name/UUID pair; no D1 SQL was run.'
fi
[[ "$DATABASE_ID" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] || fail 'Resolved D1 UUID failed validation.'

# Isolated config contains exactly one D1 binding and no migration directory.
CONFIG="$RUN_DIR/wrangler.toml"
cat >"$CONFIG" <<TOML
name = "jobhub-staging-schema-verifier"
compatibility_date = "2026-10-05"

[[d1_databases]]
binding = "DB"
database_name = "jobhub-staging"
database_id = "$DATABASE_ID"
TOML

D1_INFO_JSON="$RUN_DIR/d1-info.json"
if ! npx wrangler d1 info "$DATABASE" --json --config "$CONFIG" >"$D1_INFO_JSON"; then
  fail 'Could not verify the configured D1 identity; no schema query was run.'
fi
if ! node - "$D1_INFO_JSON" "$DATABASE" "$FORBIDDEN_DATABASE" "$DATABASE_ID" <<'NODE'
const fs = require('node:fs');
const [file, expected, forbidden, selectedUuid] = process.argv.slice(2);
try {
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('D1 info output is not an object');
  if (info.name === forbidden) throw new Error('D1 info resolved to the forbidden database');
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
  fail 'The configured UUID/name pair is not unambiguous; no schema query was run.'
fi

printf 'Verified sole target: %s (UUID confirmed). Running read-only post-0018 schema check.\n' "$DATABASE"
OUT="$RUN_DIR/schema-check.json"
if ! npx wrangler d1 execute "$DATABASE" --remote --config "$CONFIG" --json --file "$ROOT/$VERIFY_SQL_REL" >"$OUT"; then
  cat "$OUT" >&2
  fail 'The read-only schema verification query failed. No writes were performed.'
fi
cat "$OUT"
if ! grep -q 'JOBHUB_SCHEMA_VERIFY_OK' "$OUT"; then
  fail 'Post-0018 schema does not match the reconstructed schema manifest. Review the reported differences; no writes were performed.'
fi
printf '\nPASS: actual jobhub-staging schema matches the reconstructed post-0018 manifest.\n'
printf 'The query checked 42 application tables, 530 column definitions, 27 explicit indexes, 52 foreign-key definitions, integrity_check, and foreign_key_check.\n'
printf 'No database writes, migrations, exports, Pages, R2, or deployment actions were run.\n'
