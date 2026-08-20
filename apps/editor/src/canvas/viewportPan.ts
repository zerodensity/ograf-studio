export interface ViewportPanOrigin {
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
}

/** Dragging the content right/down moves the viewport toward its left/top scroll boundaries. */
export function viewportScrollForPointer(
  origin: ViewportPanOrigin,
  clientX: number,
  clientY: number,
): { left: number; top: number } {
  return {
    left: origin.scrollLeft - (clientX - origin.clientX),
    top: origin.scrollTop - (clientY - origin.clientY),
  };
}
