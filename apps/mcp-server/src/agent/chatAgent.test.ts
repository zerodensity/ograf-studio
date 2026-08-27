import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createOGrafToolRecords } from '@ograf-editor/agent-tools';
import { createOGrafAuthoringHost } from '../index';
import {
  ChatAgentController,
  buildTurnMessages,
  compactChatHistory,
  toolResultContent,
} from './chatAgent';
import type { AgentMessage, ChatServerEvent } from './types';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
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

  it('bounds tool payloads and removes complete old history units without orphaning tool results', () => {
    const result = toolResultContent({ structuredContent: { payload: 'x'.repeat(40_000) } });
    expect(result.length).toBeLessThan(17_000);
    expect(result).toContain('Tool result truncated');

    const messages: AgentMessage[] = [
      { role: 'user', content: 'Old request' },
      { role: 'assistant', content: 'y'.repeat(2_000) },
      { role: 'user', content: 'Current request' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'ograf_get_project', arguments: {} }],
      },
      { role: 'tool', callId: 'call-1', name: 'ograf_get_project', content: 'z'.repeat(2_000) },
      { role: 'assistant', content: 'Current answer' },
    ];
    const compacted = compactChatHistory(messages, 300);
    expect(compacted).toContainEqual({ role: 'user', content: 'Current request' });
    expect(compacted).toContainEqual({ role: 'assistant', content: 'Current answer' });
    expect(compacted.some((message) => message.role === 'tool')).toBe(false);
    expect(
      compacted.some((message) => message.role === 'assistant' && message.toolCalls?.length),
    ).toBe(false);
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
    process.env.OGRAF_AGENT_PROVIDER = 'openai-compatible';
    process.env.OGRAF_AGENT_BASE_URL = baseUrl;
    process.env.OGRAF_AGENT_MODEL = 'test-model';
    process.env.OGRAF_AGENT_API_KEY = 'loop-secret';
    process.env.OGRAF_AGENT_CREDENTIAL_TARGET = `OGraf Studio/test-${Date.now()}`;

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
    process.env.OGRAF_AGENT_PROVIDER = 'openai-compatible';
    process.env.OGRAF_AGENT_BASE_URL = baseUrl;
    process.env.OGRAF_AGENT_MODEL = 'silent-model';
    process.env.OGRAF_AGENT_API_KEY = 'timeout-secret';
    process.env.OGRAF_AGENT_TIMEOUT_MS = '100';
    process.env.OGRAF_AGENT_CREDENTIAL_TARGET = `OGraf Studio/timeout-test-${Date.now()}`;

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
