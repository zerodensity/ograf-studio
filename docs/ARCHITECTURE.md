# Architecture

## Target dependency direction

```text
scene-model
    |
    v
timeline/compiler IR <--- ograf-contract (official types and schemas)
    |                              |
    v                              v
runtime                       validation
    |                              |
    +------------+-----------------+
                 v
          export/package builder
              /     \
             v       v
          editor   authoring-core
                      |
                      v
                  agent-tools
                   /       \
                  v         v
            MCP server   in-app agent
```

The scene model is editor-domain state. The compiled descriptor is the stable boundary consumed by preview and export. OGraf contracts and canonical schemas must not depend on editor packages.

## Agent authoring boundary

`packages/authoring-core` is a framework-neutral command layer over the scene model. It applies
discriminated scene, timeline, data, and lifecycle operations as revision-checked atomic batches.
It owns agent-session undo/redo, dry-run evaluation, validation results, change summaries, and a
deterministic SVG frame renderer. It has no React, browser, transport, or file-system dependency.

`packages/agent-tools` is the transport-neutral composition layer above that mutation engine. It
owns canonical Zod schemas and plain tool records, and depends only on injected workspace and editor-
bridge ports. The MCP server renders those records through the MCP SDK; the planned in-app BYOK loop
will filter and render the same records through provider adapters. Neither front door owns handlers.
The consolidated `ograf_apply_operations` record exposes apply, browser-free dry-run, rendered
preview, and human proposal modes while carrying the large recursive operation union only once.

`apps/mcp-server` exposes that boundary through localhost-only Streamable HTTP MCP. The `editor`
session is synchronized to the browser over a local WebSocket bridge. Browser edits increment the
same session revision; agent edits replace the visible editor snapshot and report activity in the
menubar. The first browser hello establishes revision-zero baseline state without creating history;
later equal handshakes are no-ops, while a divergent tab is explicitly synchronized to the
authoritative session without revision churn. Optimistic concurrency rejects stale writes rather
than using last-write-wins.

Agent save/export is deliberately not a parallel output path. Shared codegen builds the exact
artifacts, the live browser certifies that artifact object with the mandatory DOM/module/lifecycle
runner, and only then may the MCP server write inside its configured workspace. See ADR-003.

Agent visual inspection is also browser-backed. `ograf_capture` sends an immutable project snapshot
to the connected editor and rasterizes the shared DOM element renderer plus the canonical scene
interpolator into PNG. Composition capture can apply temporary field-key overrides and diagnostic
mattes; viewport capture clones the actual editor surface. Neither path changes project state or
revision. PNGs are exposed through random, private localhost URLs with a five-minute TTL, with
inline base64 strictly opt-in. Capture is never accepted as an export or certification substitute.
`ograf_render_strip` reuses the same browser rasterizer for up to 12 frames, composites the results
into one labelled PNG, and defaults to lifecycle frames plus transition midpoints. It is a visual
inspection read only, never an alternate package or video export path.

The editor bridge separates transport connection from application responsiveness. An app-level
`setTimeout(0)` heartbeat is echoed through the WebSocket without depending on
`requestAnimationFrame`; capabilities report connection, responsiveness, measured latency, last
response time, and a likely throttled-tab diagnosis. Every browser-backed operation uses the same
health snapshot for actionable timeout/preflight errors. Server-side project inspection,
validation, mutations, and `ograf_sample_tracks` remain usable in degraded mode.

Agent discovery and inspection stay source-model based. Capabilities publish factory defaults,
binding domains, and renderer semantics; filtered project reads are response projections only and
never create a second document shape. Browser text measurement uses the same runtime text renderer
and font readiness path as capture. Overflow and broadcast rules append warnings but are explicitly
outside the exact-artifact OGraf certification gate.
Creation results expose generated IDs both structurally and in the primary text response. Session
history retains a bounded 100-revision summary across agent, browser, undo, and redo sources.
Confirmed reset is a normal revision-checked, undoable agent transaction rather than a workspace
replacement escape hatch. Exact layer-name and field-key selectors can resolve entities created
earlier in the same atomic batch; temporary non-editor sessions have an explicit confirmed cleanup
command.

## Lifecycle model

