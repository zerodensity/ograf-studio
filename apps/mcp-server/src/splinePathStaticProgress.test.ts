import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createProject,
  getResolvedLayerAnimationTracks,
  getLayerPropertyValueAtFrame,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { validateProject } from '@ograf-editor/validation';
import { createOGrafAuthoringHost } from './index';
import { createOGrafMcpServer } from './mcpServer';

it('authors valid unkeyed Spline progress through the actual MCP layout operation', async () => {
  const host = createOGrafAuthoringHost();
  const server = createOGrafMcpServer(host.workspace, host.bridge);
  const client = new Client({ name: 'spline-static-progress', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const sessionId = 'spline-static-progress';
  host.workspace.create(
    sessionId,
    createProject({
      authoringPrompts: [{ id: 'spline-original', text: 'Build a template with a spline path.' }],
    }),
  );
  const call = async (arguments_: Record<string, unknown>) => {
    const result = await client.callTool({ name: 'ograf_apply_operations', arguments: arguments_ });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  };
  try {
    await call({
      sessionId,
      expectedRevision: 0,
      operations: [
        { type: 'add_layer', kind: 'path', name: 'Route' },
        { type: 'add_layer', kind: 'rectangle', name: 'Rider' },
      ],
    });
    const source = host.workspace
      .get(sessionId)
      .snapshot()
      .project.compositions[0]!.layers.find((layer) => layer.name === 'Route')!;
    await call({
      sessionId,
      expectedRevision: 1,
      operations: [
        {
          type: 'set_layer_layout',
          layerName: 'Rider',
          motionPath: {
            sourceLayerId: source.id,
            progress: 0.45,
            orientToPath: true,
            offsetX: 0,
            offsetY: 0,
            rotationOffset: 0,
          },
        },
      ],
    });
    const project = host.workspace.get(sessionId).snapshot().project;
    expect(validateProject(project).errors).toEqual([]);
    const composition = project.compositions[0]!;
    const rider = composition.layers.find((layer) => layer.name === 'Rider')!;
    expect(rider.animationTracks.motionPathProgress).toBeUndefined();
    expect(getResolvedLayerAnimationTracks(rider).motionPathProgress).toMatchObject([
      { frame: 0, value: 0.45 },
    ]);
    expect(getLayerPropertyValueAtFrame(rider, 'motionPathProgress', 12)).toBe(0.45);
    const compiled = compileDescriptor(composition).layers.find((layer) => layer.id === rider.id)!;
    expect(compiled.animationTracks.motionPathProgress?.[0]?.value).toBe(0.45);
  } finally {
    await client.close();
    await server.close();
  }
});
