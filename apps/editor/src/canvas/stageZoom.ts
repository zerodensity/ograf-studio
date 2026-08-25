export const MIN_STAGE_ZOOM = 0.05;
export const MAX_STAGE_ZOOM = 4;
const STAGE_ZOOM_FACTOR = 1.12;

export interface StageZoomAnchor {
  logicalX: number;
  logicalY: number;
  viewportX: number;
  viewportY: number;
}

export function nextStageZoom(current: number, direction: 'in' | 'out'): number {
  const factor = direction === 'in' ? STAGE_ZOOM_FACTOR : 1 / STAGE_ZOOM_FACTOR;
  return Math.min(MAX_STAGE_ZOOM, Math.max(MIN_STAGE_ZOOM, current * factor));
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
