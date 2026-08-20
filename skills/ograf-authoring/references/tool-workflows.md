# MCP tool workflows

## Discovery and inspection

- `ograf_get_capabilities`: complete element schemas/defaults, easing presets, binding targets,
  paint/easing/origin semantics, browser dependency map, bridge connection/responsiveness/latency,
  certification readiness, asset references, and safety policy. Do not guess returned domains.
- `ograf_list_sessions`: session IDs, revisions, project names, validity.
- `ograf_delete_session`: confirmed cleanup of a non-editor in-memory session; never targets the
  live `editor` session or saved files.
- `ograf_get_project`: editable source, latest revision, validation. No filters preserves the full
  legacy response. Prefer explicit `include` plus `tracks: "animated-only"` for compact routine
  reads; use `tracks: "full"` when compatibility layer keyframes are required.
- `ograf_inspect_scene`: compact layer and lifecycle outline.
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

Call `ograf_apply_operations` with `sessionId`, `expectedRevision`, `operations`, optional `reason`, and optional `dryRun`.

Supported operation discriminators:

- Project/composition: `set_project_metadata`, `set_composition`, `set_composition_layout`,
  `add_canvas_guide`, `update_canvas_guide`, `remove_canvas_guide`, `create_timeline_group`,
  `rename_timeline_group`, `set_timeline_group_color`, `ungroup_timeline_group`
- Assets: `add_asset`
- Layers: `add_layer`, `duplicate_group`, `remove_layer`, `rename_layer`, `set_layer_flags`,
  `set_layer_layout`, `reorder_layers`
- Content/style: `update_element`, `update_transform`, `update_effects`
- Timeline: `set_property_key`, `set_property_track`, `stagger_property_track`,
  `move_property_key`, `remove_property_key`, `set_property_key_easing`, `set_transition`,
  `set_layer_loop`, `set_loop_property_track`, `remove_layer_loop`
- Data: `add_data_field`, `update_data_field`, `remove_data_field`, `set_layer_binding`

`add_layer.kind` supports `rectangle`, `ellipse`, `text`, `image`, `path`, and `image-sequence`. It returns the generated layer ID in `summary.generatedIds`.

Operations targeting one layer accept either `layerId` or exact `layerName`; never pass both. Name
ambiguity is rejected with matching IDs. `stagger_property_track` accepts ordered `layerIds` or a
`layerNamePattern` with `*`, resolved in document paint order. Exact `layerName` and `fieldKey`
selectors see matching entities created earlier in the same atomic batch.

`update_transform` and `update_effects` default to `scope: "authored"`, writing each lifecycle frame.
Use `scope: "frame"` and a required `frame` for one-frame animation changes.

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

`add_asset` accepts an image MIME type and base64 payload without a data-URI prefix. Use its returned
ID as `asset:<id>` in image `src`, sequence frames, and image-url defaults. Export writes each
registered asset once.

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
`dropShadowOffsetY`, and `dropShadowBlur`. Gradient layers additionally expose
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

For a data binding, call `set_layer_binding` with `{fieldId,targetProperty}` or
`{fieldKey,targetProperty}`. Do not guess target-property names.
`update_data_field` accepts `fieldId` or unique `fieldKey` and can change key, label, default, and
required state in place.
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
It cannot delete `editor` and does not remove saved `.ogeproj` or `.ograf.zip` files.

## Certification and files

- `ograf_certify_project`: exact manifest, package, module, realtime, and non-realtime lifecycle certification in the browser.
- `ograf_save_project`: certified editable `.ogeproj` source.
- `ograf_export_package`: certified `.ograf.zip` playout package.

Paths must stay under the MCP server's configured workspace root. Both file tools require literal `confirm: true`; existing files also require `overwrite: true`.

The MCP file tools do not import or reverse-engineer an existing `.ograf.zip`. For that request, use
the visible editor's **Import OGraf** command and preserve its best-effort recovery report. Never
execute an imported third-party `main.js` merely to make conversion appear more complete.
