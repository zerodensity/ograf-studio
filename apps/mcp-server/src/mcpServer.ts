import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import {
  createOGrafToolRecords,
  listedToolRecords,
  OGRAF_CLIENT_SETUP,
  type AgentToolConfig,
  type AgentToolHandler,
  type AgentToolRecord,
} from '@ograf-editor/agent-tools';
import type { AgentToolUsage } from './agentToolUsage';
import type { EditorBridge } from './editorBridge';
import type { AuthoringWorkspace } from './workspace';

type RegisterTool = (name: string, config: AgentToolConfig, handler: AgentToolHandler) => unknown;
type ListTools = (request: unknown, extra: unknown) => ListToolsResult | Promise<ListToolsResult>;
type CallTool = (request: CallToolRequest, extra: unknown) => Promise<CallToolResult>;

/** Thin MCP transport renderer over the shared, provider-neutral agent-tool records. */
export function createOGrafMcpServer(
  workspace: AuthoringWorkspace,
  bridge: EditorBridge,
  { usage, ...options }: { bundledAuthoringSkill?: boolean; usage?: AgentToolUsage } = {},
): McpServer {
  const server = new McpServer({ name: OGRAF_CLIENT_SETUP.mcpServerName, version: '0.34.0' });
  const records = createOGrafToolRecords(workspace, bridge, options);
  const listed = listedToolRecords(records);
  wrapToolRequests(server, {
    list: (handler) => (request, extra) => listOnly(listed, handler(request, extra)),
    call: usage ? (handler) => (request, extra) => counted(usage, request, handler, extra) : null,
  });
  const registerTool = server.registerTool.bind(server) as unknown as RegisterTool;
  for (const tool of records) registerTool(tool.name, tool.config, tool.handler);
  return server;
}

/**
 * The SDK installs its own handlers for listing and calling tools when the first tool is
 * registered. This puts a wrapper around each as it is installed.
 */
function wrapToolRequests(
  server: McpServer,
  wrap: { list: (handler: ListTools) => ListTools; call: ((handler: CallTool) => CallTool) | null },
): void {
  const protocol = server.server;
  const setRequestHandler = protocol.setRequestHandler.bind(protocol) as (
    schema: unknown,
    handler: unknown,
  ) => void;
  protocol.setRequestHandler = ((schema: unknown, handler: unknown) =>
    setRequestHandler(
      schema,
      schema === ListToolsRequestSchema
        ? wrap.list(handler as ListTools)
        : schema === CallToolRequestSchema && wrap.call
          ? wrap.call(handler as CallTool)
          : handler,
    )) as typeof protocol.setRequestHandler;
}

/**
 * Every record is registered with all it accepts, so an earlier tool or operation name still
 * answers a caller. The SDK lists whatever is registered; this narrows what it reports to the
 * given records and to the schema each one chooses to show.
 */
async function listOnly(
  listed: readonly AgentToolRecord[],
  result: ListToolsResult | Promise<ListToolsResult>,
): Promise<ListToolsResult> {
  const byName = new Map(listed.map((record) => [record.name, record]));
  const all = await result;
  return {
    ...all,
    tools: all.tools.flatMap((tool) => {
      const record = byName.get(tool.name);
      if (!record) return [];
      const inputSchema = record.listSchema?.(tool.inputSchema) ?? tool.inputSchema;
      return [{ ...tool, inputSchema: inputSchema as typeof tool.inputSchema }];
    }),
  };
}

/** Counts the call, and a refusal when the SDK or the tool turns it down. */
async function counted(
  usage: AgentToolUsage,
  request: CallToolRequest,
  handler: CallTool,
  extra: unknown,
): Promise<CallToolResult> {
  const { name, arguments: args } = request.params;
  usage.called('mcp', name, args);
  try {
    const result = await handler(request, extra);
    if (result.isError)
      usage.refused(
        'mcp',
        name,
        result.content.map((item) => (item.type === 'text' ? item.text : '')).join(' '),
      );
    return result;
  } catch (error) {
    usage.refused('mcp', name, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
