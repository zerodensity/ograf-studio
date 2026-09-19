import { beforeEach, describe, expect, it } from 'vitest';
import {
  createShaderPaint,
  createLayerPropertyKeyframe,
  getElementShaderPaint,
  getLayerPropertyValueAtFrame,
  getResolvedLayerAnimationTracks,
  sampleShaderAnimationTracks,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useTimelineStore } from './timelineStore';
import { useSelectionStore } from './selectionStore';
import { isTimelinePropertyMeaningful } from '../panels/timelinePropertyVisibility';

const source = `#pragma ograf yaw slider min(-90) max(90) step(1)
const float yaw = 0.0;
#pragma ograf pitch slider min(-45) max(45) step(1)
const float pitch = 3.0;
#pragma ograf offset vector2 min(-1) max(1) step(0.01)
const vec2 offset = vec2(0.0);
#pragma ograf count slider min(0) max(5)
const int count = 2;
#pragma ograf enabled toggle
const bool enabled = true;
void mainImage(out vec4 c, in vec2 p) { c=vec4(vec3(yaw+pitch+offset.x+float(count)),enabled ? 1.0 : 0.0); }`;
function setup() {
  const store = useProjectStore.getState();
  const id = store.addLayer('text');
  store.updateLayerPaint(id, 0, createShaderPaint({ fragmentSource: source }));
  return {
    store,
    id,
    layer: () =>
      useProjectStore.getState().project.compositions[0]!.layers.find((layer) => layer.id === id)!,
    composition: () => useProjectStore.getState().project.compositions[0]!,
  };
}
beforeEach(() => {
  useProjectStore.getState().newProject();
  useTimelineStore.getState().setAutoKeyframe(false);
});
describe('shader animation authoring', () => {
  it('auto-keys only the edited exposed parameter without changing its GDD default', () => {
    const { store, id, layer, composition } = setup();
    useTimelineStore.getState().setAutoKeyframe(true);
    store.updateLayerShaderParameter(id, 12, 'fill', 'yaw', 30);
    expect(layer().animationTracks['fill.parameters.yaw']).toMatchObject([
      { frame: 12, value: 30 },
    ]);
    expect(layer().animationTracks['fill.parameters.pitch']).toBeUndefined();
    expect(getElementShaderPaint(layer().element)!.parameters.yaw).toBe(0);
    expect(
      composition().dataFields.find((field) => field.generatedShaderParameter?.name === 'yaw')!
        .defaultValue,
    ).toBe(0);
    expect(isTimelinePropertyMeaningful(layer(), 'fill.parameters.yaw', new Set([0, 12, 24]))).toBe(
      true,
    );
  });
  it('samples Inspector values and offsets existing curves when Auto-keyframe is off', () => {
    const { store, id, layer } = setup();
    useTimelineStore.getState().setAutoKeyframe(true);
    store.updateLayerShaderParameter(id, 0, 'fill', 'yaw', -20);
    store.updateLayerShaderParameter(id, 12, 'fill', 'yaw', 30);
    const sampled = sampleShaderAnimationTracks(
      layer().element,
      getResolvedLayerAnimationTracks(layer()),
      6,
    );
    expect(getElementShaderPaint(sampled)!.parameters.yaw).toBe(5);
    useTimelineStore.getState().setAutoKeyframe(false);
    store.updateLayerShaderParameter(id, 6, 'fill', 'yaw', 15);
    expect(
      layer().animationTracks['fill.parameters.yaw']!.map((key) => [key.frame, key.value]),
    ).toEqual([
      [0, -10],
      [12, 40],
    ]);
    expect(getLayerPropertyValueAtFrame(layer(), 'fill.parameters.yaw', 6)).toBe(15);
    expect(getElementShaderPaint(layer().element)!.parameters.pitch).toBe(3);
  });
  it('does not key or overwrite untouched animated vector channels', () => {
    const { store, id, layer } = setup();
    useTimelineStore.getState().setAutoKeyframe(true);
    store.updateLayerShaderParameter(id, 12, 'fill', 'offset', [0.5, 0]);
    store.updateLayerShaderParameter(id, 12, 'fill', 'offset', [0.5, 0.8]);
    expect(layer().animationTracks['fill.parameters.offset.x']).toHaveLength(1);
    expect(layer().animationTracks['fill.parameters.offset.y']).toMatchObject([{ value: 0.8 }]);
    useTimelineStore.getState().setAutoKeyframe(false);
    store.updateLayerShaderParameter(id, 12, 'fill', 'offset', [0.5, 0.3]);
    expect(getElementShaderPaint(layer().element)!.parameters.offset).toEqual([0, 0.3]);
    expect(layer().animationTracks['fill.parameters.offset.x']![0]!.value).toBe(0.5);
  });
  it('can remove the last shader key and return the parameter to its default', () => {
    const { store, id, layer } = setup();
    const key = store.addLayerPropertyKeyframe(id, 'fill.parameters.yaw', 12);
    store.updateLayerPropertyKeyframeValue(id, 'fill.parameters.yaw', key, 500);
    expect(getLayerPropertyValueAtFrame(layer(), 'fill.parameters.yaw', 12)).toBe(90);
    store.removeLayerPropertyKeyframe(id, 'fill.parameters.yaw', key);
    expect(getResolvedLayerAnimationTracks(layer())['fill.parameters.yaw']).toBeUndefined();
    expect(getLayerPropertyValueAtFrame(layer(), 'fill.parameters.yaw', 12)).toBe(0);
  });
  it('clamps discrete loop keys and removes only the deleted paint slot animation', () => {
    const { store, id, layer } = setup();
    store.updateLayerTextStroke(id, 0, {
      strokePaint: createShaderPaint({ fragmentSource: source }),
    });
    store.setLayerLoop(id, { durationFrames: 50 });
    store.setLayerLoopPropertyTrack(id, 'fill.parameters.count', [
      createLayerPropertyKeyframe(0, 2.7),
      createLayerPropertyKeyframe(50, 9),
    ]);
    store.setLayerLoopPropertyTrack(id, 'strokePaint.parameters.yaw', [
      createLayerPropertyKeyframe(0, -20),
      createLayerPropertyKeyframe(50, 20),
    ]);
    expect(layer().loop!.tracks['fill.parameters.count']!.map((key) => key.value)).toEqual([3, 5]);
    store.removeShaderResource({
      compositionId: useProjectStore.getState().activeCompositionId,
      layerId: id,
      slot: 'fill',
    });
    expect(layer().loop!.tracks['fill.parameters.count']).toBeUndefined();
    expect(layer().loop!.tracks['strokePaint.parameters.yaw']).toHaveLength(2);
  });
  it('selects a loop-only property without inventing a lifecycle key', () => {
    const { id } = setup();
    useSelectionStore.getState().selectLayerProperty(id, 'fill.parameters.yaw');
    expect(useSelectionStore.getState()).toMatchObject({
      selectedLayerId: id,
      selectedLayerProperty: 'fill.parameters.yaw',
      selectedLayerKeyframeId: null,
      selectedLayerKeyframes: [],
    });
  });
});
