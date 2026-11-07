import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLayerTransformAtFrame } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { resetHistory, getHistorySnapshot, undo } from './historyStore';
import { applySharedTransform } from './multiTransformEditing';

vi.stubGlobal('window', { clearTimeout });
afterAll(() => vi.unstubAllGlobals());
describe('shared transform editing', () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    resetHistory();
  });
  it('changes unlocked layers in one undo step and leaves locked layers unchanged', () => {
    const store = useProjectStore.getState();
    const a = store.addLayer('rectangle'),
      b = store.addLayer('text'),
      locked = store.addLayer('ellipse');
    store.toggleLayerLock(locked);
    const before = structuredClone(useProjectStore.getState().project);
    resetHistory();
    applySharedTransform([a, b, locked], 13, 'x', 250, 'X');
    const layers = useProjectStore.getState().project.compositions[0]!.layers;
    expect(getLayerTransformAtFrame(layers[0]!, 13).x).toBe(250);
    expect(getLayerTransformAtFrame(layers[1]!, 13).x).toBe(250);
    expect(layers[2]).toEqual(before.compositions[0]!.layers[2]);
    expect(getHistorySnapshot().past.map((item) => item.label)).toEqual([
      'Set X for selected layers',
    ]);
    undo();
    expect(useProjectStore.getState().project).toEqual(before);
  });
});
