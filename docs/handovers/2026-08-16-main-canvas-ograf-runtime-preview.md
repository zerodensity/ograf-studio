# Handover — 2026-08-16 — Main-canvas OGraf runtime preview

## Branch and revision

- Branch: repository has no established committed baseline; all files remain untracked.
- Last commit: none in the current workspace baseline.
- Working tree clean: no — preserve the user's existing work and do not reset it.

## Objective

Make the playout behavior visible in the primary workspace by adding an Edit / OGraf Preview mode
switch to the main canvas and driving the actual compiled runtime through standard OGraf lifecycle
methods.

## Completed and verified

- Edit mode retains the existing authoring Stage and adds a clear OGraf Preview switch.
- Entering preview captures a deep-cloned project snapshot and mounts the shared compiled
  `GraphicElement` in the same canvas pasteboard, with the same fit/manual zoom, Ctrl/Command zoom,
  checkerboard, and middle-button panning behavior.
- Preview mode does not render authoring layers, selections, Moveable controls, guides, rulers, safe
  areas, or data-binding dots.
- The main toolbar provides realtime/non-realtime load characteristics, Load, Previous Step, Next
  Step, Go to Step, Update Data, Stop/Take Out, Dispose, custom actions, and visible runtime state.
- Previous/next/goto controls call `playAction`; the UI does not reconstruct or simulate OGraf
  lifecycle behavior.
- Update Data resolves values from the existing design-time Test Data store and sends them to the
  loaded snapshot without editing source data fields.
- Project changes while previewing leave the running instance untouched and show an explicit Reload
  Preview warning. Content fingerprints avoid false invalidation when a bridge handshake replaces
  the project with structurally identical data.
- Returning to Edit disposes the preview instance and remounts the normal authoring Stage. Preview
  actions do not enter project revision or undo history.
- The detailed Preview & Export panel remains available for action logs, non-realtime schedules,
  certification, source save, and package export.

## Verification

- Editor typecheck and repository lint: passed.
- Browser interaction: passed Load, Next Step, Previous Step back to Start, Update Data, Stop/Take
  Out, Dispose, and return to Edit on the main viewport. The runtime rendered the expected Step pose,
  reported Step 1/1, disabled navigation after End, and returned to the editable Stage without a
  stale warning.
- Full `npm run verify`: passed — formatting, lint, all workspace typechecks, 39 test files / 183
  tests, runtime build, and editor production build. Only the existing large-editor-chunk warning
  remains.

## Important files changed

- `apps/editor/src/canvas/RuntimePreviewStage.tsx`
- `apps/editor/src/canvas/RuntimePreviewStage.css`
- `apps/editor/src/canvas/{Stage,AddElementToolbar}.tsx`
- `apps/editor/src/canvas/AddElementToolbar.css`
- `apps/editor/src/layout/AppShell.tsx`
- `docs/{STATUS,ARCHITECTURE,ROADMAP}.md`

## Known limitations and risks

- The main toolbar does not duplicate the non-realtime schedule builder or detailed action log;
  those remain intentionally in Preview & Export.
- Editing remains possible from side panels and the timeline while the snapshot runs. Such changes
  do not affect the runtime instance and instead produce the explicit stale-snapshot warning.
- The snapshot uses the shared descriptor/runtime path, but exact-artifact module import and OGraf
  certification remain separate explicit gates in Preview & Export and save/export.

## Environment

- Browser verification used `http://localhost:5173/`.
- MCP remained available at `http://127.0.0.1:4318/mcp`; opening a verification tab did not author
  project changes.

## Next milestone

- Consider a compact Test Data drawer beside the main lifecycle controls if switching to the Data
  tab proves too slow in operator testing.
- Consider optional keyboard mappings for Next Step and Stop after the button workflow is validated
  with operators.
