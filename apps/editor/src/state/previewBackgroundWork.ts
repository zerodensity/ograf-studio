import {
  isPreviewPresentationFullscreen,
  subscribePreviewPresentationFullscreen,
} from './previewPresentationStore';

/** PNG thumbnails are expensive browser renders and have no visible use behind fullscreen.
 * Retain the latest request until presentation ends rather than competing with its animation. */
export function schedulePreviewBackgroundWork(work: () => void, delayMs: number): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const sync = () => {
    clearTimer();
    if (cancelled || isPreviewPresentationFullscreen()) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (cancelled || isPreviewPresentationFullscreen()) return;
      cancelled = true;
      unsubscribe();
      work();
    }, delayMs);
  };
  const unsubscribe = subscribePreviewPresentationFullscreen(sync);
  sync();
  return () => {
    cancelled = true;
    clearTimer();
    unsubscribe();
  };
}
