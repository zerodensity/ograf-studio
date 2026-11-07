import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMediaPaint,
  createProject,
  createRectangleLayer,
  getElementMediaPaint,
} from '@ograf-editor/scene-model';
import { buildNodosInputDeclarations } from '@ograf-editor/codegen';
import { useProjectStore } from './projectStore';
import {
  liveMediaInputNames,
  routeLiveMediaInputToLayer,
  validLiveMediaInputName,
} from './liveMediaInputs';
import { getHistorySnapshot, resetHistory, undo } from './historyStore';

vi.useFakeTimers();
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('direct live input routing', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(createProject());
    resetHistory();
  });

  it('routes directly to the selected rectangle without creating a cue or target reference, and supports undo', () => {
    const state = useProjectStore.getState();
    const layerId = state.addLayer('rectangle');
    const before = useProjectStore.getState().project;
    resetHistory();
    expect(routeLiveMediaInputToLayer(layerId, 'TextureInput1')).toBe(true);
    const project = useProjectStore.getState().project;
    const composition = project.compositions[0]!;
    expect(composition.mediaCues).toEqual([]);
    expect(
      getElementMediaPaint(composition.layers.find((layer) => layer.id === layerId)!.element)
        ?.source,
    ).toEqual({ kind: 'live', tag: 'TextureInput1' });
    expect(buildNodosInputDeclarations(composition)).toEqual([
      { name: 'TextureInput1', type: 'nos.sys.vulkan.Texture' },
    ]);
    expect(project).toMatchObject({ supportsRealTime: true, supportsNonRealTime: false });
    expect(routeLiveMediaInputToLayer(layerId, 'TextureInput1')).toBe(true);
    expect(getHistorySnapshot().past).toHaveLength(1);
    undo();
    expect(useProjectStore.getState().project).toEqual(before);
  });

  it('redirects an existing input to another object and keeps each object’s framing', () => {
    const project = createProject();
    const composition = project.compositions[0]!;
    const first = createRectangleLayer(),
      second = createRectangleLayer();
    if (!('fill' in first.element) || !('fill' in second.element))
      throw new Error('Expected fills');
    first.element.fill = createMediaPaint({ source: { kind: 'live', tag: 'TextureInput1' } });
    second.element.fill = createMediaPaint({
      source: { kind: 'clip', src: 'video.mp4' },
      fit: 'contain',
      positionX: 0.2,
    });
    composition.layers = [first, second];
    useProjectStore.getState().loadProject(project);
    expect(routeLiveMediaInputToLayer(second.id, 'TextureInput1')).toBe(true);
    const current = useProjectStore.getState().project.compositions[0]!;
    expect(liveMediaInputNames(current)).toEqual(['TextureInput1']);
    expect(getElementMediaPaint(current.layers[1]!.element)).toMatchObject({
      fit: 'contain',
      positionX: 0.2,
      source: { kind: 'live', tag: 'TextureInput1' },
    });
    expect(current.mediaCues).toEqual([]);
  });

  it('refuses missing, locked or unsupported targets and invalid input names', () => {
    const layerId = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().toggleLayerLock(layerId);
    const before = useProjectStore.getState().project;
    expect(routeLiveMediaInputToLayer(layerId, 'TextureInput1')).toBe(false);
    expect(routeLiveMediaInputToLayer('missing', 'TextureInput1')).toBe(false);
    for (const name of ['', 'input with spaces', 'Output', 'camera/input']) {
      expect(validLiveMediaInputName(name)).toBe(false);
      expect(routeLiveMediaInputToLayer(layerId, name)).toBe(false);
    }
    expect(useProjectStore.getState().project).toBe(before);
  });

  it('rejects pin names that cannot be saved as Media tags without changing the project or history', () => {
    const layerId = useProjectStore.getState().addLayer('rectangle');
    const before = useProjectStore.getState().project;
    resetHistory();
    for (const name of ['_camera', '_TextureInput1']) {
      expect(validLiveMediaInputName(name)).toBe(false);
      expect(routeLiveMediaInputToLayer(layerId, name)).toBe(false);
    }
    expect(useProjectStore.getState().project).toBe(before);
    expect(getHistorySnapshot().past).toHaveLength(0);
    expect(validLiveMediaInputName('TextureInput1')).toBe(true);
  });
});
