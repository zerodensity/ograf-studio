import { describe, expect, it } from 'vitest';
import { formatFrameDuration } from './timelineFormatting';

describe('formatFrameDuration', () => {
  it('formats sub-minute frame spans with millisecond precision', () => {
    expect(formatFrameDuration(24, 25)).toBe('00:00.960');
    expect(formatFrameDuration(262, 25)).toBe('00:10.480');
  });

  it('includes hours only when the duration reaches an hour', () => {
    expect(formatFrameDuration(90_000, 25)).toBe('01:00:00.000');
  });

  it('does not divide by an invalid frame rate', () => {
    expect(formatFrameDuration(24, 0)).toBe('00:00.000');
  });
});
