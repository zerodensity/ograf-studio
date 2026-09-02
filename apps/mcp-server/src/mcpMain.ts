import { createOGrafAuthoringHost } from './index';

const port = Number(process.env.OGRAF_MCP_PORT ?? 4318);
const { httpServer, workspace } = createOGrafAuthoringHost();

httpServer.listen(port, '127.0.0.1', () => {
  console.log(`OGraf authoring MCP: http://127.0.0.1:${port}/mcp`);
  console.log(`Editor bridge: ws://127.0.0.1:${port}/editor`);
  console.log(`Workspace root: ${workspace.root}`);
});
