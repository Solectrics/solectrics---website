# Job Hub staging Pages deployment preparation

Status: preparation only; no Pages deployment or Cloudflare settings change has been run by this work.

## Fixed scope

- Repository: Solectrics/solectrics---website
- Branch: codex/jobhub-staging-migrations-0015-0018
- Pages project: solectrics-jobhub-staging
- D1 binding: DB -> jobhub-staging (baseline and 0015–0018 already applied and read-only verified)
- R2 binding: JOB_FILES -> jobhub-files-staging

Do not rerun migrations. Do not use the live D1, R2 or Pages project.
The existing live J.A. Russell / Zapier / Hnry route must remain unchanged.

## Local preparation command

From the authenticated Codespace checkout, this command only pulls the branch and runs local preparation:

```bash
git pull --ff-only && bash staging/prepare-jobhub-pages.sh
```

The preparation script requires the exact development branch and clean tracked files, refuses root Wrangler configs pending review, runs the entire Node test suite and syntax checks every tracked Functions JavaScript file. It builds only tracked static web assets into staging/pages-output. Migrations, the baseline, test fixtures, scripts, documentation, email-worker source, and Functions source are not copied into that public folder. Functions stay in the repository root functions/ for separate Pages compilation. It refuses to overwrite an existing output folder.

The script does not invoke Wrangler, contact Cloudflare, change databases, or deploy.
The test suite uses local mocks/fixtures; it is not an end-to-end D1/R2/OCR test.
If local tracked files are dirty, stop and review them instead of resetting or discarding them.

## Staging project settings to review before deployment

These are planned settings, not a claim that the dashboard has been inspected.

| Setting | First test value | Purpose |
| --- | --- | --- |
| Pages project | solectrics-jobhub-staging | The only Pages deployment target |
| DB | jobhub-staging | Already verified post-0018 staging database |
| JOB_FILES | jobhub-files-staging | Store only staging test uploads |
| ALLOW_PAGES_DEV_HOST | true | Prevent this project's pages.dev hostname redirecting to live solectrics.co.nz |
| OPENAI_API_KEY (encrypted secret) | Optional for first manual test; staging-specific key for OCR testing | Supplier invoice, bill and Fletcher PDF extraction |
| SUPPLIER_INBOX_SECRET (encrypted secret) | Leave absent for initial manual upload testing | Required only when separately testing authenticated JSON/email/Zapier intake |
| RESEND_API_KEY (encrypted secret) | Leave absent | Keep the Fletcher email endpoint unable to send mail |
| FLETCHER_FROM_EMAIL | Leave absent | Unused while email sending is disabled |

There is no Hnry, Zapier, bank-feed-provider or OpenSolar secret required by the current inbox/bookkeeping test path. Do not copy credentials from a live Pages project. Add optional test secrets directly in the staging project's dashboard; never put them in chat, git or the output folder.

Pages calls one configuration environment “Production” even in a project named staging. That label inside solectrics-jobhub-staging is not the live Solectrics project. A deployment from a branch other than that project's configured production branch uses Preview settings. Review the intended branch/environment mapping and the corresponding bindings before deploying. If both environments will be used, both must refer only to jobhub-staging and jobhub-files-staging, with the staging hostname variable in both.

Before enabling ALLOW_PAGES_DEV_HOST, protect the staging pages.dev hostname with its own Cloudflare Access application/policy. Include the preview/branch hostname if that will be used. The current Pages middleware relies on Cloudflare Access for authentication; it does not verify Access JWTs itself. Do not add or change live domain DNS or live Access policies.

For Git-connected Pages, use:
- production branch within the staging project: codex/jobhub-staging-migrations-0015-0018
- framework preset: None
- build command: bash staging/prepare-jobhub-pages.sh
- build output directory: staging/pages-output
- root directory: repository root (functions/ must be found there).

Do not switch or connect the live Pages project to this branch. Avoid enabling automatic staging builds until the Access policy and staging-only bindings are reviewed.

## Future Codespace deployment command (not run or authorized by this preparation)

After explicit staging deployment approval and the above settings review, run from the repository root so Pages compiles functions/:

```bash
npx wrangler pages deploy staging/pages-output --project-name solectrics-jobhub-staging --branch codex/jobhub-staging-migrations-0015-0018
```

This uses dashboard-managed Pages bindings. Do not supply a D1-migration config to this command. If a root Wrangler config is introduced, stop and review it before deploying. Do not drag-and-drop the repository: it contains non-public schema/scripts, and dashboard uploads do not build this Functions application.

If project settings/name/bindings or Access protection cannot be established, stop. Do not fall back to another Pages project or resource.

## First staging acceptance test (after deployment approval)

1. Sign in through staging Access and open /mini-fergus. Confirm the hostname stays on staging.
2. Read /api/jobs and /api/bookkeeping?view=books. A fresh schema can legitimately have no jobs or books; migrations create structure, not live data.
3. Create a clearly labelled STAGING TEST electrical job and a test bookkeeping book through the application. Configure the test book's commencement date/GST basis before approval. These actions will write staging data and are outside this preparation run.
4. Manually upload one synthetic single-invoice PDF at /mini-fergus-supplier-invoices. With no OCR key, enter and review the amounts manually. With a staging OCR key, verify extracted values against the original PDF.
5. Confirm the PDF is retained in staging R2 and can be reopened. Receipt alone must not create materials, a supplier bill or a posted journal.
6. Confirm exact S#### supplier-reference matching chooses only an unambiguous test job. Require human review and approval before posting.
7. Approve a billable materials cost of $100 ex GST with $15 GST. Check actual materials cost remains $100; the separate 30% customer markup produces $130 ex GST in a draft. Review all labour/GST/quoted-price assumptions before issuing anything.
8. Upload the same PDF again and verify duplicate handling does not create a second bill/material cost/journal.
9. Test non-billable materials and a synthetic credit separately. Confirm credits/costs and journal debit/credit totals reconcile.
10. Generate and review a test customer invoice draft; confirm drafting does not issue it. Do not send real invoices or email.
11. Test bank reconciliation only with synthetic imported rows, not live bank connections. The bank reconciliation API exists but a live provider connection is not configured by this branch.
12. Test existing job pages, HEC/bill upload, costing, quotes and EWRB records with synthetic staging records. Keep Hnry and live Zapier delivery unchanged.

Acceptance is incomplete until the deployed Functions, staging D1, staging R2 and optional OCR path have been tested together. Local tests and schema verification alone do not prove those integrations work.

## Recovery

A build/preparation failure performs no Cloudflare write. Fix it on the development branch before deploying.
A failed future deployment does not require database migration reapplication. Check only the staging deployment logs/settings. Do not reset either database.
If application testing fails, stop testing and revert only the staging Pages application to a previously reviewed staging deployment, when one exists. Test data must be deliberately reviewed before any staging cleanup. No production recovery action is permitted.

## Relevant Cloudflare documentation

- [Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Pages commands and Functions build](https://developers.cloudflare.com/workers/wrangler/commands/pages/)
- [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/)
