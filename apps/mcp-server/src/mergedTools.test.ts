import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createOGrafToolRecords,
  IN_APP_AGENT_TOOL_NAMES,
  listedToolRecords,
  MERGED_TOOL_NAMES,
  providerToolDefinitions,
  TOOL_MERGES,
  UNLISTED_OPERATION_TYPES,
} from '@ograf-editor/agent-tools';
import { createOGrafAuthoringHost } from './index';
import { createOGrafMcpServer } from './mcpServer';

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

describe('merged agent tools', () => {
  const host = createOGrafAuthoringHost();
  const server = createOGrafMcpServer(host.workspace, host.bridge);
  const client = new Client({ name: 'merged-tools-test', version: '1.0.0' });
  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args });
  const text = (result: ToolResult) =>
    (result.content as Array<{ type: string; text?: string }>)
      .map((item) => item.text ?? '')
      .join('\n');
  const sessionId = 'merged-tools';

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const created = await call('ograf_create_project', {
      sessionId,
      originalPrompt: 'A headline for the merged tool tests.',
    });
    expect(created.isError, text(created)).not.toBe(true);
    const applied = await call('ograf_apply_operations', {
      sessionId,
      expectedRevision: 0,
      operations: [{ type: 'add_layer', kind: 'text', name: 'Headline' }],
    });
    expect(applied.isError, text(applied)).not.toBe(true);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it('lists each surviving tool once and none of the names it covers', async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const merge of TOOL_MERGES) expect(names).toContain(merge.into);
    for (const name of MERGED_TOOL_NAMES) expect(names).not.toContain(name);
    expect(names).toHaveLength(22);
  });

  it('still answers a caller of an earlier tool name exactly as the selector does', async () => {
    const earlier = await call('ograf_list_sessions');
    const merged = await call('ograf_get_capabilities', { view: 'sessions' });
    expect(earlier.isError).not.toBe(true);
    expect(merged.structuredContent).toEqual(earlier.structuredContent);

    const strip = await call('ograf_get_timeline', { sessionId });
    const timeline = await call('ograf_get_project', { sessionId, view: 'timeline' });
    expect(timeline.structuredContent).toEqual(strip.structuredContent);
  });

  it('keeps the tool itself as the default and applies its own defaults', async () => {
    const project = await call('ograf_get_project', { sessionId });
    expect(project.isError, text(project)).not.toBe(true);
    expect(project.structuredContent).toHaveProperty('project');
    const inspected = await call('ograf_inspect_scene', { sessionId });
    expect(inspected.isError, text(inspected)).not.toBe(true);
  });

  it('picks the route that an argument belongs to when no selector is given', async () => {
    const changes = await call('ograf_get_project', { sessionId, sinceRevision: 0 });
    expect(changes.isError, text(changes)).not.toBe(true);
    expect(changes.structuredContent).toEqual(
      (await call('ograf_get_changes', { sessionId, sinceRevision: 0 })).structuredContent,
    );

    const found = await call('ograf_inspect_scene', { sessionId, nameContains: 'Head' });
    expect(found.structuredContent).toEqual(
      (await call('ograf_query_scene', { sessionId, nameContains: 'Head' })).structuredContent,
    );
  });

  it('undoes and redoes through one tool', async () => {
    const layers = async () =>
      (
        (await call('ograf_get_project', { sessionId })).structuredContent as {
          project: { compositions: Array<{ layers: unknown[] }> };
        }
      ).project.compositions[0]!.layers.length;
    const revision = async () =>
      ((await call('ograf_get_project', { sessionId })).structuredContent as { revision: number })
        .revision;
    expect(await layers()).toBe(1);
    const undone = await call('ograf_undo', { sessionId, expectedRevision: await revision() });
    expect(undone.isError, text(undone)).not.toBe(true);
    expect(await layers()).toBe(0);
    const redone = await call('ograf_undo', {
      sessionId,
      direction: 'redo',
      expectedRevision: await revision(),
    });
    expect(redone.isError, text(redone)).not.toBe(true);
    expect(await layers()).toBe(1);
  });

  it('names the selector value an argument belongs to instead of ignoring it', async () => {
    const misplaced = await call('ograf_capture', { sessionId, mode: 'frame', columns: 2 });
    expect(misplaced.isError).toBe(true);
    expect(text(misplaced)).toContain('ograf_capture mode=frame does not take columns');
    expect(text(misplaced)).toContain('Use mode=strip.');
  });

  it("reports a route's own input rules with the selector that chose it", async () => {
    const missing = await call('ograf_validate_project', { sessionId, check: 'text' });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain('ograf_validate_project check=text');
    expect(text(missing)).toContain('layerId');

    const tooLarge = await call('ograf_capture', { sessionId, mode: 'strip', maxDimension: 2048 });
    expect(tooLarge.isError).toBe(true);
    expect(text(tooLarge)).toContain('ograf_capture mode=strip');
  });

  it('lists a default only where every route agrees on it', async () => {
    const tools = (await client.listTools()).tools;
    const properties = (name: string) =>
      (
        tools.find((tool) => tool.name === name)!.inputSchema as {
          properties: Record<string, Record<string, unknown>>;
        }
      ).properties;
    expect(properties('ograf_capture').sessionId).toMatchObject({ default: 'editor' });
    expect(properties('ograf_capture').maxDimension).not.toHaveProperty('default');
    expect(properties('ograf_capture').mode).toEqual({
      type: 'string',
      enum: ['frame', 'strip', 'svg'],
    });
    expect(properties('ograf_inspect_scene').limit).toMatchObject({ default: 100 });
  });

  it('keeps reads and writes apart, so a client can approve reads on their own', () => {
    const records = createOGrafToolRecords(host.workspace, host.bridge);
    for (const merge of TOOL_MERGES) {
      const access = Object.values(merge.routes).map(
        (name) =>
          records.find((record) => record.name === name)!.config.annotations?.readOnlyHint === true,
      );
      expect(new Set(access).size, merge.into).toBe(1);
    }
  });

  it('describes its capabilities with listed tool and operation names only', async () => {
    const capabilities = JSON.stringify((await call('ograf_get_capabilities')).structuredContent);
    const named = (name: string) => new RegExp(`(?<![a-z_])${name}(?![a-z_])`).test(capabilities);
    expect([...MERGED_TOOL_NAMES].filter(named)).toEqual([]);
    expect([...UNLISTED_OPERATION_TYPES].filter(named)).toEqual([]);
  });

  it('gives the built-in chat only the routes of tools it already had', () => {
    const records = createOGrafToolRecords(host.workspace, host.bridge, { inApp: true });
    const listed = listedToolRecords(records).map((record) => record.name);
    for (const name of IN_APP_AGENT_TOOL_NAMES) expect(listed).toContain(name);
    const properties = (name: string) =>
      providerToolDefinitions(records).find((tool) => tool.name === name)!.inputSchema
        .properties as Record<string, { enum?: string[] }>;
    expect(properties('ograf_get_capabilities')).not.toHaveProperty('view');
    expect(properties('ograf_get_project').view?.enum).toEqual(['project', 'timeline']);
    expect(properties('ograf_capture').mode?.enum).toEqual(['frame', 'strip']);
    expect(properties('ograf_undo').direction?.enum).toEqual(['undo', 'redo']);
  });
});
