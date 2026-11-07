import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOGrafToolRecords, ToolResultPager } from '@ograf-editor/agent-tools';
import { createOGrafAuthoringHost } from '../index';
import { ChatAgentController, buildTurnMessages, toolResultContent } from './chatAgent';
import type { ChatServerEvent } from './types';
import { resolveModelContext } from './modelContext';
import { loadAgentProviderConfig } from './config';

// These tests exercise the HTTP agent loop, not the host's OS credential store.
vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  loadAgentProviderConfig: vi.fn(),
}));

vi.mock('./modelContext', () => ({ resolveModelContext: vi.fn() }));

const originalEnvironment = { ...process.env };

beforeEach(() => {
  vi.mocked(resolveModelContext).mockImplementation(async (_config, model, preferences) => ({
    model,
    contextWindowTokens: preferences.contextWindowTokens ?? 128_000,
    source: preferences.contextWindowTokens === null ? 'provider' : 'override',
  }));
});

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.mocked(loadAgentProviderConfig).mockReset();
});

describe('server-side in-app agent loop', () => {
  it('places explicitly dragged layer references in ambient model context', () => {
    const messages = buildTurnMessages('portable-model', 'Change the color to green', {
      selection: { layerIds: ['layer-headline'], primaryLayerId: 'layer-headline' },
      references: [{ layerId: 'layer-headline', name: 'Headline', elementType: 'text' }],
    });
    expect(JSON.stringify(messages)).toContain('layer-headline');
    expect(JSON.stringify(messages)).toContain('Headline');
    expect(JSON.stringify(messages)).toContain('text');
  });

  it('retains complete JSON and pages large tool payloads without clipping data', () => {
    const value = { revision: 42, payload: '界'.repeat(40_000) };
    const raw = toolResultContent({ structuredContent: value });
    expect(JSON.parse(raw)).toEqual(value);
    const pager = new ToolResultPager();
    const page = JSON.parse(
      toolResultContent(
        { structuredContent: value },
        {
          pager,
          maxTokens: 1024,
          sessionId: 'editor:p',
          toolName: 'ograf_get_project',
        },
      ),
    );
    expect(page.kind).toBe('tool-result-page');
    expect(page.readTool).toBe('ograf_read_result_page');
    expect(page.source.sessionId).toBe('editor:p');
    expect(raw).not.toContain('Tool result truncated');
  });

  it('reports external MCP activity and enforces the optional exclusive lock', async () => {
    const host = createOGrafAuthoringHost();
    const events: ChatServerEvent[] = [];
    const controller = new ChatAgentController(
      createOGrafToolRecords(host.workspace, host.bridge),
      (event) => events.push(event),
    );
    controller.handle({ type: 'chat.exclusive', enabled: true });
    const release = controller.beginExternalRequest();
    expect(release).not.toBeNull();
    controller.handle({
      type: 'chat.send',
      turnId: 'exclusive-turn',
      sessionId: 'editor',
      text: 'Rename the project',
    });
    await Promise.resolve();
    expect(events).toContainEqual({ type: 'chat.external', active: true });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'chat.error', turnId: 'exclusive-turn' }),
    );
    release?.();
    expect(events).toContainEqual({ type: 'chat.external', active: false });
  });

  it('executes one revisioned shared-tool batch and accounts for a cached continuation', async () => {
    let requestCount = 0;
    const provider = createServer((_request, response) => {
      requestCount += 1;
      response.setHeader('content-type', 'application/json');
      if (requestCount === 1) {
        response.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'mutation-1',
                      type: 'function',
                      function: {
                        name: 'ograf_apply_operations',
                        arguments: JSON.stringify({
                          sessionId: 'editor',
                          expectedRevision: 0,
                          operations: [{ type: 'set_project_metadata', name: 'Chat Mutated' }],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }),
        );
      } else {
        response.end(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: 'Done.' } }],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 10,
              prompt_tokens_details: { cached_tokens: 90 },
            },
          }),
        );
      }
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
    vi.mocked(loadAgentProviderConfig).mockResolvedValue({
      provider: 'openai-compatible',
      baseUrl,
      model: 'test-model',
      apiKey: 'loop-secret',
      effort: 'medium',
    });

    const host = createOGrafAuthoringHost();
    const events: ChatServerEvent[] = [];
    let finish!: () => void;
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const controller = new ChatAgentController(
      createOGrafToolRecords(host.workspace, host.bridge),
      (event) => {
        events.push(event);
        if (event.type === 'chat.turn.end' || event.type === 'chat.error') finish();
      },
    );
    controller.handle({
      type: 'chat.send',
      turnId: 'turn-1',
      sessionId: 'editor',
      text: 'Rename the project',
      ambient: { frame: 12, selection: { layerIds: [] } },
    });
    await completed;
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));

    expect(host.workspace.get('editor').revision).toBe(1);
    expect(host.workspace.get('editor').snapshot().project.name).toBe('Chat Mutated');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'chat.tool', name: 'ograf_apply_operations', status: 'ok' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'chat.progress',
        phase: 'waiting',
        round: 1,
        message: expect.stringContaining('test-model'),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'chat.progress', phase: 'continuing', round: 2 }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'chat.turn.end',
        usage: expect.objectContaining({ cacheRead: 90 }),
      }),
    );
  }, 15_000);

  it('reports progress and fails a silent provider request after the configured timeout', async () => {
    const provider = createServer(() => {
      // Deliberately leave the response pending until the agent-side timeout aborts the request.
    });
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;
    vi.mocked(loadAgentProviderConfig).mockResolvedValue({
      provider: 'openai-compatible',
      baseUrl,
      model: 'silent-model',
      apiKey: 'timeout-secret',
      effort: 'medium',
    });
    process.env.OGRAF_AGENT_TIMEOUT_MS = '100';

    const host = createOGrafAuthoringHost();
    const events: ChatServerEvent[] = [];
    let finish!: () => void;
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const controller = new ChatAgentController(
      createOGrafToolRecords(host.workspace, host.bridge),
      (event) => {
        events.push(event);
        if (event.type === 'chat.error') finish();
      },
    );
    controller.handle({
      type: 'chat.send',
      turnId: 'timeout-turn',
      sessionId: 'editor',
      text: 'Build something',
    });

    await completed;
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'chat.progress', phase: 'waiting', round: 1 }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'chat.error',
        turnId: 'timeout-turn',
        message: expect.stringContaining('did not respond within'),
      }),
    );
  });
});
