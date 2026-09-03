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

Document v28 adds ordered `LayerEffects.stack` entries. Each has a stable layer-scoped ID, type,
name, enabled flag and validated parameter dictionary. Seven catalog types share the same numeric
bounds, UI controls, key/property paths and renderer. Compatibility slots adapt the original blur
and shadow fields so existing tracks, bindings and appearance survive migration. The slots are
virtual for old documents until a structural edit materializes the stack.

`effectStack.ts` owns add/update/duplicate/remove/reorder and immutable parameter sampling.
Numeric paths are `effects.ID.PARAM`; changing order does not change those paths. Duplication
remaps only owned parameter paths/keys and copies their links; deletion prunes those references
without deleting data fields. Legacy `update_effects` restores a removed compatibility slot when
explicitly editing it. `effectRendering.ts` emits ordered CSS filters and an equivalent sRGB SVG
filter chain, with bounds expanded for accumulated blur/shadow extents. Alpha masks use that chain;
geometric path masks intentionally ignore it.

Stack parameters sample lifecycle tracks and local loops through the shared runtime, including
direct exits and loop-exit correction. Live numeric/color data overrides sampled params and does
not reset the loop clock. The timeline builds dynamic stack state on deterministic seeks; Studio,
PNG capture and export consume the same sampler. Catalog discovery, generated MCP contracts,
instance operations and the in-app/external authoring skill expose the same model.

Document v27 adds `Composition.patterns` and `PatternElement.patternId`. `tiling.ts` owns validated
shared mutations and deterministic row layout/phase; `tilingSvg.ts` emits one native SVG pattern
per row rather than materialized tile layers. Each instance retains independent paint/effect
tracks. Compilation resolves the definition into the runtime descriptor; import deduplicates it
back into a shared resource. Sources are SVG paths with explicit size, viewBox and fill rule.

Pattern geometry runs on the lifecycle's absolute loop clock, independent of optional numeric
effect loops. Integer travel counts wrap at a common `cycleFrames`; seeded variation is fixed
across cycles and reversible seeks. Runtime updates only pattern offsets while geometry/paint
remain unchanged. Pattern masks reuse cached definitions and update those same offsets. PNG
capture uses the self-contained SVG adapter for native pattern references as well as mattes.

`set_tiling_pattern` is an atomic shared patch (create optionally returns a full-canvas instance).
Named selectors resolve through canonical agent-tool records; malformed symbol/override
dictionaries are validated in scene-model. Deletion guards include component references.
Resources and Inspector use the same mutations. `get_project` exposes `patterns`, inspection
reports resolved rows, and `sample_tracks` reports offsets at explicit elapsed frames.

Brand Kit occupies the `brand-kit` dock pane; saved dock layouts insert it when missing. Color
tokens can materialize `fill.stops[N].color`, `strokeColor` and `dropShadowColor` without replacing
gradient alpha/offsets or numeric motion. Top-level color fields may reference `defaultTokenId`;
token updates synchronize their ordinary defaults, while explicit default edits detach the link.
The link is authoring metadata; OGraf output contains standard color fields and concrete defaults.
`boundPaint.ts` shares immutable gradient-stop overrides between Studio, diagnostic rendering and
runtime. Bound shadow colors flow through visual-state sampling, masks and timeline updates.
Playback data overrides authored values; scheduled replay clears later overrides when rewinding.

Document v26 adds `Layer.mask` (source ID, alpha/path mode, inversion), `isMaskOnly`, and path
`Paint`/`fillRule`. Sources are same-composition rectangle/ellipse/path/image layers; path mode
uses vector geometry only. Validation rejects cycles, guide sources, unsupported source types,
dangling references, and cross-collection dependencies. Duplication remaps internal source IDs;
portable components require their matte sources and collection expansion remaps per instance.

