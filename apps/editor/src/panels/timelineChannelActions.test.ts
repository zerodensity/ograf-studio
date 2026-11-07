import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  createLayerPropertyKeyframe,
  getLayerPropertyValueAtFrame,
} from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import { getHistorySnapshot, resetHistory, undo } from '../state/historyStore';
import { resetTimelineChannelAnimation } from './timelineChannelActions';

vi.useFakeTimers();
vi.stubGlobal('window', { clearTimeout });

beforeEach(() => {
  useProjectStore.getState().loadProject(createProject());
  useSelectionStore.getState().select(null);
  useTimelineStore.getState().setCurrentFrame(0);
  resetHistory();
});
afterEach(() => resetHistory());
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Timeline channel reset command', () => {
  it('samples the current playhead, preserves other channels and channel selection, and undoes once', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    const first = store.addLayerPropertyKeyframe(id, 'x', 0);
    const last = store.addLayerPropertyKeyframe(id, 'x', 100);
    store.updateLayerPropertyKeyframeValue(id, 'x', first, 200);
    store.updateLayerPropertyKeyframeValue(id, 'x', last, 1000);
    store.addLayerPropertyKeyframe(id, 'y', 0);
    store.setLayerLoop(id, { durationFrames: 100 });
    store.setLayerLoopPropertyTrack(id, 'y', [
      createLayerPropertyKeyframe(0, 100),
      createLayerPropertyKeyframe(100, 300),
    ]);
    useSelectionStore.getState().selectLayerKeyframe(id, first, 'x');
    useTimelineStore.getState().setCurrentFrame(50);
    const layer = () =>
      useProjectStore.getState().project.compositions[0]!.layers.find((item) => item.id === id)!;
    const before = structuredClone(layer());
    const expected = getLayerPropertyValueAtFrame(before, 'x', 50);
    resetHistory();

    expect(resetTimelineChannelAnimation(id, 'x')).toBe(50);

    expect(layer().animationTracks.x).toBeUndefined();
    expect(layer().animationTracks.y).toEqual(before.animationTracks.y);
    expect(layer().loop?.tracks.y).toEqual(before.loop?.tracks.y);
    for (const frame of [0, 50, 100])
      expect(getLayerPropertyValueAtFrame(layer(), 'x', frame)).toBe(expected);
    expect(useSelectionStore.getState()).toMatchObject({
      selectedLayerId: id,
      selectedLayerProperty: 'x',
      selectedLayerKeyframeId: null,
      selectedLayerKeyframes: [],
    });
    expect(useTimelineStore.getState().currentFrame).toBe(50);
    expect(getHistorySnapshot().past).toMatchObject([{ label: 'Reset Position X animation' }]);
    undo();
    expect(layer()).toEqual(before);
    expect(getHistorySnapshot().past).toEqual([]);
  });

  it('preserves source and key selection when a locked-channel reset fails', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    const key = store.addLayerPropertyKeyframe(id, 'x', 0);
    store.toggleLayerLock(id);
    useSelectionStore.getState().selectLayerKeyframe(id, key, 'x');
    const before = useProjectStore.getState().project;
    resetHistory();

    expect(() => resetTimelineChannelAnimation(id, 'x')).toThrow(/lock/i);

    expect(useProjectStore.getState().project).toBe(before);
    expect(useSelectionStore.getState().selectedLayerKeyframeId).toBe(key);
    expect(getHistorySnapshot().past).toEqual([]);
  });
});
