/** Abandon a browser operation whose API offers no AbortSignal, and observe its late result. */
export function awaitExportOperation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    const cleanUp = () => signal.removeEventListener('abort', abort);
    promise.then(
      (result) => {
        cleanUp();
        resolve(result);
      },
      (error: unknown) => {
        cleanUp();
        reject(error);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
