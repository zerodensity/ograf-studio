import { describe, expect, it } from 'vitest';
import { createDefaultTransform } from '@ograf-editor/scene-model';
import {
  alignedPatches,
  distributedPatches,
  resizeConstrainedTransform,
  snapLayerPosition,
} from './layoutGeometry';

describe('canvas layout geometry', () => {
  it('applies right/bottom and stretch constraints when a composition resizes', () => {
    const pose = createDefaultTransform({ x: 100, y: 80, width: 200, height: 50 });
    expect(
      resizeConstrainedTransform(
        pose,
        { horizontal: 'right', vertical: 'bottom' },
        { width: 1000, height: 500 },
        { width: 1200, height: 600 },
      ),
    ).toMatchObject({ x: 300, y: 180, width: 200, height: 50 });
    expect(
      resizeConstrainedTransform(
        pose,
        { horizontal: 'left-right', vertical: 'top-bottom' },
        { width: 1000, height: 500 },
        { width: 1200, height: 600 },
      ),
    ).toMatchObject({ x: 100, y: 80, width: 400, height: 150 });
  });

  it('aligns and distributes mixed-size selections by their bounds', () => {
    const items = [
      { id: 'a', pose: createDefaultTransform({ x: 0, width: 100 }) },
      { id: 'b', pose: createDefaultTransform({ x: 180, width: 40 }) },
      { id: 'c', pose: createDefaultTransform({ x: 300, width: 100 }) },
    ];
    expect(alignedPatches(items, 'right').get('a')).toEqual({ x: 300 });
    expect(distributedPatches(items, 'horizontal').get('b')).toEqual({ x: 180 });
  });

  it('snaps edges/centres to guides and optionally contains bounds', () => {
    expect(
      snapLayerPosition(
        { x: 96, y: 42, width: 100, height: 40 },
        { threshold: 5, verticalGuides: [100], horizontalGuides: [40] },
      ),
    ).toEqual({ x: 100, y: 40 });
    expect(
      snapLayerPosition(
        { x: 190, y: 95, width: 40, height: 20 },
        {
          threshold: 0,
          verticalGuides: [],
          horizontalGuides: [],
          bounds: { width: 200, height: 100 },
        },
      ),
    ).toEqual({ x: 160, y: 80 });
  });
});
