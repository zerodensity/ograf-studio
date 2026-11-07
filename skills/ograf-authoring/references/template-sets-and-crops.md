# Template sets and crops

## Retained components in coordinated output

A retained component keeps one live instance across template changes. Bindings on each
template placement—including additional fields, nested source paths, value maps and deliberate
binding removals—follow that placement without restarting its clock or loop. Attach bindings to
the live layers being edited, preserve their stable field IDs, and verify the controls in the
exported preview as well as in Studio. Library snapshots alone are not proof that a control
reaches the visible output.

## Template set discovery

In Studio, **File → Open…** detects a standalone template or a complete set from file contents.
**File → New…** creates one template; in the Templates pane, **New template…** or **Add existing
template…** creates a set while retaining the first template. Do not extract compact set members
as standalone files; use Studio's Save Template operation to resolve shared dependencies.

`ograf_get_capabilities sections:["editor","templateSets","elements"]` reports the live editor's
support. Reload an older editor when `templateSets.available` is false despite a connected bridge.
Call `ograf_get_template_set` for set/template IDs, inherited settings, shared control and asset
bindings, clipboard availability, and the opaque `revision`. `includeProjects:true` is optional and
bounded. For large sets, filter with `templateIds:[id]` or request `offset:0,limit:1` and follow
`pagination.nextOffset`. Reads preserve active selection and revision. Ordinary project reads
still inspect the active template. Set archives and coordinated preview compilation use workers;
source saving reports progress without pausing output.

The set revision covers both structure and current template edits. It is an editor-session token,
not the numeric authoring revision. Pass the exact token to `ograf_update_template_set` and re-read
after a conflict or uncertain response. Queued requests expire without executing after their deadline.

## Shared Resources

For a template set, **Resources → Template Set** presents shared components and asset slots with
their per-template usage and Shared/Local override status. **Resources → Template** retains the
current template's resources. Scene Outliner's **Shared controls and asset slots** remains available.
An asset slot explicitly maps compatible local assets to a shared file source; a binding with
inheritance disabled keeps its local fallback. One slot currently maps at most one asset per
template. A shared component instead has source layers, linked instances and per-property
overrides. Compact archive pooling alone does not create either kind of editable link.
Deleting an inherited timeline key creates an instance-local keyframe override. It must not alter
the component source or sibling instances; reset that override to inherit the source key again.

Before replacing a shared file in Studio, inspect **Review replacement**: it shows old/new sources,
inherited and local bindings and other slots that use the same source. An existing source offers
**Replace for all** or **Use only for this slot**; cancelling changes nothing. Source selection
uses **Apply** or **Cancel**. A stale review must be cancelled and opened again. Related set
references are cues for further review, not a claim that every reference will change.
Do not assume an existing exported or on-air package changes: it is a snapshot and must be exported
and deployed again. Resolve dependencies for standalone exports and retain v6/v5 compatibility rules.

`ograf_get_template_set` returns slot bindings, inheritance flags and asset metadata without file
payloads. Pass `resourceUsage:{slotIds:[...],componentIds:[...]}` to request structured usage for
up to 16 IDs of each kind; use IDs already inspected in the set. Per-template entries follow the
request's template page/filter; follow `pagination.nextOffset` for the complete set. Slot source
replacement impact includes whole-set counts, up to 32 affected slot IDs and a truncation flag,
plus counts/flags for related source references that require review and may not all change. Component usage counts include instances with
property or field overrides. These reads do not change the revision or editor selection.
`ograf_update_template_set` supports `bind_asset` and `set_asset_slot_source` with the inspected set
revision and real IDs. Creating a slot, file replacement and binding inheritance are Studio UI
operations; the impact review is not an MCP mutation. Never claim that updating a slot's source alone
changes the underlying asset file.

## Transition Logic

Template-set snapshots may include `transitionLogic` (definition version 6; versions 1–5 remain readable). It declares playout
slots, template states, shared component instances, transition timing and routes. Source archive
schema 6 preserves the definition; compatible storage writes archive schema 5. Archive layout and
Transition Logic version are independent. Shared targets currently
support numeric layer transforms; instance and source-layer IDs are explicit references.

Slots can opt into lifecycle dependency with `parentSlotId`, an existing slot ID. Dependencies
form a forest: missing parents, self references and cycles are rejected. **Transitions → Map**
labels this **Take out with**, with **Independent** as the default. Parent Out also animates active
descendants out using their own routes; parent Clear clears them immediately. Both reset descendant
active/prepared intent while retaining per-state editorial data. Taking the parent in again does
not revive descendants. A fresh dependent Take while the parent cascade is leaving is rejected;
wait for completion and take it explicitly. Parent selection, drawing order and make-room layout
are separate. Include `parentSlotId` in the complete definition supplied through MCP and preserve
it in `.ogs` source and coordinated exports. Playback requires a runtime supporting dependencies.

**Take conditions (version 4).** `parentSlotId` means **Take out with**; it does not require the
parent to be On for a new child Take. Use optional
`slot.admission:{requireOnSlotIds:[...],blockWhileActiveSlotIds:[...]}` when that condition is
intended. Require On lanes must finish entering and must not be leaving. Blocking lanes include
pending Takes, explicit preparation, entry, On and the complete exit. The coordinator rejects
before preparation/control/occupancy changes and rechecks admission before committing ready or
queued work. A rejected Take remains Off; it is not queued and does not activate its parent.
Out/Clear remain available, and Clear cancels preparation immediately. Unknown/self/duplicate IDs,
require-On cycles and a lane required both On and Off are invalid. For a headline-dependent header
or second line that must stay Off during Breaking:

```json
{
  "admission": {
    "requireOnSlotIds": ["headline"],
    "blockWhileActiveSlotIds": ["alert"]
  }
}
```

Use actual IDs from the set. **Transitions → Map → Take conditions** edits these optional lane
settings. Operator Takes in Preview & Export, MCP live playout, Rules and exported custom actions
share the guard; do not work around rejection by silently taking required lanes On. Test Take
attempts while the blocker prepares, enters and leaves, plus stale Prepare→Take and Clear.

