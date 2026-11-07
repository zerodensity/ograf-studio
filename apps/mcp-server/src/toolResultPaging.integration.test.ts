import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AddressInfo } from 'node:net';
import { createComposition, createLayerOfKind, createProject } from '@ograf-editor/scene-model';
import type { ToolResultPage } from '@ograf-editor/agent-tools';
import { createOGrafAuthoringHost } from './index';

describe('large result snapshots across stateless MCP requests', () => {
  const host = createOGrafAuthoringHost();
  const client = new Client({ name: 'large-result-test', version: '1.0.0' });
  beforeAll(async () => {
    await new Promise<void>((resolve) => host.httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = host.httpServer.address() as AddressInfo;
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
    );
  });
  afterAll(async () => {
    await client.close();
    await new Promise<void>((resolve) => host.httpServer.close(() => resolve()));
  });

  it('retains all large-project layer IDs, the original revision and an unchanged default response', async () => {
    const layers = Array.from({ length: 1_200 }, (_, index) => ({
      ...createLayerOfKind('rectangle'),
      name: `Panel ${index} · 市場`,
    }));
    const composition = createComposition({ layers });
    const project = createProject({
      name: 'Large original project',
      mainCompositionId: composition.id,
      compositions: [composition],
    });
    const session = host.workspace.create('paging-large', project);
    const first = await client.callTool({
      name: 'ograf_read_result_page',
      arguments: {
        sourceTool: 'ograf_get_project',
        input: { sessionId: session.id, include: ['metadata', 'layers'], tracks: 'none' },
        sessionId: session.id,
        maxTokens: 1_024,
      },
    });
    expect(first.isError, JSON.stringify(first.content)).not.toBe(true);
    const snapshot = first.structuredContent as unknown as ToolResultPage;
    expect(snapshot.kind).toBe('tool-result-page');
    expect(snapshot.source.revision).toBe(0);

    session.apply({
      expectedRevision: 0,
      operations: [{ type: 'set_project_metadata', name: 'Changed after snapshot' }],
    });
    const ids: string[] = [];
    let offset = 0;
    for (;;) {
      const response = await client.callTool({
        name: 'ograf_read_result_page',
        arguments: {
          resultId: snapshot.resultId,
          sessionId: session.id,
          path: ['project', 'compositions', 0, 'layers'],
          offset,
          limit: 37,
          maxTokens: 4_096,
        },
      });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const page = response.structuredContent as unknown as ToolResultPage;
      expect(page.source.revision).toBe(0);
      for (const item of page.node.items ?? []) {
        const row = (item.value ?? item.preview) as Record<string, unknown> | undefined;
        if (typeof row?.id === 'string') ids.push(row.id);
        else {
          const detail = await client.callTool({
            name: 'ograf_read_result_page',
            arguments: {
              resultId: snapshot.resultId,
              sessionId: session.id,
              path: [...item.path, 'id'],
              maxTokens: 1_024,
            },
          });
          expect(detail.isError, JSON.stringify(detail.content)).not.toBe(true);
          const node = detail.structuredContent as unknown as ToolResultPage;
          expect(node.hasMore).toBe(false);
          const value = node.node.value ?? node.node.chunk;
          expect(typeof value).toBe('string');
          ids.push(value as string);
        }
      }
      if (!page.hasMore) break;
      expect(page.nextOffset).toBeGreaterThan(offset);
      offset = page.nextOffset!;
    }
    expect(ids).toEqual(layers.map((layer) => layer.id));
    expect(session.revision).toBe(1);

    const ordinary = await client.callTool({
      name: 'ograf_get_project',
      arguments: { sessionId: session.id, include: ['metadata'], tracks: 'none' },
    });
    expect(ordinary.structuredContent).toMatchObject({
      revision: 1,
      project: { name: 'Changed after snapshot' },
    });
    expect(ordinary.structuredContent).not.toHaveProperty('kind', 'tool-result-page');
    const rejected = await client.callTool({
      name: 'ograf_read_result_page',
      arguments: {
        sourceTool: 'ograf_apply_operations',
        input: {
          sessionId: session.id,
          expectedRevision: 1,
          operations: [{ type: 'set_project_metadata', name: 'Must not execute' }],
        },
      },
    });
    expect(rejected.isError).toBe(true);
    expect(session.revision).toBe(1);
  }, 30_000);
});
