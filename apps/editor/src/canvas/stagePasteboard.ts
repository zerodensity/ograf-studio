export interface StagePasteboardLayout {
  frameWidth: number;
  frameHeight: number;
  frameLeft: number;
  frameTop: number;
  measureWidth: number;
  measureHeight: number;
}

export interface StageCameraOrigin {
  x: number;
  y: number;
}

export const INFINITE_STAGE_MEASURE_PX = 200_000;

/**
 * Hosts the composition in a large recentering scroll plane. The camera origin is shifted whenever
 * scrolling is recentered, so the user-facing workspace has no reachable boundary.
 */
export function getStagePasteboardLayout(
  compositionWidth: number,
  compositionHeight: number,
  zoom: number,
): StagePasteboardLayout {
  const frameWidth = compositionWidth * zoom;
  const frameHeight = compositionHeight * zoom;

  return {
    frameWidth,
    frameHeight,
    frameLeft: (INFINITE_STAGE_MEASURE_PX - frameWidth) / 2,
    frameTop: (INFINITE_STAGE_MEASURE_PX - frameHeight) / 2,
    measureWidth: INFINITE_STAGE_MEASURE_PX,
    measureHeight: INFINITE_STAGE_MEASURE_PX,
  };
}

export function getCenteredStageScroll(
  layout: StagePasteboardLayout,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  return {
    left: Math.max(0, (layout.measureWidth - viewportWidth) / 2),
    top: Math.max(0, (layout.measureHeight - viewportHeight) / 2),
  };
}

/** Recenters browser scroll coordinates while preserving the exact visible camera position. */
export function recenterStageCamera(
  layout: StagePasteboardLayout,
  viewportWidth: number,
  viewportHeight: number,
  scroll: { left: number; top: number },
  origin: StageCameraOrigin,
): { scroll: { left: number; top: number }; origin: StageCameraOrigin } {
  const centered = getCenteredStageScroll(layout, viewportWidth, viewportHeight);
  return {
    scroll: centered,
    origin: {
      x: origin.x + centered.left - scroll.left,
      y: origin.y + centered.top - scroll.top,
    },
  };
}
