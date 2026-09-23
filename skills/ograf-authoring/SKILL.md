---
name: ograf-authoring
description: Create, inspect, animate, review, validate, certify, save, and export editable EBU OGraf-compatible broadcast graphics through OGraf Studio MCP. Use for lower thirds, scoreboards, tickers, Lottie layers, shader paints and exposed shader animation, procedural pattern presets, composable effects stacks, semantic scene authoring, Brand Kits, finite repeaters, runtime GDD collections, reusable components, HTML5 broadcast templates, .ogs source, .ograf.zip packages, per-property animation, data binding, and OGraf compliance work.
---

# OGraf Authoring

Use OGraf Studio's canonical editable model. Require final OGraf certification.

If the MCP dependency is unavailable, use
[references/setup.md](./references/setup.md) to start or recover the local editor and server. Do not
replace the tools with raw file editing.

Detached panes share one session; keep Studio open. See [multi-window guidance](./references/detached-windows.md).

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
2. Call `ograf_query_scene`, `ograf_get_project`, or `ograf_inspect_scene` before editing. Prefer
   the semantic query when roles, tags, names, bindings, element kinds, or animation status can
   identify the intended layers compactly. Preserve returned stable IDs and `revision`. For routine
   project reads, prefer explicit `include` sections with
   `tracks: "animated-only"`; omit filters when a complete compatibility snapshot is required.
3. Build one coherent `ograf_apply_operations` batch. Use `mode: "preview"` when geometry, paint,
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
6. Call `ograf_certify_project` before reporting output as compatible. Pass `profile` when the
   result is specifically real-time, non-real-time, or dual-mode; omitting it certifies the project-
   declared flags.
7. Use `ograf_save_project` or `ograf_export_package` only when the user requested a file operation.
   For package export choose the named `realtime`, `non-realtime`, or `dual` profile; it derives
   output flags and identity without mutating source. Pass `confirm: true`; leave `overwrite` false
   unless replacement was explicitly intended.

The live browser editor must be open for visual operation previews/proposals, PNG capture/strips,
certification, save, and export.
Capture and strips are read-only and never substitute for certified save/export. Certification
tools certify the exact compiled artifacts and fail closed when the editor is unavailable.

## File and import boundaries

- `.ogs` is editable source for this editor. Legacy `.ogeproj` sources remain readable, but new
  saves use `.ogs`. Project source is not an OGraf manifest or a playout package.
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

## Editable vector paths

Available in Studio 0.14 and later. Discover the running server's capabilities before use.
In Studio 0.15+, blank-canvas clicks keep point editing active; Done or Escape exits.

Use `edit_path` for rectangle/ellipse conversion and static anchor/handle edits. Read
`elementSchemas.path.editing` and `ograf_inspect_scene` → `pathEditing` first. Pass the returned
`d` as `edit.expectedD` and zero-based contour/node indices; re-read after inserting or removing
points. Shape edits apply across the whole animation. See
[references/path-editing.md](./references/path-editing.md) for conversion boundaries and examples.

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

## Composable effects

Use `add_effect`, `update_effect`, `duplicate_effect`, `remove_effect`, and `reorder_effects` inside
revision-checked batches. Discover `elements` capabilities for the parameter catalog. New effects
start bypassed. Select a `blendMode` to enable; `blendOpacity` mixes 0..1 with the input. Existing
effects without blend settings retain Normal/100%. Effects run
top-to-bottom; repeated types are allowed. Returned effect IDs and `results.properties` are stable
through reorder. Animate exact `effects.ID.PARAM` paths using normal tracks or local loops; bind
color/number tokens or runtime fields to those paths. Runtime data overrides sampled parameters.
`update_effect` accepts `patch: {name?,enabled?,blendMode?,blendOpacity?,params?,shader?}`; numeric edits default to authored lifecycle
frames, or use `scope:"frame"` with `frame`. Bypass/reorder preserve keys. Duplicate copies only the
selected effect's keys and links; remove deletes those keys/links while keeping fields. Old blur
and shadow use reorderable compatibility slots and retain old tracks/bindings. Read
[effects-stack.md](./references/effects-stack.md) for examples and limits.

