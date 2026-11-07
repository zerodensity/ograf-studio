import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicMarketsSnapshot } from './publicMarkets';
import {
  createPublicMarketsReader,
  type PublicMarketWorkerRequest,
  type PublicMarketWorkerResponse,
} from './publicMarketsReader';

const fallback = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), dispose: vi.fn() }));
vi.mock('./publicMarkets', () => ({
  createPublicMarketsProvider: (...args: unknown[]) => {
    fallback.create(...args);
    return { fetchSnapshot: fallback.read, dispose: fallback.dispose };
  },
}));

class FeedWorker {
  static instances: FeedWorker[] = [];
  static rejectConstruction = false;
  onmessage: ((event: MessageEvent<PublicMarketWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: PublicMarketWorkerRequest[] = [];
  terminate = vi.fn();
  readonly url: URL;
  readonly options: WorkerOptions;
  constructor(url: URL, options: WorkerOptions) {
    if (FeedWorker.rejectConstruction) throw new Error('Module worker blocked');
    this.url = url;
    this.options = options;
    FeedWorker.instances.push(this);
  }
  postMessage(message: PublicMarketWorkerRequest) {
    this.messages.push(message);
  }
  emit(data: PublicMarketWorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<PublicMarketWorkerResponse>);
  }
  crash(message: string) {
    this.onerror?.({ message, preventDefault: vi.fn() } as unknown as ErrorEvent);
  }
  lastRead() {
    const request = this.messages.filter((message) => message.type === 'read').at(-1);
    if (!request || request.type !== 'read') throw new Error('No read requested');
    return request.requestId;
  }
}
const flush = async () => {
  for (let index = 0; index < 10; index++) await Promise.resolve();
};
const snapshot = (price = '100.00'): PublicMarketsSnapshot => ({
  version: 1,
  btcPrice: price,
  cryptoStatus: 'LIVE',
});
let readers: ReturnType<typeof createPublicMarketsReader>[];
function create() {
  const reader = createPublicMarketsReader({ symbols: ['BTC-USD'] });
  readers.push(reader);
  return { reader, worker: FeedWorker.instances.at(-1)! };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FeedWorker);
  FeedWorker.instances = [];
  FeedWorker.rejectConstruction = false;
  readers = [];
  fallback.create.mockReset();
  fallback.read.mockReset().mockResolvedValue(snapshot());
  fallback.dispose.mockReset();
});
afterEach(() => {
  for (const reader of readers) reader.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('persistent public market worker reader', () => {
  it('keeps one module worker and distinguishes current reads from late replies', async () => {
    const { reader, worker } = create();
    expect(worker.url.pathname).toContain('publicMarkets.worker.ts');
    expect(worker.options.type).toBe('module');
    expect(worker.messages).toEqual([{ type: 'initialize', symbols: ['BTC-USD'] }]);
    worker.emit({ type: 'ready' });
    const first = reader.fetchSnapshot();
    await flush();
    const firstId = worker.lastRead();
    worker.emit({ type: 'snapshot', requestId: firstId, snapshot: snapshot('100.00') });
    expect((await first).btcPrice).toBe('100.00');
    const second = reader.fetchSnapshot();
    await flush();
    const secondId = worker.lastRead();
    worker.emit({ type: 'snapshot', requestId: firstId, snapshot: snapshot('OLD') });
    worker.emit({ type: 'snapshot', requestId: secondId, snapshot: snapshot('101.00') });
    expect((await second).btcPrice).toBe('101.00');
    expect(FeedWorker.instances).toHaveLength(1);
    expect(fallback.create).not.toHaveBeenCalled();
  });

  it('forwards request abort without terminating the shared source or accepting cancelled results', async () => {
    const { reader, worker } = create();
    worker.emit({ type: 'ready' });
    const controller = new AbortController();
    const pending = reader.fetchSnapshot({ signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    const id = worker.lastRead();
    controller.abort();
    await rejected;
    expect(worker.messages).toContainEqual({ type: 'cancel', requestId: id });
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emit({ type: 'snapshot', requestId: id, snapshot: snapshot('CANCELLED') });
    const next = reader.fetchSnapshot();
    await flush();
    worker.emit({ type: 'snapshot', requestId: worker.lastRead(), snapshot: snapshot('102.00') });
    expect((await next).btcPrice).toBe('102.00');
  });

  it.each([false, true])(
    'disposes exactly once and rejects pending reads when initialized=%s',
    async (initialized) => {
      const { reader, worker } = create();
      if (initialized) worker.emit({ type: 'ready' });
      const pending = reader.fetchSnapshot();
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await flush();
      const late = worker.onmessage!;
      reader.dispose();
      reader.dispose();
      await rejected;
      late({ data: { type: 'ready' } } as MessageEvent<PublicMarketWorkerResponse>);
      late({
        data: { type: 'error', message: 'late failure' },
      } as MessageEvent<PublicMarketWorkerResponse>);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      expect(worker.messages.filter((message) => message.type === 'dispose')).toHaveLength(1);
      await expect(reader.fetchSnapshot()).rejects.toMatchObject({ name: 'AbortError' });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['missing', 'construction', 'boot-error', 'boot-timeout'] as const)(
    'uses the same native provider when worker support fails at %s',
    async (failure) => {
      if (failure === 'missing') vi.stubGlobal('Worker', undefined);
      if (failure === 'construction') FeedWorker.rejectConstruction = true;
      const { reader, worker } = create();
      const controller = new AbortController();
      const pending = reader.fetchSnapshot({ signal: controller.signal });
      if (failure === 'boot-error') worker.crash('Module could not load');
      if (failure === 'boot-timeout') await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toEqual(snapshot());
      expect(fallback.create).toHaveBeenCalledExactlyOnceWith({ symbols: ['BTC-USD'] });
      expect(fallback.read).toHaveBeenCalledWith({ signal: controller.signal });
      if (worker) expect(worker.terminate).toHaveBeenCalledTimes(1);
      reader.dispose();
      expect(fallback.dispose).toHaveBeenCalledTimes(1);
    },
  );

  it('does not let a late failed-worker callback poison the healthy startup fallback', async () => {
    const { reader, worker } = create();
    const lateMessage = worker.onmessage!,
      lateDecode = worker.onmessageerror!;
    worker.crash('Module unavailable');
    expect(await reader.fetchSnapshot()).toEqual(snapshot());
    lateMessage({
      data: { type: 'error', message: 'late module error' },
    } as MessageEvent<PublicMarketWorkerResponse>);
    lateDecode();
    expect(await reader.fetchSnapshot()).toEqual(snapshot());
    expect(fallback.create).toHaveBeenCalledTimes(1);
  });

  it('surfaces a running-worker failure without silently replacing its last-good cache', async () => {
    const { reader, worker } = create();
    worker.emit({ type: 'ready' });
    const first = reader.fetchSnapshot();
    await flush();
    worker.emit({ type: 'snapshot', requestId: worker.lastRead(), snapshot: snapshot('123.45') });
    const lastGood = await first;
    const pending = reader.fetchSnapshot();
    const rejected = expect(pending).rejects.toThrow('Worker stopped');
    await flush();
    const late = worker.onmessage!;
    worker.crash('Worker stopped');
    await rejected;
    late({
      data: { type: 'snapshot', requestId: worker.lastRead(), snapshot: snapshot('WRONG') },
    } as MessageEvent<PublicMarketWorkerResponse>);
    await expect(reader.fetchSnapshot()).rejects.toThrow('Worker stopped');
    expect(lastGood.btcPrice).toBe('123.45');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(fallback.create).not.toHaveBeenCalled();
  });

  it('bounds stalled reads, forwards cancellation and remains available for the next request', async () => {
    const { reader, worker } = create();
    worker.emit({ type: 'ready' });
    const pending = reader.fetchSnapshot();
    const rejected = expect(pending).rejects.toThrow('30 seconds');
    await flush();
    const id = worker.lastRead();
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(worker.messages).toContainEqual({ type: 'cancel', requestId: id });
    expect(worker.terminate).not.toHaveBeenCalled();
    const next = reader.fetchSnapshot();
    await flush();
    worker.emit({
      type: 'snapshot',
      requestId: worker.lastRead(),
      snapshot: snapshot('RECOVERED'),
    });
    expect((await next).btcPrice).toBe('RECOVERED');
  });
});
