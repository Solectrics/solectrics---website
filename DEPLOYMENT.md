# Solectrics Job Hub deployment notes

## Cloudflare bindings

The Pages project uses:

- `DB` — D1 database
- `JOB_FILES` — R2 bucket for job files
- `OPENAI_API_KEY` — secret used by power-bill reading
- `SUPPLIER_INBOX_SECRET` — shared secret for Zapier or inbound-email supplier PDF submissions
- `RESEND_API_KEY` — secret used to email Fletcher packages and Home Energy Check copies to customers

Optional:

- `FLETCHER_FROM_EMAIL` — full Resend sender value. If omitted, Job Hub uses
  `Solectrics Job Hub <mini-fergus@solectrics.co.nz>`.
- `HEC_FROM_EMAIL` — optional verified Resend sender for customer Home Energy Check emails. If omitted, it uses the same Job Hub sender.

The Fletcher recipient is intentionally fixed in server code as
`jane@solectrics.co.nz` so a form cannot accidentally be sent directly to a
supplier.

## Database changes

The SQL files in `migrations/` document the additive D1 changes. The runtime
also checks for `jobs.job_type`, `job_files.document_role`, the supplier
catalogue tables, and the internal-costing tables before using them,
which keeps an existing deployment working while the schema is upgraded.

Migration `0015_bookkeeping_foundation.sql` adds a separate, additive accounting
ledger. Review `BOOKKEEPING_IMPLEMENTATION.md` for the current scope and
remaining steps. Do not use this bookkeeping layer for live accounts until the
migration has been applied to a non-production D1 copy, opening balances and
the accountant-selected GST basis have been verified, and the invoice/payment
workflow has been connected and checked end to end.

Migrations `0016_bank_reconciliation.sql` and `0017_supplier_invoice_inbox.sql`
add a provider-neutral bank-feed queue and the supplier PDF inbox. Supplier PDF
intake requires the existing `JOB_FILES` R2 binding and `OPENAI_API_KEY` for
automatic reading. Keep `SUPPLIER_INBOX_SECRET` in Pages secrets; never place it
in the browser or repository. The current Zapier/Hnry destination is not
changed by these code paths.

The optional direct-email adapter is `workers/supplier-invoice-email-worker.js`.
It is a separate Cloudflare Email Worker, not part of the Pages deployment. To
configure it later, bind a recipient address to the matching book in
`bookkeeping_supplier_inbox_addresses`, set `SUPPLIER_INBOX_API_URL` to the Pages
`/api/supplier-invoice-inbox` endpoint, set the same inbox secret, configure an
allowlist in `SUPPLIER_ALLOWED_SENDERS`, and set a safe
`SUPPLIER_INBOX_FAILURE_EMAIL`. Test it without changing the current J.A. Russell
forwarding route first.

Never replace or recreate the production D1 database to apply these additions.

## Canonical hostname protection

`functions/_middleware.js` prevents the default `*.pages.dev` hostname from
bypassing the Cloudflare Access rules on `solectrics.co.nz`. Browser requests
are redirected to the custom domain. Non-read requests to a Pages hostname are
rejected instead of forwarding their request bodies.

For the isolated staging Pages project only, set the non-secret Pages
environment variable `ALLOW_PAGES_DEV_HOST=true` to keep its own `*.pages.dev`
hostname instead of redirecting to the live custom domain. Before enabling this,
protect the staging Pages hostname with its own Cloudflare Access application
and policy. Do not set this variable on the production project.

## Resend

Before testing email:

1. Confirm `solectrics.co.nz` shows as verified in Resend.
2. Create a sending-only Resend API key.
3. Add it to the Cloudflare Pages project as the encrypted secret
   `RESEND_API_KEY` for Production (and Preview if preview testing is needed).
4. Redeploy so Pages Functions receive the new secret.

Do not commit a Resend key to this repository.
