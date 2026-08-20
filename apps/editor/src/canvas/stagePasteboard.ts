export interface StagePasteboardLayout {
  frameWidth: number;
  frameHeight: number;
  frameLeft: number;
  frameTop: number;
  measureWidth: number;
  measureHeight: number;
}

/**
 * Gives the editor canvas one complete composition-size work area on every side. This is editor
 * pasteboard only: the composition frame remains the broadcast/output boundary.
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
    frameLeft: frameWidth,
    frameTop: frameHeight,
    measureWidth: frameWidth * 3,
    measureHeight: frameHeight * 3,
  };
}

export function getCenteredStageScroll(
  layout: StagePasteboardLayout,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  const visibleMarginX = Math.max(0, (viewportWidth - layout.frameWidth) / 2);
  const visibleMarginY = Math.max(0, (viewportHeight - layout.frameHeight) / 2);

  return {
    left: Math.max(0, layout.frameLeft - visibleMarginX),
    top: Math.max(0, layout.frameTop - visibleMarginY),
  };
}
