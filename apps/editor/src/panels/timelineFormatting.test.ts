import { describe, expect, it } from 'vitest';
import {
  analyzeMillisecondDuration,
  formatFrameDuration,
  millisecondsForFrames,
} from './timelineFormatting';

describe('formatFrameDuration', () => {
  it('formats sub-minute frame spans with millisecond precision', () => {
    expect(formatFrameDuration(24, 25)).toBe('00:00.960');
    expect(formatFrameDuration(262, 25)).toBe('00:10.480');
  });

  it('flags half-frame millisecond durations and offers deterministic choices', () => {
    expect(analyzeMillisecondDuration(250, 50)).toMatchObject({
      exactFrames: 12.5,
      floorFrames: 12,
      nearestFrames: 13,
      ceilFrames: 13,
      representable: false,
    });
    expect(analyzeMillisecondDuration(260, 50).representable).toBe(true);
    expect(millisecondsForFrames(23, 50)).toBe(460);
  });

  it('includes hours only when the duration reaches an hour', () => {
    expect(formatFrameDuration(90_000, 25)).toBe('01:00:00.000');
  });

  it('does not divide by an invalid frame rate', () => {
    expect(formatFrameDuration(24, 0)).toBe('00:00.000');
  });
});
