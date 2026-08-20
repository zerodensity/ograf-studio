# Handover — Independent Layer Timelines

Date: 2026-08-15  
Milestone: Animate-style independent object keyframes

## Outcome

Document version 3 replaces composition-wide layer poses with independent layer transform keys on a
shared frame ruler. The timeline now supports selecting a layer, adding a key at the playhead,
double-clicking a layer row to key it, dragging that key to another frame, deleting it, and editing
its easing. Canvas or Inspector transform edits auto-key only the selected layer at the current frame.

OGraf lifecycle markers remain a separate global track. Editor canvas, preview, non-realtime seeking,
and exported graphics all consume the same compiled independent tracks.

## Main files

- `packages/scene-model/src/layerAnimation.ts`
- `packages/scene-model/src/migrations.ts`
- `packages/codegen/src/compileDescriptor.ts`
- `packages/ograf-runtime/src/buildRuntimeTimeline.ts`
- `apps/editor/src/panels/TimelinePanel.tsx`
- `apps/editor/src/state/projectStore.ts`
- `apps/editor/src/canvas/Stage.tsx`
- `apps/editor/src/panels/InspectorPanel.tsx`

## Verification

`npm run verify` passes with 52 tests. Browser verification created Rectangle and Text tracks, added
a Text-only key at frame 7, edited it, and dragged it to frame 10. Rectangle remained keyed only at
0/12/24. The exported runtime independently rendered Rectangle at X=100 and Text at X=546.4 at
frame 6; canonical manifest validation passed and the browser console was clean.

Follow-up fix: Moveable drag/resize/rotate events now publish transient transforms through
`selectionStore` on every pointer update. Inspector merges that transient patch into its authored
frame sample, then Stage commits once and clears the patch on gesture end. Verification now passes
with 52 tests.

Timeline readability follow-up: layer IDs deterministically produce distinct HSL track colors. The
gutter swatch, key diamonds, and every key-to-key span share that color; spans of at least four frames
show an inline duration label, and the ruler labels every five frames. Browser verification produced
three distinct tracks and correctly split an Ellipse into 7f/5f/12f spans after inserting frame 7.

Playback transport follow-up: Timeline now exposes previous frame, play/pause, stop-to-frame-zero,
and next frame controls backed by Stage's single GSAP controller. Play at the completed boundary
restarts from frame zero. Current frame, total frames, and elapsed duration stay visible and update
live; the buttons have accessible names and disabled boundary states. Browser verification covered
single-frame stepping, live playback, pause, stop, and replay from the end. Duration formatting has
focused unit coverage.

Scrubbing follow-up: the current-frame line now has a prominent draggable head with a 20px mouse
target. Pointer-dragging the head, ruler, or empty layer-track space continuously seeks the shared
timeline, pauses active playback, and clamps to frame 0 / the composition end. Layer key diamonds
still own their pointer gesture, so moving a key cannot accidentally scrub the playhead.

Composition preset follow-up: the preset catalog now contains only Full HD 1080p and UHD 2160p,
each at 25, 29.97, 30, 50, 59.94, and 60 fps. Fractional labels store 30000/1001 and 60000/1001
rather than rounded timing values. The former 720p entries were removed; custom width/height input
remains available for deliberately authored non-preset graphics.

Selection-overlay follow-up: Moveable's nested resize drag previously began at `[0,0]` because the
editor parser understood Moveable's `translate(...)` but not GSAP's `translate3d(...)`. Resizing a
layer at X/Y 100 therefore reset the target translation while Moveable retained its former control
geometry. A shared parser now handles translate, translate3d, matrix, rotation, and identity forms;
drag, resize, and rotate start events are seeded from the live transform, and Moveable uses React's
synchronous flush integration so its overlay follows every gesture update.

