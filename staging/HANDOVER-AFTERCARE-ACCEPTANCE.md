# Handover & Aftercare — staging candidate

Branch: `codex/jobhub-solar-operations-workflow`.
Base inspected: `99dfc81bce293b48b16642a2f060c27f552a12f4`.
No production merge, deployment, customer email or application is authorised by this change.
Keep separate from the security/release candidate; security and outstanding release acceptance retain priority.

## Existing versus completed here

Existing: shared job_tasks, Operations calendar/overdue views, handover date, unique (job_id, task_key), two generated aftercare tasks, generic issue tasks.

Added: per-job Operations and Handover & Aftercare shortcuts; four-item customer handover checklist with draft notes; actual handover date; per-follow-up contact date, notes, outstanding issues and completion. Records stay attached to the same job/customer. Follow-up completion requires a contact date. Calendar task links/checkboxes open the dedicated panel for recording contact details. Outstanding issues may be left on an open follow-up or tracked as a separate existing maintenance task.

Corrected: one month is a calendar month, clamped to month-end. Repeated saves do not duplicate tasks. Date corrections require confirmation, move only open follow-ups and preserve completed records. On saving a handover, untouched legacy 30-day dates are corrected; manually rescheduled dates are preserved.

No automatic emails or third-party requests were added. Handover is not export permission or a replacement for inspection/certification.

## Database prerequisite

Additive migration `0022_handover_aftercare.sql` adds two job fields and three task fields; no rows are deleted or copied.

Do not blindly run all migrations or the old operations runner (it only stages 0015–0021). Before applying 0022:

1. Verify the exact `jobhub-staging` D1 name/UUID and existing migration ledger and schema, using the approved staging workflow. Do not use `solectrics-enquiries`.
2. Confirm 0021 exists and 0022's number does not conflict with other queued work. If it conflicts, stop and reconcile migration numbering before applying anything.
3. Apply only the reviewed pending migration through the approved staging migration process. Confirm the five columns and unchanged job/customer counts.
4. Deploy only this reviewed commit to the Access-protected Operations preview in `solectrics-jobhub-staging`. Preserve the existing host allowlist and D1/R2 bindings. Verify the exact deployed revision before testing.

Without the migration, existing Operations reads and ordinary tasks remain available; new handover editing is disabled with an explicit message. Do not present that disabled state as feature acceptance.

## Synthetic staging acceptance (not yet performed)

Use a labelled synthetic solar job only; never modify a real customer for acceptance.

1. Open job on iPhone. Confirm both top shortcuts work. Follow Handover & Aftercare from Operations too.
2. Save a partial checklist and notes; reload and confirm persistence without creating follow-ups.
3. Complete the checklist, enter actual handover date `2026-01-31`, and record handover. Expect due dates `2026-02-14` and `2026-02-28` on exactly two shared tasks.
4. Save again; reopen/reload the job. Confirm same job ID and same two task IDs.
5. Confirm both tasks in Operations calendar (February) and overdue list. Close the synthetic job only if its other required gates are legitimately satisfied; open aftercare must still remain visible.
6. Record contact date, notes and an outstanding issue; save open and reload. Confirm still overdue until completed. Completion with no contact date must be rejected.
7. Complete one follow-up; reload job and Operations. It leaves the overdue list and is available when completed tasks are included. Reopen it; it returns without duplication.
8. Complete one follow-up again; correct handover date to `2026-02-01`, explicitly confirming. Only the open follow-up moves. Completed date, contact notes and task ID remain unchanged.
9. Verify ordinary job tasks and electricity details still work. Confirm general electrical jobs do not show the solar handover shortcut.
10. Test unauthorised access and permitted operator access under the separately approved security configuration. This feature does not claim to resolve or validate the outstanding production security blockers.

## Verification limits

Candidate verification on 13 October 2026: `node --test tests/*.test.mjs` passed 116/116 (15 focused handover/aftercare tests). Changed server files passed syntax checks; both HTML pages' inline scripts parsed; `git diff --check` passed.

Local tests use only synthetic in-memory SQLite with the baseline and additive migrations; no live database is accessed. They cover calendar arithmetic, actual API save/reload, job scoping, duplicate protection, completion and reopening, date corrections, closed-job overdue/calendar rendering, pre-0022 compatibility, transaction rollback and inline script syntax.

Live staging migration/deployment, browser/iPhone acceptance and authentication/role acceptance remain pending: Cloudflare credentials are not configured in this workspace. No customer records or external services have been changed.
