import type { Composition, CropRect, MediaPaintFit, SourceCrop } from './types';

export const FULL_SOURCE_CROP: Readonly<CropRect> = { x: 0, y: 0, width: 1, height: 1 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function normalizeCropRect(
  rect: CropRect,
  bounds: { width: number; height: number },
  minimum = 0.0001,
): CropRect {
  const x = clamp(Number.isFinite(rect.x) ? rect.x : 0, 0, Math.max(0, bounds.width - minimum));
  const y = clamp(Number.isFinite(rect.y) ? rect.y : 0, 0, Math.max(0, bounds.height - minimum));
  return {
    x,
    y,
    width: clamp(
      Number.isFinite(rect.width) ? rect.width : bounds.width,
      minimum,
      bounds.width - x,
    ),
    height: clamp(
      Number.isFinite(rect.height) ? rect.height : bounds.height,
      minimum,
      bounds.height - y,
    ),
  };
}

export function normalizeSourceCrop(crop?: SourceCrop): SourceCrop | undefined {
  if (!crop) return undefined;
  const rect = normalizeCropRect(crop, { width: 1, height: 1 });
  if (rect.x === 0 && rect.y === 0 && rect.width === 1 && rect.height === 1) return undefined;
  return {
    ...rect,
    ...(crop.sourceAspectRatio &&
    Number.isFinite(crop.sourceAspectRatio) &&
    crop.sourceAspectRatio > 0
      ? { sourceAspectRatio: crop.sourceAspectRatio }
      : {}),
  };
}

export function normalizeCanvasCrop(
  crop: CropRect | undefined,
  width: number,
  height: number,
): CropRect | undefined {
  if (!crop) return undefined;
  const bounds = { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
  const rect = normalizeCropRect(
    {
      x: Math.round(crop.x),
      y: Math.round(crop.y),
      width: Math.round(crop.width),
      height: Math.round(crop.height),
    },
    bounds,
    1,
  );
  return rect.x === 0 && rect.y === 0 && rect.width === width && rect.height === height
    ? undefined
    : rect;
}

export function cropRectErrors(
  rect: CropRect,
  bounds: { width: number; height: number },
  integer = false,
): string[] {
  if (!rect || typeof rect !== 'object') return ['crop must be a rectangle'];
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every(Number.isFinite))
    return ['crop coordinates and dimensions must be finite numbers'];
  const errors: string[] = [];
  if (integer && !values.every(Number.isInteger))
    errors.push('canvas crop values must be whole pixels');
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > bounds.width + 1e-9 ||
    rect.y + rect.height > bounds.height + 1e-9
  )
    errors.push('crop must be a non-empty rectangle inside its source');
  return errors;
}

export function sourceCropErrors(crop: SourceCrop): string[] {
  const errors = cropRectErrors(crop, { width: 1, height: 1 });
  if (
    crop?.sourceAspectRatio !== undefined &&
    (!Number.isFinite(crop.sourceAspectRatio) || crop.sourceAspectRatio <= 0)
  )
    errors.push('source crop aspect ratio must be positive');
  return errors;
}

export function getCompositionOutputRect(
  composition: Pick<Composition, 'width' | 'height' | 'crop'>,
): CropRect {
  return composition.crop ?? { x: 0, y: 0, width: composition.width, height: composition.height };
}

export function sourceCropPixels(
  source: { width: number; height: number },
  crop?: SourceCrop,
): CropRect {
  const rect = crop ?? FULL_SOURCE_CROP;
  return {
    x: rect.x * source.width,
    y: rect.y * source.height,
    width: rect.width * source.width,
    height: rect.height * source.height,
  };
}

/** Places the complete source so only the selected region is visible in the target frame. */
export function croppedSourcePlacement(
  source: { width: number; height: number },
  target: { width: number; height: number },
  crop?: SourceCrop,
  fit: MediaPaintFit = 'contain',
  positionX = 0.5,
  positionY = 0.5,
): CropRect {
  const region = sourceCropPixels(source, crop);
  const scale =
    fit === 'cover'
      ? Math.max(target.width / region.width, target.height / region.height)
      : Math.min(target.width / region.width, target.height / region.height);
  const sx = fit === 'fill' ? target.width / region.width : scale;
  const sy = fit === 'fill' ? target.height / region.height : scale;
  return {
    x: (target.width - region.width * sx) * positionX - region.x * sx,
    y: (target.height - region.height * sy) * positionY - region.y * sy,
    width: source.width * sx,
    height: source.height * sy,
  };
}
