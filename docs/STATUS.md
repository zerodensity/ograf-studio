# Current Status

Last verified: 2026-08-24

Current release: **OGraf Studio 0.03**

## Current milestone

AI-first broadcast authoring and OGraf compliance hardening.

## Working

- The user-facing product name is **OGraf Studio**. Existing `@ograf-editor/*` package names,
  `.ogeproj` source compatibility, persisted IDs, and MCP tool names remain unchanged.
- AI-first authoring areas 1-9 are implemented: semantic roles/tags/intent, materialized lower-third
  and repeater recipes, compact semantic scene queries, rendered operation dry runs, generated MCP
  contracts, workspace-confined asset/SVG bundle imports, Brand Kits/design tokens, linked
  component refresh, deterministic design/motion QA, and an in-editor proposal Accept/Reject flow.
  Headless render/certify (area 10) is deliberately deferred.
- Browser certification is isolated in a disposable iframe/custom-element registry. Certification,
  PNG capture, contact sheets, and text measurement run through one serialized browser-work queue;
  packaged-font waits remain bounded and bridge health continues to expose responsiveness/latency.
- Resources now manage images, fonts, and source attachments with original filename/size metadata,
  payload deduplication, safe custom package paths, missing-reference detection, usage-aware removal,
  font family/weight/style preview, and optional license metadata/text packaged under `licenses/`.
- Preview & Export offers immutable built-in real-time, non-real-time, and dual-mode profiles. Each
  derives output capability flags and a collision-safe graphic ID without changing project state.
- Timeline and update-crossfade controls pair integer frames with milliseconds, detect fractional
  frame durations, and require an explicit down/nearest/up rounding choice.
- Document v13 adds line height, tracking, text transform, vertical alignment, baseline shift,
  minimum shrink size, and overflow policy. Preview provides source-image overlay plus advisory
  broadcast QA and real-browser Latin/Turkish/Arabic replacement-text stress tests. Source overlays
  preserve authored image-layer bounds; portable Photoshop SVG composites infer their shared
  composition offset from embedded plate assets, while unmatched images retain intrinsic dimensions
  instead of stretching to the full frame.
- React/Vite visual editor with DOM-based canvas, timeline, data fields, preview, and ZIP export.
- Document v11 supports multiple independent data bindings on one layer. The Inspector adds,
  retargets, and removes binding rows; compiler/runtime/capture apply the ordered list, validation
  rejects duplicate target properties, MCP exposes `set_layer_bindings`, and v10 sources migrate
  their singular binding automatically.
- Structural editor/MCP parity now covers lifecycle Step rename/move/remove, persistent canvas
  group/ungroup, custom action add/update/remove, and reference-safe asset removal. The lifecycle
  retime planner moved into the shared scene model so browser and MCP mutations use identical
  bounds and stranded-key warnings.
- Document v12 adds reusable component snapshots. The Resources panel can save the current layer
  selection, rename/insert/delete definitions, and select each newly inserted instance. Document
  v16 adds optional authoring-only component links: definitions can be updated from selected layers
  and linked instances explicitly refreshed with complete replacement mappings. Independent
  instances remain detached. Every instance receives fresh layer/key/loop/field IDs, unique field
  keys, remapped bindings/internal parents, placement offset, and a persistent group; compiled OGraf
  output always contains ordinary layers without a master-instance runtime.
- Photoshop-style SVG bundles can be imported by selecting one SVG with companion CSS, images, and
  font files. CSS is injected into the SVG, selected relative resources become embedded data URIs,
  XML stylesheet references are removed, selected fonts are also registered as project font assets,
  and unresolved paths are reported in the Resources panel. The portable result intentionally
  remains a single image asset rather than pretending rasterized Photoshop content is editable.
  MCP exposes the same workspace-confined bundle import plus direct image/font/source ingestion,
  with 32 MiB per-file and 64 MiB bundle limits.
