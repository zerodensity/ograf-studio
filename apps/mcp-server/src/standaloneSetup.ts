import { open, readFile, unlink } from 'node:fs/promises';
import { OGRAF_CLIENT_SETUP } from '@ograf-editor/agent-tools';
import { OGRAF_STUDIO_REPOSITORY_URL, OGRAF_STUDIO_STANDALONE_VERSION } from './standaloneConfig';

export function formatStandaloneSetupPrompt(executablePath: string, port: number): string {
  const setup = OGRAF_CLIENT_SETUP;
  const baseUrl = `http://127.0.0.1:${port}`;
  const endpoint = `${baseUrl}/mcp`;
  return `Set up OGraf Studio ${OGRAF_STUDIO_STANDALONE_VERSION}, connect its local MCP server, and install the matching OGraf Authoring skill.

1. Identify whether I use ChatGPT Desktop, Codex CLI, Claude Desktop Chat, or Claude Code. Ask me if unclear. Work on this computer and reuse any matching OGraf setup.
2. Use the Studio executable at ${JSON.stringify(executablePath)}. Verify Studio at ${baseUrl}/ and check ${baseUrl}/health. If Studio is stopped, launch that executable with --port ${port} --open. Keep it on loopback. If another service owns that port, leave it running, choose a free port for Studio, and use Studio's actual URLs in the remaining steps.
3. Run that executable with ${setup.exportFlag} and a new writable path ending in ${setup.archiveName}. Use the full exported archive, including SKILL.md and its references.
4. Connect to ${endpoint} and install the skill for the selected client:
   - ChatGPT Desktop (local Codex): add a Streamable HTTP server in Settings → MCP servers. Use the same skill directory as Codex CLI.
   - Codex CLI: run codex mcp add ${setup.mcpServerName} --url ${endpoint}. Extract the entire ograf-authoring folder to ${setup.codexSkillPath}.
   - Claude Code: run claude mcp add --transport http --scope user ${setup.mcpServerName} ${endpoint}. Extract the entire ograf-authoring folder to ${setup.claudeCodeSkillPath}.
   - Claude Desktop Chat: open the client's local MCP configuration. Add a server named ${setup.mcpServerName} under mcpServers with command npx and arguments ["-y", "mcp-remote", "${endpoint}", "--allow-http"]. This bridge uses Node.js and npm. Upload and enable the exported ZIP in ${setup.claudeDesktopSkillMenu}. The local bridge guide is at ${OGRAF_STUDIO_REPOSITORY_URL}/blob/stable/docs/AI_AUTHORING.md#claude-desktop-configuration-on-windows.
   SKILL.md should sit directly inside each installed ograf-authoring directory. Back up configuration before editing it, preserve other entries, and reuse an existing OGraf connection or skill instead of adding a duplicate.
5. Open a fresh local client session and invoke ograf-authoring. Verify it can call the read-only ograf_get_capabilities tool. Report the Studio URL, MCP endpoint and skill version. If this session cannot perform a local step, give me the exact remaining action.`;
}

export async function exportBundledAuthoringSkill(
  embeddedPath: string,
  destination: string,
): Promise<void> {
  const bytes = await readFile(embeddedPath);
  const output = await open(destination, 'wx');
  try {
    await output.writeFile(bytes);
    await output.close();
  } catch (error) {
    await output.close().catch(() => undefined);
    await unlink(destination).catch(() => undefined);
    throw error;
  }
}
