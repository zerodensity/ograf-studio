import { describe, expect, it } from 'vitest';
import { resolveMediaTimelinePosition } from './mediaTimeline';

describe('media timeline', () => {
  it('holds before its authored start and stops after a trimmed non-looping clip', () => {
    const options = {
      timelineStartMs: 2_000,
      trimStartMs: 500,
      trimEndMs: 1_500,
      loop: false,
    };
    expect(resolveMediaTimelinePosition(1_999, options)).toEqual({
      active: false,
      positionMs: 500,
    });
    expect(resolveMediaTimelinePosition(2_250, options)).toEqual({
      active: true,
      positionMs: 750,
    });
    expect(resolveMediaTimelinePosition(3_000, options)).toEqual({
      active: false,
      positionMs: 1_500,
    });
  });

  it('loops inside the trim range and applies authored playback speed', () => {
    expect(
      resolveMediaTimelinePosition(1_750, {
        timelineStartMs: 1_000,
        trimStartMs: 200,
        trimEndMs: 1_200,
        loop: true,
        speed: 2,
      }),
    ).toEqual({ active: true, positionMs: 700 });
  });

  it('uses decoded duration as the loop boundary when trim end is omitted', () => {
    expect(
      resolveMediaTimelinePosition(2_500, {
        timelineStartMs: 0,
        trimStartMs: 500,
        trimEndMs: null,
        loop: true,
        durationMs: 2_000,
      }),
    ).toEqual({ active: true, positionMs: 1_500 });
  });
});
