import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocket, type RawData } from 'ws';
import { expect, it } from 'vitest';
import { createRectangleLayer } from '@ograf-editor/scene-model';
import { createOGrafAuthoringHost } from './index';

function nextMessage(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', receive);
      reject(new Error(`No ${type} response.`));
    }, 2000);
    const receive = (raw: RawData) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type === 'editor.error') {
        clearTimeout(timer);
        socket.off('message', receive);
        reject(new Error(String(message.message)));
        return;
      }
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.off('message', receive);
      resolve(message);
    };
    socket.on('message', receive);
  });
}

it('marks a standalone MCP file open across the live bridge without marking ordinary edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ograf-document-open-'));
  const host = createOGrafAuthoringHost({ workspaceRoot: root });
  const client = new Client({ name: 'document-open-regression', version: '1.0.0' });
  let socket: WebSocket | null = null;
  try {
    await new Promise<void>((resolve) => host.httpServer.listen(0, '127.0.0.1', resolve));
    const port = (host.httpServer.address() as AddressInfo).port;
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
    );
    socket = new WebSocket(`ws://127.0.0.1:${port}/editor`);
    await new Promise<void>((resolve, reject) => {
      socket!.once('open', resolve);
      socket!.once('error', reject);
    });
    const before = host.workspace.get('editor').snapshot().project;
    before.compositions[0]!.components.push({
      id: 'previous-set-source',
      name: 'Previous set source',
      scope: 'set',
      layers: [createRectangleLayer()],
      dataFields: [],
    });
    host.workspace.initializeEditorProject(before);
    let reply = nextMessage(socket, 'editor.ack');
    socket.send(JSON.stringify({ type: 'editor.hello', project: before }));
    await reply;

    // Standalone exports retain the set child's ID, so ID comparison cannot identify this open.
    const standalone = structuredClone(before);
    standalone.compositions[0]!.components = [];
    await writeFile(join(root, 'standalone.ogs'), JSON.stringify(standalone));
    reply = nextMessage(socket, 'project.replace');
    const opened = await client.callTool({
      name: 'ograf_open_project',
      arguments: { sessionId: 'editor', path: 'standalone.ogs' },
    });
    expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
    expect(await reply).toMatchObject({
      type: 'project.replace',
      documentContext: 'standalone',
      project: { id: before.id },
    });

    reply = nextMessage(socket, 'project.replace');
    const edited = await client.callTool({
      name: 'ograf_apply_operations',
      arguments: {
        sessionId: 'editor',
        expectedRevision: host.workspace.get('editor').revision,
        operations: [{ type: 'add_layer', kind: 'rectangle', name: 'Ordinary edit' }],
      },
    });
    expect(edited.isError, JSON.stringify(edited.content)).not.toBe(true);
    expect((await reply).documentContext).toBeUndefined();
  } finally {
    await client.close();
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      const closed = new Promise<void>((resolve) => socket!.once('close', () => resolve()));
      socket.close();
      await closed;
    }
    await new Promise<void>((resolve, reject) =>
      host.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(join(root, 'standalone.ogs'), { force: true });
    await rmdir(root);
  }
});