A `shader` effect, authored with `add_effect effectType:"shader"`, is an ordered WebGL 2
post-process pass: `iChannel0` is the flattened result after preceding effects, and its blended
output feeds later effects. Its complete
`shader` paint stores `fragmentSource`, `speed`, `resolutionScale`, and pragma parameters; do not set
`inputImage` because the incoming stack owns `iChannel0`. Source and static controls are editable in
the effect disclosure. SVG-only projections cannot reproduce shader-effect pixels; require browser
capture/certification for visual proof. Shader-rendered layers cannot serve as alpha-mask sources.

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

Resources → Shaders supports New Shader, name/Edit/Load/Save, removal, and drag to Fill or text
Outline. Saved `project.shaders` paints are independent copies when applied. MCP can read them
with `include:["shaders"]` and apply their paint through `update_element`; library creation and
editing currently use the editor UI. Read [shader and pattern workflows](./references/shaders-and-patterns.md)
for exact examples, alpha, loop sampling, and current UI/MCP boundaries.

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

- Prefer `sessionId: "editor"` when collaborating in the visible application.
- Assign meaningful `set_layer_semantics` roles, tags, and descriptions to authored layers. Use
  `create_lower_third`, `create_bug`, `create_ticker`, `create_scoreboard`, or `create_clock` when
  the brief matches a standard grouped semantic recipe, then use `ograf_query_scene` for compact
  later selection. The ticker recipe deliberately uses a clipped local loop for its crawl rather
  than a lifecycle-long translation. Recipe output is ordinary editable OGraf layers, fields,
  groups, and tracks; semantic metadata guides authoring and QA but never enters compiled playout.
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
- Use `save_component` plus `instantiate_component` with `linked: false` for permanent independent
  instances. Use `linked: true` only when explicit later refresh is valuable; update a component
  from selected layers and call `refresh_component_instances` deliberately because refresh replaces
  linked instance content from the latest snapshot. There is no live master at playout time.
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
- Treat the data schema as the operator contract. Author meaningful field `description`, select
  `options`, file extensions, and JSON Schema constraints through `add_data_field` or
  `update_data_field`; every compiled field emits `gddType`. Give bound on-air text a realistic
  `maxLength` so Reality Hub/Form Builder can prevent unusable values before playout. Object
  `properties` and array `items` use the same recursive field shape; keep property keys unique and
  defaults valid. A runtime collection requires array `items.fieldType: "object"`, and its capacity
  is emitted as `maxItems`.
- Use `duplicate_group` for independent repeated cells. Animate the source before duplication if
  its animation must be copied. A positive `frameOffset` shifts non-lifecycle authored keys only;
  Start/Step/End compatibility keys remain anchored. Ensure headroom for the shifted authored keys;
  genuine out-of-range results are rejected rather than clamped.
- Use `set_composition_layout` and canvas-guide operations for editor layout aids. Use
  `set_layer_layout` for locking, persistent groups, parenting, and responsive constraints. These
  fields are authoring-only except `clipChildren`: setting it on a parent compiles a deterministic
  animated rectangular mask for direct children. Constraint and ordinary parent translation edits
  still bake their visual results into regular property tracks. `dimOutsideCanvas` adds the Studio
  viewport's solid 20% gray surround outside the composition only. `presentationBackground` can
  use the bundled video or an editor-only still-image URL; local still-image embedding is available
  in Canvas Layout. Never recreate these authoring aids as exported layers or backgrounds.
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
- Do not encode editor-only automation or cross-timeline triggers into output. Compile only deterministic OGraf lifecycle, schedule, data, and animation behavior.
- Use `ograf_undo` to reverse the last agent transaction. Direct browser edits retain their own browser history.
- Use `ograf_get_changes` after a revision conflict to distinguish browser edits from agent edits.
- Use `ograf_reset_project` with explicit confirmation for a genuinely fresh visible session; the
  reset is an undoable agent transaction. Do not manually tear down every layer and field.
- Never write project JSON or construct a package outside the MCP save/export tools; doing so bypasses certification.
- If the editor is disconnected and you have browser control, open the configured Studio URL:
  the MCP origin for a standalone server, or localhost:5173 for the separate Vite development setup.

## References

- Read [references/tool-workflows.md](./references/tool-workflows.md) for operation shapes and task sequences.
- Read [references/ograf-invariants.md](./references/ograf-invariants.md) before lifecycle, timing, data-binding, or export work.
- Read [references/examples.md](./references/examples.md) for a compact lower-third transaction pattern.
- Read [references/setup.md](./references/setup.md) only for local startup, connection recovery,
  Claude Desktop configuration, or workspace confinement.
