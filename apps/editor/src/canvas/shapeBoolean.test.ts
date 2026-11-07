import { describe, expect, it } from 'vitest';
import {
  createRectangleLayer,
  createEllipseLayer,
  createLayerKeyframe,
  createDefaultTransform,
  parseEditablePath,
} from '@ograf-editor/scene-model';
import { combineShapePaths } from './shapeBoolean';
function rect(x: number, y: number, width = 100, height = 100) {
  const layer = createRectangleLayer();
  layer.keyframes.push(createLayerKeyframe(0, createDefaultTransform({ x, y, width, height })));
  return layer;
}
describe('shape booleans', () => {
  it.each([
    ['union', 150, 150],
    ['subtract', 100, 100],
    ['intersect', 50, 50],
    ['exclude', 150, 150],
  ] as const)('%s creates editable bounded geometry', (operation, width, height) => {
    const a = rect(0, 0),
      b = rect(50, 50);
    const snapshots = JSON.stringify([a, b]);
    const result = combineShapePaths([a, b], 0, operation);
    expect(result.width).toBeCloseTo(width);
    expect(result.height).toBeCloseTo(height);
    expect(parseEditablePath(result.d).every((c) => c.closed)).toBe(true);
    expect(JSON.stringify([a, b])).toBe(snapshots);
  });
  it('handles rotations and curved shapes and refuses empty intersections', () => {
    const a = rect(0, 0);
    a.keyframes[0]!.transform.rotation = 45;
    const b = createEllipseLayer();
    b.keyframes.push(
      createLayerKeyframe(0, createDefaultTransform({ x: 25, y: 25, width: 100, height: 100 })),
    );
    expect(combineShapePaths([a, b], 0, 'intersect').d).toContain('c');
    expect(() => combineShapePaths([rect(0, 0), rect(200, 200)], 0, 'intersect')).toThrow(/empty/);
  });
  it('rejects unsupported hierarchy instead of silently corrupting geometry', () => {
    const a = rect(0, 0);
    a.parentId = 'parent';
    expect(() => combineShapePaths([a, rect(0, 0)], 0, 'union')).toThrow(/unparent/);
  });
});
