---
name: ograf-authoring
description: Create, inspect, animate, validate, certify, save, and export EBU OGraf-compatible broadcast graphics through the OGraf Editor MCP server. Use for lower thirds, scoreboards, tickers, looping backgrounds, HTML5 broadcast templates, .ogeproj project files, .ograf.zip packages, scene/layer edits, per-property keyframes and local loops, easing, data fields, bindings, and OGraf compliance work.
---

# OGraf Authoring

Use the OGraf Editor as the source of truth and keep every generated result editable in its canonical project model. Treat final OGraf certification as a hard gate, not a best-effort check.

If the MCP dependency is unavailable, use
[references/setup.md](./references/setup.md) to start or recover the local editor and server. Do not
replace the tools with raw file editing.

## Required workflow

1. Call `ograf_get_capabilities` and confirm whether the live editor is connected.
   Read `editor.connected`, `editor.responsive`, and `editor.latencyMs` separately. Do not call a
   browser-dependent tool while the socket is open but the editor is unresponsive; bring the editor
   tab to the foreground first. Require `editor.certificationReady` before certification or file
   output; follow `certificationLikelyCause` recovery guidance. `liveEditorConnected` is deprecated.
2. Call `ograf_get_project` or `ograf_inspect_scene` before editing. Preserve the returned stable
   IDs and `revision`. For routine reads, prefer explicit `include` sections with
   `tracks: "animated-only"`; omit filters when a complete compatibility snapshot is required.
3. Build one coherent `ograf_apply_operations` batch. Use `dryRun: true` before destructive or
   hard-to-reverse operations: layer/field removal, layer reorder, transition-duration changes, and
   `duplicate_group` with cloned fields. Commit purely additive layer/field/key/asset batches
   directly unless their projected layout is genuinely uncertain.
   Creation batches return first-class `results` with stable layer/field/guide/asset IDs; use them in
   the next batch without paying for a project read solely as an ID lookup. A dry run returns
   projected IDs, validation, optional broadcast lint, and compact per-operation summaries, but its
   generated IDs are hypothetical and must not be reused after the real batch.
4. Apply with the latest `expectedRevision`. If a revision conflict occurs, re-read the project and consciously rebase; never blindly retry stale operations.
5. Inspect the result with `ograf_get_timeline`, `ograf_capture`, `ograf_render_strip`, and
   `ograf_validate_project`.
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
6. Call `ograf_certify_project` before reporting output as compatible.
7. Use `ograf_save_project` or `ograf_export_package` only when the user requested a file operation. Pass `confirm: true`; leave `overwrite` false unless replacement was explicitly intended.

The live browser editor must be open for PNG capture/strips, certification, save, and export.
Capture and strips are read-only and never substitute for certified save/export. Certification
tools certify the exact compiled artifacts and fail closed when the editor is unavailable.

## File and import boundaries

- `.ogeproj` is editable source for this editor. It is not an OGraf manifest or a playout package.
- `.ograf.zip` is certified playout output. Existing packages can be converted through the visible
  editor's **Import OGraf** workflow, but arbitrary third-party JavaScript is opaque and conversion
  may be lossy. Preserve and report the editor's recovery/loss summary.
- The MCP server does not expose a raw package-decompilation tool. When the user asks to open or
  convert an existing OGraf package, use the visible editor workflow rather than fabricating a
  project document.
- Imported SVG images are assets. External companion CSS is not automatically ingested; require
  embedded styles, path-converted text, or fonts installed on the authoring and playout machines.

## Authoring rules

- Prefer `sessionId: "editor"` when collaborating in the visible application.
- Use property tracks independently. Changing `x` must not create or retime `opacity`, `rotation`, or another layer's keys.
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
- Use `duplicate_group` for independent repeated cells. Animate the source before duplication if
  its animation must be copied. A positive `frameOffset` shifts non-lifecycle authored keys only;
  Start/Step/End compatibility keys remain anchored. Ensure headroom for the shifted authored keys;
  genuine out-of-range results are rejected rather than clamped.
- Use `set_composition_layout` and canvas-guide operations for editor layout aids. Use
  `set_layer_layout` for locking, persistent groups, parenting, and responsive constraints. These
  fields are authoring-only except `clipChildren`: setting it on a parent compiles a deterministic
  animated rectangular mask for direct children. Constraint and ordinary parent translation edits
  still bake their visual results into regular property tracks.
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
- Rectangle and ellipse `fill` accepts a solid color string or a complete linear/radial/conic
  gradient object. Bind the whole gradient through a `gradient` data field; individual stop paths
  are not binding targets. Animate a stop position with the numeric property
  `fill.stops[N].offset`, using a zero-based stop index and values from 0 to 1. Prefer three-stop
  transparent/bright/transparent tracks for deterministic glint sweeps.
- Keep frames integral and within the composition duration.
- Treat a lifecycle Step move as an explicit adjacent-transition retime. It must never silently move
  property keys; report keys left at the old boundary or outside a shortened End.
- Treat `set_transition` warnings as actionable: duration changes can strand property keys at a
  moved lifecycle frame or outside the new duration. Retiming is never implicit.
- Use `linear` when the user requests no easing.
- Preserve Start and End lifecycle states. Only Step states are pausable OGraf steps.
- Do not encode editor-only automation or cross-timeline triggers into output. Compile only deterministic OGraf lifecycle, schedule, data, and animation behavior.
- Use `ograf_undo` to reverse the last agent transaction. Direct browser edits retain their own browser history.
- Use `ograf_get_changes` after a revision conflict to distinguish browser edits from agent edits.
- Use `ograf_reset_project` with explicit confirmation for a genuinely fresh visible session; the
  reset is an undoable agent transaction. Do not manually tear down every layer and field.
- Never write project JSON or construct a package outside the MCP save/export tools; doing so bypasses certification.
- If the editor is disconnected and you have browser control, open it at localhost:5173 yourself before reporting blocked

## References

All reference paths are relative to this skill's own directory.

- Read [references/tool-workflows.md](./references/tool-workflows.md) for operation shapes and task sequences.
- Read [references/ograf-invariants.md](./references/ograf-invariants.md) before lifecycle, timing, data-binding, or export work.
- Read [references/examples.md](./references/examples.md) for a compact lower-third transaction pattern.
- Read [references/setup.md](./references/setup.md) only for local startup, connection recovery,
  Claude Desktop configuration, or workspace confinement.
