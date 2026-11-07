import { describe, expect, it } from 'vitest';
import {
  cropRectErrors,
  croppedSourcePlacement,
  FULL_SOURCE_CROP,
  getCompositionOutputRect,
  normalizeCanvasCrop,
  normalizeSourceCrop,
  sourceCropPixels,
} from './crop';
import { createMediaPaint, validateMediaPaint } from './mediaPaint';

describe('nondestructive crop geometry', () => {
  it('resets a full crop and bounds a nonempty source region', () => {
    expect(normalizeSourceCrop(FULL_SOURCE_CROP)).toBeUndefined();
    const rect = normalizeSourceCrop({ x: 0.8, y: -1, width: 0.5, height: 2 })!;
    expect(rect.x).toBe(0.8);
    expect(rect.y).toBe(0);
    expect(rect.width).toBeCloseTo(0.2);
    expect(rect.height).toBe(1);
    expect(cropRectErrors(rect, { width: 1, height: 1 })).toEqual([]);
    expect(
      cropRectErrors({ x: 0, y: 0, width: 0, height: 1 }, { width: 1, height: 1 }),
    ).not.toEqual([]);
  });

  it('places only the chosen source region using contain, cover, or stretch', () => {
    const source = { width: 1000, height: 500 },
      target = { width: 200, height: 100 };
    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
    expect(sourceCropPixels(source, crop)).toEqual({ x: 250, y: 0, width: 500, height: 500 });
    expect(croppedSourcePlacement(source, target, crop, 'contain')).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
    expect(croppedSourcePlacement(source, target, crop, 'cover')).toEqual({
      x: -100,
      y: -50,
      width: 400,
      height: 200,
    });
    expect(croppedSourcePlacement(source, target, crop, 'fill')).toEqual({
      x: -100,
      y: 0,
      width: 400,
      height: 100,
    });
  });

  it('keeps canvas crop in whole pixels and reports the cropped output size', () => {
    expect(normalizeCanvasCrop({ x: 1900, y: 900, width: 500, height: 500 }, 1920, 1080)).toEqual({
      x: 1900,
      y: 900,
      width: 20,
      height: 180,
    });
    expect(
      normalizeCanvasCrop({ x: 0, y: 0, width: 1920, height: 1080 }, 1920, 1080),
    ).toBeUndefined();
    const crop = { x: 100, y: 50, width: 800, height: 600 };
    expect(getCompositionOutputRect({ width: 1920, height: 1080, crop })).toEqual(crop);
  });

  it('preserves a media crop through normalization and rejects out-of-source rectangles', () => {
    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
    const paint = createMediaPaint({ source: { kind: 'clip', src: 'video.mp4' }, crop });
    expect(paint.crop).toEqual(crop);
    expect(validateMediaPaint(paint)).toEqual([]);
    expect(validateMediaPaint({ ...paint, crop: { ...crop, width: 1 } })).not.toEqual([]);
  });
});
