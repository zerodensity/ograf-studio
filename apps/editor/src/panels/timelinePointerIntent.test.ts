import { describe, expect, it } from 'vitest';
import { isTimelineKeyDrag, TIMELINE_KEY_DRAG_THRESHOLD_PX } from './timelinePointerIntent';

describe('timeline pointer intent', () => {
  it('keeps clicks and pointer jitter separate from keyframe drags', () => {
    expect(isTimelineKeyDrag(100, 100)).toBe(false);
    expect(isTimelineKeyDrag(100, 100 + TIMELINE_KEY_DRAG_THRESHOLD_PX - 1)).toBe(false);
    expect(isTimelineKeyDrag(100, 100 + TIMELINE_KEY_DRAG_THRESHOLD_PX)).toBe(true);
    expect(isTimelineKeyDrag(100, 100 - TIMELINE_KEY_DRAG_THRESHOLD_PX)).toBe(true);
  });
});
