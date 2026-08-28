import { describe, expect, it } from 'vitest';
import {
  numericScrubMultiplier,
  numericScrubValue,
  NUMERIC_SCRUB_DRAG_THRESHOLD_PX,
} from './numericScrub';

describe('numeric field scrubbing', () => {
  it('moves one declared step for every two horizontal pixels', () => {
    expect(
      numericScrubValue({
        startValue: 100,
        startClientX: 20,
        currentClientX: 30,
        step: 1,
      }),
    ).toBe(105);
    expect(NUMERIC_SCRUB_DRAG_THRESHOLD_PX).toBe(3);
  });

  it('supports Shift coarse and Alt fine modifiers', () => {
    expect(numericScrubMultiplier(true, false)).toBe(10);
    expect(numericScrubMultiplier(false, true)).toBe(0.1);
    expect(
      numericScrubValue({
        startValue: 1,
        startClientX: 0,
        currentClientX: 20,
        step: 0.1,
        shiftKey: true,
      }),
    ).toBe(11);
    expect(
      numericScrubValue({
        startValue: 1,
        startClientX: 0,
        currentClientX: 20,
        step: 0.1,
        altKey: true,
      }),
    ).toBe(1.1);
  });

  it('clamps to field bounds and avoids floating-point noise', () => {
    expect(
      numericScrubValue({
        startValue: 0.9,
        startClientX: 0,
        currentClientX: 20,
        step: 0.1,
        max: 1,
      }),
    ).toBe(1);
    expect(
      numericScrubValue({
        startValue: 0.3,
        startClientX: 10,
        currentClientX: 4,
        step: 0.1,
        min: 0,
      }),
    ).toBe(0);
  });
});
