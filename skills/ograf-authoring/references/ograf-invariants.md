# OGraf authoring invariants

## Compatibility

The EBU OGraf v1 specification and official schemas outrank local assumptions. A project being semantically valid is necessary but insufficient: final output must also pass manifest schema, package layout, ESM/default-export/API, realtime lifecycle, and non-realtime lifecycle checks.

Save/export must certify the same artifact bytes that are written. If certification is unavailable or fails, stop and report the errors; do not create an uncertified substitute.

Shader pixel inspection must follow the renderer's presentation backend. Shared GPU shaders
keep output in Canvas2D surfaces; inspect those pixels instead of requesting an incompatible
WebGL context. Direct WebGL surfaces keep GPU readback. Missing/lost contexts,
unreadable or tainted pixels and uninitialized surfaces must still fail certification.

## Lifecycle and timing

- Every composition has exactly one Start first and one End last.
- Only Step states may occur between them and contribute to OGraf `stepCount`.
- Transitions connect adjacent lifecycle states.
- Layer animation keys sit on the composition frame ruler but belong to one layer and one property.
- Frame rate and transition durations determine the total frame range.
- Non-realtime behavior must remain deterministic under `goToTime()` and scheduled-action replay.
- Pointer-triggered visual rules need no GDD field and apply only in interactive real-time HTML
  playback. Do not treat browser pointer events as scheduled non-real-time or remote OGraf actions;
  playout rule triggers, delays and transitions replay from the schedule.
- Lottie source frames include `animationData.ip`, while the bundled player seek API is relative to
  that in-point. Keep conversion at the runtime adapter boundary. `load()` must await Lottie
  `DOMLoaded`; a timer or successful JSON parse is not proof that embedded assets rendered.
- Lottie input must be one complete self-contained document. Reject external image/font paths,
  segmented documents, undecodable/nonpositive embedded images, and luma mattes; alpha mattes are
  supported. Expressions remain warning-only because the light Canvas build ignores them.
- A changed non-realtime Lottie seek rebuilds and awaits the light Canvas player. Certification
  compares exact Canvas pixel signatures before and after a backward/repeated seek. Realtime keeps
  one player and uses absolute elapsed time; Canvas proof does not establish another renderer.
- Local loop clips share the OGraf clock. Derive their phase from the action schedule and timestamp,
  never mutable timer ticks. A loop may continue while parked at a Step but must not call or advance
  `playAction`, `stopAction`, or another lifecycle state itself.

## Scene behavior

- Width, height, and frame rate must remain positive.
- Authored positions and sizes are normalized by the core; frames are integers.
- Guide layers are editor-only and do not render to output.
- Core property tracks retain at least one key. Shader tracks are opt-in; the editor can remove
  their final key to restore data/default control. MCP `remove_property_key` currently retains its
  minimum-one-key rule, so do not assume that editor-only removal is exposed as a tool operation.
- Easing is per incoming property key, never global.
- Custom cubic Bézier curves override the named easing for that key.
- Generic keys and transitions default to linear; intentional non-linear recipe motion must be
  explicit. Existing stored or migrated easing remains authoritative.
- Ordinary newly added layers default to opacity 1 at Start, Step, and End. Hidden lifecycle
  boundaries must be explicit authored motion rather than an implicit generic-layer side effect.
- Authored transform/effect edits write every lifecycle frame; frame-scoped edits require an
  explicit frame.
- Shrink-to-fit never renders below the text layer's authored `minFontSize`. A degenerate result
  means that floor was reached and the box still cannot contain the text.
- Fit-to-width may grow above or shrink below the authored font size. It chooses the largest uniform
  size that contains the complete text and stroke inside both fixed box axes, without non-uniform
  glyph distortion; only explicit line breaks create multiple lines.
- Squeeze deliberately scales glyph width and height independently to fill both authored box axes.
  Treat that deformation as intentional styling rather than a legibility fallback.
- Duplicate-group frame offsets never clamp keys; insufficient duration is an atomic error.
- A clipping parent masks only direct children whose `parentId` points to it. The mask follows the
  parent's animated transformed bounds, rotation/origin, and rectangle radius; duplicated groups
  must remap both ids. Child rotation remains independent rather than inheriting the parent angle.
