import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ASSISTANT_CONTEXT_PREFERENCES } from '@ograf-editor/ui-kit/workspace-model';
import {
  contextCapacityFromMetadata,
  resolveModelContext,
  UNKNOWN_MODEL_CONTEXT_TOKENS,
} from './modelContext';
import type { AgentProviderConfig } from './config';

const config = (model: string): AgentProviderConfig => ({
  provider: 'openai-compatible',
  baseUrl: 'https://provider.example/v1',
  model,
  apiKey: `test-${model}`,
  effort: 'medium',
});
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());

describe('selected model context metadata', () => {
  it('uses provider metadata and never enlarges it to a user override', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ context_length: 128000 })),
    ) as unknown as typeof fetch;
    const larger = await resolveModelContext(
      config('metadata'),
      'metadata',
      { ...DEFAULT_ASSISTANT_CONTEXT_PREFERENCES, contextWindowTokens: 400000 },
      signal(),
      fetcher,
    );
    expect(larger).toMatchObject({
      contextWindowTokens: 128000,
      source: 'provider',
      providerContextWindowTokens: 128000,
    });
    const smaller = await resolveModelContext(
      config('metadata'),
      'metadata',
      { ...DEFAULT_ASSISTANT_CONTEXT_PREFERENCES, contextWindowTokens: 32000 },
      signal(),
      fetcher,
    );
    expect(smaller).toMatchObject({ contextWindowTokens: 32000, source: 'override' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetcher).mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });
  it('reads Anthropic input limits and compatible-provider nested capacities without guessing names', () => {
    expect(contextCapacityFromMetadata({ max_input_tokens: 200000, max_tokens: 64000 })).toBe(
      200000,
    );
    expect(contextCapacityFromMetadata({ top_provider: { context_length: 100000 } })).toBe(100000);
    expect(contextCapacityFromMetadata({ id: 'gpt-whatever', max_tokens: 64000 })).toBeNull();
    expect(contextCapacityFromMetadata({ context_window: Infinity })).toBeNull();
  });
  it('labels unknown model fallback and permits an explicit override', async () => {
    const fetcher = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    expect(
      await resolveModelContext(
        config('unknown'),
        'unknown',
        DEFAULT_ASSISTANT_CONTEXT_PREFERENCES,
        signal(),
        fetcher,
      ),
    ).toMatchObject({ contextWindowTokens: UNKNOWN_MODEL_CONTEXT_TOKENS, source: 'fallback' });
    expect(
      await resolveModelContext(
        config('unknown'),
        'unknown',
        { ...DEFAULT_ASSISTANT_CONTEXT_PREFERENCES, contextWindowTokens: 96000 },
        signal(),
        fetcher,
      ),
    ).toMatchObject({ contextWindowTokens: 96000, source: 'override' });
  });
  it('resolves a cheap model separately and does not reuse another model capacity', async () => {
    const fetcher = vi.fn(
      async (url: unknown) =>
        new Response(
          JSON.stringify({ context_length: String(url).endsWith('/cheap') ? 32000 : 200000 }),
        ),
    ) as unknown as typeof fetch;
    expect(
      (
        await resolveModelContext(
          config('pair'),
          'primary',
          DEFAULT_ASSISTANT_CONTEXT_PREFERENCES,
          signal(),
          fetcher,
        )
      ).contextWindowTokens,
    ).toBe(200000);
    expect(
      (
        await resolveModelContext(
          config('pair'),
          'cheap',
          DEFAULT_ASSISTANT_CONTEXT_PREFERENCES,
          signal(),
          fetcher,
        )
      ).contextWindowTokens,
    ).toBe(32000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not probe custom query/deployment routes or the native Codex adapter', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    for (const item of [
      { ...config('custom'), baseUrl: 'https://provider.example/deployment/chat?api-version=1' },
      { ...config('codex'), provider: 'codex' as const },
    ])
      expect(
        (
          await resolveModelContext(
            item,
            item.model,
            DEFAULT_ASSISTANT_CONTEXT_PREFERENCES,
            signal(),
            fetcher,
          )
        ).source,
      ).toBe('fallback');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds an unavailable metadata probe even when a fetcher ignores cancellation', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    const result = resolveModelContext(
      config('timeout'),
      'timeout',
      DEFAULT_ASSISTANT_CONTEXT_PREFERENCES,
      signal(),
      fetcher,
    );
    await vi.advanceTimersByTimeAsync(1001);
    expect((await result).source).toBe('fallback');
  });
  it('allows user cancellation while shared metadata discovery is still pending', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    const result = resolveModelContext(
      config('cancel'),
      'cancel',
      DEFAULT_ASSISTANT_CONTEXT_PREFERENCES,
      controller.signal,
      fetcher,
    );
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
  });
});
