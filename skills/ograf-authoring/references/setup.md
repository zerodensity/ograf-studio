# Local editor and MCP setup

Read this reference when the `ograf-editor` MCP dependency is unavailable, the editor bridge is
disconnected, or a local MCP client needs configuration.

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
2. If the server is unavailable, start or restart `npm run mcp:start`.
3. If the socket is connected but capabilities report the editor as unresponsive, focus the editor
   tab and recheck `ograf_get_capabilities`.
4. Rebuild `packages/ograf-runtime` after runtime source changes; root `dev`, `mcp:start`, `test`,
   `build`, and `verify` do this automatically.

Do not repeatedly retry browser-dependent mutations while responsiveness is false. Preserve the
current project revision and recover the editor connection first.

## Claude Desktop on Windows

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

## Workspace confinement

The MCP server binds only to `127.0.0.1`. Save/export paths are confined to
`OGRAF_WORKSPACE_ROOT`, which defaults to the repository root. Change the root deliberately before
startup when another output directory is required. Changing `OGRAF_MCP_PORT` also requires a
matching `VITE_OGRAF_AGENT_BRIDGE_URL` in the editor.
