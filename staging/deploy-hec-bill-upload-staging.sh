#!/usr/bin/env bash
# Deploy only the HEC copy/layout change on the existing working staging app.
# This helper is outside the application snapshot uploaded to Cloudflare.
set -Eeuo pipefail
readonly BASE='020350dcda5c006bfdb016343472dcd9992e6fb1'
readonly SOURCE='5357b9268a3fae3fa2feca52df84e6b6b8faaa3d'
readonly PROJECT='solectrics-jobhub-staging'
readonly PREVIEW_BRANCH='codex/jobhub-solar-operations-workflow'
readonly STAGING_UUID='717a0f5a-1527-4072-b3c8-f3a86e9d017e'
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
ROOT="$(git rev-parse --show-toplevel)" || fail 'Run from the existing Codespaces repository.'
cd "$ROOT"
git cat-file -e "$SOURCE^{commit}" || fail 'Fetch the isolated staging release first.'
[[ "$(git diff --name-only "$BASE" "$SOURCE")" == 'home-energy-check.html' ]] || fail 'Release contains unrelated application changes.'
[[ "$(git rev-parse "$SOURCE:home-energy-check.html")" == '8bca42212d3b42a0d4e83fb19cab2265b85c649c' ]] || fail 'HEC release content differs from the verified edit.'
command -v node >/dev/null || fail 'Node is unavailable.'
command -v npx >/dev/null || fail 'npx is unavailable.'
python3 -c 'import tomllib' || fail 'Python 3.11+ is required.'
export CI=true WRANGLER_SEND_METRICS=false
export CLOUDFLARE_ACCOUNT_ID='f18794d67b0bddb52b51da7817f400fd'
WRANGLER=(npx --yes --package=wrangler@4.148.0 -- wrangler)
RUN="$(mktemp -d /tmp/hec-bill-staging-release.XXXXXX)"
mkdir -p "$RUN/source" "$RUN/metadata" "$RUN/site/public"
git archive "$SOURCE" | tar -x -C "$RUN/source"
CHECK="$RUN/source/staging/check-pages-staging.py"
# Read-only deployment metadata: stop if another release changed this preview.
(
  cd "$RUN/metadata"
  "${WRANGLER[@]}" pages deployment list --project-name "$PROJECT" --environment preview --json > "$RUN/deployments.json"
)
python3 -c 'import json,re,sys; rows=json.load(open(sys.argv[1])); good=[r for r in rows if r.get("Branch")=="codex/jobhub-solar-operations-workflow" and re.search(r"ago|just now|success",str(r.get("Status","")),re.I)]; assert good and good[0].get("Id")=="98cd6e5d-5879-4c85-8fe2-c690e678c598", "STOP: working staging preview changed; recheck before deploying"' "$RUN/deployments.json"
# Read-only staging identity checks. No database SQL or R2 operations.
(
  cd "$RUN/metadata"
  "${WRANGLER[@]}" d1 list --json > "$RUN/databases.json"
)
DATABASE_ID="$(python3 "$CHECK" identity "$RUN/databases.json")"
[[ "$DATABASE_ID" == "$STAGING_UUID" ]] || fail 'Unexpected staging UUID.'
node -e 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify({name:"hec-staging-identity",compatibility_date:"2026-10-05",d1_databases:[{binding:"DB",database_name:"jobhub-staging",database_id:process.argv[2]}]}))' "$RUN/identity.json" "$DATABASE_ID"
"${WRANGLER[@]}" d1 info jobhub-staging --json --config "$RUN/identity.json" > "$RUN/info.json"
python3 "$CHECK" info "$RUN/info.json" "$DATABASE_ID"
(
  cd "$RUN/metadata"
  "${WRANGLER[@]}" pages download config "$PROJECT"
)
# Validate the staging project's settings, then its actual Preview bindings.
python3 "$CHECK" pages "$RUN/metadata/wrangler.toml" "$DATABASE_ID" "$RUN/validated-settings.json"
python3 -c 'import json,runpy,sys,tomllib; check=runpy.run_path(sys.argv[1]); config=tomllib.load(open(sys.argv[2],"rb")); config.pop("env",None); result=check["pages"](config,sys.argv[3]); open(sys.argv[4],"w").write(json.dumps(result,indent=2)+"\n")' "$CHECK" "$RUN/metadata/wrangler.toml" "$DATABASE_ID" "$RUN/site/wrangler.json"
# Existing required checks run only against the isolated application snapshot.
(
  cd "$RUN/source"
  node --test tests/*.test.mjs
)
while IFS= read -r -d '' path; do
  input="$RUN/source/$path"
  [[ -f "$input" && ! -L "$input" ]] || fail "Non-regular tracked input: $path"
  case "$path" in
    functions/*.js)
      node --input-type=module --check < "$input"
      target="$RUN/site/$path" ;;
    assets/*) target="$RUN/site/public/$path" ;;
    */*) continue ;;
    *.html|*.png|*.jpg|*.jpeg|*.svg|*.webp|*.gif|*.ico|*.css|*.js|_headers|_redirects|_routes.json)
      target="$RUN/site/public/$path" ;;
    *) continue ;;
  esac
  mkdir -p "$(dirname "$target")"
  cp "$input" "$target"
done < <(git ls-tree -r --name-only -z "$SOURCE")
[[ -f "$RUN/site/functions/_middleware.js" && -f "$RUN/site/public/home-energy-check.html" ]] || fail 'Incomplete isolated build.'
printf '\nVerified: existing staging app plus HEC bill copy/layout only.\nProject: %s\nPreview branch: %s\nSource: %s\nDB: jobhub-staging (%s)\n' "$PROJECT" "$PREVIEW_BRANCH" "$SOURCE" "$STAGING_UUID"
(
  cd "$RUN/site"
  "${WRANGLER[@]}" pages deploy public --project-name "$PROJECT" --branch "$PREVIEW_BRANCH" --commit-hash "$SOURCE"
)
printf '\nStaging upload completed. Confirm the preview URL and Cloudflare Access, then check the bill section.\nNo database migrations, HEC submissions, production deployments, or application configuration edits were run.\n'
