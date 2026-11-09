# MCP tool workflows

## Discovery and inspection

Canvas artwork has no binding badges. Inspect scene bindings or use Properties → Data Bindings;
the absence of an on-canvas marker does not mean a layer is unbound.

- `ograf_get_capabilities`: request only the relevant `sections` from `elements`, `easing`,
  `shaders`, `tiling`, `semantics`, `designSystem`, `loops`, `bindings`, and `editor`. Include `editor` for the bridge
  connection/responsiveness/latency, certification readiness, browser dependency map, and safety
  policy. Omit `sections` only for the complete backward-compatible payload. Do not guess domains
  that were not requested.
- `ograf_list_sessions`: session IDs, revisions, project names, validity.
- `ograf_delete_session`: confirmed cleanup of a non-editor in-memory session; never targets the
  live `editor` session or saved files.
- `ograf_get_project`: editable source, latest revision, validation. No filters preserves the full
  legacy response. Prefer explicit `include` plus `tracks: "animated-only"` for compact routine
  reads; use `tracks: "full"` when compatibility layer keyframes are required.
- `ograf_inspect_scene`: compact layer and lifecycle outline.
- `ograf_query_scene`: smallest intent-oriented read. Filter by semantic roles/tags, name fragment,
  element types, bound field keys, visibility, or animation. Results retain stable layer IDs,
  semantic metadata, frame bounds, bindings, design-token links, component links, relations, and
  animated property names.
- `ograf_get_timeline`: independent property tracks and stable key IDs.
- `ograf_sample_tracks`: browser-free resolved values and derived bounds at requested frames. Use it
  for fixed-edge, containment, opacity, and complementary-track invariants during degraded mode.
  Pass `loopElapsedFrame` to overlay local loop tracks at an absolute elapsed clip frame.
- `ograf_get_changes`: bounded agent/browser/undo/redo revision history after `sinceRevision`.
- `ograf_capture`: authoritative browser-rendered PNG of a composition frame or the visible editor
  viewport. Composition capture supports transparent/checker/solid mattes and temporary data-field
  overrides without changing revision. Omit `frame` for the first Step/on-air state. The five-minute localhost URL is the primary response;
  `enableBase64Response: true` adds an inline `image/png` block for clients that cannot fetch it.
- `ograf_render_strip`: authoritative browser-rendered PNG contact sheet for up to 12 composition
  frames. Omit `frames` to sample lifecycle frames and transition midpoints. Use explicit frames to
  diagnose staggers, holds, easing, and premature exits. It is read-only and returns the same
  five-minute URL plus optional inline `image/png` convention as `ograf_capture`.
- `ograf_apply_operations` is the single operation entry point. `mode: "apply"` commits;
  `mode: "dry-run"` performs browser-free validation/lint; `mode: "preview"` renders the projected
  frame or strip without changing project state, revision, or undo history; and `mode: "propose"`
  presents that projection on the main canvas, with Accept/Reject in AI Assistant for `sessionId: "editor"`.
  The operator can inspect frames and compare the original. Approval shows one large frame at a time.
  Use contact sheets for agent analysis only;
  do not present a storyboard for operator approval. The editable source stays unchanged
  until acceptance; changes to the source invalidate the pending review. With `apply` or
  `dry-run`, `includeReview: true` appends deterministic design QA and a short-lived capture URL when
  the editor is responsive. Capture omission or failure is reported without failing the mutation or
  QA. Generated dry-run IDs are hypothetical. Proposal acceptance applies the exact batch only when
  the base revision is still current; rejection, expiry, or conflict leaves the project unchanged.