**Template presets (version 4).** Optional `state.dataDefaults` supplies editorial data for a named
state sharing an existing template, for example SOURCE/DEVELOPING/BREAKING label and color choices.
A state's name alone never changes content. **Template presets** in the lane map enables overrides
per declared data field; colors use the standard picker and Booleans use checkboxes. Precedence is
template defaults, state preset, retained edits for that state, then explicit request data. Omit
`data` on a Take when the preset/retained values should apply; do not send a materialized full
template-default object that overwrites them. Initial selected-state and explicit context previews
preserve their own presets. Data is bounded JSON (64 KiB, 4096 values, 16 levels); export validates
field keys/types, nested schemas and constraints and packages preset image assets with that template.

Both features require `transitionLogic.version:4` or higher. Preserve that version when applying the complete
definition or saving/exporting it. Older v3 runtimes must reject the definition; lowering its
version would bypass the intended safety boundary. Compatible archive mode does not down-convert
guards or presets. Keep old v1–v3 definitions unchanged when these features are not authored.

For cross-lane takeover, set incoming `state.takeOutSlotIds` to existing lane IDs. In **Transitions
→ Map**, expand **Take out before entering** under that template and check the lanes. The
coordinator prepares the incoming state before changing output, takes those lanes and their
dependents out through their own routes, waits until they are Off, then enters the new state.
Other lanes stay on. Out does not restore the replaced lanes, and same-state updates do not repeat
the takeover. Editorial data is retained while active/prepared intent is reset. Missing, duplicate,
or self references are rejected, including a target whose Out would clear the incoming lane through
parent dependencies. Reciprocal policies are valid: give a normal headline its own policy targeting
Breaking for the reverse replacement. A reverse request may prepare during the prior exit barrier;
only successful readiness cancels the opposite pending entry. Failure/Out/Clear releases that pending
intent safely, and stale ready callbacks cannot restore canceled states. Preserve `takeOutSlotIds` in the complete definition sent through
MCP and in source/export round trips; playback requires a runtime supporting takeover.

Version 2 adds optional `layoutRules:[{id,name,slotId,whenSlotId,sharedOffsets}]`. Each numeric
x/y/width/height delta belongs to its target slot's shared instance and follows the observed slot's
actual entry/on-air/exit. Off contributes zero, replacements retain occupancy, and Prepare alone
does not change layout. Several rules may add to the same property: sample the baseline/state pose,
then sum each lane's timed contribution. Each shared instance still has one owning lane; duplicate
property entries inside a single rule remain invalid. Targets require baselines, finite combined
bounds and nonnegative dimensions across every baseline/state pose and simultaneous reservation.
Check all negative offsets together: an optional positive offset cannot make an otherwise unsafe
size valid. A leaving lane removes only its contribution while other lanes keep their adjustments.
The news example uses these rules to reserve 62 pixels for its scrolling ticker and restore that
space when the ticker goes out. Rules require v2 or newer so older runtimes reject unsupported semantics.

Version 3 adds optional recipe `layoutPhase:{startFrame,durationFrames}`. Both fields are nonnegative
integer frames and their sum must fit `durationFrames` of the transition. With a phase, observed
slot occupancy follows that phase and recipe easing: Off→state reserves space, state→Off releases
it; replacements/updates retain occupancy. This changes other slots’ responsive offsets, not the
recipe’s `sharedFrames` interpolation. Omit it to retain content-opacity timing. Prepare alone
never moves layout; Take/Out start the phase and Clear releases it immediately. In Studio, a phase
is the separate **Make room** row in a layer's Take in (**Make room first, then reveal**) or
**Restore room** row in its Take out (**Hide first, then restore room**). For example, reserve
space first, delay incoming content until afterward, and release space after content exits.

**Studio playout editor.** **Window → Transitions** opens the lane map; legacy
`?pane=transition-logic` links open this pane too. Select a lane in **Lanes** to inspect its templates, draw order and
components that morph automatically. **Every moment in this lane** is a matrix with source
templates/Off on rows and destination templates/Off on columns: Take in, Update, Switch and Take
out. A cell shows style, speed and timing bars; select **Open on stage** or double-click it to edit.
Expand **Checks and lane coordination** for cross-lane tools and checks.
Each moment resolves like the runtime planner: exact route, wildcard route by priority, slot
update/default transition, then definition default.

On stage, drag the timing bars or edit the inspector's style, speed, easing and durations. Make
room/Restore room maps to `layoutPhase`, old content to `outgoingFrames`, new content to
`incomingStartFrame`/`incomingFrames`, and element morphs to `sharedFrames`. Per-template overrides
copy recipes before changing them so unrelated moments retain their behavior. **Together on air**
edits how a pair of lanes reserves and restores space. Offsets require existing shared-instance
identities and numeric baselines; matching asset names alone is insufficient.

### Incoming and outgoing content animations (version 5)

Optional recipe `incomingAnimation` and `outgoingAnimation` select each side independently.
Omitting a side preserves its existing `contentMotion`/transition-style behavior. Choices are:

- `{type:"template"}`: play that side's authored layer tracks without another whole-content fade.
- `{type:"builtin",motion:{style,direction?,distance?,easing?}}`: use the existing Animate In/Out
  motion contract, excluding duration/offset. Recipe `incomingFrames`/`outgoingFrames` own duration.
- `{type:"plugin",reference:{id,version,sha256},presetId,parameters?}`: use an exact data-only pack
  from `definition.animationPresetPlugins`. Copy only an inspected source or human-installed
  snapshot; MCP does not install/trust plugins. Preserve pins in complete graph updates. Presets
  must support the requested side and rectangle wrappers, parameters must satisfy declared bounds,
  and normalized keys must fit the chosen frame count.

Built-in/plugin choices animate full non-shared content as one wrapper, not each object separately.
They do not rewrite source tracks or double-play their entrances/exits. Shared objects keep morph
and make-room behavior; same-instance score/text updates do not replay entrances. Use each object's
normal animation tools for independent/staggered motion. UI selectors expose applicable direction,
distance, easing or pack controls; duration stays in the existing phase timing rows.

A recipe can contain:

```json
{
  "incomingAnimation": {
    "type": "builtin",
    "motion": { "style": "slide", "direction": "up", "distance": 80, "easing": "cubic-out" }
  },
  "outgoingAnimation": { "type": "template" }
}
```

Keep `transitionLogic.version:5` for selectors or the pinned catalog. Versions 1–4 remain readable
without these fields; lowering the version is not a compatibility conversion. Compact schema 6
and compatible schema 5 archives retain the graph. Export bakes numeric wrapper tracks, so the
playout machine needs no installed animation pack or executable plugin code.

