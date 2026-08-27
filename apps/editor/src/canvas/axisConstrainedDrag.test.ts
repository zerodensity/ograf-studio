import { describe, expect, it } from 'vitest';
import { constrainedTranslation, dominantDragAxis } from './axisConstrainedDrag';

describe('Shift-constrained dragging', () => {
  it('locks to the first dominant movement axis', () => {
    expect(dominantDragAxis([8, 2])).toBe('x');
    expect(dominantDragAxis([-2, -9])).toBe('y');
    expect(dominantDragAxis([0, 0])).toBeNull();
  });

  it('changes only the chosen coordinate', () => {
    expect(constrainedTranslation({ x: 100, y: 200 }, 'x', 35)).toEqual({ x: 135, y: 200 });
    expect(constrainedTranslation({ x: 100, y: 200 }, 'y', -20)).toEqual({ x: 100, y: 180 });
  });
});
