# Roadmap

## 1. Compliance foundation — implemented

- Explicit start/step/end model and migration.
- Normative lifecycle state machine and contract tests.
- State-aware Stop/Take Out transitions go directly from the active rendered state to End in the
  declared stop duration, without traversing later Step poses (realtime and non-realtime).
- Truthful non-realtime declaration.
- Shared timeline IR, strict schema validation, and blocked invalid exports.

## 2. Reliability and packaging — in progress

- Runtime/concurrency/cleanup tests, package smoke tests, migrations, browser E2E, and CI.
- Browser-backed certification now runs in a disposable iframe realm, and certification, PNG
  capture, frame strips, and text measurement share one serialized browser-work queue.
- Exact-artifact pre-save certification (official schema, package paths, module import/API, realtime
  and non-realtime lifecycle) is implemented; automated cross-browser CI remains queued.
- Versioned project documents.
- Asset-ID resource graph and deduplicated ZIP assets are implemented. The Resources panel manages
  images, fonts, and source attachments with original filenames, sizes, usage guards, package paths,
  font family/weight/style previews, license metadata/text packaging, and missing-reference reports.
  Richer URL/internet-requirement validation remains queued.
- Best-effort OGraf package import is implemented with exact embedded-source preference,
  editor-descriptor reconstruction, packaged-image recovery, manifest-only third-party fallback,
  conversion validation, and a visible loss report. General opaque-JavaScript visual recovery is
  intentionally outside the safe importer boundary.

## 3. Broadcast authoring — queued (complete inventory; do not silently drop items)

- Independent per-property tracks for transform and numeric effects, plus a deterministic
  31-trajectory easing catalog and visual cubic Bézier editor (implemented).
- Multi-key selection and atomic group movement across layer/property timeline rows, with Ctrl/Cmd
  additive selection, same-row Shift ranges, bounds, and collision clamping (implemented).
- Collision-safe property-key nudging, track offset, proportional scaling, reversal, and even
  distribution retiming tools (implemented); range selection and multi-track retiming remain queued.
- Infinite off-canvas camera for authoring entrance/exit animations, with hidden scrollbars and no
  user-reachable boundary in the editor canvas (implemented).
- Middle-button, pointer-captured canvas panning with transparent camera recentering (implemented).
- Pointer-anchored plain-wheel canvas zoom and Ctrl/Command-plus/minus keyboard shortcuts are
  implemented without invoking browser page zoom.
- Selectable opaque backgrounds and editor-only transparency checkerboards (implemented).
- Optional camera-aligned 20% gray fill outside the actual composition, persisted as an
  authoring-only layout preference and excluded from capture/export (implemented).
- Editor-only presentation backgrounds support the bundled looping video plus still images from a
  remote URL or an embedded local file; all remain behind transparent composition pixels and are
  excluded from capture/export (implemented).
- Integer-pixel key authoring with subpixel runtime interpolation (implemented).
- Direct layer selection from timeline gutter names (implemented).
- The Timeline name/track divider is an accessible draggable and keyboard-adjustable splitter with
  local width persistence and track-space clamping (implemented).
- The add-element toolbar uses distinct accessible SVG icons and tooltips instead of text-only
  Rectangle/Ellipse/Text/Image/Path/Sequence/Lottie buttons (implemented).
- Ordinary element creation defaults every lifecycle pose to full alpha; hidden boundaries are now
  explicit authoring/recipe choices (implemented).
- Ctrl/Command multi-selection, group movement, and Shift axis-constrained dragging (implemented).
- Ctrl/Cmd+A selects all authored layers instead of webpage text while preserving native Select All
  inside editable controls; Edit menu parity is implemented.
- Canvas and layer-timeline context menus for clipboard, deletion, held-frame, and sampled-key
  editing (implemented).
- Optional OGraf Step-aware editor playback and Spacebar Play/Pause outside editable controls are
  implemented.
- Timeline playback temporarily hides canvas selection and Moveable overlays while retaining the
  selection for immediate restoration on pause/stop (implemented).
