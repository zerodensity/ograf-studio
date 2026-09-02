import { createServer } from 'node:http';
import { localhostHostValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';
import { EditorBridge } from './editorBridge';
import { createOGrafMcpServer } from './mcpServer';
import { AuthoringWorkspace } from './workspace';
import { createOGrafToolRecords } from '@ograf-editor/agent-tools';
import { ChatAgentController } from './agent/chatAgent';
import { installEmbeddedEditor, installStaticEditor } from './staticEditor';

export interface OGrafAuthoringHostOptions {
  workspaceRoot?: string;
  editorRoot?: string;
  embeddedEditorAssets?: Readonly<Record<string, string>>;
}

export function createOGrafAuthoringHost(options: OGrafAuthoringHostOptions = {}) {
  const app = express();
  // Editable projects can legitimately include packaged fonts, images, Lottie JSON, and source
  // references. Keep this bounded but comfortably above the 100 kB Express default.
  app.use(express.json({ limit: '16mb' }));
  app.use(localhostHostValidation());
  const httpServer = createServer(app);
  const workspace = new AuthoringWorkspace(options.workspaceRoot);
  const bridge = new EditorBridge(httpServer, workspace);
  const chat = new ChatAgentController(createOGrafToolRecords(workspace, bridge), (event) =>
    bridge.sendChatEvent(event),
  );
  bridge.setChatController(chat);

  app.post('/mcp', async (request: Request, response: Response) => {
    const releaseExternal = chat.beginExternalRequest();
    if (!releaseExternal) {
      return response.status(423).json({
        jsonrpc: '2.0',
        error: {
          code: -32004,
          message: 'The in-app agent currently holds the exclusive authoring lock.',
        },
        id: request.body?.id ?? null,
      });
    }
    response.once('close', releaseExternal);
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
  if (options.embeddedEditorAssets) installEmbeddedEditor(app, options.embeddedEditorAssets);
  else if (options.editorRoot) installStaticEditor(app, options.editorRoot);
  return { app, httpServer, workspace, bridge, chat };
}