The shared runtime renders path gradients with native CSS paint clipped by an SVG path, retaining
an independent SVG stroke. Shared SVG mask definitions sample source transforms, paint and numeric
effects after all layer states resolve. Alpha mattes include the source's alpha mask and parent
clip; path mattes ignore paint/effects. Inversion is confined to target bounds. Inline SVG masks
work inside the exported custom element's shadow root and browser PNG capture; embedded HTML is
not used in masks because browsers do not paint `foreignObject` there. Conic matte alpha is
deterministically tessellated at half-degree intervals. Visible path conic fills remain native CSS.

PNG capture uses a mask-aware clone/embedding adapter. It keeps local SVG references out of the
image fetcher, embeds referenced images, and turns each cloned matte into a self-contained SVG
alpha image before rasterization. The live DOM is not modified. A red-ring/green-hole browser
regression verifies that masks do not silently disappear in captures or proposal thumbnails.

`packages/authoring-core` is a framework-neutral command layer over the scene model. It applies
discriminated scene, timeline, data, and lifecycle operations as revision-checked atomic batches.
It owns agent-session undo/redo, dry-run evaluation, validation results, change summaries, and a
deterministic SVG frame renderer. It has no React, browser, transport, or file-system dependency.

`packages/agent-tools` is the transport-neutral composition layer above that mutation engine. It
owns canonical Zod schemas and plain tool records, and depends only on injected workspace and editor-
bridge ports. The MCP server renders those records through the MCP SDK; the in-app BYOK loop filters
the same records to a 14-tool surface and renders provider-neutral JSON schemas through Anthropic or
OpenAI-compatible adapters. Neither front door owns handlers.
The consolidated `ograf_apply_operations` record exposes apply, browser-free dry-run, rendered
preview, and human proposal modes while carrying the large recursive operation union only once.

The in-app model loop runs in `apps/mcp-server`, never in the renderer. It keeps the generated,
drift-gated authoring prompt and tool schemas as a stable cache prefix, normalizes provider calls,
validates them through the canonical Zod schemas, and executes the same handlers as MCP. Changing
selection, frame, viewport, and recent-edit context travels in conversation messages rather than
the system prompt. Credentials are loaded from Windows Credential Manager first or a server
environment variable fallback and are redacted from error/event paths. The existing editor
WebSocket carries summarized chat lifecycle events alongside capture, synchronization, and proposal
traffic; there is no second socket or self-MCP hop.

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

## Standalone server distribution

The normal editor and MCP development processes remain independent. `npm run dev` retains the
explicit `ws://127.0.0.1:4318/editor` bridge default, and `npm run mcp:start` continues through the
dedicated `mcpMain.ts` entry point with the repository root as its historical workspace default.

The additive standalone path builds the editor with Vite's `standalone` mode, which changes only the
bridge URL to same-origin `/editor`. The combined host installs the production editor after the MCP,
health, capture, and WebSocket routes, so one loopback HTTP server owns `/`, `/mcp`, `/health`,
`/captures/*`, and `/editor` without changing their existing handlers or session model. Static
source runs use the editor `dist` directory; the compiled executable uses a generated logical URL to
embedded-file map with identical MIME and cache behavior plus an HTML SPA fallback.

`scripts/buildStandalone.mjs` compiles that host, all server/workspace dependencies, and every Vite
asset into one Bun executable for a requested target. `buildStandaloneMatrix.mjs` invokes it
sequentially for Windows x64, macOS x64/ARM64, and Linux x64/ARM64; sequential execution prevents
generated embedded-asset manifests from colliding. `verifyStandaloneArtifacts.mjs` checks PE,
Mach-O, and ELF magic, exact architecture identifiers, embedded UI/banner content, size, and SHA-256
for every artifact. Bun is a build-time tool only. The produced executables require neither Bun,
Node.js, npm, nor the repository at runtime. Their workspace defaults to the user's
`Documents/OGraf Studio/Projects`, while `--workspace` and `OGRAF_WORKSPACE_ROOT` remain explicit
overrides. The first packaged release deliberately binds only to `127.0.0.1`; network exposure
requires a future authenticated origin/upgrade contract rather than weakening the MCP SDK's
localhost host validation.

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

