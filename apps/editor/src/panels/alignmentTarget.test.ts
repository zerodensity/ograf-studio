import { describe, expect, it } from 'vitest';
import { effectiveAlignmentTarget } from './alignmentTarget';

describe('alignment target', () => {
  it('aligns a single layer to the canvas whatever was picked', () => {
    expect(effectiveAlignmentTarget(1, null)).toBe('canvas');
    expect(effectiveAlignmentTarget(1, 'selection')).toBe('canvas');
  });

  it('defaults multiple layers to their shared bounds and honours the pick', () => {
    expect(effectiveAlignmentTarget(2, null)).toBe('selection');
    expect(effectiveAlignmentTarget(3, 'canvas')).toBe('canvas');
    expect(effectiveAlignmentTarget(3, 'selection')).toBe('selection');
  });
});
