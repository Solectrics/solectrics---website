# Staging accountant acceptance — synthetic only

Run this after 0019/0020 + business seed and protected staging Pages deployment.

## Target
- Pages: solectrics-jobhub-staging
- D1: jobhub-staging
- R2: jobhub-files-staging
- Branch: codex/jobhub-staging-migrations-0015-0018
- Never use production resources.

## Minimal operator journey
1. Sign in through staging Cloudflare Access.
2. Business Settings: claim **Solectrics Limited** as first owner only if it shows unclaimed.
3. Confirm the existing staging bookkeeping book is linked only to Solectrics Limited.
4. Create/use one clearly labelled synthetic Solectrics job.
5. Create an accepted quote with labour/subcontractor + materials.
6. Upload/approve a synthetic supplier invoice; confirm actual materials and supplier bill/journal.
7. Generate customer invoice draft, then mark **issued**; confirm Accountant View shows a sales invoice ledger entry.
8. Import a synthetic bank inflow matching the customer invoice; approve match; confirm payment allocation and invoice becomes paid.
9. Open Accounting Centre:
   - GST report
   - General Ledger
   - Trial Balance
   - P&L
   - Balance Sheet
10. Lock the accounting period through the test transaction date.
11. Attempt a new back-dated posting into that locked date; it must be rejected.
12. Release the lock with a reason.
13. Create a partial customer credit note; confirm revenue/GST/AR reversal and GST report movement.
14. Create a balanced accountant adjustment; confirm it appears as **unreviewed**, then mark reviewed.
15. Re-run trial balance and verify total debits = total credits.
16. Confirm no Sol Espresso book/transaction appears in the Solectrics book.

## Acceptance outcome
Pass only if:
- each transaction belongs to one book;
- sales invoice/payment/supplier/GST entries are balanced;
- duplicate operational actions do not duplicate ledger transactions;
- locked periods reject posting;
- credit note reversals are traceable to the original invoice;
- accountant adjustments have audit/review status;
- reports derive from posted ledger entries;
- production Hnry/Zapier flow remains unchanged.