A composition is an ordered chain of states:

```text
start -> zero or more pausable steps -> end
```

Start and end are authored visual states but are not OGraf steps. `playAction()` moves from start through steps and eventually to end. `stopAction()` interpolates directly from the currently rendered visual state to End over the incoming End-transition duration; it never scrubs through later Step poses that happen to sit between them on the authoring ruler. The realtime action and non-realtime action-schedule sampler use the same direct interpolation rule. A composition without pausable steps exports `stepCount: 0`.

## Animation model

The composition owns one deterministic frame clock. OGraf Start/Step/End markers form a lifecycle
track on that clock, but they do not own object poses. Every layer owns independent ordered tracks
for each animatable property at arbitrary integer frames:

```text
Lifecycle   Start -------- Step 1 -------- End
Headline       ◆ ------ ◆ -------- ◆
Background ◆ ---------------- ◆
Logo                 ◆ --- ◆
```

Position X/Y, width, height, rotation, alpha, transform origin, blur, and numeric drop-shadow values
can each be keyed at different frames. Text layers additionally expose a non-negative stroke-width
track; stroke colour stays static. Editing an object at an unkeyed playhead position creates a key
only on the changed property track. Adding, moving, removing, or retiming a property key never
changes another property, layer, or global lifecycle marker. All tracks still share one clock so
preview, export, `goToTime()`, and scheduled playout remain frame deterministic.

`layer.keyframes[]` remains as a migrated summary/compatibility view of complete transforms.
Document v5's `layer.animationTracks` is authoritative for evaluation and compilation. The compiled
descriptor carries those property tracks unchanged into the single runtime timeline used by Stage,
Preview, certification, and export.

Editor selection is a transient set with one primary layer for the Inspector. Ctrl/Command-click
toggles members; a group drag writes one position key at the shared current frame on every selected
layer, preserving their offsets and independent tracks. Persistent `groupId` membership is stored
separately: selecting one member selects the group and group transforms still author each member's
canonical independent property tracks.

Layout relationships are authoring semantics, not a second runtime transform graph. A parent's
authored translation is cascaded into descendant position tracks. Composition resizing applies each
layer's horizontal/vertical constraint to a snapshot of every relevant animated pose, then bakes the
result back into canonical integer transform keys. This makes save/reload deterministic and keeps
another OGraf renderer independent from editor metadata. Cyclic or missing parents are rejected.

Clip-to-parent is the deliberate exception at the compiled boundary. `clipChildren` stays on the
authoring parent while compilation emits only a child-side `clipParentId`; the runtime derives a CSS
path from both layers' evaluated transforms on every seek/tick, converting the parent's rotated
rounded rectangle into each child's local coordinates. This preserves deterministic `goToTime()`
behavior without compiling the general parent transform graph. Rectangle radius rounds
the mask. Capture, strip, SVG diagnostics, text measurement, and broadcast lint use the same
visible-bounds semantics.

Rectangle and ellipse paint is either a solid CSS color or a normalized linear/radial/conic
gradient with ordered stops. The shared DOM renderer serializes paint for Stage, browser capture,
and exported runtime; the diagnostic SVG uses a foreignObject fallback. A `gradient` data field
compiles as an OGraf JSON Schema object and can replace the entire fill value. Each existing stop
offset may own an independent numeric `fill.stops[N].offset` track; the runtime evaluates those
tracks after resolving the current authored/data-bound paint. Per-stop data binding remains outside
document v8.

Recursive GDD fields preserve the official JSON Schema shape directly: object nodes own keyed
properties, array nodes own one item schema, and layer bindings address scalar leaves with segment
arrays rather than an executable expression language. A runtime collection is the one deliberate
runtime authoring primitive: the compiler removes one contiguous grouped prototype from ordinary
layers and emits it beside an explicit paint-order entry, array data key, per-item X/Y offset,
capacity, and truncate policy. The packaged runtime expands bounded slots item-major, remaps internal
clip-parent IDs, offsets every lifecycle/loop X/Y track, and binds each slot by array index. Hidden
slots remain part of the deterministic timeline but do not paint. Update actions replace array
snapshots at the existing crossfade midpoint; scheduled non-realtime replay derives the same item set
from the complete data prefix, so backward `goToTime()` never depends on DOM or arrival history.
Collection instances remain inside the composition's W13 isolation boundary and do not create a
second blend stacking context.

