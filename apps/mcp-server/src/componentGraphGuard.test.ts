import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import {
  buildComponentDefinition,
  createComponentGraphContext,
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  linkExistingComponentLayers,
  type ComponentGraphContext,
  type Project,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { applyAuthoringOperations } from '@ograf-editor/authoring-core';
import { EditorBridge } from './editorBridge';
import { AuthoringWorkspace } from './workspace';

function fixture() {
  const project = createProject();
  const composition = project.compositions[0]!;
  const [panel, detail, addition] = ['Panel', 'Detail', 'Added part'].map((name) => {
    const layer = createLayerOfKind('rectangle');
    layer.name = name;
    layer.keyframes = [createLayerKeyframe(0, createDefaultTransform())];
    return layer;
  });
  composition.layers.push(panel!, detail!, addition!);
  const component = buildComponentDefinition(composition, [panel!.id, detail!.id], 'Shared panel');
  component.scope = 'set';
  composition.components.push(component);
  linkExistingComponentLayers(composition, component, [panel!.id, detail!.id]);
  const graph = (sourceLayerId: string): TransitionLogicDefinition => ({
    version: 3,
    id: 'news',
    name: 'News',
    slots: [{ id: 'main', name: 'Main', order: 0 }],
    states: [{ id: 'headline', name: 'Headline', slotId: 'main', templateId: 'template-main' }],
    transitions: [
      {
        id: 'fade',
        name: 'Fade',
        durationFrames: 12,
        outgoingFrames: 12,
        incomingStartFrame: 0,
        incomingFrames: 12,
        sharedFrames: 12,
        easing: 'linear',
      },
    ],
    routes: [],
    defaultTransitionId: 'fade',
    sharedInstances: [
      {
        id: 'panel',
        name: 'Panel',
        componentAssetId: component.id,
        continuityKey: 'panel',
        slotId: 'main',
      },
    ],
    initialSharedValues: [{ instanceId: 'panel', sourceLayerId, property: 'height', value: 100 }],
  });
  const context = (sourceLayerId: string, candidate = project): ComponentGraphContext =>
    createComponentGraphContext(
      project.id,
      ['template-main'],
      graph(sourceLayerId),
      candidate.compositions[0]!.components,
    );
  const operation = (layerIds: string[]) => ({
    type: 'update_component_from_layers' as const,
    compositionId: composition.id,
    componentId: component.id,
    layerIds,
  });
  return {
    project,
    panel: panel!,
    detail: detail!,
    addition: addition!,
    component,
    context,
    operation,
  };
}

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

function nextMessage(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', receive);
      reject(new Error(`No ${type} reply`));
    }, 2_000);
    const receive = (raw: { toString(): string }) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.off('message', receive);
      resolve(message);
    };
    socket.on('message', receive);
  });
}

async function connected(project: Project, context?: ComponentGraphContext | null) {
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
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as Record<string, unknown>;
    if (message.type === 'heartbeat.request')
      socket.send(JSON.stringify({ type: 'heartbeat.result', requestId: message.requestId }));
  });
  const ack = nextMessage(socket, 'editor.ack');
  socket.send(
    JSON.stringify({
      type: 'editor.hello',
      project,
      ...(context !== undefined ? { componentGraphContext: context } : {}),
    }),
  );
  await ack;
  const updateGraph = async (componentGraphContext: ComponentGraphContext | null) => {
    socket.send(JSON.stringify({ type: 'editor.component-graph', componentGraphContext }));
    // Same-project acknowledgement is a FIFO barrier; the graph-only event itself is revision-free.
    const barrier = nextMessage(socket, 'editor.ack');
    socket.send(
      JSON.stringify({ type: 'editor.project', project: workspace.get().snapshot().project }),
    );
    await barrier;
  };
  return { workspace, session: workspace.get(), bridge, socket, updateGraph };
}

