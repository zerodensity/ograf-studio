import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createProject } from '@ograf-editor/scene-model';
import { createOGrafAuthoringHost } from './index';
import { createOGrafMcpServer } from './mcpServer';

function modifierFixture() {
  return createProject({
    authoringPrompts: [
      { id: 'modifiers-original', text: 'Create a template with smart modifiers.' },
    ],
  });
}

it('discovers and authors editable smart modifiers over the real MCP transport', async () => {
  const host = createOGrafAuthoringHost();
  const server = createOGrafMcpServer(host.workspace, host.bridge);
  const client = new Client({ name: 'modifier-contract-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const sessionId = 'modifiers-wire';
  host.workspace.create(sessionId, modifierFixture());
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    return result.structuredContent as Record<string, unknown>;
  };
  try {
    const capabilities = await call('ograf_get_capabilities', { sections: ['elements'] });
    expect(capabilities.modifiers).toMatchObject({
      types: [
        'max-text-width',
        'auto-size',
        'auto-follow',
        'hide-empty',
        'grid-arrange',
        'radial-arrange',
        'justify',
        'look-at',
      ],
      parameters: {
        'grid-arrange': { params: { columns: { min: 1, max: 256 }, rows: { min: 0 } } },
        'radial-arrange': { params: { count: { max: 1024 }, rings: { min: 1, max: 64 } } },
        'look-at': { params: { rotationOffset: { min: -360, max: 360 } } },
      },
      staticParameters: {
        'grid-arrange': { direction: ['horizontal', 'vertical'] },
        'radial-arrange': { arrangement: ['equal', 'radiate'], orient: 'boolean' },
        justify: { horizontal: ['none', 'left', 'center', 'right'] },
        'look-at': { source: 'geometry-reference', axis: ['x', 'y'] },
      },
      splinePath: { progress: { min: 0, max: 1, property: 'motionPathProgress' } },
    });
    await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 0,
      operations: [
        { type: 'add_layer', kind: 'text', name: 'Presenter' },
        { type: 'add_layer', kind: 'rectangle', name: 'Background' },
        {
          type: 'add_data_field',
          fieldType: 'number',
          key: 'width',
          label: 'Maximum Width',
          defaultValue: 600,
        },
      ],
    });
    let composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    const titleId = composition.layers.find((layer) => layer.name === 'Presenter')!.id;
    const fieldId = composition.dataFields.find((field) => field.key === 'width')!.id;
    const added = await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 1,
      operations: [
        { type: 'add_modifier', layerName: 'Presenter', modifierType: 'max-text-width' },
        {
          type: 'add_modifier',
          layerName: 'Background',
          modifierType: 'auto-size',
          params: { source: { kind: 'layer', layerId: titleId }, height: false },
        },
      ],
    });
    const results = added.results as Array<{ id: string; layerId: string; properties: string[] }>;
    const modifier = results.find((result) => result.layerId === titleId)!;
    expect(modifier.id).toMatch(/^modifier-/);
    const property = `modifiers.${modifier.id}.maxWidth` as const;
    expect(modifier.properties).toContain(property);
    await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 2,
      operations: [
        {
          type: 'set_layer_bindings',
          layerName: 'Presenter',
          bindings: [{ fieldId, targetProperty: property }],
        },
        {
          type: 'update_modifier',
          layerName: 'Presenter',
          modifierId: modifier.id,
          patch: { params: { maxWidth: 640 } },
        },
        {
          type: 'set_property_track',
          layerName: 'Presenter',
          property,
          replace: true,
          keys: [
            { frame: 0, value: 640 },
            { frame: 12, value: 480 },
          ],
        },
      ],
    });
    composition = host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    expect(composition.dataFields.find((field) => field.id === fieldId)!.defaultValue).toBe(640);
    const projected = await call('ograf_get_project', {
      sessionId,
      include: ['elements'],
      tracks: 'none',
    });
    expect(projected.project).toMatchObject({
      compositions: [
        {
          layers: [
            { modifiers: [expect.objectContaining({ id: modifier.id, type: 'max-text-width' })] },
            { modifiers: [expect.objectContaining({ type: 'auto-size' })] },
          ],
        },
      ],
    });
    const copied = await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 3,
      operations: [{ type: 'duplicate_modifier', layerName: 'Presenter', modifierId: modifier.id }],
    });
    const copyId = (copied.results as Array<{ id: string }>)[0]!.id;
    await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 4,
      operations: [
        { type: 'reorder_modifiers', layerName: 'Presenter', modifierIds: [copyId, modifier.id] },
        { type: 'remove_modifier', layerName: 'Presenter', modifierId: modifier.id },
      ],
    });
    const title = host.workspace.get(sessionId).snapshot().project.compositions[0]!.layers[0]!;
    expect(title.modifiers).toMatchObject([{ id: copyId, enabled: false }]);
    expect(title.animationTracks[property]).toBeUndefined();
    expect(title.animationTracks[`modifiers.${copyId}.maxWidth`]).toHaveLength(2);
  } finally {
    await client.close();
    await server.close();
  }
});

