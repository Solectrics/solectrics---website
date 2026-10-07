# Job Hub — Accountant Demo Readiness

## Objective

Prepare the existing Solectrics Job Hub for a demonstration to Gordon Morrison of Gulf Accountants.

This is **not** a demonstration of a finished Xero replacement. The purpose is to show how operational activity creates accounting-relevant records and to ask what an accountant genuinely needs Job Hub to capture, control, export or synchronise.

## Settled business structure

- Solectrics will become a limited company.
- Sol Espresso will become a separate limited company.
- Their books, bank accounts, transactions, GST/accounting records and reporting must remain legally and financially separate.
- Job Hub may use shared software architecture underneath, but business data must not mix.
- YOGACAMP may later use the same platform, especially Events/POS functionality.

## Current implementation status

### Implemented and working in the current Solectrics build

The present application is still primarily a **Solectrics job-management system**, but the following operational/accounting chain is implemented:

1. Customer/enquiry and job records.
2. Solar and general-electrical job types.
3. Internal job costing.
4. Cost categories for:
   - materials;
   - labour;
   - subcontractors;
   - testing/certification;
   - other direct costs.
5. Supplier catalogue/pricing workflow.
6. Supplier invoice upload and reviewed extraction into actual materials.
7. Actual materials cost and customer material charge/markup.
8. Versioned customer quotes.
9. Quote issued/accepted state.
10. Versioned customer invoices.
11. Invoice issued/paid/void states.
12. Expected gross profit and gross-margin display within internal costing.
13. Job status/next-action movement as invoice/payment status changes.

### Implemented but requiring demo testing / confirmation

Before the Gordon meeting, run one clean end-to-end demonstration job and confirm:

- supplier invoice upload works in the deployed demo environment;
- actual materials flow into the correct job;
- labour/subcontractor/certification cost lines save correctly;
- customer invoice is generated from the intended costing option;
- invoice issue/paid status changes are visible;
- gross profit/margin displayed in Job Hub agrees with the demonstrated figures;
- no stale wording implies Hnry remains the intended future accounting route.

OCR/extraction should be presented as a convenience requiring review, not as autonomous bookkeeping.

### Architectural / planned only — NOT yet implemented

The recently approved multi-business architecture is not present in the current branch.

In particular, there are currently no implemented migrations/models for:

- business ownership;
- verified Job Hub users;
- business memberships and permissions;
- business/book configuration;
- business-level data segregation;
- shared accounting-core entities scoped by business;
- optional Jobs/Trades, Electrical/Solar, Events and POS modules.

The planned migrations 0015–0018 are not present on the staging branch.

This must be described honestly in the demo as the **approved next architecture**, not as completed functionality.

## Demo narrative

The clearest demonstration is one real or realistic Solectrics job.

### Operational journey to show

Customer
→ Quote / accepted work
→ Job
→ Supplier invoice
→ Materials / direct costs
→ Labour / subcontractor / certification costs
→ Customer invoice
→ Payment status
→ Job profitability
→ Accounting handoff

At the final step, stop deliberately.

Explain that Job Hub currently knows the operational facts that create the bookkeeping entry, but the accounting integration is intentionally not being completed until the accountant confirms the correct boundaries and controls.

## What Gordon should see

### 1. Job Hub is the operational source

Show that the accounting-relevant information originates in the job:

- customer;
- scope;
- quote;
- supplier costs;
- actual materials;
- labour;
- subcontractors;
- certification;
- sale amount;
- GST;
- payment status;
- expected profit.

### 2. Job Hub does not need to become Xero unnecessarily

The intended boundary to discuss is:

**Job Hub**
- operational workflow;
- job costing;
- source documents;
- customer quotes/invoices;
- allocation of direct costs to jobs;
- payment awareness;
- job profitability;
- clean accounting export/synchronisation.

**Accounting system / accountant**
- statutory books;
- bank reconciliation;
- GST filing;
- payroll;
- fixed assets/depreciation;
- journals;
- annual accounts;
- tax returns;
- accountant adjustments and controls.

The boundary is open for Gordon's advice.

## Questions for Gordon

Ask Gordon to tell us what he would want Job Hub to produce or synchronise rather than asking him to endorse a pre-built accounting system.

1. For a customer invoice, what minimum data should Job Hub send to Xero?
2. Should Job Hub create the invoice in Xero, or should Xero remain the place where the legal accounting invoice is created?
3. For supplier invoices, should Job Hub:
   - store the source document and job allocation only;
   - create a draft bill in Xero;
   - or send a coded transaction after review?
4. What controls should exist before a supplier cost can be treated as accounting-ready?
5. What should happen when a supplier invoice covers more than one job?
6. How should owner/staff labour be represented in Job Hub for **job profitability** without incorrectly treating it as a supplier expense or payroll posting?
7. How should subcontractor labour flow to Xero?
8. What payment information should Job Hub receive from Xero or the bank?
9. Does Gordon want Job Hub to know whether an invoice is reconciled, or is paid/unpaid status sufficient?
10. Which identifiers should be shared between Job Hub and Xero so records can be traced reliably?
11. What GST fields/tax codes should Job Hub store, if any, versus leave entirely to Xero?
12. What audit trail would Gordon expect when a quote, cost, supplier invoice or customer invoice changes?
13. What exports/reports would make month-end review easiest for Gulf Accountants?
14. Which fields must be business-specific once Solectrics Limited and Sol Espresso Limited are created?
15. Should Job Hub ever post journals, or should journals remain entirely inside Xero?

## Important company-structure warning

The current Solectrics invoice code contains Solectrics-specific business defaults, including the current GST number and contact details.

These must **not** be reused as a generic multi-business model.

Before Solectrics Limited starts issuing invoices through the system, confirm the new company's legal name, GST registration details, bank details and Xero organisation configuration.

Sol Espresso Limited must have its own business configuration and accounting book. No Solectrics defaults should leak into Sol Espresso records.

## Recommended next development step after Gordon

Do not build a large accounting ledger before the meeting.

After Gordon's feedback, implement the smallest stable multi-business foundation first:

1. businesses;
2. legal/accounting identity per business;
3. verified users;
4. memberships/roles;
5. business-scoped books/configuration;
6. business_id on operational/accounting-relevant records with enforced isolation;
7. module enablement by business;
8. an explicit accounting-handoff interface/event model.

Only after that should Xero synchronisation or additional accounting automation be built.

## Demo success criterion

A successful Gordon demo should end with him being able to say:

> "I can see where the accounting data comes from, I can see the source documents and job economics, and I can tell you exactly what I want transferred into Xero and what I want left out."

That is the goal of this stage.
