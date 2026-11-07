import { describe, expect, it } from 'vitest';
import { createPathElement } from './factory';
import { normalizePathStretchInsets, pathStretchSlices } from './pathStretch';

describe('path stretch regions', () => {
  it('creates nine source slices while preserving fixed edge dimensions', () => {
    const element = createPathElement({
      viewBoxWidth: 200,
      viewBoxHeight: 100,
      stretchInsets: { left: 30, right: 40, top: 10, bottom: 20 },
    });
    const slices = pathStretchSlices(element);
    expect(slices).toHaveLength(9);
    expect(slices[0]).toMatchObject({ x: 0, y: 0, width: 30, height: 10 });
    expect(slices[4]).toMatchObject({ x: 30, y: 10, width: 130, height: 70 });
    expect(slices[8]).toMatchObject({ x: 160, y: 80, width: 40, height: 20 });
  });

  it('clamps overlapping insets into the source view box', () => {
    const element = createPathElement({ viewBoxWidth: 100, viewBoxHeight: 50 });
    expect(
      normalizePathStretchInsets(element, { left: 80, right: 80, top: 40, bottom: 40 }),
    ).toEqual({ left: 80, right: 20, top: 40, bottom: 10 });
  });
});
