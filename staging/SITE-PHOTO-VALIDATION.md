# Contextual Site Visit photos — staging acceptance

Uses existing job_files, POST /api/job-files, GET /api/job-files and GET /api/job-file; no API, schema, migration or storage configuration changes.

Contexts are explicit caption markers plus existing categories: roof measurements/condition (roof), switchboard, meter, inverter/battery locations (equipment), cable route, access (site_photo). All use document_role=general. They are not OpenSolar roof_layout documents. Existing unclassified photos remain in the library and are not assigned by guessing. Capture receipt markers are hidden from normal caption presentation.

Each upload has its own queue state. Confirmed successes are not resent. Explicit JSON rejection allows retry of that photo. A lost/redirected/unreadable response becomes unconfirmed and permits only attachment lookup, not another write. Exact receipt marker match confirms one saved file; zero or multiple matches remain unconfirmed. There is no server idempotency added or offline upload promise. Reloading loses unsent image bytes; saved images remain in Documents.

Site Visit field drafts are retained in localStorage scoped to origin and job ID. A differing draft prompts Restore / Keep loaded values. Restore changes the mounted fields, not server records; review and edit to use normal autosave. Photos can upload with incomplete Site Visit fields. Camera/picker controls are excluded from the existing Site Visit autosave trigger so selecting an image does not rewrite System Design. Device storage failure is surfaced.

## Acceptance using the existing synthetic staging job

1. On actual iPhone Safari, open Site Visit. Enter a roof measurement, tap TAKE PHOTO, take/use the image and confirm the field remains and thumbnail appears.
2. Confirm the same photo appears once in Documents with category Roof and general document use. It must not satisfy Fletcher's OpenSolar layout requirement.
3. Choose multiple existing photographs. Confirm separate statuses and saved thumbnails.
4. Verify switchboard, meter, inverter/battery, route/access contextual controls.
5. Leave a partial Site Visit and reopen: if device/server values differ, restore the draft deliberately. Do not assume the device draft is a server save.
6. Check desktop picker fallback and narrow mobile layouts.
7. For a genuinely failed upload, retry only the failed photo. For save-unconfirmed, use CHECK SAVED FILES; do not upload again blindly.
8. Recheck Fletcher download/email prerequisites and central document upload.

Local tests use synthetic files and mocked responses. No live photos, email or production resources were accessed. Native iPhone camera and authenticated staging storage remain to be verified.
