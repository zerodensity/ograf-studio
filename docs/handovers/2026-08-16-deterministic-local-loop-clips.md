# Handover — 2026-08-16 — Deterministic local property-loop clips

## Branch and revision

- Branch: repository has no established committed baseline; all files remain untracked.
- Last commit: none in the current workspace baseline.
- Working tree clean: no — preserve the user's existing work and do not reset it.

## Objective

Add OGraf-compatible, deterministic looping animation without creating competing layer timelines or
changing the finite lifecycle/Step workflow. A layer may own one local loop clip containing any
number of independently keyed property tracks.

## Completed and verified

- Scene-model document version 9 adds an optional local loop clip to each layer. Existing projects
  migrate with `loop: null`.
- Loop clips support lifecycle or named-Step activation, duration, phase offset, finite or infinite
  repetition, and independent incoming easing on each property key.
- The loop clock is derived from absolute elapsed time rather than accumulated frame ticks. Seeking,
  dropped display frames, and non-realtime schedule sampling therefore do not change loop phase.
- The compiled runtime layers loop values over the ordinary finite pose. Alpha may flash while
  width and height pulse with different keys and easing, without duplicating the layer timeline.
- Realtime playback continues past a reached Step while the local loop remains active. Departing a
  Step captures and decays the loop delta across the finite outgoing transition to avoid a visual
  snap.
- The editor Keyframe Editor can create, configure, preview, extend, and remove a selected layer's
  loop. Loop preview is editor-only and restores the finite playhead pose when stopped.
- Authoring-core and MCP expose revision-safe `set_layer_loop`, `set_loop_property_track`, and
  `remove_layer_loop` operations. `ograf_sample_tracks` accepts `loopElapsedFrame` for browser-free
  deterministic inspection.
- Validation covers activation references, duration, repeat counts, property applicability, finite
  key values, frame range, duplicate frames, and infinite-loop seam mismatches.
- Layer duplication and group duplication regenerate loop/key IDs and preserve independent copies.
- The repository `ograf-authoring` Skill documents the loop workflow and recommends deterministic
  sampling rather than wall-clock or mutable-counter logic.
- A read-only browser check confirmed the loop editor is reachable from a selected property row;
  the user's visible project was not mutated.

## Verification

- Full `npm run verify`: passed — formatting, lint, all workspace typechecks, 39 test files / 183
  tests, runtime build, and editor production build. The existing large-editor-chunk warning remains.
- New unit coverage verifies modulo phase, per-key easing, finite terminal hold, compiled visual
  overlays, authoring-session operations, migration, MCP timeline inspection, and MCP track sampling.
- `skills/ograf-authoring` passes the Skill validator.

## Important files changed

- `packages/scene-model/src/{types,factory,migrations,loopAnimation,layerAnimation}.ts`
- `packages/ograf-types/src/descriptor.ts`
- `packages/codegen/src/compileDescriptor.ts`
- `packages/ograf-runtime/src/{loopRendering,GraphicElement}.ts`
- `packages/authoring-core/src/{types,operations}.ts`
- `packages/validation/src/validateProject.ts`
- `apps/editor/src/{canvas/Stage,state/projectStore,state/timelineStore,panels/TimelinePanel}.tsx`
- `apps/mcp-server/src/{schemas,mcpServer}.ts`
- `skills/ograf-authoring/`
- `docs/{STATUS,ARCHITECTURE,ROADMAP}.md`
- `docs/decisions/ADR-004-deterministic-local-loop-clips.md`

## Known limitations and risks

- Version 1 supports one loop clip per layer, but that clip may contain many property tracks.
- Repeat playback is implemented; ping-pong and multiple independently activated clips on one layer
  remain roadmap items.
- A masked text layer can loop its X position to create a conventional crawl. Dedicated ticker
  content queues, item recycling, separators, and live insertion policies are not implemented yet.
- Width/height pulse changes layout dimensions. A future scale transform would provide a distinct
  transform-only pulse, but `scaleX` and `scaleY` are not current animatable properties.
- Realtime outgoing transitions receive loop-delta continuity correction. Non-realtime schedule
  sampling is deterministic, but exact realtime-style mid-exit correction parity needs a dedicated
  scheduled-transition regression before it should be claimed.
- Loops are compiled runtime behaviour, not lifecycle triggers. They cannot invoke another Step,
  timeline, or external action.

## Environment

- MCP server was restarted from the verified source and is healthy at
  `http://127.0.0.1:4318/mcp`.
- Editor bridge reconnected successfully at `http://localhost:5173/`; the visible project remained
  unchanged.

## Next milestone

- Add browser certification fixtures specifically exercising an authored loop through realtime and
  non-realtime lifecycle playback.
- Consider ping-pong, multiple clips, scale properties, and dedicated ticker authoring only after
  the single-clip semantics are proven in production workflows.
