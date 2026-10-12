# Post-HEC bill integration and Fletcher privacy — release checkpoint

Date: 12 October 2026 NZ. Development source reviewed: `codex/fletcher-package-mobile-fix`, `dbbce59a32c16f7956f9a3e97a56cbf5215dfd8c`.
Status: local implementation and synthetic checks complete; no remote push, deployment, real customer edits or real email. Actual currently served staging revision was not reverified in this task.

## Follow-up: deployment preparation, 12 October 2026

- Repository branch heads rechecked: Fletcher development remains `dbbce59a32c16f7956f9a3e97a56cbf5215dfd8c`; main remains `ff025fee70f3732c575a7d2475d6a2d2e8a98fce`.
- Complete GitHub trees for both branches contain no `.github` workflows. This does not establish Cloudflare's independent Git integration settings.
- Local functional commit: `c5ad58d9a0ede9c3417ed6b3d2f4c6bd9bdf606c`; it sits on a local snapshot, not the repository's original ancestry. It must not be pushed as a replacement history. Remote promotion must create a commit with the reviewed upstream baseline as parent and only the reviewed changed files.
- Dedicated proposed remote branch: `codex/post-hec-bill-fletcher-privacy-staging`. It has not been created remotely.
- Prepared staging allowance retains the old Fletcher branch and adds only that dedicated branch. Separate deployment alias: `post-hec-bill-fletcher-privacy`. Exact allowed hostname: `post-hec-bill-fletcher-privacy.solectrics-jobhub-staging.pages.dev`. Both staging flags remain mandatory; production redirects remain unchanged.
- Name/UUID checks, clean-tree guard, fetched remote-tip comparison, fixed staging project/database/bucket, no-migration behaviour and explicit staging upload confirmation remain intact.
- Follow-up full suite: **97/97 passed** (95 functional checks plus two new deployment/hostname checks); shell syntax and diff checks pass.
- Cloud Browser currently reaches the Cloudflare sign-in page. No authenticated Pages configuration was read, and no login, account setting change, deployment, D1/R2 operation or email was performed in this follow-up.
- Build-trigger verification remains a hard gate before any remote branch creation or update.

### Precise manual metadata checks in the existing authenticated account

1. Open Workers & Pages → `solectrics---website` → Settings → Builds & deployments → production/preview branch configuration. Record production branch, automatic production deployment setting, preview mode and any include/exclude patterns. Share only those settings, no credentials. Do not save a change. Safe branch publication requires the new branch not to be the production branch and not to trigger a production-project preview; if all preview branches are enabled, stop and propose a narrowly scoped exclusion for approval.
2. Open `solectrics-jobhub-staging` settings. Confirm the production branch differs from the dedicated preview branch, and confirm staging Preview resource bindings/flags and Access protection. The deployment runner subsequently validates the exact DB UUID and constructs staging-only bindings; current live configuration still needs inspection. No API key values should be shown.
3. After those checks pass, publish the reviewed diff on the authentic upstream baseline, then give Jane the exact fetch/switch/SHA-check/deployment command using the existing guarded staging script. A deployment command cannot safely be issued yet because the branch is not published and its actual remote SHA does not exist.
4. Record Wrangler's actual deployed SHA and URL; verify Access intercepts the exact new preview; perform the approved synthetic acceptance without sending email. Check Tom's authorised staging identity as well as Jane's before claiming both have operational access.
5. Prepare the production candidate only after live staging passes. Keep staging hostname allowance, feature flags and deployment scaffolding out of that candidate, and request production approval separately.

Official branch-control reference: https://developers.cloudflare.com/pages/configuration/branch-build-controls/

## Original supplier form

Inspected both pages of `assets/fletcher-solar-site-checklist.pdf`, including rendered images. It contains installer account, customer name/site address/suburb/postcode, connection type, inverter type, roof type/pitch, proposed array layout/system size, environment/shading and optional additional notes. It has no dedicated ICP field or electricity-account-number field.

Its electricity-bill suggestion is conditional on uncertainty about system size. It does not establish a mandatory bill attachment for every equipment quotation. Supplier requirements beyond the inspected template have not been independently confirmed with Fletcher. No supplier contact was made.

## Fletcher release requirements — replace the earlier bill requirement

