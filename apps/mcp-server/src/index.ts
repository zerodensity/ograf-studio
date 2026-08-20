import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { EditorBridge } from './editorBridge';
import { createOGrafMcpServer } from './mcpServer';
import { AuthoringWorkspace } from './workspace';

export function createOGrafAuthoringHost() {
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  const httpServer = createServer(app);
  const workspace = new AuthoringWorkspace();
  const bridge = new EditorBridge(httpServer, workspace);

  app.post('/mcp', async (request: Request, response: Response) => {
    const mcp = createOGrafMcpServer(workspace, bridge);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error('MCP request failed:', error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
          id: null,
        });
      }
    }
  });
  app.get('/mcp', (_request: Request, response: Response) =>
    response.status(405).json({ error: 'Method not allowed.' }),
  );
  app.delete('/mcp', (_request: Request, response: Response) =>
    response.status(405).json({ error: 'Method not allowed.' }),
  );
  app.get('/health', (_request: Request, response: Response) =>
    response.json({ ok: true, editorConnected: bridge.connected, workspaceRoot: workspace.root }),
  );
  app.get('/captures/:token', (request: Request, response: Response) => {
    const token = request.params.token;
    const asset = bridge.getCaptureAsset(typeof token === 'string' ? token : '');
    if (!asset) return response.status(404).json({ error: 'Capture not found or expired.' });
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Content-Length', asset.data.length);
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return response.send(asset.data);
  });
  return { app, httpServer, workspace, bridge };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.OGRAF_MCP_PORT ?? 4318);
  const { httpServer, workspace } = createOGrafAuthoringHost();
  httpServer.listen(port, '127.0.0.1', () => {
    console.log(`OGraf authoring MCP: http://127.0.0.1:${port}/mcp`);
    console.log(`Editor bridge: ws://127.0.0.1:${port}/editor`);
    console.log(`Workspace root: ${workspace.root}`);
  });
}