- Bounded OGraf lifecycle-marker retiming is implemented with full-height drag targets, keyboard
  nudging, preview-only pointer movement, atomic adjacent-transition balancing, and stranded layer-
  key warnings. Start stays fixed and lifecycle reordering remains an explicit future operation.
- Lifecycle and update-transition controls display frames and milliseconds together. Durations that
  land between integer broadcast frames are flagged with explicit down/nearest/up choices.
- Timeline progressive disclosure is implemented: the primary toolbar contains transport, Step/key
  creation, compact time, and one zoom slider; grouping and deletion stay in context/keyboard paths,
  while custom curves, track transforms, and local loops appear only when selected and expanded.
- Safe areas, rulers/guides, grid/guide/layer snapping, alignment/distribution, authoring bounds and
  overflow preview, locking, persistent grouping, parenting, and responsive constraints
  (implemented). Action and title/graphics safe geometry now follows EBU R 95 16:9 at 3.5% and 5%
  per axis, including exact rounded HD/UHD pixels across overlays, QA, and MCP. Persistent groups
  now have canvas context-menu Group/Ungroup commands, complete
  group selection from canvas/Layers/timeline, and a distinct move/resize/rotate overlay. Guide
  creation/movement/removal now follows Photoshop-style fixed viewport rulers. Numerical
  multi-layer transforms and constraint visualization remain polish items.
- Timeline Groups for organizing large layer sets are implemented with Ctrl/Command multi-select
  context-menu creation, persistent names/colors/membership, and local collapse state. Revisioned
  MCP operations expose create/rename/recolor/ungroup semantics, and the authoring Skill recommends
  them for related multi-layer components. They remain independent from canvas object groups and
  are excluded from compiled OGraf output.
- Layer parenting is directly visible through depth-based name indentation in the flat paint-order
  Layers list. Row-centre drops assign a parent, row-edge drops retain before/after reordering, and
  cycle-invalid targets are refused without changing hierarchy or z-order.
- Canonical layer paint order is also directly editable in Properties as a one-based Z order, without
  introducing a separate 3D-depth field or changing parent relationships.
- Standard Send to Back, Send Backward, Bring Forward, and Bring to Front toolbar actions use the
  same canonical order for single and multi-layer selections (implemented).
- System/packaged-font selection with live preview, weight, line height, tracking, baseline shift,
  vertical alignment, case transforms, minimum shrink size, and visible/clip/ellipsis overflow is
  implemented. Text sizing includes auto-sized boxes, floor-bounded shrink-to-fit, fixed sizing, and
  Fit to width, which grows or shrinks proportional glyphs to the largest size contained by both
  fixed box axes. Squeeze sizing also fills both axes through intentional independent X/Y glyph
  scaling. Full localization and authored RTL direction remain queued.
- W8 text outlines are implemented as document v20: editable stroke colour, independently animated
  non-negative stroke width, Brand Kit targets, and shared editor/runtime/SVG rendering with the
  outline painted behind the glyph fill.
- Multiple independent data bindings per layer are implemented across the Inspector, source
  migration, capture, compiler/runtime, OGraf import, validation, duplication, and MCP operations.
- SVG image import now accepts a Photoshop-style bundle selection and embeds companion CSS, local
  image URLs, and font URLs into one portable SVG while registering selected fonts. MCP now exposes
  the same workspace-confined bundle import plus direct image/font/source ingestion with bounded
  payloads. Best-effort semantic decomposition of simple SVG shapes/text into editable layers
  remains queued; complex or rasterized Photoshop SVGs deliberately remain single image assets.
- Semantic authoring metadata and recipes are implemented: layers carry roles/tags/intent, compact
  queries select by meaning rather than UUID-heavy project reads, and lower-third, bug/DOG,
  clipped-ticker, scoreboard, clock, and repeater recipes materialize ordinary editable layers,
  fields, groups, and deterministic tracks. Learned design suggestions remain queued.