`Composition.layout` stores ruler/safe-area visibility, horizontal/vertical guides, snap targets,
grid/threshold settings, authoring bounds, and editor overflow preview. These fields plus
`isLocked`, `groupId`, general `parentId`, and `constraints` are intentionally absent from
`CompiledGraphicDescriptor`; only the reduced clipping relation above crosses the boundary. Output
otherwise contains only the resulting layer transforms and standard OGraf behavior. Runtime
composition bounds remain clipped even when the editor pasteboard previews overflow as visible.

Rulers and guides render in an unscaled viewport overlay rather than inside the composition DOM.
The ruler strips remain 20 screen pixels at every canvas zoom; adaptive 1/2/5 intervals keep major
labels readable, while each tick and guide derives its screen position from the composition origin,
canvas zoom, and current viewport scroll. Pointer coordinates are converted back into composition
pixels before guide mutations enter `Composition.layout.guides`. This keeps Photoshop-style ruler
interaction independent from authored geometry and compiled output.

The object clipboard is editor-only transient state. Copy and Cut snapshot complete selected layers;
Paste and Duplicate regenerate layer and layer-key IDs, preserve authored element/key data, and add
a 20px position offset. Timeline `Insert Frame` adds a hold key using the preceding authored pose,
whereas `Insert Keyframe` samples the evaluated pose at that frame. Neither command retimes global
OGraf lifecycle markers or any other layer.

Canvas viewport panning is also transient editor interaction state. A middle-button gesture captures
the pointer at the viewport boundary and changes only `scrollLeft`/`scrollTop`; composition geometry,
layer transforms, animation keys, preview, and exported output are untouched.

Canvas viewport zoom is equally transient. Fit-to-view supplies the default scale; Ctrl/Command
wheel and plus/minus set an editor-only manual scale while scroll compensation keeps the pointer or
viewport-center anchor stable. The scale never enters the project document, runtime descriptor, or
compiled output and never uses browser page zoom.

The editor transport can optionally pause at the next lifecycle key whose role is `step`. This uses
the same cumulative keyframe timing as compilation but remains preview state: it does not rewrite
transitions, property tracks, or OGraf actions. From a Step, the next Play targets the following Step;
after the last Step, it plays through End. Space invokes the same controller unless focus belongs to
a form or editable control.

Lifecycle-marker retiming is planned in `packages/scene-model` and consumed by both OGraf Studio
and `authoring-core`. Browser gestures and MCP operations therefore enforce identical duration
bounds, preserve the same property-key semantics, and report the same retiming warnings.

Reusable components are composition-local authoring snapshots containing selected layers and only
their referenced data fields. Insertion remaps every layer, key, loop, field, binding, and internal
parent ID; it applies a placement offset and assigns one fresh persistent canvas group. The result
is a set of normal independent layers. Component definitions are not compiled, so exported OGraf
packages have no studio-specific component runtime or vendor dependency.

The main canvas has mutually exclusive authoring and OGraf-runtime surfaces. Entering OGraf Preview
compiles the current composition through `compileDescriptor` and mounts a freshly registered
`GraphicElement` in the same pasteboard viewport. Template edits rebuild, dispose, and automatically
load the runtime instance from the latest project, so the visible preview does not retain a stale
snapshot. Its toolbar calls the real `load`, `playAction`, `updateAction`, `stopAction`,
`customAction`, and `dispose` methods. `load` runs automatically when the surface mounts,
`updateAction` follows preview-data edits after a short debounce, and `dispose` remains automatic
cleanup. Previous, next, and goto controls are presentations of OGraf `playAction` parameters rather
than an editor timeline simulation; absolute goto is the standard zero-based
`playAction({ goto })` contract. The authoring Stage is unmounted, so selections, guides, rulers,
Moveable, and test affordances cannot leak into the runtime surface. Preview lifecycle calls never
mutate the project, revision, selection, or undo history. The detailed Preview & Export panel remains
responsible for logs, non-realtime schedules, certification, and package output.

