/**
 * Turns the pictures of a movie's frames into what its file stores, on worker threads. Reading a
 * picture's pixels back and compressing them is as much work as drawing the frame, so doing it
 * beside the page instead of on it lets the page go straight on to the next frame.
 */

/** When a WebM frame is shown, and the even-sided size its encoders take. */
export interface FramePlanesRequest {
  timestamp: number;
  duration: number;
  width: number;
  height: number;
}

/** A frame as WebM stores transparency: its colours, and its alpha as a second picture's brightness. */
export interface FramePlanes {
  colour: VideoFrame;
  alpha: VideoFrame;
}

export type FramePictureJob =
  | { id: number; kind: 'png'; picture: ImageBitmap }
  | ({ id: number; kind: 'planes'; picture: ImageBitmap } & FramePlanesRequest);

export type FramePictureResult =
  | { id: number; kind: 'png'; png: ArrayBuffer }
  | ({ id: number; kind: 'planes' } & FramePlanes)
  | { id: number; kind: 'error'; message: string };

/** The part of a Worker the pool uses, so a test can stand in for one. */
export interface FramePictureWorker {
  onmessage: ((event: MessageEvent<FramePictureResult>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(job: FramePictureJob, transfer: Transferable[]): void;
  terminate(): void;
}

export interface FramePicturePool {
  /** How many pictures are worked on at once. */
  readonly size: number;
  /** The picture as a PNG file. The pool takes the picture over. */
  png(picture: ImageBitmap): Promise<ArrayBuffer>;
  /** The picture as WebM's colour and alpha frames. The pool takes the picture over. */
  planes(picture: ImageBitmap, request: FramePlanesRequest): Promise<FramePlanes>;
  /** Stops the workers. Work not yet handed back is dropped and its promises never settle. */
  dispose(): void;
}

/** Leaves the page a core of its own; past four workers the page cannot draw frames fast enough. */
function defaultPoolSize(): number {
  return Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
}

function startWorker(): FramePictureWorker {
  return new Worker(new URL('./framePicture.worker.ts', import.meta.url), { type: 'module' });
}

type Unsent =
  | Omit<Extract<FramePictureJob, { kind: 'png' }>, 'id'>
  | Omit<Extract<FramePictureJob, { kind: 'planes' }>, 'id'>;

export function createFramePicturePool(
  size = defaultPoolSize(),
  start: () => FramePictureWorker = startWorker,
): FramePicturePool {
  interface Waiting {
    job: Unsent;
    resolve(result: FramePictureResult): void;
    reject(error: Error): void;
  }
  const queue: Waiting[] = [];
  const idle: FramePictureWorker[] = [];
  const working = new Map<number, Waiting>();
  let nextId = 0;
  let failure: Error | null = null;

  const fail = (error: Error) => {
    failure ??= error;
    for (const waiting of working.values()) waiting.reject(failure);
    working.clear();
    for (const waiting of queue.splice(0)) {
      waiting.job.picture.close();
      waiting.reject(failure);
    }
  };
  const dispatch = () => {
    while (idle.length && queue.length) {
      const worker = idle.pop()!;
      const waiting = queue.shift()!;
      const id = nextId++;
      working.set(id, waiting);
      worker.onmessage = ({ data }) => {
        const done = working.get(data.id);
        working.delete(data.id);
        idle.push(worker);
        if (data.kind === 'error') done?.reject(new Error(data.message));
        else done?.resolve(data);
        dispatch();
      };
      worker.postMessage({ ...waiting.job, id } as FramePictureJob, [waiting.job.picture]);
    }
  };
  const workers = Array.from({ length: size }, () => {
    const worker = start();
    // A worker that cannot start or dies takes the whole export with it: its frame is lost.
    worker.onerror = (event) =>
      fail(new Error(`A frame worker stopped: ${event.message || 'it could not be started'}.`));
    idle.push(worker);
    return worker;
  });
  const run = (job: Unsent) =>
    new Promise<FramePictureResult>((resolve, reject) => {
      if (failure) {
        job.picture.close();
        reject(failure);
        return;
      }
      queue.push({ job, resolve, reject });
      dispatch();
    });

  return {
    size,
    async png(picture) {
      const result = await run({ kind: 'png', picture });
      if (result.kind !== 'png') throw new Error('A frame worker answered with the wrong result.');
      return result.png;
    },
    async planes(picture, request) {
      const result = await run({ kind: 'planes', picture, ...request });
      if (result.kind !== 'planes')
        throw new Error('A frame worker answered with the wrong result.');
      return { colour: result.colour, alpha: result.alpha };
    },
    dispose() {
      for (const worker of workers) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
      for (const { job } of queue.splice(0)) job.picture.close();
      working.clear();
      idle.length = 0;
    },
  };
}

/**
 * Lets work run side by side while its results are handed on strictly in the order it was added,
 * and holds the producer back once `limit` results are waiting, so pictures never pile up.
 */
export function inOrder<T>(
  limit: number,
  deliver: (result: T, index: number) => void | Promise<void>,
  /** Releases a result that will never be delivered because earlier work failed. */
  discard: (result: T) => void = () => {},
) {
  const waiting: Promise<void>[] = [];
  let last: Promise<void> = Promise.resolve();
  let added = 0;
  return {
    /** Resolves once there is room for more; rejects with the first failure of the work so far. */
    async add(work: Promise<T>): Promise<void> {
      const index = added++;
      const previous = last;
      const delivered = (async () => {
        const result = await work;
        try {
          await previous;
        } catch (error) {
          discard(result);
          throw error;
        }
        await deliver(result, index);
      })();
      // The failure is reported where `add` or `finish` waits for this entry.
      delivered.catch(() => {});
      last = delivered;
      waiting.push(delivered);
      if (waiting.length >= limit) await waiting.shift();
    },
    /** Resolves when everything added has been delivered. */
    async finish(): Promise<void> {
      while (waiting.length) await waiting.shift();
    },
  };
}
