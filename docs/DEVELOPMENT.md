# Development and deployment

[Back to overview](../README.md) · [Using Studio](USER_GUIDE.md) · [AI authoring](AI_AUTHORING.md)

These instructions describe the 0.33.0 source line. See [What's new in 0.33](releases/0.33.0.md)
for current authoring and integration capabilities.

## Requirements

- Node.js 22 or newer
- npm
- [Bun 1.3.11](https://bun.sh/) to build the included first-party plugins from their sources
- A modern Chromium-based browser is recommended for the File System Access API; other browsers use
  download/upload fallbacks.

## Quick start

From your cloned repository root:

```powershell
npm ci
npm run dev
```

Open `http://localhost:5173/`.

Editor development and production builds regenerate the included shader packs, Broadcast Motion
and Chart.js bundles. Their exact hashes are compiled into the application, and their archives
are served locally, including in the offline standalone executable. `npm run plugins:bundle`
regenerates these assets explicitly; `npm run plugins:check` verifies their source and byte pins.

The root development command builds the runtime bundle before starting Vite. If you change
`packages/ograf-runtime/src` while the editor is already running, rebuild it explicitly:

```powershell
npm run build --workspace @ograf-editor/ograf-runtime
```

### Build version

Studio's displayed version and standalone executable metadata come from the root `package.json`.
For this source line, check it with:

```powershell
npm pkg get version
# Expected: "0.33.0"
```

Restart the development server or rebuild after changing the version. Packaging creates local
artifacts; it does not create a Git tag or publish a GitHub release.

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
health endpoint, fonts, icons, application assets, and matching OGraf Authoring skill from one
headless executable per operating system and architecture. Source checkouts can use `npm run dev`,
`npm run mcp:start`, or `npm run start:all`.

Install [Bun](https://bun.sh/) on the build machine, then run:

```powershell
npm run server:package
```

This creates the Windows x64 executable. Build the complete release matrix with:

```powershell
npm run server:package:all
```

Set `OGRAF_STANDALONE_PLATFORMS=windows,linux` to exclude macOS from packaging and artifact
verification. The release workflow uses this selection.

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

### Export the bundled skill or print the setup prompt

The executable contains the full version-matched `ograf-authoring.zip`. The startup hint shows
how to print a setup prompt for an external AI client. On Windows, for example:

```powershell
.\OGrafStudioServer.exe --print-setup-prompt
.\OGrafStudioServer.exe --export-skill .\ograf-authoring.zip
```

Each command exits after printing the prompt or writing the archive. The export requires a fresh
path and preserves existing files. Use the filename for your platform. See the client install
locations and source setup fallback in the [AI authoring guide](AI_AUTHORING.md#set-up-an-external-ai-client).

For source-level testing of the same combined host, use `npm run server:start`. This command requires
Bun because it runs the TypeScript entry point directly; only the generated executable is
self-contained.

Linux users must make the downloaded file executable with `chmod +x`. The macOS artifacts are raw,
unsigned command-line executables; they require code signing and notarization before broad external
distribution. The Windows executable contains Zero Density product/version metadata and the official OGraf
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

## Authoring skill bundle freshness

Build commands regenerate `skills/ograf-authoring/ograf-authoring.zip` from the canonical skill,
references, and metadata. Entries are sorted, line endings normalized, and timestamps fixed, so
unchanged sources produce the same archive. The archive excludes itself.
Standalone builds embed these exact bytes. The separate release ZIP uses the same archive for
manual installs and clients that accept ZIP uploads.

```powershell
npm run skill:package
npm run skill:check
npm run hooks:install
```

The first build installs the repository's pre-push guard when no custom hook is configured. It checks
the **committed revision being pushed**, so a freshly rebuilt but uncommitted ZIP cannot hide a stale
archive in the commit. Commit the rebuilt ZIP alongside skill changes. Custom hook configurations
are preserved; chain `node scripts/packageAuthoringSkill.mjs --check-push` from the existing pre-push
hook, passing its standard input. `npm run verify` also checks ZIP/source parity.

The guard is configured per checkout. When `extensions.worktreeConfig` is on, each checkout records
its own `.githooks` path with `git config --worktree`, so the shared `.git/config` is never changed
and removing one worktree cannot disarm another. Without that extension a linked worktree has no
config of its own: run `npm run hooks:install` from the main checkout instead.

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