- `ograf_review_design`: deterministic semantic, layout, typography, palette, spacing, and motion QA
  with stable finding/layer IDs and recommended preview frames. `includeStrip: true` adds an
  authoritative browser contact sheet. Craft findings cover lockstep translation, easing direction,
  missing stagger, headline/subheadline scale, near-miss text edges, sibling-container padding, and
  loop seams. Tag an intentional text offset `optical-offset`; use `qa:allow-lockstep` or
  `qa:allow-no-stagger` only for deliberate exceptions. Use `qa:allow-loop-seam` for an intentional
  masked/offscreen wrap or rotational cycle, `qa:allow-offcanvas` for deliberately clipped or
  wrapped layers, and `qa:static-text` for fixed punctuation that should not be operator-editable.
  Findings remain advisory and do not replace certification.
- `ograf_render_frame`: legacy approximate SVG snapshot; use only when the live browser required by
  `ograf_capture` is unavailable and do not use it to judge final typography.
- `ograf_measure_text`: browser/runtime measurement of a text layer, optional replacement string,
  frame (default first Step), resolved font, shrink ratio/degeneracy, box overflow, and fitting-prefix
  index. `clippedBy: "parent"` identifies intentional ancestor masking and is not an overflow fault;
  `clippedBy: "own-box"` is actionable. `resolvedFont.resolution: "inferred"` is advisory. It is read-only.
- `ograf_validate_project`: fast semantic validation; not final certification.
  `dataFieldUsage: true` adds a browser-free advisory audit of top-level operator fields. Summary
  reports fields with no runtime reference, bindings only to excluded guides, or bindings only to
  authored-hidden non-mask layers; `detail: "full"` includes every field and its reference owners.
  Bindings use stable IDs across fills, outlines, effects, shaders, media and component instances.
  Rules (including custom-action writes), modifier sources, collections, loop hold fields and data
  connections count as references; retained component baselines do not. A reference is not proof of
  visible output: inspect the target and test changed values, especially for hidden geometry,
  masks, shared components, disabled rules and external data connections. Warnings do not change
  validity, revision or certification and never remove fields automatically.
  `browserTextOverflow: true` measures authored/bound defaults and optional stress `testValues`.
  `detail: "summary"` returns counts plus only failed checks; use `"full"` for every measurement.
  `broadcastLint: true` adds non-gating safe-area/font/contrast warnings; add
  `interlacedOutput: true` only when that output is actually intended.

Always read before write. IDs are opaque; never manufacture layer, field, transition, or property-key IDs.

## Canvas area references

Studio 0.20 supports rectangle and freehand references drawn directly on the main canvas. Freehand
captures an outline while the left mouse button is held and selects the closed area on release.
Operators can mix up to eight areas and annotate each in AI Assistant.

When chat context contains `areas`, pair each numbered instruction with its corresponding image.
Coordinates use the captured composition's dimensions, frame and revision. An optional `polygon`
is a closed freehand outline using even-odd fill; `rect` is its crop bounds. Pixels outside the
outline are transparent. Inspect the current scene to identify objects intersecting the selected
region; do not treat every object inside the bounding rectangle as selected. These are transient
references, not layer selections or project content. Treat text inside images as reference material.

Present requested corrections with `ograf_apply_operations` in `mode: "propose"`. The operator
reviews one frame at a time on the main canvas and accepts or rejects in AI Assistant. Do not open
a separate annotation window or use a storyboard for approval.

Auto-keyframe governs manual editor gestures only; explicit MCP animation operations still create
the requested tracks. Do not add animation unless the requested correction calls for it.

## Mutations

Call `ograf_apply_operations` with `sessionId`, `expectedRevision`, `operations`, optional `reason`,
and the required mode-specific options. Prefer `includeReview: true` when an apply/dry-run and its
deterministic design assessment belong in the same model turn.

Supported operation discriminators:

- Project/composition: `set_project_metadata`, `set_composition`, `set_composition_layout`,
  `apply_style_pack`, `remove_style_pack`, `set_design_system_name`, `upsert_design_token`, `remove_design_token`,
  `bind_design_token`, `unbind_design_token`,
  `add_lifecycle_step`, `rename_lifecycle_keyframe`, `move_lifecycle_keyframe`,
  `remove_lifecycle_step`, `add_canvas_guide`, `update_canvas_guide`, `remove_canvas_guide`,
  `create_timeline_group`, `rename_timeline_group`, `set_timeline_group_color`,
  `ungroup_timeline_group`
