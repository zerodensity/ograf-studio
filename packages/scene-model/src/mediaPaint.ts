import type { Element, MediaPaint, MediaPaintSource, Paint } from './types';
import { getElementFill } from './shader';
import { sourceCropErrors, normalizeSourceCrop } from './crop';

export const LIVE_MEDIA_ELEMENT_TAG = 'zd-ograf-media';

export function isMediaPaint(value: unknown): value is MediaPaint {
  return !!value && typeof value === 'object' && 'type' in value && value.type === 'media';
}

export function normalizeMediaPaint(paint: Partial<MediaPaint> = {}): MediaPaint {
  const source = paint.source ?? { kind: 'clip', src: '' };
  const normalizedSource: MediaPaintSource =
    source.kind === 'live'
      ? {
          kind: 'live',
          tag: source.tag?.trim() ?? '',
          ...(source.fallback?.trim() ? { fallback: source.fallback.trim() } : {}),
        }
      : { kind: 'clip', src: source.src?.trim() ?? '' };
  const crop = normalizeSourceCrop(paint.crop);
  return {
    type: 'media',
    source: normalizedSource,
    fit: paint.fit ?? 'cover',
    ...(crop ? { crop } : {}),
    positionX: Number.isFinite(paint.positionX) ? Math.max(0, Math.min(1, paint.positionX!)) : 0.5,
    positionY: Number.isFinite(paint.positionY) ? Math.max(0, Math.min(1, paint.positionY!)) : 0.5,
    loop: paint.loop ?? true,
    speed: Number.isFinite(paint.speed) ? Math.max(0.1, Math.min(16, paint.speed!)) : 1,
    offsetMs: Number.isFinite(paint.offsetMs) ? Math.max(0, paint.offsetMs!) : 0,
    trimEndMs:
      paint.trimEndMs === null || paint.trimEndMs === undefined
        ? null
        : Math.max(0, paint.trimEndMs),
    timelineStartMs: Number.isFinite(paint.timelineStartMs)
      ? Math.max(0, paint.timelineStartMs!)
      : 0,
    muted: true,
  };
}

export function createMediaPaint(overrides: Partial<MediaPaint> = {}): MediaPaint {
  return normalizeMediaPaint(overrides);
}

export function validateMediaPaint(paint: MediaPaint): string[] {
  const errors: string[] = [];
  if (paint.crop) errors.push(...sourceCropErrors(paint.crop));
  if (!['cover', 'contain', 'fill'].includes(paint.fit)) errors.push('media fit is invalid');
  if (!Number.isFinite(paint.positionX) || paint.positionX < 0 || paint.positionX > 1)
    errors.push('media horizontal position must be from 0 to 1');
  if (!Number.isFinite(paint.positionY) || paint.positionY < 0 || paint.positionY > 1)
    errors.push('media vertical position must be from 0 to 1');
  if (!Number.isFinite(paint.speed) || paint.speed < 0.1 || paint.speed > 16)
    errors.push('media speed must be from 0.1 to 16');
  if (!Number.isFinite(paint.offsetMs) || paint.offsetMs < 0)
    errors.push('media offset must be a non-negative number of milliseconds');
  if (
    paint.trimEndMs !== null &&
    (!Number.isFinite(paint.trimEndMs) || paint.trimEndMs <= paint.offsetMs)
  )
    errors.push('media trim end must be greater than its initial offset');
  if (!Number.isFinite(paint.timelineStartMs) || paint.timelineStartMs < 0)
    errors.push('media timeline start must be a non-negative number of milliseconds');
  if (paint.muted !== true) errors.push('media paint must remain muted');
  if (paint.source.kind === 'clip') {
    if (!paint.source.src.trim()) errors.push('media clip source is required');
  } else if (paint.source.kind === 'live') {
    if (!/^[a-z0-9][a-z0-9._:/-]{0,127}$/i.test(paint.source.tag))
      errors.push('live media tag must be a simple renderer source identifier');
  } else errors.push('media source kind is invalid');
  return errors;
}

export function getElementMediaPaint(element: Element): MediaPaint | undefined {
  const fill = getElementFill(element);
  return isMediaPaint(fill) ? fill : undefined;
}

export function hasElementMediaPaint(element: Element): boolean {
  return !!getElementMediaPaint(element);
}

export function mediaPaintAssetReferences(paint: MediaPaint): string[] {
  return paint.source.kind === 'clip'
    ? [paint.source.src]
    : paint.source.fallback
      ? [paint.source.fallback]
      : [];
}

export function paintHasLiveMedia(paint: Paint | undefined): boolean {
  return isMediaPaint(paint) && paint.source.kind === 'live';
}