All in-editor render surfaces share one preview-data rule. A bound property resolves from an explicit
field-ID test value when present, otherwise from the field definition's declared default. Before a
payload enters an in-browser Graphic instance, image-url values using editor-only `asset:<id>`
references are resolved through the current project's asset table into browser-loadable data URIs. This
resolution is preview-only: packaged output still rewrites those references to certified relative
resource paths, and externally supplied playout data remains ordinary OGraf data.

The SVG bundle importer is an authoring-time portability transform. It accepts one SVG plus selected
CSS/images/fonts, injects CSS into an SVG `style` node, replaces matching relative references with
data URIs, registers selected fonts, and reports unresolved paths. It does not execute imported code
or add a runtime dependency, and it preserves the SVG as one image asset rather than claiming that
arbitrary Photoshop output can be losslessly reconstructed as editable scene geometry.

The resource registry retains output bytes separately from authoring metadata. Identical data URI
payloads are deduplicated, while each resource may retain its original filename, byte size, safe
relative package path, and font/license descriptors. Direct references are usage-checked before UI
removal. Packaged font weight/style descriptors flow through the compiled descriptor into local
`@font-face`; optional license text is emitted under `licenses/` without adding a runtime dependency.

Certification imports each exact generated module inside a fresh hidden iframe realm, exercises its
declared lifecycle, and destroys the entire realm afterward. This prevents custom-element registry
or DOM/font state from leaking between repeated certifications. Agent-requested certification,
capture, contact sheets, and text measurement share one browser-work queue so they cannot overlap.

Export profiles are compile-time projections, not project mutations. The built-in real-time,
non-real-time, and dual profiles derive `supportsRealTime`, `supportsNonRealTime`, graphic ID suffix,
and output filename from a cloned project snapshot. The editable document, undo history, MCP
revision, and subsequent profile exports remain unchanged.

Text layout is structured document data: line-height multiplier, pixel tracking, case transform,
vertical alignment, baseline shift, minimum shrink size, and overflow policy all pass unchanged to
the shared DOM renderer. Advisory broadcast QA samples on-air Step frames and uses that same browser
renderer for replacement-text stress values; it never changes OGraf certification validity.
Text outline colour and sampled width use the same shared renderer. CSS/SVG `paint-order: stroke
fill` keeps the outline behind the glyph face, while document migration supplies transparent/zero
defaults so older templates retain their exact appearance.

Timeline Groups are editor-only authoring organization. For backward-compatible source persistence,
`Composition.layout.timelineFolders` still stores group identity, name, color, and member layer IDs,
while MCP inspection projects the canonical `timelineGroups` alias and expanded/collapsed state stays
local to the Timeline panel. Group ordering may gather non-contiguous layer rows for convenience but
never reorders `composition.layers`, merges tracks, changes persistent canvas object groups, or enters
the compiled descriptor. Revisioned MCP operations create, rename, recolor, and ungroup the same
organization while continuing to address the unchanged independent layer IDs.

Each property key owns its incoming easing. It can use a named dependency-free preset or an explicit
cubic Bézier curve. The same pure samplers drive editor interpolation and are passed to GSAP as the
exported runtime easing function, keeping linear, polynomial, Sine, Expo, Circ, Back, Bounce,
Elastic, and custom curve motion deterministic across both surfaces.

One optional local loop clip may sit beside a layer's finite lifecycle tracks. Its independent
numeric property tracks use a local frame ruler and activate either for the on-air lifecycle or one
specific Step. The compiler preserves the clip in the shared runtime descriptor; editor preview,
realtime playback, and non-realtime schedule replay calculate phase from an absolute epoch rather
than callback counts. Loop keys never become composition keys or OGraf Steps, and loops never
invoke lifecycle actions. See ADR-004.

Layer effects are authored as structured blur/drop-shadow values. Blur, shadow alpha, X/Y offsets,
and softness are numeric animation tracks; shadow enabled state and color remain discrete/static.
A shared serializer produces the same CSS filter in Stage and GraphicElement at every frame.
Text elements store a sizing policy. `auto-size` measures system-font content while authoring and
writes integer layer bounds; `shrink-to-fit` uses the shared DOM renderer plus ResizeObserver so
data-bound text remains inside animated runtime bounds; `fixed` preserves the authored box.

