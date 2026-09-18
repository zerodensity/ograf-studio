# AI authoring

[Back to overview](../README.md) · [Using Studio](USER_GUIDE.md) · [Server setup](DEVELOPMENT.md#run-the-mcp-server)

## AI Assistant

OGraf Studio includes an **AI Assistant** tab beside **Layers** in the left sidebar. The model loop runs in
the local server process and drives the same canonical, revision-checked tool records as MCP. The
browser receives only redacted chat/tool/usage events: provider credentials never enter renderer
JavaScript, WebSocket frames, project files, or local usage storage.

### Codex sign-in

The **Codex** provider uses the installed Codex CLI and its existing sign-in through the official
[Codex App Server](https://learn.chatgpt.com/docs/app-server). No separate API key is required when
Codex is signed in with ChatGPT. Captured areas are sent as image inputs.

On Windows, run `codex login` if needed, then start Studio with:

```powershell
.\scripts\startCodex.ps1 -RestartMcp
```

The script saves provider settings in the ignored `.ograf-agent.local` file; later `startAll.ps1`
launches reuse them. `-RestartMcp` restarts only this checkout's source MCP server. The default model
follows Codex's configuration; pass `-Model` to choose another model available to your account.

For other launch methods, set `OGRAF_AGENT_PROVIDER=codex`. `OGRAF_AGENT_MODEL` is optional, and
`OGRAF_CODEX_EXECUTABLE` can point to Codex when it is not on PATH. Keep Codex and its bundled Code
Mode host installed together. Studio uses ephemeral Codex conversations and supplies its authoring
tools; scene mutations retain revision checks and the visual proposal review flow.

### API providers (BYOK)

Configure the server before starting `npm run mcp:start`:

```powershell
$env:OGRAF_AGENT_PROVIDER = "anthropic" # or "openai-compatible"
$env:OGRAF_AGENT_BASE_URL = "https://api.anthropic.com"
$env:OGRAF_AGENT_MODEL = "your-model-id"
npm run agent:credential
npm run mcp:start
```

`agent:credential` prompts without echo and stores the secret as
`OGraf Studio/<provider>` in Windows Credential Manager. For managed or air-gapped machines, set
`OGRAF_AGENT_API_KEY` in the server environment instead; it is a fallback and is never persisted by
Studio. `OGRAF_AGENT_BASE_URL` is required so facilities can use an internal gateway or self-hosted
OpenAI-compatible endpoint. It may be an API root ending in `/v1` or a complete chat-completions URL.

Optional server-only settings are `OGRAF_AGENT_CHEAP_MODEL` for routine rename/property/key work,
`OGRAF_AGENT_EFFORT` (`low`, `medium`, or `high`), `OGRAF_AGENT_ORGANIZATION`,
`OGRAF_AGENT_PROJECT`, `OGRAF_AGENT_CREDENTIAL_TARGET`, and `OGRAF_AGENT_TIMEOUT_MS` (provider wait
timeout, default 120000 ms). Restart the server after changing them.
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
