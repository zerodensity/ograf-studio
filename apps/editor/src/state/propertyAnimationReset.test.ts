import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayerPropertyKeyframe,
  createShaderPaint,
  getElementShaderPaint,
  getLayerPropertyValueAtFrame,
  getLayerTransformAtFrame,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { recordEditorLoopSample } from './editorLoopSample';
import { useCanvasViewStore } from './canvasViewStore';
import { useTestDataStore } from './testDataStore';

vi.stubGlobal('window', { clearTimeout });
const history = await import('./historyStore');
const composition = () => useProjectStore.getState().project.compositions[0]!;
const layer = (id: string) => composition().layers.find((item) => item.id === id)!;
const keys = (from: number, to: number) => [
  createLayerPropertyKeyframe(0, from),
  createLayerPropertyKeyframe(10, to),
];
const shaderSource = `#pragma ograf amount slider min(0) max(100)
const float amount = 10.0;
#pragma ograf offset vector2 min(-1) max(1)
const vec2 offset = vec2(0.0);
void mainImage(out vec4 c, in vec2 p) { c=vec4(vec3(amount + offset.x),1.0); }`;

describe('Reset property animation in Studio', () => {
  beforeEach(() => {
    useCanvasViewStore.getState().setMode('animate');
    useProjectStore.getState().newProject();
    useTestDataStore.getState().resetAll();
    history.resetHistory();
  });
  afterAll(() => {
    history.resetHistory();
    vi.unstubAllGlobals();
  });

  it('removes main and active loop keys for one channel in one reversible history step', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.enableLayerPropertyAnimation(id, 'x', 0);
    store.enableLayerPropertyAnimation(id, 'y', 0);
    store.updateLayerTransform(id, 10, { x: 500, y: 300 });
    store.setLayerLoop(id, { durationFrames: 10 });
    store.setLayerLoopPropertyTrack(id, 'x', keys(900, 1000));
    store.setLayerLoopPropertyTrack(id, 'y', keys(400, 500));
    const y = structuredClone(layer(id).animationTracks.y);
    const loop = structuredClone(layer(id).loop!);
    history.resetHistory();
    const before = structuredClone(useProjectStore.getState().project);
    history.runDiscreteHistoryStep(
      () => store.resetLayerPropertyAnimation(id, 'x', 18),
      'Reset Position X animation',
    );
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    expect(layer(id).animationTracks.x).toBeUndefined();
    expect(layer(id).loop!.tracks.x).toBeUndefined();
    expect(layer(id).animationTracks.y).toEqual(y);
    delete loop.tracks.x;
    expect(layer(id).loop).toEqual(loop);
    for (const frame of [0, 10, 18, 125])
      expect(getLayerTransformAtFrame(layer(id), frame).x).toBe(950);
    const after = structuredClone(useProjectStore.getState().project);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(before);
    history.redo();
    expect(useProjectStore.getState().project).toEqual(after);
  });

  it('retains ordinary transform/effect data defaults, live data overrides, bindings and visual rules', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.enableLayerPropertyAnimation(id, 'x', 0);
    store.updateLayerTransform(id, 10, { x: 500 });
    store.enableLayerPropertyAnimation(id, 'blur', 0);
    store.updateLayerEffects(id, 10, { blur: 8 });
    const position = store.addDataField('number');
    const blur = store.addDataField('number');
    store.updateDataField(position, { defaultValue: 999 });
    store.updateDataField(blur, { defaultValue: 77 });
    store.setLayerBindings(id, [
      { fieldId: position, targetProperty: 'transform.x' },
      { fieldId: blur, targetProperty: 'blur' },
    ]);
    store.addLayerVisualRule(id, 'click');
    useTestDataStore.getState().setValue(position, 1234);
    const fields = structuredClone(composition().dataFields);
    const bindings = structuredClone(layer(id).bindings);
    const rules = structuredClone(layer(id).visualRules);
    store.resetLayerPropertyAnimation(id, 'x', 5);
    store.resetLayerPropertyAnimation(id, 'blur', 5);
    expect(getLayerPropertyValueAtFrame(layer(id), 'x', 0)).toBe(300);
    expect(getLayerPropertyValueAtFrame(layer(id), 'blur', 0)).toBe(4);
    expect(composition().dataFields).toEqual(fields);
    expect(layer(id).bindings).toEqual(bindings);
    expect(layer(id).visualRules).toEqual(rules);
    expect(useTestDataStore.getState().values[position]).toBe(1234);
  });

  it('freezes the visibly rendered held-loop phase instead of the parked Step frame', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.setLayerLoop(id, { durationFrames: 10 });
    store.setLayerLoopPropertyTrack(id, 'x', keys(900, 1000));
    recordEditorLoopSample(composition(), id, 13, 7);
    store.resetLayerPropertyAnimation(id, 'x', 13);
    expect(getLayerTransformAtFrame(layer(id), 13).x).toBe(970);
    expect(layer(id).loop!.tracks.x).toBeUndefined();
  });

  it('ignores a rendered phase from an older composition snapshot', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.setLayerLoop(id, { durationFrames: 10 });
    store.setLayerLoopPropertyTrack(id, 'x', keys(900, 1000));
    const source = composition();
    recordEditorLoopSample(source, id, 13, 7);
    store.renameLayer(id, 'Updated source');
    expect(composition()).not.toBe(source);
    store.resetLayerPropertyAnimation(id, 'x', 13);
    expect(getLayerTransformAtFrame(layer(id), 13).x).toBe(900);
  });

  it('respects an explicitly inactive rendered loop sample', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.enableLayerPropertyAnimation(id, 'x', 0);
    store.updateLayerTransform(id, 10, { x: 500 });
    store.setLayerLoop(id, { durationFrames: 10 });
    store.setLayerLoopPropertyTrack(id, 'x', keys(900, 1000));
    recordEditorLoopSample(composition(), id, 18, undefined);
    store.resetLayerPropertyAnimation(id, 'x', 18);
    expect(getLayerTransformAtFrame(layer(id), 18).x).toBe(500);
  });

  it('updates only the reset uniform generated fallback and retains bindings and other field schemas', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('text');
    store.updateLayerPaint(id, 0, createShaderPaint({ fragmentSource: shaderSource }));
    store.enableLayerPropertyAnimation(id, 'fill.parameters.amount', 0);
    store.updateLayerShaderParameter(id, 10, 'fill', 'amount', 50);
    const amountId = composition().dataFields.find(
      (field) => field.generatedShaderParameter?.name === 'amount',
    )!.id;
    const other = structuredClone(
      composition().dataFields.find((field) => field.generatedShaderParameter?.name === 'offset'),
    );
    const bindings = structuredClone(layer(id).bindings);
    store.resetLayerPropertyAnimation(id, 'fill.parameters.amount', 5);
    expect(layer(id).animationTracks['fill.parameters.amount']).toBeUndefined();
    expect(getElementShaderPaint(layer(id).element)!.parameters.amount).toBe(30);
    const amount = composition().dataFields.find((field) => field.id === amountId)!;
    expect(amount.defaultValue).toBe(30);
    expect(amount.generatedShaderParameter?.value).toBe(30);
    expect(
      composition().dataFields.find((field) => field.generatedShaderParameter?.name === 'offset'),
    ).toEqual(other);
    expect(layer(id).bindings).toEqual(bindings);
  });

  it('preserves ordinary shader fields and user value maps while freezing the source uniform', () => {
    for (const mapped of [false, true]) {
      const store = useProjectStore.getState();
      store.newProject();
      const id = store.addLayer('text');
      store.updateLayerPaint(id, 0, createShaderPaint({ fragmentSource: shaderSource }));
      store.enableLayerPropertyAnimation(id, 'fill.parameters.amount', 0);
      store.updateLayerShaderParameter(id, 10, 'fill', 'amount', 50);
      const ordinary = store.addDataField('number');
      store.updateDataField(ordinary, { defaultValue: 99 });
      const bindings = layer(id).bindings.map((binding) =>
        binding.targetProperty === 'fill.parameters.amount'
          ? { ...binding, ...(mapped ? { valueMap: { '10': 90 } } : { fieldId: ordinary }) }
          : binding,
      );
      if (mapped) {
        const project = structuredClone(useProjectStore.getState().project);
        project.compositions[0]!.layers.find((entry) => entry.id === id)!.bindings = bindings;
        useProjectStore.setState({ project });
      } else store.setLayerBindings(id, bindings);
      const fields = structuredClone(composition().dataFields);
      const before = structuredClone(layer(id).bindings);
      store.resetLayerPropertyAnimation(id, 'fill.parameters.amount', 5);
      expect(getElementShaderPaint(layer(id).element)!.parameters.amount).toBe(30);
      expect(layer(id).bindings).toEqual(before);
      expect(composition().dataFields).toEqual(fields);
    }
  });

  it('synchronizes the generated vector default and component defaults without changing the other component', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('text');
    store.updateLayerPaint(id, 0, createShaderPaint({ fragmentSource: shaderSource }));
    store.enableLayerPropertyAnimation(id, 'fill.parameters.offset.x', 0);
    store.updateLayerShaderParameter(id, 10, 'fill', 'offset', [1, 0.8]);
    const amount = structuredClone(
      composition().dataFields.find((field) => field.generatedShaderParameter?.name === 'amount'),
    );
    store.resetLayerPropertyAnimation(id, 'fill.parameters.offset.x', 5);
    const field = composition().dataFields.find(
      (entry) => entry.generatedShaderParameter?.name === 'offset',
    )!;
    expect(getElementShaderPaint(layer(id).element)!.parameters.offset).toEqual([0.5, 0.8]);
    expect(field.defaultValue).toEqual({ x: 0.5, y: 0.8 });
    expect(field.properties.map((entry) => entry.defaultValue)).toEqual([0.5, 0.8]);
    expect(field.generatedShaderParameter?.value).toEqual([0.5, 0.8]);
    expect(
      composition().dataFields.find((entry) => entry.generatedShaderParameter?.name === 'amount'),
    ).toEqual(amount);
  });

  it('keeps a reset local component channel static through source updates without changing siblings', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.enableLayerPropertyAnimation(id, 'x', 0);
    store.updateLayerTransform(id, 10, { x: 500 });
    const componentId = store.createComponent([id], 'Moving card')!;
    const [copy] = store.instantiateComponent(componentId, { x: 40, y: 40 });
    const original = structuredClone(layer(id));
    const frozen = getLayerTransformAtFrame(layer(copy!), 5).x;
    store.resetLayerPropertyAnimation(copy!, 'x', 5);
    expect(layer(id)).toEqual(original);
    expect(layer(copy!).animationTracks.x).toBeUndefined();
    const definition = composition().components.find((entry) => entry.id === componentId)!;
    store.updateComponentLayer(componentId, definition.layers[0]!.id, { name: 'Renamed source' });
    for (const frame of [0, 5, 10, 125])
      expect(getLayerTransformAtFrame(layer(copy!), frame).x).toBe(frozen);
    expect(layer(id).animationTracks.x).toEqual(original.animationTracks.x);
  });

  it('rejects a locked object without creating a history entry or changing source', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.enableLayerPropertyAnimation(id, 'x', 0);
    store.updateLayerTransform(id, 10, { x: 500 });
    store.toggleLayerLock(id);
    history.resetHistory();
    const before = useProjectStore.getState();
    expect(() => store.resetLayerPropertyAnimation(id, 'x', 5)).toThrow('Unlock');
    expect(useProjectStore.getState()).toBe(before);
    expect(history.getHistorySnapshot().past).toHaveLength(0);
  });
});
