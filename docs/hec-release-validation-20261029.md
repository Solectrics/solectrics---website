# Isolated HEC validation — 29 October 2026

Status: development ready for review, NOT cleared for production. No deployment, push, merge, production record access, configuration change or rollback performed.

## Source and scope

Branch: `release/hec-seasonal-bills-isolated-20261029`.
Starting revision: `ee6a32915bf775c636c0e099bf7dc33c57324587`.
Production ancestor: `ff025fee70f3732c575a7d2475d6a2d2e8a98fce`.
The commit containing this report is the review revision (`git rev-parse HEAD`).
Only HEC code, HEC-specific abuse protection, synthetic fixtures, tests and this report change. Existing Codespace branches, Job Hub routes, authentication middleware, Operations and database migrations are untouched.

## Corrections

- Added chronological half-hour solar/storage simulation alongside the deliberately isolated monthly calculation. It tracks grid imports, direct solar, exports, curtailment, battery charging, discharge, losses and remaining stored energy. Battery value is reported separately from solar-only value.
- Explicit import/export GST bases, fixed charges and interval-specific time-of-use prices. Controlled circuits remain grid-supplied unless a separately validated load profile moves them. Rejects missing controlled tariff, missing usable capacity source, invalid capacities, efficiencies and discontinuous intervals.
- Battery power limits and backup reserve reduce usable dispatch. No initial free battery energy or future solar used for earlier demand. No assumed nominal-to-usable 9 kWh conversion.
- Added a synthetic full-year seasonal conservation check and conserved-demand scheduling comparison applicable to flexible hot water, appliances and EV charging. These are hypothetical profiles, NOT observed half-hour customer consumption. Hot-water hygiene/ripple restrictions and EV availability must be established before changing a real schedule.
- Rejects conflicting combined/electricity/broadband totals. PDF extraction now retains explicit GST bases, rejects nonnumeric/negative readings, checks inconsistent periods and service totals, and avoids logging provider responses/private contents.
- Protected email-only route: bounded streamed request body; same-origin check; structured field allowlist; bounded answers; strict single-recipient format; Turnstile server verification with hostname/action checks; service-based IP, recipient and overall throttling; generic errors. Missing protection blocks sending (503).
- Client Turnstile verification is requested only for the email action. No additional privacy-consent checkbox. No D1/R2 writes for that action.
- A forged client readiness flag cannot enable dollar forecasts in emails. Legacy `customerCopyOptIn` on enquiry submissions can no longer bypass protected email delivery. Enquiry/visit submissions save records without sending a second automatic email, matching the approved three-choice flow.
- Original bill bytes and metadata are retained. Multipart uploads determine attachment lists and manifest; failed job creation and partial uploads are cleaned up only for the current request. Existing synthetic records/files survive success and failure.
- Approved action labels, free-visit wording and detailed ELSE advice remain. Removed stale visible 5 kWh reference and unsupported qualitative claims of battery financial benefit when financial validation is unavailable.

## Validation

Command: `node --test --test-isolation=none --test-concurrency=1 tests/*.test.mjs`.
100 tests passed; none failed. Includes the prior 83-test suite, adapted legacy email expectations, security rejection/failure tests, interval dispatch/conservation, synthetic PDF route tests and real in-memory SQLite/mock-R2 storage integrity.
PDF tests use valid, committed, clearly fictional summer/winter PDFs. Poppler verifies their text, and both were rendered and inspected. Route tests prove original PDF bytes reach the mocked provider and parsed results/uncertainties are handled correctly. They DO NOT demonstrate actual AI extraction accuracy.
No Amanda/customer documents were opened or transmitted for this work.
JavaScript syntax, local function imports and whitespace checks pass.

## Remaining acceptance blockers

