import { describe, expect, it, vi } from 'vitest';
import {
  createFramePicturePool,
  inOrder,
  type FramePictureJob,
  type FramePictureResult,
  type FramePictureWorker,
} from './framePicturePool';

function picture(name: string) {
  return { name, close: vi.fn() } as unknown as ImageBitmap & { name: string; close: () => void };
}

/** A worker that answers only when the test tells it to. */
function standInWorkers() {
  const workers: (FramePictureWorker & {
    jobs: FramePictureJob[];
    answer(result: FramePictureResult): void;
    terminated: boolean;
  })[] = [];
  const start = () => {
    const worker = {
      onmessage: null as FramePictureWorker['onmessage'],
      onerror: null as FramePictureWorker['onerror'],
      jobs: [] as FramePictureJob[],
      terminated: false,
      postMessage(job: FramePictureJob) {
        worker.jobs.push(job);
      },
      terminate() {
        worker.terminated = true;
      },
      answer(result: FramePictureResult) {
        worker.onmessage?.({ data: result } as MessageEvent<FramePictureResult>);
      },
    };
    workers.push(worker);
    return worker;
  };
  return { workers, start };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createFramePicturePool', () => {
  it('gives each idle worker one picture and queues the rest', async () => {
    const { workers, start } = standInWorkers();
    const pool = createFramePicturePool(2, start);
    const files = [picture('a'), picture('b'), picture('c')].map((item) => pool.png(item));
    const sent = () => workers.flatMap((worker) => worker.jobs.map((job) => job.id));
    expect(sent()).toHaveLength(2);

    const busy = workers.find((worker) => worker.jobs[0]!.id === 0)!;
    const first = new Uint8Array([1]).buffer;
    busy.answer({ id: 0, kind: 'png', png: first });
    expect(await files[0]).toBe(first);
    // The worker that finished takes the queued picture.
    expect(busy.jobs).toHaveLength(2);
    expect(sent().toSorted()).toEqual([0, 1, 2]);
    pool.dispose();
  });

  it('hands back the colour and alpha frames of a WebM picture', async () => {
    const { workers, start } = standInWorkers();
    const pool = createFramePicturePool(1, start);
    const request = { timestamp: 40_000, duration: 20_000, width: 64, height: 36 };
    const planes = pool.planes(picture('a'), request);
    expect(workers[0]!.jobs[0]).toMatchObject({ id: 0, kind: 'planes', ...request });
    const colour = {} as VideoFrame;
    const alpha = {} as VideoFrame;
    workers[0]!.answer({ id: 0, kind: 'planes', colour, alpha });
    expect(await planes).toEqual({ colour, alpha });
    pool.dispose();
  });

  it('reports a picture a worker could not turn into a file, and keeps working', async () => {
    const { workers, start } = standInWorkers();
    const pool = createFramePicturePool(1, start);
    const failed = pool.png(picture('a'));
    const next = pool.png(picture('b'));
    workers[0]!.answer({ id: 0, kind: 'error', message: 'The picture is too large.' });
    await expect(failed).rejects.toThrow('The picture is too large.');
    const file = new Uint8Array([2]).buffer;
    workers[0]!.answer({ id: 1, kind: 'png', png: file });
    expect(await next).toBe(file);
    pool.dispose();
  });

  it('fails everything, and closes what was never sent, when a worker stops', async () => {
    const { workers, start } = standInWorkers();
    const pool = createFramePicturePool(1, start);
    const sent = pool.png(picture('a'));
    const queued = picture('b');
    const waiting = pool.png(queued);
    workers[0]!.onerror?.({ message: 'out of memory' } as ErrorEvent);
    await expect(sent).rejects.toThrow('A frame worker stopped: out of memory.');
    await expect(waiting).rejects.toThrow('A frame worker stopped');
    expect(queued.close).toHaveBeenCalledOnce();
    const late = picture('c');
    await expect(pool.png(late)).rejects.toThrow('A frame worker stopped');
    expect(late.close).toHaveBeenCalledOnce();
    pool.dispose();
  });

  it('stops its workers and closes queued pictures when disposed', () => {
    const { workers, start } = standInWorkers();
    const pool = createFramePicturePool(1, start);
    void pool.png(picture('a'));
    const queued = picture('b');
    void pool.png(queued);
    pool.dispose();
    expect(workers.every((worker) => worker.terminated)).toBe(true);
    expect(queued.close).toHaveBeenCalledOnce();
  });

  it('closes a picture that arrives after it was disposed, as a frame still rendering does', async () => {
    const { start } = standInWorkers();
    const pool = createFramePicturePool(1, start);
    pool.dispose();
    const late = picture('late');
    await expect(pool.png(late)).rejects.toThrow('The frame workers were stopped');
    expect(late.close).toHaveBeenCalledOnce();
  });
});

describe('inOrder', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('delivers results in the order the work was added, whatever order it finishes in', async () => {
    const delivered: [string, number][] = [];
    const queue = inOrder<string>(10, (result, index) => void delivered.push([result, index]));
    const first = deferred<string>();
    const second = deferred<string>();
    await queue.add(first.promise);
    await queue.add(second.promise);
    second.resolve('second');
    await settle();
    expect(delivered).toEqual([]);
    first.resolve('first');
    await queue.finish();
    expect(delivered).toEqual([
      ['first', 0],
      ['second', 1],
    ]);
  });

  it('holds the producer back once the limit of undelivered results is reached', async () => {
    const queue = inOrder<string>(2, () => {});
    const first = deferred<string>();
    await queue.add(first.promise);
    let room = false;
    const adding = queue.add(Promise.resolve('second')).then(() => {
      room = true;
    });
    await settle();
    expect(room).toBe(false);
    first.resolve('first');
    await adding;
    expect(room).toBe(true);
    await queue.finish();
  });

  it('reports the first failure and releases the results that can no longer be delivered', async () => {
    const delivered: string[] = [];
    const discarded: string[] = [];
    const queue = inOrder<string>(
      10,
      (result) => void delivered.push(result),
      (result) => void discarded.push(result),
    );
    const first = deferred<string>();
    await queue.add(first.promise);
    await queue.add(Promise.resolve('second'));
    first.reject(new Error('The first frame failed.'));
    await expect(queue.finish()).rejects.toThrow('The first frame failed.');
    expect(delivered).toEqual([]);
    expect(discarded).toEqual(['second']);
  });

  it('waits for a delivery that takes time before making the next', async () => {
    const order: string[] = [];
    const queue = inOrder<string>(10, async (result) => {
      order.push(`start ${result}`);
      await settle();
      order.push(`end ${result}`);
    });
    await queue.add(Promise.resolve('a'));
    await queue.add(Promise.resolve('b'));
    await queue.finish();
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});
