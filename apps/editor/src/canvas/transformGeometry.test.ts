import { describe, expect, it } from 'vitest';
import { parseCssTransform } from './transformGeometry';

describe('parseCssTransform', () => {
  it('reads the translate3d format emitted by GSAP', () => {
    expect(parseCssTransform('translate3d(100px, 42.5px, 0px) rotate(15deg)')).toEqual({
      x: 100,
      y: 42.5,
      rotation: 15,
    });
  });

  it('reads the translate format emitted by Moveable', () => {
    expect(parseCssTransform('translate(-12px, 30px) rotateZ(-5deg)')).toEqual({
      x: -12,
      y: 30,
      rotation: -5,
    });
  });

  it('reads translation and rotation from a 2D matrix', () => {
    const result = parseCssTransform('matrix(0, 1, -1, 0, 80, 90)');
    expect(result.x).toBe(80);
    expect(result.y).toBe(90);
    expect(result.rotation).toBeCloseTo(90);
  });

  it('returns identity values for an absent transform', () => {
    expect(parseCssTransform('none')).toEqual({ x: 0, y: 0, rotation: 0 });
  });
});