**Explicit resize.** In **Transitions → Together on air**, or **Resize objects…** from a transition,
choose a shared object, destination width/height and one of nine anchors. The selected template's
resting size becomes additive x/y/width/height offsets; the same delta applies to other templates
in the affected lane. Rotation and transform parents are currently reported as unsupported.
The width offset can retain authoring-only `resizeAnchor` metadata (top-left/top-center/top-right,
center-left/center/center-right, bottom-left/bottom-center/bottom-right); playback still uses the
ordinary numeric offsets. Start/duration edit the selected trigger template's enter or exit
`layoutPhase`, preserve other template routes, and extend the recipe length. Timings are shared
by that transition's layout adjustments. Reset clears only the selected object's four offsets.
The `.ogs` archive and coordinated export preserve these settings. Automatic Move up/Shrink tools
remain in **Automatic room** and replace the lane pair's adjustments when used.

**Elements that stay on screen** edits the layer's `sharedInstances` (owned through `slotId`, or
implied by state `sharedValues` or make-room offsets). **+ Keep a component on screen…** adds an
instance of a Template Set-scope component with baselines from the current templates. Its table
edits `initialSharedValues` (the Off column) and each state's `sharedValues`; an empty template cell
falls back to Off. Instances without a layer appear under **Elements for the whole output**.

