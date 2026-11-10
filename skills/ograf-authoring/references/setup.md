# Local editor and MCP setup

Read this reference when the `ograf-editor` MCP dependency is unavailable, the editor bridge is
disconnected, or a local AI client needs the matching skill and MCP configuration.

## Install the bundled skill

Standalone builds with bundled skill support include the full `ograf-authoring.zip` that matches
the executable. The startup hint shows how to print a setup prompt. For example, on Windows:

```powershell
.\OGrafStudioServer.exe --print-setup-prompt
.\OGrafStudioServer.exe --export-skill .\ograf-authoring.zip
```

Use the downloaded executable's filename on your platform. Each command exits after printing the
prompt or writing the archive. Choose a fresh export path because the command preserves an existing
file. Pass the running server's `--port` value when printing the prompt if it differs from the
default. Start Studio separately to use the tools.

- **Codex CLI or a local ChatGPT Desktop session** — Extract the entire `ograf-authoring` folder
  into `~/.agents/skills/`, leaving `SKILL.md` at `~/.agents/skills/ograf-authoring/SKILL.md`.
- **Claude Code** — Extract the entire folder into `~/.claude/skills/`, leaving `SKILL.md` at
  `~/.claude/skills/ograf-authoring/SKILL.md`.
- **Claude Desktop** — Upload the ZIP in **Customize → Skills** and enable it if prompted.
  Follow [Claude's skill upload guide](https://support.claude.com/en/articles/12512180-use-skills-in-claude)
  if the upload control is unavailable.

`~` means the home directory of the user running the local client. Keep the supporting files
alongside `SKILL.md`. Check the client's skill list and start a fresh session if needed.

For an older executable without `--export-skill`, get `ograf-authoring.zip` from the same release.
For a source checkout, run `npm run skill:package` and use
`skills/ograf-authoring/ograf-authoring.zip`.

## Start the services

For the packaged standalone server, the editor, MCP, and health routes share one origin:
`http://127.0.0.1:4318/`, `/mcp`, and `/health` by default. Follow the running server's configured
port (for example 4319) instead of starting a second server or assuming port 5173. Standalone
output defaults to `Documents/OGraf Studio/Projects`; `/health` reports the actual workspace root.

The separate development setup below still uses Vite on port 5173.

From the repository root, install once and run the editor and MCP server in separate terminals:

```powershell
npm install
npm run dev
```

```powershell
npm run mcp:start
```

Defaults:

- editor: `http://localhost:5173/`
- MCP endpoint: `http://127.0.0.1:4318/mcp`
- editor bridge: `ws://127.0.0.1:4318/editor`
- health endpoint: `http://127.0.0.1:4318/health`

The editor can run without MCP for human visual authoring. Browser-dependent MCP tools—including
visual operation previews, human proposals, capture/strips, measurement, and certification—require
both processes and a responsive editor tab. Server-side inspection, semantic query, validation,
mutations, track sampling, and non-visual QA remain available for MCP sessions when the browser is
disconnected.

## Health and recovery

1. Check `/health` before retrying a failed connection.
2. If the server is unavailable, start the standalone executable or restart `npm run mcp:start`
   for a source checkout.
3. If the socket is connected but capabilities report the editor as unresponsive, focus the editor
   tab and recheck `ograf_get_capabilities`.
4. Rebuild `packages/ograf-runtime` after runtime source changes; root `dev`, `mcp:start`, `test`,
   `build`, and `verify` do this automatically.

Do not repeatedly retry browser-dependent mutations while responsiveness is false. Preserve the
current project revision and recover the editor connection first.

After template activation, browser tools briefly wait for a fresh heartbeat before admission.
If Studio is still settling, the tool can return `isError:true` with
`structuredContent.error = {code:"EDITOR_NOT_READY",retryable:true,admitted:false,
operation,retryAfterMs,health}`. This means the requested operation was not dispatched or queued
for later execution. Keep Studio visible, recheck readiness and the relevant revision, then retry
deliberately. This contract does not apply to execution timeouts or uncertain playout outcomes:
read their status and preserve the original request ID instead of repeating a mutation.

## Connect a local MCP client

Use `ograf-editor` as the server name and Streamable HTTP as the transport. Use the running server's
MCP URL. For local Codex and ChatGPT Desktop sessions, configure the local Codex MCP server. For
Claude Code, use an HTTP MCP server in the desired scope. These commands register the default
endpoint for the current user:

```sh
codex mcp add ograf-editor --url http://127.0.0.1:4318/mcp
claude mcp add --transport http --scope user ograf-editor http://127.0.0.1:4318/mcp
```

Reuse a working OGraf entry if one is already configured. Preserve unrelated settings. In a fresh
session, check that `ograf-editor` connects and call `ograf_get_capabilities` before authoring.

### Claude Desktop on Windows

Claude Desktop's JSON configuration launches local stdio processes. This server uses Streamable
HTTP, so a local compatibility bridge is required:

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

Merge the entry into `%APPDATA%\Claude\claude_desktop_config.json`, then fully restart Claude
Desktop. `--allow-http` is limited to this trusted loopback development endpoint; never use it for
an exposed network server.

## Assistant context and large results

The built-in assistant pages large tool results rather than cutting serialized JSON. Use
`ograf_read_result_page` to inspect referenced fields, array items or string chunks. Pages retain
the original snapshot and revision; they do not execute the source mutation again. Treat expired
or evicted result IDs as unavailable and read current scene state before editing.

External MCP responses keep their existing default shape. The result reader also provides opt-in
paging for allowed read-only source tools. Studio's **Preferences → OGraf Studio → AI assistant**
offers optional token budgets for its built-in agent. Automatic planning uses model metadata when
available, otherwise a reported estimate; explicit overrides do not enlarge an advertised capacity.
The full server-session conversation remains available when old turns leave the active model
request. Neither chat history nor these editor preferences is embedded into `.ogs` or OGraf output.

## Workspace confinement

The MCP server binds only to `127.0.0.1`. Save/export paths are confined to
`OGRAF_WORKSPACE_ROOT`, which defaults to the repository root. Change the root deliberately before
startup when another output directory is required. Changing `OGRAF_MCP_PORT` also requires a
matching `VITE_OGRAF_AGENT_BRIDGE_URL` in the editor.
