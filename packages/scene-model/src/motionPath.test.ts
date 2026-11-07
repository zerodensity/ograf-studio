import { describe, expect, it } from 'vitest';
import { createDefaultTransform, createPathElement } from './factory';
import { attachTransformToMotionPath, sampleMotionPath } from './motionPath';

describe('motion paths', () => {
  it('samples progress by path length and aligns to the tangent', () => {
    const path = createPathElement({ d: 'M0 0 L100 0 L100 100' });
    const halfway = sampleMotionPath(path, 0.5);
    expect(halfway.x).toBeCloseTo(100);
    expect(halfway.y).toBeCloseTo(0);
    expect(halfway.angle).toBeCloseTo(0);
    const attached = attachTransformToMotionPath(
      createDefaultTransform({ width: 20, height: 10 }),
      createDefaultTransform({ x: 50, y: 60, width: 200, height: 100 }),
      path,
      { sourceLayerId: 'path', progress: 0.75, orientToPath: true, offsetX: 0, offsetY: 0 },
    );
    expect(attached.x).toBeCloseTo(240);
    expect(attached.y).toBeCloseTo(105);
    expect(attached.rotation).toBeCloseTo(90);
  });
});
