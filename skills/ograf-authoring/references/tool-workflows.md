# MCP tool workflows

## Discovery and inspection

- `ograf_get_capabilities`: request only the relevant `sections` from `elements`, `easing`,
  `semantics`, `designSystem`, `loops`, `bindings`, and `editor`. Include `editor` for the bridge
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
  presents that projection for explicit Accept or Reject in `sessionId: "editor"`. With `apply` or
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
  `browserTextOverflow: true` measures authored/bound defaults and optional stress `testValues`.
  `detail: "summary"` returns counts plus only failed checks; use `"full"` for every measurement.
  `broadcastLint: true` adds non-gating safe-area/font/contrast warnings; add
  `interlacedOutput: true` only when that output is actually intended.

Always read before write. IDs are opaque; never manufacture layer, field, transition, or property-key IDs.

## Mutations

Call `ograf_apply_operations` with `sessionId`, `expectedRevision`, `operations`, optional `reason`,
and the required mode-specific options. Prefer `includeReview: true` when an apply/dry-run and its
deterministic design assessment belong in the same model turn.

Supported operation discriminators:

- Project/composition: `set_project_metadata`, `set_composition`, `set_composition_layout`,
  `apply_style_pack`, `set_design_system_name`, `upsert_design_token`, `remove_design_token`,
  `bind_design_token`, `unbind_design_token`,
  `add_lifecycle_step`, `rename_lifecycle_keyframe`, `move_lifecycle_keyframe`,
  `remove_lifecycle_step`, `add_canvas_guide`, `update_canvas_guide`, `remove_canvas_guide`,
  `create_timeline_group`, `rename_timeline_group`, `set_timeline_group_color`,
  `ungroup_timeline_group`
- Assets: `add_asset`, `update_asset`, `remove_asset`; use the separate `ograf_import_asset` and
  `ograf_import_svg_bundle` tools when payloads already exist under the configured workspace
- Layers: `add_layer`, `duplicate_group`, `remove_layer`, `rename_layer`, `set_layer_flags`,
  `set_layer_layout`, `set_layer_semantics`, `create_lower_third`, `create_bug`, `create_ticker`,
  `create_scoreboard`, `create_clock`, `create_repeater`, `group_layers`, `ungroup_layers`,
  `reorder_layers`
- Components: `save_component`, `instantiate_component`, `update_component_from_layers`,
  `refresh_component_instances`, `rename_component`, `remove_component`
- Content/style: `update_element`, `update_transform`, `update_effects`
- Timeline: `set_property_key`, `set_property_track`, `stagger_property_track`,
  `move_property_key`, `remove_property_key`, `set_property_key_easing`, `set_transition`,
  `set_layer_loop`, `set_loop_property_track`, `remove_layer_loop`
- Data: `add_data_field`, `update_data_field`, `remove_data_field`, `set_layer_bindings`,
  `set_layer_binding` (legacy single-binding replace), `create_runtime_collection`,
  `update_runtime_collection`, `remove_runtime_collection`
- Actions: `add_custom_action`, `update_custom_action`, `remove_custom_action`

`add_layer.kind` supports `rectangle`, `ellipse`, `text`, `image`, `path`, and `image-sequence`. It returns the generated layer ID in `summary.generatedIds`.

`set_layer_semantics` assigns an authoring role, normalized tags, and an intent description without
changing output pixels. `create_lower_third` materializes a four-layer/two-field grouped lower third
with semantic roles. `motion.style` is `wipe` (default), `stagger`, `slide`, or `none`; entrance and
exit directions accept left/right/up/down/none. The default wipe makes the panel a `clipChildren`
parent and reveals its three children with a cubic-out entrance, then uses a cubic-in directional
exit. `staggerFrames` controls the four-layer cascade and rejects atomically when the entrance
transition is too short. Every style returns ordinary layer/field/group mappings for later edits.

