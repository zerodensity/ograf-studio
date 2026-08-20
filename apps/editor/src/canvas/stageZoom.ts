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

export function captureStageZoomAnchor(
  currentZoom: number,
  scrollLeft: number,
  scrollTop: number,
  viewportX: number,
  viewportY: number,
): StageZoomAnchor {
  return {
    logicalX: (scrollLeft + viewportX) / currentZoom,
    logicalY: (scrollTop + viewportY) / currentZoom,
    viewportX,
    viewportY,
  };
}

export function scrollForStageZoom(anchor: StageZoomAnchor, nextZoom: number) {
  return {
    left: Math.max(0, anchor.logicalX * nextZoom - anchor.viewportX),
    top: Math.max(0, anchor.logicalY * nextZoom - anchor.viewportY),
  };
}
