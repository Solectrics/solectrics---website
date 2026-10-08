# Solectrics Job Hub deployment notes

## Cloudflare bindings

The Pages project uses:

- `DB` — D1 database
- `JOB_FILES` — R2 bucket for job files
- `OPENAI_API_KEY` — secret used by power-bill reading
- `RESEND_API_KEY` — secret used to email Fletcher packages and opted-in Home Energy Check customer copies

Optional:

- `FLETCHER_FROM_EMAIL` — full Resend sender value. If omitted, Job Hub uses
  `Solectrics Job Hub <mini-fergus@solectrics.co.nz>`.

The Fletcher recipient is intentionally fixed in server code as
`jane@solectrics.co.nz` so a form cannot accidentally be sent directly to a
supplier.

## Database changes

The SQL files in `migrations/` document the additive D1 changes. The runtime
also checks for `jobs.job_type`, `job_files.document_role`, the supplier
catalogue tables, and the internal-costing tables before using them,
which keeps an existing deployment working while the schema is upgraded.

Never replace or recreate the production D1 database to apply these additions.

## Canonical hostname protection

`functions/_middleware.js` prevents the default `*.pages.dev` hostname from
bypassing the Cloudflare Access rules on `solectrics.co.nz`. Browser requests
are redirected to the custom domain. Non-read requests to a Pages hostname are
rejected instead of forwarding their request bodies.

## Resend

Before testing email:

1. Confirm `solectrics.co.nz` shows as verified in Resend.
2. Create a sending-only Resend API key.
3. Add it to the Cloudflare Pages project as the encrypted secret
   `RESEND_API_KEY` for Production (and Preview if preview testing is needed).
4. Redeploy so Pages Functions receive the new secret.

Do not commit a Resend key to this repository.

## Home Energy Check customer copy

The optional customer copy uses `RESEND_API_KEY` in the Production Pages
Functions environment. The key must permit sending from the verified
`solectrics.co.nz` domain. Confirm this separately before an approved deployment;
a working preview does not establish Production configuration.

The sender is fixed to `Jane at Solectrics <jane@solectrics.co.nz>`, matching
the validated customer email. `HEC_FROM_EMAIL` is not required or read by this
implementation, and `FLETCHER_FROM_EMAIL` does not change this sender.

The email contains the allowlisted customer answers and uploaded file names,
without attaching the uploaded files or exposing storage URLs. Its only image
is the public Solectrics logo. Confirm Resend open/click tracking is disabled
for the sending domain so the provider does not insert a tracking pixel or
tracking links. No provider settings are changed by the application.

An email failure is reported separately after the enquiry, linked job and
uploads have saved; it does not retry or undo the saved submission. No new
database migration or file-storage configuration is required for this feature.