- Assets: `add_asset`, `update_asset`, `remove_asset`; use the separate `ograf_import_asset` and
  `ograf_import_svg_bundle` tools when payloads already exist under the configured workspace
- Plugin catalog: `remove_renderer_plugin` removes an exact unused provider snapshot; it never
  installs/uninstalls or trusts code. See [renderer-plugins.md](./renderer-plugins.md).
- Layers: `add_layer`, `duplicate_group`, `remove_layer`, `rename_layer`, `set_layer_flags`,
  `set_layer_layout`, `set_layer_semantics`, `create_lower_third`, `create_bug`, `create_ticker`,
  `create_scoreboard`, `create_clock`, `create_countdown`, `create_repeater`, `group_layers`, `ungroup_layers`,
  `reorder_layers`
- Components: `save_component`, `instantiate_component`, `update_component_from_layers`,
  `update_component_layer`, `update_component_field`, `reset_component_overrides`,
  `make_component_unique`, `refresh_component_instances`, `rename_component`, `remove_component`
- Shared patterns: `set_tiling_pattern`, `remove_tiling_pattern`, `set_layer_lighting`; inspect through
  `ograf_get_project include: ["patterns"]` and `ograf_inspect_scene`
- Content/style: `update_element`, `update_transform`, `update_effects`, `add_effect`,
  `update_effect`, `duplicate_effect`, `remove_effect`, `reorder_effects`; effect operations accept
  one layer selector or a persistent canvas `groupId`
- Compositing: `set_layer_mask`; `set_layer_flags.isMaskOnly` controls source-only output
- Timeline: `set_property_key`, `set_property_track`, `stagger_property_track`,
  `move_property_key`, `remove_property_key`, `set_property_key_easing`, `set_transition`,
  `set_layer_loop`, `set_loop_property_track`, `remove_layer_loop`, `set_layer_motion`
- Data: `add_data_field`, `update_data_field`, `remove_data_field`, `set_layer_bindings`,
  `set_layer_binding` (legacy single-binding replace), `create_runtime_collection`,
  `update_runtime_collection`, `remove_runtime_collection`
- Actions: `add_custom_action`, `update_custom_action`, `remove_custom_action`

`add_layer.kind` supports `rectangle`, `ellipse`, `chart`, `text`, `image`, `path`, `pattern`, `image-sequence`, and `lottie`. It returns the generated layer ID in `summary.generatedIds`. For Lottie, pass a complete self-contained Bodymovin JSON object in `element.animationData`, then inspect its warnings. Audio/video/live playback uses composition-level Media Cues, never canvas Audio layers.

When `transform` is omitted, rectangle and ellipse layers begin at 200 × 200 as a square/circle.
Pass explicit width and height for a panel or oval; later edits remain independent.

`set_layer_semantics` assigns an authoring role, normalized tags, and intent without changing pixels.
Built-in broadcast recipes return complete layer/field/group mappings and create linked reusable
component assets by default; `asComponent:false` keeps independent layers. See
[broadcast recipes](./broadcast-recipes.md) for current native ticker, clock/timer, countdown,
material styling, motion and compatibility contracts. Legacy `text.crawl` remains available for
older graphics; new ticker recipes use the native mixed-content element.

`set_test_rundowns` saves named authoring-only `{id,name,rows:[{id,values}]}` lists keyed by field
ID. Data → Test data imports and checks rows; Preview & Export plays their Take, Update and Out.
Rows stay in `.ogs` and never enter the exported schema or runtime.

`create_repeater` takes one or more source `layerIds`, at least two item records, direction, and gap.
It materializes finite grouped copies and independently cloned fields, adds semantic item/index tags,
and returns complete mappings. It is an authoring recipe, not a runtime collection component.