describe('connected editor component graph guard', () => {
  it('blocks an unsafe authoring mutation before revision, project or undo publication', async () => {
    const f = fixture();
    const { session } = await connected(f.project, f.context(f.detail.id));
    const before = session.snapshot();
    const changes = session.getChanges(0);
    const events: unknown[] = [];
    session.subscribe((change) => events.push(change));
    expect(() =>
      session.apply({ expectedRevision: 0, operations: [f.operation([f.panel.id])] }),
    ).toThrow(/blocked by playout transitions/);
    expect(session.snapshot()).toEqual(before);
    expect(session.getChanges(0)).toEqual(changes);
    expect(events).toEqual([]);
    expect(() => session.undo(0)).toThrow('Nothing to undo');
  });

  it('accepts a legal addition and applies a later graph-only reference update before undo', async () => {
    const f = fixture();
    const { session, updateGraph } = await connected(f.project, f.context(f.detail.id));
    const added = session.apply({
      expectedRevision: 0,
      operations: [f.operation([f.panel.id, f.detail.id, f.addition.id])],
    });
    expect(added.revision).toBe(1);
    await updateGraph(f.context(f.addition.id, added.project));
    expect(session.revision).toBe(1);
    const before = session.snapshot();
    expect(() => session.undo(1)).toThrow(/unknown shared source layer/);
    expect(session.snapshot()).toEqual(before);
    expect(() =>
      session.apply({ expectedRevision: 1, operations: [f.operation([f.panel.id, f.detail.id])] }),
    ).toThrow(/unknown shared source layer/);
    await updateGraph(f.context(f.detail.id, added.project));
    expect(session.undo(1).revision).toBe(2);
    expect(session.redo(2).project).toEqual(added.project);
  });

  it('rejects unsafe browser project updates while preserving the last valid session', async () => {
    const f = fixture();
    const { session, socket } = await connected(f.project, f.context(f.detail.id));
    const before = session.snapshot();
    const unsafe = applyAuthoringOperations(before.project, [f.operation([f.panel.id])]).project;
    const reply = nextMessage(socket, 'editor.error');
    socket.send(JSON.stringify({ type: 'editor.project', project: unsafe }));
    expect((await reply).message).toEqual(
      expect.stringContaining('blocked by playout transitions'),
    );
    expect(session.snapshot()).toEqual(before);
    expect(session.getChanges(0)).toEqual([]);
  });

  it('fails shared structure edits closed for an older editor but permits nonstructural edits', async () => {
    const f = fixture();
    const { session, workspace } = await connected(f.project);
    expect(() =>
      session.apply({ expectedRevision: 0, operations: [f.operation([f.panel.id])] }),
    ).toThrow(/Reload connected Studio/);
    expect(
      session.apply({
        expectedRevision: 0,
        operations: [
          {
            type: 'update_component_layer',
            compositionId: f.project.mainCompositionId,
            componentId: f.component.id,
            sourceLayerId: f.panel.id,
            patch: { element: { fill: '#146aff' } },
          },
        ],
      }).revision,
    ).toBe(1);
    const independent = workspace.create('offline', f.project);
    expect(
      independent.apply({ expectedRevision: 0, operations: [f.operation([f.panel.id])] }).revision,
    ).toBe(1);
  });

  it('accepts an explicit no-set context without blocking ordinary shared source editing', async () => {
    const f = fixture();
    const { session } = await connected(f.project, null);
    expect(
      session.apply({ expectedRevision: 0, operations: [f.operation([f.panel.id])] }).revision,
    ).toBe(1);
  });

  it('fails structural edits closed for stale graph context from another project', async () => {
    const f = fixture();
    const stale = { ...f.context(f.detail.id), projectId: 'previous-template-project' };
    const { session, updateGraph } = await connected(f.project, stale);
    const before = session.snapshot();
    expect(() =>
      session.apply({ expectedRevision: 0, operations: [f.operation([f.panel.id])] }),
    ).toThrow(/Reload connected Studio/);
    expect(session.snapshot()).toEqual(before);
    expect(session.getChanges(0)).toEqual([]);
    await updateGraph(f.context(f.detail.id));
    expect(
      session.apply({
        expectedRevision: 0,
        operations: [f.operation([f.panel.id, f.detail.id, f.addition.id])],
      }).revision,
    ).toBe(1);
  });
});
