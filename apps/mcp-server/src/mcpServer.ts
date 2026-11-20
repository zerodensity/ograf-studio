import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema, type ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import {
  createOGrafToolRecords,
  listedToolRecords,
  OGRAF_CLIENT_SETUP,
  type AgentToolConfig,
  type AgentToolHandler,
} from '@ograf-editor/agent-tools';
import type { EditorBridge } from './editorBridge';
import type { AuthoringWorkspace } from './workspace';

type RegisterTool = (name: string, config: AgentToolConfig, handler: AgentToolHandler) => unknown;
type ListToolsHandler = (
  request: unknown,
  extra: unknown,
) => ListToolsResult | Promise<ListToolsResult>;

/** Thin MCP transport renderer over the shared, provider-neutral agent-tool records. */
export function createOGrafMcpServer(
  workspace: AuthoringWorkspace,
  bridge: EditorBridge,
  options: { bundledAuthoringSkill?: boolean } = {},
): McpServer {
  const server = new McpServer({ name: OGRAF_CLIENT_SETUP.mcpServerName, version: '0.34.0' });
  const records = createOGrafToolRecords(workspace, bridge, options);
  listOnly(server, new Set(listedToolRecords(records).map((record) => record.name)));
  const registerTool = server.registerTool.bind(server) as unknown as RegisterTool;
  for (const tool of records) registerTool(tool.name, tool.config, tool.handler);
  return server;
}

/**
 * Every record is registered, so an earlier tool name still answers a caller. The SDK lists
 * whatever is registered; this narrows the list it reports to the given names.
 */
function listOnly(server: McpServer, listed: ReadonlySet<string>): void {
  const protocol = server.server;
  const setRequestHandler = protocol.setRequestHandler.bind(protocol) as (
    schema: unknown,
    handler: unknown,
  ) => void;
  protocol.setRequestHandler = ((schema: unknown, handler: unknown) =>
    setRequestHandler(
      schema,
      schema === ListToolsRequestSchema
        ? async (request: unknown, extra: unknown) => {
            const result = await (handler as ListToolsHandler)(request, extra);
            return { ...result, tools: result.tools.filter((tool) => listed.has(tool.name)) };
          }
        : handler,
    )) as typeof protocol.setRequestHandler;
}
