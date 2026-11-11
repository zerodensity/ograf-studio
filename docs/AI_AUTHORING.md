# AI authoring

[Back to overview](../README.md) · [Using Studio](USER_GUIDE.md) · [Server setup](DEVELOPMENT.md#run-the-mcp-server)

## Template sets and cropping

The connected editor exposes `ograf_get_template_set` and `ograf_update_template_set` for set `.ogs`
structure, template duplication/clipboard operations, shared defaults/inheritance, and control/asset
links. Set commands use the opaque set revision from the read tool; layer batches use the separate
numeric project revision. Re-read the active project after activation or set-default changes.
`ograf_save_template_set` saves the whole connected set to a workspace-confined `.ogs` path using
its opaque `expectedRevision`, `confirm:true` and optional `overwrite:true`. `archiveMode:"compact"`
(default, schema 6) stores shared fonts, resources and component sources once; `"compatible"` writes
the schema 5 archive layout for older set readers without down-converting newer features.
The compressed MCP transfer limit is
64 MiB; open the set in Studio and use File → Save for larger sets. The tool saves a snapshot copy without
renaming the open document or changing its revision; an edit during generation fails before writing.
Open `.ogs` and Insert Template remain visible file actions; legacy `.ogp` and archive schemas 1–5
remain readable. MCP project open/save use standalone JSON source with resolved dependencies.
Never extract a compact member and pass it to standalone save/export without hydration.

Crop any visual layer with `set_layer_crop`; normalized layer fractions and canvas-pixel group
coordinates are distinct. Image/sequence source crops use `update_element.patch.crop`; Media Cues
accept `visual.crop`. Output canvas cropping uses `set_composition.crop` in whole pixels. Null resets
layer/canvas/image crops. See the [authoring reference](../skills/ograf-authoring/references/template-sets-and-crops.md)
and [generated contracts](generated/mcp-contracts.md) for exact input shapes.

## Operator field verification

For coordinated exports, discover `templateSets.transitionLogic.exportStartup`. Generated startup
defaults select a compatible baseline, leaving prerequisite-dependent lanes Off and excluding
conflicting state combinations.
Custom Take form suggestions remain separate. Exported `playAction` preflights the complete
selection and prepares resources before committing dependency-ordered stages on the shared
playout clock. Select required parents explicitly; individual Take commands still require them
already On. Reject conflicting batches before output changes, and verify rejected calls preserve
on-air selections. A newer playout command supersedes unfinished stages. Test successful default
Play, explicit parent/child startup, conflicting selections, and scheduled replay; a structurally
valid numeric error status is not successful playback. `goto:0` reapplies the coordinator's sole
On-air step; ordinary Play advances to Out after it.

`ograf_validate_project` accepts `dataFieldUsage:true` for a browser-free, read-only field-reference
audit. The default summary reports unreferenced fields, guide-only bindings and hidden-only bindings;
`detail:"full"` includes all fields with their stable reference owners and authored visibility flags.
The audit recognizes bindings to any supported target, Rules, modifier field sources, collections,
loop timing and data connections, while ignoring retained component baselines. It does not remove
fields or change validity, revision, certification or the source document.

These are advisory references, not a guarantee of visible output. A hidden layer can legitimately
drive geometry or a matte, and Rules or transitions can reveal it. Verify exposed text and colors
with distinct values in the exported graphic's actual preview. Capture crawl repeat boundaries and
dependent resize/takeover transitions as well as settled frames; a valid manifest cannot prove
editorial behavior. See [export playback review](../skills/ograf-authoring/references/ograf-invariants.md#export-playback-review).
MCP PNG/strip captures verify requested frames; they do not measure real-time switching latency.
For modifier playback, also review fullscreen switching and the actual exported package using
the [modifier data and lifecycle cases](../skills/ograf-authoring/references/modifiers.md#modifier-example-playback-review).

Continuous ticker text uses `update_element.patch.crawl:{speedPixelsPerSecond,gap,direction}`;
`crawl:null` removes it. The runtime repeats measured bound text, with a composition-pixel gap and
graphic-clock motion, so updates do not retain a fixed empty travel distance. Existing crawls retain
this behavior. New `create_ticker` recipes use the native mixed-content ticker, with safe Next
appearance updates, transparent edge fades, RTL text, images, animations and shaders. See
[broadcast recipes](../skills/ograf-authoring/references/broadcast-recipes.md) for all six updated
starters and linked asset behavior, and [ticker controls](../skills/ograf-authoring/references/loop-controls.md#continuous-tickers)
for legacy limits and migration from an authored single-copy x-loop.

## Component source updates

`update_component_from_layers` takes `componentId` and `layerIds`. Select members of one linked
instance plus any new independent layers to promote the edited content. New layers join that
instance without changing their IDs; other instances receive one corresponding child. Canonical
source/field IDs remain stable, and local bindings, animation, placement and overrides survive.
Selecting only independent layers makes them a new linked source instance of the chosen asset.
Locked selected layers, foreign component members and selections spanning multiple instances are
rejected atomically. Read the updated project or query the scene for inherited child mappings;
updating a source does not return an insertion result for the existing source instance.

The connected editor checks shared component edits against the template set's current Transitions
definition before publishing either document. Remove or retarget references to a source layer in
Transitions before removing it from its component. Rejected edits leave project, set and Undo
history intact. This set-level guard also covers connected MCP changes and Undo/Redo; a standalone
project session has no external template-set graph to validate.

## Conditional geometry in Rules

Use a `property` action with `targetProperty:"layer.x"`, `"layer.y"`, `"layer.width"` or
`"layer.height"` to set an absolute pose channel in pixels. The older bare names `x`, `y`, `width`
and `height` remain readable aliases and affect real geometry. Values must be finite; width and
height cannot be negative. Existing `layer.offsetX` and `layer.offsetY` remain additive.

Rule geometry overrides the sampled animation while its result is active, then ordinary layout,
modifiers, masks and crops operate on that pose. Explicit coordinated shared-element pins retain
priority. A data-state rule releases its geometry when it stops matching; event results persist
until another rule replaces them. See the [Rules reference](../skills/ograf-authoring/references/visual-rules.md).

## AI Assistant

OGraf Studio includes an **AI Assistant** tab beside **Layers** in the left sidebar. The model loop runs in
the local server process and drives the same canonical, revision-checked tool records as MCP. The
browser receives only redacted chat/tool/usage events: provider credentials never enter renderer
JavaScript, WebSocket frames, project files, or local usage storage.

### Choose a connection

| Provider                  | What you need                                                          | Setting                                  |
| ------------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| Codex                     | Installed Codex CLI, signed in with your account                       | `OGRAF_AGENT_PROVIDER=codex`             |
| Anthropic Claude          | Anthropic API key, API access and a model ID available to your account | `OGRAF_AGENT_PROVIDER=anthropic`         |
| OpenAI-compatible service | Its endpoint, model ID and API credential                              | `OGRAF_AGENT_PROVIDER=openai-compatible` |

Configure the process that runs Studio's server, then restart that server. Open **AI Assistant**
and check the displayed provider and model. Only one provider is active at a time.
Studio currently does not connect the built-in assistant through a Claude subscription or Claude
Code sign-in. External AI clients can connect separately through MCP; see below.

### Codex

Install the Codex CLI and run `codex login` if you are not already signed in.
Studio uses that sign-in through the Codex App Server; it does not need a separate API key when
Codex is signed in with ChatGPT.

For the Windows executable, run from its folder:

```powershell
$env:OGRAF_AGENT_PROVIDER = "codex"
$env:OGRAF_AGENT_MODEL = "default"
.\OGrafStudioServer.exe
```

For a source checkout, use:

```powershell
.\scripts\startCodex.ps1 -RestartMcp
```

The source launcher saves non-secret Codex settings locally for `startAll.ps1`.
The default model follows Codex's configuration. Set `OGRAF_AGENT_MODEL` to choose another model,
and `OGRAF_CODEX_EXECUTABLE` if Codex is not on PATH.

### Anthropic Claude

Use a Claude Console API key and an API model ID available to your account.
Enter the key privately in PowerShell, then launch the server from the same window:

```powershell
$env:OGRAF_AGENT_PROVIDER = "anthropic"
$env:OGRAF_AGENT_BASE_URL = "https://api.anthropic.com"
$env:OGRAF_AGENT_MODEL = "your-model-id"
$key = Read-Host "Anthropic API key" -AsSecureString
$env:OGRAF_AGENT_API_KEY = [System.Net.NetworkCredential]::new("", $key).Password
.\OGrafStudioServer.exe
```

For a source checkout, replace the last line with `npm run mcp:start` and run the editor with
`npm run dev`. Use these direct commands when switching from Codex: `startAll.ps1` restores a
previously saved Codex configuration. Do not start a second server on the same port.

To store the key in Windows Credential Manager instead of the process environment, run
`npm run agent:credential -- -Provider anthropic` from a source checkout. Studio checks
`OGraf Studio/anthropic` before `OGRAF_AGENT_API_KEY`; update that stored key if it is outdated.
Credentials stay on the server and are not included in project files.

For an OpenAI-compatible service, use `openai-compatible` and that service's base URL, model ID
and credential. Do not use Anthropic's endpoint with that provider setting.

### Connection checks

- **Not configured:** API providers require provider, base URL, model and credential settings.
- **Wrong provider:** restart the server with the intended settings; refreshing the browser alone
  does not change the server's configuration.
- **Authentication or model error:** check the active account/key, API access and exact model ID.
- **Image references:** choose a model that supports images and tool use.

Optional server settings include `OGRAF_AGENT_CREDENTIAL_TARGET` for a different credential-store
entry and `OGRAF_AGENT_TIMEOUT_MS` for request timeout (default 120000 ms).

The panel reports per-message, per-session, and cumulative-per-project token usage; cumulative usage
is browser-local metadata keyed by project ID and is deliberately excluded from `.ogs`.
It also reports recent external MCP activity. An optional session-local exclusive toggle prevents
the in-app and external agents from authoring at the same time; optimistic revision checks remain
the normal default when that toggle is off.

AI Assistant uses one updating status line for model activity, tool commands and proposal readiness.
Intermediate steps do not add conversation rows or scroll the transcript. The final reply and its
usage appear once when the turn finishes. Disconnects and provider timeouts report an error and
leave the assistant ready to retry.

AI Assistant conversations are isolated by project ID. Studio plans each model request against the
selected model's context capacity, including tool definitions, instructions, image estimates and
space for the reply. Advertised model metadata is used when available; otherwise Studio reports an
estimated fallback, which can be overridden with the model's documented capacity. Token counts are
estimates, not billing measurements.

Large tool results are returned as complete JSON pages instead of cut-off JSON text. The assistant
can retrieve more fields, array items or long string chunks with `ograf_read_result_page`. Older
conversation turns remain retrievable when omitted from the active request. Context pressure does
not reset the conversation or replay an earlier editing operation. Expired result snapshots are
reported explicitly; refresh current scene data and its revision before making a new change.

Open **File → Preferences → OGraf Studio → AI assistant** to override the model context window or
set optional conversation and tool-result page budgets in tokens. Leave each checkbox off for
Automatic. A custom limit cannot enlarge an advertised model capacity, and Studio still reserves
space for tool definitions and the reply. These user preferences save with the Studio profile,
not templates, template sets or graphic exports. They affect the built-in assistant; external MCP
clients manage their own model context. The status panel reports context planning and paging.

Studio records accepted user prompts in submission order under `authoringPrompts` in the editable
template. A template set keeps the history for each member. OGraf manifests carry the same text in
`v_ografStudioAuthoringPrompts`, including the manifest embedded in self-contained HTML exports.
Assistant responses, tool results, image pixels and editor context stay in the live conversation.
A server restart starts a fresh conversation and the saved prompt metadata stays in the file.
After reopening a template, expand **Saved prompts** in the AI Assistant pane. Select **Copy** to
copy the full text, or **Use prompt** to load it into the composer for editing. Both are available
without an AI provider configured.

An external MCP client must supply the user's creation request as `originalPrompt` when calling
`ograf_create_project`, `ograf_reset_project`, or creating, duplicating, or pasting a template set
member through `ograf_update_template_set`. Studio requires a nonblank prompt and saves it with the
new template. Duplicate and paste preserve existing prompt history and append the copy request.
Opening or importing an existing template preserves its existing provenance.

When starting from an already-open blank template, include `set_project_metadata.authoringPrompt`
with `{ id, text }` in the first external authoring batch sent to `ograf_apply_operations`.
Use the same operation for follow-up prompts. Send actual user text intended for inclusion in
shared exports. Reuse the same ID and text when retrying the same prompt.

External MCP clients can opt into paging without changing existing read responses:

```json
{
  "sourceTool": "ograf_get_project",
  "input": { "include": ["metadata", "layers"], "tracks": "none" },
  "maxTokens": 4096
}
```

Send that object to `ograf_read_result_page`, then use the returned `resultId` to inspect a path:

```json
{
  "resultId": "<returned-result-id>",
  "path": ["project", "compositions", 0, "layers"],
  "offset": 0,
  "limit": 50,
  "maxTokens": 4096
}
```

Object entries and array items may contain a complete value or a path reference. Follow that path
for the full value. Continue a node with its `nextOffset` while `hasMore` is true; strings use
explicit chunks and Unicode-safe offsets. `expiresAt` identifies the snapshot lifetime. Snapshots
are immutable and scoped to their workspace/conversation, and their revision may be older than the
live project. The reader refuses editing, imports, save/export and certification as source tools;
reading another page never repeats an operation. Existing source tools keep their default response
shape, and external client context limits remain controlled by that client.

Use **Capture areas** to reference parts of your graphic without selecting layers. Studio pauses
playback and freezes the current frame in place on the main canvas. Choose **Rectangle** or
**Freehand**, then draw up to eight areas, mixing shapes or overlapping them as needed. Freehand
works by holding the left mouse button and drawing an outline. Releasing the button automatically
closes and selects the area; pixels outside the outline are excluded from the
attached image. Enter each numbered region's instruction in the AI Assistant pane.
Zoom and middle-drag pan remain available. For example: **Area 1** — make the
background smaller; **Area 2** — increase the font size; **Area 3** — change the accent to red.

Choose **Attach areas**, then **Send**. A separate message is optional when you have written area
instructions. You can edit the notes, remove individual attachments, or use **Add areas** before
sending. Removing an area renumbers the remaining regions and keeps their notes paired with them.
**Escape** or **Cancel** discards the current capture without removing previously attached areas.

The microphone buttons dictate into individual annotations or the main message. Click once to
start and again to stop; review and edit the recognized text before sending. Dictation appends to
existing text, uses your browser's language, and stops when its field is removed or the capture
mode ends. Stop dictation before attaching areas or sending the message.

Dictation requires browser speech-recognition support and microphone permission. Some browsers
use an online speech service; unsupported browsers can use system dictation instead.

The configured model must support images. The assistant receives each numbered crop with its
instruction, composition coordinates, captured frame and revision, and checks the editable scene
before proposing the corrections together. An attached area takes precedence over the current
layer selection. Area attachments are cleared
when you switch projects or compositions and are not saved in `.ogs` files.

Current canvas, Layers-pane, and Timeline selection otherwise appears in AI Assistant as one or more
**selected** reference chips. The primary layer's selected property/key is included when applicable,
and those references update immediately as selection changes. Layers may still be dragged into AI Assistant
to add removable references outside the current selection. Explicit chips supply stable IDs, names,
and element types for prompts such as “change the color to green.”

The in-app model receives selected canonical authoring tools, including the structured result reader.
Save, export, certification, standalone project reset/open, and file imports remain explicit Studio
UI actions. Ask for a proposal to review visually consequential edits. Proposed tool batches
appear on the **main canvas**, with **Accept changes** and **Reject** in the AI Assistant pane.
Use the proposal frame controls to inspect the result or **Compare original** to switch views.
Approval shows one large frame at a time, so the operator can inspect changes clearly.
The editable project stays unchanged until acceptance. Editing the original while reviewing marks
the proposal stale; ask for a new proposal before accepting it. An accepted offer appears immediately in
**Edit → History** as one named **AI Assistant** entry with its action count. Undo/Redo applies to
the complete offer and preserves the surrounding manual edits as separate history steps.
The generated in-app knowledge prompt is a
projection of `skills/ograf-authoring`; `npm run prompt:generate` updates it and `npm run verify`
rejects drift.

## Shaders and procedural patterns

For compact discovery, request `ograf_get_capabilities` with `sections:["shaders"]` or
`sections:["tiling"]`; both domains remain included in `elements`. Shader paints apply to object
fills and independent text outlines. Their `#pragma ograf` controls create runtime fields and can
own lifecycle keyframes or local loops. Shader library actions and GLSL file picking are available
in Resources; MCP applies complete paints with `update_element`.

Pattern capabilities include the same six presets as the visual picker, with ready-to-use
`set_tiling_pattern.patch` data. Adapt the documented reference dimensions/frame rate to the target
composition. Presets are initially static; enable row cycles for motion. The editor adds visual
symbol replacement, selected-shape and SVG-silhouette import, local preview, and Make independent.
MCP uses explicit vector definitions and ordinary create/relink operations for those shared resources.

See the [shader and pattern authoring reference](../skills/ograf-authoring/references/shaders-and-patterns.md)
for operation examples, shader animation/data precedence, and the current UI/MCP boundaries.

## Entrance and exit motion through MCP

`set_layer_motion` matches Studio's **Animate In / Out** controls. It bakes Fade, Slide, Fly,
Focus, Wipe, Scale, Pop, Grow, Spin, or Drop into ordinary timeline keys; it does not add a
playout-only preset. Choose `side: "in"` or `"out"`, provide a positive `durationFrames` that fits
between the relevant lifecycle markers, and optionally add direction, distance, easing, or
`offsetFrames`. Focus requires the target's built-in blur effect, and Grow is not available on text.
`offsetFrames` ends the motion that many frames early; give each layer of a group a different value
to stagger it. Set `spec: null` to clear that side and hold the on-air pose.

```json
{
  "type": "set_layer_motion",
  "layerName": "Headline",
  "side": "in",
  "spec": {
    "style": "slide",
    "direction": "left",
    "distance": 80,
    "durationFrames": 12,
    "easing": "cubic-out"
  }
}
```

See the [motion workflow](../skills/ograf-authoring/references/layer-motion.md) for key replacement
and lifecycle-window limits.

## Interactive visual rules through MCP

`set_layer_visual_rules` replaces one layer's ordered rules. `trigger: "data"` (or no trigger) needs
an existing Data field; `hover` (a state), `pointer-enter`, `pointer-leave`, `pointer-down`,
`pointer-up`, `click`, and `double-click` react to the pointer; `play`, `step`, `stop`, and `custom-action` react to playout. `conditions` adds more
comparisons (`match: "all" | "any"`), `compareFieldId` compares two fields, and visibility,
`toggle-visibility`, and property actions accept `targetLayerId` to drive another layer, or
`targetGroupId` to drive every layer of an editor group.

Timer/counter alarms use `trigger:"timer-alarm"` and
`timerAlarm:{sourceLayerId,thresholdMs,direction:"up"|"down"}` on the same Rule records. Multiple
alarms may share a timer. Thresholds are nonnegative milliseconds; the source is a text clock
layer. Reset/Restart rearm alarms, including externally fed values, without replacing manual
data. Preserve the other Rules when replacing the array. See the authoring skill's clock/timer
reference for a five-second/zero example and export checks.

For example, after creating a rectangle named `Tab A` and a panel named `Panel A`, add this operation:

```json
{
  "type": "set_layer_visual_rules",
  "layerName": "Tab A",
  "rules": [
    {
      "id": "tab-a-open",
      "name": "Open panel A",
      "enabled": true,
      "trigger": "click",
      "actions": [
        {
          "type": "visibility",
          "visible": true,
          "targetLayerId": "<Panel A id>",
          "transitionFrames": 8
        },
        { "type": "property", "targetProperty": "fill", "value": "#2680ff" }
      ]
    }
  ]
}
```

Pointer rules run in an interactive real-time HTML renderer; Studio canvas clicks still select and
edit objects. Playout triggers, `delayFrames`, and `transitionFrames` replay deterministically in
non-real-time schedules; pointer input does not, so use an OGraf custom action for a remote or
deterministic trigger. The authoring skill's
[rule workflow](../skills/ograf-authoring/references/tool-workflows.md) covers state versus event
rules, conditions, and action references.

### Rules that command coordinated playout

Read `ograf_get_template_set` and `ograf_get_capabilities sections:["templateSets","bindings"]`
before adding `type:"playout"` actions. Use existing stable lane (`slotId`) and state (`stateId`)
IDs from `transitionLogic`; the editor labels them Lane and Template under **Then → Playout**.
Keep transition definitions in **Transitions** or `set_transition_logic`. Rule commands go through
the same planner, so timing, make-room phases, dependent-slot Out/Clear and incoming-state
`takeOutSlotIds` takeover behavior apply. Takeover prepares the incoming state, waits for selected
lanes to finish their authored Out, and leaves them Off when the incoming state later goes out.
Reciprocal policies are valid: a normal state's `takeOutSlotIds:["breaking"]` can complement
Breaking taking the normal lanes out. Requests prepare before canceling the opposite lane's entry;
failed preparation preserves output, stale readiness cannot reactivate canceled states, and no Out
automatically restores replaced content. Self references and dependency ancestors remain invalid.

**Take conditions and named-state presets require Transition Logic v4.** Optional
`slot.admission.requireOnSlotIds` requires settled On lanes; `blockWhileActiveSlotIds` rejects Take
while a conflicting lane prepares, enters, remains On or leaves. Rejection changes no occupancy,
is not queued and never activates a parent automatically. Out/Clear remain available. These
conditions are separate from `parentSlotId` (**Take out with**). For Source/second-line lanes, an
explicit requirement for Headline On and a blocker for Breaking prevents orphan or hidden active
graphics while preserving the normal shared layout behavior.

`state.dataDefaults` supplies editorial presets for states sharing one template. Template defaults
are followed by the state preset, retained state edits and explicit request data. Omit Take data
when preset/retained values should apply. A state name alone does not set its text/style. Studio's
lane map exposes **Take conditions** and **Template presets**; playback remains in Preview & Export.
Export validates preset fields and packages their image resources. Definitions v1–v3 remain
readable without these features; compatible archive storage does not make v4 features readable by
older runtimes. Discover `templateSets.transitionLogic` capabilities before authoring them.

**Incoming/outgoing content animations require Transition Logic v5.** Optional recipe
`incomingAnimation` / `outgoingAnimation` select `{type:"template"}`, a built-in
`{type:"builtin",motion:{style,direction?,distance?,easing?}}`, or a data-only
`{type:"plugin",reference:{id,version,sha256},presetId,parameters?}`. Pin inspected pack snapshots
once in `definition.animationPresetPlugins`. Preserve omitted sides for legacy transition-style
behavior. Duration comes from the recipe phase fields, not the choice. Overrides animate whole
non-shared content, keep shared objects morphing, and never rewrite template layer tracks or
replay entrance motion on same-instance data changes. Native/plugin motion replaces that side's
authored layer entrance/exit, avoiding double motion. Export bakes normal tracks and needs no
installed animation pack. Read the authoring skill's set reference for validation and compatibility.

Multiple `layoutRules` may add offsets to the same shared property. Baseline/state pose is sampled
first, then every observed lane contributes its timed numeric delta. Replacements retain occupancy;
preparation alone contributes zero. Keep each property's owner in one lane and avoid duplicate
property entries inside a rule. Validate the complete combined negative and positive bounds against
all baseline/state dimensions; separate reservations can be safe alone and invalid together.

```json
[
  { "type": "playout", "operation": "take", "slotId": "ticker", "stateId": "ticker" },
  {
    "type": "playout",
    "operation": "update",
    "slotId": "lower-third",
    "data": { "headline": "Updated headline" }
  },
  { "type": "playout", "operation": "out", "slotId": "ticker" },
  { "type": "playout", "operation": "clear", "slotId": "lower-third" }
]
```

These are alternative action examples, not a sequence to paste into one rule. Take requires a
state in the chosen lane. Update addresses only the on-air state; optional `stateId` is a guard
and never takes a different state. Take without `data` keeps target retained/default values;
Update without `data` forwards the rule's effective source-template data to known target field
keys. Explicit `data:{}` adds no patch; literal data merges with retained target values. Data must
be a JSON object of at most 64 KiB, 4096 values and 16 nested levels. Out/Clear require a lane and
accept neither state nor data. Out animates dependent lanes; Clear removes them immediately.

Enabled playout rules require coordinated set output; standalone composition export reports the
requirement. Coordinated Rules support data/change, pointer and once-per-entry hover, `play`,
first-step `step`, and `stop` triggers; event command delays are supported. Custom-action triggers,
shader/media/custom/set-data side effects, animated persistent rule properties and later-step
behavior remain unsupported in coordinated output. Pointer input is real-time only. Validate
set references before preview/export; composition-only validation cannot resolve the graph.

## Set up an external AI client

Standalone builds with bundled skill support carry a complete `ograf-authoring.zip` that matches
the executable. The startup hint shows how to print a prompt to paste into your AI client.
On Windows, run these commands from the executable's folder:

```powershell
.\OGrafStudioServer.exe --print-setup-prompt
.\OGrafStudioServer.exe --export-skill .\ograf-authoring.zip
```

The first command prints the setup prompt. The second writes the embedded archive to a fresh path.
Both commands exit without starting the server. Use the downloaded executable's filename on your
platform. If Studio runs on a custom port, pass that same `--port` value when printing the prompt.
The skill setup requires only the executable download on builds with these flags.

For an older executable, use the `ograf-authoring.zip` asset from the same release. From a source
checkout, run `npm run skill:package` to generate the archive. [Authoring skill bundle](DEVELOPMENT.md#authoring-skill-bundle-freshness)

### Connect the MCP server

Start Studio and keep the editor tab open for browser-dependent tools. The default MCP URL is
`http://127.0.0.1:4318/mcp`. Use the actual port shown at startup. Reuse a working OGraf entry and
preserve unrelated client settings. For Codex CLI and local ChatGPT Desktop sessions, configure the
local Codex MCP server. In Claude Code, configure an HTTP MCP server for the current user.

```sh
codex mcp add ograf-editor --url http://127.0.0.1:4318/mcp
claude mcp add --transport http --scope user ograf-editor http://127.0.0.1:4318/mcp
```

### Claude Desktop configuration on Windows

The server uses Streamable HTTP, while `claude_desktop_config.json` launches local stdio processes.
Use `mcp-remote` as a local compatibility bridge.

1. Run the standalone server, or start both `npm run dev` and `npm run mcp:start` from source.
2. Open `%APPDATA%\Claude\claude_desktop_config.json`.
3. Merge this entry into the existing `mcpServers` object:

```json
{
  "mcpServers": {
    "ograf-editor": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:4318/mcp", "--allow-http"]
    }
  }
}
```

4. Fully quit and reopen Claude Desktop.

`--allow-http` is appropriate here only because the endpoint is loopback-only. Do not use this
configuration for a server exposed on another machine or network. `npx` downloads the compatibility
bridge on first use, so Node.js and network access are required for that first launch.

## Using the `ograf-authoring` skill

Install the complete `ograf-authoring` folder so the client can load `SKILL.md`, its references,
and client metadata. `~` means the home directory of the user running the local client.

| Client                             | Default destination or install action       |
| ---------------------------------- | ------------------------------------------- |
| Codex CLI or local ChatGPT Desktop | `~/.agents/skills/ograf-authoring/`         |
| Claude Code                        | `~/.claude/skills/ograf-authoring/`         |
| Claude Desktop                     | Upload the ZIP under **Customize → Skills** |

Start a fresh client session if the skill or connection is missing. Confirm the skill is available
and call `ograf_get_capabilities` through the running server. For source installations, the tracked
skill folder and ZIP provide the same contents. [Authoring skill source](../skills/ograf-authoring)
· [Codex skill locations](https://learn.chatgpt.com/docs/build-skills) · [Claude Code skills](https://code.claude.com/docs/en/skills)
· [Claude Desktop skill upload](https://support.claude.com/en/articles/12512180-use-skills-in-claude)

Invoke it explicitly in Codex with a prompt such as:

```text
$ograf-authoring create an editable 90-frame lower third with name and role fields,
inspect its entrance and exit animation, certify it, and save the .ogs source.
```

The expected workflow is:

1. Start the editor and MCP server.
2. Invoke `$ograf-authoring` and describe the visual result, data fields, timing, and requested
   output.
3. Let the agent inspect capabilities and use semantic scene queries before it edits anything.
4. Review visual dry runs or explicit in-editor proposals before accepting consequential changes.
5. Use deterministic design/motion QA, PNG capture, and animation strips to inspect the result.
6. Approve save/export only after validation and exact OGraf certification pass.

The skill is intended for authoring graphics through the running editor. To change the editor's
React/TypeScript source code, work on the repository normally and finish with `npm run verify`.

### Why use the skill?

The skill gives agents Studio-specific guidance for capability discovery, revision checks,
independent animation tracks, reusable components and visual review. It documents how to validate
and export through the running editor, reducing repeated setup and avoidable authoring mistakes.
The operator can inspect, revise and undo the resulting layers and animation in Studio.