Editor selection is a transient set with one primary layer for Properties. Ctrl/Command-click
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

Document v21 adds `layout.dimOutsideCanvas`, defaulting false. When enabled, Edit and the main OGraf
Preview render four camera-aligned, pointer-transparent regions using the fully opaque 20% gray
`#333333` around the composition rectangle. The actual work area remains untouched; the surround is
excluded from the runtime descriptor, browser composition capture, certification, and package
output.

Factory-created compositions now choose `#000000` and `layout.dimOutsideCanvas: true` as product
defaults. These are ordinary explicit document values, not renderer fallbacks: users may switch back
to transparent/undimmed authoring, and migration or import never replaces stored values.

Document v22 adds `layout.showCenterMarker`, defaulting false. When enabled, the authoring Stage
draws a pointer-transparent cross at the exact composition centre. The cross applies the inverse
canvas zoom so its on-screen size stays legible, and remains outside the runtime descriptor,
browser composition capture, certification, and package output.

Document v23 adds `layout.presentationBackground`, with `none` and `big-buck-bunny` values. When the
video option is selected, the authoring canvas mounts one muted/autoplay/looping HTML video as a
pasteboard sibling immediately behind the composition frame. The frame's real opaque background
therefore still covers it, while transparent pixels reveal it accurately. The video never enters the
runtime descriptor, browser certification/capture surface, or package output. Existing projects
migrate to `none`; the sample streams from jsDelivr and is attributed to Blender Foundation under
CC BY 3.0.

Document v25 extends the authoring-only presentation background with `still-image` plus
`presentationBackgroundImageSource` and `presentationBackgroundImageName`. Canvas Layout accepts an
ordinary image URL or reads a local image up to 10 MiB into a persisted data URL; the display name
keeps embedded files identifiable without exposing their payload in the URL field. The authoring
canvas uses a cover-fit `<img>` sibling behind the composition frame. The complete still
image configuration remains absent from compiled descriptors, capture, certification, and exported
packages.

Safe-area geometry is derived centrally from EBU R 95 for 16:9 production. Action safe uses a 3.5%
inset independently on each axis and title/graphics safe uses 5%; each pixel inset is rounded to the
nearest integer. This yields action/title margins of 67/38 and 96/54 pixels at 1920x1080, and
134/76 and 192/108 pixels at 3840x2160. The editor overlays, scene projections, broadcast QA, and
MCP lint all consume the same computed rectangles.

Rulers and guides render in an unscaled viewport overlay rather than inside the composition DOM.
The ruler strips remain 20 screen pixels at every canvas zoom; adaptive 1/2/5 intervals keep major
labels readable, while each tick and guide derives its screen position from the composition's
virtual camera origin, canvas zoom, and recentered viewport scroll. Only ticks spanning the current
camera range are materialized. Pointer coordinates are converted back into composition pixels
before guide mutations enter `Composition.layout.guides`. This keeps Photoshop-style ruler
interaction independent from authored geometry and compiled output.

The object clipboard is editor-only transient state. Copy and Cut snapshot complete selected layers;
Paste and Duplicate regenerate layer and layer-key IDs, preserve authored element/key data, and add
a 20px position offset. Timeline `Insert Frame` adds a hold key using the preceding authored pose,
whereas `Insert Keyframe` samples the evaluated pose at that frame. Neither command retimes global
OGraf lifecycle markers or any other layer.

Canvas viewport panning is also transient editor interaction state. The editor uses a
large hidden-scrollbar camera plane. Every auto-scroll or completed middle-button pan shifts the
virtual composition origin by the inverse delta and recenters native `scrollLeft`/`scrollTop`,
preserving the exact visible pixels while making the user-facing plane unbounded. Composition
geometry, layer transforms, animation keys, preview state, and exported output remain untouched.

Canvas viewport zoom is equally transient. Fit-to-view supplies the default scale; the plain mouse
wheel sets an editor-only pointer-anchored scale, while Ctrl/Command plus/minus retain keyboard zoom
around the viewport centre. Camera compensation keeps either anchor stable across recentering. The scale never enters the project
document, runtime descriptor, or compiled output and never uses browser page zoom.