- Never attach customer electricity bills or annual usage files automatically to the supplier package. The server excludes classified bills and recognisable bill filenames, including misclassified attachments. Original files are not moved or deleted.
- Required package attachments: generated Fletcher PDF and OpenSolar roof/panel layout. SLD remains optional and retains existing upload support. PDF download remains independent of supporting attachments.
- Leave the original PDF's Power Bill Attached box unticked.
- Reuse reviewed shared ICP, flag conflicting legacy values, and provide a staging-only staff correction saved once to the existing linked enquiry JSON. Site Visit and System Design retain their own reviewed observations; differences are explicitly offered for approval instead of silently replacing them.
- The original supplier checklist does not require ICP. Optional inclusion in supplier notes requires a separate checkbox; it starts unticked. Customer account numbers, bill contents, raw energy data and internal pricing are not added.
- Do not auto-copy unrelated environment/electrical design notes into supplier notes. The user reviews supplier notes explicitly.
- Preview the actual selected attachment names, links, recipient, email introduction and form values before approval. The backend requires the current manifest hash; attachment changes invalidate approval.
- Existing routing remains email to Jane for review/forwarding, not direct email to Fletcher. No new recipient or sender configuration.
- Jane/Tom must check the generated PDF, layout and optional SLD for unintended identifying information. Automatic filename/category exclusion cannot inspect every document's visual content.

## Post-HEC bill workflow included in this development change

Documents → Customer power bill → existing upload → Read bill and update energy information → compare/correct → approve evidence slot → save.

Uses the existing `job_files`, R2 file and bill reader; it does not create another customer/enquiry/job/HEC/file. Draft extraction, reviewed values, previous values, attachment ID, source and dates are retained in the existing enquiry `answers_json`. Approval uses compare-and-swap to reject stale or repeated writes. Summer/winter slots remain the existing calculation inputs; replaced bills remain in review history and as original attachments.

Bill processing and shared ICP correction require both existing staging flags and the exact Fletcher staging hostname. These checks do not replace Cloudflare Access or the separately planned application authentication fix.

Corrected bill-reader fields are reused from the bill-accuracy revision, without bringing its Operations/accounting branch across. GST-inclusive rates are derived once; original printed rates/bases and whole invoice totals remain separate. Other services are excluded. Unknown values remain null. A bill with uncertain service separation is not treated as wholly electricity.

An approved energy update refreshes derived Energy Review values and pauses obsolete models. Prior review data is retained and shown for comparison. Dependent forecast values must be reviewed again. Existing customer proposals remain immutable snapshots; new proposals record the energy revision. A precise graph is suppressed when post-HEC information lacks seasonal/export/rate evidence or contains free/TOU periods that cannot be modelled reliably from monthly totals. No changes to financial costing, markup or invoice calculations.

## Completed checks

- Full local suite: **95/95 passed**, including preview approval, bill exclusion, misclassification, missing/oversized attachments, bill extraction/storage, concurrent updates, unknowns, legacy electricity-only bills, shared ICP and stale energy models.
- Function/inline-script syntax checks and whitespace diff check pass.
- Local browser checks: bill review at 375, 390, 430 and 1440px; actual Fletcher form/preview at 390 and 1440px. No horizontal overflow or JavaScript errors. Corrections survive close/reopen; approval required; cancellation produces no send; exactly one approved mocked send.
- Browser mocks use the real PDF library and original supplier template; no external API, AI or email request was made by these browser tests. Backend provider tests also intercept requests with synthetic responses.
- These are local Chromium/mobile-viewport checks, not real iPhone Safari or live Cloudflare staging acceptance.

## Remaining release gates

1. Verify effective Access protection and staging D1/R2 name/UUID bindings through the authorised staging route before deployment. Security containment from the earlier task remains unverified here.
2. Confirm the production Pages project's automatic development-preview behaviour before any remote branch update. Earlier metadata showed development previews under that project. Do not push this change if it would deploy to a production-bound environment.
3. Promote only this reviewed diff onto the existing Fletcher development branch, once the automatic deployment risk is resolved. Do not merge Operations/accounting/migrations or bill-accuracy scaffolding.
4. Run the existing guarded staging deployment from an authenticated Codespace. No migration or secret change is required by this code. Current script's clean-tree/remote-tip guard remains unchanged.
5. With synthetic staging records, upload/read/review/save a bill; check existing job and attachment identity; confirm Energy Review refresh/difference handling and regenerated proposal limitations. Test corrected ICP reuse and design reviewed-status clearing. Check the privacy preview on desktop and actual iPhone.
6. Inspect the package and cancel email. An actual synthetic email delivery test requires specific approval for the recipient and test scope. No real supplier email.
7. Production promotion remains separately gated by staged acceptance and security verification. No production deployment is authorised by this checkpoint.

## Limits requiring separate work/verification

Current source-level authentication/record-authorisation findings are not resolved by this feature. Bucket privacy and provider AI retention settings have not been checked here. Reading a bill continues to use the existing AI integration; the supplier exclusion does not mean bills are never processed by that provider. Multiple saved Site Visit/design identities can conflict; reviewed shared ICP wins for the Fletcher field, while legacy observations are retained for explicit review.
