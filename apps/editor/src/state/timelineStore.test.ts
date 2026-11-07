import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from './timelineStore';

afterEach(() => useTimelineStore.setState(useTimelineStore.getInitialState(), true));

describe('Timeline authoring preferences', () => {
  it('defaults to continuous playback and editing at the playhead', () => {
    expect(useTimelineStore.getInitialState()).toMatchObject({
      pauseAtOgrafSteps: false,
      autoKeyframe: false,
      editScope: 'playhead',
    });
    useTimelineStore.getState().setPauseAtOgrafSteps(true);
    expect(useTimelineStore.getState().pauseAtOgrafSteps).toBe(true);
    useTimelineStore.getState().setPauseAtOgrafSteps(false);
    expect(useTimelineStore.getState().pauseAtOgrafSteps).toBe(false);
  });

  it('clears whole-animation edit intent when switching projects while preserving explicit rehearsal preference', () => {
    const stop = vi.fn();
    useTimelineStore.setState({
      autoKeyframe: true,
      isPlaying: true,
      pauseAtOgrafSteps: true,
      currentFrame: 50,
      controller: { stop, seek: vi.fn(), pause: vi.fn(), play: vi.fn() },
    });
    useTimelineStore.getState().setEditScope('whole-animation');
    useTimelineStore.getState().resetForProjectLoad(0);
    expect(stop).toHaveBeenCalledOnce();
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: 0,
      autoKeyframe: false,
      editScope: 'playhead',
      isPlaying: false,
      pauseAtOgrafSteps: true,
    });
  });
});