- The lower-third recipe now uses a shared motion vocabulary: a compiled clip-parent wipe is the
  default, with explicit stagger-cascade, directional-slide, and no-motion alternatives. Entrances
  decelerate, exits accelerate, and oversized staggers reject before crossing the first Step.
- Brand Kits are implemented with typed design tokens and compatible layer-property links. Current
  values are materialized into standard element properties for portable output. Immutable News,
  Sports, Entertainment, and Documentary style-pack definitions now copy editable palette, modular
  type, geometry/outline, and motion tokens into a composition. Cross-project kit libraries, token
  aliases, and import/export remain queued.

## 4. Advanced graphics — queued

- Deterministic layer-local multi-property loop clips are implemented with lifecycle/Step
  activation, finite or infinite repeat, independent easing, editor preview, compiled runtime
  playback, scheduled non-realtime sampling, validation, and MCP authoring. Ping-pong, multiple
  clips per layer, dedicated ticker content flow, and cycle-synchronized exits remain queued.
- Local-loop activation is visible directly in the timeline through `∞` badges on the relevant
  global Step and matching layer key, avoiding per-key inspection (implemented).

- Reusable components are implemented as portable authoring snapshots: save/update selected layers
  and bound fields, insert independent or authoring-linked grouped instances with complete ID
  remapping, explicitly refresh linked instances, rename/remove definitions, and perform the same
  workflow through MCP. Refresh remains deliberate and replacement-based; granular per-instance
  overrides, automatic live syncing, and cross-composition component libraries remain queued.
- Finite repeaters are implemented as an authoring recipe that materializes horizontal or vertical
  collections into ordinary grouped layers and independent cloned fields with semantic item tags.
  Runtime object-item array collections are also implemented separately: one grouped prototype is
  expanded at playout from nested GDD data with explicit stride, capacity, truncation, and
  deterministic index-based updates. Keyed move animation, grids, scroll/pagination, and nested
  repeated arrays remain queued.
- Deterministic clip-to-parent masking is implemented for animated rotation-aware parent bounds and
  rounded rectangle corners, including diagonal wipes. Composition-local blend modes are also
  implemented with an isolated transparent composition root across editor, capture, approximate
  SVG review, and compiled runtime output. Arbitrary alpha/luma/path masks, video, and nested
  compositions remain queued.
- Basic Lottie support is implemented as a first-class self-contained layer: JSON import/re-import,
  bundled light canvas player, absolute-time loop sampling, editor scrubbing, realtime playback,
  deterministic non-realtime seeking, validation, export, and MCP schema support. Segments,
  markers, one-shot playback, dynamic text/data overrides, external asset-folder packaging,
  renderer choice, and target-device compatibility certification remain queued.
- Rectangle and ellipse solid/linear/radial/conic paints are implemented, including whole-gradient
  data binding and independent animatable stop offsets. Per-stop data binding remains queued.
- CSS blur and configurable drop shadow, including per-property animation of numeric effect values,
  are implemented.
- Structured custom actions are implemented. Full recursive GDD authoring now covers enriched scalar
  controls, nested objects, arrays, required properties, item/length/range constraints, and bounded
  object-item runtime collections. Scalar arrays remain schema-only; collection rendering requires
  object items and uses the accepted W12b deterministic profile.
- Built-in real-time, non-real-time, and dual-mode export profiles derive manifest identity and
  capability flags without mutating the editable project. Custom user-defined profile persistence,
  canonical thumbnails, release metadata, and compatibility targets remain queued.

## 5. Integration and experience — queued

- The user-facing product rename from OGraf Editor to **OGraf Studio** is implemented without
  changing compatibility-sensitive package namespaces, project formats, or MCP tool names.
- Window-menu pane reopening now creates a centered floating window first instead of immediately
  docking it back into a default edge region (implemented).
- The top Edit menu exposes Undo/Redo plus a scrollable 50-action browser history. Debounced edit
  bursts receive descriptive labels, keyboard shortcuts remain available, and selecting an older
  undo or redo action jumps across the required number of states (implemented).
