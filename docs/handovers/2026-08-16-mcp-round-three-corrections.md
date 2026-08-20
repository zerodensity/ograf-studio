# Handover — 2026-08-16 — MCP round-three corrections

## Branch and revision

- Branch: repository has no established committed baseline; all files remain untracked.
- Working tree clean: no — preserve the user's existing work and do not reset it.

## Objective

Close the remaining agent-throughput and correctness faults found while rebuilding the seven-day
weather board, without weakening atomic batches, optimistic concurrency, browser certification, or
the certified save/export path.

## Completed and verified

- `duplicate_group.frameOffset` shifts only non-lifecycle authored keys. Start/Step/End compatibility
  keys remain anchored, while genuine authored keys moved outside the duration still reject the
  complete transaction.
- Exact `layerName` and `fieldKey` selectors resolve layers/fields created earlier in the same atomic
  batch through internally preallocated stable IDs.
- `update_data_field` accepts either `fieldId` or unique `fieldKey`, so cloned repeated-cell content
  can be retargeted without a project read.
- Committed and dry-run apply responses include every authoring warning in primary text with the
  originating operation index and affected layer.
- Safe-area lint exempts full-width and full-height bleed independently per axis and names the axis
  that remains out of bounds.
- The first editor hello initializes revision-zero baseline state without history. Equal reconnects
  are no-ops; divergent tabs receive the authoritative session snapshot rather than incrementing the
  revision in a last-writer-wins loop.
- `ograf_delete_session` provides confirmed cleanup for temporary non-editor sessions and cannot
  delete the live editor session or saved files.
- The `ograf-authoring` Skill fixes the capture/strip sentence, documents `namePattern`,
  `labelRewrite`, same-batch selectors, field-key updates, and corrected frame-offset semantics, and
  adds a worked repeated-cell example. The Skill validator passes.
- Existing bridge health already reports `editor.certificationReady: false` whenever a backgrounded
  editor is unresponsive, so the optional throttling preflight requested no code change.

## Decisions made

- Lifecycle-frame keys are treated as compatibility anchors during duplication; non-lifecycle keys
  are the staggerable authored animation surface. If a shifted authored key lands on a lifecycle
  frame, it replaces the redundant property anchor at that frame without creating a duplicate.
- MCP preallocates IDs only internally. Existing tool input signatures and client defaults remain
  compatible, while dry-run IDs retain their documented hypothetical status.
- A first editor connection may establish the in-memory baseline at revision zero. Once initialized,
  the MCP session is authoritative during reconnect and multi-tab conflicts.
- Session cleanup is explicit and confirmed rather than TTL-based, avoiding surprising deletion of
  long-running authoring sessions.

## Important files changed

- `packages/authoring-core/src/operations.ts`
- `packages/authoring-core/src/types.ts`
- `packages/authoring-core/src/session.ts`
- `packages/authoring-core/src/session.test.ts`
- `apps/mcp-server/src/mcpServer.ts`
- `apps/mcp-server/src/schemas.ts`
- `apps/mcp-server/src/editorBridge.ts`
- `apps/mcp-server/src/workspace.ts`
- `apps/mcp-server/src/mcpServer.test.ts`
- `skills/ograf-authoring/SKILL.md`
- `skills/ograf-authoring/references/tool-workflows.md`
- `skills/ograf-authoring/references/examples.md`

## Verification

- Targeted authoring-core/MCP regression suite: 2 files / 39 tests passed.
- Nine-layer acceptance fixture: six copies at `frameOffset: 2` succeeded in a 50-frame composition;
  `ograf_sample_tracks` confirmed D1/D4/D7 authored keys at frames 38/44/50 while lifecycle anchors
  remained within 0/30/50.
- Same-batch layer/field creation and binding passed; cloned fields were retargeted by key without an
  intervening `ograf_get_project` call.
- Committed and dry-run shrink warnings named operation 0 and `D1 Day`; full-width/full-height lint
  exemptions and divergent editor handshake behavior passed integration tests.
- Full `npm run verify`: passed — formatting, lint, all workspace typechecks, 29 files / 151 tests,
  runtime/editor production builds (only the known large-editor-chunk warning).
- `quick_validate.py skills/ograf-authoring`: passed.

## Known failures and risks

- The full weather-board browser retest was not run against the already-running user session because
  restarting its MCP process would discard that in-memory project. The decisive duplicate/sample,
  selector, warning, lint, and handshake paths are covered by isolated real MCP integration tests.
- Same-batch selectors intentionally cover ordinary layer/field creations. Variable-size
  `duplicate_group` outputs remain follow-up targets through returned mappings or deterministic
  rewritten field keys.
- No commit exists, so handover depends on this dated note and verification output.

## Next actions

1. Restart the MCP server when the current live session is safely saved, then rerun the full
   seven-day board protocol with one foreground editor tab.
2. Confirm the reference board reaches fewer than 10 advisory lint warnings and passes consecutive
   certification plus certified save/export.
3. Add a stable browser E2E harness for multi-tab conflict messaging and background throttling.
