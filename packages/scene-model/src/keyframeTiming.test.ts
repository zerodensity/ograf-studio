import { describe, expect, it } from 'vitest';
import { createComposition, createKeyframe, createTransition } from './factory';
import { computeKeyframeFrames, findNearestKeyframe, getTotalFrames } from './keyframeTiming';

/** A composition whose keyframes are chained by transitions of the given frame durations. */
function chained(durations: number[]) {
  const keyframes = [createKeyframe({ name: 'Keyframe 1' })];
  const transitions = [];
  for (const durationFrames of durations) {
    const next = createKeyframe();
    transitions.push(
      createTransition(keyframes[keyframes.length - 1]!.id, next.id, { durationFrames }),
    );
    keyframes.push(next);
  }
  return createComposition({ keyframes, transitions });
}

describe('computeKeyframeFrames', () => {
  it('places the first keyframe at frame 0', () => {
    const frames = computeKeyframeFrames(chained([]));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.frame).toBe(0);
  });

  it('accumulates transition durations across the chain', () => {
    const frames = computeKeyframeFrames(chained([12, 8, 30]));
    expect(frames.map((f) => f.frame)).toEqual([0, 12, 20, 50]);
  });

  it('falls back to the default duration when a transition is missing', () => {
    const composition = chained([12, 8]);
    // Drop the second transition — the chain must still produce monotonic frames, not NaN.
    composition.transitions = composition.transitions.slice(0, 1);
    expect(computeKeyframeFrames(composition).map((f) => f.frame)).toEqual([0, 12, 24]);
  });

  it('handles a zero-duration transition (two keyframes on the same frame)', () => {
    expect(computeKeyframeFrames(chained([0, 10])).map((f) => f.frame)).toEqual([0, 0, 10]);
  });
});

describe('getTotalFrames', () => {
  it('returns the last keyframe frame', () => {
    expect(getTotalFrames(chained([12, 8, 30]))).toBe(50);
  });

  it('is 0 for a single-keyframe composition', () => {
    expect(getTotalFrames(chained([]))).toBe(0);
  });
});

describe('findNearestKeyframe', () => {
  const frames = computeKeyframeFrames(chained([10, 10]));

  it('finds the closest keyframe to an in-between frame', () => {
    expect(findNearestKeyframe(frames, 4)!.frame).toBe(0);
    expect(findNearestKeyframe(frames, 6)!.frame).toBe(10);
    expect(findNearestKeyframe(frames, 19)!.frame).toBe(20);
  });

  it('snaps exactly-on-keyframe positions to themselves', () => {
    expect(findNearestKeyframe(frames, 10)!.frame).toBe(10);
  });

  it('clamps beyond the ends rather than returning undefined', () => {
    expect(findNearestKeyframe(frames, -100)!.frame).toBe(0);
    expect(findNearestKeyframe(frames, 9999)!.frame).toBe(20);
  });

  it('returns undefined for an empty list', () => {
    expect(findNearestKeyframe([], 5)).toBeUndefined();
  });
});