- Normal Timeline Play uses the compiled runtime sampler for all lifecycle/Step-activated loops,
  including scrolling tickers and motion parked at a Step. The redundant main-canvas Edit/OGraf
  Preview mode switch was removed; advanced actions, schedules, logs, certification, and export
  remain in Preview & Export (implemented).
- Local AI-agent authoring is implemented through a revisioned MCP server, live editor bridge,
  exact-artifact certification tools, workspace-confined save/export, and a reusable
  `ograf-authoring` Skill. Browser-rendered PNG composition/viewport capture, diagnostic mattes,
  temporary data overrides, inferred font-fallback reporting, short-lived URLs, and optional inline
  MCP image responses are implemented. Browser-rendered, labelled frame contact sheets with
  lifecycle/midpoint defaults are also implemented. Complete element/schema semantics, compact
  project projections, browser text measurement/overflow stress tests, whole-track/stagger
  operations, and opt-in broadcast lint are implemented. The AI-first layer now also provides
  semantic intent/query, rendered operation dry runs, deterministic design/motion QA, an in-editor
  Accept/Reject proposal workflow, Brand Kits, linked-component refresh, repeaters, MCP asset/SVG
  imports, and generated MCP contracts whose drift fails verification. Headless render/certify
  remains explicitly deferred; authentication for non-local hosting, subscriptions, and agent eval
  suites remain queued.
- In-app BYOK authoring chat is implemented as a second renderer over the canonical agent-tool
  records. Anthropic and OpenAI-compatible adapters run server-side, expose a reduced 14-tool
  surface, use a generated and drift-gated projection of the authoring Skill, pass ambient
  selection/frame/viewport/recent-edit context outside the cached prefix, preserve the existing
  proposal panel, and report message/session/project token usage without writing telemetry into the
  portable project. Credentials remain in Windows Credential Manager or the server environment;
  save/export/certify/import/reset stay explicit UI actions. Streaming deltas, persisted transcript
  history, provider pricing conversion, and broader provider adapters remain queued.
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
- Craft-aware deterministic design QA is implemented for grouped lockstep motion, easing direction,
  missing stagger/reveal, type-scale hierarchy, optical edge alignment, padding rhythm, and loop
  seams. Rules stay browser-free and advisory, expose stable IDs, understand clipping, and support
  narrow explicit exception tags.
- Structural editor/MCP parity is implemented for lifecycle Step add/rename/move/remove, persistent
  canvas grouping, custom action CRUD, and reference-safe asset removal. Existing generic track,
  transform, element, duplication, and layout operations cover the remaining editor mutations.
- Optional OGraf Server API renderer testing.
- Renderer compatibility matrix.
- Accessibility, onboarding, keyboard workflow, and documentation polish.
- The Resources pane now scales to large projects through counted category branches and nested
  per-item disclosure editors in an ARIA tree (implemented).
- Editor chrome uses the shared Zero Density/RealityHub contract: locally bundled Nunito plus one
  monospace diagnostics family, 14 px/13 px text tiers, charcoal surfaces, cyan active/focus accents,
  and flat panel/control geometry across docking, menus, toolbars, forms, and scrollbars. Template
  typography remains a separate authored-content concern (implemented).
- Numeric inputs share RealityHub-style horizontal scrubbing, Shift/Alt coarse/fine modifiers,
  bounded step-aware values, an instruction popup, and click-to-select typing through one delegated
  controller (implemented).
- The Preview & Export panel includes non-gating broadcast QA for Step-frame title-safe placement,
  text size/floors, packaged-font fallback, backing contrast, interlaced thin rules, long
  Latin/Turkish/Arabic replacement values, and source-image overlay comparison. Comparison overlays
  preserve authored layer geometry, infer Photoshop SVG-composite placement from embedded plate
  assets, and fall back to intrinsic image dimensions rather than full-frame stretching.
