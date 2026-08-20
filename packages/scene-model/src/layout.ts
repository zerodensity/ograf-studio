import type { LayerConstraints, LayerTransform } from './types';

/** Applies authoring-time responsive constraints; callers bake the result into canonical tracks. */
export function resizeConstrainedTransform(
  pose: LayerTransform,
  constraints: LayerConstraints,
  oldSize: { width: number; height: number },
  newSize: { width: number; height: number },
): LayerTransform {
  const next = { ...pose };
  const deltaWidth = newSize.width - oldSize.width;
  const deltaHeight = newSize.height - oldSize.height;
  const scaleX = newSize.width / oldSize.width;
  const scaleY = newSize.height / oldSize.height;
  switch (constraints.horizontal) {
    case 'right':
      next.x += deltaWidth;
      break;
    case 'left-right':
      next.width += deltaWidth;
      break;
    case 'center':
      next.x += deltaWidth / 2;
      break;
    case 'scale':
      next.x *= scaleX;
      next.width *= scaleX;
      break;
  }
  switch (constraints.vertical) {
    case 'bottom':
      next.y += deltaHeight;
      break;
    case 'top-bottom':
      next.height += deltaHeight;
      break;
    case 'center':
      next.y += deltaHeight / 2;
      break;
    case 'scale':
      next.y *= scaleY;
      next.height *= scaleY;
      break;
  }
  return {
    ...next,
    x: Math.round(next.x),
    y: Math.round(next.y),
    width: Math.max(1, Math.round(next.width)),
    height: Math.max(1, Math.round(next.height)),
  };
}
