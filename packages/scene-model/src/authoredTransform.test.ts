import { describe, expect, it } from 'vitest';
import { normalizeAuthoredTransform, normalizeAuthoredTransformPatch } from './authoredTransform';

describe('authored transform normalization', () => {
  it('snaps pixel geometry while preserving continuous properties', () => {
    expect(
      normalizeAuthoredTransform({
        x: 119.596,
        y: -10.6,
        width: 400.49,
        height: 0.2,
        rotation: 12.345,
        opacity: 0.555,
        transformOriginX: 0.333,
        transformOriginY: 0.667,
      }),
    ).toEqual({
      x: 120,
      y: -11,
      width: 400,
      height: 1,
      rotation: 12.345,
      opacity: 0.555,
      transformOriginX: 0.333,
      transformOriginY: 0.667,
    });
  });

  it('normalizes only pixel fields present in a patch', () => {
    expect(normalizeAuthoredTransformPatch({ x: 10.49, rotation: 8.75, opacity: 0.4 })).toEqual({
      x: 10,
      rotation: 8.75,
      opacity: 0.4,
    });
  });
});
