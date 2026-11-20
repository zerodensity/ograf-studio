import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  authoringOperationSchema,
  createOGrafToolRecords,
  providerToolDefinitions,
  UNLISTED_OPERATION_TYPES,
} from '@ograf-editor/agent-tools';
import { computeKeyframeFrames, type Composition } from '@ograf-editor/scene-model';
import { createOGrafAuthoringHost } from './index';
import { createOGrafMcpServer } from './mcpServer';

type ToolResult = Awaited<ReturnType<Client['callTool']>>;
type Json = Record<string, unknown>;

const COVERING = [
  'set_data_field',
  'set_data_connection',
  'set_custom_action',
  'set_media_cue',
  'set_runtime_collection',
  'create_recipe',
  'set_timeline_group',
  'set_lifecycle_keyframe',
  'update_layer',
  'remove_plugin',
];

/** Operation names in a listed tool schema, with or without shared definitions. */
function operationNames(inputSchema: Json): string[] {
  const follow = (node: Json): Json => {
    let current = node;
    while (typeof current.$ref === 'string') {
      const [, group, name] = current.$ref.split('/');
      current = (inputSchema[group!] as Record<string, Json>)[name!]!;
    }
    return current;
  };
  const items = follow(
    follow((inputSchema.properties as Record<string, Json>).operations!).items as Json,
  );
  return ((items.oneOf ?? items.anyOf) as Json[]).flatMap((variant) => {
    const type = follow((follow(variant).properties as Record<string, Json>).type!);
    return type.const !== undefined ? [String(type.const)] : (type.enum as string[]);
  });
}

