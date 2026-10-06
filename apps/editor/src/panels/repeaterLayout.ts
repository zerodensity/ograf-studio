export type RepeatDirection = 'horizontal' | 'vertical';

export interface RepeatBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_REPEAT_COUNT = 2;
export const MAX_REPEAT_COUNT = 20;

export function clampRepeatCount(count: number): number {
  if (!Number.isFinite(count)) return MIN_REPEAT_COUNT;
  return Math.min(MAX_REPEAT_COUNT, Math.max(MIN_REPEAT_COUNT, Math.round(count)));
}

/**
 * Where copies 2…count land, mirroring materializeRepeater: each one moves a
 * selection-width (or height) plus the gap further along. Negative gaps count as 0.
 */
export function repeaterCopyRects(
  bounds: RepeatBounds,
  count: number,
  direction: RepeatDirection,
  gap: number,
): Array<RepeatBounds & { index: number }> {
  const stride = (direction === 'horizontal' ? bounds.width : bounds.height) + Math.max(0, gap);
  return Array.from({ length: Math.max(0, count - 1) }, (_, offset) => {
    const step = stride * (offset + 1);
    return {
      index: offset + 2,
      x: bounds.x + (direction === 'horizontal' ? step : 0),
      y: bounds.y + (direction === 'vertical' ? step : 0),
      width: bounds.width,
      height: bounds.height,
    };
  });
}
