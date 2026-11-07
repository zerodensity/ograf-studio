import { schedulePreviewBackgroundWork } from './previewBackgroundWork';

interface ThumbnailJob<T> {
  key: object;
  users: number;
  render: () => Promise<T>;
  result: Promise<T | undefined>;
  resolve: (value: T | undefined) => void;
  reject: (error: unknown) => void;
  settled: boolean;
  running: boolean;
  cancelled: boolean;
  cancelWait?: () => void;
}

interface ThumbnailLease<T> {
  result: Promise<T | undefined>;
  release: () => void;
}

/** Each mounted thumbnail owns its URL; sharing the Blob never lets one view revoke another. */
export function observePreviewThumbnailUrl(
  lease: ThumbnailLease<Blob>,
  publish: (url: string) => void,
): () => void {
  let live = true;
  let url: string | undefined;
  void lease.result.then(
    (blob) => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      publish(url);
    },
    () => undefined,
  );
  return () => {
    if (!live) return;
    live = false;
    lease.release();
    if (url) URL.revokeObjectURL(url);
  };
}

/** Serialize background thumbnails, share completed revisions, and yield between jobs in fullscreen.
 * A consumer releases its lease when its template revision changes or its pane unmounts. */
export function createPreviewThumbnailQueue<T>() {
  const cache = new WeakMap<object, ThumbnailJob<T>>();
  const pending: ThumbnailJob<T>[] = [];
  let current: ThumbnailJob<T> | undefined;
  const advance = () => {
    if (current) return;
    const job = pending.shift();
    if (!job) return;
    current = job;
    job.cancelWait = schedulePreviewBackgroundWork(() => {
      job.cancelWait = undefined;
      job.running = true;
      void Promise.resolve()
        .then(job.render)
        .then(
          (value) => {
            job.settled = true;
            job.resolve(job.cancelled ? undefined : value);
          },
          (error: unknown) => {
            job.settled = true;
            if (cache.get(job.key) === job) cache.delete(job.key);
            job.reject(error);
          },
        )
        .finally(() => {
          current = undefined;
          advance();
        });
    }, 0);
  };
  return {
    acquire(key: object, render: () => Promise<T>): ThumbnailLease<T> {
      let job = cache.get(key);
      if (!job) {
        let resolve!: ThumbnailJob<T>['resolve'];
        let reject!: ThumbnailJob<T>['reject'];
        const result = new Promise<T | undefined>((yes, no) => {
          resolve = yes;
          reject = no;
        });
        job = {
          key,
          users: 0,
          render,
          result,
          resolve,
          reject,
          settled: false,
          running: false,
          cancelled: false,
        };
        cache.set(key, job);
        pending.push(job);
      }
      job.users++;
      advance();
      const lease = job;
      let released = false;
      return {
        result: lease.result,
        release() {
          if (released) return;
          released = true;
          if (--lease.users || lease.settled) return;
          lease.cancelled = true;
          if (cache.get(key) === lease) cache.delete(key);
          // A running browser capture cannot be interrupted; discard its result when it settles.
          if (lease.running) return;
          lease.cancelWait?.();
          const index = pending.indexOf(lease);
          if (index >= 0) pending.splice(index, 1);
          lease.settled = true;
          lease.resolve(undefined);
          if (current === lease) current = undefined;
          advance();
        },
      };
    },
  };
}