`create_runtime_collection` is the variable-length counterpart. Supply an object-item array by
`fieldId` or unique `fieldKey`; select one contiguous persistent-group prototype with `groupId`,
ordered `layerIds`, or exact `layerNames`; and provide `offsetPerItem`, capacity 1..100, and truncate
overflow. Bind prototype layers to the array field with item-relative `sourcePath` segment arrays.
Capacity is mirrored to field `maxItems`. Optional `itemKeyPath` gives stable identity; `sortPath`
plus `sortDirection` orders items deterministically; `pageSize` and zero-based `page` select a bounded
window. Bindings still resolve the original array item, and keyed items animate between changed
slots. Remove
the runtime collection before deleting or ungrouping prototype layers. `create_repeater` remains the
right tool when the row count itself should be authored as ordinary editable layers and fields.

Operations targeting one layer accept either `layerId` or exact `layerName`; never pass both. Name
ambiguity is rejected with matching IDs. `stagger_property_track` accepts ordered `layerIds` or a
`layerNamePattern` with `*`, resolved in document paint order. Exact `layerName` and `fieldKey`
selectors see matching entities created earlier in the same atomic batch.

`update_transform` and `update_effects` default to `scope: "authored"`, writing each lifecycle frame.
Use `scope: "frame"` and a required `frame` for one-frame animation changes.

