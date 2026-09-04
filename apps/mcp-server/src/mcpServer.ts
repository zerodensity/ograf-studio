import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createOGrafToolRecords,
  type AgentToolConfig,
  type AgentToolHandler,
} from '@ograf-editor/agent-tools';
import type { EditorBridge } from './editorBridge';
import type { AuthoringWorkspace } from './workspace';

type RegisterTool = (name: string, config: AgentToolConfig, handler: AgentToolHandler) => unknown;

/** Thin MCP transport renderer over the shared, provider-neutral agent-tool records. */
export function createOGrafMcpServer(
  workspace: AuthoringWorkspace,
  bridge: EditorBridge,
): McpServer {
  const server = new McpServer({ name: 'ograf-editor', version: '0.13.0' });
  const registerTool = server.registerTool.bind(server) as unknown as RegisterTool;
  for (const tool of createOGrafToolRecords(workspace, bridge)) {
    registerTool(tool.name, tool.config, tool.handler);
  }
  return server;
}