- Document v16 includes composition-local Brand Kits and layer token bindings. Typed color,
  typography, stroke, and radius values are materialized into compatible standard element
  properties whenever a token or binding changes, so certified output has no proprietary token
  runtime.
- Semantic layer metadata supports meaningful roles, normalized tags, and intent descriptions. It
  drives compact MCP queries, deterministic QA, and authoring recipes while remaining excluded from
  compiled output. The lower-third recipe creates four grouped layers/two editable fields with a
  deterministic compiled mask wipe by default, cubic-out entrance, and cubic-in directional exit.
  Explicit stagger, slide, and no-motion styles share the same portable ordinary-layer model;
  finite repeaters clone selected source layers and fields into horizontal or vertical materialized
  collections.
- Explicit Start → Step(s) → End authoring model with legacy project migration.
- Correct first-play, boundary-crossing, stop, and zero-step lifecycle resolution.
- State-aware exits now interpolate directly from the active rendered Step to End using the
  incoming End keys and declared stop duration. Stopping from an early Step no longer exposes later
  Step poses; realtime actions and deterministic scheduled `goToTime()` use the same rule.
- Shared editor/export timeline interpreter, including transform-origin animation.
- Deterministic non-realtime schedule seeking and timestamp-derived image sequences.
- Document v10 adds self-contained Lottie JSON layers rendered by a bundled light canvas player.
  Lottie frame phase is derived from absolute elapsed/composition time, so editor scrubbing,
  realtime playback, scheduled non-realtime playback, and `goToTime()` use one deterministic loop
  rule. The canvas toolbar imports compatible JSON, the Inspector replaces it and controls speed,
  OGraf import reconstructs editor-generated Lottie layers, project/export validation rejects
  missing documents and external image/font paths, expressions are disabled, and MCP advertises
  the new element schema.
- Official EBU schema and semantic project validation; invalid export is blocked.
- Mandatory pre-save OGraf certification now validates the exact artifact snapshot: official v1
  manifest schema, canonical package paths, browser module import/default export, required Graphic
  API, and the devtool realtime/non-realtime lifecycle exercise. Both editable-source Save and ZIP
  Export run the gate before any picker, write, or download begins.
- Editable source is clearly named `.ogeproj` instead of `.ogeproj.json`, preventing SuperFlyTV's
  devtool from misidentifying editor source as an invalid OGraf manifest. The UI distinguishes
  source from `.ograf.zip` playout output and explains that the ZIP must be extracted for devtool.
- The menubar now offers best-effort **Import OGraf** conversion from `.ograf.zip` or selected loose
  package files. Embedded `.ogeproj` source is preferred; editor-generated `main.js` descriptors
  reconstruct layers, lifecycle/property tracks, effects, loops, clipping, bindings, schema fields,
  actions, and packaged images; opaque third-party runtimes safely fall back to manifest metadata,
  requirements, lifecycle hints, schema, and actions without executing imported JavaScript. Every
  conversion presents an explicit loss/validation report before editing continues.
- ZIP resource extraction/deduplication and truthful internet requirements.
- Independent per-layer transform timelines on a shared frame ruler, with free add/move/remove,
  per-key easing, canvas auto-keying, and v2 → v3 migration.
- Live Inspector transform values during canvas drag, resize, and rotation gestures, with a single
  authored/history commit when the pointer is released.
- Color-coded layer tracks with matching key diamonds, visible key-to-key exposure bars, duration
  labels, gutter swatches, and five-frame ruler labels.
- Persistent playback transport with previous/next-frame stepping, play/pause, stop-to-zero,
  end-of-timeline replay, and one compact current-frame/total-frame/elapsed-duration readout.
- Mouse scrubbing from the playhead head or its full vertical line, the ruler, or empty layer-track
  space; all scrub paths pause playback and clamp precisely to the authored frame range.
- The main canvas keeps fit-to-view as its default and adds pointer-anchored template zoom from
  Ctrl/Command+wheel plus Ctrl/Command+plus/minus keyboard shortcuts. These gestures resize only the
  canvas/pasteboard—not the editor interface—and retain the same logical point under the pointer or
  viewport center.
