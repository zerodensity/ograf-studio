import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../state/timelineStore';
import { stepTimelineFrame, timelineFrameDirection } from './timelineFrameNavigation';

const arrows = {
  key: 'ArrowRight',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

describe('Timeline frame navigation', () => {
  beforeEach(() =>
    useTimelineStore.setState({
      currentFrame: 0,
      durationFrames: 60,
      controller: null,
      isPlaying: false,
      previewLoopLayerId: null,
    }),
  );

  it('steps only unmodified arrows and ignores composing input', () => {
    expect(timelineFrameDirection(arrows)).toBe(1);
    expect(timelineFrameDirection({ ...arrows, key: 'ArrowLeft' })).toBe(-1);
    for (const key of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing'])
      expect(timelineFrameDirection({ ...arrows, [key]: true })).toBeNull();
    expect(timelineFrameDirection({ ...arrows, key: 'ArrowDown' })).toBeNull();
  });

  it('pauses and advances once per event using the latest playhead', () => {
    const seek = vi.fn((frame: number) => useTimelineStore.getState().setCurrentFrame(frame));
    const pause = vi.fn(() => useTimelineStore.getState().setPlaying(false));
    useTimelineStore.setState({
      currentFrame: 10.2,
      isPlaying: true,
      previewLoopLayerId: 'loop',
      controller: { seek, pause, play: vi.fn(), stop: vi.fn() },
    });
    stepTimelineFrame(1);
    stepTimelineFrame(1);
    stepTimelineFrame(-1);
    expect(seek.mock.calls).toEqual([[11], [12], [11]]);
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: 11,
      isPlaying: false,
      previewLoopLayerId: null,
    });
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(seek.mock.invocationCallOrder[0]!);
  });

  it('clamps at both ends and tolerates an unavailable controller', () => {
    expect(stepTimelineFrame(1)).toBe(false);
    const seek = vi.fn((frame: number) => useTimelineStore.getState().setCurrentFrame(frame));
    useTimelineStore.setState({
      controller: { seek, pause: vi.fn(), play: vi.fn(), stop: vi.fn() },
    });
    stepTimelineFrame(-1);
    expect(useTimelineStore.getState().currentFrame).toBe(0);
    useTimelineStore.getState().setCurrentFrame(60);
    stepTimelineFrame(1);
    expect(useTimelineStore.getState().currentFrame).toBe(60);
  });
});
