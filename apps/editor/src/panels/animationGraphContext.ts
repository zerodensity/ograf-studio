import type { AnimationGraphBounds, GraphPoint, GraphScreenInverse } from './animationGraph';

/** Invert the timeline graph's zero-padding coordinates using the SVG screen transform. */
export function graphInsertionAtPoint(
  pointer: GraphPoint,
  inverse: GraphScreenInverse,
  bounds: AnimationGraphBounds,
  width: number,
  height: number,
  durationFrames: number,
): { frame: number; value: number } | null {
  const { a, b, c, d, e, f } = inverse;
  if (
    ![
      pointer.x,
      pointer.y,
      a,
      b,
      c,
      d,
      e,
      f,
      bounds.minFrame,
      bounds.maxFrame,
      bounds.minValue,
      bounds.maxValue,
      width,
      height,
      durationFrames,
    ].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    durationFrames < 0
  )
    return null;
  const frameSpan = bounds.maxFrame - bounds.minFrame;
  const valueSpan = bounds.maxValue - bounds.minValue;
  const determinant = a * d - b * c;
  const localX = a * pointer.x + c * pointer.y + e;
  const localY = b * pointer.x + d * pointer.y + f;
  if (
    ![frameSpan, valueSpan, determinant, localX, localY].every(Number.isFinite) ||
    frameSpan <= 0 ||
    valueSpan <= 0 ||
    determinant === 0
  )
    return null;
  const x = Math.max(0, Math.min(width, localX));
  const y = Math.max(0, Math.min(height, localY));
  return {
    frame: Math.max(
      0,
      Math.min(Math.floor(durationFrames), Math.round(bounds.minFrame + (x / width) * frameSpan)),
    ),
    value: Math.max(
      bounds.minValue,
      Math.min(bounds.maxValue, bounds.maxValue - (y / height) * valueSpan),
    ),
  };
}

/** Resolve a nearby visible key first, then an unambiguous visible selection. Coordinates are CSS pixels. */
export function graphKeyForContextMenu(
  points: readonly { id: string; x: number; y: number }[],
  selectedIds: readonly string[],
  pointer: { x: number; y: number },
): string | null {
  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null;
  const selected = new Set(selectedIds);
  const eligibleSelection = new Set<string>();
  let nearest: { id: string; distance: number; selected: boolean } | null = null;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const isSelected = selected.has(point.id);
    if (isSelected) eligibleSelection.add(point.id);
    const distance = (point.x - pointer.x) ** 2 + (point.y - pointer.y) ** 2;
    if (distance > 18 ** 2) continue;
    if (
      !nearest ||
      distance < nearest.distance ||
      (distance === nearest.distance && isSelected && !nearest.selected)
    )
      nearest = { id: point.id, distance, selected: isSelected };
  }
  if (nearest) return nearest.id;
  return eligibleSelection.size === 1 ? eligibleSelection.values().next().value! : null;
}
