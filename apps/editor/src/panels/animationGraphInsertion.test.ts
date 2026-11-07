import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  getTotalFrames,
  type AnimatableLayerProperty,
} from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import type { GraphKeyInsertion } from './animationGraphEditing';

vi.stubGlobal('window', { clearTimeout });
const history = await import('../state/historyStore');
const { insertAnimationGraphKey } = await import('./animationGraphEditing');

beforeEach(() => useProjectStore.getState().loadProject(createProject()));
afterEach(() => history.resetHistory());
afterAll(() => vi.unstubAllGlobals());

function fixture(animated = true, property: AnimatableLayerProperty = 'x') {
  const store = useProjectStore.getState();
  const layerId = store.addLayer('rectangle');
  if (animated)
    for (const frame of [0, 24]) store.addLayerPropertyKeyframe(layerId, property, frame);
  const state = useProjectStore.getState();
  const composition = state.project.compositions[0]!;
  const layer = () =>
    useProjectStore.getState().project.compositions[0]!.layers.find((item) => item.id === layerId)!;
  const target: GraphKeyInsertion = {
    projectId: state.project.id,
    compositionId: composition.id,
    layerId,
    property,
    originalTrack: structuredClone(layer().animationTracks[property] ?? []),
    frame: 12,
    value: 250,
  };
  history.resetHistory();
  return { target, layer };
}

describe('Graph key insertion', () => {
  it('adds the requested time/value in one Undo and selects it without seeking or changing siblings', () => {
    const { target, layer } = fixture();
    const store = useProjectStore.getState();
    store.addLayerPropertyKeyframe(target.layerId, 'y', 0);
    store.addLayerPropertyKeyframe(target.layerId, 'y', 24);
    const before = structuredClone(layer());
    const seek = vi.fn();
    useTimelineStore.setState({
      currentFrame: 5,
      controller: { seek, play: vi.fn(), pause: vi.fn(), stop: vi.fn() },
    });
    history.resetHistory();

    const inserted = insertAnimationGraphKey(target);

    expect(inserted).not.toBeNull();
    expect(layer().animationTracks.x?.find((key) => key.id === inserted)).toMatchObject({
      frame: 12,
      value: 250,
    });
    expect(layer().animationTracks.x?.filter((key) => key.id !== inserted)).toEqual(
      before.animationTracks.x,
    );
    expect(layer().animationTracks.y).toEqual(before.animationTracks.y);
    expect(useSelectionStore.getState()).toMatchObject({
      selectedLayerId: target.layerId,
      selectedLayerProperty: 'x',
      selectedLayerKeyframeId: inserted,
    });
    expect(useTimelineStore.getState().currentFrame).toBe(5);
    expect(seek).not.toHaveBeenCalled();
    expect(history.getHistorySnapshot().past.map((item) => item.label)).toEqual([
      'Add animation graph key',
    ]);
    history.undo();
    expect(layer()).toEqual(before);
    history.redo();
    expect(layer().animationTracks.x?.find((key) => key.id === inserted)).toMatchObject({
      frame: 12,
      value: 250,
    });
  });

  it.each([0, 12])(
    'enables an empty independent channel at frame %s without keying static siblings',
    (frame) => {
      const { target, layer } = fixture(false);
      expect(layer().animationTrackMode).toBe('independent');
      expect(layer().animationTracks.x).toBeUndefined();
      const inserted = insertAnimationGraphKey({ ...target, frame });
      expect(inserted).not.toBeNull();
      expect(layer().animationTracks.x).toEqual([
        expect.objectContaining({ id: inserted, frame, value: 250 }),
      ]);
      expect(layer().animationTracks.y).toBeUndefined();
      expect(layer().animationTracks.opacity).toBeUndefined();
    },
  );

  it('uses the store to normalize Alpha values into its supported range', () => {
    const { target, layer } = fixture(false, 'opacity');
    const inserted = insertAnimationGraphKey({ ...target, value: 2 });
    expect(inserted).not.toBeNull();
    expect(layer().animationTracks.opacity).toEqual([
      expect.objectContaining({ id: inserted, frame: 12, value: 1 }),
    ]);
  });

  it('rejects invalid, fractional, out-of-duration and colliding frames before mutating source', () => {
    const { target } = fixture();
    const before = useProjectStore.getState().project;
    const end = getTotalFrames(before.compositions[0]!);
    for (const frame of [-1, 1.5, end + 1, Number.NaN, Number.POSITIVE_INFINITY, 0])
      expect(insertAnimationGraphKey({ ...target, frame })).toBeNull();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
      expect(insertAnimationGraphKey({ ...target, value })).toBeNull();
    expect(insertAnimationGraphKey({ ...target, property: 'strokeWidth' })).toBeNull();
    expect(useProjectStore.getState().project).toBe(before);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
  });

  it('rejects replaced, missing and locked targets without touching keys or selection', () => {
    const { target, layer } = fixture();
    const before = useProjectStore.getState().project;
    expect(insertAnimationGraphKey({ ...target, projectId: 'replaced' })).toBeNull();
    expect(insertAnimationGraphKey({ ...target, compositionId: 'missing' })).toBeNull();
    expect(insertAnimationGraphKey({ ...target, layerId: 'missing' })).toBeNull();
    expect(useProjectStore.getState().project).toBe(before);
    useProjectStore.getState().toggleLayerLock(target.layerId);
    const locked = useProjectStore.getState().project;
    const selected = useSelectionStore.getState().selectedLayerKeyframeId;
    history.resetHistory();
    expect(insertAnimationGraphKey(target)).toBeNull();
    expect(useProjectStore.getState().project).toBe(locked);
    expect(layer().animationTracks.x).toEqual(target.originalTrack);
    expect(useSelectionStore.getState().selectedLayerKeyframeId).toBe(selected);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
  });

  it('rejects a stale track, including a channel enabled after its empty graph menu opened', () => {
    const { target, layer } = fixture(false);
    useProjectStore.getState().addLayerPropertyKeyframe(target.layerId, 'x', 6);
    const changed = structuredClone(layer().animationTracks);
    const before = useProjectStore.getState().project;
    history.resetHistory();
    expect(insertAnimationGraphKey(target)).toBeNull();
    expect(useProjectStore.getState().project).toBe(before);
    expect(layer().animationTracks).toEqual(changed);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
  });
});