`create_bug`, `create_ticker`, `create_scoreboard`, and `create_clock` materialize compact grouped
broadcast graphics with semantic tags, constrained editable fields, complete layer/field mappings,
and one Timeline Group. Each accepts an optional `stylePack`, placement, content/field-key values,
and shared motion overrides. The scoreboard defaults to the Sports pack and uses W8 text outlines
for score values. The ticker owns a `clipChildren` window and one lifecycle-activated local X loop;
its finite lifecycle X track remains static. Use `speedPixelsPerSecond` to control crawl duration.

`create_repeater` takes one or more source `layerIds`, at least two item records, direction, and gap.
It materializes finite grouped copies and independently cloned fields, adds semantic item/index tags,
and returns complete mappings. It is an authoring recipe, not a runtime collection component.

`create_runtime_collection` is the variable-length counterpart. Supply an object-item array by
`fieldId` or unique `fieldKey`; select one contiguous persistent-group prototype with `groupId`,
ordered `layerIds`, or exact `layerNames`; and provide `offsetPerItem`, capacity 1..100, and truncate
overflow. Bind prototype layers to the array field with item-relative `sourcePath` segment arrays.
Capacity is mirrored to field `maxItems`. Updates are index-based snapshot replacement with the
composition update crossfade; instances never infer identity, timing, scroll, or pagination. Remove
the runtime collection before deleting or ungrouping prototype layers. `create_repeater` remains the
right tool when the row count itself should be authored as ordinary editable layers and fields.

Operations targeting one layer accept either `layerId` or exact `layerName`; never pass both. Name
ambiguity is rejected with matching IDs. `stagger_property_track` accepts ordered `layerIds` or a
`layerNamePattern` with `*`, resolved in document paint order. Exact `layerName` and `fieldKey`
selectors see matching entities created earlier in the same atomic batch.

`update_transform` and `update_effects` default to `scope: "authored"`, writing each lifecycle frame.
Use `scope: "frame"` and a required `frame` for one-frame animation changes.

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

Use `save_component` when a layer selection should become a reusable authoring resource.
`instantiate_component` materializes fresh ordinary layers and bound fields and returns complete
source-to-instance mappings. `linked: false` creates a permanently independent instance.
`linked: true` stores authoring-only source metadata; `update_component_from_layers` replaces the
snapshot and `refresh_component_instances` explicitly rematerializes chosen or all linked instances
with returned replacement mappings. Refresh preserves authored placement but replaces instance
content, so use independent instances when local overrides must survive. Removing a definition never
removes inserted layers; it only clears their links.

`apply_style_pack` accepts `news`, `sports`, `entertainment`, or `documentary`. Catalog definitions
are immutable; application copies or refreshes canonical editable tokens, optionally binds them to
compatible semantic layers, and returns complete token/affected-layer mappings. The pack includes
palette, modular type scale, weights, font stack, radius, text outline, entrance/exit/update/stagger
frames, and easing conventions. Brand Kit operations can then edit those copied tokens normally.
Text accepts both `strokeColor` and `strokeWidth` targets. Updating a token rematerializes every
consumer's ordinary element value. Removing a used token requires `force: true` to clear links while
preserving the last materialized values.

Custom actions are declarative OGraf manifest entries. Use `add_custom_action`,
`update_custom_action`, and `remove_custom_action` with unique public `actionId` values; they do not
authorize arbitrary JavaScript payloads.

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

`set_composition_layout` configures rulers, action/title-safe overlays, snapping, grid/threshold,
authoring bounds, and overflow preview. Canvas guides are `{axis: "vertical"|"horizontal",
position}` and receive stable generated IDs. `set_layer_layout` accepts `isLocked`, `groupId`,
`parentId`, `clipChildren`, and horizontal/vertical constraints. When `clipChildren: true`, direct
children pointing at that layer are clipped to its animated transformed bounds; parent rotation and
transform origin produce diagonal masks, and rectangle `borderRadius` rounds the transformed mask.
Children retain their independent world-space rotation. This relation compiles deterministically
and is remapped by `duplicate_group`. Parent translation and composition resize otherwise bake into
regular tracks.
Unlock a layer before attempting content, transform, binding, effect, or timeline mutations.

