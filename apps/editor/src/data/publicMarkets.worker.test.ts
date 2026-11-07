import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicMarketWorkerRequest, PublicMarketWorkerResponse } from './publicMarketsReader';

const provider = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), dispose: vi.fn() }));
vi.mock('./publicMarkets', () => ({
  createPublicMarketsProvider: (...args: unknown[]) => {
    provider.create(...args);
    return { fetchSnapshot: provider.read, dispose: provider.dispose };
  },
}));
const flush = async () => {
  for (let index = 0; index < 10; index++) await Promise.resolve();
};
let scope: {
  onmessage: ((event: MessageEvent<PublicMarketWorkerRequest>) => void) | null;
  postMessage: ReturnType<typeof vi.fn<(message: PublicMarketWorkerResponse) => void>>;
  close: ReturnType<typeof vi.fn>;
};
const send = (data: PublicMarketWorkerRequest) =>
  scope.onmessage?.({ data } as MessageEvent<PublicMarketWorkerRequest>);
beforeEach(async () => {
  vi.resetModules();
  provider.create.mockReset();
  provider.read.mockReset().mockResolvedValue({ version: 1, btcPrice: '101.00' });
  provider.dispose.mockReset();
  scope = { onmessage: null, postMessage: vi.fn(), close: vi.fn() };
  vi.stubGlobal('self', scope);
  await import('./publicMarkets.worker');
});
afterEach(() => {
  send({ type: 'dispose' });
  vi.unstubAllGlobals();
});

describe('public market worker source lifecycle', () => {
  it('retains one provider and its cache through repeated reads', async () => {
    send({ type: 'initialize', symbols: ['BTC-USD'] });
    send({ type: 'initialize', symbols: ['ETH-USD'] });
    send({ type: 'read', requestId: 1 });
    send({ type: 'read', requestId: 2 });
    await flush();
    expect(provider.create).toHaveBeenCalledExactlyOnceWith({ symbols: ['BTC-USD'] });
    expect(provider.read).toHaveBeenCalledTimes(2);
    expect(scope.postMessage).toHaveBeenCalledWith({
      type: 'snapshot',
      requestId: 1,
      snapshot: { version: 1, btcPrice: '101.00' },
    });
    expect(scope.postMessage).toHaveBeenCalledWith({
      type: 'snapshot',
      requestId: 2,
      snapshot: { version: 1, btcPrice: '101.00' },
    });
  });

  it('aborts the cancelled request and discards a late successful observation', async () => {
    let release!: (value: unknown) => void;
    provider.read.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    send({ type: 'initialize' });
    send({ type: 'read', requestId: 5 });
    const signal = provider.read.mock.calls[0]![0].signal as AbortSignal;
    send({ type: 'cancel', requestId: 5 });
    expect(signal.aborted).toBe(true);
    release({ version: 1, btcPrice: 'LATE' });
    await flush();
    expect(scope.postMessage.mock.calls.some(([message]) => message.type === 'snapshot')).toBe(
      false,
    );
    send({ type: 'read', requestId: 6 });
    await flush();
    expect(scope.postMessage).toHaveBeenCalledWith({
      type: 'snapshot',
      requestId: 6,
      snapshot: { version: 1, btcPrice: '101.00' },
    });
  });

  it('reports a provider failure while retaining its instance for recovery', async () => {
    provider.read.mockRejectedValueOnce(new Error('Quote source failed'));
    send({ type: 'initialize' });
    send({ type: 'read', requestId: 7 });
    await flush();
    expect(scope.postMessage).toHaveBeenCalledWith({
      type: 'error',
      requestId: 7,
      name: 'Error',
      message: 'Quote source failed',
    });
    send({ type: 'read', requestId: 8 });
    await flush();
    expect(scope.postMessage).toHaveBeenCalledWith({
      type: 'snapshot',
      requestId: 8,
      snapshot: { version: 1, btcPrice: '101.00' },
    });
    expect(provider.create).toHaveBeenCalledTimes(1);
  });

  it('disposes the provider, aborts pending work and publishes nothing after source release', async () => {
    let release!: (value: unknown) => void;
    provider.read.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    send({ type: 'initialize' });
    send({ type: 'read', requestId: 9 });
    const signal = provider.read.mock.calls[0]![0].signal as AbortSignal;
    scope.postMessage.mockClear();
    send({ type: 'dispose' });
    send({ type: 'dispose' });
    expect(signal.aborted).toBe(true);
    release({ version: 1 });
    await flush();
    send({ type: 'read', requestId: 10 });
    expect(provider.dispose).toHaveBeenCalledTimes(1);
    expect(scope.close).toHaveBeenCalledTimes(1);
    expect(scope.postMessage).not.toHaveBeenCalled();
  });
});
