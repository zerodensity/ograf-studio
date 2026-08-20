# Handover — 2026-08-16 — frame-zero synchronization and Timeline Folders

## Branch and revision

- Branch: repository has no established committed baseline; all files remain untracked.
- Working tree clean: no — preserve the user's existing work and do not reset it.

## Objective

Fix the intermittent frame-zero canvas state where alpha-zero layers stayed visible until selection,
then add scalable, UI-only timeline organization without changing MCP or compiled OGraf behavior.

## Completed

- Project replacement and New stop the outgoing controller and clear transient frame/playback state.
- The shared GSAP runtime explicitly reapplies each layer's initial transform, transform origin, and
  effects whenever an already-advanced timeline seeks to exact time zero.
- Document v7 stores named, colored Timeline Folders in authoring layout metadata.
- Timeline folders can be created from the current layer selection, renamed inline or from the
  context menu, recolored, collapsed/expanded, selected as a unit, and dissolved without deleting
  members.
- Folder members keep their original `composition.layers` paint order and independent property
  tracks. Persistent object groups remain a separate canvas-transform concept.
- Compiler coverage confirms folder metadata is absent from `CompiledGraphicDescriptor`; existing
  MCP operations and stable layer IDs are unchanged.
- Migration backfills an empty folder list and removes stale/duplicate member references. Layer
  deletion also removes empty folder membership safely.

## Verification

- Focused and full TypeScript typechecks passed.
- Full unit/integration suite passed: 32 files / 157 tests.
- Isolated-browser reproduction first confirmed the fault after autosave/reload: the UI read frame 0
  while two DOM layers retained opacity 1. After the runtime correction, both were opacity 0 before
  selection and remained opacity 0 after selection; frame-by-frame advance resumed interpolation.
- Browser folder checks passed for multi-selection creation, inline rename, color control presence,
  collapse/expand, complete member selection, context-menu dissolve, and autosave/reload persistence.
- Product OGraf v1 compatibility gate passed all five checks on the isolated two-layer folder
  fixture: project semantics, official manifest schema, package layout, module API, and realtime/
  non-realtime lifecycle.
- Full `npm run verify`: passed — formatting, lint, all workspace typechecks, 32 files / 157 tests,
  and production builds (only the known large-editor-chunk warning).

## Important files

- `packages/ograf-runtime/src/buildRuntimeTimeline.ts`
- `packages/ograf-runtime/src/buildRuntimeTimeline.test.ts`
- `packages/scene-model/src/types.ts`
- `packages/scene-model/src/factory.ts`
- `packages/scene-model/src/migrations.ts`
- `packages/validation/src/validateProject.ts`
- `packages/codegen/src/compileDescriptor.test.ts`
- `apps/editor/src/state/timelineStore.ts`
- `apps/editor/src/state/projectStore.ts`
- `apps/editor/src/panels/TimelinePanel.tsx`
- `apps/editor/src/panels/TimelinePanel.css`
- `apps/editor/src/panels/timelineFolders.ts`

## Remaining risks

- Expanded/collapsed folder state is intentionally local and does not travel with `.ogeproj`; names,
  colors, and membership do.
- Timeline folders currently support one level. Nested folders and drag/drop membership are future
  workflow enhancements, not required for the present many-layer/day organization use case.