- Authored dimensions remain positive, so a collapsed wipe mask uses the normalized one-pixel
  minimum rather than an invalid zero-sized layer. Stagger recipe keys must fit entirely before the
  first pausable Step and reject instead of clamping or crossing lifecycle bounds.
- Intentional ancestor clipping is not text-box overflow and must not become a validation fault.
- Gradient paints require at least two normalized stops with finite angle, offsets, and opacities.
- Path fills use the shared paint contract and a nonzero/even-odd fill rule. Their gradients span
  the rendered layer box, and existing solid paths migrate without pixel changes.
- Pattern instances reference one composition resource. Compilation resolves its definition;
  package import deduplicates those resolved definitions back into editable shared resources.
  Seeded spacing is fixed across cycles, and row travel is an integer multiple of the motif period
  over `cycleFrames`. Pattern SVG paint repeats per tile; shared geometry and mask clocks remain
  synchronized independently of numeric effect-loop duration. Limits are 32 rows, 32 symbols and
  64 sequence entries; invalid definitions and deletion of referenced resources fail atomically.
- A layer mask references a same-composition source; sources cannot be guides or participate in
  cycles. Alpha sources may be rectangles, ellipses, paths, patterns or images; geometric path mode excludes
  images and ignores source opacity/effects. Targets may be any layer type. Inversion is confined
  to target bounds. A source-only layer remains in the compiled descriptor but does not paint.
  Masks and clip-to-parent can coexist. Mask chains include the source's own alpha mask and clip;
  path mode uses only its geometry. Collection masks remain internal to each prototype instance.
- Masks use SVG compositing in the shared renderer; conic paint alpha uses half-degree SVG wedges
  because browser SVG masks do not render embedded HTML. Visible path gradients use native CSS.
- Gradient stop-offset tracks use `fill.stops[N].offset`, reference an existing zero-based stop, and
  keep authored key values within 0..1.
- Shader paints require WebGL2. One optional embedded PNG/JPEG is decoded before readiness and
  sampled as `iChannel0`; `iChannelResolution[0]` reports its pixels. Sample exposed parameters per
  object/paint slot at the requested time; active keyed channels override only their data
  components. Loop-only controls return to data outside their active interval. Shader time and
  keyframed parameters are independent.
- Shader effects require WebGL2 and reserve `iChannel0` for the flattened incoming layer result
  after preceding effects. Their blended output feeds later effects. They cannot attach a separate
  input image or serve as alpha-mask sources; browser capture/certification must render their pixels.
- Blend modes are static layer properties evaluated inside one isolated transparent composition.
  They must not depend on, sample, or change according to an external controller/video background.
  Editor transparency checkerboards remain outside the composition isolation boundary.
- Loop keys use a separate local `0..durationFrames` ruler. Keep infinite-loop endpoints visually
  seamless unless an offscreen masked wrap is intentional.
- Semantic roles, tags, and descriptions are authoring-only. They may guide queries, recipes, QA,
  and review, but must not add a runtime dependency or alter OGraf lifecycle behavior.
- Brand-token links are authoring-only and their current values must be materialized into supported
  element properties before compilation.
- Repeater output and component instances compile as ordinary layers and fields. Linked component
  refresh is an explicit authoring replacement, never a playout-time master/instance relationship.
- A visual proposal must apply only after explicit acceptance and only against its original base
  revision. Rejection, expiry, or revision drift leaves the project unchanged.

## Data

Field keys must be unique. Nested object keys must be unique among siblings. Bindings resolve to
stable field IDs, a scalar leaf through an unambiguous `sourcePath` segment array, and a valid element
target property. Asset IDs are unique and `asset:<id>` references must resolve inside the same
composition. Keep authored defaults useful because they become schema defaults and are exercised
during lifecycle certification.

Use `ograf_validate_project {dataFieldUsage:true}` to audit field references. Change text/colors and
inspect rendered output before reporting controls as functional; a binding alone is insufficient.

