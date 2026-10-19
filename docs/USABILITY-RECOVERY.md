# Recovered Job Hub — local candidate

## Completed

- Mobile menu/bottom navigation, expandable job sections, shortcuts and job search/type/status filters.
- Operations task list, month calendar, assignees, milestones, blockers, installation readiness and scheduling/rescheduling review.
- Shared job/Operations tasks; accepted quotations seed workflow tasks without changing issued option snapshots.
- Handover checklist and actual date; transactional, unique 14-day and one-calendar-month follow-up tasks; contact notes, issues and date corrections. Completed contacts retain their history.
- Retrospective editor for all original HEC question keys/options, including conditional cylinder/EV answers, plus meter/supply and annual-use fields. Consent/copy flags remain original customer evidence and cannot be rewritten by the staff editor.
- Manual summer/winter and additional bills; later bill/annual usage uploads; reviewed extraction and manual fallback. Additional periods remain attached evidence, not a new multi-period forecasting algorithm.
- Existing linked enquiry/job updated in place with original answers, before/after/reason history, server-defined synthetic actor and atomic revision checks. Unknown legacy fields and hidden conditional answers survive.
- HEC display/shared identity refresh; stale energy forecasts require review; old design approval is not presented as current after HEC changes. Explicit design review records the current HEC revision, and stale certification is rejected locally.
- Original quotations/invoices, Fletcher template/PDF/package behavior, required OpenSolar layout, optional SLD, attachments and solar/general electrical workflows retained.

## Run locally

Requires Node 24+ (built-in SQLite), Python with Playwright, and Chromium for the browser tests.

1. Run `node dev/synthetic-server.mjs` from the repository root.
2. Open `http://localhost:8765/mini-fergus`.
3. Use only the seeded Synthetic Alpha solar job (9101) and Synthetic Beta general job (9102). There is no real customer connection. All data and files are in memory and disappear when the server stops.
4. Run `node --test --test-isolation=none --test-concurrency=1 tests/*.test.mjs` for regression coverage.
5. On a fresh synthetic server, run `python3 tests/browser-usability.py` for browser acceptance. The current harness uses `/usr/bin/chromium`; adjust the executable path for another local installation.

The server binds loopback only, passes no production credentials, blocks server-side external fetch, and the browser suite blocks all non-loopback requests. Email/AI are never contacted. Reader failure is deliberate in the browser flow; extraction behavior is tested separately with mocked responses. No migration files are executed. Desired synthetic schemas use independent CREATE TABLE fixtures.

## Validation

- 138 individual synthetic regression tests passed with zero failures.
- Chromium at 375, 390, 430 and 1440px: dashboard filtering, job layout, Operations calendar, general electrical visibility, no horizontal overflow and no page errors.
- 375px actual UI round trip: edit HEC and conditional answers, manually enter a winter bill, upload a later bill, handle missing extraction with manual fallback, repeat handover save and verify exactly two calendar-correct follow-ups.
- 1440px concurrent tabs: obsolete HEC save rejected; unsaved inputs remain intact.
- Source/inline-script syntax, tracked diff whitespace and source-only credential checks completed before checkpoint.
- This is local Chromium acceptance, not actual iPhone Safari, live AI extraction or staging acceptance.

## Database plan — prepared, not executed

Only `0021_solar_operations_workflow.sql` and `0022_handover_aftercare.sql` are new in the runtime source. No accounting, banking or business migrations are imported.
The supplied pre-0015 schema-only export already includes next-action/assignment, finance/deposit, retailer/ICP/meter, installation and compliance fields used by Operations. The former accounting prerequisite comment was removed after comparing that schema and selected SQL.

Before any authorised execution, compare the actual isolated staging schema and migration ledger with the prepared delta. Existing 0021/0022 columns/tables must not be blindly replayed. If prerequisites differ, prepare and review a targeted compatibility delta first. Never replace or reset customer/job tables. No HEC table migration is needed; HEC updates use the existing enquiry JSON.

## Backup and release boundaries

Only `codex/jobhub-usability-recovery-backup` is used for remote checkpoints. Owner-verified exclusions on both live/staging Pages projects and disabled security-project automatic builds are the agreed safety basis. GitHub workflow evidence is rechecked before each update. GitHub checkpoints use expected-head checks and remote SHA/tree verification. Immutable donor source remains under snapshots/ with the original manifest.

The new HEC and Operations handlers are intentionally restricted to loopback plus `JOBHUB_USABILITY_LOCAL_ONLY=true`. Actor attribution is explicitly local/synthetic, not verified Jane/Tom identity. Legacy bill/privacy staging allowances remain donor behavior and do not enable this candidate on the backup hostname.
Security candidate f42de493 and its branch remain separate and unchanged. No real records, job 17, migrations, Cloudflare configuration or deployments were accessed/executed by this work.

## Before Jane/Tom staging acceptance

1. Prepare/review staging-only runtime enablement and compatibility with verified staff authentication/parent-job/document authorisation. No security branch merge is implied.
2. Read-only verify exact Access coverage, staging D1/R2 identities, bindings and migration ledger. Use an isolated synthetic dataset only.
3. Obtain explicit approval for the concrete staging candidate SHA, named staging resources and reviewed additive migration delta before any migration/deployment action. Neither is authorised by local-development approval.
4. Run Jane/Tom synthetic acceptance, actual iPhone Safari checks and file/package preview cancellation. No supplier email or production release is implied.

Cloudflare deployment observation is unavailable in this workspace. Empty GitHub runs/checks/statuses do not prove the absence of a Cloudflare deployment.
