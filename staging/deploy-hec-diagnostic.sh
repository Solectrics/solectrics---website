#!/usr/bin/env bash
set -Eeuo pipefail
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
cd /workspaces/solectrics---website
git diff --quiet HEAD -- . || fail 'Tracked checkout has changes; nothing deployed.'
git fetch origin codex/hec-customer-copy-branding-staging
[[ "$(git rev-parse FETCH_HEAD)" == d362d6eebcaefbbfdd234ce52abf478aff80e037 ]] || fail 'Branch changed; stop for review.'
[[ -f /tmp/hec-branding-pages-build/wrangler.toml ]] || fail 'Previous deployment config is unavailable; stop for review.'
if ! command -v npx >/dev/null; then
  [[ -f "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]] || fail 'npx unavailable.'
  set +u
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  set -u
fi
command -v npx >/dev/null || fail 'npx still unavailable; no authentication attempted.'
[[ -z "${CLOUDFLARE_API_TOKEN:-}" && -z "${CLOUDFLARE_API_KEY:-}" && -z "${CF_API_TOKEN:-}" && -z "${CF_API_KEY:-}" ]] || fail 'Alternate API credentials are set; stop without using them.'
export CI=true WRANGLER_SEND_METRICS=false
run_dir="$(mktemp -d /tmp/hec-diagnostic-deploy.XXXXXX)"
trap 'rm -rf -- "$run_dir"' EXIT
mkdir "$run_dir/source" "$run_dir/site" "$run_dir/site/public"
cp /tmp/hec-branding-pages-build/wrangler.toml "$run_dir/site/wrangler.toml"
python3 -I - "$run_dir/site/wrangler.toml" <<'PY'
import sys, tomllib
from pathlib import Path
c = tomllib.loads(Path(sys.argv[1]).read_text())
assert c.get("name") == "solectrics-jobhub-staging", "Wrong Pages project"
assert c.get("pages_build_output_dir") == "public", "Unexpected output directory"
assert set(c.get("env", {})) <= {"production", "preview"}, "Unexpected environment"
for key in ("", "production", "preview"):
    e = c if not key else {**c, **c.get("env", {}).get(key, {})}
    d, r = e.get("d1_databases", []), e.get("r2_buckets", [])
    assert len(d) == 1 and d[0].get("binding") == "DB", "Unexpected D1 bindings"
    assert d[0].get("database_id") == "717a0f5a-1527-4072-b3c8-f3a86e9d017e", "Wrong D1 UUID"
    assert d[0].get("database_name") in ("DB", "jobhub-staging"), "Wrong D1 name"
    assert d[0].get("preview_database_id", d[0]["database_id"]) == d[0]["database_id"], "Wrong preview UUID"
    assert len(r) == 1 and r[0].get("binding") == "JOB_FILES" and r[0].get("bucket_name") == "jobhub-files-staging", "Wrong R2 binding"
    assert r[0].get("preview_bucket_name", r[0]["bucket_name"]) == r[0]["bucket_name"], "Wrong preview bucket"
    assert not any(e.get(k) for k in ("services", "kv_namespaces", "durable_objects", "queues", "ai", "vectorize", "hyperdrive", "analytics_engine_datasets")), "Unexpected bindings"
print("PASS: saved config targets staging only; flag values are unchanged.")
PY
npx --yes wrangler@4.148.0 d1 info jobhub-staging --json --config "$run_dir/site/wrangler.toml" > "$run_dir/info.json"
python3 -I - "$run_dir/info.json" <<'PY'
import json, sys
from pathlib import Path
d = json.loads(Path(sys.argv[1]).read_text())
assert d.get("name") == "jobhub-staging", "D1 name mismatch"
assert d.get("uuid") == "717a0f5a-1527-4072-b3c8-f3a86e9d017e", "D1 UUID mismatch"
print("PASS: jobhub-staging name and UUID independently verified.")
PY
git archive d362d6eebcaefbbfdd234ce52abf478aff80e037 | tar -x -C "$run_dir/source"
(
  cd "$run_dir/source"
  node --test tests/hec-preview-host.test.mjs tests/hec-customer-copy.test.mjs
  node --check functions/_middleware.js
)
cp -R "$run_dir/source/functions" "$run_dir/site/functions"
while IFS= read -r -d '' path; do
  case "$path" in
    assets/*) ;;
    */*) continue ;;
    *.html|*.png|*.jpg|*.jpeg|*.svg|*.webp|*.gif|*.ico|*.css|*.js|_headers|_redirects|_routes.json) ;;
    *) continue ;;
  esac
  [[ -f "$run_dir/source/$path" && ! -L "$run_dir/source/$path" ]] || fail 'Unexpected build input.'
  mkdir -p "$(dirname "$run_dir/site/public/$path")"
  cp "$run_dir/source/$path" "$run_dir/site/public/$path"
done < <(git ls-tree -r --name-only -z d362d6eebcaefbbfdd234ce52abf478aff80e037)
[[ -f "$run_dir/site/public/home-energy-check.html" ]] || fail 'HEC missing from build.'
(
  cd "$run_dir/site"
  npx --yes wrangler@4.148.0 pages deploy public --project-name solectrics-jobhub-staging --branch codex/hec-customer-copy-branding-staging --commit-hash d362d6eebcaefbbfdd234ce52abf478aff80e037
)
printf '\nDiagnostic deployment finished. No migrations or email calls ran.\n'
