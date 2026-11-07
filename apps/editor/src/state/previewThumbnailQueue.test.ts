import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewThumbnailQueue, observePreviewThumbnailUrl } from './previewThumbnailQueue';
import { registerPreviewPresentation } from './previewPresentationStore';

function surface() {
  const owner = Object.assign(new EventTarget(), { fullscreenElement: null as unknown });
  const viewport = { isConnected: true, ownerDocument: owner } as unknown as HTMLElement;
  const unregister = registerPreviewPresentation({ viewport, enter: async () => undefined });
  return {
    unregister,
    fullscreen(active: boolean) {
      owner.fullscreenElement = active ? viewport : null;
      owner.dispatchEvent(new Event('fullscreenchange'));
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => (resolve = yes));
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Transitions background thumbnail queue', () => {
  it('shares a template revision and caches its completed capture', async () => {
    vi.useFakeTimers();
    const queue = createPreviewThumbnailQueue<string>();
    const key = {};
    const render = vi.fn(async () => 'thumbnail');
    const a = queue.acquire(key, render);
    const b = queue.acquire(key, render);
    await vi.runAllTimersAsync();
    expect(await a.result).toBe('thumbnail');
    expect(await b.result).toBe('thumbnail');
    a.release();
    b.release();
    const c = queue.acquire(key, render);
    expect(await c.result).toBe('thumbnail');
    expect(render).toHaveBeenCalledTimes(1);
    c.release();
  });

  it('does not start a queued capture in fullscreen and drops released old revisions', async () => {
    vi.useFakeTimers();
    const view = surface();
    view.fullscreen(true);
    const queue = createPreviewThumbnailQueue<string>();
    const oldRender = vi.fn(async () => 'old');
    const latestRender = vi.fn(async () => 'latest');
    const old = queue.acquire({}, oldRender);
    const latest = queue.acquire({}, latestRender);
    old.release();
    await vi.runAllTimersAsync();
    expect(await old.result).toBeUndefined();
    expect(oldRender).not.toHaveBeenCalled();
    expect(latestRender).not.toHaveBeenCalled();
    view.fullscreen(false);
    await vi.runAllTimersAsync();
    expect(await latest.result).toBe('latest');
    expect(latestRender).toHaveBeenCalledTimes(1);
    latest.release();
    view.unregister();
  });

  it('rechecks fullscreen between sequential captures and discards stale in-flight output', async () => {
    vi.useFakeTimers();
    const view = surface();
    const queue = createPreviewThumbnailQueue<string>();
    const firstResult = deferred<string>();
    const firstRender = vi.fn(() => firstResult.promise);
    const secondRender = vi.fn(async () => 'second');
    const first = queue.acquire({}, firstRender);
    const second = queue.acquire({}, secondRender);
    await vi.runAllTimersAsync();
    expect(firstRender).toHaveBeenCalledTimes(1);
    expect(secondRender).not.toHaveBeenCalled();
    view.fullscreen(true);
    first.release();
    firstResult.resolve('stale');
    await vi.runAllTimersAsync();
    expect(await first.result).toBeUndefined();
    expect(secondRender).not.toHaveBeenCalled();
    view.fullscreen(false);
    await vi.runAllTimersAsync();
    expect(await second.result).toBe('second');
    second.release();
    view.unregister();
  });

  it('keeps shared pending work while another consumer still uses it', async () => {
    vi.useFakeTimers();
    const queue = createPreviewThumbnailQueue<string>();
    const key = {};
    const render = vi.fn(async () => 'shared');
    const a = queue.acquire(key, render);
    const b = queue.acquire(key, render);
    a.release();
    a.release();
    await vi.runAllTimersAsync();
    expect(await b.result).toBe('shared');
    expect(render).toHaveBeenCalledTimes(1);
    b.release();
  });

  it('continues after capture failure and permits retrying the failed revision', async () => {
    vi.useFakeTimers();
    const queue = createPreviewThumbnailQueue<string>();
    const key = {};
    const failed = queue.acquire(key, async () => {
      throw new Error('decode');
    });
    const rejected = expect(failed.result).rejects.toThrow('decode');
    const next = queue.acquire({}, async () => 'next');
    await vi.runAllTimersAsync();
    await rejected;
    expect(await next.result).toBe('next');
    const retry = queue.acquire(key, async () => 'retry');
    await vi.runAllTimersAsync();
    expect(await retry.result).toBe('retry');
    failed.release();
    next.release();
    retry.release();
  });

  it('gives shared captures independent URLs and revokes each mounted view exactly once', async () => {
    vi.useFakeTimers();
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const queue = createPreviewThumbnailQueue<Blob>();
    const key = {};
    const render = vi.fn(async () => new Blob(['png']));
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = observePreviewThumbnailUrl(queue.acquire(key, render), first);
    const releaseSecond = observePreviewThumbnailUrl(queue.acquire(key, render), second);
    await vi.runAllTimersAsync();
    expect(render).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledWith('blob:first');
    expect(second).toHaveBeenCalledWith('blob:second');
    releaseFirst();
    releaseFirst();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:first');
    releaseSecond();
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenLastCalledWith('blob:second');
  });

  it('never creates or publishes a URL for an unmounted in-flight capture', async () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stale');
    const queue = createPreviewThumbnailQueue<Blob>();
    const capture = deferred<Blob>();
    const publish = vi.fn();
    const release = observePreviewThumbnailUrl(
      queue.acquire({}, () => capture.promise),
      publish,
    );
    await vi.runAllTimersAsync();
    release();
    capture.resolve(new Blob(['png']));
    await vi.runAllTimersAsync();
    expect(create).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
