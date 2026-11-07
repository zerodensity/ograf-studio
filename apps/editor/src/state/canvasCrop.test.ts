import { afterAll, describe, expect, it, vi } from 'vitest';
import { createImageLayer, createLayerKeyframe, createProject } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { resetHistory, runDiscreteHistoryStep, undo, redo } from './historyStore';

afterAll(() => {
  resetHistory();
  vi.unstubAllGlobals();
});

describe('canvas crop editing', () => {
  it('crops and undoes as one action without moving authored layers or changing animation', () => {
    vi.stubGlobal('window', { clearTimeout, setTimeout });
    const project = createProject();
    const layer = createImageLayer();
    const pose = {
      x: 200,
      y: 100,
      width: 300,
      height: 200,
      rotation: 30,
      opacity: 1,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    };
    layer.keyframes = [createLayerKeyframe(0, pose), createLayerKeyframe(12, { ...pose, x: 500 })];
    project.compositions[0]!.layers.push(layer);
    useProjectStore.getState().loadProject(project);
    resetHistory();
    const before = structuredClone(useProjectStore.getState().project.compositions[0]!);
    const crop = { x: 100, y: 50, width: 800, height: 600 };
    runDiscreteHistoryStep(() => useProjectStore.getState().setCompositionCrop(crop));
    let current = useProjectStore.getState().project.compositions[0]!;
    expect(current.crop).toEqual(crop);
    expect(current.width).toBe(before.width);
    expect(current.height).toBe(before.height);
    expect(current.layers).toEqual(before.layers);
    undo();
    expect(useProjectStore.getState().project.compositions[0]!.crop).toBeUndefined();
    redo();
    current = useProjectStore.getState().project.compositions[0]!;
    expect(current.crop).toEqual(crop);
    expect(current.layers).toEqual(before.layers);
  });
});
