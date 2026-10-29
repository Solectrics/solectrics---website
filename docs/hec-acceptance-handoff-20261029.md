# HEC final acceptance handoff — 29 October 2026

Decision: **NO-GO for production** pending the remaining acceptance evidence below.
The isolated release branch is `release/hec-seasonal-bills-isolated-20261029`.
The commit containing this document is the acceptance candidate; obtain its full revision with `git rev-parse HEAD`.

## What can be tested now without credentials

Use an isolated checkout of this release, never change the active Codespace development checkout:

```bash
git fetch origin release/hec-seasonal-bills-isolated-20261029
git worktree add --detach /tmp/hec-final-acceptance origin/release/hec-seasonal-bills-isolated-20261029
cd /tmp/hec-final-acceptance
node --test --test-isolation=none --test-concurrency=1 tests/*.test.mjs
node tests/acceptance/run-http.mjs
```

Requires Node 24 (node:sqlite) and Poppler `pdftotext` for the synthetic PDF tests. No npm production dependency or production credentials are needed.
100 automated tests passed here. The additional real loopback HTTP acceptance check passed: both fictional PDF uploads, email-only without enquiries/jobs, review enquiry, distinct site-visit follow-up, recipient throttling, failed upload rollback and optional bills. Email, extraction and Turnstile responses are simulated; SQLite and R2-compatible storage are in memory and discarded on restart. No real emails leave this harness.

For interactive review, start `node tests/acceptance/server.mjs`, then open `http://localhost:8766/home-energy-check.html`. In the existing Codespace forward port 8766 **privately** and open its browser URL. Do not make the forwarded port public. Use only `acceptance@example.invalid` and the two PDFs under `tests/fixtures/hec-pdfs/`. This harness exposes synthetic debugging endpoints and must never be deployed.

On a machine with Python Playwright and its Chromium installed, run `python tests/acceptance/browser-check.py` while the harness runs. The prepared script checks rendered results/actions at 390×844 and 1440×1000 and saves local screenshots under `/tmp/hec-acceptance-screenshots`. It still requires an actual run and visual inspection. Manually traverse every household question as well, including changing answers, no bills, one unreadable bill, retry after upload failure and all three choices.

## Browser investigation

Local Chromium cannot create its process-singleton socket: `Operation not permitted`. The independent Cloud Browser cannot start because its runtime cannot create its session file on a read-only filesystem. No Firefox or WebKit executable is installed. No security controls were changed to work around these restrictions. Loopback HTTP tests are an available alternative for backend acceptance, not proof of desktop/mobile layout. Browser acceptance remains blocked in this workspace.

## Exactly what is needed for external acceptance

**Do not paste secret values into chat, GitHub, screenshots or source files.** Configure them in the isolated environment's secret settings or existing secure local environment.

| Item | Purpose / instruction |
|---|---|
| `OPENAI_API_KEY` | A nonproduction OpenAI project key with Responses/PDF access and access to the source-configured `gpt-5.6` model. Set a small project budget. Run `node tests/hec-provider-check.mjs` with the key supplied securely. The script sends only committed fictional PDFs. If model access fails, report the error category; do not substitute a model silently. |
| `RESEND_API_KEY` | A nonproduction sending-only key permitted to send from the verified `solectrics.co.nz` domain. Keep sender `Jane at Solectrics <jane@solectrics.co.nz>`. Confirm tracking settings. |
| Approved test recipient | Provide the address you own that may receive test results. No customer email addresses. Real sending is not enabled in the local harness. |
| `HEC_TURNSTILE_SITE_KEY` | Public site key from an isolated Turnstile widget restricted to the acceptance hostname. Test keys can exercise integration; a genuine nonproduction widget is needed to verify anti-abuse behaviour. |
| `HEC_TURNSTILE_SECRET` | Secret for that same widget. Keep it in secret settings. Tokens must return action `hec-email` and the exact requesting hostname. |
| `HEC_EMAIL_GUARD` | Pages service binding to the isolated guard Worker. Template: `services/hec-email-guard/wrangler.example.jsonc`. Allocate three unique rate-limit namespace IDs, replace placeholders, retain `workers_dev:false`, `preview_urls:false` and no public routes. Suggested limits: 5/IP/min, 1/recipient/min, 50 overall/min. |
| Acceptance hostname | Must be separate from the live website and support the Turnstile widget. Current production middleware redirects `*.pages.dev` GET requests to live and rejects POSTs: **do not use a Pages preview URL for submission tests**. Use local harness now; any hosted acceptance deployment needs explicit approval and its own controlled hostname/configuration. |
| Test storage, only if hosted acceptance is approved | `DB` and `JOB_FILES` must reference dedicated nonproduction resources containing fictional data only. Do not reuse production D1/R2. Existing shared Job Hub staging may contain ongoing work: do not reset/rebind it. Local harness needs no Cloudflare storage. |

