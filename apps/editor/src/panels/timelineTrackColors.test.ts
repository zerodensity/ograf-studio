import { describe, expect, it } from 'vitest';
import {
  TIMELINE_LAYER_TRACK_COLOR,
  TIMELINE_PROPERTY_TRACK_COLORS,
  timelineTrackColorForProperty,
} from './timelineTrackColors';

describe('timeline semantic track colours', () => {
  it('uses one fixed parent-layer colour and stable property colours', () => {
    expect(TIMELINE_LAYER_TRACK_COLOR).toBe('#8a8f99');
    expect(timelineTrackColorForProperty('x')).toBe(TIMELINE_PROPERTY_TRACK_COLORS.x);
    expect(timelineTrackColorForProperty('y')).toBe(TIMELINE_PROPERTY_TRACK_COLORS.y);
    expect(timelineTrackColorForProperty('x')).not.toBe(timelineTrackColorForProperty('y'));
  });

  it('assigns gradient-stop tracks a deterministic repeating palette', () => {
    expect(timelineTrackColorForProperty('fill.stops[0].offset')).toBe('#ff8a65');
    expect(timelineTrackColorForProperty('fill.stops[1].offset')).toBe('#ffd166');
    expect(timelineTrackColorForProperty('fill.stops[6].offset')).toBe('#ff8a65');
  });
});