- Timeline playback has an optional `Pause at OGraf steps` mode. Play advances to the next pausable
  Step and stops exactly there; the next Play continues to the following Step or End. Space toggles
  Play/Pause globally while form and editable controls retain their native keyboard behavior.
- OGraf lifecycle Steps can be dragged from either their ruler marker or full-height timeline line.
  Interior Steps move independently within their adjacent lifecycle bounds by atomically balancing
  incoming/outgoing transition durations, while End may change total duration and Start remains
  fixed. Dragging previews locally and commits once on release; layer animation keys are never
  silently retimed, and the editor reports keys left at the old boundary or beyond a shortened End.
- Full HD and UHD composition presets at 25, 29.97, 30, 50, 59.94, and 60 fps, with exact
  fractional broadcast rates; obsolete sub-Full-HD presets have been removed.
- Moveable gestures preserve GSAP `translate3d` transforms and synchronously track the target, so
  the selection box and transform-origin marker remain centered during resize, drag, and rotation.
- The Moveable selection overlay follows the evaluated object pose during timeline stepping,
  scrubbing, and playback without forcing a React render of every canvas layer on every frame.
- Exact frame-zero seeking now reapplies every layer's authored initial transform and effects after
  GSAP has visited a later frame. Stop, reverse scrubbing, project replacement, editor preview, and
  exported `goToTime(0)` can no longer retain a visible Step pose until selection forces React to
  rerender it.
- Selection corners now have separate interaction zones: drag the visible handle to resize or its
  surrounding area to rotate; the dedicated rotation handle is larger and visibly marked.
- Object opacity is exposed as an animatable Alpha control with a 0–100% slider and precise numeric
  percentage entry, clamped to valid values and authored on the selected layer's current frame.
- The editor canvas has a scrollable pasteboard one composition wide on every side; off-frame
  objects remain visible, selectable, and aligned with Moveable controls while output stays clipped
  to the composition boundary.
- Holding the middle mouse button anywhere in the canvas viewport activates pointer-captured
  Photoshop-style panning. Pointer movement scrolls the pasteboard in both axes, keeps selection
  controls synchronized, suppresses browser autoscroll, and ends on release or cancellation.
- Composition background color remains selectable beside the transparent-output toggle. The entire
  Stage pasteboard uses an editor-only checkerboard, continuous through a transparent composition;
  Preview uses the same zoom-stable pattern while runtime and export remain genuinely transparent.
- The main canvas now has explicit Edit and OGraf Preview modes. Preview replaces the authoring DOM
  with the latest compiled runtime in the same zoomable/pannable viewport. It automatically rebuilds
  and loads when the template changes, applies preview-data changes through a debounced
  `updateAction`, and exposes Start, previous/next/goto Step, Take Out, render-type, and custom-action
  controls. Start reloads the same data/render configuration from any lifecycle state and
  immediately plays the entrance to the first Step, so End is never a navigation dead end. Internal
  replacement and cleanup still call `dispose`, while preview calls stay outside project revision
  and undo history.
- Edit, main-canvas OGraf Preview, and Preview & Export now share the same effective preview-data
  semantics: explicit test values override declared field defaults, and local `asset:<id>` image
  values resolve to browser-loadable data URIs before reaching a Graphic instance. Data-bound image
  defaults and gradient/color defaults therefore render identically across all three surfaces.
- Authored X/Y/width/height values snap to whole composition pixels across canvas gestures,
  Inspector edits, inserted keys, and project loading. Rotation, alpha, origins, and evaluated
  between-key animation remain subpixel-precise; the Inspector labels evaluated values separately.
- Timeline gutter layer names are keyboard-accessible selection buttons. Clicking a name selects the
  matching canvas object and Inspector target while clearing a prior keyframe-only selection.
- Hiding and showing a layer remounts and repopulates its shared runtime content host, so every
  element kind returns visibly at the unchanged playhead pose rather than leaving an empty box.