`create_timeline_group` accepts at least two existing `layerIds`, plus optional `name` and
`#RRGGBB` `color`, and returns a stable timeline-group ID. Prefer one named/color-coded group for
each coherent component when a composition has many related layer rows. A layer belongs to at most
one timeline group; creating a new one moves its members out of earlier groups and removes groups
left empty. Use `rename_timeline_group`, `set_timeline_group_color`, and
`ungroup_timeline_group` for later organization. These operations change only editor/MCP timeline
organization: they never change layer order, animation tracks, canvas `groupId`, or compiled OGraf
output. Inspection exposes `layout.timelineGroups`; `layout.timelineFolders` remains a deprecated
source-storage compatibility field.

Rectangle and ellipse `fill` accepts either a color string or
`{type:"linear"|"radial"|"conic",angle,stops:[{offset,color,opacity}]}`. Require at least two stops;
offset and opacity are in 0..1. Use a `gradient` data field to bind the complete paint object. Per-stop
binding is not supported. Animate an existing stop position through `set_property_key`,
`set_property_track`, or `stagger_property_track` with property `fill.stops[N].offset`.

For one or more data bindings on a layer, call `set_layer_bindings` with an ordered `bindings`
array. Each entry accepts `{fieldId,targetProperty}` or `{fieldKey,targetProperty}`; do not guess
target-property names, and do not repeat one target property. Use `set_layer_binding` only when an
intentional legacy-compatible single-binding replacement should also discard any additional rows.
`update_data_field` accepts `fieldId` or unique `fieldKey` and can change key, label, default, and
required state in place. It can also change `fieldType`, operator `description`, ordered
`options: [{value,label}]`, `fileExtensions`, and `constraints` (`minLength`, `maxLength`, `minimum`,
`maximum`, `pattern`, `step`, `minItems`, `maxItems`). `object` fields use recursive `properties`;
`array` fields use one recursive `items` schema. Supported enriched scalar types include integer,
duration-ms, percentage, file-path, select, and select-multiple. Compiled fields emit official GDD
hints (`gddType`/`gddOptions`) plus recursive JSON Schema; select-multiple defaults are string arrays.
Prefer `maxLength` on every operator-editable on-air text leaf.
`remove_data_field` refuses to orphan bindings and names their layers; `force: true` clears those
bindings atomically and reports them in `summary.clearedBindings`.

## Undo and concurrency

- `ograf_undo` and `ograf_redo` each require the current `expectedRevision`.
- A committed batch is one undo unit.
- A dry run does not increment the revision or change the editor.
- After any other human or agent edit, assume the revision changed and re-read.
- After a conflict, call `ograf_get_changes` for a compact history before consciously rebasing.

## Session reset

`ograf_reset_project` requires `confirm: true` and the current `expectedRevision`. It replaces the
session with a fresh project as one undoable transaction. `keepDataFields: true` preserves field
definitions only; layers and bindings are removed.

Use `ograf_delete_session` with `confirm: true` to remove an obsolete temporary/smoke-test session.
It cannot delete `editor` and does not remove saved `.ogs` or `.ograf.zip` files.

## Certification and files

- `ograf_certify_project`: exact manifest, package, module, and declared lifecycle certification in
  the browser; optionally choose `realtime`, `non-realtime`, or `dual` output profile.
- `ograf_save_project`: certified editable `.ogs` source.
- `ograf_export_package`: certified `.ograf.zip` with a named real-time, non-real-time, or dual
  export profile; the editable project is not mutated.

Paths must stay under the MCP server's configured workspace root. Both file tools require literal `confirm: true`; existing files also require `overwrite: true`.

The MCP file tools do not import or reverse-engineer an existing `.ograf.zip`. For that request, use
the visible editor's **Import OGraf** command and preserve its best-effort recovery report. Never
execute an imported third-party `main.js` merely to make conversion appear more complete.
