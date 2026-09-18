import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { redactProviderError, type AgentProviderConfig } from './config';
import { createProviderAdapter, supportsAmbientSystemMessage } from './providerAdapters';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function mockEndpoint(responseBody: unknown): Promise<{
  baseUrl: string;
  request: Promise<{ url: string; body: any; authorization?: string }>;
}> {
  let resolveRequest!: (value: { url: string; body: any; authorization?: string }) => void;
  const request = new Promise<{ url: string; body: any; authorization?: string }>((resolve) => {
    resolveRequest = resolve;
  });
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    incoming.on('end', () => {
      resolveRequest({
        url: incoming.url ?? '',
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        ...(incoming.headers.authorization
          ? { authorization: incoming.headers.authorization }
          : {}),
      });
      outgoing.setHeader('content-type', 'application/json');
      outgoing.end(JSON.stringify(responseBody));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, request };
}

function config(provider: AgentProviderConfig['provider'], baseUrl: string): AgentProviderConfig {
  return {
    provider,
    baseUrl,
    model: 'test-model',
    apiKey: 'top-secret-test-key',
    effort: 'medium',
  };
}

describe('provider adapters', () => {
  it.each(['anthropic', 'openai-compatible'] as const)(
    'preserves numbered image/annotation ordering for %s',
    async (provider) => {
      const mock = await mockEndpoint(
        provider === 'anthropic'
          ? { content: [], usage: {} }
          : { choices: [{ message: { content: 'ok' } }] },
      );
      const images = ['smaller', 'bigger font', 'red'].map((note, index) => ({
        mimeType: 'image/png' as const,
        data: Buffer.from(note).toString('base64'),
        width: 1,
        height: 1,
        label: `Area ${index + 1}: ${note}`,
      }));
      await createProviderAdapter(config(provider, mock.baseUrl)).complete({
        system: 'Studio',
        messages: [{ role: 'user', content: 'Fix these regions', images }],
        tools: [],
        signal: new AbortController().signal,
      });
      const blocks = (await mock.request).body.messages.find(
        (message: { role: string }) => message.role === 'user',
      ).content;
      expect(blocks).toHaveLength(7);
      images.forEach((image, index) => {
        expect(blocks[1 + index * 2]).toEqual({ type: 'text', text: image.label });
        expect(
          provider === 'anthropic'
            ? blocks[2 + index * 2].source.data
            : blocks[2 + index * 2].image_url.url,
        ).toBe(provider === 'anthropic' ? image.data : `data:image/png;base64,${image.data}`);
      });
    },
  );
  it.each(['anthropic', 'openai-compatible'] as const)(
    'sends visual references as native image content to %s',
    async (provider) => {
      const mock = await mockEndpoint(
        provider === 'anthropic'
          ? { content: [], usage: {} }
          : { choices: [{ message: { content: 'ok' } }] },
      );
      const adapter = createProviderAdapter(config(provider, mock.baseUrl));
      await adapter.complete({
        system: 'Edit the graphic',
        messages: [
          {
            role: 'user',
            content: 'Fix this area',
            images: [{ mimeType: 'image/png', data: 'aW1hZ2U=', width: 1, height: 1 }],
          },
        ],
        tools: [],
        signal: new AbortController().signal,
      });
      const sent = (await mock.request).body.messages.find(
        (message: { role: string; content: unknown }) => message.role === 'user',
      );
      expect(sent.content[0]).toEqual({ type: 'text', text: 'Fix this area' });
      expect(sent.content[1]).toEqual(
        provider === 'anthropic'
          ? { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } }
          : { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
      );
    },
  );
  it('uses a configured OpenAI-compatible base URL and normalizes function calls/cache usage', async () => {
    const mock = await mockEndpoint({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                function: { name: 'ograf_query_scene', arguments: '{"text":"score"}' },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 80 },
      },
    });
    const completion = await createProviderAdapter(
      config('openai-compatible', mock.baseUrl),
    ).complete({
      system: 'stable',
      messages: [{ role: 'user', content: 'find score' }],
      tools: [{ name: 'ograf_query_scene', description: 'query', inputSchema: { type: 'object' } }],
      signal: new AbortController().signal,
    });
    const request = await mock.request;
    expect(request.url).toBe('/v1/chat/completions');
    expect(request.authorization).toBe('Bearer top-secret-test-key');
    expect(completion.toolCalls[0]).toMatchObject({
      name: 'ograf_query_scene',
      arguments: { text: 'score' },
    });
    expect(completion.usage.cacheRead).toBe(80);
  });

  it('normalizes Anthropic tool_use and cache-read accounting', async () => {
    const mock = await mockEndpoint({
      content: [
        {
          type: 'tool_use',
          id: 'call-a',
          name: 'ograf_get_project',
          input: { sessionId: 'editor' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 90, output_tokens: 15, cache_read_input_tokens: 70 },
    });
    const completion = await createProviderAdapter(config('anthropic', mock.baseUrl)).complete({
      system: 'stable',
      messages: [{ role: 'user', content: 'read' }],
      tools: [{ name: 'ograf_get_project', description: 'read', inputSchema: { type: 'object' } }],
      signal: new AbortController().signal,
    });
    expect((await mock.request).url).toBe('/v1/messages');
    expect(completion.toolCalls[0]?.name).toBe('ograf_get_project');
    expect(completion.usage.cacheRead).toBe(70);
  });

  it('model-gates ambient system messages and redacts credentials from provider errors', () => {
    expect(supportsAmbientSystemMessage('claude-opus-5')).toBe(true);
    expect(supportsAmbientSystemMessage('claude-sonnet-5')).toBe(false);
    expect(
      redactProviderError(new Error('Authorization: Bearer top-secret-test-key'), [
        'top-secret-test-key',
      ]),
    ).not.toContain('top-secret-test-key');
  });
});