The in-app agent loop emits explicit turn progress before every provider request and around each
tool call. Browser state retains the turn start time, latest phase/round/tool summary, and ticks an
elapsed display independently of transcript scrolling. Provider fetches inherit manual cancellation
through a per-request controller and add a configurable bounded timeout (120 seconds by default).
Timeouts become normal chat errors; a bridge disconnect similarly terminates any visible busy state
instead of leaving an orphaned turn.

Chat history keys combine the live editor session with the project ID. Server history retains at
most 20 project conversations, compacts each to 96,000 characters at atomic user/assistant-tool-result
boundaries, and truncates individual tool-result strings to 16,000 characters. This prevents large
scene/tool payloads from silently consuming the provider context window. A first-round provider
"prompt too long" response discards older history and retries the unchanged current turn once; later
rounds fail rather than risk duplicating already-executed tools.

Chat projects `selectedLayerIds` into automatic stable-ID/name/element-type chips on every selection
change; primary timeline property/key detail is attached when present. Layer-to-Chat drag uses a
dedicated `application/x-ograf-studio-layer-reference` copy payload—not the layer-list's internal
move payload—to add removable references outside selection. Chat validates/bounds and merges both
sources, then sends the combined references in ambient context in place of ordinary selection for
that turn. No reference changes project state, layer order, lock state, or the saved `.ogs` document.

The application shell owns an editor-local docking model independent from project state. Seven tool
panes occupy validated left, right, top, and bottom groups around the fixed canvas; each group is a
tab stack, and panes may move between edge groups or into bounded floating windows. Dragging exposes
five explicit drop hints (four edges plus float), while floating headers retain a dock-location
selector for keyboard-accessible recovery. Direct floating-window movement checks both a
132-screen-pixel pointer threshold and a 40-pixel floating-frame threshold. The nearest edge alone
receives a labelled high-contrast guide and live region preview; limited outside-workspace proximity
keeps literal corners usable, and pointer release commits that dock. Movement outside both thresholds
remains an ordinary floating reposition. Bottom-zone groups use a vertical stack and new arrivals
insert first, placing them above and reducing the height of the existing bottom pane. Dock
membership, active tabs, floating geometry, and region sizes persist only in local storage. They
never enter `.ogs`, history, MCP revisions, runtime descriptors, certification, capture, or exported
packages.

Editor chrome consumes one centralized Zero Density visual contract sampled from the live
RealityHub interface: locally bundled Nunito, 13 px primary and 12 px compact text, charcoal
`#1c1c1c`/`#232323`/`#2e2e2e` surfaces, `#dadada`/`#aaaaaa` text, `#399ed4` active accents,
`#60d0ff` focus, and flat 0/2 px panel/control geometry. Dock tabs, menus, toolbars, scrollbars,
inputs, selections, panels, and floating panes project those tokens. The `#root` chrome boundary
does not enter runtime shadow roots or override authored layer typography, composition pixels,
capture, certification, or export.

One document-level `NumericScrubController` delegates pointer interaction to enabled
`input[type=number]` controls across every dock/floating pane. A three-pixel threshold separates a
click (focus/select for typing) from horizontal scrubbing; every two pixels apply one declared
`step`, Shift multiplies by 10, Alt by 0.1, and parsed `min`/`max` clamp the published value. The
controller uses the native input value setter plus bubbling `input`/`change` events, so React/store
ownership remains authoritative instead of bypassing pane actions. The tooltip and body cursor are
editor chrome only and never enter project state or rendered output.

Tab ordering is part of that same local docking model. Pointer-dragging a tab divides each target at
its horizontal midpoint, renders a before/after insertion marker, removes the pane from its prior
group, and inserts it at the exact requested index. That same pointer gesture enters the global
docking overlay after the drag threshold: release over a tab to reorder, over a guide/edge to dock,
or in free centre space to float. Native drag remains only as a compatibility path for a floating
window's explicit dock handle. Reordering never remounts or mutates project data.