Every field compiles an operator-facing `gddType`. Select defaults must reference declared options;
select-multiple defaults must contain only declared string values. Descriptions, option labels, file
extensions, recursive object properties, array item schemas, and constraints belong in the manifest
schema and must survive OGraf import/export. A runtime collection accepts only object-item arrays,
one contiguous persistent-group prototype, explicit finite offsets, capacity 1..100, and truncate
overflow. Capacity equals `maxItems`; prototype clip parents stay inside the prototype; one array
field drives at most one collection. Scheduled updates are pure index-based snapshots and must remain
reproducible when `goToTime()` seeks backward.

## Export playback review

For repeat-frame certification, copy shared GPU shader output from each retained Canvas2D surface
into a separate readback canvas. Repeated direct reads can change Chromium's rendering backend and
produce false pixel differences. Compare the exact pixel signatures after backward and repeated seeks.

### Nodos presets

Studio's **Preferences → OGraf Studio → Nodos** keeps ticked templates set as ElectroNode presets
in a Nodos engine through its Editor API, updating them as edits pause. Studio's server serves each
template's exact certified OGraf package with `nodos.html`. Each preset wraps one template, not coordinated-set export or a separate MCP export tool. Existing `.ogs` saving, certification and multi-template preview keep their own contracts.
The page requires a real-time or dual profile and loads public defaults before playing its first
step. Use effective cropped output dimensions while preserving the authored canvas crop offset.

Presets contain only `URL` and `Resolution` settings. The page's `nodos-inputs` JSON declares
selected field names/types and live-media texture tags. The companion ElectroNode host matches
these declarations to pre-existing manually created slots by name; missing slots are not created
automatically. Choose fields in **Data → Nodos inputs** from those exposed in Operator controls.
New templates start with no data inputs selected. Older templates keep their previous declarations
until the user changes that selection.
Omit internal top-level fields and recursively remove internal descendants from object/array
public defaults and incoming native values; retain internal descriptor defaults, bindings,
animations and Rules inside the OGraf graphic. Field keys and live-media tags must not collide
with ElectroNode's reserved `URL`, `Resolution`, `ShowPreview`, `Output` and `Audio` pins.
Objects and gradients use `nos.Dict`; arrays use `[T]` and
multi-select fields use `[string]`. Nested arrays use Dict entries named `items`, unwrapped by the
page. The page receives plain values, not JSON text. Generated shader fields follow the same
exposure choices. Filter hidden descendants again when incoming native structs supply defaults
for members that were omitted; those defaults must not replace internal graphic values.

ElectroNode 0.2.0.b49 or later uses one `Resolution` pin (`nos.fb.vec2u`, `{x:width,y:height}`)
instead of `Width`/`Height`. Presets do not set `FrameRate`; rendering follows the pulling Nodos
thread's frame rate. Keep the graphic's own authored frame rate and OGraf timing unchanged.

Data's type menu discovers eligible engine structs, tables and enums while Nodos is enabled and
connected. A choice snapshots its ordinary field schema and stores `nodosType`; the schema remains
usable offline. Re-select the type to adopt later engine schema changes. Exclude resources, unions,
dynamic/recursive or oversized shapes. Integer values must be integral and within the native range;
64-bit integers are limited to JavaScript's safe integer range rather than silently rounded.
Changing engine, disabling Nodos or disconnecting clears the live catalog; late replies from an
old engine must not restore it. Existing saved type metadata remains intact.

MCP `add_data_field` and nested field inputs accept a known `nodosType` together with its explicit
ordinary field schema. `update_data_field` takes these values at the operation's top level;
`nodosType: null` clears the native assignment, and selecting a plain `fieldType` also clears it
unless a replacement is supplied. These authoring operations do not fetch engine types or connect
to Nodos. Preserve metadata through components, sets and standalone `.ogs`; it is not an OGraf
manifest schema extension or an extra playout field.

Preset identity follows the stable template ID, not its display name. Preserve existing unique
assignments through rename, untick/reselect and reload; verify duplicate names stay distinct.
Sync must include effective shared controls/assets of inactive selected templates. Invalidate
outdated preparation when configuration, selection, document or connection changes; do not publish
a completed old build merely because it began while enabled. Already dispatched registrations may finish.

