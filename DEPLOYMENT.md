# Mini Fergus deployment notes

## Cloudflare bindings

The Pages project uses:

- `DB` — D1 database
- `JOB_FILES` — R2 bucket for job files
- `OPENAI_API_KEY` — secret used by power-bill reading
- `RESEND_API_KEY` — secret used to email Fletcher packages

Optional:

- `FLETCHER_FROM_EMAIL` — full Resend sender value. If omitted, Mini Fergus uses
  `Mini Fergus <mini-fergus@solectrics.co.nz>`.

The Fletcher recipient is intentionally fixed in server code as
`jane@solectrics.co.nz` so a form cannot accidentally be sent directly to a
supplier.

## Database changes

The SQL files in `migrations/` document the additive D1 changes. The runtime
also checks for `jobs.job_type`, `job_files.document_role`, and the supplier
catalogue tables before using them,
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
