import type { LayerTransform } from './types';

export const PIXEL_TRANSFORM_KEYS = ['x', 'y', 'width', 'height'] as const;
export type PixelTransformKey = (typeof PIXEL_TRANSFORM_KEYS)[number];

export function isPixelTransformKey(key: keyof LayerTransform): key is PixelTransformKey {
  return (PIXEL_TRANSFORM_KEYS as readonly (keyof LayerTransform)[]).includes(key);
}

function authoredPixelValue(key: PixelTransformKey, value: number): number {
  const rounded = Math.round(value);
  return key === 'width' || key === 'height' ? Math.max(1, rounded) : rounded;
}

/** Integer pixel geometry belongs to authored keys; rotation, alpha, and origins retain decimals. */
export function normalizeAuthoredTransform(transform: LayerTransform): LayerTransform {
  return {
    ...transform,
    x: authoredPixelValue('x', transform.x),
    y: authoredPixelValue('y', transform.y),
    width: authoredPixelValue('width', transform.width),
    height: authoredPixelValue('height', transform.height),
  };
}

export function normalizeAuthoredTransformPatch(
  patch: Partial<LayerTransform>,
): Partial<LayerTransform> {
  const normalized = { ...patch };
  for (const key of PIXEL_TRANSFORM_KEYS) {
    const value = patch[key];
    if (value !== undefined) normalized[key] = authoredPixelValue(key, value);
  }
  return normalized;
}