it('preserves radial keys, bindings and group references and rejects invalid changes atomically over MCP', async () => {
  const host = createOGrafAuthoringHost();
  const server = createOGrafMcpServer(host.workspace, host.bridge);
  const client = new Client({ name: 'modifier-animation-contract-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const sessionId = 'modifier-animation-wire';
  host.workspace.create(sessionId, modifierFixture());
  const call = async (name: string, args: Record<string, unknown>, failure = false) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError === true, JSON.stringify(result.content)).toBe(failure);
    return result.structuredContent as Record<string, unknown>;
  };
  const snapshot = () => host.workspace.get(sessionId).snapshot();
  try {
    await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 0,
      operations: [
        { type: 'add_layer', kind: 'rectangle', name: 'Ring' },
        { type: 'add_layer', kind: 'rectangle', name: 'Card A' },
        { type: 'add_layer', kind: 'rectangle', name: 'Card B' },
        { type: 'add_layer', kind: 'rectangle', name: 'Arrow' },
        { type: 'add_layer', kind: 'path', name: 'Route' },
        { type: 'add_layer', kind: 'rectangle', name: 'Marker' },
        { type: 'add_data_field', fieldType: 'number', key: 'radius', defaultValue: 200 },
      ],
    });
    const initial = snapshot().project.compositions[0]!;
    const id = (name: string) => initial.layers.find((layer) => layer.name === name)!.id;
    const radiusId = initial.dataFields.find((field) => field.key === 'radius')!.id;
    await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 1,
      operations: [
        { type: 'set_layer_layout', layerName: 'Card A', parentId: id('Ring'), groupId: 'cards' },
        { type: 'set_layer_layout', layerName: 'Card B', parentId: id('Ring'), groupId: 'cards' },
        {
          type: 'add_modifier',
          layerName: 'Ring',
          modifierType: 'radial-arrange',
          params: {
            count: 2,
            rings: 2,
            innerRadius: 100,
            outerRadius: 200,
            startAngle: 0,
            endAngle: 180,
            arrangement: 'radiate',
            startFromOuter: true,
            orient: true,
            baseRotation: 90,
          },
        },
        {
          type: 'add_modifier',
          layerName: 'Arrow',
          modifierType: 'look-at',
          params: { source: { kind: 'group', groupId: 'cards' }, rotationOffset: 15 },
        },
        {
          type: 'set_layer_layout',
          layerName: 'Marker',
          motionPath: {
            sourceLayerId: id('Route'),
            progress: 0.25,
            orientToPath: true,
            offsetX: 10,
            offsetY: -10,
            rotationOffset: -90,
          },
        },
      ],
    });
    const modifierId = (name: string) =>
      snapshot().project.compositions[0]!.layers.find((layer) => layer.name === name)!
        .modifiers![0]!.id;
    const radialId = modifierId('Ring'),
      lookId = modifierId('Arrow');
    await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 2,
      operations: [
        {
          type: 'set_layer_bindings',
          layerName: 'Ring',
          bindings: [{ fieldId: radiusId, targetProperty: `modifiers.${radialId}.outerRadius` }],
        },
        {
          type: 'set_property_track',
          layerName: 'Ring',
          property: `modifiers.${radialId}.startAngle`,
          replace: true,
          keys: [
            { frame: 0, value: 0 },
            { frame: 12, value: 90 },
          ],
        },
        {
          type: 'set_property_track',
          layerName: 'Marker',
          property: 'motionPathProgress',
          replace: true,
          keys: [
            { frame: 0, value: 0 },
            { frame: 12, value: 1 },
          ],
        },
        { type: 'set_layer_loop', layerName: 'Ring', durationFrames: 24 },
        {
          type: 'set_loop_property_track',
          layerName: 'Ring',
          property: `modifiers.${radialId}.endAngle`,
          replace: true,
          keys: [
            { frame: 0, value: 180 },
            { frame: 24, value: 360 },
          ],
        },
      ],
    });
    await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 3,
      operations: [
        {
          type: 'update_modifier',
          layerName: 'Ring',
          modifierId: radialId,
          patch: { params: { outerRadius: 240 } },
        },
        { type: 'duplicate_modifier', layerName: 'Ring', modifierId: radialId },
        {
          type: 'update_modifier',
          layerName: 'Arrow',
          modifierId: lookId,
          scope: 'frame',
          frame: 6,
          patch: { params: { rotationOffset: 45 } },
        },
      ],
    });
    const composition = snapshot().project.compositions[0]!;
    const ring = composition.layers.find((layer) => layer.name === 'Ring')!;
    const copyId = ring.modifiers!.find((modifier) => modifier.id !== radialId)!.id;
    expect(composition.dataFields.find((field) => field.id === radiusId)!.defaultValue).toBe(240);
    expect(ring.bindings.map((binding) => binding.targetProperty)).toEqual([
      `modifiers.${radialId}.outerRadius`,
      `modifiers.${copyId}.outerRadius`,
    ]);
    expect(ring.animationTracks[`modifiers.${copyId}.startAngle`]).toMatchObject([
      { frame: 0, value: 0 },
      { frame: 12, value: 90 },
    ]);
    expect(ring.loop!.tracks[`modifiers.${copyId}.endAngle`]).toMatchObject([
      { frame: 0, value: 180 },
      { frame: 24, value: 360 },
    ]);
    expect(ring.modifiers!.find((modifier) => modifier.id === copyId)!.enabled).toBe(false);
    const inspection = await call('ograf_inspect_scene', { sessionId });
    expect(inspection.compositions).toMatchObject([
      {
        layers: expect.arrayContaining([
          expect.objectContaining({
            id: id('Ring'),
            modifierAnimationProperties: expect.arrayContaining([
              `modifiers.${radialId}.outerRadius`,
              `modifiers.${copyId}.endAngle`,
            ]),
          }),
          expect.objectContaining({
            id: id('Arrow'),
            modifiers: [
              expect.objectContaining({
                params: expect.objectContaining({ source: { kind: 'group', groupId: 'cards' } }),
              }),
            ],
          }),
          expect.objectContaining({
            id: id('Marker'),
            motionPath: expect.objectContaining({ rotationOffset: -90 }),
            animatedProperties: expect.arrayContaining(['motionPathProgress']),
          }),
        ]),
      },
    ]);
    const before = snapshot();
    for (const params of [{ rings: 0 }, { count: 1025 }, { outerRadius: -1 }, { orient: 'yes' }]) {
      await call(
        'ograf_apply_operations',
        {
          sessionId,
          expectedRevision: 4,
          operations: [
            { type: 'update_modifier', layerName: 'Ring', modifierId: radialId, patch: { params } },
          ],
        },
        true,
      );
      expect(snapshot()).toEqual(before);
    }
    await call(
      'ograf_apply_operations',
      {
        sessionId,
        expectedRevision: 4,
        operations: [
          {
            type: 'update_modifier',
            layerName: 'Arrow',
            modifierId: lookId,
            patch: { params: { source: { kind: 'group', groupId: 'missing' } } },
          },
        ],
      },
      true,
    );
    expect(snapshot()).toEqual(before);
  } finally {
    await client.close();
    await server.close();
  }
});