Every edit is validated and commits at once as one undoable step; there is no Apply/Revert. Only an
older unapplied draft shows **Apply it**/**Discard it** and locks editing until resolved. Problems
that block playout are listed at the top. **Turn off playout transitions…** at the bottom of the
tab removes the definition as one undoable step, keeping templates and components. Save Template
Set writes the definition to `.ogs`.

**Rules** authors object behavior through a searchable left list and right-side editor. Template
lanes, moments, shared elements and make-room timing are authored in **Transitions**. Rules does
not list template playout items or offer template-transition events as object rule triggers.
**+ New rule** immediately creates and selects a data rule on the selected editable scene object,
or the first editable scene object. The existing factory creates a condition field when needed;
creation is undoable. The owning object is separate from each action's Target.
Object rules use Trigger (WHEN), Conditions (IF) and Actions (THEN) sections, preserving
When/Condition/Then/Action/Target order and collapsed Options/Timing. Actions offer **Show object**
and **Hide object** as separate choices (both `visibility`), **Toggle object visibility** on
events, and property, sound, media, shader-animation and custom actions. Object headers have
editable names, Active/Paused, Duplicate and Delete; overflow contains less-used commands. Numbered
object actions support move up/down, duplicate and remove. Later property writes win; media/custom
actions may overlap, so numbering does not create sequential asynchronous execution.
**Then → Playout** also offers **Take**, **Update**, **Out** and **Clear**, targeting a Lane and,
where needed, Template. They issue commands through the same coordinator without duplicating its
timing/dependencies. Take selects a state; Update only changes the current on-air state with an
optional state guard. Out animates dependent lanes, and Clear removes them immediately. See
[Rules playout actions](./visual-rules.md#coordinated-playout-actions) for data forwarding and
payload limits. Active playout rules require coordinated set preview/export.

A moment's ▶ Preview uses the current definition and unsaved template edits to show the combined
result in the existing **Preview & Export** viewport. Take in and Take out previews first seed the
layers this layer makes room in, then run the moment with persistent shared elements. It also works
fullscreen with the existing compact data controls; no extra mode selector is needed. Template
selection returns to ordinary template preview. This is an isolated authoring preview, not a command
to MCP live output or certification of an export. A preview snapshots its source; replay or request
it again after changes to view the updated definition.
Object-rule preview also opens Preview & Export. Explicit canvas simulation remains under the
object rule's overflow menu as Try on canvas; it is not the shared preview action.

MCP authoring uses `ograf_update_template_set` with `operation:{type:"set_transition_logic",definition}`
and the latest opaque set revision. Supply the complete definition object, including stable IDs, or
`null` to remove it. Graph rules and current template/component/source-layer references are validated
before one undoable change. An older unapplied UI draft must be applied or discarded first; MCP
never overwrites it. Removal or replacement with a different definition ID needs `confirm:true`; editing the same ID does
not. Payloads must be JSON-safe and fit 1 MiB, 32768 values and 32 levels. Loaded playout remains on its
previous snapshot until explicitly reloaded. Save the set through Studio's File menu after authoring.

Shared component changes also validate the prospective source library against the current graph.
Removing a source used by a shared instance, template state or resize target is rejected before
project/set/history publication, including connected MCP edits and Undo/Redo. Retarget or remove
those references in Transitions before changing the component's child selection; stable source IDs
are preserved when promoting an existing instance.

`update_component_from_layers componentId,layerIds` promotes one linked instance together with
selected new independent layers. New children join that source instance with their existing IDs;
other linked instances receive one corresponding child while retaining local overrides. Source
layer/field IDs, animation, bindings, masks and placement remain stable. An independent-only
selection becomes a new linked source instance. Locked selections, foreign component members and
multiple source instances are rejected atomically. Query the updated scene for child mappings;
the update does not return an insertion result for an existing source instance.

For persistent shared graphics, `instantiate_component` accepts an optional `instanceId` with
`linked:true`. Reuse that ID in different template compositions and the definition's `sharedInstances`
entry. A composition cannot contain two instances with the same ID. Use at most 256 ASCII
letters/digits/dots/underscores/colons/hyphens, starting with a letter or digit; reserved prototype keys
are rejected. Layer, field, group and key IDs remain generated. Raw identity maps are not public inputs.

Use **Help → Transitions example** to open the news example and download its editable `.ogs`.
The planner supports preparation/readiness, latest-pending requests, immediate Clear and persistent
shared graphics. The Transitions tab's **Export package…** and **File → Export Coordinated
Package…** create one certified `.ograf.zip` with the coordinator, referenced templates, canonical
shared sources and resources. Apply or discard an older unapplied draft before export. The source
set remains editable in `.ogs`; legacy `.ogp` cannot preserve coordinated definitions. Referenced
templates cannot be removed until their transition states are removed from the definition.

The exported graphic receives `{slots:{[slotId]:{stateId,data}}}`, with `stateId:""` selecting Off.
It starts Off; standard play/stop
take the selected states or take all slots Out. Slot custom actions are `transition.take`
(`{slotId,stateId,data?}`), `transition.patch` (`{slotId,stateId?,data}`), `transition.out`
(`{slotId}`), and `transition.clear` (`{slotId?}`). Use `transition.patch` for incoming feed values
on an existing graphic: it merges data without restarting lane transitions, retaining data Rules,
leaf text effects and continuous animation. Its optional state guard rejects a different active
state; Off/leaving targets reject. Standard `updateAction` and `transition.take` keep authored
update transitions, unless the lane sets `updateMode:"in-place"` (v6; see data-connections.md).
Scheduled patches replay at their recorded times during non-real-time seeks.
Generated startup selections form a compatible baseline in stable lane order: required-parent
children start Off and conflicting states are not selected together. These selections are separate from the custom
Take form's valid state suggestion. If a batch Play explicitly selects parents and children, the
coordinator validates the complete final intent, prepares resources before output changes, and
waits for required exits and fully On parents before later stages. Missing selected prerequisites
and conflicting selections return an error without changing on-air selections. Timing follows the
same shared clock in real-time and scheduled non-real-time rendering. A newer playout command can
supersede unfinished stages; those stages must not revive. Individual Take/Prepare still require
their parents already On and do not queue or activate parents automatically.
The coordinator exposes one On-air step: ordinary Play after it advances Out. Use
`playAction({goto:0})` to explicitly reapply selected On states.

Realtime Load privately prepares the valid selected startup scene while lanes remain Off. The
first matching Play reuses successful preparation after normal admission; this is not explicit
Prepare or an On prerequisite. State/data changes, superseding commands, reload and disposal
invalidate it. Invalid selections still fail at Play, and failed preparation is released for the
ordinary Play readiness/error path. Non-real-time playback keeps its existing behavior.

Realtime preparation also uses one bounded pool of pristine dormant template instances and shared
resource probes: at most four entries and an estimated 64 MiB. These are unused prepared resources,
never previously on-air mutable state.
Idle preparation can warm likely alternatives without advancing clocks, emitting lifecycle or Rules
events, firing alarms, reserving layout space, or making a lane count as prepared/On for admission.
A Take can adopt a matching template instance once; unactivated shared probes may return to the pool
after readiness. Canonical on-air shared renderers retain their separate lifecycle. Take still applies current data, checks admission and follows
the same authored transition, dependency and cancellation timing. Misses use ordinary preparation.
Load, disposal and owner-document changes invalidate the pool; evicted entries release resources.
The byte estimate is a cache budget, not a measured browser/GPU memory limit. Non-real-time replay
does not reuse this instance pool. Do not use cache warmth as evidence that a lane is On or an
otherwise blocked Take is allowed.
The optional runtime `getPreparationCacheSnapshot()` reports counts, estimated bytes, hits, misses,
evictions, limits and preparation activity. It is diagnostic information, not an OGraf lifecycle
method or operator selection.

`skipAnimation:true` removes authored transition waits, while resource, rendering and GPU work
still take finite time. In OGraf Devtool, use the complete exported multilane scene, await
successful Load, then time and await the first Play from Off. Check the response and capture ready output after
completion; measure warm replay separately. Recheck state/data changes and report the actual
template and host timings rather than a universal latency bound.
Check both Devtool's detached-element sequence and visibly mounted playback. The shrink-to-fit
fast path avoids redundant layout measurements for text that already fits while preserving the
previous fitted size, minimum-size behavior, font readiness and shader glyph coverage. Its
performance gain must not come from skipping Rules, transition timing or final-frame readiness.

Normal shader animation submits GPU work asynchronously. Exact-frame readiness, `goToTime` and
capture wait for GPU completion with asynchronous fences instead of a blocking wait on every draw.
Await the operation before inspecting pixels; this scheduling change does not shorten Rules delays,
transition durations or dependency barriers. See [playback performance review](./ograf-invariants.md#playback-performance-review)
for cold/warm and continuous-motion checks.

During real-time skip batch Play, prepared independent lanes in one dependency stage share a
final coherent frame and readiness pass outside nested Rules dispatch. Each lane retains its
request, ready and advance events. Rules run in order after stage readiness; parent Rules and
cancellation checks complete before a later child stage starts. Direct Take, animated playback
and non-real-time replay keep their existing paths.

Use `template.action` (`{slotId,actionId,data?}`) for an authored custom action or generated
clock/timer Start, Pause, Reset or Restart command on the lane's
active template. The public action ID is scoped by lane, so identical IDs in other templates do
not collide. Preview & Export exposes these actions beneath each active lane's controls.
The manifest declares defaults/data schemas and the package includes an operator guide with real
IDs. Custom-action lane/state fields are standard GDD dropdowns with readable labels and a matching
initial lane/state pair from the first populated lane. Standard JSON Schema `allOf` branches with
`if`/`then` restrict `stateId` to states in the selected `slotId` plus Off, and declare that lane's
default. A conditional-aware form host filters the state list and selects the new lane's default
when the operator changes lanes; `stateId:""` remains valid Off in every lane. In the local Devtool
integration, changing lanes selects its first state (or Off for an empty lane); choosing Off within
the current lane is preserved. Loading a valid supplied payload does not rewrite its state.
`template.action` and `loop.pause`/`loop.resume`/`loop.next` use labeled `actionId` and `groupId`
selects with defaults. Their lane lists include only lanes with executable template actions
(including generated clock/timer controls) or
timed loop groups; conditional branches narrow targets to that lane. Defaults use the first
supported lane in lane order and its first target. Each list is the union of relevant targets across that
lane's states, not a live list of the currently on-air template. Take the matching template on air
before submitting its action or loop command; the runtime checks the active template. If the set
has no executable template actions or controllable timed loop groups, the corresponding manifest
commands and duration entries are omitted. Untimed lifecycle loops are not controllable groups,
and timer controls use `template.action` rather than the loop commands. Start resumes; Pause holds;
Reset restores the initial value and pauses; Restart restores it and runs. System-clock/manual
sources ignore timer commands. Timer events use the shared playout clock for deterministic
non-real-time scheduling and backward/repeated seeking. See [clocks and timers](./clocks-and-timers.md#coordinated-template-sets).
Controllers that do not interpret conditional forms can retain the flat union dropdown. Select
matching lane/target IDs there; schema defaults alone do not change submitted values, and the
runtime still validates lane membership. The optional local OGraf Devtool integration is described
in the repository's `docs/guides/devtool-conditional-actions.md`.
Clear's form defaults to that lane; API callers can still omit `slotId` to clear all lanes. A standard
manifest `thumbnails` entry references a packaged PNG rendered from the frozen coordinated artifacts;
the thumbnail is included before exact-artifact certification and in the resulting package hash.
Non-real-time output supports scheduled actions and backward/repeated `goToTime` seeking.
Templates play authored per-layer IN/OUT tracks around their first on-air Step, including masks
and effects; retained shared elements morph without replaying IN. Independent loops/text effects
use the shared clock. Timed loop groups support hold-duration data and `loop.pause`, `loop.resume`,
`loop.next` with `{slotId,groupId}`; discover active IDs in the playout snapshot.
`recipe.contentMotion:"authored"` preserves the layer tracks without an extra whole-graphic fade.
Output dimensions and frame rates must match; unsupported features fail export before saving.
Coordinated Rules support data/change, pointer and once-per-entry hover, `play`, first-step `step`,
`stop` and custom-action triggers, with event-rule command delays, template-local data writes,
custom-action chains, animated Rule properties and custom-action Text FX. Pointer input is
real-time only. Audio/media cues, shader/media Rule side effects, custom-action loop activation
and loops activated at later steps remain unsupported.
Runtime packages cannot be reverse-imported
as complete template sets; preserve the original `.ogs`.
Use `ograf_export_coordinated_package` for coordinated file output. First read
`ograf_get_template_set` and pass its `expectedRevision`, an explicit `profile`
(`realtime`, `non-realtime`, or `dual`), workspace `.ograf.zip` path,
`confirm:true`, and a unique `operationId`. Request `overwrite:true` only after
replacement is authorized. The tool snapshots current unsaved artwork and the applied graph;
unapplied drafts and source changes during certification are rejected. It uses Studio's
coordinated compiler and exact-artifact certification, then verifies the transferred bytes,
writes them transactionally, and verifies the saved hash. It reports included template/state IDs
and unreferenced templates; never silently add an unreferenced template to the graph.

On an uncertain response, reuse the same operation ID and identical arguments. IDs are retained
for this server process (up to 32 exports); concurrent retries join the existing operation,
completed retries recheck the output hash, and write retries reuse retained certified bytes.
Do not restart the server to recover an uncertain export. After restart, inspect the output and
hash before intentionally creating a new operation. Failures retain outcome, stage, and details.
Studio chooses its destination before certification and offers **Save Certified Package Again**
to retry unchanged certified bytes. A browser download request does not verify disk delivery.

MCP live controls are available as described below. Ordinary
`ograf_export_package` still exports only the active composition, without the set coordinator.

## Template preview

Studio's **File → Open Recent** and welcome screen share up to ten recent local file/URL references
for standalone templates and sets. Reopening reads and validates the source before replacement;
cancelled/failed opens do not enter history. File access may require a fresh browser permission.
This editor-local history is not embedded in `.ogs` files or OGraf exports.

**Preview & Export** normally follows the template selected in **Templates**. A playout moment's
▶ Preview temporarily shows the combined output in the same viewport; template selection
returns to ordinary playback and data controls. Previous/next controls update the same authoring selection and
follow the document's template order; use **Templates** to change that order. Navigation is manual.
A template's own loops and animations continue normally. Older optional `presenter` metadata is preserved for file
compatibility but does not determine preview order or advancement.

Switching templates automatically loads the selected composition. Editing the composition rebuilds
its preview. Playback uses the ordinary native In/Out lifecycle, with separate previous/next Step
controls. Existing live MCP commands target their independent coordinated session.

Data fields use native controls below the docked preview, including checkboxes for Boolean fields
and the standard color picker with editable hex for color fields. Each fullscreen entry starts with
the controls hidden.
Right-click the fullscreen output to open or reposition the controls at the clicked location,
clamping the pane within the viewport. Drag its header to reposition it. Clicking outside or pressing
**D** outside editors hides the panel; **Escape** exits fullscreen. Remove the duplicate Show/Hide
Controls and Exit Preview toolbar. Previous/next template navigation remains available.
The popup uses a subtle 2 CSS-pixel backdrop blur confined to its background. The surrounding output
and controls stay sharp; no filter is applied to the graphic, presentation media or guides.
Editing clears the pane's backdrop blur together with its transparent background. This never changes
exported pixels or playback timing; docked controls do not blur output.
The pane background is 15% transparent; rows are 10% transparent by default and fully opaque on hover.
Native dropdowns, multi-selects and ARIA combobox/listbox controls never isolate their row or hide
the rest of the panel. They keep normal focus, keyboard selection and native menu behavior.
During a focused text/numeric/color edit, make the edited row fully opaque while retaining focus
and editability. Every other control and the pane background are 100% transparent until editing finishes.
Treat a color picker's swatch, hex and alpha controls as one row, and avoid compounded opacity
through nested containers. Focus leave, edit commit or cancel restores the normal appearance.
Hiding the panel or exiting fullscreen also clears the editing state. Replace the browser context menu inside fullscreen output
only; native operating-system picker/popover menus are outside this DOM boundary. This behavior
applies to single-template and coordinated previews, is informational MCP guidance, and is never
exported.
With Transition Logic enabled, it also provides per-layer template selection and Take/Out,
plus Pause/Resume, Replay and Clear all for the same isolated coordinated preview. Replay uses
the latest valid draft; other groups keep playing during individual takes. These controls do not
command the independent live/MCP session. Preview data edits belong only to its runtime session.
**Take In** and **Take Out** control
the selected template. **Back** and **Next** move through its native steps. **Preview** in the main
menu reveals this pane and enters fullscreen.

Left/Right visit the selected template's Steps before switching templates at a boundary. Forward
navigation enters the next template's first Step; backward navigation enters the previous template's
last Step. Navigation stops at the ends of the set. Space retains native lifecycle advance/Take Out,
and editable controls keep their own keys. Template arrow buttons still switch templates directly.

Save editable `.ogs` through **File**. **File → Export…** opens the selected template's export
settings. File also provides coordinated-set export or an archive of independent template packages.
Exported graphics do not include Studio's preview navigation or data panel. Preserve `.ogs` for
editing. Legacy `.ogp` export rejects unsupported metadata instead of dropping it.

## Live playout

Discover `templateSets.transitionLogic.livePlayout` and `editor.playoutReady`. Studio must stay
connected. MCP `load` snapshots the applied graph/current template edits and starts Off. Authoring
edits and template selection do not replace that session. It remains alive while Studio is open.
Loading again returns slots to Off; Unload disposes output and cancels pending loading. This MCP
session is independent of the selected-template preview.

1. Call `ograf_get_playout` for `sessionId`, `revision`, states, slot readiness and recent commands.
2. Call `ograf_control_playout` with the exact playout `expectedRevision`, a unique `requestId`, and
   one operation below. The response acknowledges admission, not animation/resource completion.
3. Read again until the request is completed/failed or the intended slot is ready/on air. After an
   uncertain response, reuse the original ID/operation; do not automatically generate a fresh take.
   Detailed receipts retain 256 commands; older IDs are rejected rather than executed again.

| Operation         | Additional fields                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load`            | none; explicitly snapshots the currently open applied set                                                                                                                  |
| `prepare`         | `slotId`, `stateId`, optional `data`                                                                                                                                       |
| `take`            | `slotId`; optional `stateId` and `data` for a direct take, or omit them to use prepared data; optional `preparedRequestId` guards that exact preparation                   |
| `update`          | `slotId`, `data`; optional `stateId` guards the active state; `mode:"in-place"` patches without a lane transition; omitted mode or `"transition"` retains authored updates |
| `template-action` | `slotId`, `actionId`, optional `data`; runs an authored action or generated timer command on that lane's active template; discover IDs in `templates[].customActions`      |
| `out`             | `slotId`                                                                                                                                                                   |
| `clear`           | optional `slotId`; omission clears all slots immediately                                                                                                                   |
| `unload`          | none                                                                                                                                                                       |

Preparation does not change on-air data. Take prepared consumes its exact resource/data snapshot.
Clear and Unload bypass running transitions. Commands use JSON-safe data bounded to 64 KiB/4096
values/16 levels. Large state data may be omitted from inspection (`dataOmitted:true`). The command
revision is independent of the source/project revisions; progress frames do not change it.

## Commands

### Settings scopes and storage

**Settings & Preferences** is one searchable window with **OGraf Studio**, **Template Set** and
**Template** scopes. File → Preferences opens Studio workspace preferences; the Templates gear
opens the set defaults; **Template Settings…** in the template context menu or Properties opens
the active template controls.
Search filters scope/category names and setting keywords. Studio workspace startup, preset and
detached-window reopening preferences save immediately in the local user profile, outside `.ogs`.

Template Set output, data transitions, canvas/snapping and inheritance defaults are a draft until
**Apply** or **OK**; save the set `.ogs` after applying. Template scope reuses composition Properties
for output/timing, background, canvas and guides. Those edits apply immediately, are undoable and
belong to canonical project/composition data saved in the template or set `.ogs`. Closing settings
does not roll back immediate template or Studio changes; unapplied set drafts are discarded.
Existing per-property overrides and Reset, whole-template opt-out and resolved standalone source
remain the same authoring contract.

Canvas/source crop temporarily hides Settings; crop Apply or Cancel restores it with pending
Template Set drafts retained.

Read `editorParity.settingsScopes` in the `editor` capability section for the routes and storage
boundaries. Use existing `ograf_update_template_set` operations `set_defaults`, `set_inheritance`
and `set_setting_override` with the opaque set revision. Template values use ordinary
revision-checked `ograf_apply_operations` such as `set_composition`, `set_composition_layout`,
`set_project_metadata` and canvas-guide operations; rich backgrounds keep their existing
background/style workflows. There is no separate settings mutation model.

Coordinated export still requires matching effective output width/height, including canvas crop,
and frame rate across every state. Local output overrides are available, but incompatible values
must be resolved before coordinated export. Standalone template saves and graphic exports hydrate
resolved ordinary settings and resources; local Studio workspace preferences are never exported.

### Template-set operations

The update tool accepts one `operation` with these `type` values:

- `create`: optional `name`; starts a set from the current template. Replacing an open set needs `confirm:true`.
- `new_template`: optional `targetTemplateId`, `side:"before"|"after"`; creates a blank member.
- `duplicate_template`, `copy_template`, `remove_template`, `activate_template`: `templateId`.
- `paste_template`: optional `targetTemplateId`, `side`; uses the editor template clipboard.
- `rename_template`: `templateId`, `name`; `rename_set`: `name`.
- `reorder_template`: `templateId`, `targetTemplateId`, `side`.
- `undo_remove`: restores the last removed template. Removing the final member leaves an empty set.
- `set_defaults`: partial `patch`, optional `inheritance:{templateId:boolean}`.
- `set_transition_logic`: complete `definition` object or null; see validation and draft rules above.
- `set_inheritance`: `templateId`, `inherit`.
- `set_setting_override`: `templateId`, `key`, `override`; pins/resets one setting. Keys are
  top-level settings or `layout.KEY`. Values remain in the editable child project.
- `set_brand_kit`: `brandKit:{name,tokens}`; explicitly adopts a typed master kit.
- `upsert_brand_token`: complete `token:{id,key,name,type,value,description}`.
- `remove_brand_token`: `tokenId`; linked uses must be removed first.
- `set_brand_token_override`: `templateId`, `tokenId`, `override`; pins/resets a shared token.
- `upsert_brand_style`: `kind:"typography"|"background"`, complete `style`.
- `remove_brand_style`: `kind`, `styleId`; detach uses/default selection first.
- `set_brand_style_override`: `kind`, `templateId`, `styleId`, `override`.
- `apply_typography`: active-composition `layerIds`, `presetId` (null detaches).
- `reset_typography_property`: `layerId`, `property`.
- `set_background_style`: `styleId` (null restores solid color), `asDefault:true` for the set default.
- `set_background_paint`: complete `paint`; null removes the rich output paint locally.
- `reset_background`: restores inherited selection/paint for the active composition.
- `set_control_value`: `controlId`, JSON `value`.
- `bind_control`: `controlId`, `templateId`, `compositionId`, `fieldId` (null unlinks).
- `bind_asset`: `slotId`, `templateId`, `compositionId`, `templateAssetId` (null unlinks).
- `set_asset_slot_source`: `slotId`, `assetId` (null clears).

Removal needs `confirm:true` and user authorization. Copy/duplicate preserve same-set inherited
links and create independent template/project/composition identities. Cross-set paste keeps resolved
content/assets locally. Names are made unique; IDs remain stable through rename and reorder.

Defaults cover the main canvas size, frame rate, background, render modes, data fades/interruption,
rulers, safe-area display, snapping, grid/snap distance, and canvas bounds. Existing, new, and inserted
members inherit by default. Every supported setting stays editable: an edit creates a per-property
override, and Reset restores inheritance. Explicit override presence, not equality to the master,
decides whether later master changes propagate. Whole-member opt-out remains available.
Media/audio retain their required real-time profile. Resizing respects layer constraints; each member
keeps its own guides, folders, crops, and animation frame/easing identities.

The optional set-owned `brandKit` shares primitive color, number, text, font-family and font-weight
tokens. Stable IDs survive key renames. Explicit adoption maps compatible semantic keys, never
display names; incompatible key collisions fail atomically. Template `brandKitOverrides` pin token
values. Object `designTokenBindings[].overridden:true` retains the reset source while preserving a
designer's locally authored value; `bind_design_token` restores a live binding. `update_element`
and Properties edits mark affected token bindings as overridden. Runtime data/animation precedence
is unchanged. Token creation alone does not bind every object.

The UI offers Brand Kit scopes **Template Set** and **This template**, origin badges and Reset.
Shared font assets are embedded in resolved child projects. Generated CSS is a safe custom-property
view of typed tokens, not arbitrary selectors or a runtime stylesheet dependency. Set `.ogs` preserves
the master/override metadata; standalone saves and OGraf exports keep resolved ordinary values and
assets. The generated view includes safe typography/static-paint variables; shader/media paints
are rendered by OGraf, not CSS. See the portable storage contract below before saving source files.

`brandKit.typography` entries are `{id,name,properties:{fontFamily,fontSize,fontWeight,lineHeight,
letterSpacing,textAlign,textTransform}}`. Names/IDs identify combined styles, not layer content.
`layer.typographyBinding:{presetId,overrides?:TypographyProperty[]}` tracks explicit object overrides.
Applying a different preset replaces typography-owned primitive token links only; palette bindings,
rich runs, transforms and animation survive. Designer/MCP element edits mark only affected preset
properties. Bound field defaults update with the style; operator/runtime values keep their precedence.

`brandKit.backgrounds` entries are `{id,name,paint:Paint}`. `defaultBackgroundStyleId:string|null`
sets the main-composition default; omitted leaves existing selections alone. Templates store
`typographyOverrides`, `backgroundOverrides` and `backgroundOverridden` independently. Compositions
hold resolved `backgroundPaint`, optional `backgroundStyleId` and `backgroundPaintOverridden`.
Reset removes local pins, not the reusable style. A synthetic full-canvas rectangle compiles below
artwork and shares ordinary shader/media clocks; it is not a selectable authoring layer. Media is
muted and real-time-only, live tags retain ZeroDensityHTML requirements, and webcams never autostart.
Shared font/media assets and notices are included in standalone output. Presentation backgrounds
remain editor-only and are not these output paints.

After activation/default changes, read `ograf_get_project` for the new numeric project revision
before applying layer operations. UI Open sniffs JSON or ZIP `.ogs` and also accepts legacy `.ogp`.
Save Template Set writes `.ogs`; MCP project file APIs remain standalone JSON. Older JSON-only
`.ogs` readers cannot read set archives, and
other newer features are not down-converted. Set file dialogs remain UI actions, not playout export.

## Portable set storage

Compact `.ogs` sets use archive schema **6**. A set stores identical font/resource bytes and its set
component sources once, with per-template references. Studio validates references and hydrates normal
editable projects on open; layer/component/asset IDs, instance overrides, bindings and animation remain
unchanged. This is storage deduplication, not implicit component linking or editorial data sharing.
Different payloads must never be merged because filenames or display names match. Imported legacy
sets remain readable; Studio saves use compact storage. Compatible storage can be requested through MCP.

Single-template `.ogs` saves, copies across sets, and OGraf exports must use fully resolved projects
with fonts, resources and component sources embedded. Compact member sources extracted directly from
the ZIP are not standalone templates. Never hand them to project open/save/export without hydration.
Use Studio's **Save Template**, **Export All Templates…**, or a hydrated MCP project snapshot instead.

For older set readers, compatible storage retains the schema **5** archive layout.
This preserves set metadata and component links; it can be larger and does not down-convert newer
features. Current Studio opens schemas 1–6. An older reader that does not support Transition Logic
v4 cannot play guarded/preset definitions even inside a compatible schema 5 archive. JSON-only `.ogs`
readers cannot open a set ZIP; existing legacy `.ogp` files can still be opened, but cannot preserve
coordinated transitions.

MCP `ograf_save_template_set` takes `expectedRevision` from `ograf_get_template_set`, a
workspace-confined `.ogs` `path`, `confirm:true`, optional `archiveMode:"compact"|"compatible"`
(default compact), and optional `overwrite:true` only when replacement is authorized. It serializes an
immutable complete set snapshot through Studio's save worker. An edit during generation rejects the
save before disk writes. Returned metadata includes `revision`, `archiveMode`, `schemaVersion`,
`archiveBytes`, `templateCount` and `sha256`; archive/base64 content is not returned to the caller.
Saving a source copy does not rename the open document or certify playout output. The compressed MCP
transfer limit is **64 MiB**; larger sets use Studio Save Template Set. Standalone
`ograf_save_project` and `ograf_export_package` retain their ordinary certification requirements.

Studio and MCP single/coordinated `.ograf.zip` exports include a supplementary self-contained
HTML preview named after the template or set, generated from the certified graphic files.
The HTML preview uses Studio-style compact Playout Controls while retaining left/right docking.
Its default-on **Show FPS overlay** is presentation-only: **Preview FPS** measures browser
animation-frame cadence, while non-real-time **Render FPS** counts completed render samples.
Neither is the authored frame-rate setting or a GPU throughput measurement. Sampling resets for
hidden/offscreen previews and releases its listeners/RAF on disposal. Studio shares the same
preview-only diagnostic in ordinary, coordinated, fullscreen and detached surfaces. It does not
change project source, graph timing, graphic modules, manifests or thumbnails.
Studio prepares/certifies/packages coordinated output before opening a destination. If browser
activation expires, the ready dialog requires a fresh Save or Download click using the retained
certified bytes. Never open a picker before preparation or report a merely prepared ZIP as saved.
Extract the whole archive before opening its HTML file; it automatically loads that graphic,
offers playback, data and declared custom-action controls, and presents coordinated lanes where
applicable. Selecting a lane's template immediately shows only its fields. Other templates' forms
and template-specific actions stay hidden until selected; on-air action targets do not change.
When lane controls are available, they own the data form even before the first Take; do not also
render a second generic Current template form. Standalone and editor-synchronized previews keep
their own data controls.
Coordinated lane data is scoped to its state: edit the selected on-air template's fields or
stage the selected **Next** state before Take, without mixing values between states or replacing
untouched state presets. Only exposed OGraf fields are included in the offline player. The export
preserves the original OGraf manifest, module and resources for playout;
embedded preview bytes increase package size. Export fails instead of overwriting an existing
case-insensitive resource matching the generated HTML filename. Filenames are sanitized for portable
extraction; do not assume the preview is named `index.html`. The playout controls dock left or right
and reserve space beside the fitted graphic. The presentation controls provide solid/checkerboard,
local image/video and webcam backgrounds, plus EBU R95 action-safe (3.5%) and title-safe (5%) guides.
These are preview-only overlays and never modify the certified graphic or its timing. Hide controls
to use the whole screen; right-click or D restores them. Only open trusted graphic code.
Offline browser playback still depends on graphics features, user media permissions and external network sources; validate
the actual extracted page in its target browser and do not claim full feature parity from a package
certificate or an HTTP-only test.

Single and coordinated exports include the Studio playback runtime license at
`licenses/OGRAF-STUDIO-AGPL-3.0.txt`; the module and offline preview refer to this one copy.
Independent-set bundles include a copy at their root and in each independently distributable
child ZIP. Preserve separate third-party and asset notices; this notice does not relicense user artwork.

Real-time and Dual exports can load their ordinary preview HTML directly in a compatible ElectroNode,
without registering a preset or selecting `nodos.html`. The page declares exposed native data inputs
and named live texture inputs through `nodos-inputs`; matching case-sensitive slots must already exist
in the host. Nodos playback loads and plays on a transparent output with browser controls hidden;
ordinary browser playback retains its controls. Certification does not verify the companion Nodos
host, typed pins or live textures: test those installed targets separately.

In Studio, select one unlocked visual object, then use **Resources → Media → Use input here** beside
the webcam controls, or **Fill → Live input**. This writes that object's own fill with Undo instead of
creating a playback cue. Input names must satisfy both Media source-tag and Nodos pin validation.
Routing never starts camera capture; **Start webcam** remains an explicit local action.

## Website playback of exported graphics

For a tutorial or website, the dependency-free browser module
`packages/ograf-web-player/ograf-player.js` mounts an actual OGraf graphic using its hosted manifest
URL. Export and certify the graphic first, then extract the `.ograf.zip` to a web-served folder with
its manifest, module and resources in their original paths. The player does not open `.ogs` sources
or extract ZIPs; it does not replace Studio export or create an MCP playback operation.
`packages/ograf-web-player/demo.html` demonstrates the integration. Use
`mountOGrafGraphic({container, manifestUrl, data?, renderCharacteristics?, allowCrossOrigin?})` and
its returned `play`, `next`, `stop`, `update`, `action` and `dispose` methods; inspect the package
README for their arguments. A coordinated export is a single OGraf graphic: inspect its manifest
schema and declared custom actions for lane controls rather than mounting its templates separately.

Serve the module and extracted graphic over HTTP(S), with proper JavaScript MIME types and CORS for
explicitly permitted cross-origin URLs. Treat a package as executable JavaScript, not safe data; this
player does not sandbox it. Use trusted exports, or a separately isolated origin and narrowly scoped
messaging for untrusted packages. WebGL, camera and audio permissions, and live-data availability
depend on the host browser and its policies. Test both single and coordinated packages against the
real host; a certified export or screenshot alone does not establish website playback.

Shader and Media text masks track ancestor inline visibility/display, class and `hidden` changes,
and owner-window viewport changes. A host that changes visibility only through stylesheet/CSSOM
mutation or a media-query change at an unchanged viewport must remount the graphic (or reload the
page) to refresh its mask cache.

## Three crop scopes

Studio edits all crop scopes directly on the canvas with edge/corner handles and a crop toolbar.
Choose **Crop** for selected layers or groups, **Crop Source** in image/media properties, or
**Properties → Composition → Crop Canvas** with no selection. **Enter / Apply** commits one undoable
edit; **Escape / Cancel** discards the draft. Component source editors temporarily hide during source
crop and resume afterward. There is no separate crop popup; MCP crop operations remain unchanged.

**Layer:** `set_layer_crop` trims any visual layer without stretching it. The default `coordinateSpace`
is `layer`, with normalized 0..1 `{x,y,width,height}` inside its full frame. `crop:null` resets.

```json
{
  "type": "set_layer_crop",
  "layerId": "layer-id",
  "crop": { "x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8 }
}
```

For a group, use the same canvas-pixel rectangle in one operation per group member with
`coordinateSpace:"composition"` and an explicit `frame`. The renderer retains a rotation-aware local
crop for each member. Crops follow subsequent member transforms and remain independent of wipe tracks.

**Source:** images/sequences use `update_element.patch.crop` with normalized fractions, optional
positive `sourceAspectRatio`, and `fit:"contain"|"cover"|"fill"`. `crop:null` resets an image source.
A Media Cue's complete `visual` object can include the same `crop`; omit it when resetting. Preserve
`targetLayerId`, `fit`, `positionX`, and `positionY` when replacing that object. Source fitting operates
inside the layer's existing frame; assets are never rewritten.

**Canvas:** `set_composition.crop` is a non-empty whole-pixel rectangle inside the authored canvas.
It changes capture/export dimensions and viewport origin. `crop:null` restores full output.

```json
{ "type": "set_composition", "crop": { "x": 100, "y": 50, "width": 1280, "height": 720 } }
```

Use normal revision-checked `ograf_apply_operations` preview/apply for crop batches. Inspect a real
browser composition capture, especially with shaders, live/video content, masks, and effects; SVG-only
rendering cannot establish their pixel parity. Clip/source assets and template output still require
their ordinary validation and certification before file output.
