import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PUBLIC_MARKET_SYMBOLS,
  createFieldDefinition,
  type DataConnectionDefinition,
} from '@ograf-editor/scene-model';
import {
  createDataConnectionRuntime,
  dataConnectionSourceKey,
  type DataConnectionConsumer,
} from './dataConnectionRuntimeCore';

const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
const field = createFieldDefinition('number', {
  id: 'price-field',
  key: 'price',
  defaultValue: 10,
});
function connection(patch: Partial<DataConnectionDefinition> = {}): DataConnectionDefinition {
  return {
    id: 'feed',
    name: 'Quotes',
    source: 'url',
    format: 'json',
    url: 'https://example.test/quotes',
    embeddedText: '',
    refreshMs: 1000,
    missing: 'keep-last',
    enabled: true,
    mappings: [{ fieldId: field.id, sourcePath: 'price' }],
    ...patch,
  };
}
function consumer(
  key: string,
  patch: Partial<DataConnectionConsumer> = {},
): DataConnectionConsumer {
  return {
    key,
    statusKey: key,
    version: 'initial',
    connection: connection(),
    fields: [field],
    previous: () => ({}),
    apply: vi.fn(() => true),
    ...patch,
  };
}
const disposers: Array<() => void> = [];
function runtime(read = vi.fn(async (_signal: AbortSignal): Promise<unknown> => ({ price: 20 }))) {
  const dispose = vi.fn();
  const status = vi.fn();
  const createReader = vi.fn(() => ({ read, dispose }));
  const result = createDataConnectionRuntime({ createReader, status });
  disposers.push(result.dispose);
  return { result, read, dispose, status, createReader };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

describe('application data connection lifecycle', () => {
  it('deduplicates omitted and explicit default market symbols while preserving requested order', () => {
    const implicit = connection({ source: 'public-markets' });
    const explicit = connection({
      source: 'public-markets',
      publicMarkets: { symbols: [...DEFAULT_PUBLIC_MARKET_SYMBOLS] },
    });
    expect(dataConnectionSourceKey(implicit)).toBe(dataConnectionSourceKey(explicit));
    expect(
      dataConnectionSourceKey({
        ...explicit,
        publicMarkets: { symbols: [...DEFAULT_PUBLIC_MARKET_SYMBOLS].reverse() },
      }),
    ).not.toBe(dataConnectionSourceKey(explicit));
  });
  it('shares one source read across templates and keeps polling without any mounted pane', async () => {
    const { result, read } = runtime();
    const editor = consumer('editor'),
      preview = consumer('preview');
    result.reconcile([editor, preview]);
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    expect(editor.apply).toHaveBeenCalledWith({ 'price-field': 20 });
    expect(preview.apply).toHaveBeenCalledWith({ 'price-field': 20 });
    await vi.advanceTimersByTimeAsync(3100);
    expect(read).toHaveBeenCalledTimes(4);
    expect(editor.apply).toHaveBeenCalledTimes(1);
  });
  it('aborts only after the last destination releases a shared source and ignores late results', async () => {
    let resolve!: (payload: unknown) => void;
    const { result, read, dispose } = runtime(
      vi.fn(
        (_signal) =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    );
    const a = consumer('a'),
      b = consumer('b');
    result.reconcile([a, b]);
    await flush();
    const signal = read.mock.calls[0]![0];
    result.reconcile([b]);
    expect(signal.aborted).toBe(false);
    result.reconcile([]);
    expect(signal.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    resolve({ price: 99 });
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(a.apply).not.toHaveBeenCalled();
    expect(b.apply).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('retains the latest payload while paused or transitioning and flushes once eligible', async () => {
    let allowed = false;
    const apply = vi.fn(() => allowed);
    const { result, read } = runtime();
    const target = consumer('preview', { apply });
    result.reconcile([target]);
    await flush();
    allowed = true;
    result.reconcile([target]);
    await flush();
    result.reconcile([target]);
    await flush();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(1);
    result.reconcile([{ ...target, version: 'another-take-instance' }]);
    await flush();
    expect(apply).toHaveBeenCalledTimes(3);
  });
  it('does not overlap fetches or replay a disabled connection after a late response', async () => {
    let resolve!: (payload: unknown) => void;
    const { result, read } = runtime(
      vi.fn(
        (_signal) =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    );
    const target = consumer('editor');
    result.reconcile([target]);
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledTimes(1);
    result.reconcile([{ ...target, connection: connection({ enabled: false }) }]);
    resolve({ price: 90 });
    await flush();
    expect(target.apply).not.toHaveBeenCalled();
    await expect(result.refresh('editor')).rejects.toThrow('Enable');
  });
  it('keeps last-good output on a request failure and recovers on the next poll', async () => {
    const read = vi.fn(async (_signal: AbortSignal) => ({ price: 20 }));
    read.mockRejectedValueOnce(new Error('Feed unavailable'));
    const { result, status } = runtime(read);
    const target = consumer('editor');
    result.reconcile([target]);
    await flush();
    expect(target.apply).not.toHaveBeenCalled();
    expect(status.mock.lastCall?.[1]).toMatchObject({
      phase: 'error',
      message: 'Feed unavailable',
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(target.apply).toHaveBeenCalledWith({ 'price-field': 20 });
  });
  it('keeps zero-interval connections manual and coalesces simultaneous Refresh requests', async () => {
    const { result, read } = runtime();
    result.reconcile([consumer('manual', { connection: connection({ refreshMs: 0 }) })]);
    await flush();
    expect(read).not.toHaveBeenCalled();
    await Promise.all([result.refresh('manual'), result.refresh('manual')]);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
