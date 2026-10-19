# Local staging compatibility adapter — 19 October 2026

Local implementation only. Base: 79560677243ac17c8c327319217f6ef86c76f3f3.
Security reference: 514781021009dec8e5018c056d7e15851b137fb7. The copied verifier's Git blob is fc70dea400697ca358b80cc01e7ca94595453b9d; a regression test pins it. Neither security branch nor reference was modified or merged. The unavailable local f42de4936122511c382693f6778d182e66650750 remains unverified.

## Implemented

Exact acceptance hostname gating, RS256 Access assertions, issuer/audience/expiry/subject/staff checks, trusted request identity, same-origin mutations, strict JSON/multipart types, explicit DB/JOB_FILES bindings, private/no-store responses and protected document downloads. Missing or invalid authentication fails before data access. The permitted hostname is the existing `solectrics-jobhub-staging.pages.dev`. The former acceptance subdomain and other aliases are rejected when staging mode is enabled. No deployment or infrastructure change was made.

HEC and bill audit provenance and task/handover completion use the verified subject/email, ignoring claimed actors. UI recorded-by fields become read-only; assignment remains a workflow choice. Existing original-response history, revision compare-and-swap, downstream review, quote snapshots, calendar/readiness, uploads and duplicate-free follow-ups remain intact. Middleware checks parent jobs and related quote/invoice/file IDs before handlers or R2; storage keys come from DB rows.

This is the reference's whole-business approved-staff model, not a per-assignee or multi-tenant ACL. Confirm that model before staging approval. Explicit bindings do not prove their physical resource identities; those require infrastructure inspection.

Initial synthetic staging acceptance denies outbound bill extraction, supplier extraction/import, email and public enquiry submissions server-side. Manual bill entry remains available. Existing local-only mode remains available on loopback with its explicit flag.

## Configuration contract (not applied)

- Exact hostname above; `JOBHUB_USABILITY_STAGING=true`, `JOBHUB_STAGING_ONLY=true`, `ALLOW_PAGES_DEV_HOST=true`.
- `JOBHUB_ACCESS_ISSUER`: actual approved Access issuer.
- `JOBHUB_ACCESS_AUDIENCES`: JSON object mapping the exact hostname to its actual Access audience; no wildcard keys.
- `JOBHUB_STAFF_EMAILS`: approved staff allowlist. Never use synthetic test values for actual sign-in.
- `DB`: verified isolated synthetic staging D1 UUID; `JOB_FILES`: verified private synthetic staging bucket. Never inherit production bindings.
- Do not set local-only mode on staging. Flags alone do not establish identity.

## Validation

153 synthetic automated tests pass, including the original 138 regressions. Added tests cover invalid/missing assertions, flags/host/configuration, origins/media types, trusted Jane/Tom provenance, stale saves, parent and cross-job checks, private downloads, idempotent follow-ups and blocked outbound calls.

Chromium authenticated middleware simulation passed at 375/390/430/1440 pixels. The 375px workflow edits conditional HEC answers, enters a bill, uploads a synthetic PDF, uses extraction-failure manual fallback and repeats handover; 1440px checks conflicting tabs. Search, Operations, general-job compatibility, overflow and script errors are checked at all widths. The original local-only browser suite also passed all four widths. Browser traffic is routed to a loopback-only in-memory synthetic harness with ephemeral signing keys; this is not an actual Cloudflare deployment or iPhone Safari test.

Run unit suite: `node --test --test-isolation=none --test-concurrency=1 tests/*.test.mjs`.
Run loopback harness: `node dev/synthetic-server.mjs --staging`; in another terminal `JOBHUB_TEST_STAGING=true python tests/browser-usability.py`. Restart without `--staging` for the original local browser regression. Dev/test files and synthetic token endpoint must never enter the deployment public asset directory.

## Remaining staging gates and approvals

1. Obtain read-only Access/Pages configuration and D1/R2 metadata evidence. Verify exact project/alias, staff policy and no bypass, every private page/API/file path, real audience/issuer, staging D1 UUID and ledger/schema, R2 bucket privacy and all environment bindings. No live Cloudflare evidence was available locally. Confirm synthetic-only resources without reading customer records.
2. The original adapter checkpoint ad0cd7ae3a9d9d1c070ed7a806877cf7f033f2c3 was published and restored successfully. This existing-host revision is local only. Any new backup-only push requires separate authorisation and current trigger/exclusion checks.
3. Schema preflight determines whether unchanged 0021_solar_operations_workflow.sql and 0022_handover_aftercare.sql are pending. No migration was added or executed by the adapter. 0021 SHA256: fc4a821ef0d644f3f3047d6329047c0fa0b94435458da8d9209e9f4536c4cdaa. 0022 SHA256: a0d9ff89ae76e56aef5b78a339b4cd94e6b548d6aff36bf7ef6bfc6f79370603. HEC uses existing JSON. Do not apply the full migration directory or unrelated accounting migrations. Partial/mismatched schema requires a separately reviewed additive delta, not blind replay.
4. Before any writes, record prior staging deployment, bindings and schema ledger; preserve encrypted/restricted synthetic-only D1/R2 backups outside the workspace and verify restoration locally. Do not publish database/object backups to GitHub.
5. Prepare/review an allowlisted asset build excluding snapshots, SQL, tests, dev harness and private files. Pin the final candidate SHA and guarded staging config. No production configuration or security branch changes.
6. Obtain explicit approval naming that SHA, exact staging project/hostname, verified D1 UUID/bucket, pending migration filenames/hashes, backup/rollback and synthetic seeding/testing scope, plus any necessary staging settings changes. Only then execute separately approved staging migration/deployment. Current approval does not cover these actions.
7. Verify actual signed-in Jane/Tom behavior, denial cases, real actor audit, upload/download, downstream review, issued quotes and document workflows on devices including iPhone Safari. No live email/extraction during initial acceptance. On failure, stop writes and restore the recorded app deployment while retaining additive schema/history; data restoration needs the approved synthetic backup scope. Never drop tables as automatic rollback.

No deployment, migration execution, Cloudflare change, customer access, production change or GitHub push was performed for this adapter.


## Existing-host source checkpoint

This source-only revision descends from the unchanged verified ad0cd7ae3a9d9d1c070ed7a806877cf7f033f2c3 candidate. Only the permitted hostname, browser target/teardown, denial tests and documentation changed. Browser teardown waits for in-flight routed requests before closing each context. The authentication verifier and record/document protections are unchanged. New source is a local checkpoint only; publishing requires separate authorisation.

Reuse the existing base-host Access application after verifying its issuer/AUD and whole-host policy coverage and approving Tom's addition. A release to the base hostname replaces the project's production-labelled staging deployment (not a preview). Inspect Production bindings/variables for that deployment; keep automatic builds disabled and the backup branch excluded. Do not broaden hostname matching.

Before release: verify synthetic-only D1/R2 provenance, exact staging bindings, schema/ledger and the pending 0021/0022 delta; record a complete safe rollback deployment ID/SHA; approve and verify restricted backups outside the workspace with a restoration check. Approve Fail closed, staff policy/variables, the pinned new artifact/SHA, exact pending migration hashes, staging-only deployment and rollback as a separate execution manifest. The currently reported Fail open, Jane-only policy, unknown AUD/issuer, unknown schema/ledger and missing verified backups remain blockers. Existing staging users/workflows share the base deployment/resources; outbound extraction/email/import blocks remain intentional for synthetic acceptance. Missing f42de493 protections remain unverified.
