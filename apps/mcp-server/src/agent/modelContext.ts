import type { AssistantContextPreferences } from '@ograf-editor/ui-kit/workspace-model';
import type { AgentProviderConfig } from './config';

export interface ModelContext {
  model: string;
  contextWindowTokens: number;
  source: 'provider' | 'override' | 'fallback';
  providerContextWindowTokens?: number;
}

/** An explicitly labelled estimate for providers which do not publish context metadata. */
export const UNKNOWN_MODEL_CONTEXT_TOKENS = 65_536;
const cache = new Map<string, { expires: number; value: Promise<number | null> }>();
const validCapacity = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 4_096 && value <= 4_194_304;

export function contextCapacityFromMetadata(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  for (const key of [
    'max_input_tokens',
    'context_window',
    'context_length',
    'max_context_length',
    'max_model_len',
  ])
    if (validCapacity(row[key])) return row[key];
  for (const key of ['limits', 'top_provider', 'architecture']) {
    const nested = contextCapacityFromMetadata(row[key]);
    if (nested !== null) return nested;
  }
  return null;
}

function metadataUrl(config: AgentProviderConfig, model: string): URL | null {
  if (config.provider === 'codex') return null;
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    return null;
  }
  // Custom deployment/query endpoints are not safely interchangeable with a models endpoint.
  if (url.search || url.hash || !/^https?:$/.test(url.protocol)) return null;
  const path = url.pathname.replace(/\/$/, '');
  if (path && !/(?:^|\/)v1$|\/v1\/(?:messages|chat\/completions)$/.test(path)) return null;
  const prefix = path.replace(/\/v1(?:\/(?:messages|chat\/completions))?$/, '');
  url.pathname = `${prefix}/v1/models/${encodeURIComponent(model)}`;
  return url;
}

async function discoverContext(
  config: AgentProviderConfig,
  model: string,
  fetcher: typeof fetch,
): Promise<number | null> {
  const url = metadataUrl(config, model);
  if (!url) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, 1_000);
  });
  const work = async (): Promise<number | null> => {
    try {
      const headers: Record<string, string> =
        config.provider === 'anthropic'
          ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }
          : { authorization: `Bearer ${config.apiKey}` };
      if (config.organization) headers['openai-organization'] = config.organization;
      if (config.project) headers['openai-project'] = config.project;
      const response = await fetcher(url, {
        headers,
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) return null;
      const bytes = Number(response.headers.get('content-length'));
      if (Number.isFinite(bytes) && bytes > 65_536) return null;
      // Bound a streaming metadata response as well as providers with Content-Length.
      const reader = response.body?.getReader();
      if (!reader) return null;
      let total = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          total += next.value.byteLength;
          if (total > 65_536) {
            await reader.cancel();
            return null;
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const data = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
      return contextCapacityFromMetadata(JSON.parse(new TextDecoder().decode(data)));
    } catch {
      return null;
    }
  };
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function resolveModelContext(
  config: AgentProviderConfig,
  model: string,
  preferences: AssistantContextPreferences,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ModelContext> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  // Never reuse provider metadata across different credentials/accounts.
  const key = JSON.stringify([
    config.provider,
    config.baseUrl,
    model,
    config.apiKey,
    config.organization,
    config.project,
  ]);
  let entry = cache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    entry = { expires: Date.now() + 10 * 60_000, value: discoverContext(config, model, fetcher) };
    cache.set(key, entry);
    if (cache.size > 32) cache.delete(cache.keys().next().value!);
  }
  let cancel!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
  });
  let capacity: number | null;
  try {
    capacity = await Promise.race([entry.value, cancelled]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const override = preferences.contextWindowTokens;
  if (capacity !== null)
    return {
      model,
      contextWindowTokens: override === null ? capacity : Math.min(capacity, override),
      providerContextWindowTokens: capacity,
      source: override !== null && override < capacity ? 'override' : 'provider',
    };
  return {
    model,
    contextWindowTokens: override ?? UNKNOWN_MODEL_CONTEXT_TOKENS,
    source: override === null ? 'fallback' : 'override',
  };
}
