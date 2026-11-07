import { describe, expect, it } from 'vitest';
import { parseEditablePath } from '@ograf-editor/scene-model';
import { constrainPenAngle, penPath } from './penGeometry';

describe('pen drawing geometry', () => {
  it('preserves smooth handles and closed geometry after normalizing to a layer box', () => {
    const original = [
      { x: 100, y: 120, in: { x: 80, y: 120 }, out: { x: 120, y: 120 } },
      { x: 200, y: 160, in: { x: 200, y: 140 }, out: { x: 200, y: 180 } },
      { x: 140, y: 240, in: { x: 160, y: 240 }, out: { x: 120, y: 240 } },
    ];
    const path = penPath(original, true);
    expect(path).toMatchObject({ x: 80, y: 120, width: 120, height: 120, closed: true });
    const [contour] = parseEditablePath(path.d);
    expect(contour?.closed).toBe(true);
    expect(contour?.nodes).toEqual(
      original.map((n) => ({
        x: n.x - 80,
        y: n.y - 120,
        in: { x: n.in.x - 80, y: n.in.y - 120 },
        out: { x: n.out.x - 80, y: n.out.y - 120 },
      })),
    );
  });
  it('supports open paths and constrains to 45 degree increments', () => {
    const point = constrainPenAngle({ x: 0, y: 0 }, { x: 10, y: 4 });
    expect(point.y).toBe(0);
    expect(
      parseEditablePath(
        penPath(
          [
            { x: 1, y: 2 },
            { x: 10, y: 2 },
          ],
          false,
        ).d,
      )[0]?.closed,
    ).toBe(false);
    expect(() => penPath([{ x: 1, y: 2 }], false)).toThrow();
  });
});
