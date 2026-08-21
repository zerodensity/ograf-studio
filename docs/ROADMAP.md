# Roadmap

## 1. Compliance foundation — implemented

- Explicit start/step/end model and migration.
- Normative lifecycle state machine and contract tests.
- Truthful non-realtime declaration.
- Shared timeline IR, strict schema validation, and blocked invalid exports.

## 2. Reliability and packaging — in progress

- Runtime/concurrency/cleanup tests, package smoke tests, migrations, browser E2E, and CI.
- Exact-artifact pre-save certification (official schema, package paths, module import/API, realtime
  and non-realtime lifecycle) is implemented; automated cross-browser CI remains queued.
- Versioned project documents.
- Asset-ID resource graph and deduplicated ZIP assets are implemented; packaged fonts and richer
  URL/internet-requirement validation remain queued.
- Best-effort OGraf package import is implemented with exact embedded-source preference,
  editor-descriptor reconstruction, packaged-image recovery, manifest-only third-party fallback,
  conversion validation, and a visible loss report. General opaque-JavaScript visual recovery is
  intentionally outside the safe importer boundary.

## 3. Broadcast authoring — queued (complete inventory; do not silently drop items)

- Independent per-property tracks for transform and numeric effects, plus a deterministic
  31-trajectory easing catalog and visual cubic Bézier editor (implemented).
- Collision-safe property-key nudging, track offset, proportional scaling, reversal, and even
  distribution retiming tools (implemented); range selection and multi-track retiming remain queued.
- Scrollable off-canvas pasteboard for authoring entrance/exit animations (implemented).
- Middle-button, pointer-captured canvas panning across the complete pasteboard (implemented).
- Pointer-anchored canvas-only Ctrl/Command-wheel zoom and Ctrl/Command-plus/minus shortcuts are
  implemented without invoking browser page zoom.
- Selectable opaque backgrounds and editor-only transparency checkerboards (implemented).
- Integer-pixel key authoring with subpixel runtime interpolation (implemented).
- Direct layer selection from timeline gutter names (implemented).
- Ctrl/Command multi-selection, group movement, and Shift axis-constrained dragging (implemented).
- Canvas and layer-timeline context menus for clipboard, deletion, held-frame, and sampled-key
  editing (implemented).
- Optional OGraf Step-aware editor playback and Spacebar Play/Pause outside editable controls are
  implemented.
- Bounded OGraf lifecycle-marker retiming is implemented with full-height drag targets, keyboard
  nudging, preview-only pointer movement, atomic adjacent-transition balancing, and stranded layer-
  key warnings. Start stays fixed and lifecycle reordering remains an explicit future operation.
- Safe areas, rulers/guides, grid/guide/layer snapping, alignment/distribution, authoring bounds and
  overflow preview, locking, persistent grouping, parenting, and responsive constraints
  (implemented). Persistent groups now have canvas context-menu Group/Ungroup commands, complete
  group selection from canvas/Layers/timeline, and a distinct move/resize/rotate overlay. Guide
  creation/movement/removal now follows Photoshop-style fixed viewport rulers. Numerical
  multi-layer transforms and constraint visualization remain polish items.
- Timeline Groups for organizing large layer sets are implemented with Ctrl/Command multi-select
  context-menu creation, persistent names/colors/membership, and local collapse state. Revisioned
  MCP operations expose create/rename/recolor/ungroup semantics, and the authoring Skill recommends
  them for related multi-layer components. They remain independent from canvas object groups and
  are excluded from compiled OGraf output.
- System-font selection with live preview and auto-size/shrink/fixed text policies (implemented);
  packaged fonts, richer overflow policies, localization, and RTL remain queued.

## 4. Advanced graphics — queued

- Deterministic layer-local multi-property loop clips are implemented with lifecycle/Step
  activation, finite or infinite repeat, independent easing, editor preview, compiled runtime
  playback, scheduled non-realtime sampling, validation, and MCP authoring. Ping-pong, multiple
  clips per layer, dedicated ticker content flow, and cycle-synchronized exits remain queued.

- Deterministic clip-to-parent masking is implemented for animated rotation-aware parent bounds and
  rounded rectangle corners, including diagonal wipes. Arbitrary alpha/luma/path masks remain
  queued alongside blend modes, video, nested compositions, and reusable components.
- Basic Lottie support is implemented as a first-class self-contained layer: JSON import/re-import,
  bundled light canvas player, absolute-time loop sampling, editor scrubbing, realtime playback,
  deterministic non-realtime seeking, validation, export, and MCP schema support. Segments,
  markers, one-shot playback, dynamic text/data overrides, external asset-folder packaging,
  renderer choice, and target-device compatibility certification remain queued.
- Rectangle and ellipse solid/linear/radial/conic paints are implemented, including whole-gradient
  data binding and independent animatable stop offsets. Per-stop data binding remains queued.
- CSS blur and configurable drop shadow, including per-property animation of numeric effect values,
  are implemented.
- Structured custom actions and full GDD controls.
- Canonical thumbnails, presets, release/version metadata, and compatibility targets.

## 5. Integration and experience — queued

- Main-canvas OGraf runtime preview is implemented as an Edit/Preview mode switch. It mounts an
  immutable compiled snapshot in the normal zoomable/pannable viewport and provides realtime Load,
  Step navigation/goto, Update Data, Stop/Take Out, Dispose, and custom-action controls. Snapshot
  invalidation is explicit; advanced schedules, logs, certification, and export remain in Preview &
  Export.
- Local AI-agent authoring is implemented through a revisioned MCP server, live editor bridge,
  exact-artifact certification tools, workspace-confined save/export, and a reusable
  `ograf-authoring` Skill. Browser-rendered PNG composition/viewport capture, diagnostic mattes,
  temporary data overrides, inferred font-fallback reporting, short-lived URLs, and optional inline
  MCP image responses are implemented. Browser-rendered, labelled frame contact sheets with
  lifecycle/midpoint defaults are also implemented. Complete element/schema semantics, compact
  project projections, browser text measurement/overflow stress tests, whole-track/stagger
  operations, and opt-in broadcast lint are implemented. Headless certification, authentication
  for non-local hosting, richer asset ingestion, subscriptions, and agent eval suites remain queued.
- Round-two agent ergonomics are implemented: responsive bridge health and timeout diagnosis,
  first-class creation IDs, backing-aware contrast, browser-free track sampling, diagnostic dry
  runs, field update/removal, undoable reset, computed safe areas, change history, dependency
  discovery, and transition-retiming warnings.
- Round-three throughput/correctness is implemented: shrink-to-fit floor/diagnostics, authored-vs-
  frame update scope, repeatable certification, asset references, independent group duplication,
  name/key/wildcard selectors, compact overflow validation, bleed-aware lint, and on-air capture
  defaults. Follow-up corrections keep lifecycle compatibility keys anchored during duplicate
  staggering, resolve same-batch selectors, expose warning text, apply per-axis bleed exemptions,
  make editor handshakes revision-neutral, allow field-key retargeting, and clean temporary sessions.
- Round-four capability work is implemented: clip-to-parent reveals compile into deterministic
  runtime masks, group duplication remaps clipping relations, clipped text/lint diagnostics use
  visible bounds, and structured gradient paint replaces fixed sheen assets without leaving the
  certified save/export path.
- Optional OGraf Server API renderer testing.
- Renderer compatibility matrix.
- Accessibility, onboarding, keyboard workflow, and documentation polish.
