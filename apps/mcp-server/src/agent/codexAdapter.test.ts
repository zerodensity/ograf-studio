import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAdapter } from './codexAdapter';
import { loadAgentProviderConfig } from './config';
import type { ProviderRequest } from './types';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFile: vi.fn() }));

const originalEnvironment = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.clearAllMocks();
});

function fakeServer(hang = false) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  const sent: any[] = [];
  const emit = (message: unknown) => child.stdout.write(JSON.stringify(message) + '\n');
  child.stdin.on('data', (data) => {
    const message = JSON.parse(data.toString());
    sent.push(message);
    const reply = (result: unknown) => emit({ id: message.id, result });
    if (message.method === 'initialize') reply({});
    if (message.method === 'account/read') reply({ account: { type: 'chatgpt' } });
    if (message.method === 'config/read') reply({ config: { mcp_servers: { unrelated: {} } } });
    if (message.method === 'thread/start')
      reply({ thread: { id: 'thread-test' }, model: 'test-model' });
    if (message.method === 'turn/start') {
      reply({ turn: { id: 'turn-test' } });
      if (!hang)
        queueMicrotask(() =>
          emit({
            id: 0,
            method: 'item/tool/call',
            params: {
              callId: 'call-test',
              tool: 'ograf_query_scene',
              arguments: { text: 'Headline' },
            },
          }),
        );
    }
    if (message.id === 0 && message.result) {
      emit({
        method: 'thread/tokenUsage/updated',
        params: {
          tokenUsage: { total: { inputTokens: 100, outputTokens: 25, cachedInputTokens: 60 } },
        },
      });
      emit({
        method: 'item/completed',
        params: { item: { type: 'agentMessage', text: 'Checked the scene.' } },
      });
      emit({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
    }
  });
  vi.mocked(spawn).mockReturnValue(child as never);
  return { child, sent };
}

function request(signal = new AbortController().signal): ProviderRequest {
  return {
    system: 'Studio instructions',
    model: 'default',
    messages: [
      {
        role: 'user',
        content: 'Inspect this area',
        images: [{ mimeType: 'image/png', data: 'aW1hZ2U=', width: 1, height: 1 }],
      },
    ],
    tools: [
      {
        name: 'ograf_query_scene',
        description: 'Read the scene',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    signal,
  };
}

const config = {
  provider: 'codex' as const,
  baseUrl: '',
  apiKey: '',
  model: 'default',
  effort: 'medium' as const,
};

describe('Codex provider', () => {
  it('loads Codex configuration without an API key or endpoint', async () => {
    process.env.OGRAF_AGENT_PROVIDER = 'codex';
    delete process.env.OGRAF_AGENT_MODEL;
    delete process.env.OGRAF_AGENT_API_KEY;
    expect(await loadAgentProviderConfig()).toMatchObject({
      provider: 'codex',
      model: 'default',
      apiKey: '',
    });
  });

  it('transports images and round-trips dynamic tool calls through Studio', async () => {
    process.env.CODEX_APP_TOOLS_PIPE_PATH = 'test-pipe';
    const server = fakeServer();
    const adapter = new CodexAdapter(config);
    const input = request();
    try {
      const first = await adapter.complete(input);
      expect(first.toolCalls).toEqual([
        { id: 'call-test', name: 'ograf_query_scene', arguments: { text: 'Headline' } },
      ]);
      const start = server.sent.find((message) => message.method === 'thread/start').params;
      expect(start).toMatchObject({
        ephemeral: true,
        sandbox: 'read-only',
        environments: [],
        config: { 'mcp_servers.unrelated.enabled': false },
      });
      expect(start.model).toBeUndefined();
      expect(
        server.sent.find((message) => message.method === 'turn/start').params.input[1],
      ).toEqual({ type: 'image', url: 'data:image/png;base64,aW1hZ2U=' });
      expect(vi.mocked(spawn).mock.calls[0]![2]).toMatchObject({ windowsHide: true });
      expect(
        (vi.mocked(spawn).mock.calls[0]![2] as any).env.CODEX_APP_TOOLS_PIPE_PATH,
      ).toBeUndefined();
      input.messages.push({
        role: 'tool',
        callId: 'call-test',
        name: 'ograf_query_scene',
        content: '{"layers":[]}',
      });
      expect(await adapter.complete(input)).toMatchObject({
        text: 'Checked the scene.',
        toolCalls: [],
        usage: { input: 100, output: 25, cacheRead: 60 },
      });
      expect(
        server.sent.find((message) => message.id === 0 && message.result).result.contentItems[0]
          .text,
      ).toBe('{"layers":[]}');
    } finally {
      await adapter.dispose();
    }
    expect(server.child.kill).toHaveBeenCalled();
  });

  it('interrupts and terminates a waiting Codex turn on cancellation', async () => {
    const server = fakeServer(true);
    const adapter = new CodexAdapter(config);
    const abort = new AbortController();
    const pending = adapter.complete(request(abort.signal));
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() =>
      expect(server.sent.some((message) => message.method === 'turn/start')).toBe(true),
    );
    abort.abort();
    await rejection;
    await adapter.dispose();
    expect(server.sent.some((message) => message.method === 'turn/interrupt')).toBe(true);
    expect(server.child.kill).toHaveBeenCalled();
  });
  it('pairs each of multiple area images with its label in the Codex turn', async () => {
    const server = fakeServer();
    const adapter = new CodexAdapter(config);
    const input = request();
    const images = ['Make smaller', 'Bigger font', 'Different colour'].map((note, index) => ({
      mimeType: 'image/png' as const,
      data: Buffer.from(note).toString('base64'),
      width: 1,
      height: 1,
      label: `Area ${index + 1}: ${note}`,
    }));
    input.messages = [{ role: 'user', content: 'Apply these notes', images }];
    try {
      await adapter.complete(input);
      const parts = server.sent.find((message) => message.method === 'turn/start').params.input;
      expect(parts).toHaveLength(7);
      images.forEach((image, index) => {
        expect(parts[1 + index * 2]).toEqual({
          type: 'text',
          text: image.label,
          text_elements: [],
        });
        expect(parts[2 + index * 2]).toEqual({
          type: 'image',
          url: `data:image/png;base64,${image.data}`,
        });
      });
    } finally {
      await adapter.dispose();
    }
  });
});
