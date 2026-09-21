# AI authoring

[Back to overview](../README.md) · [Using Studio](USER_GUIDE.md) · [Server setup](DEVELOPMENT.md#run-the-mcp-server)

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

AI Assistant conversations are isolated by project ID, keep a bounded recent conversation and the
latest batch of reference images, and cap individual tool-result payloads at 16,000 characters. Opening or creating another
project therefore starts a fresh conversation. If Anthropic still rejects the first request as too
long, Studio automatically retries that turn once with fresh project conversation history.

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

The in-app model receives a reduced 14-tool authoring surface. Save, export, certification, project
reset/open, and imports remain explicit Studio UI actions. Visually consequential tool batches still
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

## Claude Desktop configuration on Windows

The server uses Streamable HTTP, while `claude_desktop_config.json` launches local stdio processes.
Use `mcp-remote` as a local compatibility bridge.

1. Run the standalone server, or start both `npm run dev` and `npm run mcp:start` from source.
2. Open `%APPDATA%\Claude\claude_desktop_config.json`.
3. Merge this entry into the existing `mcpServers` object:

```json
{
  "mcpServers": {
    "ograf-studio": {
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

The repository includes a reusable skill at
[`skills/ograf-authoring`](../skills/ograf-authoring). It teaches a skill-aware agent how to operate the
editor through MCP while preserving OGraf lifecycle, animation, validation, and certification
rules. The skill does not contain the editor or server; run the standalone server, or start `npm run dev` and `npm run mcp:start`
from source, before using it.

For Codex, install the complete `ograf-authoring` folder in one of the standard discovery locations:

- repository scope: `.agents/skills/ograf-authoring`;
- user scope on Windows: `%USERPROFILE%\.agents\skills\ograf-authoring`.

Copy or link the folder rather than only `SKILL.md`, because its `references` and
`agents/openai.yaml` files provide the detailed workflows and MCP dependency. The tracked
[`ograf-authoring.zip`](../skills/ograf-authoring/ograf-authoring.zip) contains the portable
instruction bundle for clients that accept a skill archive. If a newly installed or updated skill
does not appear, restart the client.

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
