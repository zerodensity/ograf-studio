# Handover — 2026-08-16 — Agent-first MCP round 2

## Objective

Implement the second agent-session findings without changing existing signatures/defaults or
weakening optimistic concurrency, atomic batches, dry run, workspace scope, or certification.

## Completed

- First-class creation `results`, including IDs in the primary text response.
- Step-frame, backing-aware contrast lint with full/partial/unbacked handling.
- App-level heartbeat health (`connected`, `responsive`, latency, time, likely cause) and shared
  browser-operation timeout diagnostics.
- Browser-free `ograf_sample_tracks` with resolved values and derived bounds.
- Rich dry-run diagnostics and projected interlace lint.
- `update_data_field` and guarded/forced `remove_data_field`.
- Undoable, confirmed `ograf_reset_project` with optional field retention.
- Default validation hint for unrun lint, computed safe-area pixels, browser dependency discovery.
- Bounded `ograf_get_changes` history and transition-retiming warnings.
- Updated `ograf-authoring` Skill and workflows.

## Source discrepancies confirmed

- The core already collected generated IDs in `summary.generatedIds`; the MCP primary text response
  discarded that visibility by reporting only a count. Existing summary behavior remains, with a
  new top-level result projection and ID-bearing text.
- Contrast lint already attempted a centre-point backing lookup, but it emitted the mid-grey warning
  unconditionally first and evaluated only one frame. It now uses full bounds/coverage per Step.

## Verification

- Targeted authoring-core and MCP tests cover IDs without reread, contrast full/partial/unbacked,
  heartbeat responsiveness/timeouts, disconnected sampling, dry-run lint, field removal, safe-area
  pixels, reset/undo, revision history, and retiming warnings.
- Live MCP fixture confirmed a complementary wipe remains at `right = 1112` on frames 9/13/17/22,
  backed Role text produces no false contrast warning, and a real 2 px divider still warns.
- The live fixture passed all five exact-artifact OGraf certification gates.
- Full `npm run verify` passed: formatting, lint, all workspace typechecks, 28 files / 135 tests,
  and runtime/editor production builds (only the existing large-editor-chunk warning).
- The updated `ograf-authoring` Skill passed `quick_validate.py`.
- The in-app browser does not throttle background tabs in this environment, so tab-backgrounding
  stayed responsive; an integration test uses an open WebSocket that withholds heartbeat/capture
  replies to reproduce and verify the unresponsive state and actionable timeout message.

## Decisions

- Existing defaults remain unchanged. Default validation now says optional lint was not run rather
  than silently resembling a complete pass.
- In-batch aliases were not added. They complicate operation schemas and dry-run identity; direct
  creation results remove the mandatory lookup round trip without introducing a second ID language.
- Transition duration changes warn but never retime automatically.

## Known follow-ups

- Consider project-level progressive/interlaced target metadata rather than a validation-call flag.
- Add a long-running real-browser throttling test on a browser surface that actually applies
  background timer throttling.
- Consider retaining change history across MCP server restarts if cross-process audit is required.
