# Reviewed source-data reuse — staging validation

Branch: codex/fletcher-package-mobile-fix. Incremental implementation of the approved customer-journey design review. No production promotion.

## Scope

- Site Visit saves its own existing record and never implicitly writes System Design.
- Assessment panel edits no longer change Design panel fields.
- System Design shows saved-source comparisons. Select individual values and explicitly apply them using the existing design autosave.
- Source blanks cannot clear design fields. Changing design through this handoff clears design_reviewed.
- With multiple roofs, choose the target roof before measurements can be transferred.
- Choosing or dismissing a comparison performs no write. Dismissal is session-only; changed values/reload require review again.
- Selection survives identical-source background saves; changed source/target values invalidate the selection.
- For a job without a saved Site Visit, an unambiguous existing HEC/design ICP prefills the empty visit field. Conflicting ICPs are flagged rather than guessed; saved Site Visit values are retained.
- Initial failed Site Visit, Assessment or Design loads block corresponding saves until reload succeeds.

No database/API/schema changes, migration, quote/invoice calculation changes, email changes, Operations merge, Hnry changes or deployment operations are included.

## Local checks

Node full suite and focused job-data-review tests. Routed local Chromium against the real page at 375, 390, 430 and 1440px, using only synthetic in-memory API responses:

1. Existing reviewed design: 20 panels, roof 1 length 10, roof 2 length 9, ICP METER-A.
2. Save Site Visit measurement 12 and different ICP METER-B: no Design POST, existing reviewed design unchanged.
3. Save Assessment quantity 19: existing Design quantity 20 unchanged.
4. Choosing review items performs no writes, even after background save of unchanged source.
5. Explicitly select roof 2 length and panel quantity: one existing Design save, only selected source values transferred, roof 1 and ICP retained, design_reviewed false.
6. No horizontal overflow or JavaScript errors.
7. Existing contextual-photo browser checks retained partial-visit uploads, per-photo retries, uncertain-result receipt checks, draft recovery and the same gallery/library file records.

## Staging acceptance still required

Use an existing synthetic staging job only; do not use Orna's live job or create another HEC.

- Repeat the source-save/review tests above, confirm saved results after refreshing.
- Test the controls on Tom's actual iPhone, including return from the camera and entering new measurements.
- Test an existing saved ICP, new-visit prefill, and conflicting HEC/design ICP.
- Confirm Fletcher still uses the selected saved Design, requires bill/layout for email, permits PDF download without those supporting attachments, and keeps SLD optional. Do not send a package merely to test navigation.

Do not describe local browser emulation as real Safari acceptance. No staging database/file/email writes or deployment were performed during local validation.

## Limits / later approved increments

This correction does not introduce a design revision archive or server-side concurrent-edit protection. Direct edits to legacy design controls retain their existing behavior. Issued quote snapshots and costing calculations are unchanged; Assessment versus Design proposal discrepancies still need the separately scoped readiness work described in the approved design roadmap. Guided visit completion, warranty packs, communications and voice transcription have not been implemented in this increment.
