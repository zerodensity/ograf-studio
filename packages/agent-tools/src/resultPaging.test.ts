import { describe, expect, it, vi } from 'vitest';
import { AuthoringSession } from '@ograf-editor/authoring-core';
import { createProject } from '@ograf-editor/scene-model';
import type { AuthoringWorkspacePort, EditorBridgePort } from './ports';
import { createOGrafToolRecords } from './toolRecords';
import { providerToolDefinition } from './inAppTools';
import {
  estimateResultTokens,
  ToolResultPager,
  toolResultPagerForRecords,
  type ToolResultPage,
} from './resultPaging';

function fixture(workspace?: AuthoringWorkspacePort) {
  const session = new AuthoringSession(createProject(), 'editor');
  const source = workspace ?? {
    root: 'C:/ograf-paging-tests',
    get: () => session,
    list: () => [],
    create: () => session,
    delete: vi.fn(),
    open: async () => session,
    resolveAllowedPath: (value: string) => value,
  };
  const bridge = {
    health: {
      connected: false,
      responsive: false,
      latencyMs: null,
      lastHeartbeat: null,
      likelyCause: 'editor-disconnected',
      certificationReady: false,
      certificationLikelyCause: 'Disconnected',
    },
    certify: vi.fn(),
    capture: vi.fn(),
    renderStrip: vi.fn(),
    measureText: vi.fn(),
    presentProposal: vi.fn(),
  } as EditorBridgePort;
  return { workspace: source, records: createOGrafToolRecords(source, bridge) };
}

