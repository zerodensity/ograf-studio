# Development and deployment

[Back to overview](../README.md) · [Using Studio](USER_GUIDE.md) · [AI authoring](AI_AUTHORING.md)

## Requirements

- Node.js 22 or newer
- npm
- A modern Chromium-based browser is recommended for the File System Access API; other browsers use
  download/upload fallbacks.

## Quick start

From your cloned repository root:

```powershell
npm ci
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
npm run mcp:start
```

Endpoints:

- MCP: `http://127.0.0.1:4318/mcp`
- Editor bridge: `ws://127.0.0.1:4318/editor`
- Health: `http://127.0.0.1:4318/health`

To start the editor and MCP server together as hidden background processes, run:

```powershell
npm run start:all
```

The command skips a service that is already online, waits up to 45 seconds for both endpoints, and
writes stdout/stderr logs under `.logs`.

### Single-executable server

The optional standalone distributions serve the production editor, MCP endpoint, editor WebSocket,
health endpoint, fonts, icons, and application assets from one headless executable per operating
system and architecture. They do not replace or change the normal `npm run dev`,
`npm run mcp:start`, or `npm run start:all` workflows.

Install [Bun](https://bun.sh/) on the build machine, then run:

```powershell
npm run server:package
```

This creates the Windows x64 executable. Build the complete release matrix with:

```powershell
npm run server:package:all
```

The matrix produces:

| Operating system | Architecture  | Artifact                        |
| ---------------- | ------------- | ------------------------------- |
| Windows          | x64           | `OGrafStudioServer.exe`         |
| macOS            | Intel x64     | `OGrafStudioServer-macos-x64`   |
| macOS            | Apple Silicon | `OGrafStudioServer-macos-arm64` |
| Linux            | x64           | `OGrafStudioServer-linux-x64`   |
| Linux            | ARM64         | `OGrafStudioServer-linux-arm64` |

Bun, Node.js, npm, and the source tree are not needed on destination machines. Start the applicable
file directly and open the reported URL in any normal browser:

```powershell
OGrafStudioServer.exe
OGrafStudioServer.exe --open
OGrafStudioServer.exe --port 4400 --workspace "D:\OGraf Projects"
```

The standalone server binds to `127.0.0.1` only. Its default writable
workspace is `Documents\OGraf Studio\Projects`; `--workspace` and the existing
`OGRAF_WORKSPACE_ROOT` environment variable can override it. `--open` launches the system browser,
while the default remains suitable for a console or background process. Run
`OGrafStudioServer.exe --help` for the complete option list.

For source-level testing of the same combined host, use `npm run server:start`. This command requires
Bun because it runs the TypeScript entry point directly; only the generated executable is
self-contained.

Linux users must make the downloaded file executable with `chmod +x`. The macOS artifacts are raw,
unsigned command-line executables; they require code signing and notarization before broad external
distribution. The Windows executable contains Zero Density product/version metadata and the OGS
icon; headless macOS/Linux executables do not have desktop application icons.

The source-level `npm run mcp:start` server also binds only to loopback, but defaults its writable
workspace to the repository root. Set `OGRAF_WORKSPACE_ROOT` before starting that command to use a
different confined workspace. Set `OGRAF_MCP_PORT` to change port `4318`, and set the editor's
`VITE_OGRAF_AGENT_BRIDGE_URL` to the matching WebSocket URL when changing the port.

## Can the editor run without a backend?

Yes. The visual editor is a client-side application and can author, preview, import, certify, save
`.ogs`, and export `.ograf.zip` files without the MCP server. Autosave uses browser storage, and
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
- `packages/agent-tools` — transport-neutral canonical tool records, provider schemas, generated
  authoring prompt, and bridge/workspace ports shared by MCP and the in-app agent.
- `packages/scene-model` — canonical editable project model and migrations.
- `packages/authoring-core` — framework-neutral revisioned authoring operations.
- `packages/codegen` — manifest, descriptor, and export artifact compiler.
- `packages/ograf-runtime` — descriptor-driven OGraf `Graphic` custom element.
- `packages/validation` — official-schema and semantic validation.
- `skills/ograf-authoring` — reusable MCP authoring skill and references.
- `docs/generated` — generated public MCP tool/schema contracts; regenerate
  instead of editing by hand.
- `templates` — example editable sources and OGraf packages.
- `fixtures/ograf-schema` — vendored OGraf schema closure used by validation.

See [Using Studio](USER_GUIDE.md) for supported workflows and compatibility notes,
and [Contributing](../CONTRIBUTING.md) for community development guidance.
