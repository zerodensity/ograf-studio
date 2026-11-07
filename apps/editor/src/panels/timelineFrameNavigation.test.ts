import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../state/timelineStore';
import { useSelectionStore } from '../state/selectionStore';
import {
  collectTimelineKeyframeFrames,
  handleTimelinePlaybackKey,
  jumpTimelineKeyframe,
  stepTimelineFrame,
  timelineFrameDirection,
  timelineKeyframeDirection,
  timelineTargetOwnsArrows,
  seekTimelineFrame,
  seekTimelineKeyframeOnSelect,
  seekTimelineTime,
  synchronizeTimelineKeySelection,
} from './timelineFrameNavigation';
import {
  createComposition,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  defaultTransformFor,
} from '@ograf-editor/scene-model';

const arrows = {
  key: 'ArrowRight',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

describe('Timeline frame navigation', () => {
  it('leaves keyboard activation of the duration cycle button to the button', () => {
    const target = {
      closest: (selector: string) => (selector.includes('[data-duration-unit-cycle]') ? {} : null),
    } as unknown as Element;
    expect(timelineTargetOwnsArrows(target)).toBe(true);
  });
  beforeEach(() => {
    useSelectionStore.getState().select(null);
    useTimelineStore.setState({
      currentFrame: 0,
      durationFrames: 60,
      controller: null,
      isPlaying: false,
      previewLoopLayerId: null,
    });
  });

  function selectedTrack() {
    const composition = createComposition();
    const layer = createLayerOfKind('rectangle');
    layer.animationTrackMode = 'independent';
    const zero = createLayerPropertyKeyframe(0, 200);
    const fifty = createLayerPropertyKeyframe(50, 1000);
    layer.animationTracks = { x: [zero, fifty] };
    composition.layers = [layer];
    useSelectionStore.getState().selectLayerKeyframe(layer.id, zero.id, 'x');
    return { composition, layer, zero, fifty };
  }

  it('clears a stale selected key on time navigation while preserving its property and layer', () => {
    const { composition, layer, zero } = selectedTrack();
    layer.animationTracks.x = [zero];
    const seek = vi.fn((frame: number) => {
      useTimelineStore.getState().setCurrentFrame(frame);
      synchronizeTimelineKeySelection(composition, frame);
    });
    useTimelineStore.setState({
      durationFrames: 250,
      controller: { seek, pause: vi.fn(), play: vi.fn(), stop: vi.fn() },
    });
    expect(seekTimelineTime('1s', 50, 'seconds')).toBe(50);
    expect(useSelectionStore.getState()).toMatchObject({
      selectedLayerId: layer.id,
      selectedLayerIds: [layer.id],
      selectedLayerProperty: 'x',
      selectedLayerKeyframeId: null,
      selectedLayerKeyframes: [],
    });
    expect(layer.animationTracks.x).toEqual([zero]);
  });

  it('retargets an existing selection at a destination key and keeps plain-click and modifier selections', () => {
    const { composition, layer, zero, fifty } = selectedTrack();
    const seek = vi.fn((frame: number) => {
      useTimelineStore.getState().setCurrentFrame(frame);
      synchronizeTimelineKeySelection(composition, frame);
    });
    useTimelineStore.setState({
      controller: { seek, pause: vi.fn(), play: vi.fn(), stop: vi.fn() },
    });
    seekTimelineFrame(50);
    expect(useSelectionStore.getState().selectedLayerKeyframeId).toBe(fifty.id);
    expect(useSelectionStore.getState().selectedLayerProperty).toBe('x');
    useSelectionStore.getState().selectLayerKeyframe(layer.id, zero.id, 'x');
    seekTimelineKeyframeOnSelect(0, arrows);
    expect(useSelectionStore.getState().selectedLayerKeyframeId).toBe(zero.id);

    const first = { layerId: layer.id, property: 'x' as const, keyframeId: zero.id };
    const second = { layerId: layer.id, property: 'x' as const, keyframeId: fifty.id };
    useSelectionStore.getState().selectLayerKeyframes([first, second], first);
    seekTimelineKeyframeOnSelect(50, { ...arrows, ctrlKey: true });
    expect(useTimelineStore.getState().currentFrame).toBe(0);
    expect(useSelectionStore.getState().selectedLayerKeyframes).toEqual([first, second]);
  });

  it('skips local-loop preview and does not select each passing key after a selection was cleared', () => {
    const { composition, layer, zero } = selectedTrack();
    useTimelineStore.getState().setPreviewLoopLayerId(layer.id);
    synchronizeTimelineKeySelection(composition, 50);
    expect(useSelectionStore.getState().selectedLayerKeyframeId).toBe(zero.id);
    useTimelineStore.getState().setPreviewLoopLayerId(null);
    synchronizeTimelineKeySelection(composition, 25);
    expect(useSelectionStore.getState().selectedLayerKeyframeId).toBeNull();
    synchronizeTimelineKeySelection(composition, 50);
    expect(useSelectionStore.getState().selectedLayerKeyframeId).toBeNull();
    expect(useSelectionStore.getState().selectedLayerProperty).toBe('x');
  });

  it('steps only unmodified arrows and ignores composing input', () => {
    expect(timelineFrameDirection(arrows)).toBe(1);
    expect(timelineFrameDirection({ ...arrows, key: 'ArrowLeft' })).toBe(-1);
    for (const key of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing'])
      expect(timelineFrameDirection({ ...arrows, [key]: true })).toBeNull();
    expect(timelineFrameDirection({ ...arrows, key: 'ArrowDown' })).toBeNull();
  });

  it('seeks an unmodified selected key and pauses without enabling automatic key creation', () => {
    const seek = vi.fn((frame: number) => useTimelineStore.getState().setCurrentFrame(frame));
    const pause = vi.fn(() => useTimelineStore.getState().setPlaying(false));
    useTimelineStore.setState({
      currentFrame: 5,
      autoKeyframe: false,
      isPlaying: true,
      previewLoopLayerId: 'local-loop',
      controller: { seek, pause, play: vi.fn(), stop: vi.fn() },
    });
    expect(seekTimelineKeyframeOnSelect(30, arrows)).toBe(30);
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: 30,
      autoKeyframe: false,
      isPlaying: false,
      previewLoopLayerId: null,
    });
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(seek.mock.invocationCallOrder[0]!);
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      expect(seekTimelineKeyframeOnSelect(40, { ...arrows, [modifier]: true })).toBeNull();
    }
    expect(seek).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('accepts seconds, explicit frames and timecode for the current time without changing duration', () => {
    const seek = vi.fn((frame: number) => useTimelineStore.getState().setCurrentFrame(frame));
    useTimelineStore.setState({
      durationFrames: 250,
      controller: { seek, pause: vi.fn(), play: vi.fn(), stop: vi.fn() },
    });
    expect(seekTimelineTime('1s', 50, 'frames')).toBe(50);
    expect(seekTimelineTime('75f', 50, 'seconds')).toBe(75);
    expect(seekTimelineTime('500ms', 50, 'seconds')).toBe(25);
    expect(seekTimelineTime('00:00:02:10', 50, 'timecode')).toBe(110);
    expect(seekTimelineTime('1.5', 50, 'seconds')).toBe(75);
    expect(seekTimelineTime('10s', 50, 'seconds')).toBe(250);
    expect(useTimelineStore.getState().durationFrames).toBe(250);
    const calls = seek.mock.calls.length;
    for (const draft of ['', 'not a time', '-1s', 'Infinity', '00:00:00:99'])
      expect(seekTimelineTime(draft, 50, 'seconds')).toBeNull();
    expect(seek.mock.calls).toHaveLength(calls);
    expect(seekTimelineFrame(Number.NaN)).toBeNull();
  });

  it('recognizes Ctrl/Cmd arrows only for keyframe jumps', () => {
    expect(timelineKeyframeDirection({ ...arrows, ctrlKey: true })).toBe(1);
    expect(timelineKeyframeDirection({ ...arrows, key: 'ArrowLeft', metaKey: true })).toBe(-1);
    expect(timelineKeyframeDirection(arrows)).toBeNull();
    expect(timelineKeyframeDirection({ ...arrows, ctrlKey: true, shiftKey: true })).toBeNull();
    expect(timelineKeyframeDirection({ ...arrows, ctrlKey: true, key: 'ArrowDown' })).toBeNull();
  });

  it('collects distinct lifecycle, layer, and property frames but excludes local-loop keys', () => {
    const composition = createComposition();
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = [
      createLayerKeyframe(5, defaultTransformFor('rectangle')),
      createLayerKeyframe(20, defaultTransformFor('rectangle')),
    ];
    layer.animationTracks.x = [createLayerPropertyKeyframe(12, 42)];
    layer.loop = createLayerLoopClip({
      durationFrames: 10,
      tracks: { x: [createLayerPropertyKeyframe(7, 1)] },
    });
    composition.layers = [layer];
    const frames = collectTimelineKeyframeFrames(composition);
    expect(frames).toEqual(expect.arrayContaining([0, 5, 12, 20]));
    expect(frames).not.toContain(7);
    expect(frames).toEqual([...new Set(frames)].sort((left, right) => left - right));
  });

  it('jumps to adjacent distinct keyframes, pauses, and does not wrap at the ends', () => {
    const seek = vi.fn((frame: number) => useTimelineStore.getState().setCurrentFrame(frame));
    const pause = vi.fn(() => useTimelineStore.getState().setPlaying(false));
    useTimelineStore.setState({
      currentFrame: 10,
      isPlaying: true,
      previewLoopLayerId: 'loop',
      controller: { seek, pause, play: vi.fn(), stop: vi.fn() },
    });
    expect(jumpTimelineKeyframe([0, 10, 24, 40], 1)).toBe(true);
    expect(jumpTimelineKeyframe([0, 10, 24, 40], 1)).toBe(true);
    expect(jumpTimelineKeyframe([0, 10, 24, 40], -1)).toBe(true);
    expect(seek.mock.calls).toEqual([[24], [40], [24]]);
    expect(useTimelineStore.getState()).toMatchObject({
      currentFrame: 24,
      isPlaying: false,
      previewLoopLayerId: null,
    });
    useTimelineStore.getState().setCurrentFrame(40);
    expect(jumpTimelineKeyframe([0, 10, 24, 40], 1)).toBe(true);
    expect(seek.mock.calls).toHaveLength(3);
    expect(pause).toHaveBeenCalledTimes(4);
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

  it('toggles playback once per Space press using current state and consumes held repeats', () => {
    const play = vi.fn(() => useTimelineStore.getState().setPlaying(true));
    const pause = vi.fn(() => useTimelineStore.getState().setPlaying(false));
    useTimelineStore.setState({ controller: { play, pause, seek: vi.fn(), stop: vi.fn() } });
    const space = { ...arrows, key: ' ', code: 'Space' };
    expect(handleTimelinePlaybackKey(space)).toBe(true);
    expect(useTimelineStore.getState().isPlaying).toBe(true);
    expect(handleTimelinePlaybackKey({ ...space, repeat: true })).toBe(true);
    expect(play).toHaveBeenCalledOnce();
    expect(pause).not.toHaveBeenCalled();
    expect(handleTimelinePlaybackKey({ ...space, code: undefined })).toBe(true);
    expect(pause).toHaveBeenCalledOnce();
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it('ignores modified or composing Space and safely handles an unavailable timeline', () => {
    const space = { ...arrows, key: ' ', code: 'Space' };
    expect(handleTimelinePlaybackKey(space)).toBe(true);
    for (const key of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing'])
      expect(handleTimelinePlaybackKey({ ...space, [key]: true })).toBe(false);
    expect(handleTimelinePlaybackKey(arrows)).toBe(false);
    const play = vi.fn();
    useTimelineStore.setState({
      durationFrames: 0,
      controller: { play, pause: vi.fn(), seek: vi.fn(), stop: vi.fn() },
    });
    expect(handleTimelinePlaybackKey(space)).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });
});