Each dock group owns a positive proportional weight. Regions materialize a resize handle between
adjacent groups, measure every group's current pixel extent at pointer-down, clamp the affected pair
to an 80 px vertical or 120 px horizontal minimum, and write all measured extents back as weights.
Flex layout then preserves the ratio across outer-region resizing and reloads. These weights remain
inside the validated local docking document and never cross into project state.

Closed panes are explicit members of the local docking document rather than absent data. Closing
first removes the pane from its dock group or floating list and records its stable pane ID; parser
repair therefore restores genuinely missing panes but preserves intentional closure. Reopening from
the Window menu removes that closed marker and creates a centered, bounded floating pane using a
pane-appropriate size. Additional reopened panes cascade slightly so their headers remain reachable;
the user may then reposition or dock them through the ordinary floating-window paths. Close/reopen
state follows the same local-only persistence boundary as docking and split weights.

The editor transport can optionally pause at the next lifecycle key whose role is `step`. This uses
the same cumulative keyframe timing as compilation but remains preview state: it does not rewrite
transitions, property tracks, or OGraf actions. From a Step, the next Play targets the following Step;
after the last Step, it plays through End. Space invokes the same controller unless focus belongs to
a form or editable control.

Stage subscribes directly to Timeline `isPlaying` for authoring chrome. While true, selected-layer
outline classes and the React Moveable overlay are not rendered; the selection store itself is never
cleared. Pausing or stopping therefore remounts the controls against the same target without adding
project/history changes or contaminating playback/capture pixels.

The global keyboard boundary intercepts Ctrl/Cmd+A only when focus is outside inputs, textareas,
selects, and content-editable controls. It prevents the browser page-selection default, clears any
DOM text range, and sends every active-composition layer ID to the ordinary selection store in paint
order. Hidden, locked, and guide flags do not remove a layer from Layers/Timeline selectability.

Lifecycle-marker retiming is planned in `packages/scene-model` and consumed by both OGraf Studio
and `authoring-core`. Browser gestures and MCP operations therefore enforce identical duration
bounds, preserve the same property-key semantics, and report the same retiming warnings.

Reusable components are composition-local authoring snapshots containing selected layers and only
their referenced data fields. Insertion remaps every layer, key, loop, field, binding, and internal
parent ID; it applies a placement offset and assigns one fresh persistent canvas group. The result
is a set of normal independent layers. Component definitions are not compiled, so exported OGraf
packages have no studio-specific component runtime or vendor dependency.

Broadcast style packs are immutable scene-model catalog definitions, not compiled resources.
Applying one copies canonical palette/type/radius/outline/motion values into the composition's normal
editable design tokens and materializes compatible semantic layer bindings. Recipes consume those
copied values and author ordinary properties/tracks; neither pack identity nor recipe machinery
crosses the compiled descriptor boundary.

Bug, ticker, scoreboard, and clock recipes follow the same materialization boundary as lower thirds:
they create normal layers, fields, groups, semantics, and lifecycle tracks and return their complete
ID mappings. The ticker's crawl is the deliberate local-loop case: a clipped text child owns one
absolute-time X loop while its finite lifecycle X track remains static.

The main canvas remains one authoring surface. Its finite transforms/effects/paint tracks are driven
by `buildRuntimeTimeline` from the compiled descriptor. During Play, a shared runtime helper resolves
each loop's lifecycle/Step activation window and the Stage RAF samples every active loop through
`sampleCompiledLayerVisualState`; scrolling tickers, pulses, stroke/paint loops, and clipping therefore
run together. When playback parks exactly at a Step, local loop time continues from a wall-clock hold
epoch. Stop, End, manual mid-transition pause, or leaving a Step restores the finite authored sample.
The former separate main-canvas OGraf Preview surface was removed to avoid stale duplicate controls.
Preview & Export retains real `GraphicElement` lifecycle actions, schedules, logs, certification, and
package output.