- Ctrl/Command-click builds a transient multi-layer selection from the canvas, Layers panel, or
  timeline gutter. Its aligned group boundary moves every selected layer together and auto-keys each
  independent track at the current frame; Delete removes the full selection.
- Holding Shift during single or group movement locks to the first dominant horizontal or vertical
  direction until Shift is released, with a fresh axis chosen if Shift is pressed again.
- Right-clicking a canvas object opens Cut, Copy, Paste, Duplicate, and Delete commands that operate
  on the complete transient multi-selection. Pasted layers receive fresh layer/key IDs and a visible
  20px offset. Right-clicking a layer-track frame provides hold-frame insertion, evaluated-key
  insertion, and key deletion without changing another layer or the OGraf lifecycle track.
- Easing menus now provide 31 deterministic trajectories across Quad, Cubic, Quart, Quint, Sine,
  Expo, Circ, Back, Bounce, and Elastic families. Editor sampling and GSAP runtime playback use the
  same pure functions, including overshoot motion. Timeline controls explicitly separate OGraf
  lifecycle-transition easing from selected layer-key easing; changing a key affects only that key
  on that object.
- Text layers offer a previewed system-font dropdown and Auto size, Shrink text to box, or Fixed
  sizing. Auto size immediately authors the measured text bounds, keeping Moveable synchronized
  after content, face, or font-size edits; shrink-to-fit responds to runtime data and box animation
  while preserving the authored pixel line-height and vertical line positions.
- Every layer supports deterministic CSS blur and drop-shadow styling shared by Stage, Preview, and
  exported runtime. Shadow color, alpha, offsets, and softness are editable in the Inspector.
- Timeline zoom changes only horizontal pixels per frame from 33% to 267%; track height stays fixed.
  Non-linear spans show a gradient and curve badge with the easing name, while linear interpolation
  is explicitly labeled `None (Linear)`.
- Document v5 provides expandable, independent tracks for position, size, rotation, alpha,
  transform origin, blur, and numeric drop-shadow parameters. Editing or inserting a key affects
  only that property at that freely chosen frame; v4 full-pose timelines migrate losslessly.
- Every property key has its own incoming easing and optional editable cubic Bézier curve. The
  timeline includes a live SVG curve preview with draggable handles and precise control-point
  fields; the editor evaluator and generated GSAP runtime consume the same curve data.
- The Keyframe Editor dock appears only for a selected key or property. Incoming easing remains
  immediate; the Bézier editor, whole-track transforms, and local loops use collapsed advanced
  sections. Key diamonds are keyboard-focusable and support one-frame arrow nudging and deletion.
- Selected property tracks support collision-safe key nudging, whole-track offsets, user-entered
  proportional scaling, reversal, and even distribution from one Track Actions menu. Invalid
  compressions are atomic no-ops instead of creating duplicate frames that would fail certification.
- Blur, drop-shadow alpha, X/Y offset, and softness are animatable numeric tracks and update through
  the same deterministic runtime as transform properties. Shadow enable and color remain static
  discrete settings.
- The former lower-third example remains an internal regression fixture but is no longer exposed in
  the production menubar or bundled as a user-facing demo workflow.
- Cyan canvas dots identify data-bound layers and explain themselves on hover. They are editor-only
  affordances and automatically disappear during timeline playback, returning on pause or finish.
- Compiler, lifecycle, migration, and validation tests plus CI and handover protocol.
- Framework-neutral agent authoring core with atomic scene/timeline/data operations, optimistic
  revision checks, dry runs, agent undo/redo, change summaries, validation, and deterministic SVG
  frame snapshots.
- Localhost Streamable HTTP MCP server with scene/timeline inspection, visual frame rendering,
  live-project authoring, workspace-confined project sessions, and explicit destructive-tool
  annotations. A WebSocket bridge keeps the visible browser editor synchronized and reports agent
  connection/activity in the menubar.
