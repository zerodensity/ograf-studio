import { describe, expect, it } from 'vitest';
import { createLayerLoopClip, createLayerPropertyKeyframe } from './factory';
import { getLoopFrameAtElapsed, getLoopPropertyValueAtElapsed } from './loopAnimation';

describe('layer loop animation', () => {
  it('derives repeating phase from absolute elapsed frames', () => {
    const loop = createLayerLoopClip({ durationFrames: 20, phaseOffsetFrames: 3 });
    expect(getLoopFrameAtElapsed(loop, 0)).toBe(3);
    expect(getLoopFrameAtElapsed(loop, 19)).toBe(2);
    expect(getLoopFrameAtElapsed(loop, 119)).toBe(2);
  });

  it('samples each local property track with its own incoming easing', () => {
    const loop = createLayerLoopClip({
      durationFrames: 20,
      tracks: {
        opacity: [
          createLayerPropertyKeyframe(0, 0, { easing: 'linear' }),
          createLayerPropertyKeyframe(10, 1, { easing: 'quad-in' }),
          createLayerPropertyKeyframe(20, 0, { easing: 'quad-out' }),
        ],
      },
    });
    expect(getLoopPropertyValueAtElapsed(loop, 'opacity', 5, 1)).toBeCloseTo(0.25);
    expect(getLoopPropertyValueAtElapsed(loop, 'opacity', 10, 0)).toBe(1);
    expect(getLoopPropertyValueAtElapsed(loop, 'opacity', 25, 1)).toBeCloseTo(0.25);
  });

  it('holds the terminal value after a finite repeat count', () => {
    const loop = createLayerLoopClip({ durationFrames: 10, repeatCount: 2 });
    expect(getLoopFrameAtElapsed(loop, 19)).toBe(9);
    expect(getLoopFrameAtElapsed(loop, 20)).toBe(10);
    expect(getLoopFrameAtElapsed(loop, 200)).toBe(10);
  });
});
