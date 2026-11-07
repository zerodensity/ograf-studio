import {
  createPublicMarketsProvider,
  type PublicMarketsProvider,
  type PublicMarketsSnapshot,
} from './publicMarkets';

export type PublicMarketWorkerRequest =
  | { type: 'initialize'; symbols?: readonly string[] }
  | { type: 'read'; requestId: number }
  | { type: 'cancel'; requestId: number }
  | { type: 'dispose' };
export type PublicMarketWorkerResponse =
  | { type: 'ready' }
  | { type: 'snapshot'; requestId: number; snapshot: PublicMarketsSnapshot }
  | { type: 'error'; requestId?: number; message: string; name?: string };

interface PendingRead {
  finish(error?: Error, snapshot?: PublicMarketsSnapshot): void;
}
const abortError = () => new DOMException('Public market request cancelled.', 'AbortError');
const asError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

/** One persistent worker per shared source reader; the runtime already deduplicates consumers. */
export function createPublicMarketsReader(
  options: { symbols?: readonly string[] } = {},
): PublicMarketsProvider {
  if (typeof Worker === 'undefined') return createPublicMarketsProvider(options);
  let worker: Worker | undefined;
  try {
    worker = new Worker(new URL('./publicMarkets.worker.ts', import.meta.url), {
      type: 'module',
      name: 'OGraf public market data',
    });
  } catch {
    return createPublicMarketsProvider(options);
  }
  let closed = false,
    initialized = false,
    sequence = 0;
  let fallback: PublicMarketsProvider | undefined;
  let failure: Error | undefined;
  const sourceWorker = worker;
  const ownsWorker = () => !closed && !failure && worker === sourceWorker;
  const pending = new Map<number, PendingRead>();
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A source may be created before its first consumer reads it.
  void ready.catch(() => undefined);
  let bootTimeout: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    if (bootTimeout !== undefined) clearTimeout(bootTimeout);
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = undefined;
  };
  const fail = (error: Error) => {
    if (closed || failure) return;
    failure = error;
    terminate();
    rejectReady(error);
    for (const request of [...pending.values()]) request.finish(error);
  };
  const activateFallback = () => {
    if (closed || initialized || fallback || failure) return;
    terminate();
    try {
      fallback = createPublicMarketsProvider(options);
      resolveReady();
    } catch (cause) {
      fail(asError(cause));
    }
  };
  worker.onmessage = (event: MessageEvent<PublicMarketWorkerResponse>) => {
    if (!ownsWorker()) return;
    const message = event.data;
    if (message?.type === 'ready') {
      initialized = true;
      if (bootTimeout !== undefined) clearTimeout(bootTimeout);
      resolveReady();
      return;
    }
    if (message?.type === 'error') {
      const error = new Error(message.message || 'Public market worker failed.');
      if (message.name) error.name = message.name;
      if (message.requestId === undefined) fail(error);
      else pending.get(message.requestId)?.finish(error);
      return;
    }
    if (message?.type === 'snapshot') {
      if (!message.snapshot || message.snapshot.version !== 1) {
        pending
          .get(message.requestId)
          ?.finish(new Error('Public market worker returned an invalid snapshot.'));
        return;
      }
      pending.get(message.requestId)?.finish(undefined, message.snapshot);
    }
  };
  worker.onerror = (event) => {
    if (!ownsWorker()) return;
    event.preventDefault();
    // Unsupported module workers/CSP failures have no cache yet: use the same native provider.
    // A running worker failure must remain visible, rather than silently discarding its cache.
    if (!initialized) activateFallback();
    else
      fail(
        new Error(
          event.message ||
            'Public market worker stopped. Disable and re-enable the connection to retry.',
        ),
      );
  };
  worker.onmessageerror = () => {
    if (ownsWorker()) fail(new Error('Could not read public market worker data.'));
  };
  bootTimeout = setTimeout(activateFallback, 10_000);
  try {
    worker.postMessage({ type: 'initialize', ...options } satisfies PublicMarketWorkerRequest);
  } catch {
    activateFallback();
  }

  async function waitUntilReady(signal?: AbortSignal) {
    if (signal?.aborted) throw abortError();
    if (!signal) {
      await ready;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const cancelled = () => {
        signal.removeEventListener('abort', cancelled);
        reject(abortError());
      };
      signal.addEventListener('abort', cancelled, { once: true });
      void ready.then(
        () => {
          signal.removeEventListener('abort', cancelled);
          resolve();
        },
        (error: Error) => {
          signal.removeEventListener('abort', cancelled);
          reject(error);
        },
      );
    });
  }
  return {
    async fetchSnapshot({ signal } = {}) {
      if (closed) throw abortError();
      if (failure) throw failure;
      await waitUntilReady(signal);
      if (closed || signal?.aborted) throw abortError();
      if (failure) throw failure;
      if (fallback) return fallback.fetchSnapshot({ signal });
      const active = worker;
      if (!active) throw new Error('Public market worker is unavailable.');
      const requestId = ++sequence;
      return new Promise<PublicMarketsSnapshot>((resolve, reject) => {
        let done = false;
        const finish = (error?: Error, snapshot?: PublicMarketsSnapshot) => {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          signal?.removeEventListener('abort', cancel);
          pending.delete(requestId);
          if (error) reject(error);
          else if (snapshot) resolve(snapshot);
          else reject(new Error('Public market worker returned no data.'));
        };
        const cancelWorker = () => {
          try {
            active.postMessage({ type: 'cancel', requestId } satisfies PublicMarketWorkerRequest);
          } catch {
            /* The caller still receives cancellation if the worker has already stopped. */
          }
        };
        const cancel = () => {
          cancelWorker();
          finish(abortError());
        };
        const timeout = setTimeout(() => {
          cancelWorker();
          finish(new Error('Public market worker request exceeded 30 seconds.'));
        }, 30_000);
        pending.set(requestId, { finish });
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) {
          cancel();
          return;
        }
        try {
          active.postMessage({ type: 'read', requestId } satisfies PublicMarketWorkerRequest);
        } catch (cause) {
          finish(asError(cause));
        }
      });
    },
    dispose() {
      if (closed) return;
      closed = true;
      try {
        worker?.postMessage({ type: 'dispose' } satisfies PublicMarketWorkerRequest);
      } catch {
        /* Termination below also aborts worker-owned network activity. */
      }
      terminate();
      fallback?.dispose();
      rejectReady(abortError());
      for (const request of [...pending.values()]) request.finish(abortError());
    },
  };
}
