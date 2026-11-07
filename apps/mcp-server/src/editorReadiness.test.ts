import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createProject } from '@ograf-editor/scene-model';
import { createOGrafToolRecords } from '@ograf-editor/agent-tools';
import { EditorBridge, EditorReadinessError } from './editorBridge';
import { AuthoringWorkspace } from './workspace';

const active: Array<{ server: Server; socket: WebSocket }> = [];
afterEach(async () => {
  for (const { server, socket } of active.splice(0)) {
    if (socket.readyState !== WebSocket.CLOSED) {
      const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
      socket.terminate();
      await closed;
    }
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

type Message = { type: string; requestId: string };
const pixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XcJR8QAAAABJRU5ErkJggg==';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connected() {
  const workspace = new AuthoringWorkspace();
  const server = createServer((_request, response) => response.writeHead(404).end());
  const bridge = new EditorBridge(server, workspace);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/editor`);
  active.push({ server, socket });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  let holdHeartbeats = false;
  const held: Message[] = [];
  const received: Message[] = [];
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as Message;
    received.push(message);
    if (message.type === 'heartbeat.request') {
      if (holdHeartbeats) held.push(message);
      else send({ type: 'heartbeat.result', requestId: message.requestId });
    } else if (message.type === 'template-set.request') {
      const command = message as Message & { request: { action: string } };
      if (command.request.action === 'command') holdHeartbeats = true;
      send({
        type: 'template-set.result',
        requestId: message.requestId,
        result: { activeTemplateId: 'new-template' },
        ...(command.request.action === 'command' ? { project: createProject() } : {}),
      });
    } else if (message.type === 'capture.request') {
      send({
        type: 'capture.result',
        requestId: message.requestId,
        result: {
          mimeType: 'image/png',
          data: pixel,
          width: 1,
          height: 1,
          originalWidth: 1,
          originalHeight: 1,
          resolvedFonts: [],
        },
      });
    } else if (message.type === 'certification.request') {
      send({
        type: 'certification.result',
        requestId: message.requestId,
        result: { valid: true, checks: [], errors: [] },
      });
    }
  });
  send({
    type: 'editor.hello',
    project: workspace.get().snapshot().project,
    capabilities: ['template-sets-v1', 'playout-v1'],
  });
  for (let i = 0; i < 100 && !bridge.health.responsive; i++) await wait(5);
  expect(bridge.health.responsive).toBe(true);
  const activate = () =>
    bridge.requestTemplateSet({
      action: 'command',
      operation: { type: 'activate_template', templateId: 'new-template' },
    });
  const capture = (timeoutMs = 1000) =>
    bridge.capture(
      {
        target: 'composition',
        project: workspace.get().snapshot().project,
        frame: 0,
        maxDimension: 64,
        matte: 'checker',
      },
      timeoutMs,
    );
  return {
    bridge,
    socket,
    workspace,
    received,
    activate,
    capture,
    hold: () => {
      holdHeartbeats = true;
    },
    release: () => {
      holdHeartbeats = false;
      for (const message of held.splice(0))
        send({ type: 'heartbeat.result', requestId: message.requestId });
    },
  };
}

describe('browser operation readiness admission', () => {
  it('waits for activation to settle before immediate capture, certification and set read', async () => {
    const f = await connected();
    await f.activate();
    expect(f.bridge.health.likelyCause).toBe('editor-updating');
    const before = f.received.length;
    const capture = f.capture();
    const certification = f.bridge.certify({} as never, 1000);
    const read = f.bridge.requestTemplateSet({ action: 'read' }, 1000);
    await wait(25);
    expect(
      f.received
        .slice(before)
        .filter((m) =>
          ['capture.request', 'certification.request', 'template-set.request'].includes(m.type),
        ),
    ).toEqual([]);
    f.release();
    await expect(capture).resolves.toMatchObject({ width: 1 });
    await expect(certification).resolves.toMatchObject({ valid: true });
    await expect(read).resolves.toMatchObject({ activeTemplateId: 'new-template' });
    expect(f.received.filter((m) => m.type === 'capture.request')).toHaveLength(1);
    expect(f.bridge.health.responsive).toBe(true);
  });

  it('re-probes a stale heartbeat instead of treating transient activation work as a permanent failure', async () => {
    const f = await connected();
    f.hold();
    // The ordinary heartbeat interval starts a pending probe while this tab is busy.
    await wait(1800);
    expect(f.bridge.health.responsive).toBe(false);
    const capture = f.capture();
    await wait(20);
    f.release();
    await expect(capture).resolves.toMatchObject({ width: 1 });
    expect(f.received.filter((m) => m.type === 'capture.request')).toHaveLength(1);
  });

  it('returns a bounded retryable readiness error without admitting or later replaying the operation', async () => {
    const f = await connected();
    await f.activate();
    const revision = f.workspace.get().revision;
    await expect(f.capture(30)).rejects.toMatchObject({
      code: 'EDITOR_NOT_READY',
      retryable: true,
      admitted: false,
      operation: 'capture',
      retryAfterMs: 250,
      health: { likelyCause: 'editor-updating' },
    });
    expect(f.received.filter((m) => m.type === 'capture.request')).toHaveLength(0);
    f.release();
    await wait(20);
    expect(f.received.filter((m) => m.type === 'capture.request')).toHaveLength(0);
    expect(f.workspace.get().revision).toBe(revision);
    await expect(f.capture()).resolves.toMatchObject({ width: 1 });
  });

  it('confirms recovery when an activation heartbeat itself finishes late', async () => {
    const f = await connected();
    await f.activate();
    const capture = f.capture(1500);
    await wait(800);
    f.release();
    await expect(capture).resolves.toMatchObject({ width: 1 });
    expect(f.received.filter((m) => m.type === 'capture.request')).toHaveLength(1);
    expect(f.bridge.health.responsive).toBe(true);
  });

  it('does not dispatch queued browser work into a disconnected or replaced editor session', async () => {
    const f = await connected();
    await f.activate();
    const capture = f.capture();
    const rejected = expect(capture).rejects.toMatchObject({
      code: 'EDITOR_NOT_READY',
      admitted: false,
    });
    f.socket.close();
    await rejected;
    expect(f.received.filter((m) => m.type === 'capture.request')).toHaveLength(0);
  });

  it('preserves the structured readiness state through provider-neutral MCP tool handlers', async () => {
    const f = await connected();
    const bridge = Object.create(f.bridge) as EditorBridge;
    bridge.requestTemplateSet = async () => {
      throw new EditorReadinessError('template-set operation', f.bridge.health);
    };
    const tool = createOGrafToolRecords(f.workspace, bridge).find(
      (item) => item.name === 'ograf_get_template_set',
    )!;
    await expect(tool.handler({})).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: 'EDITOR_NOT_READY',
          retryable: true,
          admitted: false,
          operation: 'template-set operation',
          retryAfterMs: 250,
        },
      },
    });
  });
});