No cloud resource, widget, guard or hosted acceptance deployment was created. Live provider/browser/email checks remain pending. Approximate rate limits are per Cloudflare location; they are not a strict worldwide sending budget. The guard's deployment/configuration must be accepted before the protected email feature can work (missing guard returns 503).

## Read-only production configuration checklist

Authenticated Cloudflare access is still unavailable from this workspace. Existing user-supplied production information is retained, not misrepresented as a fresh API audit:
- Pages `solectrics---website`, production branch `main`.
- Production source `ff025fee70f3732c575a7d2475d6a2d2e8a98fce`.
- Deployment `f86b0cbe-4bf9-4e40-a8d5-62b1633ccf13`.
- `DB` → `soletrics-enquiries`, UUID `d8352482-040b-4ae5-a518-7c1f52f860d9`.
- `JOB_FILES` → `solectrics-job-files`.

In Cloudflare, open Workers & Pages → solectrics---website → Settings. Select **Production** and capture only:
1. Build command, root directory, output directory, production branch and deployment controls.
2. Binding names/targets and secret **names/presence**, never values. Confirm whether the new HEC guard/Turnstile entries exist (not assumed).
3. Current production deployment details and availability of the rollback candidate.

For schema-only evidence, open the specified production D1 database and run the three PRAGMA statements in `tests/acceptance/schema-readonly.sql`. They expose column metadata, not customer records. Required fields:
- enquiries: id, enquiry_ref, created_at, customer_name, email, phone, address, answers_json.
- jobs: id, enquiry_id, job_status, next_action, job_type.
- job_files: id, job_id, storage_key, original_name, content_type, size_bytes, category, caption, document_role, energy_data_detail, uploaded_at.

No new application database migration is introduced. The inherited schema helper can add missing baseline columns at runtime: confirm those columns exist before approving production. Do not run migration SQL as part of this read-only check.

## Build packaging and safe GitHub push

Current dashboard build settings remain unverified. `scripts/package-hec.py` prepares only tracked public HTML/images/assets into a fresh output directory. Pages must compile repository-root `functions/` separately. Never put functions source, tests, docs, SQL, services, credentials or Git metadata into the static output. A possible configuration is root repository, build `python3 scripts/package-hec.py`, output `dist`; this is a proposed configuration, not a claim about existing settings, and has not been applied.

The release push uses a new HEAD with `[CF-Pages-Skip]` as a prefix (plus `[skip ci]`). Cloudflare documents that prefix as omitting the deployment. No GitHub Actions workflows are present in this release or the inspected main tree. Only this branch is pushed, with no force update. Recheck the resulting commit's checks/status; absence of a check is expected for a skipped Pages build, but is not an authenticated account-wide deployment audit. No build hook is called.

Reference: https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/

## Go / no-go and rollback procedure

**NO-GO** until: browser layouts/journeys pass; real fictional-PDF extraction passes; approved-inbox delivery and genuine Turnstile/rate-limit integration pass; production schema/build/bindings and rollback candidate are reconfirmed; static output and Functions build are verified. Financial forecasts remain disabled independently of these deployment gates.

After separate explicit production approval only:
1. Record the exact approved candidate, current production deployment/source and configuration. Ensure the live baseline has not moved.
2. Retain the existing known-good deployment `f86b0cbe-4bf9-4e40-a8d5-62b1633ccf13` at `ff025fe`; verify Cloudflare still offers it as an eligible rollback target. Do not delete it.
3. If an approved release fails, request explicit rollback authorisation. In that Pages project's deployment history select the recorded known-good production deployment and use Cloudflare's rollback action. Verify the custom domain and non-customer smoke checks afterward.
4. A Pages rollback changes code/assets, not D1/R2 records, secrets, service bindings or guard configuration. Preserve all enquiries and bill objects created in the meantime. Do not restore databases, delete new records or remove bucket objects. Investigate any inconsistent new submission separately with authorisation.
5. Reconcile Git main with the intended live revision separately; do not force-reset or overwrite ongoing branches. A later automatic deploy could otherwise replace the rollback.

Rollback has NOT been initiated, and no deployment authorisation is inferred from this handoff.