1. Actual PDF provider extraction: no `OPENAI_API_KEY` configured in this runtime. `node tests/hec-provider-check.mjs` is prepared for securely supplied NONPRODUCTION credentials and sends only the committed fictional PDFs. Confirm model access and check consumption period dates as well as amounts. Do not print raw provider responses.
2. Browser acceptance: Chromium launch fails with `socket() failed: Operation not permitted`; desktop/mobile and interactive Turnstile acceptance remain unperformed. Node/static tests are not visual acceptance.
3. Real email delivery: provider behaviour is mocked. Test the protected action using an approved test inbox after nonproduction Turnstile/service configuration. Verify sender domain and provider tracking configuration; do not use customer addresses.
4. Security configuration: provision an isolated Turnstile widget and a service-only guard Worker. Pages requires `HEC_TURNSTILE_SITE_KEY` (public), `HEC_TURNSTILE_SECRET` (secret), `HEC_EMAIL_GUARD` (service binding), and its existing `RESEND_API_KEY`. No settings or resources have been created. The example guard configuration deliberately contains namespace placeholders and is not deployable unchanged. Guard must have no public routes, workers.dev or preview endpoint. Use distinct namespaces per environment.
5. Native rate limits are approximate and per Cloudflare location, not strict worldwide quotas. The suggested 5/IP/minute, 1/recipient/minute and 50 overall/minute limits require operational review. Turnstile does not prove ownership of the email address. Maintain provider spending/abuse monitoring; stricter global budgets require a durable limiter. Missing/misconfigured guard is unavailable, never fail-open.
6. Production build command/root/output and exact live schema have not been independently inspected here. Confirm build packaging excludes tests, docs, services, migrations and development metadata while retaining Pages Functions and public assets. No new application database migration is needed. Existing unchanged schema helper may add baseline columns if missing; confirm `jobs.job_type`, `job_files.document_role` and `job_files.energy_data_detail` by schema-only metadata before approval.
7. Existing public bill-reading and enquiry routes retain their baseline access controls. They also need edge request/size limits and provider quota monitoring. This work does not claim the entire public site is abuse-proof.

## Financial publication gate — still CLOSED

Keep `financialInputAudit().ready` false and email dollar forecasts disabled. Do not connect the new module to customer forecasts yet.
Required: verified manufacturer/model usable capacity, efficiencies and reserve; location/roof/shading-adjusted PV profile; measured or defensibly validated interval demand; controllable hot-water/EV/appliance schedule constraints; actual tariff periods/GST/export treatment; electricity-only baseline reconciliation; independent annual calculation and browser/email acceptance. No real battery model was specified, so fixture usable capacity is explicitly synthetic. The simulator is not an optimiser, assumes PV-only battery charging and excludes degradation, finance, replacement costs and installed prices. Fixed daily charges in interval tests use UTC date boundaries; real billing timezone/DST alignment must be implemented/validated before customer use.

EECA methodology comparison: EECA's research uses actual 30-minute demand data, location-dependent solar supply and tariffs, and shows that daytime demand, EV charging and tariff structure materially affect storage value. This supports using chronological inputs and separating solar/storage contributions; it does NOT validate our synthetic profiles or numerical outputs. EECA's general savings examples are not acceptance thresholds.

Primary references reviewed:
- https://www.eeca.govt.nz/insights/eeca-insights/understanding-the-value-of-residential-solar-pv-and-storage-in-new-zealand/
- https://www.eeca.govt.nz/for-homes/solar-for-homes/solar-costs-and-savings/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/pages/functions/bindings/#service-bindings
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## Production and rollback

User-verified production project `solectrics---website`, branch `main`.
D1 `DB` → `soletrics-enquiries`, UUID `d8352482-040b-4ae5-a518-7c1f52f860d9`.
R2 `JOB_FILES` → `solectrics-job-files`.
These names match source use; no bindings were changed or queried for customer data.
Rollback candidate supplied and shown in the earlier production screenshot: deployment `f86b0cbe-4bf9-4e40-a8d5-62b1633ccf13`, source `ff025fee70f3732c575a7d2475d6a2d2e8a98fce`. No remote change was made, so this work has not replaced it. Its continued availability must be rechecked in authenticated Cloudflare metadata immediately before an approved deployment. Code rollback does not roll back stored customer data or security-service configuration.

Upload cleanup is best-effort across D1 and R2, not a distributed transaction. A process crash/failed cleanup can require reconciliation; a lost successful response followed by retry can duplicate a submission. Durable idempotency remains outside this release. Never merge the earlier recovery development branch wholesale.
