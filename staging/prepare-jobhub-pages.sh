#!/usr/bin/env bash
set -Eeuo pipefail

# Local preparation only. No Wrangler/Cloudflare, deployment, or migration calls.
readonly EXPECTED_BRANCH='codex/jobhub-staging-migrations-0015-0018'
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'Run from the Job Hub Git checkout.'
cd "$ROOT"
[[ "$(git branch --show-current)" == "$EXPECTED_BRANCH" ]] || fail "Checkout must be exactly $EXPECTED_BRANCH."
git diff --quiet HEAD -- . || fail 'Tracked files have local changes; commit/review them before preparing a deployment.'
for config in wrangler.toml wrangler.json wrangler.jsonc; do
  [[ ! -e "$config" ]] || fail "Found $config. Review its target before preparing a Pages deployment."
done
command -v node >/dev/null || fail 'Node is unavailable.'

node --test tests/*.test.mjs
while IFS= read -r -d '' source; do
  [[ ! -L "$source" ]] || fail "Refusing symlink $source."
  node --input-type=module --check < "$source"
done < <(git ls-files -z -- 'functions/*.js' 'functions/**/*.js')

OUT="$ROOT/staging/pages-output"
[[ ! -e "$OUT" && ! -L "$OUT" ]] || fail 'staging/pages-output already exists. Keep it for review; do not overwrite it blindly.'
BUILD="$(mktemp -d "$ROOT/staging/.pages-build.XXXXXX")"
cleanup() { [[ -z "${BUILD:-}" ]] || rm -rf -- "$BUILD"; }
trap cleanup EXIT
count=0
while IFS= read -r -d '' path; do
  # Explicitly allow only tracked static web resources. No repository-root upload.
  case "$path" in
    assets/*) ;;
    */*) continue ;;
    *.html|*.png|*.jpg|*.jpeg|*.svg|*.webp|*.gif|*.ico|*.css|*.js|_headers|_redirects|_routes.json) ;;
    *) continue ;;
  esac
  [[ -f "$path" && ! -L "$path" ]] || fail "Refusing missing/non-regular static resource $path."
  mkdir -p -- "$BUILD/$(dirname "$path")"
  cp -- "$path" "$BUILD/$path"
  count=$((count + 1))
done < <(git ls-files -z)
for required in mini-fergus.html mini-fergus-job.html mini-fergus-supplier-invoices.html; do
  [[ -f "$BUILD/$required" ]] || fail "Missing Job Hub page $required."
done
# This is a Functions project; root Functions source is compiled separately by
# Pages/Wrangler and must not be served as static source in the upload directory.
[[ -f functions/_middleware.js && -f functions/api/supplier-invoice-inbox.js ]] || fail 'Required Pages Functions are missing.'
mv -- "$BUILD" "$OUT"
BUILD=''
printf '\nPREPARED ONLY: %s static files in staging/pages-output from commit %s.\n' "$count" "$(git rev-parse --short=12 HEAD)"
printf 'Functions remain in the repository-root functions/ directory for Pages compilation.\n'
printf 'No Cloudflare commands, migrations, or deployments were run.\n'
printf 'Review staging/PAGES-DEPLOYMENT.md before any deployment.\n'
