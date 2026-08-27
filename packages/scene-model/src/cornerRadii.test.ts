import { describe, expect, it } from 'vitest';
import {
  clampCornerRadii,
  cornerRadiiToCss,
  createCornerRadii,
  roundedRectangleSvgPath,
} from './cornerRadii';

describe('corner radii', () => {
  it('preserves four independent values in CSS corner order', () => {
    expect(cornerRadiiToCss({ topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 })).toBe(
      '4px 8px 12px 16px',
    );
  });

  it('expands a uniform shorthand and proportionally clamps oversized corners', () => {
    expect(createCornerRadii(6)).toEqual({
      topLeft: 6,
      topRight: 6,
      bottomRight: 6,
      bottomLeft: 6,
    });
    expect(
      clampCornerRadii({ topLeft: 80, topRight: 40, bottomRight: 0, bottomLeft: 0 }, 60, 100),
    ).toEqual({ topLeft: 40, topRight: 20, bottomRight: 0, bottomLeft: 0 });
  });

  it('builds an asymmetric SVG path', () => {
    const path = roundedRectangleSvgPath(100, 80, {
      topLeft: 4,
      topRight: 8,
      bottomRight: 12,
      bottomLeft: 16,
    });
    expect(path).toContain('M 4 0');
    expect(path).toContain('H 92');
    expect(path).toContain('Q 100 80 88 80');
    expect(path).toContain('H 16');
  });
});