it('authors container arrangement, Look At and Spline Path orientation over MCP', async () => {
  const host = createOGrafAuthoringHost();
  const server = createOGrafMcpServer(host.workspace, host.bridge);
  const client = new Client({ name: 'arrange-contract-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const sessionId = 'arrange-wire';
  host.workspace.create(sessionId, modifierFixture());
  const call = async (name: string, args: Record<string, unknown>, failure = false) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError === true, JSON.stringify(result.content)).toBe(failure);
    return result.structuredContent as Record<string, unknown>;
  };
  try {
    await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 0,
      operations: [
        { type: 'add_layer', kind: 'rectangle', name: 'Row' },
        { type: 'add_layer', kind: 'rectangle', name: 'Card A' },
        { type: 'add_layer', kind: 'rectangle', name: 'Card B' },
        { type: 'add_layer', kind: 'rectangle', name: 'Arrow' },
        { type: 'add_layer', kind: 'path', name: 'Route' },
      ],
    });
    const layers = host.workspace.get(sessionId).snapshot().project.compositions[0]!.layers;
    const id = (name: string) => layers.find((layer) => layer.name === name)!.id;
    await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 1,
      operations: [
        { type: 'set_layer_layout', layerName: 'Card A', parentId: id('Row') },
        { type: 'set_layer_layout', layerName: 'Card B', parentId: id('Row') },
        {
          type: 'add_modifier',
          layerName: 'Row',
          modifierType: 'grid-arrange',
          params: { columns: 1, spreadY: 80, startCorner: 'bottom-left' },
        },
        {
          type: 'add_modifier',
          layerName: 'Row',
          modifierType: 'justify',
          params: { horizontal: 'center', vertical: 'center' },
        },
        {
          type: 'add_modifier',
          layerName: 'Arrow',
          modifierType: 'look-at',
          params: { source: { kind: 'layer', layerId: id('Card B') }, axis: 'y', flip: true },
        },
      ],
    });
    const row = host.workspace
      .get(sessionId)
      .snapshot()
      .project.compositions[0]!.layers.find((layer) => layer.name === 'Row')!;
    expect(row.modifiers).toMatchObject([
      { type: 'grid-arrange', params: { columns: 1, rows: 0, direction: 'horizontal' } },
      { type: 'justify', params: { horizontal: 'center', vertical: 'center', offsetX: 0 } },
    ]);
    // A Spline Path on an arranged child conflicts with the container that positions it.
    await call(
      'ograf_apply_operations',
      {
        sessionId,
        expectedRevision: 2,
        operations: [
          {
            type: 'set_layer_layout',
            layerName: 'Card A',
            motionPath: {
              sourceLayerId: id('Route'),
              progress: 0,
              orientToPath: true,
              offsetX: 0,
              offsetY: 0,
              rotationOffset: 45,
            },
          },
        ],
      },
      true,
    );
    await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 2,
      operations: [
        {
          type: 'set_layer_layout',
          layerName: 'Arrow',
          motionPath: {
            sourceLayerId: id('Route'),
            progress: 0.5,
            orientToPath: false,
            offsetX: 0,
            offsetY: 0,
            rotationOffset: 45,
          },
        },
      ],
    });
    const arrow = host.workspace
      .get(sessionId)
      .snapshot()
      .project.compositions[0]!.layers.find((layer) => layer.name === 'Arrow')!;
    expect(arrow.motionPath).toMatchObject({ rotationOffset: 45 });
    expect(arrow.modifiers).toMatchObject([
      { type: 'look-at', params: { axis: 'y', flip: true, rotationOffset: 0 } },
    ]);
    await call(
      'ograf_apply_operations',
      {
        sessionId,
        expectedRevision: 3,
        operations: [
          {
            type: 'update_modifier',
            layerName: 'Row',
            modifierId: row.modifiers![0]!.id,
            patch: { params: { startCorner: 'diagonal' } },
          },
        ],
      },
      true,
    );
  } finally {
    await client.close();
    await server.close();
  }
});
