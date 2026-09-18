import { beforeEach, describe, expect, it } from 'vitest';
import {
  effectProperty,
  getEffectStack,
  getLayerPropertyValueAtFrame,
  getLayerTransformAtFrame,
  type Layer,
  type AnimatableLayerProperty,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useTimelineStore } from './timelineStore';

const layerById = (id: string) =>
  useProjectStore.getState().project.compositions[0]!.layers.find((layer) => layer.id === id)!;
const keySignature = (layer: Layer) => ({
  aggregate: layer.keyframes.map(({ id, frame, easing }) => ({ id, frame, easing })),
  tracks: Object.fromEntries(
    Object.entries(layer.animationTracks).map(([property, keys]) => [
      property,
      keys?.map(({ id, frame, easing, curve }) => ({ id, frame, easing, curve })),
    ]),
  ),
  loops: Object.fromEntries(
    Object.entries(layer.loop?.tracks ?? {}).map(([property, keys]) => [
      property,
      keys?.map(({ id, frame, easing, curve }) => ({ id, frame, easing, curve })),
    ]),
  ),
});

describe('Auto-keyframe authoring', () => {
  beforeEach(() => useProjectStore.getState().newProject());

  it('keeps a static object static when transformed between keys with Auto-keyframe off', () => {
    expect(useTimelineStore.getState().autoKeyframe).toBe(false);
    const id = useProjectStore.getState().addLayer('rectangle');
    const before = keySignature(layerById(id));
    const pose = { x: 420, y: 210, width: 360, height: 220, rotation: 35, opacity: 0.6 };
    useProjectStore.getState().updateLayerTransform(id, 7, pose);
    const layer = layerById(id);
    expect(keySignature(layer)).toEqual(before);
    for (const frame of [0, 7, 12, 24])
      expect(getLayerTransformAtFrame(layer, frame)).toMatchObject(pose);
  });

  it('offsets existing parent, descendant and loop motion without inserting or retiming keys', () => {
    const store = useProjectStore.getState();
    const parent = store.addLayer('rectangle'),
      child = store.addLayer('text');
    store.setLayerParent(child, parent);
    useTimelineStore.getState().setAutoKeyframe(true);
    store.updateLayerTransform(parent, 12, { x: 280 });
    store.updateLayerTransform(child, 6, { x: 140 });
    store.setLayerLoop(child, { durationFrames: 10 });
    store.setLayerLoopPropertyTrack(child, 'x', [
      { id: 'loop-start', frame: 0, value: 100, easing: 'linear' },
      { id: 'loop-end', frame: 10, value: 160, easing: 'linear' },
    ]);
    const before = [parent, child].map((id) => structuredClone(layerById(id)));
    useTimelineStore.getState().setAutoKeyframe(false);
    const delta = 500 - getLayerTransformAtFrame(before[0]!, 6).x;
    store.updateLayerTransform(parent, 6, { x: 500 });
    for (const [index, id] of [parent, child].entries()) {
      const after = layerById(id),
        previous = before[index]!;
      expect(keySignature(after)).toEqual(keySignature(previous));
      for (const frame of [0, 6, 12, 24])
        expect(getLayerTransformAtFrame(after, frame).x).toBeCloseTo(
          getLayerTransformAtFrame(previous, frame).x + delta,
        );
    }
    expect(layerById(child).loop!.tracks.x!.map((key) => key.value)).toEqual([
      100 + delta,
      160 + delta,
    ]);
  });

  it.each([0, 7])('authors only the current frame %i while Auto-keyframe is enabled', (frame) => {
    const id = useProjectStore.getState().addLayer('rectangle');
    useTimelineStore.getState().setAutoKeyframe(true);
    useProjectStore.getState().updateLayerTransform(id, frame, { x: 500 });
    expect(
      layerById(id).animationTracks.x!.some((key) => key.frame === frame && key.value === 500),
    ).toBe(true);
    expect(getLayerTransformAtFrame(layerById(id), 12).x).toBe(100);
    const before = keySignature(layerById(id));
    useTimelineStore.getState().setAutoKeyframe(false);
    useProjectStore.getState().updateLayerTransform(id, 9, { x: 700 });
    expect(keySignature(layerById(id))).toEqual(before);
  });

  it('edits gradient stops, stroke width and effect parameters statically while disabled', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle'),
      textId = store.addLayer('text');
    const fill = {
      type: 'linear' as const,
      angle: 0,
      stops: [
        { offset: 0, color: '#000000', opacity: 1 },
        { offset: 0.5, color: '#ffffff', opacity: 1 },
      ],
    };
    store.updateLayerElement(id, { fill });
    store.addLayerEffect(id, 'blur');
    const effect = getEffectStack(layerById(id).effects).find(
      (item) => item.type === 'blur' && !item.legacy,
    )!;
    const before = keySignature(layerById(id)),
      textBefore = keySignature(layerById(textId));
    store.updateLayerPaint(id, 7, {
      ...fill,
      stops: [fill.stops[0]!, { ...fill.stops[1]!, offset: 0.8 }],
    });
    store.updateLayerTextStroke(textId, 7, { strokeWidth: 5 });
    store.updateLayerEffects(id, 7, { blur: 8 });
    store.updateLayerEffect(id, effect.id, { params: { radius: 12 } }, 7);
    const legacy = getEffectStack(layerById(id).effects).find((item) => item.legacy === 'blur')!;
    store.updateLayerEffect(id, legacy.id, { params: { radius: 9 } }, 7);
    expect(keySignature(layerById(id))).toEqual(before);
    expect(keySignature(layerById(textId))).toEqual(textBefore);
    for (const frame of [0, 7, 12, 24]) {
      expect(getLayerPropertyValueAtFrame(layerById(id), 'fill.stops[1].offset', frame)).toBe(0.8);
      expect(getLayerPropertyValueAtFrame(layerById(textId), 'strokeWidth', frame)).toBe(5);
      expect(getLayerPropertyValueAtFrame(layerById(id), 'blur', frame)).toBe(9);
      expect(
        getLayerPropertyValueAtFrame(
          layerById(id),
          effectProperty(effect, 'radius') as AnimatableLayerProperty,
          frame,
        ),
      ).toBe(12);
    }
  });

  it('keeps alignment and distribution static at nonzero frames', () => {
    const store = useProjectStore.getState();
    const ids = [0, 1, 2].map((index) => {
      const id = store.addLayer('rectangle');
      store.updateLayerTransform(id, 7, { x: [100, 400, 900][index]! });
      return id;
    });
    const before = ids.map((id) => keySignature(layerById(id)));
    store.distributeLayers(ids, 7, 'horizontal');
    store.alignLayers(ids, 7, 'left');
    ids.forEach((id, index) => {
      expect(keySignature(layerById(id))).toEqual(before[index]);
      for (const frame of [0, 7, 12, 24])
        expect(getLayerTransformAtFrame(layerById(id), frame).x).toBe(100);
    });
  });
});
