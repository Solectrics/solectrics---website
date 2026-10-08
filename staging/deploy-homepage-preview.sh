#!/usr/bin/env bash
set -Eeuo pipefail
# Static homepage visual review only. No Functions, HEC API, migrations or R2 operations.
readonly BRANCH='codex/homepage-whole-home-staging'
readonly PROJECT='solectrics-jobhub-staging'
readonly DATABASE='jobhub-staging'
readonly DATABASE_UUID='717a0f5a-1527-4072-b3c8-f3a86e9d017e'
readonly BUCKET='jobhub-files-staging'
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'Run inside the Solectrics checkout.'
cd "$ROOT"
[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail "Branch must be exactly $BRANCH."
git diff --quiet HEAD -- . || fail 'Tracked files have local changes; stop for review.'
git fetch --quiet origin "$BRANCH" || fail 'Cannot verify the latest reviewed branch.'
[[ "$(git rev-parse HEAD)" == "$(git rev-parse FETCH_HEAD)" ]] || fail 'Checkout is behind. Run git pull --ff-only and retry.'
for config in wrangler.toml wrangler.json wrangler.jsonc; do
  [[ ! -e "$config" ]] || fail "Unexpected root configuration: $config."
done
if ! command -v npx >/dev/null 2>&1 && ! command -v npm >/dev/null 2>&1; then
  [[ -f "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]] || fail 'npm/npx unavailable. Nothing deployed.'
  set +u
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  set -u
fi
command -v node >/dev/null || fail 'Node unavailable.'
command -v python3 >/dev/null || fail 'Python 3.11+ required.'
python3 -c 'import tomllib' || fail 'Python 3.11+ required.'
[[ -z "${CLOUDFLARE_API_TOKEN:-}" && -z "${CLOUDFLARE_API_KEY:-}" && -z "${CF_API_TOKEN:-}" && -z "${CF_API_KEY:-}" ]] || fail 'Alternate API credentials are set. No alternate authentication will be used.'
if command -v npx >/dev/null 2>&1; then
  WRANGLER=(npx --yes wrangler@4.148.0)
elif command -v npm >/dev/null 2>&1; then
  WRANGLER=(npm exec --yes --package=wrangler@4.148.0 -- wrangler)
else
  fail 'npm/npx unavailable; no login attempted.'
fi
export CI=true WRANGLER_SEND_METRICS=false
RUN="$(mktemp -d "${TMPDIR:-/tmp}/homepage-staging-review.XXXXXX")"
trap 'rm -rf -- "$RUN"' EXIT
mkdir -p "$RUN/metadata" "$RUN/site/public" "$RUN/source"
# Account inventory is metadata only. No database SQL is executed.
"${WRANGLER[@]}" d1 list --json > "$RUN/list.json" || fail 'Existing Wrangler authentication failed; no login or alternate method attempted.'
python3 -I - "$RUN/list.json" "$RUN/identity.json" "$DATABASE_UUID" <<'PY'
import json, sys
from pathlib import Path
rows=json.loads(Path(sys.argv[1]).read_text())
assert isinstance(rows,list) and all(isinstance(r,dict) for r in rows), 'Invalid database inventory'
matches=[r for r in rows if r.get('name')=='jobhub-staging']
assert len(matches)==1, 'Expected exactly one jobhub-staging database'
assert matches[0].get('uuid')==sys.argv[3], 'Staging UUID does not match the approved UUID'
assert sum(r.get('uuid')==sys.argv[3] for r in rows)==1, 'Ambiguous staging UUID'
Path(sys.argv[2]).write_text(json.dumps({'name':'homepage-staging-identity','compatibility_date':'2026-10-05','d1_databases':[{'binding':'DB','database_name':'jobhub-staging','database_id':sys.argv[3]}]}))
PY
"${WRANGLER[@]}" d1 info "$DATABASE" --json --config "$RUN/identity.json" > "$RUN/info.json" || fail 'Staging identity lookup failed.'
python3 -I - "$RUN/info.json" "$DATABASE_UUID" <<'PY'
import json, sys
from pathlib import Path
d=json.loads(Path(sys.argv[1]).read_text())
assert isinstance(d,dict) and d.get('name')=='jobhub-staging' and d.get('uuid')==sys.argv[2], 'Staging name/UUID mismatch'
PY
(
  cd "$RUN/metadata"
  "${WRANGLER[@]}" pages download config "$PROJECT"
) || fail 'Staging Pages configuration lookup failed.'
python3 -I - "$RUN/metadata/wrangler.toml" "$DATABASE_UUID" <<'PY'
import sys, tomllib
from pathlib import Path
c=tomllib.loads(Path(sys.argv[1]).read_text())
assert c.get('name')=='solectrics-jobhub-staging', 'Wrong Pages project'
envs=c.get('env',{})
assert isinstance(envs,dict) and set(envs)<= {'production','preview'}, 'Unexpected environment'
for name in ('','production','preview'):
    e=c if not name else {**c,**envs.get(name,{})}
    d,r=e.get('d1_databases',[]),e.get('r2_buckets',[])
    assert len(d)==1 and d[0].get('binding')=='DB', 'Unexpected D1 bindings'
    assert d[0].get('database_name') in ('DB','jobhub-staging') and d[0].get('database_id')==sys.argv[2], 'Wrong DB identity'
    assert d[0].get('preview_database_id',sys.argv[2])==sys.argv[2], 'Wrong preview DB'
    assert len(r)==1 and r[0].get('binding')=='JOB_FILES' and r[0].get('bucket_name')=='jobhub-files-staging', 'Wrong bucket binding'
    assert r[0].get('preview_bucket_name','jobhub-files-staging')=='jobhub-files-staging', 'Wrong preview bucket'
    assert not any(e.get(k) for k in ('services','kv_namespaces','durable_objects','queues','ai','vectorize','hyperdrive','analytics_engine_datasets')), 'Unexpected resource binding'
print('PASS: staging project, database name/UUID and bucket bindings verified. No SQL or bucket operations ran.')
PY
node --test tests/*.test.mjs
git archive HEAD | tar -x -C "$RUN/source"
for path in index.html AE6ECD78-405A-46A3-B156-354A1CB82DA3.png EFEC3451-B808-452A-8EA2-64B22E36C363.png; do
  [[ -f "$RUN/source/$path" && ! -L "$RUN/source/$path" ]] || fail "Invalid preview input $path."
  cp -- "$RUN/source/$path" "$RUN/site/public/$path"
done
printf '<!doctype html><title>Homepage preview only</title><p>This preview is for homepage layout review only. <a href="/">Return to the homepage</a>.</p>\n' > "$RUN/site/public/404.html"
# Deliberately isolated static build: no Functions, redirect rules, Wrangler
# deployment config, secret updates or HEC endpoints are uploaded.
[[ ! -e "$RUN/site/functions" && ! -e "$RUN/site/public/_worker.js" ]] || fail 'Unexpected executable build input.'
printf '\nTarget: %s — homepage-only branch preview. Production and the current staging app stay unchanged.\n' "$PROJECT"
printf 'Type DEPLOY STAGING to upload this preview, or press Enter to stop: '
read -r confirmation || fail 'No confirmation received.'
[[ "$confirmation" == 'DEPLOY STAGING' ]] || fail 'Deployment cancelled.'
(
  cd "$RUN/site"
  "${WRANGLER[@]}" pages deploy public --project-name "$PROJECT" --branch "$BRANCH" --commit-hash "$(git -C "$ROOT" rev-parse HEAD)" --commit-message 'Approved mobile hero staging visual review'
) || fail 'Staging preview deployment failed; no retries or resource changes attempted.'
printf '\nHomepage preview uploaded. Open only the staging URL printed above for visual review.\n'
printf 'No production deployment, SQL, migrations, R2 operations, HEC submission or email calls ran.\n'
