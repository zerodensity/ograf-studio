# OGraf Studio

A browser-based visual editor for creating EBU OGraf-compatible HTML5 broadcast graphics such as
lower thirds, scoreboards, tickers, full-frame graphics, and reusable data-driven templates.

The project combines a React/Vite editor, a deterministic OGraf runtime, validation and export
packages, and an optional local MCP authoring server for AI-assisted workflows.

## New in OGraf Studio 0.03

- Added semantic layer roles, tags, and intent, plus materialized lower-third and repeater recipes
  that remain ordinary editable OGraf layers.
- Added compact semantic scene queries, visual operation dry runs, deterministic design/motion QA,
  and an in-editor human review drawer for explicitly accepting or rejecting AI proposals.
- Added Brand Kits with portable design-token materialization and reusable components with optional
  linked instances that refresh only when requested.
- Added MCP asset and Photoshop SVG-bundle import parity with workspace confinement and payload
  limits.
- Generated the complete MCP tool/schema reference from the registered server contracts; drift now
  fails `npm run verify`.
- Renamed the product to **OGraf Studio** across the application and current documentation.
- Added state-aware exits that animate directly from the active Step to End.
- Added multiple independent property bindings per layer.
- Closed structural editor/MCP parity gaps for lifecycle markers, canvas groups, reusable
  components, custom actions, and safe asset removal.
- Added reusable component snapshots with independently editable inserted instances.
- Added portable Photoshop SVG bundle import with companion CSS, images, and fonts.
- Added disposable-realm OGraf certification and serialized browser rendering jobs.
- Added a resource manager for images, fonts, and source attachments with metadata, usage guards,
  deduplication, package paths, font descriptors, and license packaging.
- Added named real-time, non-real-time, and dual-mode export profiles that never mutate source.
- Added paired frame/millisecond timing controls with non-representable-duration warnings and
  explicit down/nearest/up rounding.
- Added broadcast typography controls, source-design overlays, and browser-rendered text stress QA.

## Highlights

- WYSIWYG canvas with layers, grouping, guides, rulers, snapping, clipping, and responsive layout
  aids.
- Independent per-property animation tracks, per-key easing and curves, local loops, and freely
  movable OGraf lifecycle Steps.
- Data fields with multiple independent property bindings per layer for text, images, colors, and
  structured gradients.
- Composition-local layer blend modes with an isolated transparent root, so blending is portable
  between the editor, browser capture, realtime playback, and deterministic offline rendering
  without accidentally blending against a controller's external video bed.
- Reality Hub-ready GDD field metadata with descriptions, select labels, file hints, scalar
  constraints, integer/duration/percentage controls, and select-multiple values.
- Reusable authoring components that snapshot selected layers and bound fields, then insert fresh
  independent or explicitly refreshable linked instances without adding a proprietary runtime
  dependency.
- Brand Kits with typed color, typography, and geometry tokens; token values are materialized into
  standard element properties so exported graphics never require OGraf Studio at playout time.
- Semantic lower-third and repeater recipes for fast AI/human authoring while keeping every result
  editable through normal layers, fields, groups, and tracks.
- Self-contained Lottie JSON layers with deterministic loop playback in editor preview, OGraf
  realtime playback, and non-realtime `goToTime()` seeking.
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
| `.ogeproj`                | Editable OGraf Studio source       | **Open Project**                                                                                |
| `.ograf.zip`              | Certified playout package          | **Import OGraf** for best-effort editable conversion, or extract it for an OGraf player/devtool |
| Loose OGraf package files | Manifest, `main.js`, and resources | Select them together with **Import OGraf**                                                      |
| SVG and raster images     | Reusable image assets              | **Resources → Import Image**                                                                    |
| Lottie `.json`            | Looping vector animation layer     | **+ Lottie JSON** above the canvas                                                              |

An `.ogeproj` file is not an OGraf manifest and should not be opened directly in an OGraf playout
tool. A `.ograf.zip` is the deployable output, but arbitrary third-party JavaScript cannot always be
reconstructed as editable layers. The import report lists everything recovered, defaulted, or lost.

### SVG and Photoshop exports

Use **Resources → Import Image/SVG Bundle** and select one SVG together with its companion CSS,
linked images, and local font files. OGraf Studio injects the CSS into the SVG, replaces selected
relative image/font URLs with data URIs, removes the external XML stylesheet reference, and
registers selected fonts as project font assets. Any unresolved relative URL is reported in the
Resources panel. The result remains one portable image asset; Photoshop's rasterized content and
arbitrary SVG structure are not decomposed into independently editable studio layers.

MCP clients can perform the same portable import through `ograf_import_svg_bundle`, or ingest one
workspace-confined file through `ograf_import_asset`. Both tools enforce file and aggregate payload
limits before committing one revision-checked asset transaction.

### Lottie animations

Use **+ Lottie JSON** above the canvas, or replace the JSON from a selected Lottie layer's
Inspector. The first supported profile is intentionally deterministic and portable:

- the Bodymovin/Lottie JSON is embedded in the editable project and exported OGraf module;
- playback loops continuously, with an editable non-negative speed multiplier;
- editor scrubbing and non-realtime `goToTime()` derive the exact Lottie frame from composition
  time; realtime playback uses the same absolute-time frame calculation;
