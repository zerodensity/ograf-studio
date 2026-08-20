# ZD OGraf Editor

A browser-based visual editor for creating EBU OGraf-compatible HTML5 broadcast graphics such as
lower thirds, scoreboards, tickers, full-frame graphics, and reusable data-driven templates.

The project combines a React/Vite editor, a deterministic OGraf runtime, validation and export
packages, and an optional local MCP authoring server for AI-assisted workflows.

## Highlights

- WYSIWYG canvas with layers, grouping, guides, rulers, snapping, clipping, and responsive layout
  aids.
- Independent per-property animation tracks, per-key easing and curves, local loops, and freely
  movable OGraf lifecycle Steps.
- Data fields and bindings for text, images, colors, and structured gradients.
- Start, pausable Step, and End lifecycle preview using the same compiled timeline as export.
- Exact pre-save and pre-export OGraf certification against the packaged manifest, module, API, and
  realtime/non-realtime lifecycle behavior.
- Best-effort conversion of existing OGraf packages into editable projects with an explicit recovery
  and loss report.
- Optional localhost MCP server with revisioned scene/timeline operations, validation, visual
  capture, certification, save, and export tools.

## File types

| File                      | Purpose                            | How to open it                                                                                  |
| ------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `.ogeproj`                | Editable ZD OGraf Editor source    | **Open Project**                                                                                |
| `.ograf.zip`              | Certified playout package          | **Import OGraf** for best-effort editable conversion, or extract it for an OGraf player/devtool |
| Loose OGraf package files | Manifest, `main.js`, and resources | Select them together with **Import OGraf**                                                      |
| SVG and raster images     | Reusable image assets              | **Resources → Import Image**                                                                    |

An `.ogeproj` file is not an OGraf manifest and should not be opened directly in an OGraf playout
tool. A `.ograf.zip` is the deployable output, but arbitrary third-party JavaScript cannot always be
reconstructed as editable layers. The import report lists everything recovered, defaulted, or lost.

### SVG and Photoshop exports

SVG files can be imported as image assets. External companion CSS files are not currently ingested
automatically. For portable results, inline the required styles in the SVG, convert critical text to
paths, or ensure the referenced fonts are installed on every authoring and playout machine. Relative
font/image URLs and external `@font-face` rules remain a known conversion boundary.

## Requirements

- Node.js 22 or newer
- npm
- A modern Chromium-based browser is recommended for the File System Access API; other browsers use
  download/upload fallbacks.

## Quick start

From the repository root:

```powershell
cd C:\works\zd_ograf_editor
npm install
npm run dev
```

Open `http://localhost:5173/`.

The root development command builds the runtime bundle before starting Vite. If you change
`packages/ograf-runtime/src` while the editor is already running, rebuild it explicitly:

```powershell
npm run build --workspace @ograf-editor/ograf-runtime
```

## Run the MCP server

Start the editor first, then use a second terminal:

```powershell
cd C:\works\zd_ograf_editor
npm run mcp:start
```

Endpoints:

- MCP: `http://127.0.0.1:4318/mcp`
- Editor bridge: `ws://127.0.0.1:4318/editor`
- Health: `http://127.0.0.1:4318/health`

The server binds only to loopback. Its default writable workspace is the repository root; set
`OGRAF_WORKSPACE_ROOT` before starting it to use a different confined workspace. Set
`OGRAF_MCP_PORT` to change port `4318`, and set the editor's `VITE_OGRAF_AGENT_BRIDGE_URL` to the
matching WebSocket URL when changing the port.

## Claude Desktop configuration on Windows

The server uses Streamable HTTP, while `claude_desktop_config.json` launches local stdio processes.
Use `mcp-remote` as a local compatibility bridge.

1. Start both `npm run dev` and `npm run mcp:start`.
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

The repository includes a reusable skill at
[`skills/ograf-authoring`](skills/ograf-authoring). It teaches a skill-aware agent how to operate the
editor through MCP while preserving OGraf lifecycle, animation, validation, and certification
rules. The skill does not contain the editor or server; start `npm run dev` and `npm run mcp:start`
before using it.

For Codex, install the complete `ograf-authoring` folder in one of the standard discovery locations:

- repository scope: `.agents/skills/ograf-authoring`;
- user scope on Windows: `%USERPROFILE%\.agents\skills\ograf-authoring`.

Copy or link the folder rather than only `SKILL.md`, because its `references` and
`agents/openai.yaml` files provide the detailed workflows and MCP dependency. The tracked
[`ograf-authoring.zip`](skills/ograf-authoring/ograf-authoring.zip) contains the portable
instruction bundle for clients that accept a skill archive. If a newly installed or updated skill
does not appear, restart the client.

Invoke it explicitly in Codex with a prompt such as:

```text
$ograf-authoring create an editable 90-frame lower third with name and role fields,
inspect its entrance and exit animation, certify it, and save the .ogeproj source.
```

The expected workflow is:

1. Start the editor and MCP server.
2. Invoke `$ograf-authoring` and describe the visual result, data fields, timing, and requested
   output.
3. Let the agent inspect capabilities and the current project before it edits anything.
4. Review the editor, PNG capture, or animation strip when requested.
5. Approve save/export only after validation and exact OGraf certification pass.

The skill is intended for authoring graphics through the running editor. To change the editor's
React/TypeScript source code, work on the repository normally and finish with `npm run verify`.

### Vibe coding with and without the skill

Here, _vibe coding_ means describing the desired graphic in natural language and iterating on the
result instead of manually constructing every layer, field, and keyframe.

| Area                | Without `ograf-authoring`                                                                                 | With `ograf-authoring`                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Starting point      | The agent must rediscover the editor, MCP tools, and OGraf rules from the repository or prompt.           | The agent begins with the editor-specific workflow, tool boundaries, and OGraf invariants.                 |
| Project edits       | Ad-hoc tool calls can use stale IDs or overwrite concurrent human edits.                                  | Reads first, preserves stable IDs, supplies `expectedRevision`, and deliberately rebases conflicts.        |
| Animation           | Natural-language requests may accidentally mix lifecycle Steps with layer/property keys.                  | Keeps Start/Step/End control points separate from each layer's independent property tracks and loops.      |
| Repeated graphics   | Repeated cells and assets may be recreated manually and inconsistently.                                   | Reuses registered assets, atomic batches, duplication mappings, staggered tracks, and timeline groups.     |
| Visual checking     | Often stops after code generation, a build, or one subjective browser view.                               | Uses frame capture, animation strips, track sampling, text measurement, and representative data values.    |
| OGraf compatibility | A valid-looking project or successful build may be mistaken for compliant output.                         | Treats validation and exact manifest/module/lifecycle certification as separate mandatory gates.           |
| Save and export     | The agent may write raw JSON or assemble a ZIP outside the editor's safety boundary.                      | Uses certified `.ogeproj` save and `.ograf.zip` export tools only when the user requests file output.      |
| Undo and recovery   | Changes may require manual cleanup when a long prompt partly succeeds.                                    | Coherent atomic batches become meaningful agent undo units, with dry runs for risky changes.               |
| Speed profile       | Fast for rough experiments, but more prompt detail and rework are usually needed for production graphics. | Adds a short inspect/verify overhead, then reduces rediscovery, inconsistent edits, and compliance rework. |
| Best fit            | Exploring ideas, changing editor source code, or using an unsupported one-off workflow.                   | Repeatable, editable, data-driven OGraf authoring intended for certification and playout.                  |

The skill improves process reliability, not model creativity. The visual concept still comes from
the user and agent; the skill makes the route from that concept to an editable, inspected, certified
OGraf result more deterministic.

## Can the editor run without a backend?

Yes. The visual editor is a client-side application and can author, preview, import, certify, save
`.ogeproj`, and export `.ograf.zip` files without the MCP server. Autosave uses browser storage, and
explicit saves use the browser file picker or downloads.

Without the MCP server you lose:

- external agent/tool access;
- revision-checked MCP mutations, agent undo/redo, and temporary MCP sessions;
- MCP-requested PNG captures, contact sheets, and text measurements;
- agent-controlled certified save/export to a workspace path.

Normal visual editing and browser-driven save/export remain available. A production build can be
served as static files; the MCP server is an optional authoring companion, not an application
backend.

## Verification

Run the complete local gate before publishing changes:

```powershell
npm run verify
```

It checks formatting, lint, every workspace typecheck, all tests, the OGraf runtime bundle, and the
editor production build. `npm test` also prebuilds the ignored runtime bundle so tests work in a
fresh clone.

## Repository layout

- `apps/editor` — React/Vite visual editor.
- `apps/mcp-server` — localhost Streamable HTTP MCP server and editor bridge.
- `packages/scene-model` — canonical editable project model and migrations.
- `packages/authoring-core` — framework-neutral revisioned authoring operations.
- `packages/codegen` — manifest, descriptor, and export artifact compiler.
- `packages/ograf-runtime` — descriptor-driven OGraf `Graphic` custom element.
- `packages/validation` — official-schema and semantic validation.
- `skills/ograf-authoring` — reusable MCP authoring skill and references.
- `templates` — example editable sources and OGraf packages.
- `fixtures/ograf-schema` — vendored OGraf schema closure used by validation.

See [docs/STATUS.md](docs/STATUS.md) for the current capability inventory,
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design invariants, and
[docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) for active limitations.

## Current limitations

- Conversion of opaque third-party `main.js` code is necessarily lossy and never executes imported
  JavaScript.
- Companion CSS for imported SVG images is not automatically packaged or rewritten.
- System-font rendering depends on fonts installed on the authoring/playout machine.
- The editor production bundle currently triggers Vite's large-chunk advisory; it is a performance
  warning, not a build failure.
