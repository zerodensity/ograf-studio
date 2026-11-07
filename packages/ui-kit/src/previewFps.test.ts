import { describe, expect, it, vi } from 'vitest';
import { createPreviewFpsMonitor, type PreviewFpsSample } from './previewFps.js';

function fixture(intersection = false) {
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const listeners = new Map<string, () => void>();
  let observe!: IntersectionObserverCallback;
  const disconnected = vi.fn();
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const owner = {
    document: doc,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    },
    cancelAnimationFrame: (request: number) => frames.delete(request),
    ...(intersection
      ? {
          IntersectionObserver: class {
            constructor(callback: IntersectionObserverCallback) {
              observe = callback;
            }
            observe() {}
            disconnect = disconnected;
          },
        }
      : {}),
  };
  const target = { ownerDocument: doc, isConnected: true } as unknown as HTMLElement;
  const samples: PreviewFpsSample[] = [];
  const monitor = createPreviewFpsMonitor({
    target,
    ownerWindow: owner as unknown as Window,
    renderSampling: true,
    onSample: (sample) => samples.push(sample),
  });
  return {
    monitor,
    samples,
    frames,
    listeners,
    disconnected,
    frame(time: number) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(time);
    },
    visible(visible: boolean) {
      doc.visibilityState = visible ? 'visible' : 'hidden';
      listeners.get('visibilitychange')?.();
    },
    intersect(visible: boolean) {
      observe(
        [
          { target, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 },
        ] as unknown as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    },
  };
}

describe('preview FPS diagnostics', () => {
  it('reports measured RAF cadence and independent successful render samples', () => {
    const f = fixture();
    f.frame(0);
    for (let time = 20; time <= 500; time += 20) {
      if (time % 100 === 0) f.monitor.recordRender();
      f.frame(time);
    }
    expect(f.samples).toEqual([
      { fps: null, renderFps: null },
      { fps: null, renderFps: null },
      { fps: 50, renderFps: 10 },
    ]);
    f.monitor.dispose();
  });

  it('includes long visible stalls instead of disguising them as target FPS', () => {
    const f = fixture();
    f.frame(0);
    f.frame(2000);
    expect(f.samples.at(-1)).toEqual({ fps: 0.5, renderFps: 0 });
    f.monitor.dispose();
  });

  it('cancels hidden sampling and resumes with a fresh timing window', () => {
    const f = fixture();
    f.frame(0);
    f.frame(250);
    f.visible(false);
    expect(f.frames.size).toBe(0);
    expect(f.samples.at(-1)).toEqual({ fps: null, renderFps: null });
    f.monitor.recordRender();
    f.visible(true);
    f.frame(10000);
    f.frame(10500);
    expect(f.samples.at(-1)).toEqual({ fps: 2, renderFps: 0 });
    f.monitor.dispose();
  });

  it('does no offscreen work and releases its owner-window observer and listener', () => {
    const f = fixture(true);
    expect(f.frames.size).toBe(0);
    f.intersect(true);
    expect(f.frames.size).toBe(1);
    f.frame(0);
    f.intersect(false);
    expect(f.frames.size).toBe(0);
    f.intersect(true);
    const stale = [...f.frames.values()][0]!;
    f.monitor.dispose();
    f.monitor.dispose();
    stale(500);
    f.intersect(true);
    expect(f.frames.size).toBe(0);
    expect(f.disconnected).toHaveBeenCalledOnce();
    expect(f.listeners.size).toBe(0);
  });

  it('ignores canceled callbacks after visibility resumes instead of creating a second RAF chain', () => {
    const f = fixture();
    const stale = [...f.frames.values()][0]!;
    f.visible(false);
    f.visible(true);
    const resumed = [...f.frames.values()][0]!;
    stale(1000);
    expect([...f.frames.values()]).toEqual([resumed]);
    expect(f.samples.at(-1)).toEqual({ fps: null, renderFps: null });
    f.frame(2000);
    expect(f.frames.size).toBe(1);
    f.monitor.dispose();
    expect(f.frames.size).toBe(0);
  });

  it('does not expose render FPS when the host has not enabled rendered sampling', () => {
    const frames: FrameRequestCallback[] = [];
    const onSample = vi.fn();
    const target = {
      ownerDocument: {},
      isConnected: true,
    } as unknown as HTMLElement;
    const monitor = createPreviewFpsMonitor({
      target,
      ownerWindow: {
        requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
        cancelAnimationFrame() {},
      } as unknown as Window,
      onSample,
    });
    frames.shift()!(0);
    monitor.recordRender();
    frames.shift()!(500);
    expect(onSample).toHaveBeenLastCalledWith({ fps: 2, renderFps: null });
    monitor.dispose();
  });
});