- the self-hosted light canvas player is bundled into `main.js`, with no CDN dependency;
- expressions are disabled, and external image/font paths are rejected. Export images inside the
  JSON as data URIs or convert them to shapes/glyphs.

A small compatible animation is included at `examples/lottie/pulse.json`. Segments, markers,
one-shot playback, dynamic Lottie text/data binding, separate image folders, and renderer selection
are deferred until the basic profile has been exercised on target broadcast devices.

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
3. Let the agent inspect capabilities and use semantic scene queries before it edits anything.
4. Review visual dry runs or explicit in-editor proposals before accepting consequential changes.
5. Use deterministic design/motion QA, PNG capture, and animation strips to inspect the result.
6. Approve save/export only after validation and exact OGraf certification pass.

The skill is intended for authoring graphics through the running editor. To change the editor's
React/TypeScript source code, work on the repository normally and finish with `npm run verify`.

### Vibe coding with and without the skill

Here, _vibe coding_ means describing the desired graphic in natural language and iterating on the
result instead of manually constructing every layer, field, and keyframe.

| Area                | Without `ograf-authoring`                                                                                 | With `ograf-authoring`                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Starting point      | The agent must rediscover the editor, MCP tools, and OGraf rules from the repository or prompt.           | The agent begins with the editor-specific workflow, tool boundaries, and OGraf invariants.                    |
| Project edits       | Ad-hoc tool calls can use stale IDs or overwrite concurrent human edits.                                  | Reads first, preserves stable IDs, supplies `expectedRevision`, and deliberately rebases conflicts.           |
| Animation           | Natural-language requests may accidentally mix lifecycle Steps with layer/property keys.                  | Keeps Start/Step/End control points separate from each layer's independent property tracks and loops.         |
| Repeated graphics   | Repeated cells and assets may be recreated manually and inconsistently.                                   | Uses semantic repeaters or lower-level duplication, registered assets, staggered tracks, and timeline groups. |
| Visual checking     | Often stops after code generation, a build, or one subjective browser view.                               | Uses operation previews, design/motion QA, frame strips, measurement, and representative data values.         |
| Human control       | A visually consequential agent edit may be applied before anyone sees it.                                 | Can present a rendered, revision-checked proposal in OGraf Studio for explicit Accept or Reject.              |
| OGraf compatibility | A valid-looking project or successful build may be mistaken for compliant output.                         | Treats validation and exact manifest/module/lifecycle certification as separate mandatory gates.              |
| Save and export     | The agent may write raw JSON or assemble a ZIP outside the editor's safety boundary.                      | Uses certified `.ogeproj` save and `.ograf.zip` export tools only when the user requests file output.         |
| Undo and recovery   | Changes may require manual cleanup when a long prompt partly succeeds.                                    | Coherent atomic batches become meaningful agent undo units, with dry runs for risky changes.                  |
| Speed profile       | Fast for rough experiments, but more prompt detail and rework are usually needed for production graphics. | Adds a short inspect/verify overhead, then reduces rediscovery, inconsistent edits, and compliance rework.    |
| Best fit            | Exploring ideas, changing editor source code, or using an unsupported one-off workflow.                   | Repeatable, editable, data-driven OGraf authoring intended for certification and playout.                     |

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

It checks generated MCP contract drift, formatting, lint, every workspace typecheck, all tests, the
OGraf runtime bundle, and the editor production build. `npm test` also prebuilds the ignored runtime
bundle so tests work in a fresh clone.

## Repository layout

- `apps/editor` — React/Vite visual editor.
- `apps/mcp-server` — localhost Streamable HTTP MCP server and editor bridge.
- `packages/scene-model` — canonical editable project model and migrations.
- `packages/authoring-core` — framework-neutral revisioned authoring operations.
- `packages/codegen` — manifest, descriptor, and export artifact compiler.
- `packages/ograf-runtime` — descriptor-driven OGraf `Graphic` custom element.
- `packages/validation` — official-schema and semantic validation.
- `skills/ograf-authoring` — reusable MCP authoring skill and references.
- `docs/generated` — generated MCP tool/schema contracts; regenerate instead of editing by hand.
- `templates` — example editable sources and OGraf packages.
- `fixtures/ograf-schema` — vendored OGraf schema closure used by validation.

See [docs/STATUS.md](docs/STATUS.md) for the current capability inventory,
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design invariants, and
[docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) for active limitations.

## Current limitations

- Conversion of opaque third-party `main.js` code is necessarily lossy and never executes imported
  JavaScript.
- SVG bundles are made portable as one image asset; arbitrary Photoshop/SVG structure is not
  decomposed into editable text and shape layers.
- Font choices that are not packaged as project font assets still depend on fonts installed on the
  authoring/playout machine.
- Linked component refresh replaces the linked instance from its current component snapshot;
  independent instances are required when local overrides must never be replaced.
- Repeaters currently materialize ordinary layers and fields at authoring time; they are not a live
  runtime array-binding system.
- Browser-rendered operation previews, proposal images, and certification require a connected,
  responsive editor. Headless render/certify is deliberately deferred.
- Lottie v1 is canvas-only, continuously looped, and self-contained; expressions, external assets,
  segments/markers, one-shot playback, and dynamic Lottie content are not yet authored.
- The editor production bundle currently triggers Vite's large-chunk advisory; it is a performance
  warning, not a build failure.
