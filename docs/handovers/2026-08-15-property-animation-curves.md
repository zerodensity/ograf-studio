# Handover — 2026-08-15 — Property animation and curves

## Branch and revision

- Branch: `master`
- Last commit: none; the repository currently has no committed revision
- PR or issue: roadmap section 3, Broadcast authoring
- Working tree clean: no; the existing repository contents and this implementation are untracked

## Objective

Implement the requested timeline/animation phase before canvas/layout work: independent
per-property tracks, a visual easing editor, animatable blur/drop-shadow values, and practical
retiming tools while preserving mandatory OGraf v1 compatibility.

## Completed and verified

- Upgraded project documents to v5 with independently timed transform and numeric effect tracks.
- Added lossless v4 migration and legacy lazy resolution.
- Added per-property evaluation to the editor, compiled descriptor, and exported GSAP runtime.
- Added per-key named easing or custom cubic Bézier data and a visual draggable curve editor.
- Docked easing, curve, and retiming controls in a fixed right-side Keyframe Editor so selection
  changes never resize or vertically displace the ruler and tracks.
- Made blur, shadow alpha, offsets, and softness animatable; enable and color remain static.
- Added property-row insertion, deletion, selection, dragging, and context menus.
- Added key nudge, track offset, scale, reverse, and distribute controls with collision protection.
- Extended semantic validation and regression coverage for tracks, effects, curves, and retiming.
- Passed the live in-product OGraf v1 certification with a custom curve in the authored project.

## In progress

None in this phase.

## Next actions

1. Begin the user-approved Canvas and layout phase: safe areas, rulers/guides, and snapping first.
2. Continue with alignment/distribution, locking, persistent groups, and parenting.
3. Finish responsive constraints plus bounds/overflow controls and re-certify representative output.

## Decisions made

- `layer.animationTracks` is authoritative; legacy `layer.keyframes` remains a summary and migration
  compatibility representation.
- Each property key owns the easing used to approach it. A custom curve overrides its named preset.
- Retime operations never move lifecycle markers or other tracks and refuse duplicate-frame results.
- Only numeric CSS-filter values animate. Boolean enable state and shadow color remain discrete.

## Important files changed

- `packages/scene-model/src/types.ts`, `factory.ts`, `layerAnimation.ts`, `migrations.ts`
- `apps/editor/src/state/projectStore.ts`, `selectionStore.ts`
- `apps/editor/src/panels/TimelinePanel.tsx`, `EasingCurveEditor.tsx`, `InspectorPanel.tsx`
- `packages/ograf-types/src/descriptor.ts`
- `packages/codegen/src/compileDescriptor.ts`
- `packages/ograf-runtime/src/buildRuntimeTimeline.ts`, `easing.ts`
- `packages/validation/src/validateProject.ts`

## Verification

- `npm run verify`: passed; formatting, lint, typecheck, 100 tests, and production build succeeded
- Manual or external OGraf verification: in-product certification passed all five checks—project
  semantics, official schema, package layout, module/default export/API, and realtime/non-realtime
  lifecycle

## Known failures and risks

- Range selection, copy/paste of keys, and simultaneous multi-track retiming remain future advanced
  timeline work.
- Custom cubic Bézier handles are constrained to the normalized 0–1 editor square; named Back and
  Elastic presets remain available for overshoot motion.
- Production editor chunk size remains the existing known warning.

## Environment and generated artifacts

- Manual browser verification used the Vite editor at `http://localhost:5175/`.
- No exported package or temporary fixture was retained.

## Uncommitted work

All repository content is currently untracked, including the files in this handover.
