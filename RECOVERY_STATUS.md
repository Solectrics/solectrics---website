# Local usability recovery

Stage 1: restored mobile navigation, section expansion, job search/filtering,
reviewed bill corrections, document library, source-to-design comparison and
Fletcher attachment review from the pinned donor snapshots.

Validation: 101 synthetic tests passed using:
`node --test --test-isolation=none --test-concurrency=1 tests/*.test.mjs`.
The donor deployment-wrapper tests were replaced with recovery canonical-host
checks because deployment scaffolding is deliberately absent. The temporary
provider metadata diagnostic was removed.

This is a local candidate. No staging/production runtime allowance is added for
the backup branch. Its exact name remains excluded from Pages preview builds
under the user-verified safety agreement. No migrations or deployment occurred.
Operations, Aftercare and complete retrospective HEC editing are next.
Security candidate f42de493 is not included.

Stage 2: Operations calendar/tasks/readiness and shared Handover & Aftercare
panels recovered. Unique follow-up keys and transactional handover preserve
14-day/calendar-month scheduling without duplicate tasks. 125 synthetic tests
pass. New Operations endpoints are deliberately gated to loopback plus the
explicit local testing flag. Missing schema fails closed. Only 0021/0022 are
prepared; schema-only source confirms no accounting migration prerequisite.
Migration files have not been executed. Test schemas are synthetic CREATE DDL.
