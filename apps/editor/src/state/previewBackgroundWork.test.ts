import { afterEach, describe, expect, it, vi } from 'vitest';
import { schedulePreviewBackgroundWork } from './previewBackgroundWork';
import { registerPreviewPresentation } from './previewPresentationStore';

function preview() {
  const owner = Object.assign(new EventTarget(), { fullscreenElement: null as unknown });
  const viewport = { isConnected: true, ownerDocument: owner } as unknown as HTMLElement;
  const unregister = registerPreviewPresentation({ viewport, enter: async () => undefined });
  const fullscreen = (active: boolean) => {
    owner.fullscreenElement = active ? viewport : null;
    owner.dispatchEvent(new Event('fullscreenchange'));
  };
  return { fullscreen, unregister, owner, viewport };
}

afterEach(() => vi.useRealTimers());

describe('preview background rendering', () => {
  it('keeps the normal thumbnail debounce outside fullscreen', () => {
    vi.useFakeTimers();
    const work = vi.fn();
    const cancel = schedulePreviewBackgroundWork(work, 300);
    vi.advanceTimersByTime(299);
    expect(work).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(work).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('suspends queued thumbnail renders throughout fullscreen and resumes after exit', () => {
    vi.useFakeTimers();
    const surface = preview();
    const work = vi.fn();
    const cancel = schedulePreviewBackgroundWork(work, 300);
    vi.advanceTimersByTime(100);
    surface.fullscreen(true);
    vi.advanceTimersByTime(10_000);
    expect(work).not.toHaveBeenCalled();
    surface.fullscreen(false);
    vi.advanceTimersByTime(300);
    expect(work).toHaveBeenCalledTimes(1);
    surface.fullscreen(true);
    surface.fullscreen(false);
    vi.advanceTimersByTime(300);
    expect(work).toHaveBeenCalledTimes(1);
    cancel();
    surface.unregister();
  });

  it('discards superseded requests and captures only the latest template after fullscreen', () => {
    vi.useFakeTimers();
    const surface = preview();
    surface.fullscreen(true);
    const old = vi.fn();
    const latest = vi.fn();
    const cancelOld = schedulePreviewBackgroundWork(old, 0);
    cancelOld();
    const cancelLatest = schedulePreviewBackgroundWork(latest, 0);
    vi.advanceTimersByTime(10_000);
    expect(latest).not.toHaveBeenCalled();
    surface.fullscreen(false);
    vi.runAllTimers();
    expect(old).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    cancelLatest();
    surface.unregister();
  });

  it('resumes if a fullscreen preview closes, including a detached preview document', () => {
    vi.useFakeTimers();
    const surface = preview();
    surface.fullscreen(true);
    const work = vi.fn();
    const cancel = schedulePreviewBackgroundWork(work, 0);
    surface.unregister();
    vi.runAllTimers();
    expect(work).toHaveBeenCalledTimes(1);
    cancel();
  });
});