- MCP visual planning now supports projected frame/strip rendering without mutation and a separate
  human-review proposal path for `sessionId: editor`. Proposals retain their base revision and apply
  the exact previewed operation batch only after explicit acceptance; rejection, expiry, or revision
  drift leaves the project unchanged. The editor displays proposal imagery, validation, warnings,
  and operations in a floating review drawer.
- MCP contracts are generated from the registered SDK/Zod tool definitions into
  `docs/generated/mcp-contracts.{md,json}`. `npm run contracts:check` is the first verification gate,
  preventing documentation/schema drift. The current generated surface contains 28 tools.
- Agent visual verification now uses authoritative browser-rendered PNG rather than the approximate
  SVG path: composition or viewport targets, transparent/checker/solid mattes, temporary data-field
  overrides, max-dimension scaling, inferred resolved-font reporting, five-minute localhost URLs,
  and opt-in inline `image/png`. Capture is read-only and leaves revision unchanged.
- Browser-rendered PNG contact sheets expose animation motion without reconstructing interpolation
  client-side. Agents may request up to 12 labelled frames or omit them to sample lifecycle states
  and transition midpoints; strips use the same diagnostic mattes, short-lived URLs, optional inline
  image response, and read-only revision semantics as single-frame capture.
- Agent discovery now publishes complete schemas/defaults for every element kind, easing presets,
  valid data-binding targets, and explicit paint-order, incoming-easing, and origin semantics.
  Project reads retain the legacy full response by default and offer section filters plus
  constant-track removal for compact read-before-write loops.
- Browser text measurement reports real rendered text extents, box overflow, fitting-prefix index,
  and inferred font fallback without mutation. Opt-in validation can stress bound values and add
  non-gating overflow warnings. Separate opt-in broadcast lint warns about safe areas, scaled font
  size, contrast, and thin horizontal elements for declared interlaced output.
- Whole-property-track replacement/merge and staggered track templates are atomic authoring
  operations, reducing common multi-layer animation builds from dozens of individual key calls.
- Document v6 adds a complete authoring-layout model: action/title-safe overlays, viewport rulers,
  persistent horizontal/vertical guides, grid/guide/layer snapping, optional composition-bound
  containment, and visible/clipped editor overflow. These controls never alter OGraf output.
- Canvas rulers now follow Photoshop's viewport-chrome model instead of scaling inside the
  composition: fixed 20px top/left strips, adaptive 1/2/5 pixel ticks and compact labels, a zero
  origin aligned to the composition corner through pan/zoom, and fixed 1px cyan guides. Dragging
  from a ruler creates a guide; dragging an existing guide back onto its ruler removes it.
- Multi-selection alignment and equal-gap distribution author integer transform keys at the current
  frame. Persistent groups survive save/load, can be created or dissolved from the canvas context
  menu, and select/move/resize/rotate through a distinct violet group overlay as one unit while
  remaining normal independent OGraf layers. Canvas, Layers, and timeline Ctrl/Command selection
  consistently toggle a complete persistent group. Locked layers reject canvas, Inspector,
  timeline, and MCP edits.
- Parent/child relationships cascade authored parent translations into descendant tracks, and
  horizontal/vertical responsive constraints are baked across every relevant animation key when
  composition dimensions change. Group, parent, lock, constraint, guide, ruler, safe-area, and
  snapping metadata is deliberately removed at the compiled-descriptor boundary; only a reduced
  child-side clip-parent relation compiles when `clipChildren` is explicitly enabled.
- Document v7 adds editor-only Timeline Groups. Ctrl/Command-selected layer rows can be grouped from
  their right-click menu into named, colored, collapsible rows that preserve independent tracks,
  paint order, canvas object groups, MCP layer IDs, and compiled OGraf output. Membership survives
  source save/reload while collapse state remains a local UI preference. MCP now exposes revisioned
  create, rename, recolor, and ungroup operations; the legacy `timelineFolders` source field remains
  unchanged for existing project compatibility and is projected as `timelineGroups` to agents.