describe('merged agent operations', () => {
  const host = createOGrafAuthoringHost();
  const server = createOGrafMcpServer(host.workspace, host.bridge);
  const client = new Client({ name: 'merged-operations-test', version: '1.0.0' });
  const text = (result: ToolResult) =>
    (result.content as Array<{ type: string; text?: string }>)
      .map((item) => item.text ?? '')
      .join('\n');
  let sessions = 0;

  /** A fresh session and an `apply` that tracks its revision. */
  async function session() {
    const sessionId = `merged-operations-${(sessions += 1)}`;
    const created = await client.callTool({
      name: 'ograf_create_project',
      arguments: { sessionId, originalPrompt: 'A project for the merged operation tests.' },
    });
    expect(created.isError, text(created)).not.toBe(true);
    const composition = (): Composition =>
      host.workspace.get(sessionId).snapshot().project.compositions[0]!;
    const apply = (operations: Json[]) =>
      client.callTool({
        name: 'ograf_apply_operations',
        arguments: {
          sessionId,
          expectedRevision: host.workspace.get(sessionId).snapshot().revision,
          operations,
        },
      });
    const applied = async (operations: Json[]) => {
      const result = await apply(operations);
      expect(result.isError, text(result)).not.toBe(true);
      return result.structuredContent as { results: Array<Json> };
    };
    return { sessionId, composition, apply, applied };
  }

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it('lists the covering operations and none of the names they cover', async () => {
    const tools = (await client.listTools()).tools;
    const listed = operationNames(
      tools.find((tool) => tool.name === 'ograf_apply_operations')!.inputSchema as Json,
    );
    expect(new Set(listed).size).toBe(listed.length);
    for (const name of COVERING) expect(listed).toContain(name);
    for (const name of UNLISTED_OPERATION_TYPES) expect(listed).not.toContain(name);
    expect(listed).toHaveLength(79);

    const chat = providerToolDefinitions(
      createOGrafToolRecords(host.workspace, host.bridge, { inApp: true }),
    ).find((tool) => tool.name === 'ograf_apply_operations')!;
    expect(operationNames(chat.inputSchema).sort()).toEqual([...listed].sort());
  });

  it('still accepts every earlier name', () => {
    const accepted = authoringOperationSchema.options.flatMap((option) => {
      const type = option.shape.type as { value?: string; options?: string[] };
      return type.options ?? [type.value!];
    });
    for (const name of UNLISTED_OPERATION_TYPES) expect(accepted).toContain(name);
  });

  it('creates a data field once and updates it after that, also inside one batch', async () => {
    const { composition, applied } = await session();
    const created = await applied([
      { type: 'set_data_field', key: 'headline', fieldType: 'text', defaultValue: 'First' },
      { type: 'set_data_field', key: 'headline', label: 'Headline' },
    ]);
    expect(composition().dataFields).toHaveLength(1);
    expect(composition().dataFields[0]).toMatchObject({
      key: 'headline',
      label: 'Headline',
      defaultValue: 'First',
    });
    // The result names the operation the agent sent and its place in the sent batch.
    expect(created.results).toEqual([
      expect.objectContaining({
        index: 0,
        type: 'set_data_field',
        id: composition().dataFields[0]!.id,
      }),
    ]);

    await applied([{ type: 'set_data_field', fieldKey: 'headline', key: 'title' }]);
    expect(composition().dataFields.map((field) => field.key)).toEqual(['title']);
    await applied([{ type: 'add_data_field', key: 'subtitle', fieldType: 'text' }]);
    expect(composition().dataFields.map((field) => field.key)).toEqual(['title', 'subtitle']);
  });

  it('says what a new data field still needs', async () => {
    const { apply, composition } = await session();
    const result = await apply([{ type: 'set_data_field', key: 'score' }]);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Operation 0: set_data_field');
    expect(text(result)).toContain('fieldType');
    expect(composition().dataFields).toHaveLength(0);
  });

  it('creates a recipe by kind', async () => {
    const { composition, applied, apply } = await session();
    await applied([{ type: 'create_recipe', recipe: 'lower-third', name: 'Presenter' }]);
    expect(composition().layers.length).toBeGreaterThan(1);
    const before = composition().layers.length;
    await applied([{ type: 'create_recipe', recipe: 'bug', name: 'Channel bug' }]);
    expect(composition().layers.length).toBeGreaterThan(before);
    const unknown = await apply([{ type: 'create_recipe', recipe: 'weather' }]);
    expect(unknown.isError).toBe(true);
  });

  it('changes a layer name, flags and semantics in one operation, found by its old name', async () => {
    const { composition, applied, apply } = await session();
    await applied([{ type: 'add_layer', kind: 'text', name: 'Headline' }]);
    await applied([
      {
        type: 'update_layer',
        layerName: 'Headline',
        name: 'Title',
        isVisible: false,
        semantics: { role: 'headline', tags: ['hero'] },
      },
    ]);
    expect(composition().layers[0]).toMatchObject({
      name: 'Title',
      isVisible: false,
      semantics: { role: 'headline', tags: ['hero'] },
    });
    const empty = await apply([{ type: 'update_layer', layerName: 'Title' }]);
    expect(empty.isError).toBe(true);
    expect(text(empty)).toContain('pass name, isVisible');
  });

  it('creates, changes and ungroups a timeline group', async () => {
    const { sessionId, composition, applied, apply } = await session();
    const groups = async () =>
      (
        (await client.callTool({ name: 'ograf_inspect_scene', arguments: { sessionId } }))
          .structuredContent as { compositions: Array<{ layout: { timelineGroups: Json[] } }> }
      ).compositions[0]!.layout.timelineGroups;
    await applied([
      { type: 'add_layer', kind: 'rectangle', name: 'Plate' },
      { type: 'add_layer', kind: 'text', name: 'Name' },
    ]);
    const layerIds = composition().layers.map((layer) => layer.id);
    const created = await applied([{ type: 'set_timeline_group', layerIds, name: 'Row' }]);
    const groupId = String(
      created.results.find((entry) => entry.type === 'set_timeline_group')!.id,
    );
    await applied([{ type: 'set_timeline_group', groupId, name: 'Row 1', color: '#31b7d4' }]);
    expect(await groups()).toEqual([
      expect.objectContaining({ id: groupId, name: 'Row 1', color: '#31b7d4' }),
    ]);
    const regroup = await apply([{ type: 'set_timeline_group', groupId, layerIds }]);
    expect(regroup.isError).toBe(true);
    expect(text(regroup)).toContain('a timeline group keeps its members');
    await applied([{ type: 'set_timeline_group', groupId, layerIds: [] }]);
    expect(await groups()).toEqual([]);
  });

  it('renames and moves a lifecycle keyframe together', async () => {
    const { composition, applied } = await session();
    await applied([{ type: 'add_lifecycle_step', name: 'Second' }]);
    const step = composition().keyframes.find((keyframe) => keyframe.name === 'Second')!;
    const frameOf = () =>
      computeKeyframeFrames(composition()).find((keyframe) => keyframe.keyframeId === step.id)!
        .frame;
    const frame = frameOf() + 2;
    await applied([{ type: 'set_lifecycle_keyframe', keyframeId: step.id, name: 'Reveal', frame }]);
    expect(composition().keyframes.find((keyframe) => keyframe.id === step.id)!.name).toBe(
      'Reveal',
    );
    expect(frameOf()).toBe(frame);
  });

  it('creates a custom action once and updates it after that', async () => {
    const { composition, applied, apply } = await session();
    await applied([{ type: 'set_custom_action', actionId: 'flash', name: 'Flash' }]);
    await applied([{ type: 'set_custom_action', actionId: 'flash', nextActionId: 'pulse' }]);
    expect(composition().customActions).toEqual([
      expect.objectContaining({ actionId: 'pulse', name: 'Flash' }),
    ]);
    const missing = await apply([
      { type: 'set_custom_action', actionId: 'ghost', nextActionId: 'spirit' },
    ]);
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain('custom action not found');
  });

  it('removes a loop and a style pack by an empty value', async () => {
    const { composition, applied, apply } = await session();
    await applied([{ type: 'add_layer', kind: 'rectangle', name: 'Plate' }]);
    await applied([{ type: 'set_layer_loop', layerName: 'Plate', durationFrames: 20 }]);
    expect(composition().layers[0]!.loop).toBeTruthy();
    const mixed = await apply([
      { type: 'set_layer_loop', layerName: 'Plate', remove: true, durationFrames: 10 },
    ]);
    expect(mixed.isError).toBe(true);
    await applied([{ type: 'set_layer_loop', layerName: 'Plate', remove: true }]);
    expect(composition().layers[0]!.loop ?? null).toBeNull();

    await applied([{ type: 'apply_style_pack', stylePack: 'news' }]);
    const tokens = composition().designSystem.tokens.length;
    expect(tokens).toBeGreaterThan(0);
    await applied([{ type: 'apply_style_pack', stylePack: null }]);
    expect(composition().designSystem.tokens.length).toBeLessThan(tokens);
  });

  it('adds and patches a data connection through one operation', async () => {
    const { composition, applied } = await session();
    const created = await applied([
      { type: 'set_data_connection', connection: { source: 'public-markets' } },
    ]);
    const connectionId = String(created.results[0]!.id);
    await applied([
      {
        type: 'set_data_connection',
        connectionId,
        connection: { publicMarkets: { symbols: ['BTC-USD'] } },
      },
    ]);
    expect(composition().dataConnections).toEqual([
      expect.objectContaining({
        id: connectionId,
        source: 'public-markets',
        publicMarkets: expect.objectContaining({ symbols: ['BTC-USD'] }),
      }),
    ]);
  });
});