describe('structured immutable tool result paging', () => {
  it('retains every large-template row and reconstructs it with bounded valid JSON pages', () => {
    const pager = new ToolResultPager();
    const layers = Array.from({ length: 2_000 }, (_, index) => ({
      id: `layer-${index}`,
      name: `Headline ${index}`,
      type: 'text',
      content: `Editorial value ${index}`,
    }));
    const original = { sessionId: 'editor', revision: 18, project: { layers } };
    const first = pager.format(original, {
      toolName: 'ograf_get_project',
      maxTokens: 1200,
    }) as ToolResultPage;
    expect(first.kind).toBe('tool-result-page');
    expect(first.source).toMatchObject({ toolName: 'ograf_get_project', revision: 18 });
    expect(first.node.entries).toContainEqual(
      expect.objectContaining({ key: 'revision', value: 18 }),
    );
    const recovered: unknown[] = [];
    let offset = 0;
    do {
      const page = pager.read({
        resultId: first.resultId,
        path: ['project', 'layers'],
        offset,
        limit: 17,
        maxTokens: 1200,
      });
      expect(estimateResultTokens(JSON.stringify(page))).toBeLessThanOrEqual(1200);
      expect(JSON.parse(JSON.stringify(page))).toEqual(page);
      recovered.push(...page.node.items!.map((item) => item.value));
      if (!page.hasMore) break;
      expect(page.nextOffset).toBeGreaterThan(offset);
      offset = page.nextOffset!;
    } while (offset < layers.length);
    expect(recovered).toEqual(layers);
  });

  it('does not cut JSON or corrupt Unicode, control characters or escaped strings', () => {
    const pager = new ToolResultPager();
    const text = '😀 İstanbul "quote" \\ path\n汉字'.repeat(800);
    const id = pager.store({ text });
    let offset = 0,
      recovered = '';
    do {
      const page = pager.read({ resultId: id, path: ['text'], offset, limit: 997, maxTokens: 512 });
      expect(estimateResultTokens(JSON.stringify(page))).toBeLessThanOrEqual(512);
      const copied = JSON.parse(JSON.stringify(page)) as ToolResultPage;
      expect(copied.node.chunk).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
      recovered += copied.node.chunk;
      if (!page.hasMore) break;
      expect(page.nextOffset).toBeGreaterThan(offset);
      offset = page.nextOffset!;
    } while (offset < text.length);
    expect(recovered).toBe(text);
    expect(() => pager.read({ resultId: id, path: ['text'], offset: 1 })).toThrow('Unicode');
  });

  it('keeps original snapshots/revisions after the live result is modified', () => {
    const pager = new ToolResultPager();
    const value = { revision: 'set:7', project: { name: 'Before', keys: [1, 2, 3] } };
    const id = pager.store(value, { sessionId: 'editor:one' });
    value.revision = 'set:8';
    value.project.name = 'After';
    value.project.keys.push(4);
    expect(pager.read({ resultId: id, sessionId: 'editor:one', path: ['project'] })).toMatchObject({
      source: { revision: 'set:7' },
      total: 2,
    });
    expect(
      pager.read({ resultId: id, sessionId: 'editor:one', path: ['project', 'name'] }).node.chunk,
    ).toBe('Before');
    expect(
      pager
        .read({ resultId: id, sessionId: 'editor:one', path: ['project', 'keys'] })
        .node.items?.map((item) => item.value),
    ).toEqual([1, 2, 3]);
    const inline = pager.read({ resultId: id, sessionId: 'editor:one' });
    const project = inline.node.entries!.find((item) => item.key === 'project')!.value as {
      name: string;
    };
    project.name = 'Mutated page copy';
    expect(
      pager.read({ resultId: id, sessionId: 'editor:one', path: ['project', 'name'] }).node.chunk,
    ).toBe('Before');
  });

  it('rejects cross-conversation reads, prototype traversal and invalid offsets', () => {
    const pager = new ToolResultPager();
    const id = pager.store({ values: [1, 2], empty: {} }, { sessionId: 'chat-a' });
    expect(() => pager.read({ resultId: id, sessionId: 'chat-b' })).toThrow(
      'different authoring conversation',
    );
    for (const path of [['__proto__'], ['constructor'], ['empty', 'toString']])
      expect(() => pager.read({ resultId: id, sessionId: 'chat-a', path })).toThrow('absent');
    expect(() =>
      pager.read({ resultId: id, sessionId: 'chat-a', path: ['values'], offset: -1 }),
    ).toThrow('offsets');
    expect(() =>
      pager.read({ resultId: id, sessionId: 'chat-a', path: ['values'], offset: 3 }),
    ).toThrow('exceeds');
  });

  it('makes expiry and cache eviction actionable instead of silently returning an incomplete result', () => {
    let now = 1_000;
    const pager = new ToolResultPager({ now: () => now, ttlMs: 100, maxEntries: 2 });
    const expired = pager.store({ name: 'old' });
    now += 101;
    expect(() => pager.read({ resultId: expired })).toThrow('never repeat a mutation');
    const evicted = pager.store({ name: 'first' });
    pager.store({ name: 'second' });
    pager.store({ name: 'third' });
    expect(() => pager.read({ resultId: evicted })).toThrow('expired or was evicted');
  });

  it('preserves mutation acknowledgement and references without re-executing the mutation', () => {
    const pager = new ToolResultPager();
    const mutate = vi.fn(() => ({
      revision: 19,
      results: [{ type: 'add_layer', id: 'new-layer' }],
      project: { embedded: 'x'.repeat(30_000) },
    }));
    const result = mutate();
    const page = pager.format(result, {
      toolName: 'ograf_apply_operations',
      maxTokens: 800,
    }) as ToolResultPage;
    expect(page.node.entries).toContainEqual(
      expect.objectContaining({ key: 'revision', value: 19 }),
    );
    expect(page.node.entries).toContainEqual(
      expect.objectContaining({ key: 'results', value: result.results }),
    );
    expect(
      pager.read({ resultId: page.resultId, path: ['project', 'embedded'], maxTokens: 800 }).node
        .chunk,
    ).toBeTruthy();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('reports retention capacity without falsely failing or retrying a committed mutation', () => {
    const pager = new ToolResultPager({ maxBytes: 512 });
    const result = pager.format(
      { revision: 7, results: [{ id: 'created' }], project: { embedded: 'x'.repeat(20_000) } },
      { toolName: 'ograf_apply_operations', maxTokens: 512 },
    ) as Record<string, unknown>;
    expect(result).toMatchObject({
      kind: 'tool-result-unavailable',
      acknowledgement: { revision: 7, results: [{ id: 'created' }] },
      error: { code: 'result-too-large' },
      guidance: expect.stringContaining('already run'),
    });
    expect(() => JSON.parse(JSON.stringify(result))).not.toThrow();
  });
});

describe('page-budget edge cases', () => {
  it('counts escaped Unicode keys and refuses scalar/empty pages that cannot fit their metadata', () => {
    const pager = new ToolResultPager();
    const value = { ['漢'.repeat(400)]: 0 };
    const formatted = pager.format(value, { maxTokens: 256 }) as { kind: string; resultId: string };
    expect(formatted).not.toEqual(value);
    expect(formatted.resultId).toBeTruthy();
    expect(
      pager.read({ resultId: formatted.resultId, maxTokens: 1200 }).node.entries?.[0]?.value,
    ).toBe(0);
    for (const item of [{}, [], Number.MAX_VALUE]) {
      const id = pager.store(item, { toolName: 'x'.repeat(160) });
      expect(() => pager.read({ resultId: id, maxTokens: 144 })).toThrow('exceeds');
    }
  });
});

describe('canonical MCP read-only page reader', () => {
  it('retains a read-only source failure flag across later page calls', async () => {
    const { records } = fixture();
    records.find((record) => record.name === 'ograf_get_project')!.handler = vi.fn(async () => ({
      isError: true,
      structuredContent: { error: { code: 'SOURCE_NOT_READY', message: 'Retry the read later.' } },
    }));
    const reader = records.find((record) => record.name === 'ograf_read_result_page')!;
    const first = (await reader.handler({ sourceTool: 'ograf_get_project' })) as {
      isError: boolean;
      structuredContent: ToolResultPage;
    };
    expect(first.isError).toBe(true);
    expect(first.structuredContent.source.isError).toBe(true);
    const second = (await reader.handler({
      resultId: first.structuredContent.resultId,
      path: ['error', 'message'],
    })) as { isError: boolean; structuredContent: ToolResultPage };
    expect(second.isError).toBe(true);
    expect(second.structuredContent.node.chunk).toBe('Retry the read later.');
  });

  it('lets only the trusted built-in loop supply scope and budgets without changing MCP validation', () => {
    const reader = fixture().records.find((record) => record.name === 'ograf_read_result_page')!;
    const projected = providerToolDefinition(reader);
    expect(Object.keys(projected.inputSchema.properties as object)).toEqual([
      'resultId',
      'path',
      'offset',
    ]);
    expect(projected.inputSchema.required).toEqual(['resultId']);
    expect(Object.keys(reader.config.inputSchema)).toEqual(
      expect.arrayContaining(['sourceTool', 'input', 'sessionId', 'maxTokens', 'limit']),
    );
  });
  it('keeps full reads unchanged and makes explicit paged reads available across request records', async () => {
    const first = fixture();
    const read = first.records.find((record) => record.name === 'ograf_read_result_page')!;
    const full = (await first.records
      .find((record) => record.name === 'ograf_get_project')!
      .handler({ sessionId: 'editor' })) as { structuredContent: Record<string, unknown> };
    expect(full.structuredContent).toHaveProperty('project');
    expect(full.structuredContent).not.toHaveProperty('resultId');
    const response = (await read.handler({
      sourceTool: 'ograf_get_project',
      input: { sessionId: 'editor' },
      maxTokens: 1200,
    })) as { structuredContent: ToolResultPage };
    expect(response.structuredContent.kind).toBe('tool-result-page');
    const next = fixture(first.workspace).records;
    expect(toolResultPagerForRecords(next)).toBe(toolResultPagerForRecords(first.records));
    const nested = (await next
      .find((record) => record.name === 'ograf_read_result_page')!
      .handler({ resultId: response.structuredContent.resultId, path: ['project', 'id'] })) as {
      structuredContent: ToolResultPage;
    };
    expect(nested.structuredContent.node.chunk).toBeTruthy();
    const other = fixture().records;
    const denied = (await other
      .find((record) => record.name === 'ograf_read_result_page')!
      .handler({ resultId: response.structuredContent.resultId })) as { isError: boolean };
    expect(denied.isError).toBe(true);
  });

  it('never admits a mutation, file action or recursive page source', async () => {
    const { records } = fixture();
    const mutate = records.find((record) => record.name === 'ograf_apply_operations')!;
    mutate.handler = vi.fn();
    const reader = records.find((record) => record.name === 'ograf_read_result_page')!;
    for (const sourceTool of [
      'ograf_apply_operations',
      'ograf_reset_project',
      'ograf_save_project',
      'ograf_certify_project',
      'ograf_read_result_page',
    ]) {
      const response = (await reader.handler({ sourceTool, input: {} })) as { isError: boolean };
      expect(response.isError).toBe(true);
    }
    expect(mutate.handler).not.toHaveBeenCalled();
  });
});
