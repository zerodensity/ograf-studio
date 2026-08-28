import { describe, expect, it } from 'vitest';
import {
  clampTimelineGutterWidth,
  MAX_TIMELINE_GUTTER_WIDTH,
  MIN_TIMELINE_GUTTER_WIDTH,
} from './timelineGutterResize';

describe('timeline gutter resizing', () => {
  it('clamps to the authored minimum and maximum', () => {
    expect(clampTimelineGutterWidth(40, 1_200)).toBe(MIN_TIMELINE_GUTTER_WIDTH);
    expect(clampTimelineGutterWidth(900, 1_200)).toBe(MAX_TIMELINE_GUTTER_WIDTH);
  });

  it('preserves enough room for the keyframe track area', () => {
    expect(clampTimelineGutterWidth(500, 360)).toBe(213);
    expect(clampTimelineGutterWidth(170, 250)).toBe(MIN_TIMELINE_GUTTER_WIDTH);
  });
});
