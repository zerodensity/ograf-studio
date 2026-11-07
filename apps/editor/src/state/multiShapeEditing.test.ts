import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import {
  createDefaultGradient,
  getElementFill,
  createLayerOfKind,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { resetHistory, getHistorySnapshot, undo } from './historyStore';
import {
  applySharedShapeColor,
  applySharedShapeStroke,
  applySharedCorner,
  applySharedElementScalar,
} from './multiShapeEditing';

vi.useFakeTimers();
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
});
describe('shared shape properties', () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    resetHistory();
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('edits unlocked shapes together and undoes without changing tracks or locked layers', () => {
    const store = useProjectStore.getState();
    const a = store.addLayer('rectangle'),
      b = store.addLayer('rectangle'),
      locked = store.addLayer('rectangle');
    store.toggleLayerLock(locked);
    const before = structuredClone(useProjectStore.getState().project);
    resetHistory();
    applySharedCorner([a, b, locked], 'topLeft', 18);
    const layers = useProjectStore.getState().project.compositions[0]!.layers;
    expect(layers[0]!.element).toMatchObject({ borderRadius: { topLeft: 18 } });
    expect(layers[1]!.element).toMatchObject({ borderRadius: { topLeft: 18 } });
    expect(layers[2]!.element).toEqual(before.compositions[0]!.layers[2]!.element);
    expect(layers[0]!.animationTracks).toEqual(before.compositions[0]!.layers[0]!.animationTracks);
    expect(getHistorySnapshot().past).toHaveLength(1);
    undo();
    expect(useProjectStore.getState().project).toEqual(before);
  });
  it('preserves non-solid fills and changes stroke across different shapes', () => {
    const store = useProjectStore.getState();
    const a = store.addLayer('rectangle'),
      b = store.addLayer('ellipse');
    store.updateLayerPaint(a, 0, createDefaultGradient());
    const before = getElementFill(
      useProjectStore.getState().project.compositions[0]!.layers[0]!.element,
    );
    resetHistory();
    applySharedShapeColor([a, b], 0, '#ff0000');
    expect(
      getElementFill(useProjectStore.getState().project.compositions[0]!.layers[0]!.element),
    ).toEqual(before);
    expect(getHistorySnapshot().past).toHaveLength(0);
    applySharedShapeStroke([a, b], 'strokeWidth', 7);
    expect(
      useProjectStore
        .getState()
        .project.compositions[0]!.layers.map(
          (l) => (l.element as { strokeWidth: number }).strokeWidth,
        ),
    ).toEqual([7, 7]);
    expect(getHistorySnapshot().past).toHaveLength(1);
  });

  it('updates ticker speed without replacing their items or bindings and can undo', () => {
    const store = useProjectStore.getState();
    const a = store.addLayer('ticker'),
      b = store.addLayer('ticker');
    const before = structuredClone(useProjectStore.getState().project);
    resetHistory();
    applySharedElementScalar([a, b], 'ticker', 'speedPixelsPerSecond', 82);
    const layers = useProjectStore.getState().project.compositions[0]!.layers;
    expect(layers.map((layer) => layer.element)).toEqual(
      before.compositions[0]!.layers.map((layer) => ({
        ...layer.element,
        speedPixelsPerSecond: 82,
      })),
    );
    expect(layers[0]!.bindings).toEqual(before.compositions[0]!.layers[0]!.bindings);
    expect(getHistorySnapshot().past).toHaveLength(1);
    undo();
    expect(useProjectStore.getState().project).toEqual(before);
  });
  it('updates chart presentation and audio volume without replacing their datasets or sources', () => {
    const store = useProjectStore.getState();
    const firstChart = createLayerOfKind('chart');
    const secondChart = createLayerOfKind('chart');
    const project = structuredClone(store.project);
    project.compositions[0]!.layers.push(firstChart, secondChart);
    store.loadProject(project);
    const a = firstChart.id,
      b = secondChart.id;
    const c = store.addLayer('audio'),
      d = store.addLayer('audio');
    const before = structuredClone(useProjectStore.getState().project);
    resetHistory();
    applySharedElementScalar([a, b], 'chart', 'showLegend', false);
    const afterCharts = useProjectStore.getState().project.compositions[0]!.layers;
    expect(afterCharts[0]!.element).toMatchObject({ type: 'chart', showLegend: false });
    if (
      afterCharts[0]!.element.type !== 'chart' ||
      before.compositions[0]!.layers[0]!.element.type !== 'chart'
    )
      throw new Error('chart expected');
    expect(afterCharts[0]!.element.data).toEqual(before.compositions[0]!.layers[0]!.element.data);
    applySharedElementScalar([c, d], 'audio', 'volume', 0.4);
    const afterAudio = useProjectStore.getState().project.compositions[0]!.layers;
    expect(afterAudio[2]!.element).toMatchObject({ type: 'audio', volume: 0.4 });
    expect(afterAudio[3]!.element).toMatchObject({ type: 'audio', volume: 0.4 });
    expect(getHistorySnapshot().past).toHaveLength(2);
    undo();
    undo();
    expect(useProjectStore.getState().project).toEqual(before);
  });
});