- Document v8 adds deterministic clip-to-parent masks and structured gradient paint. A
  `clipChildren` parent clips direct children to its animated rotation-aware bounds and rectangle
  radius across Stage, PNG capture/strip, SVG diagnostics, compiled runtime, and certified export.
  `duplicate_group` preserves and remaps the relation; browser text diagnostics distinguish
  intentional parent clipping from own-box overflow, and broadcast lint evaluates visible bounds.
- Rectangle and ellipse fills support solid, linear, radial, and conic paint with editable stop
  offsets, colors, and alpha. Every stop position can own an independent incoming-eased
  `fill.stops[N].offset` timeline; whole gradients may be data-bound through an OGraf object schema,
  while per-stop data binding remains future work.
- Document v9 adds one deterministic local loop clip per layer. Alpha, position, size, rotation,
  origin, numeric effects, and gradient-stop offsets retain independent local tracks/easing on a
  shared clip duration, activated for the on-air lifecycle or one OGraf Step. A collapsed Local
  Property Loop section can create, edit, and live-preview loops; phase and destructive operations
  use nested advanced disclosures. MCP exposes atomic loop configuration/track operations.
  Runtime phase derives from absolute action/schedule time, and realtime image sequences now derive
  their frame from elapsed time instead of accumulating timer callbacks.
- MCP certification, source save, and package export compile the shared exact artifact object and
  delegate it to the existing browser module/lifecycle runner. They fail closed without the live
  editor, require explicit confirmation, prevent accidental overwrite, and cannot write outside
  the configured workspace.
- Repository `ograf-authoring` Skill documents read-before-write, revision rebase, dry-run, visual
  inspection, compatibility invariants, certified-output workflows, and recommended timeline
  grouping for multi-part/repeated graphics; its structure and MCP dependency metadata pass the
  Skill validator.
- MCP bridge health now distinguishes a connected socket from a responsive editor main thread,
  publishes heartbeat latency and likely tab throttling, and produces operation-specific timeout
  errors with measured health and recovery guidance. Browser requirements are discoverable per tool.
- Creation mutations expose stable layer/field/guide IDs in top-level structured results and the
  primary text response. Dry runs add projected validation, optional broadcast lint, generated IDs,
  and compact per-operation summaries without changing revision.
- Broadcast contrast lint evaluates every Step frame against the actual opaque rectangle stack
  beneath text, suppresses false mid-grey warnings for fully backed text, and explicitly reports
  partial/unbacked coverage. Computed action/title-safe pixel bounds accompany layout projections.
- Browser-free track sampling returns resolved properties and derived bounds for invariant checks.
  Data fields can be updated or safely removed, confirmed project reset is undoable, revision
  history distinguishes browser/agent sources, and transition retiming warns about stranded keys.
- Shrink-to-fit typography now clamps at 50% of the authored font size instead of collapsing toward
  1px. Browser measurement defaults to the first Step frame and reports applied shrink ratio plus a
  degenerate flag; authoring warns when box height is below 1.3× font size.
- MCP transform/effect updates now distinguish base-layout `scope: authored` (the default, applied
  at every lifecycle frame) from explicit single-frame animation edits.
- Certification uses collision-resistant custom-element names, reports certification readiness in
  capabilities, gives explicit reload recovery for registry faults, and passes consecutive runs in
  one page session.
- First-class image assets persist once in `composition.assets`, render through `asset:<id>` in the
  editor/capture/runtime, and package once even when reused by layers or image-url defaults.
- `duplicate_group` creates independent grouped copies from group, parent, or layer-ID selectors,
  supports cumulative transform/frame offsets and binding share/clone/clear modes, returns complete
  layer/field mappings, and rejects out-of-duration authored keys atomically. Frame offsets now move
  only non-lifecycle authored keys; compatibility keys remain anchored to Start/Step/End. Layer-name
  and field-key selectors resolve creations earlier in the same batch, field updates accept keys,
  and wildcard stagger selectors reduce UUID-heavy payloads while rejecting ambiguity.
