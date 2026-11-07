import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOGrafToolRecords,
  toolResultPagerForRecords,
  type AgentAreaReference,
} from '@ograf-editor/agent-tools';
import { createOGrafAuthoringHost } from '../index';
import { ChatAgentController, type ChatSendMessage } from './chatAgent';
import { createProviderAdapter } from './providerAdapters';
import { resolveModelContext } from './modelContext';
import { loadAgentProviderConfig } from './config';
import type { ProviderCompletion, ProviderRequest, ChatServerEvent } from './types';

vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  loadAgentProviderConfig: vi.fn(),
}));
vi.mock('./providerAdapters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./providerAdapters')>()),
  createProviderAdapter: vi.fn(),
}));
vi.mock('./modelContext', () => ({ resolveModelContext: vi.fn() }));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
const answer = (text = 'Done'): ProviderCompletion => ({
  text,
  toolCalls: [],
  stopReason: 'stop',
  usage: { input: 100, output: 10, cacheRead: 0 },
});
const calls = (
  ...tools: Array<{ name: string; arguments: Record<string, unknown> }>
): ProviderCompletion => ({
  ...answer(''),
  stopReason: 'tool_calls',
  toolCalls: tools.map((tool, index) => ({ id: `call-${index}`, ...tool })),
});

beforeEach(() => {
  vi.mocked(loadAgentProviderConfig).mockResolvedValue({
    provider: 'openai-compatible',
    baseUrl: 'https://unused.example',
    model: 'primary',
    apiKey: 'mock-only',
    effort: 'medium',
  });
  vi.mocked(resolveModelContext).mockImplementation(async (_config, model, preferences) => ({
    model,
    contextWindowTokens: preferences.contextWindowTokens ?? 128000,
    source: preferences.contextWindowTokens === null ? 'provider' : 'override',
  }));
});

