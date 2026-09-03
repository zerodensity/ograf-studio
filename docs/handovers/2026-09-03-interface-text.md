# Handover — 2026-09-03 — Smaller interface text

## Objective and changes

User requested that all interface text be slightly smaller. The primary UI token changes from
14 to 13 px and compact text from 13 to 12 px. Body-portalled context menus change from 12 to
11 px and now derive their size from the compact token. The existing typography-contract test
was updated for the requested values; no new tests were added for this styling adjustment.

Files: `apps/editor/src/index.css`, `components/ContextMenu.css`, and `uiTypography.test.ts`.
Current typography descriptions in STATUS, ARCHITECTURE and ROADMAP were updated. Historical
release notes retain their original measurements. Authored scene data and runtime typography
were not edited.

## Verification

- `npm run verify`: passed, including 466 tests in 95 files, types, lint, formatting, contract and
  prompt checks, and runtime/editor builds. The existing bundle-size advisory remains.
- Standalone build and executable packaging passed.
- Browser computed sizes: UI 14→13 px; compact 13→12 px; right-click menu labels now 11 px.
- Graphic text measured identically before/after: name 46.7 px, title 25.9 px, label 23.9 px.
- The current lower-third project was restored unchanged and returned to its on-air frame.

## Installation and recovery

- Running server: `C:\works\zd_ograf_editor\release\OGrafStudioServer.exe`, port 4318.
- SHA256: `BE3AF0374DA632EAA8BC180400F387F5C7E8BC55CA1F716E72786177965A047B`.
- Previous binary: `release/OGrafStudioServer-before-compact-ui.exe`.
- Certified project backup:
  `C:\Users\smalkim\Documents\OGraf Studio\Projects\Session Backups\Before UI text adjustment 2026-09-03.ogs`.
  A redundant second certification timed out; the existing certified backup was compared with
  the current project and matched exactly before it was used for restoration.
- External source checkpoint: `C:\Users\smalkim\Documents\ChatGPT\Ograf\studio-interface-text-deliverables`.
- Existing uncommitted work is preserved. No commit or push was requested. MCP schemas and
  authoring skills are unchanged because this update only changes interface styling.