## Compliance gates

`packages/codegen/src/buildExportArtifacts.ts` is the shared exact-artifact compiler, while
`apps/editor/src/state/ografCompatibility.ts` is the browser certification runner. Together they
build and certify the exact manifest, `main.js`, and resource paths that would be written, requiring
all of
the following to pass:

1. semantic Project/Composition validation;
2. the vendored official OGraf v1 schema and complete `$ref` closure;
3. canonical `*.ograf.json` naming, `main.js` linkage, unique safe relative package paths;
4. browser import of the generated module, a default-exported Custom Element class, and every
   method required by the advertised realtime/non-realtime modes; and
5. the same realtime and non-realtime lifecycle call sequence and three-second promise limit used
   by SuperFlyTV's `ograf-devtool`, with stricter rejection of error status payloads.

The exact certified artifact snapshot is the one written to the ZIP. Editable project-source saves
also certify an immutable snapshot before opening a picker or download. There is no UI file-writing
path around this boundary. Automated tests cover static failure paths; the built-in browser gate
provides the generated-module/DOM contract test on every save and export.

## Persistence

Editor documents have their own monotonically increasing schema version, independent from the public graphic version. Files are migrated and validated before reaching stores.

Editable source uses the `.ogeproj` extension. It intentionally does not end in `.json`, because
`ograf-devtool` scans generic JSON files in a selected directory as candidate manifests. The source
format is not a playout artifact; only the extracted `.ograf.zip` contents (`*.ograf.json`,
`main.js`, and resources) belong in an OGraf tool or renderer.

Document version 3 replaces v2 layer `poses[lifecycleId]` maps with independent `layer.keyframes[]`.
Migration projects the old poses onto their original cumulative lifecycle frames, preserving motion.

Document version 4 adds structured layer effects and text sizing policy. Migration supplies neutral
effects and auto-size typography without mutating the parsed source document.

Document version 5 adds authoritative per-property animation tracks and optional cubic Bézier data.
Migration expands every v4 full-transform key into equivalent property keys at the same frames and
backfills neutral effect tracks, preserving the evaluated animation exactly.

Document version 6 adds layer lock/group/parent/constraint metadata and composition layout settings.
Migration supplies neutral authoring defaults (`unlocked`, no group/parent, left/top constraints,
rulers and snapping enabled, overflow allowed/visible, no guides) without changing rendered poses.

Document version 7 adds persistent Timeline Group definitions inside authoring layout metadata. Its
serialized `timelineFolders` field is retained to keep existing v7/v8 sources byte-shape compatible.
Migration backfills an empty group list and removes stale or duplicate member references without
changing layer order or any rendered pose.

Document version 8 adds `clipChildren: false` to every legacy layer. Existing string fills remain
valid unchanged; structured gradient paints require no migration rewrite.

Document version 9 adds an optional deterministic local loop clip to every layer. Migration
backfills `loop: null` without changing any evaluated finite timeline pose.

Document version 10 adds self-contained Lottie layers with deterministic absolute-time loop
sampling.

Document version 11 replaces the singular `layer.binding` with an ordered `layer.bindings[]` list.
Migration wraps every legacy binding without changing its field, target property, or value map.
Each target property may appear once; the editor, capture path, compiler, realtime runtime, and
non-realtime runtime apply the complete list in order.

Document version 12 adds composition-local reusable component snapshots. Migration backfills an
empty definition list; compiled OGraf output remains ordinary independent layers.

Document version 13 adds structured text layout and legibility fields: line height, tracking, case
transform, vertical alignment, baseline shift, minimum shrink size, and overflow policy. Migration
derives neutral values and preserves the previous 50% shrink floor.

Document version 19 adds recursive object/array field nodes, binding source paths, and explicit
runtime-collection definitions. Migration supplies empty scalar paths/properties, array item schemas,
and an empty collection list; compiled output retains standard OGraf GDD data while the self-contained
runtime performs bounded deterministic item expansion.

Document version 20 adds text `strokeColor` and independently animatable `strokeWidth`. Migration
backfills transparent/zero values and a static width key on text layers and reusable-component
snapshots without changing legacy pixels.
