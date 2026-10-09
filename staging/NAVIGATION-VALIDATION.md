# Staging navigation validation

This presentation change builds on Fletcher revision 48ad61f. It does not merge Operations, alter APIs, storage, calculations, migrations, permissions or email delivery.

## Available

- Shared navigation on Jobs, the individual job, supplier catalogue, energy review and Fletcher form.
- Mobile quick links and desktop navigation.
- Jobs search by customer/address/reference/ID, job type and exact saved status.
- Recorded next-action queue and linked-enquiry/completed-job counts from the existing Jobs response.
- Existing verified Fletcher document attention.
- Collapsible existing job sections; Site Visit and documents precede assessment.
- Existing inputs remain mounted; save/autosave handlers remain unchanged.
- Hash links open their enclosing sections, including the Fletcher roof-layout upload shortcut.

## Deliberately unavailable on this branch

The Jobs response does not provide quote versions, readiness gates, installation dates/states, invoice balances or the Operations task list. Their dashboard totals remain unavailable, with explicit explanations. No inference is made from next-action text. Operations remains on its separate development branch. New general enquiry creation is not invented: use the existing electrical-job form or HEC solar-enquiry route. Printed customer quote and invoice pages retain their existing presentation.

Later-stage document requirements remain unconfigured. Do not treat absent compliance/hand-over documents as overdue, or accessible files as approved evidence. The compact library and its existing attachment selection are reused unchanged.

## Staging acceptance

Deploy with the existing guarded Fletcher staging script. No migration is required.

Use the existing synthetic staging job, not a live customer record:

1. Search/filter Jobs; confirm a section shortcut opens the selected job.
2. Expand Site Visit, edit an existing test field, collapse/reopen it, and confirm the value remains and normal save feedback appears.
3. Confirm general-electrical jobs hide solar sections and can still access Work/EWRB, materials and invoices.
4. Open a missing roof-layout link: confirm the same job, open documents section, drawing category and roof-layout document use.
5. Confirm document search and expandable groups still open existing files.
6. Check Fletcher PDF download with complete form details and no layout/SLD; email remains blocked without the layout. With bill + layout, SLD remains optional.
7. Check 320–390px mobile and desktop, including an actual iPhone Safari. Do not create duplicate HEC/jobs or send a package repeatedly.

Local browser checks use synthetic routed API responses and mocked writes only. Live staging acceptance, real iPhone Safari and delivery require separate verification. Production promotion is not authorised by this staging change.
