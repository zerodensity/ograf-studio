export type DragAxis = 'x' | 'y';

/** Chooses the first dominant pointer direction for Photoshop-style Shift dragging. */
export function dominantDragAxis(delta: readonly number[]): DragAxis | null {
  const x = delta[0] ?? 0;
  const y = delta[1] ?? 0;
  if (x === 0 && y === 0) return null;
  return Math.abs(x) >= Math.abs(y) ? 'x' : 'y';
}

export function constrainedTranslation(
  anchor: { x: number; y: number },
  axis: DragAxis,
  distance: number,
): { x: number; y: number } {
  return axis === 'x'
    ? { x: anchor.x + distance, y: anchor.y }
    : { x: anchor.x, y: anchor.y + distance };
}
