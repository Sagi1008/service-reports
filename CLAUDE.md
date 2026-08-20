# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For the full functional/technical specification, see [docs/SRS.md](docs/SRS.md) — read it before making non-trivial changes. This file only covers what's needed to get productive fast.

Related docs, each answering a different question: [docs/PRD.md](docs/PRD.md) (what to build — prioritized requirements, out-of-scope), [docs/DIAGRAMS.md](docs/DIAGRAMS.md) (UML: use case / class / sequence / activity views of the actual system), [docs/PROCESS.md](docs/PROCESS.md) (how work on this project should be run — methodology choice and why).

**Keep docs/SRS.md current.** Whenever a change alters what's described there — a new capability, a data-model/collection change, an architectural shift, a security-relevant change — update the relevant section of the SRS as part of that change, not as an afterthought. Don't wait to be asked.

## What this is

Oficiency — a Hebrew RTL web app for field technicians (service reports, site/equipment management), deployed to Firebase Hosting at https://oficiency-1bbf9.web.app. All app code lives in `frontend/`; there is no build step (plain ES Modules loaded directly by the browser — no bundler, no npm build/lint scripts).

## Commands

**Deploy the frontend:**
```bash
firebase deploy --only hosting
```
Before deploying any change to `frontend/`, bump the cache-busting version query string (`?v=1.x.x`) on every `<link>`/`<script>` tag in `frontend/index.html`. Browsers otherwise keep serving stale cached CSS/JS.

**Deploy security rules** (after testing them — see below):
```bash
firebase deploy --only firestore:rules
firebase deploy --only storage        # NOT "storage:rules" — that exact flag combo
                                       # throws "Could not find rules for the
                                       # following storage targets: rules" (a
                                       # firebase-tools CLI bug); "storage" alone works.
```

**Test Firestore/Storage security rules** before touching them — there's an automated rules-unit-testing suite at `tests/rules.test.js` covering every collection's access rules (owner/admin/anon scenarios):
```bash
npm install   # first time only — installs firebase + @firebase/rules-unit-testing devDeps
firebase emulators:exec --only firestore,storage --project oficiency-1bbf9-rules-test "node tests/rules.test.js"
```
Use a project id other than the real `oficiency-1bbf9` for this (it only talks to the local emulator, never production, but keeps seeded test data isolated).

**Run the full app locally against emulators:**
```bash
firebase emulators:start
```
`frontend/Js/api.js` auto-detects `localhost`/`127.0.0.1` and connects to the emulators (Firestore :8080, Auth :9099, Storage :9199, UI :4000) instead of production — no config needed.

**E2E smoke test** (`playwright-test.js`, drives a real browser against `http://localhost:5000` — needs the hosting emulator running):
```bash
OFICIENCY_TEST_EMAIL=<admin-email> OFICIENCY_TEST_PASSWORD=<password> node playwright-test.js
```

There is no lint/format tooling configured in this repo — don't invent an eslint/prettier setup unasked.

## Architecture

**Everything is Firebase.** No backend server, no Cloud Functions. The browser talks directly to Firebase Auth, Firestore, and Storage. (A `backend/` FastAPI+SQLite server existed early in the project's history but was unused dead code and was removed — don't resurrect that pattern without a real reason.)

**Module layout** (`frontend/Js/`):
- `api.js` — Firebase init, the global in-memory state object `S`, every Firestore/Storage call, RBAC helpers (`isAdmin()`, `canEditReport()`). This is the only file that should talk to Firebase directly.
- `app.js` — bootstraps auth, exposes functions on `window.*` (required because HTML has inline `onclick="..."` handlers — any new user-facing action needs a `window.x = x` line here), tab switching, mobile viewport/keyboard fixes.
- `ui.js` / `reports.js` — rendering and CRUD logic for reports/templates/folders. `reports.js` also owns the daily-log and weld-inspection form types, and re-exports `preloadLogo`/`downloadPDF` from `utils/pdfGenerator.js` so existing imports keep resolving.
- `components/` — self-contained feature panels (HomeTab, EquipmentTab, ManagerPanel, AdminPanel, folderBoard, taskComponent). `AdminPanel.js` and `ManagerPanel.js` overlap in purpose (registration approval) — `ManagerPanel` is the newer, more complete one; `AdminPanel` is a thinner legacy leftover, not yet consolidated.
- `utils/pdfGenerator.js` — client-side PDF export via html2canvas + jsPDF. This is the *only* PDF generator in use; there is no server-side PDF path.

**State model:** a single global object `S` (defined in `api.js`) holds everything in memory — reports, folders, templates, attachments, procedures, equipment, current selection. Firestore `onSnapshot` listeners set up in `hydrate()` keep `S` synced live across devices/tabs; UI code reads `S` directly rather than re-fetching.

**RBAC is a single hardcoded admin email**, duplicated as a literal string across `api.js`, `app.js`, `HomeTab.js`, `EquipmentTab.js`, `AdminPanel.js`, and `ManagerPanel.js` (currently `sagi.tisson@oficiency.com`). There is no roles system — adding a second admin means updating all of those. Ordinary technicians can only edit reports where `report.createdBy` matches their own email (`canEditReport()` in `api.js`); this same rule is mirrored server-side in `firestore.rules`.

**Firestore/Storage security rules are real access control, not `if true`.** They were locked down from a fully-open state — see `docs/SRS.md` §8 for the history. Key structural point: `registration_requests` holds plaintext passwords (needed to create/delete Firebase Auth accounts client-side via a secondary app instance) and is therefore locked to admin-or-self reads only. A separate `team_directory` collection (name+email, no password) mirrors approved users for anything that needs a broadly-readable team list (e.g. the equipment handover picker) — when adding a feature that needs to list users, read from `team_directory`, never from `registration_requests`. Any change to `firestore.rules`/`storage.rules` must be run through `tests/rules.test.js` against the emulator before deploying (see Commands above) — don't hand-verify rule changes by reasoning alone; the emulator has caught real bugs here before (see git history / SRS §8 for the cross-service `firestore.get()` emulator limitation that forced a simpler rule design for report-image ownership).

**Report data model:** a report's `serviceType` (`routine`/`fault`/`extra`/`other`/`daily_log`/`weld_inspection`) determines which form renders — `daily_log` and `weld_inspection` are entirely different form shapes (see `_emptyDailyLog()`/`_emptyWeldInspection()` and their render/collect functions in `reports.js`), not just different fields on the same form.

**Images/signatures** are captured as `data:` URLs client-side, then uploaded to Firebase Storage at save time (`apiSaveReport` in `api.js`) and replaced with `https://` download URLs in the Firestore document — Firestore documents are capped at 1MB and a single phone photo would exceed that if embedded directly.
