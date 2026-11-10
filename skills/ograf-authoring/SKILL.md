---
name: ograf-authoring
description: Create, inspect, animate, review, validate, certify, save, and export editable EBU OGraf-compatible broadcast graphics through OGraf Studio MCP. Use for lower thirds, scoreboards, tickers, Lottie layers, shader and Media paints, exposed shader animation, procedural pattern presets, composable effects stacks, semantic scene authoring, Brand Kits, finite repeaters, runtime GDD collections, reusable components, HTML5 broadcast templates, single/multi-template .ogs documents, legacy .ogp sets, inherited defaults, layer/source/canvas crops, .ograf.zip packages, per-property animation, Animate In/Out motion, data binding, interactive visual rules, and OGraf compliance work.
---

# OGraf Authoring 0.32.0

Use OGraf Studio's canonical editable model. Require final OGraf certification.

If the MCP dependency is unavailable, use
[references/setup.md](./references/setup.md) to start or recover the local editor and server. Do not
replace the tools with raw file editing.

**Window → Playout Controls** shares the preview session. See [multi-window guidance](./references/detached-windows.md).

For numbered canvas references, match each annotation to its rectangle or freehand outline. See
[area references and operator review](./references/tool-workflows.md#canvas-area-references).

## Required workflow

1. Call `ograf_get_capabilities` with only the `sections` needed for the task. Include `editor` to
   confirm whether the live editor is connected; add `elements`, `easing`, `semantics`,
   `designSystem`, `loops`, or `bindings` only when that domain is relevant. Use `shaders` or
   `tiling` for compact shader/pattern discovery; both are also included in `elements`. Omit `sections` only
   when the complete compatibility payload is genuinely required.
   Read `editor.connected`, `editor.responsive`, and `editor.latencyMs` separately. Do not call a
   browser-dependent tool while the socket is open but the editor is unresponsive; bring the editor
   tab to the foreground first. Require `editor.certificationReady` before certification or file
   output; follow `certificationLikelyCause` recovery guidance. `liveEditorConnected` is deprecated.
2. Inspect before editing with `ograf_query_scene`, `ograf_get_project` or `ograf_inspect_scene`.
   Query roles, tags, names, bindings, kinds and animation status to identify targets compactly.
   Keep stable IDs and `revision`. Prefer explicit `include` and `tracks:"animated-only"` for
   routine project reads; omit filters for full compatibility snapshots. Use `ograf_read_result_page`
   for large results; follow paths/offsets. Pages are snapshots; never repeat a mutation to paginate.
3. Plan the on-air hierarchy, operator controls and entrance/exit before building. Prefer editable
   native recipes, keys and bindings over visual approximations. Build one coherent
   `ograf_apply_operations` batch. Use `mode: "preview"` when geometry, paint,
   hierarchy, or motion needs a rendered projected frame/strip. Use `mode: "propose"` when a human
   should explicitly Accept or Reject a visually consequential batch in the editor. Use
   `mode: "dry-run"` before destructive or hard-to-reverse operations: layer/field removal, layer
   reorder, transition-duration changes, and `duplicate_group` with cloned fields. Use the default
   `mode: "apply"` for the committed batch. Commit purely additive layer/field/key/asset batches
   directly unless their projected layout is genuinely uncertain.
   Set `includeReview: true` on `apply` or `dry-run` when the same turn should also return
   deterministic design QA and, when the editor is responsive, a short-lived capture URL. Capture
   failure never rolls back or invalidates the mutation/review; inspect `captureOmitted` when no URL
   is returned. Creation batches return first-class `results` with stable
   layer/field/guide/asset IDs; use them in the next batch without paying for a project read solely
   as an ID lookup. A dry run returns
   projected IDs, validation, optional broadcast lint, and compact per-operation summaries, but its
   generated IDs are hypothetical and must not be reused after the real batch.
4. Apply with the latest `expectedRevision`. If a revision conflict occurs, re-read the project and consciously rebase; never blindly retry stale operations.
5. Inspect the result with `ograf_review_design`, `ograf_get_timeline`, `ograf_capture`,
   `ograf_render_strip`, and `ograf_validate_project`. Design QA is deterministic and advisory: use
   its stable finding IDs/layer IDs and preview frames to guide changes. Resolve unintended
   lockstep, wrong-direction easing, missing stagger/reveal, weak type hierarchy, near-miss
   alignment, inconsistent padding, and loop seams; do not treat the score as a substitute for
   editorial judgement or certification.
   Use `qa:allow-loop-seam` only for deliberate masked/offscreen wraps or rotational cycles,
   `qa:allow-offcanvas` only for deliberately clipped or wrapped layers, and `qa:static-text` only
   for punctuation or fixed glyphs that should not become operator fields.
   Use `target: "composition"` with a checker matte for design checks and `target: "viewport"`
   when editor chrome or canvas state may be involved. Use `ograf_render_strip` for animation work;
   omit `frames` to sample lifecycle frames and transition midpoints, or provide up to 12 diagnostic
   frames. For `ograf_capture`, omit `frame` to inspect the first Step/on-air state rather than
   transparent Start. Prefer the short-lived PNG URL; request inline base64 only when the client
   cannot fetch localhost URLs.
   Use `ograf_sample_tracks` for browser-free geometry and invariant checks such as fixed right or
   bottom edges. It remains available when capture, strips, measurement, and certification do not.
   For data-bound text, call `ograf_measure_text` at the relevant frame with representative values;
   treat `degenerate: true` as a layout fault even when the text is legible at its 50% clamp. Then
   distinguish `clippedBy: "own-box"` (a fault) from `clippedBy: "parent"` (intentional masking).
   validate with `browserTextOverflow: true`, `detail: "summary"`, and stress `testValues`. Use
   `broadcastLint: true` for advisory house rules; it never replaces OGraf certification.
   Audit operator fields with `ograf_validate_project {dataFieldUsage:true}`, then change text/color
   values and inspect output. Static references do not prove visible effects.
   See [export playback review](./references/ograf-invariants.md#export-playback-review) when testing
   coordinated packages in an external controller.
   For transition stutter or latency work, use the [playback performance review](./references/ograf-invariants.md#playback-performance-review)
   to distinguish cold preparation, warm switches and authored timing while preserving deterministic capture.
6. Call `ograf_certify_project` before reporting output as compatible. Pass `profile` when the
   result is specifically real-time, non-real-time, or dual-mode; omitting it certifies the project-
   declared flags.
7. Use `ograf_save_project`, `ograf_export_package`, or `ograf_export_coordinated_package` only when the user requested a file operation.
   For package export choose the named `realtime`, `non-realtime`, or `dual` profile; it derives
   output flags and identity without mutating source. Pass `confirm: true`; leave `overwrite` false
   unless replacement was explicitly intended.

For whole-set source saves use `ograf_save_template_set` with the opaque set revision and `confirm:true`.
Compact storage shares dependencies once; compatible mode targets older set readers. Standalone saves
must embed resolved fonts/resources/components. See the [set storage contract](./references/template-sets-and-crops.md#portable-set-storage).
External MCP clients pass the user's original request as `originalPrompt` on `ograf_create_project`,
reset, or a new, duplicated, or pasted template set member. When starting from an already-open blank
template, include `set_project_metadata.authoringPrompt: {id, text}` in the first authoring batch.
See [authoring prompt history](./references/template-sets-and-crops.md#authoring-prompt-history).

The live browser editor must be open for visual operation previews/proposals, PNG capture/strips,
certification, save, and export.
Capture and strips are read-only and never substitute for certified save/export. Certification
tools certify the exact compiled artifacts and fail closed when the editor is unavailable.

## File and import boundaries

- `.ogs` is editable source, JSON for one template or ZIP for a set. UI Open detects contents;
  legacy `.ogp`/`.ogeproj` remain readable. MCP project file tools use standalone JSON only.
- `.ograf.zip` is certified playout output. Existing packages can be converted through the visible
  editor's **Import OGraf** workflow, but arbitrary third-party JavaScript is opaque and conversion
  may be lossy. Preserve and report the editor's recovery/loss summary.
- The MCP server does not expose a raw package-decompilation tool. When the user asks to open or
  convert an existing OGraf package, use the visible editor workflow rather than fabricating a
  project document.
- Use `ograf_import_asset` for one workspace-confined image, font, CSS, or source attachment. Use
  `ograf_import_svg_bundle` for one SVG plus companion CSS, images, and fonts; it embeds relative
  dependencies into one portable SVG and registers packaged fonts. The result remains one image
  layer—arbitrary Photoshop raster/vector output is not semantically decomposed into editable
  objects.

## Template sets and cropping

Use `.ogs` for single templates or sets; legacy `.ogp` remains readable. Discover `templateSets` and
`elements` capabilities before editing them. `ograf_get_template_set` reads the live set and returns
an opaque set revision; use it with `ograf_update_template_set`. It is distinct from the numeric
project revision used by `ograf_apply_operations`. Re-read the active project after template switches
or shared defaults change. Template-set operations require the connected editor.

`settingsOrigins` and master Brand Kit overrides are documented in the template-set reference.

Use `set_layer_crop` for any visual layer, source crops for images/sequences or Media Cue visuals,
and `set_composition.crop` only for the output canvas. Keep normalized source/layer fractions distinct
from canvas pixels. Crop changes preserve source assets and animation timing. Read
[template sets and crops](./references/template-sets-and-crops.md) for commands, inheritance,
group coordinates, reset, file boundaries, and hosting certified exports in a website tutorial.

## Editable vector paths

Available in Studio 0.14 and later. Discover the running server's capabilities before use.
In Studio 0.15+, blank-canvas clicks keep point editing active; Done or Escape exits.

Use `edit_path` for rectangle/ellipse conversion and static anchor/handle edits. Read
`elementSchemas.path.editing` and `ograf_inspect_scene` → `pathEditing` first. Pass the returned
`d` as `edit.expectedD` and zero-based contour/node indices; re-read after inserting or removing
points. Shape edits apply across the whole animation. See
[references/path-editing.md](./references/path-editing.md) for conversion boundaries and examples.
Use path `stretchInsets` to preserve fixed-edge art during resize.

## Lottie layers

Read `elementSchemas.lottie.runtimeProfile` from the `elements` capability section before authoring
or assessing Lottie. Create a layer with `add_layer.kind: "lottie"` and a complete self-contained
`element.animationData` object, or ask the operator to use **+ Lottie JSON** for a local file. Keep
the imported JSON intact. External image/font paths, segmented documents, and luma mattes are
rejected; alpha mattes are supported. Embedded data-URI images are decoded and awaited;
expressions are ignored by the light Canvas renderer and reported as warnings.

After import, read `lottieInspection` from `ograf_inspect_scene`. Treat every warning as a review
item. Render representative early, middle, late, and loop-boundary frames, then exercise a backward
seek. Non-realtime `goToTime()` rebuilds and awaits a changed Lottie frame so the same timestamp is
byte-repeatable. Paused Timeline scrubbing uses the same settled-frame rule, while Timeline and
realtime playback retain one efficient player. Certification compares Canvas pixel signatures
across its backward/repeated seek. A successful Canvas result does not establish SVG, original
After Effects, HbbTV, or other target-renderer parity, so report those separately.

Native tickers: [guide](./references/native-ticker.md).

Native live data connections: [guide](./references/data-connections.md).

For interactive applications or stalls at feed refreshes, read the
[live UI performance guidance](./references/ograf-invariants.md#live-data-and-application-ui-performance).

## Chart.js layers

See [charts.md](./references/charts.md) for chart authoring and verification.
For versioned chart providers and Configuration trust/install boundaries, read
[renderer-plugins.md](./references/renderer-plugins.md) before changing a provider. For installed
data-only entrance/exit packs, read [animation-plugins.md](./references/animation-plugins.md).
For installed GLSL packs and copied shader attribution, read [shader-plugins.md](./references/shader-plugins.md).

## Composable effects

Smart layout: [Modifiers](./references/modifiers.md) covers fit, size, follow, hide,
arrange, look-at and spline paths.

Use `add_effect`, `update_effect`, `duplicate_effect`, `remove_effect`, and `reorder_effects` inside
revision-checked batches; discover the `elements` parameter catalog. New effects start bypassed;
`blendMode` enables them and `blendOpacity` mixes 0..1. Effects run top-to-bottom, repeated types
are allowed, and returned IDs remain stable. Animate `effects.ID.PARAM` paths; runtime data
overrides sampled values. `update_effect` accepts
`patch: {name?,enabled?,blendMode?,blendOpacity?,params?,shader?}`; numeric edits affect authored
frames unless `scope:"frame"` is used. Bypass/reorder preserve keys; duplicate/remove own only that
entry's keys and links. Legacy blur/shadow retain their tracks and bindings. Read
[effects-stack.md](./references/effects-stack.md) for examples and limits.

A `shader` effect is an ordered WebGL 2 pass: `iChannel0` is prior stack output. Store its source
and controls in the complete `shader` paint; never set `inputImage`. SVG projections omit shader
pixels, so use browser capture/certification. Shader layers cannot be alpha-mask sources.

A complete persistent-group selection exposes a synchronized Group effects stack. Studio
materializes shared entries onto ordinary member layers, preserving standard OGraf export.

## Shader paints and animation

Read `ograf_get_capabilities sections:["shaders","loops"]` and inspect the target before editing.
Use `update_element.patch.fill` with a complete shader paint (`type`, `fragmentSource`, `speed`,
`resolutionScale`, `parameters`, optional `inputImage`); text also accepts independent `strokePaint`. Keep text editable.
Shader RGB replaces source colors and is clipped by the object's shape/alpha. Shaders provide a
single WebGL2 Image pass with `mainImage`, `iTime`, `iResolution`, and one optional embedded PNG/JPEG
sampled as `iChannel0` with `iChannelResolution[0]`. Additional channels, layers-below inputs,
video, feedback, custom uniforms and audio are unsupported. Preserve source licensing.

`#pragma ograf NAME slider|color|toggle|vector2 ...` marks literal declarations and automatically
creates typed data fields. No `expose` keyword or duplicate manual fields are needed. Use the
inspected `shaderAnimationProperties` paths and limits for `set_property_track`, or
`set_layer_loop` plus `set_loop_property_track`. Scalars use `fill.parameters.NAME` or text
`strokePaint.parameters.NAME`; vectors use `.x/.y`, colors `.r/.g/.b/.a`. Floats interpolate;
integers/toggles hold (boolean keys are 0/1). Active keyed channels override data; unkeyed channels
retain data/defaults. Loop-only channels return to data when inactive. `iTime` is independent.

Resources → Shaders lists library and applied Fill/Outline/Effect entries. Properties → Edit shader
opens its editor; controls stay in Properties. Applied edits affect one usage; dragging copies
independently. `include:["shaders"]` reads only `project.shaders`; inspect layers/effects for applied
paints. Library mutations use the UI. See [shader and pattern workflows](./references/shaders-and-patterns.md)
for source, animation and editor/MCP details.

## Procedural patterns

Read `ograf_get_capabilities sections:["tiling"]`. Prefer a matching `tiling.presets.entries[].patch`
(Dots, Stripes, Chevrons, Diamonds, Checkerboard, Monogram), adapting its reference dimensions and
frame rate to the target composition. Send that patch to `set_tiling_pattern`; there is no
`presetId` argument. Empty patches still create the legacy O/D motif. Presets start static;
set `cyclesPerLoop` above zero and `cycleFrames` to the desired seconds × frame rate for motion.
Use `createLayer:false` for a resource only, and returned `patternId` for linked pattern layers.

Keep geometry in `composition.patterns`; never bake tile copies into paths or author
`element.definition`. Edit by `patternId` or unique `patternName`; shared symbols/layout/motion
update every instance, while fill, outline, transforms and effects belong to each layer. Sources
are SVG paths; `sequence` entries use `{symbolKey,gapScale}`. Seeded variation is repeatable.
`rowOverrides` can override direction/cycles/phase; clear applicable overrides to restore shared
controls. Integer row cycles keep the repeat seamless. Row motion starts at the first Step and
continues while on-air; additional paint/effect loops keep independent periods.

The visual editor offers preset previews, selected vector silhouettes, SVG symbol import,
layout/motion controls, independent Play/Pause preview, Duplicate, and Make independent. These
UI conveniences are not extra MCP operations: send explicit symbols/sequence, or copy a definition
without its id and relink only the intended layer. Inspect `ograf_get_project include:["patterns"]`
and `ograf_sample_tracks` with `loopElapsedFrame` for resolved `patternRows`; compare zero and a
full cycle. Unlink layer, component and lighting references before deleting a resource.

See [shader and pattern workflows](./references/shaders-and-patterns.md) for editor mappings,
SVG limits and operation examples. Shared light/glow timing uses `set_tiling_pattern.patch.lighting`
and `set_layer_lighting`; see [shared lighting](./references/shared-lighting.md). Brand Kit remains
in its own pane; token-linked field defaults and runtime data keep their existing semantics.

Color fields can use `defaultTokenId` for a Brand Kit token: token edits update the authored field
default, while playback data overrides it. Set `defaultTokenId:null` to detach; an explicit field
default edit also detaches. Bind color fields to `fill.stops[N].color`, `strokeColor`, or
`dropShadowColor`; whole-gradient fields target `fill`. Stop-color edits preserve gradient alpha
and motion, while whole-fill edits replace the gradient. Share a token across glint stops and use
separate tokens for highlight/shade. Verify recoloring and backward seeking without restarting motion.

## Authoring rules

Design for air: align edges, protect readable text over video, use easing-out on entry and
easing-in on exit, and keep on-air motion subtle. Test rundowns are authoring-only data.

- Prefer `sessionId: "editor"` when collaborating in the visible application.
- Assign meaningful `set_layer_semantics` roles, tags, and descriptions. For built-in lower third,
  bug, native ticker, scoreboard, live clock/timer or countdown starters, read
  [broadcast recipes](./references/broadcast-recipes.md). Recipes create editable linked assets by
  default; `asComponent:false` keeps independent layers. Query stable returned IDs for later edits.
  Semantic metadata guides authoring and QA but never enters compiled playout.
- Prefer `apply_style_pack` before broad styling. `news`, `sports`, `entertainment`, and
  `documentary` copy an immutable catalog definition into normal editable Brand Kit tokens, then
  materialize compatible semantic layer properties. Palette, modular type scale, radius/outline,
  and motion-convention tokens remain editable starting points. Token links are authoring metadata;
  exported graphics have no style-pack runtime dependency. A recipe `stylePack` option applies the
  same vocabulary while explicit recipe theme/motion values remain deliberate overrides.
- Packs recolor existing controls and GDD defaults while retaining gradient alpha/shading and motion.
  Parent swatch edits propagate. `remove_style_pack` restores recorded fonts, colors, bindings,
  tokens/defaults and timing; content/layout edits survive. The baseline persists across pack
  switches and `.ogs` reloads. Legacy packs without a baseline only detach. See
  [style-packs.md](./references/style-packs.md) for color routing and restoration limits.
- Text outlines use static `strokeColor` plus an independent, non-negative numeric `strokeWidth`
  track. Use them for legibility over unpredictable video, especially sports and score graphics.
  Keep `paint-order: stroke fill` semantics by authoring through Studio rather than simulating an
  outline with duplicate text layers. Stroke width can also use a local loop. Text `strokePaint`
  supports an independent shader outline; its declared channels can own their own tracks.
- Choose text sizing deliberately. `auto-size` changes the authored box around the authored font;
  `shrink-to-fit` only reduces glyphs and stops at `minFontSize`; `fit-to-width` keeps the authored
  box fixed and grows or shrinks glyphs to the largest uniform size that fits both box axes;
  `squeeze` deliberately scales glyph width and height independently to fill the authored box;
  `fixed` performs no fitting. Fit-to-width keeps the typeface proportional and treats only explicit
  line breaks as multiple lines. Use squeeze only when deformation is intentional, and verify
  data-bound extremes with `ograf_measure_text`.
- `save_component` creates an asset and links the selected source objects. `instantiate_component`
  defaults to linked inheritance; use `linked:false` for an independent copy. Asset edits propagate
  while local overrides and instance placement survive. Use `reset_component_overrides` to inherit
  again or `make_component_unique` for a separate asset. Export contains ordinary resolved layers.
- Use `create_repeater` when a finite horizontal or vertical collection should be materialized from
  selected source layers. It creates ordinary grouped layers and cloned fields with semantic item
  tags; use runtime data fields normally afterward. It is not a live array-binding primitive.
- Use `create_runtime_collection` when Reality Hub supplies a variable-length object-item array.
  Author one contiguous persistent group as the item prototype, bind its properties to scalar item
  leaves with `sourcePath: ["segment", ...]`, then register explicit `offsetPerItem`, capacity 1..100,
  and `overflow: "truncate"`. Every instance shares the prototype lifecycle and absolute loop phase;
  array updates replace by index and remain deterministic under scheduled `goToTime()` seeking.
  Scalar arrays are schema-only, and scroll/pagination/keyed move animation are not supported.
- Use property tracks independently. Changing `x` must not create or retime `opacity`, `rotation`, or another layer's keys.
- Ordinary `add_layer` output starts at opacity 1 on every default lifecycle key. Author hidden
  Start/End opacity explicitly when an entrance or exit is intended; semantic recipes continue to
  create their own deliberate motion states.
- Prefer `set_property_track` for a complete track and `stagger_property_track` for repeated
  multi-layer timing; both remain operations inside the same revision-checked atomic batch.
- Use `set_layer_loop` plus `set_loop_property_track` for ambient motion while a Graphic is on-air
  or parked at one Step. Local keys use `0..durationFrames`, retain independent easing per property,
  and never become lifecycle markers. Keep repeat seams equal unless a masked ticker intentionally
  wraps offscreen. Use `repeatCount: null` for infinite motion. Loops must never invoke OGraf actions.
- For a one-shot trigger, use `activation: {type:"customAction",customActionId}` and finite repeats.
  Its payload updates data before matching clips play and settle; the manifest publishes duration.
- Use `add_media_cue` with an audio clip source and `trigger:{type:"customAction",actionId}` for
  action-triggered sound. In Studio choose Audio → Create Playback Cue, then select the Custom
  Action under Resources → Media. Add at Playhead remains the simpler timeline Sound Event path.
- Use `update_transform`/`update_effects` with their default `scope: "authored"` for base layout;
  use `scope: "frame"` plus `frame` only when intentionally authoring animation at one frame.
- Use exact `layerName` and `fieldKey` selectors when they reduce UUID payload; ambiguity is an
  error. A selector can resolve a layer or field created earlier in the same atomic batch. Use IDs
  for long-lived references and surgical key edits.
- Register reusable image payloads once with `add_asset`, then use `asset:<id>` in image elements,
  image sequences, or image-url defaults. Do not repeat base64 in layer definitions.
- Use `add_asset`/`update_asset` metadata for packaged fonts and source attachments: family,
  weight/style, safe relative package path, original name, and license details. Identical payloads
  are deduplicated. Do not remove a resource until its reported layer/field/font uses are retargeted.
- Use `set_layer_bindings` when one layer exposes more than one data-driven property. Each binding
  accepts a stable `fieldId` or unique `fieldKey`, and each target property may appear only once.
  `set_layer_binding` remains a legacy single-binding replacement and clears any additional rows.
  In the Studio Properties UI, **+ Add Binding** creates a field seeded from the next unbound
  property's current value and connects it in one undoable edit; the Field menu can then retarget
  that binding to an existing field. MCP operations still require explicit field creation.
- Treat the data schema as the operator contract. Author meaningful field `description`, select
  `options`, file extensions, and JSON Schema constraints through `add_data_field` or
  `update_data_field`; every compiled field emits `gddType`. Give bound on-air text a realistic
  `maxLength` so Reality Hub/Form Builder can prevent unusable values before playout. Object
  `properties` and array `items` use the same recursive field shape; keep property keys unique and
  defaults valid. A runtime collection requires array `items.fieldType: "object"`, and its capacity
  is emitted as `maxItems`. Use `itemKeyPath`, sorting, and page/pageSize for ranking tables whose
  stable items must animate between ordered slots.
- Use `duplicate_group` for independent repeated cells. Animate the source before duplication if
  its animation must be copied. A positive `frameOffset` shifts non-lifecycle authored keys only;
  Start/Step/End compatibility keys remain anchored. Ensure headroom for the shifted authored keys;
  genuine out-of-range results are rejected rather than clamped.
- Use `set_composition_layout` and canvas-guide operations for editor layout aids. Use
  `set_layer_layout` for locking, persistent groups, parenting, responsive constraints, and
  `autoLayout`. Horizontal/vertical flow uses paint order, gap, four-sided padding, alignment,
  optional width/height hugging, minimum/maximum hugged width, and hidden-item collapse. Auto-size
  text contributes its measured bound content size. These fields are authoring-only except
  `clipChildren` and `autoLayout`: setting clipping on a parent compiles a deterministic
  animated rectangular mask for direct children. Constraint and ordinary parent translation edits
  still bake their visual results into regular property tracks. `dimOutsideCanvas` adds the Studio
  viewport's solid 20% gray surround outside the composition only. `presentationBackground` can
  use the bundled video, an editor-only still image, or a permissioned local webcam; none exports.
- `set_layer_visual_rules` replaces a layer's ordered rules; Studio **+ New rule** immediately
  creates and opens an undoable rule on an editable scene object, creating the first condition
  field automatically when needed. Rules combine conditions, compare fields, drive other layers
  (`targetLayerId`), and fire from data, hover/pointer, or playout (`play`, `step`, `stop`,
  `custom-action`). Later matching state actions win; hidden results collapse from Auto layout when
  `collapseHidden` is enabled. See [visual rules](./references/visual-rules.md).
- Rules `playout` actions send Take/Update/Out/Clear to set lane/state IDs using coordinated timing
  and dependencies; active commands require coordinated set output. Read
  [playout rules](./references/visual-rules.md#coordinated-playout-actions) for targets, data and limits.
- Native Data Connections map URL/embedded JSON/CSV or public market feeds into editor and on-air
  preview data. Feed patches preserve lane transitions; explicit Update commands retain authored
  timing. Exports receive controller data. See [data connections](./references/data-connections.md).
- Author designed data changes with `set_composition.updateTransitionFrames/updateInterruption` and
  `set_layer_layout.updateTransition`. Layers support inherit, none, crossfade, and four slide styles
  with duration/distance overrides; unbound backgrounds remain stationary.
- Use `retime_animation_phase` to fit IN, on-air, OUT, or the entire sequence to a target frame
  count. It scales contained property keys proportionally, shifts later keys, and leaves local loops unchanged.
- `set_layer_layout.motionPath` attaches a layer to an editable path. Animate
  `motionPathProgress` from 0..1 on the Timeline or a local 0→1→0 loop; orientation follows the
  tangent when enabled.
- Timeline exposes a value graph for every selected numeric property track; graph drags remain
  ordinary key frame/value edits and preserve the existing incoming easing/Bézier contract.
- Text supports ordered `runs` with color/weight/style/font overrides plus explicit `direction` and
  BCP 47 `language`. Keep run text equal to `content`; a binding preserves styles for unchanged text
  and clears runs for new operator text.
- Use `add_layer kind:"clock"` for live clocks/timers. Read [clocks and timers](./references/clocks-and-timers.md)
  for formats, external data, timer commands and update text FX.
- Text `textAnimation` supports deterministic `typewriter`, `fade`, `rise`, `pop`, `word-reveal`,
  `flip`, `blur`, `rotate`, `stretch`, `count-up`, `count-down`, `roll-up`, and `roll-down` presets without character layers. Patch the complete object through
  `update_element`: `split` is `grapheme|word`, `durationFrames` is positive, and word reveal
  always uses word segmentation. Typewriter alone uses `cursor:none|bar|block` and positive
  `cursorBlinkFrames`. `replayOnUpdate` responds to changed Content bindings;
  `customActionId` references an existing OGraf custom action. The initial animation begins at
  frame zero; keep its duration inside IN when text must be complete at the first Step. Grapheme
  mode preserves emoji and combining marks. Playback and cursor blinking remain frame-sampled
  under backward `goToTime()` seeks.
- Counting presets finish at the single formatted number in Content. Use `countFrom:number|null`
  for an explicit or automatic start. They retain numeric formatting and surrounding text;
  multi-number text and timecodes remain unchanged. `split` does not apply to counting.
- `roll-up`/`roll-down` animate changed characters from the previous data/time value when replay is
  enabled, including full clock formats. Counters can additionally use `countRoll:up|down` for rolling
  digits while counting; `none` keeps plain numeric updates.
- Treat the exposed action/title safe bounds as EBU R 95 16:9 geometry: action safe is inset 3.5%
  per axis and title/graphics safe is inset 5% per axis, with pixel margins rounded to the nearest
  integer. At 1920x1080 this is 67/38 px and 96/54 px; at 3840x2160 it is 134/76 px and 192/108 px.
  Use the bounds returned by scene inspection rather than reviving legacy 5%/10% assumptions.
- Use `create_timeline_group` to organize two or more related timeline rows after their stable layer
  IDs are known. This is recommended for multi-part lower thirds, repeated forecast/day cells, and
  other compositions with many independently animated layers. Rename and color groups for legible
  agent/human handoff; use `ungroup_timeline_group` to remove the organization. Timeline groups are
  UI-only metadata: they do not change paint order, transforms, animation, canvas `groupId`, or
  compiled OGraf output. The source document retains the legacy `timelineFolders` storage field for
  compatibility, while MCP inspection exposes the canonical `timelineGroups` alias.
- Prefer a `clipChildren` parent plus one animated size track for wipes/reveals; do not approximate
  masking with synchronized opacity fades on every child. `duplicate_group` preserves and remaps the
  clipping relationship. The mask follows animated parent rotation and transform origin as well as
  position/size, so rotate the parent to create a diagonal wipe; children retain their own rotation.
- Use `set_layer_flags.blendMode` for static composition-local compositing. Blend modes operate only
  against lower layers inside OGraf Studio's isolated transparent composition; they never blend
  against a controller's external video bed. Do not rely on the editor checkerboard as source
  imagery, and keep a normal-mode fallback when a target renderer has not been smoke-tested.
- Rectangle, ellipse, path, and pattern `fill` accept a solid color string or a complete linear/radial/conic
  gradient object. Bind the whole gradient through a `gradient` data field; color fields can target `fill.stops[N].color`. Animate a stop position with the numeric property
  `fill.stops[N].offset`, using a zero-based stop index and values from 0 to 1. Prefer three-stop
  transparent/bright/transparent tracks for deterministic glint sweeps.
- Use a gradient directly on a path for illuminated letterforms; `fillRule: "evenodd"` preserves
  nested holes regardless of winding. Keep the original `d` and viewBox; avoid inverse stencils
  or duplicated geometry merely to paint a gradient. Paths support the same fill bindings and
  `fill.stops[N].offset` lifecycle/local-loop tracks as rectangles.
- Use `set_layer_mask` for a separate matte. Select the target by `layerId` or `layerName` and the
  source by `sourceLayerId` or `sourceLayerName`; earlier creations in the same batch resolve by
  name. `mode: "alpha"` uses painted transparency, opacity, blur and shadows from rectangle,
  ellipse, path, pattern or image sources. `mode: "path"` uses rectangle/ellipse/path/pattern geometry and fillRule,
  ignoring source paint, stroke, opacity and effects. Any supported layer kind may be the target.
  Set `inverted: true` to reveal the complement inside the target bounds. Text, sequences and
  Lottie are not mask sources; use a vector path or alpha image for those mattes.
- `hideSource` defaults to true and sets source `isMaskOnly`; it remains selectable in Layers and
  usable by multiple targets. Do not hide it with `isVisible: false`, which disables its mask
  contribution. `set_layer_flags isMaskOnly: false` shows its normal output again. Detach with
  `sourceLayerId: null`; detaching does not unhide a shared source. Animate the source's own tracks
  or local loop; do not duplicate its movement onto the target. Mask chains must be acyclic and
  stay within one composition/runtime-collection prototype. Include mask sources in component
  selections; duplication remaps included sources. Detach consumers before deleting a source.
- Keep frames integral and within the composition duration. When a millisecond request is not an
  integer frame at the authored rate, report the exact fractional mapping and choose down, nearest,
  or up explicitly; do not silently round.
- Treat a lifecycle Step move as an explicit adjacent-transition retime. It must never silently move
  property keys; report keys left at the old boundary or outside a shortened End.
- Treat `set_transition` warnings as actionable: duration changes can strand property keys at a
  moved lifecycle frame or outside the new duration. Retiming is never implicit.
- Omitted easing on newly authored generic keys and transitions is linear. Recipes must specify any
  intentional non-linear entrance, exit, update, or loop motion explicitly.
- Preserve Start and End lifecycle states. Only Step states are pausable OGraf steps.
- Do not encode editor-only automation or cross-timeline triggers into output. Pointer and keyboard rules are
  real-time HTML interactions, not deterministic non-real-time scheduled actions.
- Use `ograf_undo` to reverse the last agent transaction. Direct browser edits retain their own browser history.
- Use `ograf_get_changes` after a revision conflict to distinguish browser edits from agent edits.
- Use `ograf_reset_project` with explicit confirmation for a genuinely fresh visible session; the
  reset is an undoable agent transaction. Do not manually tear down every layer and field.
- Never write project JSON or construct a package outside the MCP save/export tools; doing so bypasses certification.
- If the editor is disconnected and you have browser control, open the configured Studio URL:
  the MCP origin for a standalone server, or localhost:5173 for the separate Vite development setup.

## References

- [Editable SVG, PSD and Figma imports](./references/design-imports.md) for supported editable
  objects, image fallbacks and the separate single-image MCP SVG-bundle workflow.
- [Text animators and motion blur](./references/text-animators.md) for seeded per-property
  text motion and experimental velocity blur.
- [Review and test rundowns](./references/review-and-rundowns.md) for local comments, named
  versions, explicit human approvals and authoring-only test data.

Studio labels map to model terms: Before/On air/After are start/step/end; Smart layout means
modifiers; Operator controls are exposed fields; component masters and uses are sources and instances.

- Read [references/tool-workflows.md](./references/tool-workflows.md) for operation shapes and task sequences.
- Read [references/ograf-invariants.md](./references/ograf-invariants.md) before lifecycle, timing, data-binding, or export work.
- Read [references/examples.md](./references/examples.md) for a compact lower-third transaction pattern.
- Read [references/setup.md](./references/setup.md) only for local startup, connection recovery,
  Claude Desktop configuration, or workspace confinement.
- Read [references/media-paints.md](./references/media-paints.md) for packaged clips, live tags,
  realtime limits, fallbacks, and renderer requirements.
- Read [references/visual-rules.md](./references/visual-rules.md) before authoring rules: triggers,
  keyboard shortcuts, conditions, cross-layer targets, delays, and transitions.
- Read [references/functions.md](./references/functions.md) for reusable calculations, state logic,
  games, explicit data/action mappings, isolated execution, and standalone realtime limits.
- Read [references/layer-motion.md](./references/layer-motion.md) for Animate In/Out presets and
  their ordinary-keyframe MCP operation.
