#!/usr/bin/env bash
set -Eeuo pipefail
readonly PROJECT='solectrics-jobhub-staging'
readonly DATABASE='jobhub-staging'
readonly BUCKET='jobhub-files-staging'
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'Run from the Job Hub checkout.'
cd "$ROOT"
BRANCH="$(git branch --show-current)"
case "$BRANCH" in
  codex/jobhub-staging-migrations-0015-0018|codex/jobhub-solar-operations-workflow) ;;
  *) fail "Branch $BRANCH is not an explicitly approved staging branch." ;;
esac
git diff --quiet HEAD -- . || fail 'Tracked files have local changes. Review them; do not discard them.'
git fetch --quiet origin "$BRANCH" || fail 'Cannot confirm latest branch.'
[[ "$(git rev-parse HEAD)" == "$(git rev-parse FETCH_HEAD)" ]] || fail 'Checkout is behind. Run git pull --ff-only first.'
for config in wrangler.toml wrangler.json wrangler.jsonc; do
  [[ ! -e "$config" ]] || fail "Unexpected root config $config; no Cloudflare action was run."
done
# NVM may be installed but not initialized after a Codespace restart.
if ! command -v npm >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  if [[ -f "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    set +u
    source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    set -u
  fi
fi
command -v node >/dev/null || fail 'Node is unavailable.'
command -v python3 >/dev/null || fail 'Python 3.11+ is required for safe TOML parsing.'
python3 -c 'import tomllib' || fail 'Python 3.11+ is required; no Cloudflare action was run.'
if command -v npx >/dev/null 2>&1; then
  WRANGLER=(npx --yes --package=wrangler -- wrangler)
elif command -v npm >/dev/null 2>&1; then
  WRANGLER=(npm exec --yes --package=wrangler -- wrangler)
else
  fail 'Node is present but npm/npx are unavailable. No authentication or deployment was attempted.'
fi
# No automatic login, tokens, alternate credentials, or auth-profile switching.
export CI=true
export WRANGLER_SEND_METRICS=false
RUN="$(mktemp -d "${TMPDIR:-/tmp}/jobhub-staging-deploy.XXXXXX")"
cleanup() { rm -rf -- "$RUN"; }
trap cleanup EXIT
mkdir -p "$RUN/metadata" "$RUN/site/public"
CHECK="$ROOT/staging/check-pages-staging.py"

# Read-only staging identity checks; list is account metadata, not database SQL.
"${WRANGLER[@]}" d1 list --json > "$RUN/list.json" || fail 'Wrangler authentication/metadata lookup failed. No alternate authentication was attempted.'
DATABASE_ID="$(python3 "$CHECK" identity "$RUN/list.json")" || fail 'Staging database identity is not unambiguous.'
node - "$RUN/d1.json" "$DATABASE_ID" <<'NODE'
const fs=require('node:fs');
fs.writeFileSync(process.argv[2],JSON.stringify({
 name:'jobhub-staging-identity-check',compatibility_date:'2026-10-05',
 d1_databases:[{binding:'DB',database_name:'jobhub-staging',database_id:process.argv[3]}]
}));
NODE
"${WRANGLER[@]}" d1 info "$DATABASE" --json --config "$RUN/d1.json" > "$RUN/info.json" || fail 'Staging D1 identity lookup failed; nothing was deployed.'
python3 "$CHECK" info "$RUN/info.json" "$DATABASE_ID" || fail 'Staging D1 UUID/name mismatch.'

# GET only the explicitly named staging Pages project; save metadata in /tmp.
(
 cd "$RUN/metadata"
 "${WRANGLER[@]}" pages download config "$PROJECT"
) || fail 'Staging Pages configuration could not be read; nothing was deployed.'
[[ -f "$RUN/metadata/wrangler.toml" ]] || fail 'Expected staging TOML configuration was not returned.'
python3 "$CHECK" pages "$RUN/metadata/wrangler.toml" "$DATABASE_ID" "$RUN/site/wrangler.json" || fail 'Staging Pages bindings/settings do not pass validation.'

# Fresh build from HEAD; do not blindly deploy a stale pages-output folder.
node --test tests/*.test.mjs
while IFS= read -r -d '' path; do
  [[ -f "$path" && ! -L "$path" ]] || fail "Non-regular tracked input $path."
  case "$path" in
    functions/*.js)
      node --input-type=module --check < "$path"
      target="$RUN/site/$path" ;;
    assets/*) target="$RUN/site/public/$path" ;;
    */*) continue ;;
    *.html|*.png|*.jpg|*.jpeg|*.svg|*.webp|*.gif|*.ico|*.css|*.js|_headers|_redirects|_routes.json)
      target="$RUN/site/public/$path" ;;
    *) continue ;;
  esac
  mkdir -p -- "$(dirname "$target")"
  cp -- "$path" "$target"
done < <(git ls-files -z)
[[ -f "$RUN/site/functions/_middleware.js" && -f "$RUN/site/public/mini-fergus.html" ]] || fail 'Staging build is incomplete.'

printf '\nVerified deployment target: %s\nDB: %s (UUID verified)\nJOB_FILES: %s\n' "$PROJECT" "$DATABASE" "$BUCKET"
printf 'Tests and syntax checks passed. No migration or database/bucket write command has run.\n'
printf 'Type DEPLOY STAGING to upload the application, or press Enter to stop: '
read -r confirmation || fail 'No deployment confirmation.'
[[ "$confirmation" == 'DEPLOY STAGING' ]] || fail 'Deployment cancelled.'
(
 # Pages reads the isolated site/wrangler.json from this working directory.
 # Pages rejects --config; never run this command from the repository root.
 cd "$RUN/site"
 "${WRANGLER[@]}" pages deploy public --project-name "$PROJECT" --branch "$BRANCH" --commit-hash "$(git -C "$ROOT" rev-parse HEAD)"
) || fail 'Staging deployment failed. Do not rerun migrations or change database resources.'
printf '\nDeployment command completed. Test only the Access-protected URL:\n'
printf 'https://solectrics-jobhub-staging.pages.dev/mini-fergus\n'
printf 'No D1 migrations, database resets, R2 object operations, email-worker deployment, or Hnry/Zapier changes were run.\n'