Studio's server makes the preset's `nodos.html` URL absolute, at an immutable version below `/nodos/<preset name>/`
address, so Nodos must run on the same machine while Studio keeps running. Protocol objects and
pin serialization come from the vendored Nodos Editor SDK 5.1; Studio owns bounded request IDs,
timeouts and cancellation so SDK connection failures cannot revive stale work. Verify a companion
ElectroNode build that reads page declarations, matches existing slot names/types, forwards native
typed values through `window.nodos.onData`, and supplies texture canvases through `nodos-input`.
Process SDK 21.5 supports the typed-data bridge; its version alone does not establish this complete
host contract. OGraf certification
validates the packaged OGraf graphic; it does not establish Nodos engine or live pin bridge
compatibility. Report those target checks as unverified
until exercised in the requested installed versions, including initial playback and pin updates.
Stage files before registration so the engine can fetch them, but keep accepted versions unchanged
on failure. Keep uncertain registration files during a bounded grace period; a transport timeout
does not prove the engine rejected the update. The current and previous accepted versions per engine and preset are
protected; older/uncertain versions have 60 seconds of grace. Admission is bounded to 256 MiB total,
64 MiB and 4,096 files per package, 128 versions and eight pending updates. Reject excess work instead of evicting
protected bytes. Failed handshakes must release their stream so later sends can reconnect. Verify
these cases through the HTTP file route and gRPC protocol, as well as ordinary export certification.

### External renderer checks

Certification checks the generated artifact contract; it cannot prove every editorial control or
pixel sequence is correct. When asked to test an exported package, use the actual package in the
requested external renderer. Match the viewer dimensions to the manifest before judging clipping
or a blank lower third; dimensions retained from another graphic can crop otherwise valid output.

