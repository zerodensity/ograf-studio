import { createPublicMarketsProvider, type PublicMarketsProvider } from './publicMarkets';
import type { PublicMarketWorkerRequest, PublicMarketWorkerResponse } from './publicMarketsReader';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PublicMarketWorkerRequest>) => void) | null;
  postMessage(message: PublicMarketWorkerResponse): void;
  close(): void;
};
let provider: PublicMarketsProvider | undefined;
let disposed = false;
const pending = new Map<number, AbortController>();
scope.onmessage = (event) => {
  const message = event.data;
  if (disposed) return;
  if (message.type === 'dispose') {
    disposed = true;
    for (const controller of pending.values()) controller.abort();
    pending.clear();
    provider?.dispose();
    scope.close();
    return;
  }
  if (message.type === 'cancel') {
    pending.get(message.requestId)?.abort();
    return;
  }
  if (message.type === 'initialize') {
    if (provider) {
      scope.postMessage({ type: 'ready' });
      return;
    }
    try {
      provider = createPublicMarketsProvider({ symbols: message.symbols });
      scope.postMessage({ type: 'ready' });
    } catch (cause) {
      scope.postMessage({
        type: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
    return;
  }
  if (message.type !== 'read') return;
  if (!provider) {
    scope.postMessage({
      type: 'error',
      requestId: message.requestId,
      message: 'Public market worker is not initialized.',
    });
    return;
  }
  if (pending.has(message.requestId)) return;
  const controller = new AbortController();
  pending.set(message.requestId, controller);
  void provider
    .fetchSnapshot({ signal: controller.signal })
    .then(
      (snapshot) => {
        if (!disposed && !controller.signal.aborted)
          scope.postMessage({ type: 'snapshot', requestId: message.requestId, snapshot });
      },
      (cause: unknown) => {
        if (!disposed && !controller.signal.aborted)
          scope.postMessage({
            type: 'error',
            requestId: message.requestId,
            message: cause instanceof Error ? cause.message : String(cause),
            name: cause instanceof Error ? cause.name : undefined,
          });
      },
    )
    .finally(() => {
      pending.delete(message.requestId);
    });
};