function fixture(
  script: (
    request: ProviderRequest,
    index: number,
  ) => ProviderCompletion | Promise<ProviderCompletion>,
) {
  const requests: ProviderRequest[] = [];
  vi.mocked(createProviderAdapter).mockImplementation(() => ({
    complete: async (request) => {
      if (request.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      requests.push(request);
      return new Promise<ProviderCompletion>((resolve, reject) => {
        const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
        request.signal.addEventListener('abort', abort, { once: true });
        Promise.resolve()
          .then(() => script(request, requests.length - 1))
          .then(resolve, reject)
          .finally(() => {
            request.signal.removeEventListener('abort', abort);
          });
      });
    },
    dispose: vi.fn(),
  }));
  const host = createOGrafAuthoringHost();
  const records = createOGrafToolRecords(host.workspace, host.bridge);
  const events: ChatServerEvent[] = [];
  const waiting = new Map<string, (event: ChatServerEvent) => void>();
  const pending = new Map<string, Promise<ChatServerEvent>>();
  let disposed = false;
  const controller = new ChatAgentController(records, (event) => {
    events.push(event);
    if (event.type === 'chat.turn.end' || event.type === 'chat.error') {
      waiting.get(event.turnId)?.(event);
      waiting.delete(event.turnId);
      pending.delete(event.turnId);
    }
  });
  cleanups.push(async () => {
    disposed = true;
    const active = [...pending.entries()];
    for (const [turnId] of active) controller.handle({ type: 'chat.cancel', turnId });
    await Promise.allSettled(active.map(([, completion]) => completion));
    for (let attempt = 0; attempt < 4 && controller.busy; attempt++) await Promise.resolve();
  });
  let turn = 0;
  return {
    host,
    records,
    events,
    requests,
    controller,
    send: (text: string, extra: Partial<ChatSendMessage> = {}) => {
      if (disposed) return Promise.reject(new DOMException('Fixture disposed', 'AbortError'));
      const turnId = `turn-${++turn}`;
      const completion = new Promise<ChatServerEvent>((resolve) => {
        waiting.set(turnId, resolve);
        controller.handle({
          type: 'chat.send',
          turnId,
          sessionId: 'editor:project',
          text,
          ...extra,
        });
      });
      pending.set(turnId, completion);
      return completion;
    },
  };
}
const lastTool = (request: ProviderRequest) => {
  const tool = [...request.messages].reverse().find((message) => message.role === 'tool');
  if (tool?.role !== 'tool') throw new Error('Expected tool result');
  return JSON.parse(tool.content);
};

describe('assistant context through the real shared-tool loop', () => {
  it('reads a large project page in the same conversation without accepting a forged owner', async () => {
    let resultId = '';
    const test = fixture((request, index) => {
      if (index === 0) return calls({ name: 'ograf_get_project', arguments: {} });
      if (index === 1) {
        const page = lastTool(request);
        expect(page.kind).toBe('tool-result-page');
        resultId = page.resultId;
        return calls({
          name: 'ograf_read_result_page',
          arguments: {
            resultId,
            path: ['project', 'layers'],
            offset: 990,
            limit: 10,
            sessionId: 'editor:forged',
          },
        });
      }
      const page = lastTool(request);
      expect(page.source.sessionId).toBe('editor:project');
      expect(page.node.items.at(-1).value.id).toBe('layer-999');
      return answer();
    });
    test.records.find((record) => record.name === 'ograf_get_project')!.handler = async () => ({
      structuredContent: {
        revision: 17,
        project: {
          layers: Array.from({ length: 1000 }, (_, index) => ({
            id: `layer-${index}`,
            name: `Layer ${index}`,
            notes: 'Exact data '.repeat(30),
          })),
        },
      },
    });
    expect(await test.send('Inspect the last ten layers')).toMatchObject({ type: 'chat.turn.end' });
    expect(test.requests).toHaveLength(3);
    expect(() =>
      toolResultPagerForRecords(test.records)!.read({ resultId, sessionId: 'editor:other' }),
    ).toThrow(/conversation/);
  });

  it('fits many simultaneous large reads into one atomic reply group', async () => {
    const test = fixture((request, index) => {
      if (index === 0)
        return calls(
          ...Array.from({ length: 8 }, () => ({ name: 'ograf_get_project', arguments: {} })),
        );
      const tools = request.messages.filter((message) => message.role === 'tool');
      expect(tools).toHaveLength(8);
      for (const tool of tools) expect(JSON.parse(tool.content).kind).toBe('tool-result-page');
      return answer();
    });
    test.records.find((record) => record.name === 'ograf_get_project')!.handler = async () => ({
      structuredContent: {
        revision: 1,
        layers: Array.from({ length: 500 }, (_, index) => ({
          id: `l${index}`,
          content: 'x'.repeat(100),
        })),
      },
    });
    expect(
      await test.send('Read this large scene eight ways', {
        contextPreferences: {
          contextWindowTokens: null,
          maxHistoryTokens: 16384,
          maxToolResultTokens: null,
        },
      }),
    ).toMatchObject({ type: 'chat.turn.end' });
    expect(test.requests).toHaveLength(2);
  });

  it('retains a conversation past the former character cap and pages earlier turns', async () => {
    const test = fixture(() => answer());
    const preferences = {
      contextWindowTokens: null,
      maxHistoryTokens: 2048,
      maxToolResultTokens: null,
    };
    expect(
      await test.send('Original brief: preserve the red logo.', {
        contextPreferences: preferences,
      }),
    ).toMatchObject({ type: 'chat.turn.end' });
    for (let index = 0; index < 100; index++)
      expect(
        await test.send(`Turn ${index}: ${'Long editorial detail. '.repeat(60)}`, {
          contextPreferences: preferences,
        }),
      ).toMatchObject({ type: 'chat.turn.end' });
    const context = [...test.events].reverse().find((event) => event.type === 'chat.context');
    if (context?.type !== 'chat.context') throw new Error('Missing context status');
    expect(context.omittedMessages).toBeGreaterThan(100);
    expect(
      test.requests
        .at(-1)!
        .messages.some((message) => message.content === 'Original brief: preserve the red logo.'),
    ).toBe(true);
    const old = toolResultPagerForRecords(test.records)!.read({
      resultId: context.historyResultId!,
      sessionId: 'editor:project',
      path: [2, 'content'],
      maxTokens: 2000,
    });
    expect(old.node.value ?? old.node.chunk).toBe(
      `Turn 0: ${'Long editorial detail. '.repeat(60)}`.trim(),
    );
  });

  it('retains image metadata and user text without duplicating old binary images into every archive', async () => {
    const png = Buffer.alloc(3_750_000);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.write('IHDR', 12);
    png.writeUInt32BE(1, 16);
    png.writeUInt32BE(1, 20);
    const data = png.toString('base64');
    const area = (instruction: string): AgentAreaReference => ({
      projectId: 'project',
      compositionId: 'composition',
      frame: 0,
      revision: 0,
      compositionWidth: 1920,
      compositionHeight: 1080,
      rect: { x: 0, y: 0, width: 1, height: 1 },
      instruction,
      image: { mimeType: 'image/png', data, width: 1, height: 1 },
    });
    const test = fixture(() => answer());
    for (let index = 0; index < 8; index++)
      expect(
        await test.send(`Image request ${index}: preserve original typography`, {
          areaReferences: [area('Left region'), area('Right region')],
          contextPreferences: {
            contextWindowTokens: null,
            maxHistoryTokens: 20000,
            maxToolResultTokens: null,
          },
        }),
      ).toMatchObject({ type: 'chat.turn.end' });
    expect(
      await test.send('Continue editing after the large image conversation', {
        contextPreferences: {
          contextWindowTokens: null,
          maxHistoryTokens: 20000,
          maxToolResultTokens: null,
        },
      }),
    ).toMatchObject({ type: 'chat.turn.end' });
    const request = test.requests.at(-1)!;
    expect(
      request.messages.flatMap((message) =>
        message.role === 'user' ? (message.images ?? []) : [],
      ),
    ).toHaveLength(2);
    // Text/metadata can all fit after old binary attachments are separated. A transcript page
    // is only needed when messages are omitted, not simply because transient pixels were moved.
    const content = request.messages.find((message) =>
      message.content.includes('Image request 0'),
    )!.content;
    expect(content).toContain('Image request 0');
    expect(content).toContain('Studio archived canvas references');
    expect(content).toContain('snapshots can expire');
    expect(test.events.filter((event) => event.type === 'chat.error')).toEqual([]);
  }, 20000);

  it('repacks after a provider context rejection without repeating a committed mutation', async () => {
    const test = fixture((_request, index) => {
      if (index === 0)
        return calls({
          name: 'ograf_apply_operations',
          arguments: {
            sessionId: 'editor',
            expectedRevision: 0,
            operations: [{ type: 'set_project_metadata', name: 'Exactly once' }],
          },
        });
      if (index === 1) throw new Error('maximum context length exceeded');
      return answer();
    });
    expect(await test.send('Rename the project')).toMatchObject({ type: 'chat.turn.end' });
    expect(test.host.workspace.get('editor').revision).toBe(1);
    expect(test.host.workspace.get('editor').snapshot().project.name).toBe('Exactly once');
    expect(test.requests[2]!.messages.some((message) => message.role === 'tool')).toBe(true);
    expect(
      test.events.some(
        (event) =>
          event.type === 'chat.progress' &&
          event.message.includes('Earlier conversation remains pageable'),
      ),
    ).toBe(true);
  });

  it('uses the selected cheap model profile and applies preference changes on the next turn', async () => {
    vi.mocked(loadAgentProviderConfig).mockResolvedValue({
      provider: 'openai-compatible',
      baseUrl: 'https://unused.example',
      model: 'primary',
      cheapModel: 'cheap',
      apiKey: 'mock-only',
      effort: 'medium',
    });
    const test = fixture(() => answer());
    expect(
      await test.send('Rename title', {
        contextPreferences: {
          contextWindowTokens: null,
          maxHistoryTokens: 2048,
          maxToolResultTokens: 256,
        },
      }),
    ).toMatchObject({ type: 'chat.turn.end' });
    expect(
      await test.send('Create a full design', {
        contextPreferences: {
          contextWindowTokens: null,
          maxHistoryTokens: 8192,
          maxToolResultTokens: 1024,
        },
      }),
    ).toMatchObject({ type: 'chat.turn.end' });
    const contexts = test.events.filter((event) => event.type === 'chat.context');
    expect(contexts[0]).toMatchObject({
      model: 'cheap',
      historyBudgetTokens: 2048,
      toolPageTokens: 256,
    });
    expect(contexts[1]).toMatchObject({
      model: 'primary',
      historyBudgetTokens: 8192,
      toolPageTokens: 1024,
    });
  });
});
