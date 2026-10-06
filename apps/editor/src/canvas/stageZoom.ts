export const MIN_STAGE_ZOOM = 0.05;
export const MAX_STAGE_ZOOM = 4;
const STAGE_ZOOM_FACTOR = 1.12;

export interface StageZoomAnchor {
  logicalX: number;
  logicalY: number;
  viewportX: number;
  viewportY: number;
}

/** Fixed levels offered next to Fit in the viewport footer. */
export const STAGE_ZOOM_PRESETS = [0.25, 0.5, 1, 2] as const;

export function clampStageZoom(zoom: number): number {
  return Math.min(MAX_STAGE_ZOOM, Math.max(MIN_STAGE_ZOOM, zoom));
}

export function nextStageZoom(current: number, direction: 'in' | 'out'): number {
  const factor = direction === 'in' ? STAGE_ZOOM_FACTOR : 1 / STAGE_ZOOM_FACTOR;
  return clampStageZoom(current * factor);
}

export type StageViewShortcut = 'fit' | 'actual-size';

/** Shift+1 fits the frame, Shift+0 shows it at 100%. Uses the physical key, so layouts that
 * type a symbol for Shift+digit still work. */
export function stageViewShortcut(event: {
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): StageViewShortcut | null {
  if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.code === 'Digit1') return 'fit';
  if (event.code === 'Digit0') return 'actual-size';
  return null;
}

export function stageZoomDirectionForWheel(deltaY: number): 'in' | 'out' | null {
  if (!Number.isFinite(deltaY) || deltaY === 0) return null;
  return deltaY < 0 ? 'in' : 'out';
}

export function captureStageZoomAnchor(
  currentZoom: number,
  scrollLeft: number,
  scrollTop: number,
  viewportX: number,
  viewportY: number,
  originX = 0,
  originY = 0,
): StageZoomAnchor {
  return {
    logicalX: (scrollLeft + viewportX - originX) / currentZoom,
    logicalY: (scrollTop + viewportY - originY) / currentZoom,
    viewportX,
    viewportY,
  };
}

export function scrollForStageZoom(
  anchor: StageZoomAnchor,
  nextZoom: number,
  originX = 0,
  originY = 0,
) {
  return {
    left: Math.max(0, originX + anchor.logicalX * nextZoom - anchor.viewportX),
    top: Math.max(0, originY + anchor.logicalY * nextZoom - anchor.viewportY),
  };
}