For a post-process shader use `add_effect effectType:"shader"` with complete `patch.shader`; its
`iChannel0` is the preceding stack output, so omit `inputImage`. Update by returned effect ID. See
[effects-stack.md](./effects-stack.md#shader-effect).

Pass `groupId` instead of `layerId`/`layerName` to any effect operation for a persistent canvas
group. One stable effect ID is materialized on every member; member-only effects remain independent,
and group reorder changes only shared entries.

`set_layer_flags.blendMode` accepts `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`,
`color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, or `exclusion`. The value is a
static layer property. It composites only with lower layers inside the isolated OGraf composition,
not with editor chrome, transparency checkerboards, or an external renderer/video background.

`set_property_key` requires a layer selector, `property`, integer `frame`, and numeric `value`. Optional `easing` applies to the incoming segment. Optional `curve` is `{x1,y1,x2,y2}`; pass `curve: null` to remove a custom curve. Use the returned property-key ID for later move/easing/remove operations.

`set_property_track` takes one layer/property and `keys: [{frame,value,easing?,curve?}]`.
`replace: true` is the default; false merges keys by frame. `stagger_property_track` applies the
same template to ordered `layerIds`, shifting each subsequent layer by `frameOffset`. Both expand
inside the existing atomic batch and return generated property-key IDs.

`set_layer_loop` creates or updates one local clip on a layer. Set `activation` to
`{type:"lifecycle"}` for on-air ambient motion or `{type:"step",stepKeyframeId}` for one pausable
Step. `durationFrames` is the local ruler length, `phaseOffsetFrames` offsets phase, and
`repeatCount: null` repeats indefinitely. `set_loop_property_track` takes the same numeric key
shape as `set_property_track`, but frames must remain inside the loop's local range. Different
properties may use different incoming easing while sharing the clip duration. Use
`remove_layer_loop` to remove the complete clip.

`add_asset` accepts a supported image/font/source MIME type and base64 payload without a data-URI
prefix. Use its returned ID as `asset:<id>` in image `src`, sequence frames, and image-url defaults.
Optional font family/weight/style, safe package path, and license metadata remain editable with
`update_asset`; identical payloads reuse one registry entry. `remove_asset` refuses referenced
image/sequence/default-value assets unless `force: true` clears those references atomically;
removing an in-use font reports fallback risk.

`ograf_import_asset` avoids client-side base64 transport for one workspace-confined image, font,
CSS, or text file and commits it through the same asset operation. Files are limited to 32 MiB.
`ograf_import_svg_bundle` accepts up to 64 workspace paths containing exactly one SVG and selected
companion CSS/images/fonts. It rejects duplicate base names, limits each file to 32 MiB and the
bundle to 64 MiB, embeds relative dependencies into one SVG asset, registers discovered fonts, and
commits all assets atomically.

Lifecycle mutation is explicit: use `rename_lifecycle_keyframe` for labels,
`move_lifecycle_keyframe` for bounded adjacent-transition retiming, and `remove_lifecycle_step` only
for pausable Steps. Start cannot move and Start/End cannot be removed. Treat stranded-key warnings
as actionable; lifecycle edits never silently move layer property keys.

`group_layers` assigns a generated persistent canvas group ID to at least two existing layers;
`ungroup_layers` accepts that `groupId` or member `layerIds` and dissolves the complete matching
group. These are transform/selection groups, distinct from UI-only Timeline Groups.

`save_component` links originals; `scope:set` shares the asset. `instantiate_component` defaults
`linked:true`; false makes copies. `instanceId` shares continuity.
`update_component_layer componentId,sourceLayerId,patch` and `update_component_field componentId,fieldId,patch`
edit sources. `update_component_from_layers componentId,layerIds` promotes one instance and adopts
new children in place. IDs, animation, bindings and overrides survive.
`reset_component_overrides layerIds,paths?` resumes inheritance (omit paths for all).
`make_component_unique instanceId,name?` creates a private asset. Refresh keeps overrides.
Used assets and Transitions-referenced sources cannot be removed; retarget references first.
`apply_style_pack` accepts `news`, `sports`, `entertainment`, or `documentary`. Catalog definitions
are immutable; application copies or refreshes canonical editable tokens, optionally binds them to
compatible semantic layers, and returns complete token/affected-layer mappings. The pack includes
palette, modular type scale, weights, font stack, radius, text outline, entrance/exit/update/stagger
frames, and easing conventions. Brand Kit operations can then edit those copied tokens normally.
Color tokens also target `fill.stops[N].color` (existing zero-based gradient stop) and
`dropShadowColor`; these preserve gradient transparency/offsets and effect timing. Inspector shows
each stop and shadow link under Brand Kit. Text accepts both `strokeColor` and `strokeWidth` targets. Updating a token rematerializes every
consumer's ordinary element value. Removing a used token requires `force: true` to clear links while
preserving the last materialized values.

Manage unique public IDs with the custom-action operations.
A finite layer clip may activate from `{type:"customAction",customActionId}`; its object payload
updates data fields before matching clips play and settle. The manifest publishes their longest
duration. This is declarative and does not authorize arbitrary JavaScript.

`duplicate_group` accepts `source.groupId`, `source.parentId`, or raw `source.layerIds`. It creates
independent copies with fresh groups and returns source→copy layer/field mappings. Transform offsets
change every x/y key. Frame offsets shift non-lifecycle authored keys cumulatively while keeping
Start/Step/End compatibility keys anchored; genuine authored keys outside the duration reject the
transaction. `namePattern` supports `{n}` and optional `{name}`. `labelRewrite` performs a literal
source→replacement rewrite with `{n}` expansion across layer names, text content, field labels, and
string defaults. `bindings` is `share`, `clone`, or `clear`; cloning requires a collision-free
literal `fieldKeyRewrite`. Copies do not remain linked to later source edits.

`add_layer`, `add_data_field`, `add_asset`, duplication, and guide creation return stable IDs in top-level `results` and in
the existing summary. The primary text response also includes them for clients that do not expose
structured content. Dry-run IDs describe only the projected transaction and are not reserved.

Fixed animatable properties are `x`, `y`, `width`, `height`, `rotation`, `opacity`,
`transformOriginX`, `transformOriginY`, `blur`, `dropShadowOpacity`, `dropShadowOffsetX`,
`dropShadowOffsetY`, and `dropShadowBlur`. Text layers additionally expose non-negative
`strokeWidth`; `strokeColor` is static. Gradient layers additionally expose
`fill.stops[N].offset` for every zero-based stop index. Offset keys must remain in 0..1 and use the
same independent incoming-easing semantics as other numeric property tracks.

`set_composition_layout` configures rulers, action/title-safe overlays, the editor-only
`presentationBackground` (`none`, `big-buck-bunny`, or `still-image`), snapping, grid/threshold,
authoring bounds, and overflow preview. For a still image, set
`presentationBackgroundImageSource` to an image URL; local file selection and embedding are
available in the visible Studio Canvas Layout settings. Canvas guides are `{axis: "vertical"|"horizontal",
position}` and receive stable generated IDs. `set_layer_layout` accepts `isLocked`, `groupId`,
`parentId`, `clipChildren`, horizontal/vertical constraints, and `autoLayout`. Auto layout accepts
`direction: none|horizontal|vertical`, non-negative `gap` and four padding values,
`align: start|center|end|stretch`, `hugWidth`, `hugHeight`, `minWidth`, `maxWidth`, and
`collapseHidden`; auto-size text contributes its measured bound content size, and direct children
flow in paint order in Studio and exported playback. When `clipChildren: true`, direct
children pointing at that layer are clipped to its animated transformed bounds; parent rotation and
transform origin produce diagonal masks, and rectangle `borderRadius` rounds the transformed mask.
Use `{ topLeft, topRight, bottomRight, bottomLeft }` for independent corners; a number remains a
supported shorthand that applies one radius to every corner.
Children retain their independent world-space rotation. This relation compiles deterministically
and is remapped by `duplicate_group`. Parent translation and composition resize otherwise bake into
regular tracks.
Unlock a layer before attempting content, transform, binding, effect, or timeline mutations.

`set_layer_visual_rules` replaces ordered rules. Data rules (default `trigger`) need an existing
`fieldId`; compare with `value` or `compareFieldId`, and add `conditions` combined by `match`.
`data`/`hover` are states that revert; other pointer and playout triggers are events whose
results persist, optionally after `delayFrames`. State actions take `targetLayerId` or
`targetGroupId`, and `transitionFrames`. Details: [visual rules](./visual-rules.md).

`create_timeline_group` accepts at least two existing `layerIds`, plus optional `name` and
`#RRGGBB` `color` (either case), and returns a stable timeline-group ID. Prefer one named/color-coded group for
each coherent component when a composition has many related layer rows. A layer belongs to at most
one timeline group; creating a new one moves its members out of earlier groups and removes groups
left empty. Use `rename_timeline_group`, `set_timeline_group_color`, and
`ungroup_timeline_group` for later organization. These operations change only editor/MCP timeline
organization: they never change layer order, animation tracks, canvas `groupId`, or compiled OGraf
output. Inspection exposes `layout.timelineGroups`; `layout.timelineFolders` remains a deprecated
source-storage compatibility field.

Rectangle, ellipse, path and pattern `fill` accepts either a color string or
`{type:"linear"|"radial"|"conic",angle,stops:[{offset,color,opacity}]}`. Require at least two stops;
offset and opacity are in 0..1. Use a `gradient` data field for the complete paint, or a `color`
field for `fill.stops[N].color`. Animate an existing stop position through `set_property_key`,
`set_property_track`, or `stagger_property_track` with property `fill.stops[N].offset`.

`set_layer_bindings` takes ordered `{fieldId,targetProperty}` or `{fieldKey,targetProperty}` rows;
use declared targets once each. Legacy `set_layer_binding` replaces all rows. Designer edits
synchronize bound defaults/mappings while preserving links.
`update_data_field` addresses `fieldId` or unique `fieldKey`, updating key/label/default/required.
`exposeToOgraf:false` retains defaults/bindings/Rules internally, excluding public schema/external
updates. Defaults true; omitted updates preserve it. Works on nested properties/items and
shader/component fields. Hidden parents/items hide subtrees/arrays; Required is public-only.
See `bindings.playoutExposure` for full semantics.

Also accepts `fieldType`, `description`, ordered `options:[{value,label}]`, `fileExtensions` and
`constraints:{minLength,maxLength,minimum,maximum,pattern,step,minItems,maxItems}`. Object `properties`
and array `items` recurse. Scalars include integer, duration-ms, percentage, file-path, select and
select-multiple (string-array defaults). Public fields emit GDD hints and JSON Schema. Prefer
`maxLength` on operator-editable text leaves.
`remove_data_field` refuses to orphan bindings and names their layers; `force: true` clears those
bindings atomically and reports them in `summary.clearedBindings`.

## Undo and concurrency

- `ograf_undo` and `ograf_redo` each require the current `expectedRevision`.
- A committed batch is one undo unit.
- A dry run does not increment the revision or change the editor.
- After any other human or agent edit, assume the revision changed and re-read.
- After a conflict, call `ograf_get_changes` for a compact history before consciously rebasing.

## Shaders and visual patterns

Use the compact `shaders`/`tiling` capability sections before shader paint or pattern work.
[Shader and pattern workflows](./shaders-and-patterns.md) documents complete paint patches,
pragma-driven fields, independent parameter tracks, preset patches, and UI-only import/library
conveniences. Pattern presets are ordinary `set_tiling_pattern.patch` data.

## Session reset

`ograf_reset_project` requires `confirm: true` and the current `expectedRevision`. It replaces the
session with a fresh project as one undoable transaction. `keepDataFields: true` preserves field
definitions only; layers and bindings are removed.

Use `ograf_delete_session` with `confirm: true` to remove an obsolete temporary/smoke-test session.
It cannot delete `editor` and does not remove saved `.ogs` or `.ograf.zip` files.

## Certification and files

- `ograf_certify_project`: exact manifest, package, module, and declared lifecycle certification in
  the browser; optionally choose `realtime`, `non-realtime`, or `dual` output profile.
- `ograf_save_project`: certified standalone JSON `.ogs` plus `<id>_thumb.png` in the same folder,
  using the top-level project `id`, independent of the source filename.
  `thumbnailFrame` overrides and persists the thumbnail frame; omitted uses the project preference
  or first OGraf step (frame 0 if none). The response includes `thumbnailPath` and `thumbnailFrame`.
  Use `set_project_metadata.thumbnailFrame` to set the preference in the editable project, or null
  to follow the first step. Overwrite permission applies to both files.
- `ograf_export_package`: certified `.ograf.zip` or standalone `.html`, selected by the path
  extension, with a named real-time, non-real-time, or dual export profile. Includes a transparent
  `<id>_thumb.png` referenced by `manifest.thumbnails`,
  using the project thumbnail frame or first OGraf step (320 × 180 for 16:9).
  Optional `thumbnailFrame` overrides the frame for this export; null selects the first step.
  The response reports the effective `thumbnailFrame`. Set project metadata separately to persist it.
  The complete package is certified before writing; the editable project is not mutated.

Paths must stay under the MCP server's configured workspace root. Both file tools require literal `confirm: true`; existing files also require `overwrite: true`.

The MCP file tools do not import or reverse-engineer an existing `.ograf.zip`. For that request, use
the visible editor's **Import OGraf** command and preserve its best-effort recovery report. Never
execute an imported third-party `main.js` merely to make conversion appear more complete.

Use `ograf_export_coordinated_package` with the current set revision, explicit profile/path,
`confirm:true`, unique `operationId`, and authorized overwrite choice. Follow the snapshot,
recovery, and graph-inclusion rules in [template sets](./template-sets-and-crops.md).
Choose an `.html` path for standalone browser playback or `.ograf.zip` for the playout package.
Separate standalone imports do not verify Reality Hub host coordination; test the coordinated
package in the actual host. Do not claim Windows runtime validation from cross-compilation.

`ograf_export_package` and `ograf_export_coordinated_package` emit typed color defaults and
coordinated state presets as GDD's canonical lowercase hex, including nested object/array values.
Editable source values retain their original spelling.
