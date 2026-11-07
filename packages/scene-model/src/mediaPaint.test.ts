import { describe, expect, it } from 'vitest';
import {
  createMediaPaint,
  mediaPaintAssetReferences,
  normalizeMediaPaint,
  validateMediaPaint,
} from './mediaPaint';

describe('media paint', () => {
  it('normalizes portable clip defaults and asset references', () => {
    const paint = createMediaPaint({ source: { kind: 'clip', src: ' asset:clip ' } });
    expect(paint).toMatchObject({
      type: 'media',
      source: { kind: 'clip', src: 'asset:clip' },
      fit: 'cover',
      positionX: 0.5,
      positionY: 0.5,
      loop: true,
      speed: 1,
      offsetMs: 0,
      trimEndMs: null,
      timelineStartMs: 0,
      muted: true,
    });
    expect(mediaPaintAssetReferences(paint)).toEqual(['asset:clip']);
    expect(validateMediaPaint(paint)).toEqual([]);
  });

  it('normalizes the renderer-only live contract and fallback', () => {
    const paint = normalizeMediaPaint({
      source: { kind: 'live', tag: ' camera.program ', fallback: ' asset:poster ' },
      speed: 99,
      positionX: -1,
    });
    expect(paint).toMatchObject({
      source: { kind: 'live', tag: 'camera.program', fallback: 'asset:poster' },
      speed: 16,
      positionX: 0,
    });
    expect(mediaPaintAssetReferences(paint)).toEqual(['asset:poster']);
    expect(validateMediaPaint(paint)).toEqual([]);
  });

  it('rejects incomplete sources and non-muted playback', () => {
    expect(validateMediaPaint(createMediaPaint())).toContain('media clip source is required');
    expect(
      validateMediaPaint({
        ...createMediaPaint({ source: { kind: 'live', tag: 'bad tag' } }),
        muted: false as true,
      }),
    ).toEqual(
      expect.arrayContaining([
        'media paint must remain muted',
        'live media tag must be a simple renderer source identifier',
      ]),
    );
  });
});
