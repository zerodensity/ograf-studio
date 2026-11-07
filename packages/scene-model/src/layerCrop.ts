import { intersectConvexPolygons, type GeometryPoint } from './clipping';
import type { CropRect, LayerCrop } from './types';

export function cropRectPoints(rect: CropRect): GeometryPoint[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

/** Intersects a layer crop with its full box and any animated wipe planes. */
export function layerCropPolygon(
  crop: LayerCrop,
  insets: readonly number[] = [0, 0, 0, 0],
): GeometryPoint[] {
  const [top = 0, right = 0, bottom = 0, left = 0] = insets;
  if (left + right >= 1 || top + bottom >= 1) return [];
  return intersectConvexPolygons(
    crop.points,
    cropRectPoints({ x: left, y: top, width: 1 - left - right, height: 1 - top - bottom }),
  );
}

export function layerCropErrors(crop: LayerCrop): string[] {
  if (
    !Array.isArray(crop?.points) ||
    crop.points.length !== 4 ||
    crop.points.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))
  )
    return ['layer crop requires four finite corners'];
  for (let index = 0; index < 4; index++) {
    const a = crop.points[index]!,
      b = crop.points[(index + 1) % 4]!,
      c = crop.points[(index + 2) % 4]!;
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0)
      return ['layer crop must be a non-empty convex rectangle with clockwise corners'];
  }
  return [];
}
