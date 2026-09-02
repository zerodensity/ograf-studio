import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createOGrafAuthoringHost } from './index';
import { assertStaticEditorRoot } from './staticEditor';
import {
  OGRAF_STUDIO_REPOSITORY_URL,
  OGRAF_STUDIO_STANDALONE_VERSION,
  parseStandaloneServerOptions,
  STANDALONE_HELP,
  ZERO_DENSITY_ASCII_ART,
} from './standaloneConfig';

function resolveEmbeddedEditorAssets(): Readonly<Record<string, string>> | undefined {
  return (
    globalThis as {
      __OGRAF_STANDALONE_ASSETS__?: Readonly<Record<string, string>>;
    }
  ).__OGRAF_STANDALONE_ASSETS__;
}

function openDefaultBrowser(url: string): void {
  const command =
    process.platform === 'win32'
      ? 'rundll32.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function main(): Promise<void> {
  const options = parseStandaloneServerOptions(process.argv.slice(2));
  if (options.help) {
    console.log(STANDALONE_HELP);
    return;
  }

  const embeddedEditorAssets = resolveEmbeddedEditorAssets();
  const editorRoot = fileURLToPath(new URL('../../editor/dist/', import.meta.url));
  if (!embeddedEditorAssets) await assertStaticEditorRoot(editorRoot);
  await mkdir(options.workspaceRoot, { recursive: true });

  const { httpServer, workspace } = createOGrafAuthoringHost({
    ...(embeddedEditorAssets ? { embeddedEditorAssets } : { editorRoot }),
    workspaceRoot: options.workspaceRoot,
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${options.port}`;
  console.log(ZERO_DENSITY_ASCII_ART);
  console.log('');
  console.log(`OGraf Studio ${OGRAF_STUDIO_STANDALONE_VERSION} standalone server`);
  console.log(`Repository: ${OGRAF_STUDIO_REPOSITORY_URL}`);
  console.log('');
  console.log(`Editor:    ${baseUrl}/`);
  console.log(`MCP:       ${baseUrl}/mcp`);
  console.log(`Health:    ${baseUrl}/health`);
  console.log(`Workspace: ${workspace.root}`);
  console.log('Press Ctrl+C to stop.');
  if (options.openBrowser) openDefaultBrowser(`${baseUrl}/`);

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void closeServer(httpServer).finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
