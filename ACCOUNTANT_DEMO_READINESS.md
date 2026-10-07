# Job Hub — Accountant Demo Readiness

## Purpose

This is a discussion/demo build for Gordon Morrison of Gulf Accountants. It is not presented as a finished replacement for Xero.

The principle is:

> Xero-level accounting where it directly helps the business, without rebuilding Xero for its own sake.

The demo should show how operational activity creates accounting-relevant records, and ask the accountant what Job Hub genuinely needs to capture, control, export or synchronise.

## Legal and accounting boundaries

- **Solectrics Limited** is a separate New Zealand limited company.
- **Sol Espresso Limited** is a separate New Zealand limited company.
- They must use separate books, bank accounts, transactions, GST records and reporting.
- YOGACAMP remains a separate business context for later Events/POS use.
- Shared software architecture does not mean shared accounting data.
- A bookkeeping book remains the accounting boundary; a business owns/configures its own books.
- A job can only be assigned to one bookkeeping book.

## What is already implemented and working

### Operational Job Hub

- Customer/enquiry and Home Energy Check intake.
- Solar and general electrical jobs.
- Job status and next action.
- Supplier references.
- Internal costing with materials, labour, subcontractor, certification and other categories.
- Customer quote versions and accepted/issued status.
- Supplier catalogue and supplier pricing.
- Supplier invoice inbox with duplicate protection and manual review.
- Actual materials recorded from approved supplier invoices.
- Billable/non-billable material treatment and customer markup.
- Work logs/EWRB records with hours and days.
- Customer invoice versions with draft/issued/paid/void states.
- Customer invoice drafts use actual billable materials plus the configured markup.

### Accounting core

- Separate bookkeeping books.
- Chart of accounts.
- Transactions and double-entry journals.
- Supplier bills/accounts payable.
- GST event structures.
- Bank-feed import and reconciliation structures.
- Payment allocations.
- Audit events.
- Fixed asset and opening-balance foundations.
- P&L, balance-sheet/trial-balance calculation and CSV export foundations.

### Multi-business architecture

Implemented in source:

- Businesses.
- Owners.
- Verified external identities.
- User memberships and roles/permissions.
- Business modules.
- Business-to-book configuration.
- Shared accounting core.
- Optional Jobs/Trades, Electrical/Solar, Events and POS modules.
- Business context resolver.
- Business Settings UI.

This layer is still deliberately not enforced across all older operational endpoints until staged acceptance proves it will not disrupt existing Solectrics use.

## New accountant-demo bridge

When a saved customer invoice is marked **issued**:

1. Job Hub keeps the existing operational customer invoice record.
2. If that job is assigned to an accounting-ready book, Job Hub creates one bookkeeping **sales_invoice** transaction.
3. It posts a balanced journal:
   - debit Accounts Receivable;
   - credit Sales Revenue;
   - credit GST Payable where applicable.
4. It records invoice-basis/hybrid GST liability where relevant.
5. It writes an audit event.
6. Repeating the issue action is idempotent: the same customer invoice cannot create a second accounting transaction.

If the job has no accounting book, or the book is not yet configured, issuing the operational invoice still succeeds and reports that the accounting post needs configuration. This preserves existing workflow.

## Accountant View

Each Job Hub job now has an **ACCOUNTANT VIEW** link.

The read-only page shows:

Customer / quote
→ Job
→ Supplier/direct costs
→ Customer invoice
→ Payment/reconciliation
→ Accounting transactions
→ Indicative job profitability

It also makes missing links visible rather than disguising them.

The profitability number is intentionally labelled an **indicative job profit**, not accounting profit or taxable profit.

## Implemented but still needs staged/end-to-end testing

- Migration 0019 business/user/membership/module tables.
- Initial business seed/configuration.
- Solectrics book linking.
- Real Cloudflare Access identity capture for users/memberships.
- Customer invoice → sales ledger bridge against staged D1.
- Bank-feed/reconciliation workflow against a staged test transaction.
- Payment allocation from bank reconciliation to a posted sales invoice.
- GST treatment against accountant-confirmed Solectrics settings.
- Business separation checks with both Solectrics Limited and Sol Espresso Limited configured.

## Architectural/planned only or intentionally incomplete

Do not present these as finished:

- Payroll.
- PAYE filing/payment.
- Full company income-tax calculation.
- GST return filing.
- Accountant year-end journals/workflow.
- Full accounts receivable/credit-control system.
- Full accounts payable payment run.
- Live bank connection.
- Live Xero sync.
- Full inventory accounting.
- Complete fixed-asset/depreciation workflow.
- Full Xero replacement.
- Events/POS operating UI for Sol Espresso/YOGACAMP.

## Labour and subcontractor distinction for the demo

Job Hub already supports labour and subcontractor lines in internal costing and captures actual work-log hours.

However:

- work-log hours are operational/EWRB records;
- they are not automatically payroll expense;
- quoted labour cost is not automatically treated as an accounting wage expense;
- actual payroll/subcontractor payment remains a separate accounting event.

This distinction should be shown to Gordon and confirmed with him before automating it.

## Questions for Gordon

1. Is the proposed operational-record → accounting-transaction boundary sensible?
2. Which Job Hub records should be the source of truth, and which should be exported/synchronised to accounting software?
3. For Solectrics Limited, what GST basis and commencement/opening-balance treatment should be used?
4. Which supplier costs should Job Hub code automatically, and which should require accountant/user review?
5. Should customer invoices created in Job Hub be mirrored to Xero, or is an accountant export sufficient initially?
6. What controls does he require around invoice issue dates, voids, credit notes and locked periods?
7. What information does he need for labour, payroll, subcontractors and shareholder/current-account transactions?
8. What bank-reconciliation evidence/audit trail does he expect?
9. Which reports/exports would materially reduce Gulf Accountants' year-end and GST work?
10. What should Job Hub explicitly *not* attempt to do yet?

## Suggested demo sequence

Use one safe Solectrics test job:

1. Open customer/job and show accepted quote.
2. Show supplier invoice and actual materials flowing into the job.
3. Show internal labour/subcontractor costing and work logs.
4. Generate/review customer invoice.
5. Mark it issued and show the corresponding accounting sales-invoice transaction in Accountant View.
6. Show the bank-reconciliation structure/payment allocation path using staged test data only.
7. Show indicative job profitability.
8. Show that Solectrics Limited's accounting book is a separate boundary from Sol Espresso Limited.
9. Finish with the open questions above.

## Deployment boundary

This source work does not itself apply migration 0019, seed businesses, connect banks, alter production data, or change the existing J.A. Russell → Zapier → Hnry workflow.