The browser editor owns a separate bounded 50-action project-snapshot history for direct UI edits.
Rapid Zustand/Immer project changes coalesce over 500 ms; the pending pre-edit snapshot is published
immediately so menu availability never lags the edit. Each entry carries a derived user-facing label
and timestamp. The Edit menu subscribes through `useSyncExternalStore`, shows pending/past/future
actions, and multi-step selection reuses the same undo/redo traversal used by keyboard shortcuts.
New/open/import resets this browser history, while agent-session history remains independently
revisioned in `authoring-core`.

Timeline key selection distinguishes one primary key (for the existing easing/curve editor) from an
array of selected aggregate or property keys across layers/tracks. Ctrl/Cmd toggles membership and
Shift expands from a same-track anchor. Group movement is one Immer transaction: it derives a shared
integer frame delta, intersects composition bounds with every affected track's nearest unselected
neighbours, and moves aggregate/property keys together before rebuilding sorted tracks. This
preserves relative spacing, prevents crossings/collisions, and keeps one browser undo entry.
Lifecycle markers are not part of this selection because their movement retimes adjacent OGraf
transitions.

The Timeline body owns a local-only gutter width separating its vertically synchronized layer-name
list from the horizontally scrolling key tracks. A 7 px accessible separator updates the gutter
through pointer or keyboard input, clamps it to 120–520 px while reserving 140 px for tracks, and
persists the result in local storage. ResizeObserver reapplies the clamp when the outer Timeline pane
changes size; no gutter width enters `.ogs`, undo history, or compiled output.

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

The Resources panel projects that flat registry and the composition-local Brand Kit/components into
an editor-only ARIA tree. Five counted category nodes and their item nodes use native disclosure
state, so collapsed branches render only compact summaries while one or more expanded items expose
the unchanged mutation controls. Expansion state is transient UI state and never enters the project,
registry, descriptor, or package.

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

The Layers panel remains a flat, truthful projection of `composition.layers` paint order even when
authoring parents exist. A layer name is indented by its resolved parent-chain depth without
re-sorting the tree. HTML drag-and-drop divides each target row into explicit intent zones: the
upper/lower quarters reorder before/after in paint order, while the centre half changes only
`parentId`. Self-parenting, descendant cycles, and already-cyclic targets are rejected before the
store mutation; Properties remains the explicit path for clearing a parent.

Objects do not store a separate 3D Z coordinate. Properties projects canonical paint order as a
one-based **Z order** (`1` = back, `composition.layers.length` = front). Editing it moves the layer
within `composition.layers`, so editor rendering, timeline/layer lists, MCP IDs, and compiled output
cannot disagree with a second depth system.

The canvas Arrange toolbar drives the same `reorderLayers` mutation. Send/Bring-to-end partitions
the paint-order array while preserving selected and unselected relative order; one-step
Backward/Forward moves each contiguous selected run past one adjacent unselected layer. Commands
disable when that transformation would leave the order unchanged.

Each property key owns its incoming easing. It can use a named dependency-free preset or an explicit
cubic Bézier curve. The same pure samplers drive editor interpolation and are passed to GSAP as the
exported runtime easing function, keeping linear, polynomial, Sine, Expo, Circ, Back, Bounce,
Elastic, and custom curve motion deterministic across both surfaces. Newly authored generic layer
keys, property keys, and lifecycle transitions default to neutral linear interpolation. Recipes and
explicit operations remain responsible for intentional non-linear motion; migrations retain legacy
stored/fallback easing so opening an existing project does not redesign its animation.

Top-level Timeline layer rows use one fixed neutral-gray summary colour across their gutter swatch,
animation blocks, borders, labels, and key diamonds. Expanded properties retain the stable semantic
palette defined by property meaning, so the parent overview stays neutral without flattening detailed
track identification.

The canonical model may materialize static compatibility keys at lifecycle frames for every
animatable property, but the Timeline does not treat those as meaningful authoring tracks. Its
default projection includes properties whose values differ, that contain a non-lifecycle authored
key, or that own a local-loop track. Selected/manually added properties remain visible. **All** is a
transient projection override; **+ Property** reveals a compatible property and selects/adds its key
at the current frame. Neither visibility preference enters `.ogs` or compiled OGraf output.

