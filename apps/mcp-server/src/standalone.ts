import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { OGRAF_CLIENT_SETUP } from '@ograf-editor/agent-tools';
import { createOGrafAuthoringHost } from './index';
import { assertStaticEditorRoot } from './staticEditor';
import { exportBundledAuthoringSkill, formatStandaloneSetupPrompt } from './standaloneSetup';
import {
  createSharedPlayoutHost,
  loadSharedPlayoutAssets,
  type SharedPlayoutAssetPaths,
} from './sharedPlayout';
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

async function listen(server: Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const options = parseStandaloneServerOptions(process.argv.slice(2));
  if (options.help) {
    console.log(STANDALONE_HELP);
    return;
  }

  const embeddedSkillAsset = (globalThis as { __OGRAF_STANDALONE_SKILL__?: string })
    .__OGRAF_STANDALONE_SKILL__;
  if (options.printSetupPrompt || options.exportSkillPath) {
    if (!embeddedSkillAsset)
      throw new Error(
        'This command requires the packaged OGraf Studio executable. A source checkout has the archive at skills/ograf-authoring/ograf-authoring.zip.',
      );
    if (options.printSetupPrompt) {
      console.log(formatStandaloneSetupPrompt(process.execPath, options.port));
    } else if (options.exportSkillPath) {
      await exportBundledAuthoringSkill(embeddedSkillAsset, options.exportSkillPath);
      console.log(`Exported the authoring skill to ${options.exportSkillPath}`);
    }
    return;
  }

  const embeddedEditorAssets = resolveEmbeddedEditorAssets();
  const editorRoot = fileURLToPath(new URL('../../editor/dist/', import.meta.url));
  if (!embeddedEditorAssets) await assertStaticEditorRoot(editorRoot);
  await mkdir(options.workspaceRoot, { recursive: true });

  const embeddedPlayoutAssets = (
    globalThis as { __OGRAF_STANDALONE_PLAYOUT_ASSETS__?: SharedPlayoutAssetPaths }
  ).__OGRAF_STANDALONE_PLAYOUT_ASSETS__;
  const sharedPlayout = options.playout
    ? createSharedPlayoutHost(
        options.playout.host,
        await loadSharedPlayoutAssets(embeddedPlayoutAssets),
      )
    : undefined;
  const { httpServer, workspace } = createOGrafAuthoringHost({
    ...(embeddedEditorAssets ? { embeddedEditorAssets } : { editorRoot }),
    workspaceRoot: options.workspaceRoot,
    bundledAuthoringSkill: Boolean(embeddedSkillAsset),
    sharedPlayout,
  });
  await listen(httpServer, options.port, '127.0.0.1');
  if (sharedPlayout && options.playout) {
    try {
      await listen(sharedPlayout.httpServer, options.playout.port, options.playout.host);
    } catch (error) {
      await closeServer(httpServer);
      throw error;
    }
  }

  const baseUrl = `http://127.0.0.1:${options.port}`;
  console.log(ZERO_DENSITY_ASCII_ART);
  console.log('');
  console.log(`OGraf Studio ${OGRAF_STUDIO_STANDALONE_VERSION} standalone server`);
  console.log(`Repository: ${OGRAF_STUDIO_REPOSITORY_URL}`);
  console.log('');
  console.log(`Editor:    ${baseUrl}/`);
  console.log(`MCP:       ${baseUrl}/mcp`);
  console.log(`Health:    ${baseUrl}/health`);
  if (sharedPlayout)
    console.log(
      `Shared playout: ${sharedPlayout.origin().origin} (publish from Studio for private links)`,
    );
  console.log(`Workspace: ${workspace.root}`);
  if (embeddedSkillAsset)
    console.log(
      `AI setup:  Run this executable with ${OGRAF_CLIENT_SETUP.promptFlag} --port ${options.port}`,
    );
  console.log('Press Ctrl+C to stop.');
  if (options.openBrowser) openDefaultBrowser(`${baseUrl}/`);

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    sharedPlayout?.disconnectClients();
    const listeners = sharedPlayout ? [httpServer, sharedPlayout.httpServer] : [httpServer];
    void Promise.allSettled(listeners.map(closeServer)).then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