Rotation-discoverability follow-up: Moveable `rotateAroundControls` adds an outer interaction ring
around every direction handle. The visible corner itself still resizes; dragging just outside it
rotates. The original top rotation handle remains and is now larger, accented, and marked with a
rotation glyph. Committed geometry uses `updateTarget()` rather than only `updateRect()`, because the
former refreshes transform-origin state as well as the selection bounds.

Alpha-control follow-up: the former raw 0–1 Opacity number in the transform grid is now a prominent
Alpha control with a 0–100% range slider and numeric percentage input. It still writes the existing
`LayerTransform.opacity`, so changes auto-key at the current frame, interpolate through the shared
timeline, and compile unchanged into the exported runtime. UI conversion clamps invalid percentages
and preserves one decimal place.

Off-canvas authoring follow-up: Stage now presents a scrollable editor-only pasteboard with one full
composition of working space beyond every edge. The pasteboard, frame, layers, and Moveable overlay
share one scaled coordinate system; off-frame objects therefore remain visible and selectable, and
the overlay stays aligned during manual or gesture-driven scrolling. This changes only the design
surface—the preview and exported runtime retain the composition as their clipping/output boundary.

Background-appearance follow-up: the composition color picker is now always visible next to a more
explicit `Transparent output` control; choosing a color immediately selects an opaque background.
Transparent compositions show a zoom-stable checkerboard in both the Stage and Preview panels. The
pattern belongs only to their containing editor surfaces—the compiled descriptor still says
`transparent`, and the OGraf custom element itself remains transparent.

Pasteboard-appearance follow-up: the Stage checkerboard now covers the complete scrollable viewport,
including all off-canvas authoring space. A transparent composition reveals that same continuous
pattern through its frame, while an opaque composition color covers only the broadcast frame. A
contrasting frame outline keeps the output boundary visible without changing exported pixels.

Integer-authoring follow-up: scene-model normalization now rounds authored X/Y/width/height to whole
composition pixels (with size clamped to at least 1px) at factory, mutation, insertion, and migration
boundaries. Stage publishes rounded live gesture values, so Inspector stays integer during dragging
and resizing. `getLayerTransformAtFrame()` deliberately remains floating-point for smooth easing;
on an unkeyed frame the Inspector shows that evaluated pose separately from the rounded values that
would be used to create a new key. Rotation, opacity, and transform origins are never pixel-rounded.

Timeline-selection follow-up: every colored layer-name row in the gutter is now a semantic button.
Clicking or keyboard-activating it uses the same selection store as the canvas and track rows, so the
Inspector changes immediately and any previously selected individual keyframe is cleared.

Multi-selection follow-up: Ctrl/Command-click toggles layers from the canvas, Layers panel, and
timeline gutter into a transient selection set with the last-added layer as Inspector primary.
Moveable draws a scroll-corrected group boundary and group dragging applies identical deltas to all
members, auto-keying their independent tracks at the shared current frame. Single-item resize and
rotation remain deliberately disabled while multiple layers are selected; persistent scene grouping
is still future work. Delete removes all selected layers.

Constrained-drag follow-up: holding Shift while dragging one layer or a selection group chooses the
first dominant X or Y movement and freezes the other coordinate. Releasing Shift returns to free
movement; pressing it again during the gesture chooses a fresh axis. Live Inspector publication and
integer-pixel commit behavior remain intact.

Easing-catalog follow-up: transition and layer-key selectors now expose 31 trajectories: Linear plus
In/Out/In-Out variants of Quad, Cubic, Quart, Quint, Sine, Expo, Circ, Back, Bounce, and Elastic.
Legacy ease values remain valid aliases for Quad. The scene model owns pure easing equations and the
runtime passes those exact samplers to GSAP, removing the prior mismatch between editor quadratic
sampling and GSAP `power2` playback.

## Follow-up boundary

This milestone deliberately implements independent whole-transform keys, matching the requested
layer-row workflow. Per-property subtracks, hold frames, curve editing, span selection, copy/paste,
and multi-key operations belong to the next authoring milestone.