One optional local loop clip may sit beside a layer's finite lifecycle tracks. Its independent
numeric property tracks use a local frame ruler and activate either for the on-air lifecycle or one
specific Step. The compiler preserves the clip in the shared runtime descriptor; editor preview,
realtime playback, and non-realtime schedule replay calculate phase from an absolute epoch rather
than callback counts. Loop keys never become composition keys or OGraf Steps, and loops never
invoke lifecycle actions. See ADR-004.

Timeline loop badges are a projection of that activation contract, not new keyframe data. A
step-activated loop marks its referenced Step and the same-frame key on its layer row; a
lifecycle-activated loop marks the first Step where its persistent on-air epoch begins. Stale Step
references produce no badge and remain validation concerns.

Layer effects are authored as structured blur/drop-shadow values. Blur, shadow alpha, X/Y offsets,
and softness are numeric animation tracks; shadow enabled state and color remain discrete/static.
A shared serializer produces the same CSS filter in Stage and GraphicElement at every frame.
The generic layer factory initializes every ordinary Start/Step/End pose at opacity 1, so toolbar
and MCP `add_layer` output is immediately visible at frame zero and stays visible until alpha is
authored. Semantic/broadcast recipes bypass that generic visibility policy with explicit motion
builders, retaining deliberate hidden entrance and exit states.
Text elements store a sizing policy. `auto-size` measures system-font content while authoring and
writes integer layer bounds; `shrink-to-fit` uses the shared DOM renderer plus ResizeObserver so
data-bound text remains inside animated runtime bounds without exceeding the authored font size;
`fit-to-width` keeps the authored box fixed and finds the largest uniform font size that contains
the complete text and stroke in both dimensions, allowing growth or shrinkage; `squeeze` measures the
text's intrinsic unwrapped DOM bounds and applies independent X/Y scales so the glyphs fill the
authored box exactly; `fixed` preserves both box and authored font size. Fit-to-width uses explicit
line breaks rather than implicit wrapping and re-evaluates on box, animated-stroke, and font-load
changes. Squeeze uses the same ResizeObserver/font-load callbacks and deforms stroke with the glyphs.
The same DOM renderer is shared by Stage, browser measurement/capture, realtime playback, and
non-realtime seeking. Browser-free SVG diagnostics use an approximate intrinsic-width scale because
they cannot measure the target browser font. Fit-to-width measures through an offscreen
untransformed probe so canvas zoom and layer/ancestor transforms cannot contaminate
composition-pixel font sizing.

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

Editable source uses the `.ogs` extension. It intentionally does not end in `.json`, because
`ograf-devtool` scans generic JSON files in a selected directory as candidate manifests. Legacy
`.ogeproj` and `.ogeproj.json` sources remain readable but every new browser/MCP save requires
`.ogs`. The source format is not a playout artifact; only the extracted `.ograf.zip` contents
(`*.ograf.json`, `main.js`, and resources) belong in an OGraf tool or renderer.

Local picker and remote URL loading converge on the same source parser and store migration boundary.
The remote path accepts absolute HTTP(S) only, omits credentials, requires browser CORS, rechecks the
final redirect scheme, reads the response through a 32 MiB bounded stream, and never replaces the
current project before explicit user confirmation. Public GitHub raw-file URLs satisfy this model;
normal GitHub `/blob/` pages return HTML and are not project sources.

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

Document version 21 adds the authoring-only outside-canvas dimmer preference. Migration defaults it
off, preserving existing editor appearance and all rendered/exported pixels.

Document version 22 adds the authoring-only centre-marker preference. Migration defaults it off,
preserving existing editor appearance and all rendered/exported pixels.

Document version 23 adds the authoring-only presentation-background preference. Migration defaults
it to `none`, preserving existing editor appearance and all rendered/exported pixels.