Exercise each lane/state and its intended Take, Update, Out and Clear paths. Capture the rendered
preview after settling and around dependent resize/takeover moments. Verify both room-making and
restoration, rejection of blocked commands, and whether evicted graphics should remain off.
Distinguish captured pixels from supporting DOM/state evidence; screenshots of controls alone do
not verify the artwork. Save original operator data and restore it after testing.
Keep the preview visible when capturing transitions. If a full-page capture omits offscreen
graphics or catches an unsettled frame, retake the visible preview; mark the earlier evidence
inconclusive instead of treating it as proof of success or a confirmed disappearance.
Wait for each action to complete before naming its settled capture. Read the authored outgoing
and incoming durations; a switch may intentionally play Out before In. Capture continuous motion
or inspect a performance trace to diagnose stutter, since fixed-frame PNGs cannot measure it.
For the six modifier examples, follow the state and data cases in [modifiers.md](./modifiers.md#modifier-example-playback-review).

Run `ograf_validate_project` with `dataFieldUsage:true` on the resolved editable templates and inspect
suspect targets. Change text and colors to visibly different values in the external controller,
then confirm the intended on-air object changes. A valid schema, duplicate field name suffix or
binding to a hidden retained layer can otherwise expose a control that appears functional but has
no visible effect. Keep legitimate hidden geometry, matte sources and conditionally shown layers.
Repeat the check on retained shared instances: source references alone do not establish that
compiled placement bindings, overrides and deliberate removals reach the retained mount.

For a crawl, capture two separated moments and the repeat boundary: moving left is insufficient if
the loop leaves a long empty interval. For grouped headline loops, test Pause, Next and Resume and
confirm the other lanes/clocks continue. Report only features actually present in the package.

In OGraf Devtool, also run its in-depth lifecycle test after ordinary playback. Its independent
graphic instance must load from the same packaged resources and cleanly dispose without disturbing
the primary preview. For remote packages, reopen via the exact manifest URL if folder discovery is
unsupported; do not change the manifest's public-internet permissions merely because a local test
server uses a separate loopback port. Separate viewer/remote-loading failures from template defects.
For non-realtime Devtool testing, verify the visible frame again at the same timestamp after a
schedule edit, reload, or duration change, including a nonzero playhead. Its seek cache must allow
the changed schedule to replay. Use the maintained Devtool load-lifecycle integration when needed;
official schemas, validators, and lifecycle checkers remain unchanged.

For a coordinated package, exercise its actual exported defaults from a fresh Off state and require
a successful Play response plus the expected on-air lanes. Also test explicitly selected parent
and dependent lanes, blocked/mutually replacing selections, and repeated/backward scheduled seeks.
An invalid batch must leave on-air selections and the lifecycle step unchanged; clocks may keep
advancing. Resource preparation must succeed before a planned batch changes working output.
After a newer Take/Out/Stop/Clear or reload supersedes a running batch, canceled later stages must
not return. Verify error payloads as well as rejected Promises: a numeric non-success `statusCode`
can pass structural Devtool checks while the requested graphic never plays. Preserve independent
validators and distinguish expected admission errors from successful startup.

### Playback performance review

Measure a fresh Load and first Take, repeated switches after preparation, and overlapping Out/In
graphics separately. Await actions, record their responses and authored durations, and capture
continuous frame timing or a performance trace while the output is visible. At 25 fps one authored
frame is 40 ms; a delayed command response alone does not prove dropped animation frames. Report
the measured package, host and cold/warm cases rather than promising a universal latency bound.

For skipped first Play, reproduce the Devtool check's detached-element sequence: await Load,
unchanged full `updateAction`, empty `updateAction`, then time and await
`playAction({skipAnimation:true})`. Also measure a visibly mounted complete export and capture
ready pixels after the timed interval. Keep fresh-instance first Play and warm replay separate;
background-tab throttling and simultaneous output instances can distort both. Do not change
the checker threshold or bypass font/resource/GPU readiness to turn a warning into a pass.

Shrink-to-fit can avoid repeated DOM layout probes when the authored font size already fits.
Preserve the minimum-size/degenerate check first, then reproduce the original 16 binary-search
arithmetic steps without those layout probes. Returning the exact authored size instead changes
the previous quantized result and may shift glyph coverage. Overflowing text retains its search;
fit-to-width is a separate algorithm. Keep font-ready invalidation and shader text masks correct
after fitting, data changes and backward seeks. This optimization must not change Rules order,
transition durations, dependency barriers or action completion readiness.

Prepared-instance reuse is a realtime optimization for unused dormant template objects and shared
resource probes, together bounded to four entries and an estimated 64 MiB. Verify data changes between preparation and Take, repeated state
changes, Out/retake, Clear, superseding commands and reload. Prewarming must produce no Rules or
lifecycle events, timer advancement, alarms or layout occupancy. A taken instance is consumed
once, so its mutable on-air state cannot leak into a later use. An unactivated shared probe may be
returned after readiness; canonical on-air shared renderers keep their separate lifecycle.
Admission, requested/ready events,
Rules order, timer reset/restart and dependency timing must match cache misses. Scheduled backward
and repeated `goToTime` replay must remain deterministic and independent of the realtime cache.

Out/Clear can dispose an outgoing composition while a realtime frame awaits shader readiness.
Treat cancellation as cleanup only when that exact composition is already disposed; keep genuine
shader failures on active output visible. Review Play → Out/Clear → Update → Play so a discarded
GPU fence cannot poison subsequent coordinated commands.

Realtime shader draws avoid blocking GPU completion and per-draw error queries. Explicit content
readiness, seeking and browser capture await completion asynchronously; do not replace these awaits
with a fixed delay or remove them to improve a benchmark. Check shader, fill, outline and effect
pixels after repeated/backward seeks. Context loss, disposal, failed fences and timeout must settle
pending operations with an error rather than resolving a blank or unfinished frame as ready.

### Live-data and application UI performance

When a UI stalls at its feed interval, measure the complete path: fetching/normalization, field
mapping, Rules, editor rendering, on-air rendering and chart updates. A small JSON payload can
trigger expensive downstream work. Record main-thread long tasks around several actual refreshes,
plus navigation during updates and a longer-running session; a good first update is insufficient.
Keep command latency, frame gaps and background-tab throttling distinct.

- History labels run on ordinary editor updates. Avoid serializing an entire changed project or
  composition just to infer a label: unchanged embedded resources can make a small drag expensive.
  Short-circuit structurally shared branches and still compare independently cloned remote updates
  correctly. Measure this separately from rendering and keep undo labels and grouping intact.

- Compile editor descriptors when the authored composition changes, not when live values change.
  Reuse that descriptor for mask, loop and timeline sampling. Data changes resample current state;
  they must not repeatedly rebuild the descriptor or restart the loop epoch. Resolve a layer's
  complete track set once per sampled pose, rather than repeating migration and key sorting for
  every transform channel; verify exact curve and legacy-track parity.
- Invalidate a layer from its own binding dependencies and effective Rule result. Preserve stable
  results for unrelated buttons and static labels. Include collection-row dependencies, state
  changes and clock origins; a blanket object-identity shortcut can hide real updates.
- Yield painting of an obscured editor in its own document. Do not use window blur or one global
  fullscreen flag: a visible editor on another monitor must keep updating. Sync editor/preview
  mode still needs the editor as its output source. Resume with the latest values and clock pose.
- Keep logical data, Rules, timers and alarms active in hidden views. Defer visual work only where
  mask, clip, layout, motion, media and shared-source dependencies permit it. Flush current content
  when revealed and retain real font/resource/GPU readiness; do not show stale or unfinished pixels.
- Do not replay an ever-growing realtime chart history on every quote. A checkpoint may replace
  only fully settled history; account for morph duration and per-point stagger, including Fade or
  Reveal morph updates. Preserve interrupted animation chains and complete non-realtime schedules
  for backward/repeated seeking. Do not replace this with an arbitrary history-length cap.
- Persistent Workers can own feed fetching, parsing and normalization while preserving source
  sharing, cache/refresh timing, freshness, aborts and last-consumer cleanup. They do not move React,
  DOM layout, Rules or Chart.js canvas work off the main thread. Remove redundant UI work as well.

Preserve the user's requested update cadence and Immediately/Next appearance policy. Keep UI state
out of feed mappings and send sparse in-place patches. Verify repeated refreshes, hidden-view
reveal, selection/alert persistence, fullscreen exit, detached monitors and Worker fallback or
failure. Profile the finished output again; never claim that introducing a Worker alone establishes
smooth playback or a universal latency bound.

### Internal fields and shader exposure

**Data → Operator controls** shows the current template's controls in a searchable tree with nested fields
and effective exposure status. **Fields** retains definition/value editing. An internal parent
keeps descendants internal without replacing their authored checkbox choices; disabling an array's
item schema makes the whole array internal, even when the array's own checkbox is enabled.
Scene object/group checkboxes show all, none or mixed exposure; clicking mixed exposes all.
Their bulk changes include collapsed and filtered-out controls, recursively setting properties
and items. Individual parent-field toggles still preserve authored child choices. MCP bulk edits
use batches of the existing field operations with the intended nested definitions.

For an exposure change, save and reopen the `.ogs`, then export both standalone and coordinated
packages. Inspect the public manifest schema, action schemas, public defaults and README data
examples: internal keys must be absent everywhere intended for playout input. Keep their defaults
inside the graphic for bindings and Rules. Coordinated states sharing a color key must retain
valid GDD color constraints; schema merging must not drop the color pattern. Reordering `vec2`
object keys during save/import must not cause false range errors or alter its values, limits or
exposure choices.

Validate conditional schemas with the official GDD form as well as JSON Schema/Ajv. Strict GDD
forms need explicit `type:"object"` and `properties:{}` on conditional `allOf` nodes, plus
`type:"string"` on `stateId` const guards. Switch states in main and custom-action forms, including
nested selectors: show only the selected state's public controls and remove prior-state values.
For a local Devtool checkout, use the repository's `scripts/configureDevtoolConditionalForms.mjs`
integration and rebuild its client. It resolves both main-data and custom-action forms recursively,
including selected-state defaults, while preserving unrelated values in open schema objects.
See `docs/guides/devtool-conditional-actions.md` for setup and client refresh.

In the requested external renderer, start from a fresh load and capture the artwork. Update a
public color/value and confirm its visible result, then attempt an external write to an internal
field and confirm it cannot change that field. Trigger an authored Rule/custom action that writes
the same internal field and confirm it still works; sample its shader animation/loop at separated
times. Follow with partial object updates that omit an intermediate branch containing internal
descendants: retain their current values, or their internal defaults on first use. Repeat after
reload and replay so initialization uses the descriptor's internal defaults even if a wrapper
omits optional defaults. Match visible pixels with data/state evidence and report each separately.
