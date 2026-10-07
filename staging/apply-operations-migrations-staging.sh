#!/usr/bin/env bash
set -Eeuo pipefail

# Apply only the approved Job Hub staging migration chain to the staging D1
# database. This script never references or configures a production resource.
readonly BRANCH='codex/jobhub-solar-operations-workflow'
readonly DATABASE='jobhub-staging'
readonly FORBIDDEN_DATABASE='solectrics-enquiries'
readonly PROJECT='solectrics-jobhub-staging'
readonly MIGRATION_DIR='migrations'
readonly SCRIPT_REL='staging/apply-operations-migrations-staging.sh'
readonly VERSIONS=(0015 0016 0017 0018 0019 0020 0021)

fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
confirm() {
  local expected="$1" prompt="$2" answer
  read -r -p "$prompt" answer
  [[ "$answer" == "$expected" ]] || fail 'Confirmation did not match; stopped without continuing.'
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'Run from the Job Hub Git checkout.'
cd "$ROOT"
[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail "Checkout must be exactly $BRANCH."
git diff --quiet HEAD -- . || fail 'Tracked files have local changes. Review or commit them before continuing.'
git fetch --quiet origin "$BRANCH" || fail 'Could not verify the approved branch tip.'
[[ "$(git rev-parse HEAD)" == "$(git rev-parse FETCH_HEAD)" ]] || fail "Codespace is behind. Run: git pull --ff-only origin $BRANCH"

# Support Codespaces where Node exists but npx is not initialized after restart.
if ! command -v npm >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  if [[ -f "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    set +u
    source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    set -u
  fi
fi
command -v node >/dev/null 2>&1 || fail 'Node is unavailable.'
if command -v npx >/dev/null 2>&1; then
  WRANGLER=(npx --yes --package=wrangler -- wrangler)
elif command -v npm >/dev/null 2>&1; then
  WRANGLER=(npm exec --yes --package=wrangler -- wrangler)
else
  fail 'Node/npm are unavailable. No authentication method was attempted.'
fi

for version in "${VERSIONS[@]}"; do
  shopt -s nullglob
  files=("$MIGRATION_DIR/$version"_*.sql)
  shopt -u nullglob
  [[ ${#files[@]} -eq 1 ]] || fail "Expected exactly one migration file for $version."
done
git cat-file -e "HEAD:$SCRIPT_REL" || fail 'The committed staging migration runner is missing.'
for path in "$SCRIPT_REL" "$MIGRATION_DIR"/0015_*.sql "$MIGRATION_DIR"/0016_*.sql "$MIGRATION_DIR"/0017_*.sql "$MIGRATION_DIR"/0018_*.sql "$MIGRATION_DIR"/0019_*.sql "$MIGRATION_DIR"/0020_*.sql "$MIGRATION_DIR"/0021_*.sql; do
  git diff --quiet HEAD -- "$path" || fail "Staging input differs from the committed branch: $path"
done

RUN="$(mktemp -d "${TMPDIR:-/tmp}/jobhub-operations-stage.XXXXXX")"
cleanup() { rm -rf -- "$RUN"; }
trap cleanup EXIT
mkdir -p "$RUN/migrations"

# Read-only D1 account listing; reject missing/ambiguous identity before SQL.
"${WRANGLER[@]}" d1 list --json > "$RUN/list.json" || fail 'Wrangler D1 metadata lookup failed; no database SQL or write was run.'
DATABASE_ID="$(node - "$RUN/list.json" "$DATABASE" "$FORBIDDEN_DATABASE" <<'NODE'
const fs = require('node:fs');
const [file, expected, forbidden] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
try {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rows) || rows.some(x => !x || typeof x.name !== 'string' || typeof x.uuid !== 'string')) {
    throw new Error('D1 list was incomplete or not an array');
  }
  const matches = rows.filter(x => x.name === expected);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${expected}; found ${matches.length}`);
  const picked = matches[0];
  if (picked.name === forbidden || !uuid.test(picked.uuid)) throw new Error('Forbidden or malformed D1 identity');
  const byUuid = rows.filter(x => x.uuid.toLowerCase() === picked.uuid.toLowerCase());
  if (byUuid.length !== 1 || byUuid[0].name !== expected) throw new Error('D1 UUID does not map uniquely to the expected name');
  process.stdout.write(picked.uuid.toLowerCase());
} catch (e) { console.error(e.message); process.exit(1); }
NODE
)" || fail 'Could not establish the unique jobhub-staging name/UUID pair; no SQL or write was run.'

for version in "${VERSIONS[@]}"; do cp -- "$MIGRATION_DIR/$version"_*.sql "$RUN/migrations/"; done
[[ "$(find "$RUN/migrations" -maxdepth 1 -name '*.sql' -type f | wc -l | tr -d ' ')" == 7 ]] || fail 'Temporary migration set is not exactly 0015–0021.'
cat > "$RUN/wrangler.toml" <<TOML
name = "jobhub-operations-staging-migrations"
compatibility_date = "2026-10-07"
[[d1_databases]]
binding = "DB"
database_name = "jobhub-staging"
database_id = "$DATABASE_ID"
migrations_dir = "./migrations"
TOML

"${WRANGLER[@]}" d1 info "$DATABASE" --json --config "$RUN/wrangler.toml" > "$RUN/info.json" || fail 'Wrangler could not verify the configured staging D1 identity.'
node - "$RUN/info.json" "$DATABASE" "$FORBIDDEN_DATABASE" "$DATABASE_ID" <<'NODE'
const fs = require('node:fs');
const [file, expected, forbidden, uuid] = process.argv.slice(2);
try {
 const x = JSON.parse(fs.readFileSync(file, 'utf8'));
 if (!x || x.name !== expected || x.name === forbidden || typeof x.uuid !== 'string' || x.uuid.toLowerCase() !== uuid) {
   throw new Error('Wrangler info did not confirm the exact staging name and UUID');
 }
} catch (e) { console.error(e.message); process.exit(1); }
NODE
printf 'Verified staging target: %s (UUID confirmed).\n' "$DATABASE"

d1() { "${WRANGLER[@]}" d1 execute "$DATABASE" --remote --config "$RUN/wrangler.toml" --json "$@"; }
migration_history() {
  # First check for Wrangler's ledger table. A missing ledger is acceptable only
  # for an exact pre-0015 baseline; any later schema without a ledger is ambiguous.
  d1 --command "SELECT COUNT(*) AS ledger_present FROM sqlite_schema WHERE type='table' AND name='d1_migrations';" > "$RUN/ledger-exists.json" ||
    fail 'Could not read staging sqlite_schema; stopped before writes.'
  node - "$RUN/ledger-exists.json" <<'NODE'
const fs=require('node:fs');
try {
 const x=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 const walk=v=>Array.isArray(v)?v.flatMap(walk):(v&&typeof v==='object'?[
   ...(Object.hasOwn(v,'ledger_present')?[Number(v.ledger_present)]:[]),
   ...Object.values(v).flatMap(walk)
 ]:[]);
 const a=walk(x);
 if(a.length!==1 || ![0,1].includes(a[0])) throw Error('Unexpected schema query result');
 process.stdout.write(String(a[0]));
} catch(e){console.error(e.message);process.exit(1)}
NODE
}
table_rows() {
  const_file="$1"; key="$2"
  node - "$const_file" "$key" <<'NODE'
const fs=require('node:fs');
const [file,key]=process.argv.slice(2);
try {
 const root=JSON.parse(fs.readFileSync(file,'utf8'));
 let found=[];
 const walk=v=>{ if(Array.isArray(v)) return v.forEach(walk); if(v&&typeof v==='object') {
   if(Object.hasOwn(v,key)) found.push(v);
   Object.values(v).forEach(walk);
 }};
 walk(root);
 if(found.length!==1) throw Error(`Expected one row containing ${key}; found ${found.length}`);
 process.stdout.write(JSON.stringify(found[0]));
} catch(e){console.error(e.message);process.exit(1)}
NODE
}

# Read migration ledger and all schema markers in one read-only preflight.
LEDGER_EXISTS="$(migration_history)" || fail 'Could not establish whether Wrangler history exists.'
if [[ "$LEDGER_EXISTS" == 1 ]]; then
  d1 --command "SELECT name AS migration_name FROM d1_migrations ORDER BY name;" > "$RUN/history.json" ||
    fail 'Could not read Wrangler migration history; no write was run.'
  node - "$RUN/history.json" <<'NODE' > "$RUN/history.txt" || fail 'Migration history output was ambiguous; no write was run.'
const fs=require('node:fs');
try {
 const root=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 let results=[], sawResults=false;
 const walk=v=>{if(Array.isArray(v))return v.forEach(walk);if(v&&typeof v==='object'){
   if(Array.isArray(v.results)){sawResults=true; for(const r of v.results) if(r&&typeof r.migration_name==='string') results.push(r.migration_name);}
   Object.values(v).forEach(walk);
 }};
 walk(root);
 if(!sawResults || results.some(n=>!/^[0-9]{4}_.+\.sql$/.test(n)) || new Set(results).size!==results.length) throw Error('Unexpected or duplicate migration ledger rows');
 process.stdout.write(results.join('\n'));
} catch(e){console.error(e.message);process.exit(1)}
NODE
else
  : > "$RUN/history.txt"
fi

d1 --command "SELECT
 (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND substr(name,1,4) <> '_cf_' AND name <> 'd1_migrations') AS app_tables,
 (SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND substr(name,1,4) <> '_cf_') AS explicit_indexes,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_books') AS s15,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_bank_accounts') AS s16a,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_bank_feed_transactions') AS s16b,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_supplier_invoice_inbox') AS s17,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='jobs' AND instr(sql,'supplier_reference')>0) AS s18c,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='index' AND name='idx_jobs_supplier_reference_unique') AS s18i,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='jobhub_businesses') AS s19,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='bookkeeping_period_locks') AS s20,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='job_tasks') AS s21a,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='job_workflow_settings') AS s21b,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='job_scope_items') AS s21c;" > "$RUN/schema.json" ||
  fail 'Read-only schema inspection failed; no migration was run.'
SCHEMA_ROW="$(table_rows "$RUN/schema.json" app_tables)" || fail 'Schema inspection result was ambiguous; no migration was run.'
printf '%s\n' "$SCHEMA_ROW" > "$RUN/schema-row.json"

node - "$RUN/history.txt" "$RUN/schema-row.json" "$LEDGER_EXISTS" <<'NODE'
const fs=require('node:fs');
try {
 const hist=fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/).filter(Boolean);
 const s=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
 const ledger=process.argv[4]==='1';
 const files={'0015':'0015_bookkeeping_foundation.sql','0016':'0016_bank_reconciliation.sql','0017':'0017_supplier_invoice_inbox.sql','0018':'0018_job_supplier_references_and_billable_materials.sql','0019':'0019_business_identity_and_modules.sql','0020':'0020_accountant_controls.sql','0021':'0021_solar_operations_workflow.sql'};
 const versions=Object.keys(files);
 for(const n of hist) if(Number(n.slice(0,4))>=15 && Number(n.slice(0,4))<=21 && !Object.values(files).includes(n)) throw Error('Unexpected migration filename in the 0015–0021 range: '+n);
 const applied=Object.fromEntries(versions.map(v=>[v,hist.includes(files[v])]));
 const markers={
  '0015':Number(s.s15),
  '0016':Number(s.s16a)&&Number(s.s16b),
  '0017':Number(s.s17),
  '0018':Number(s.s18c)&&Number(s.s18i),
  '0019':Number(s.s19),
  '0020':Number(s.s20),
  '0021':Number(s.s21a)&&Number(s.s21b)&&Number(s.s21c)
 };
 let gap=false;
 for(const v of versions){
  if(applied[v]&&!markers[v]) throw Error(`Ledger says ${v} applied but its schema signature is absent`);
  if(!applied[v]&&markers[v]) throw Error(`Schema signature for ${v} exists without its migration ledger record`);
  if(gap&&applied[v]) throw Error(`Migration history is not contiguous before ${v}`);
  if(!applied[v]) gap=true;
 }
 if(!ledger && versions.some(v=>markers[v])) throw Error('Post-baseline schema exists without Wrangler migration history; refusing to guess');
 if(Number(s.s16a)!==Number(s.s16b)) throw Error('Partial 0016 schema signature without a reliable migration boundary');
 if(Number(s.s18c)!==Number(s.s18i)) throw Error('Partial 0018 schema signature without a reliable migration boundary');
 const m21=[s.s21a,s.s21b,s.s21c].map(Number); if(new Set(m21).size!==1) throw Error('Partial 0021 schema signature without a reliable migration boundary');
 if(!applied['0015'] && (Number(s.app_tables)!==18 || Number(s.explicit_indexes)!==10)) throw Error('Before 0015, staging must match the 18-table/10-index verified pre-0015 baseline');
 if(!ledger && Number(s.app_tables)!==18) throw Error('No migration ledger and schema is not the verified 18-table pre-0015 baseline');
 if(hist.some(n=>Number(n.slice(0,4))>21)) throw Error('Staging ledger contains a migration newer than this approved runner');
 const pending=versions.filter(v=>!applied[v]);
 console.log('Current migration ledger:', ledger?hist.join(', ')||'(empty)':'(not created yet)');
 console.log('Schema objects:',s.app_tables,'tables,',s.explicit_indexes,'explicit indexes');
 console.log('Pending ordered migrations:',pending.join(', ')||'(none)');
} catch(e){console.error('Staging history/schema mismatch:',e.message);process.exit(1)}
NODE
[[ $? -eq 0 ]] || fail 'Staging migration history and schema do not agree; stopped before writes.'

# Ask once, naming the exact files Wrangler may apply. Wrangler applies only
# files absent from its own ledger and records each successful migration.
PENDING="$(node - "$RUN/history.txt" <<'NODE'
const fs=require('node:fs');const h=fs.readFileSync(process.argv[2],'utf8').split(/\r?\n/);
const f={'0015':'0015_bookkeeping_foundation.sql','0016':'0016_bank_reconciliation.sql','0017':'0017_supplier_invoice_inbox.sql','0018':'0018_job_supplier_references_and_billable_materials.sql','0019':'0019_business_identity_and_modules.sql','0020':'0020_accountant_controls.sql','0021':'0021_solar_operations_workflow.sql'}; for(const v of Object.keys(f)) if(!h.includes(f[v])) console.log(v);
NODE
)"
if [[ -z "$PENDING" ]]; then
  printf '\nAll migration ledger entries 0015–0021 are present and schema signatures match. No write is needed.\n'
else
  printf '\nOnly these unapplied migrations can run, in order:\n%s\n' "$PENDING"
  confirm 'APPLY STAGING MIGRATIONS' 'Type APPLY STAGING MIGRATIONS to apply only the listed missing migrations to jobhub-staging: '
  printf '\nApplying pending staging migrations through Wrangler.\n'
  "${WRANGLER[@]}" d1 migrations apply "$DATABASE" --remote --config "$RUN/wrangler.toml"
fi

# Final read-only verification. A rerun starts from this ledger and schema, so a
# previous successful migration is never replayed blindly.
"${WRANGLER[@]}" d1 migrations list "$DATABASE" --remote --config "$RUN/wrangler.toml"
d1 --command "SELECT name AS migration_name FROM d1_migrations ORDER BY name;" > "$RUN/history-after.json" || fail 'Could not refresh migration history after apply.'
node - "$RUN/history-after.json" <<'NODE' > "$RUN/history-after.txt" || fail 'Post-apply migration history was ambiguous.'
const fs=require('node:fs');
try {
 const root=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 let results=[], sawResults=false;
 const walk=v=>{if(Array.isArray(v))return v.forEach(walk);if(v&&typeof v==='object'){
  if(Array.isArray(v.results)){sawResults=true;for(const r of v.results)if(r&&typeof r.migration_name==='string')results.push(r.migration_name)}
  Object.values(v).forEach(walk)
 }};
 walk(root);
 if(!sawResults||new Set(results).size!==results.length||results.some(n=>!/^[0-9]{4}_.+\.sql$/.test(n)))throw Error('Unexpected or duplicate rows');
 process.stdout.write(results.join('\n'));
} catch(e){console.error(e.message);process.exit(1)}
NODE
mv "$RUN/history-after.txt" "$RUN/history.txt"
d1 --command "SELECT
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='job_tasks') AS job_tasks,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='job_workflow_settings') AS workflow_settings,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='job_scope_items') AS scope_items,
 EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='jobs' AND instr(sql,'finance_approval_required')>0) AS job_columns;" > "$RUN/final.json" ||
  fail 'Final read-only schema verification failed.'
FINAL="$(table_rows "$RUN/final.json" job_tasks)" || fail 'Final schema result was ambiguous.'
node - "$RUN/final.json" "$RUN/history.txt" <<'NODE'
const fs=require('node:fs');
try {
 const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 const rows=[]; const walk=v=>{if(Array.isArray(v))return v.forEach(walk);if(v&&typeof v==='object'){if(Object.hasOwn(v,'job_tasks'))rows.push(v);Object.values(v).forEach(walk)}};
 walk(p); if(rows.length!==1||['job_tasks','workflow_settings','scope_items','job_columns'].some(k=>Number(rows[0][k])!==1)) throw Error('Post-0021 schema signature missing');
 const h=fs.readFileSync(process.argv[3],'utf8');
 const files={'0015':'0015_bookkeeping_foundation.sql','0016':'0016_bank_reconciliation.sql','0017':'0017_supplier_invoice_inbox.sql','0018':'0018_job_supplier_references_and_billable_materials.sql','0019':'0019_business_identity_and_modules.sql','0020':'0020_accountant_controls.sql','0021':'0021_solar_operations_workflow.sql'}; for(const v of Object.keys(files)) if(!h.split(/\r?\n/).includes(files[v])) throw Error(`Ledger missing ${v}`);
} catch(e){console.error(e.message);process.exit(1)}
NODE
[[ $? -eq 0 ]] || fail 'Post-0021 schema verification did not pass.'
printf '\nPASS: jobhub-staging has the 0021 Operations schema and migration ledger through 0021.\n'
printf 'No Pages, R2, production database, or production deployment command exists in this script.\n'