- Validation summary mode reports only failing overflow checks by default; full-frame bleed layers
  no longer generate inapplicable safe-area warnings. Safe-area bleed exemptions are evaluated per
  axis, authoring warnings are included verbatim in primary MCP text with operation/layer context,
  and composition capture defaults to the first Step/on-air frame.
- Browser `editor.hello` is revision-neutral. The first connection establishes the baseline at
  revision zero; reconnects do not create history, and divergent tabs receive an explicit
  authoritative-session synchronization instead of last-writer-wins ping-pong. Confirmed
  `ograf_delete_session` cleanup removes obsolete non-editor smoke-test sessions only.

## Next milestone

- Overlapping-action/concurrency and browser E2E coverage; package/module/lifecycle smoke testing is
  now enforced in the product save path.
- Packaged fonts, localization/RTL, and advanced broadcaster authoring tools.
- Evaluate granular linked-component overrides, runtime collection binding, cross-project Brand Kit
  libraries, and broader semantic recipes from real production use. Do not start headless
  render/certify until the user explicitly resumes area 10.
- The complete capability inventory remains tracked in `docs/ROADMAP.md`.

## Known release blockers

See `docs/KNOWN_ISSUES.md`. The current output must not be described as broadcast-production-ready until all P0 items are closed.

## Verification baseline

- `npm run verify`: passed on 2026-08-24, including generated MCP contract drift, format, lint, all
  workspace typechecks, 240 tests across 53 files, the runtime bundle, and the editor production
  build. The production bundle still emits the documented large-chunk advisory.
- The 240-test baseline includes timeline, transport, scrubbing, canvas zoom, OGraf-step playback,
  Lottie document/frame/validation coverage,
  keyboard shortcuts, preset, transform-gesture, Alpha,
  pasteboard, background-appearance, integer-authoring, multi-selection, axis-lock, easing,
  typography/effects, per-property animation, retiming, migration, lower-third-demo, and
  compatibility-gate hardening, rotation-aware masking, ticker clipping, animated gradient stops,
  multi-property data binding, direct state-aware exits, shared lifecycle retiming, reusable
  component snapshots/instantiation/linked refresh, portable SVG/CSS bundle import, semantic
  recipes/query, Brand Kits/design tokens, repeaters, deterministic design QA, visual operation
  previews, human proposal acceptance, generated contracts, plus authoring-core and MCP
  concurrency/structural-parity integration. W3 additionally covers wipe/stagger/slide/none motion
  presets, clipping-aware design visibility, schema discovery, and compiled lower-third clip
  relations. A generated default wipe scored 100 with zero design findings and passed all five
  exact dual-mode certification gates.
- Agent-first live verification: labelled strip exposed an intentionally missing hold; later-index
  paint order and incoming quadratic easing were confirmed from browser PNGs; fallback-font text
  measurement and Turkish overflow stress passed; whole-track/stagger dry runs remained atomic;
  Full-HD lint flagged 18px text and a 2px interlaced divider; all five exact-artifact
  certification gates passed.
- Canvas-layout live verification: an MCP-authored document-v6 fixture persisted two guides,
  group/parent/constraint metadata, baked parent translation and responsive resize into ordinary
  tracks, rejected a locked-layer edit without incrementing revision, rendered to browser PNG, and
  passed all five exact-artifact certification gates. Compiler tests confirm no layout metadata
  reaches the runtime descriptor.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed with a large editor-chunk warning.
- `npm run format:check`: passed after repository formatting was normalized.
- Current lower-third output: passed the live validator from `C:\works\ograf-devtool` with no schema
  or filename errors; generated module/API plus realtime and non-realtime lifecycle tests passed.
- Current custom-curve property-track output: passed the product's live OGraf v1 certification gate,
  including official schema, package layout, module API, and realtime/non-realtime lifecycle tests.
- Live MCP bridge smoke test: revisioned mutation appeared in the visible editor, exact-artifact
  certification passed all five gates, and agent undo restored the original browser project.
