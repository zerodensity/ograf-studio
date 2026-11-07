import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  defaultTransformForRole,
  createDefaultGradient,
  effectProperty,
  findLayerPropertyKeyframeAtFrame,
  getLayerPropertyValueAtFrame,
  getEffectStack,
  getLayerTransformAtFrame,
  getTotalFrames,
  isLayerPropertyAnimated,
  migrateProject,
  TRANSFORM_ANIMATION_PROPERTIES,
  EFFECT_ANIMATION_PROPERTIES,
  type AnimatableLayerProperty,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { useProjectStore } from './projectStore';
import { useTimelineStore } from './timelineStore';
import { useCanvasViewStore } from './canvasViewStore';

const composition = () => useProjectStore.getState().project.compositions[0]!;
const layerById = (id: string) => composition().layers.find((layer) => layer.id === id)!;

describe('opt-in property animation', () => {
  beforeEach(() => {
    useCanvasViewStore.getState().setMode('animate');
    useProjectStore.getState().newProject();
  });

  it.each([0, 7])('keys only transform channels at frame %i when effects are excluded', (frame) => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.updateLayerEffects(id, 0, { blur: 6, dropShadowOpacity: 0.6, dropShadowOffsetX: 12 });
    const pose = getLayerTransformAtFrame(layerById(id), frame);
    const keyId = store.addLayerKeyframe(id, frame, { includeEffects: false });
    expect(layerById(id).keyframes.find((key) => key.id === keyId)?.frame).toBe(frame);
    expect(Object.keys(layerById(id).animationTracks).sort()).toEqual(
      [...TRANSFORM_ANIMATION_PROPERTIES].sort(),
    );
    for (const property of TRANSFORM_ANIMATION_PROPERTIES)
      expect(layerById(id).animationTracks[property]).toMatchObject([
        { frame, value: pose[property] },
      ]);
    for (const property of EFFECT_ANIMATION_PROPERTIES) {
      expect(layerById(id).animationTracks[property]).toBeUndefined();
      expect(isLayerPropertyAnimated(layerById(id), property)).toBe(false);
    }
    expect(getLayerPropertyValueAtFrame(layerById(id), 'blur', 100)).toBe(6);
    expect(getLayerPropertyValueAtFrame(layerById(id), 'dropShadowOpacity', 100)).toBe(0.6);
  });

  it('keeps the historical full-pose API default of capturing effect channels', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.updateLayerEffects(id, 0, { blur: 6, dropShadowOpacity: 0.6 });
    store.addLayerKeyframe(id, 7);
    for (const property of EFFECT_ANIMATION_PROPERTIES)
      expect(layerById(id).animationTracks[property]?.some((key) => key.frame === 7)).toBe(true);
    expect(layerById(id).animationTracks.blur).toMatchObject([{ frame: 7, value: 6 }]);
    expect(layerById(id).animationTracks.dropShadowOpacity).toMatchObject([
      { frame: 7, value: 0.6 },
    ]);
  });

  it.each(['rectangle', 'ellipse', 'text', 'image', 'path', 'pattern', 'lottie'] as const)(
    'inserts a static %s without making lifecycle markers into property keys',
    (kind) => {
      const id = useProjectStore.getState().addLayer(kind);
      const layer = layerById(id);
      expect(composition().keyframes.map((key) => key.role)).toEqual(['start', 'step', 'end']);
      expect(layer.animationTrackMode).toBe('independent');
      expect(layer.animationTracks).toEqual({});
      expect(layer.keyframes.map((key) => key.frame)).toEqual([0]);
      expect(isLayerPropertyAnimated(layer, 'x')).toBe(false);
      expect(findLayerPropertyKeyframeAtFrame(layer, 'x', 0)).toBeUndefined();
      expect(getLayerTransformAtFrame(layer, getTotalFrames(composition()))).toEqual(
        getLayerTransformAtFrame(layer, 0),
      );
    },
  );

  it('enables only the requested property at its sampled value with Auto off', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.updateLayerTransform(id, 7, { x: 420, width: 380 });
    const keyId = store.enableLayerPropertyAnimation(id, 'x', 7);
    expect(layerById(id).animationTracks).toMatchObject({
      x: [{ id: keyId, frame: 7, value: 420 }],
    });
    expect(Object.keys(layerById(id).animationTracks)).toEqual(['x']);
    expect(isLayerPropertyAnimated(layerById(id), 'width')).toBe(false);
    expect(store.enableLayerPropertyAnimation(id, 'x', 7)).toBe(keyId);
    expect(layerById(id).animationTracks.x).toHaveLength(1);
  });

  it('keys an enabled property at the playhead even with Auto off and leaves static channels static', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.enableLayerPropertyAnimation(id, 'x', 0);
    store.updateLayerTransform(id, 18, { x: 700, width: 420 });
    expect(layerById(id).animationTracks.x?.map(({ frame, value }) => ({ frame, value }))).toEqual([
      { frame: 0, value: 100 },
      { frame: 18, value: 700 },
    ]);
    expect(layerById(id).animationTracks.width).toBeUndefined();
    expect(getLayerTransformAtFrame(layerById(id), 0)).toMatchObject({ x: 100, width: 420 });
    for (const frame of [18, 30, getTotalFrames(composition())])
      expect(getLayerTransformAtFrame(layerById(id), frame)).toMatchObject({ x: 700, width: 420 });
  });

  it('seeds only the baseline and edited frame on the first later Auto edit, then holds through End', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    useTimelineStore.getState().setAutoKeyframe(true);
    store.updateLayerTransform(id, 8, { x: 300 });
    expect(layerById(id).animationTracks.x?.map(({ frame, value }) => ({ frame, value }))).toEqual([
      { frame: 0, value: 100 },
      { frame: 8, value: 300 },
    ]);
    expect(Object.keys(layerById(id).animationTracks)).toEqual(['x']);
    store.updateLayerTransform(id, 20, { x: 500 });
    const result = layerById(id);
    expect(result.animationTracks.x?.map((key) => key.frame)).toEqual([0, 8, 20]);
    expect(getLayerPropertyValueAtFrame(result, 'x', 4)).toBe(200);
    expect(getLayerPropertyValueAtFrame(result, 'x', getTotalFrames(composition()))).toBe(500);
    const compiled = compileDescriptor(composition()).layers.find((layer) => layer.id === id)!;
    expect(compiled.animationTracks.x?.map((key) => key.frame)).toEqual([0, 8, 20]);
    expect(compiled.animationTracks.y).toMatchObject([{ frame: 0, value: 100 }]);
    expect(compiled).not.toHaveProperty('animationTrackMode');
  });

  it('keeps a static child attached when an enabled parent position is keyed with Auto off', () => {
    const store = useProjectStore.getState();
    const parent = store.addLayer('rectangle');
    const child = store.addLayer('text', { x: 160, y: 180 });
    store.setLayerParent(child, parent);
    store.enableLayerPropertyAnimation(parent, 'x', 0);
    store.updateLayerTransform(parent, 18, { x: 700 });
    expect(
      layerById(child).animationTracks.x?.map(({ frame, value }) => ({ frame, value })),
    ).toEqual([
      { frame: 0, value: 160 },
      { frame: 18, value: 760 },
    ]);
    expect(Object.keys(layerById(child).animationTracks)).toEqual(['x']);
    for (const frame of [0, 9, 18, 100]) {
      const parentPose = getLayerTransformAtFrame(layerById(parent), frame);
      const childPose = getLayerTransformAtFrame(layerById(child), frame);
      expect(childPose.x - parentPose.x).toBeCloseTo(60);
      expect(childPose.y).toBe(180);
    }
  });

  it('offsets a child whole curve when its unanimated parent is moved statically', () => {
    const store = useProjectStore.getState();
    const parent = store.addLayer('rectangle');
    const child = store.addLayer('text', { x: 160, y: 180 });
    store.setLayerParent(child, parent);
    store.enableLayerPropertyAnimation(child, 'x', 0);
    store.updateLayerTransform(child, 18, { x: 300 });
    store.updateLayerTransform(parent, 9, { x: 500 });
    expect(layerById(parent).animationTracks).toEqual({});
    expect(
      layerById(child).animationTracks.x?.map(({ frame, value }) => ({ frame, value })),
    ).toEqual([
      { frame: 0, value: 560 },
      { frame: 18, value: 700 },
    ]);
  });

  it('holds the edited value at frame zero without creating later return keys', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    useTimelineStore.getState().setAutoKeyframe(true);
    store.updateLayerTransform(id, 0, { x: 900 });
    expect(layerById(id).animationTracks.x).toHaveLength(1);
    expect(getLayerTransformAtFrame(layerById(id), 100).x).toBe(900);
  });

  it('removes the final transform key by freezing its sampled value, without re-enabling on reload', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.enableLayerPropertyAnimation(id, 'opacity', 7);
    store.updateLayerTransform(id, 7, { opacity: 0.35 });
    expect(store.toggleLayerPropertyKeyframe(id, 'opacity', 7)).toBeNull();
    expect(layerById(id).animationTracks.opacity).toBeUndefined();
    expect(isLayerPropertyAnimated(layerById(id), 'opacity')).toBe(false);
    for (const frame of [0, 7, 20, getTotalFrames(composition())])
      expect(getLayerTransformAtFrame(layerById(id), frame).opacity).toBe(0.35);
    const saved = JSON.parse(JSON.stringify(useProjectStore.getState().project));
    store.loadProject(saved);
    expect(layerById(id).animationTracks).toEqual({});
    expect(getLayerTransformAtFrame(layerById(id), 100).opacity).toBe(0.35);
  });

  it('preserves sparse channels through normalization and compiles constant fallback channels', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.enableLayerPropertyAnimation(id, 'x', 5);
    store.updateLayerTransform(id, 22, { x: 600 });
    const saved = migrateProject(JSON.parse(JSON.stringify(useProjectStore.getState().project)));
    const layer = saved.compositions[0]!.layers.find((candidate) => candidate.id === id)!;
    expect(Object.keys(layer.animationTracks)).toEqual(['x']);
    expect(layer.animationTracks.x?.map((key) => key.frame)).toEqual([5, 22]);
    expect(getLayerTransformAtFrame(layer, 125).x).toBe(600);
    expect(isLayerPropertyAnimated(layer, 'y')).toBe(false);
  });

  it('applies the same playhead policy to gradient stops, text stroke and both effect interfaces', () => {
    const store = useProjectStore.getState();
    const shape = store.addLayer('rectangle');
    const text = store.addLayer('text');
    const gradient = createDefaultGradient();
    store.updateLayerElement(shape, { fill: gradient });
    store.addLayerEffect(shape, 'blur');
    const effect = getEffectStack(layerById(shape).effects).find(
      (entry) => entry.type === 'blur' && !entry.legacy,
    )!;
    const radius = effectProperty(effect, 'radius') as AnimatableLayerProperty;
    const oldRadius = getLayerPropertyValueAtFrame(layerById(shape), radius, 0);
    store.enableLayerPropertyAnimation(shape, 'fill.stops[1].offset', 0);
    store.enableLayerPropertyAnimation(shape, 'blur', 0);
    store.enableLayerPropertyAnimation(shape, radius, 0);
    store.enableLayerPropertyAnimation(text, 'strokeWidth', 0);
    store.updateLayerPaint(shape, 10, {
      ...gradient,
      stops: [gradient.stops[0]!, { ...gradient.stops[1]!, offset: 0.7 }],
    });
    store.updateLayerEffects(shape, 10, { blur: 6 });
    store.updateLayerEffect(shape, effect.id, { params: { radius: 12 } }, 10);
    store.updateLayerTextStroke(text, 10, { strokeWidth: 5 });
    expect(getLayerPropertyValueAtFrame(layerById(shape), 'fill.stops[1].offset', 0)).toBe(1);
    expect(getLayerPropertyValueAtFrame(layerById(shape), 'fill.stops[1].offset', 10)).toBe(0.7);
    expect(getLayerPropertyValueAtFrame(layerById(shape), 'blur', 0)).toBe(0);
    expect(getLayerPropertyValueAtFrame(layerById(shape), 'blur', 10)).toBe(6);
    expect(getLayerPropertyValueAtFrame(layerById(shape), radius, 0)).toBe(oldRadius);
    expect(getLayerPropertyValueAtFrame(layerById(shape), radius, 10)).toBe(12);
    expect(getLayerPropertyValueAtFrame(layerById(text), 'strokeWidth', 0)).toBe(0);
    expect(getLayerPropertyValueAtFrame(layerById(text), 'strokeWidth', 10)).toBe(5);
    expect(layerById(shape).animationTracks.x).toBeUndefined();
  });

  it('preserves explicitly authored legacy Step and End keys when loading older templates', () => {
    const project = createProject();
    const legacy = createLayerOfKind('rectangle');
    const base = defaultTransformForRole('rectangle', 'step');
    legacy.keyframes = [0, 12, 24].map((frame) =>
      createLayerKeyframe(frame, { ...base, x: frame === 12 ? 500 : 100 }),
    );
    legacy.animationTracks = {};
    project.compositions[0]!.layers.push(legacy);
    useProjectStore.getState().loadProject(project);
    const loaded = layerById(legacy.id);
    expect(loaded.animationTrackMode).toBeUndefined();
    expect(loaded.animationTracks.x?.map((key) => key.frame)).toEqual([0, 12, 24]);
    expect(isLayerPropertyAnimated(loaded, 'x')).toBe(true);
    expect(getLayerTransformAtFrame(loaded, 24).x).toBe(100);
  });

  it('does not turn static channels into animation while resizing the composition or applying Fade', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    store.updateCompositionSettings({ width: 1280, height: 720 });
    expect(layerById(id).animationTracks).toEqual({});
    store.setLayerMotion(id, 'in', { style: 'fade', durationFrames: 8 });
    expect(Object.keys(layerById(id).animationTracks)).toEqual(['opacity']);
    expect(isLayerPropertyAnimated(layerById(id), 'x')).toBe(false);
  });

  it('duplicates static and animated channels without enabling unrelated properties', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    const [staticCopy] = store.duplicateLayers([id]);
    expect(layerById(staticCopy!).animationTracks).toEqual({});
    store.enableLayerPropertyAnimation(id, 'x', 0);
    store.updateLayerTransform(id, 10, { x: 700 });
    const [animatedCopy] = store.duplicateLayers([id]);
    expect(Object.keys(layerById(animatedCopy!).animationTracks)).toEqual(['x']);
    expect(layerById(animatedCopy!).animationTracks.x?.map((key) => key.frame)).toEqual([0, 10]);
    expect(layerById(animatedCopy!).animationTracks.x?.map((key) => key.id)).not.toEqual(
      layerById(id).animationTracks.x?.map((key) => key.id),
    );
  });

  it('resets virtual reveal channels to neutral when their final key is removed', () => {
    const store = useProjectStore.getState();
    const id = store.addLayer('rectangle');
    const key = store.enableLayerPropertyAnimation(id, 'clipLeft', 0);
    store.updateLayerPropertyKeyframeValue(id, 'clipLeft', key, 0.4);
    expect(getLayerPropertyValueAtFrame(layerById(id), 'clipLeft', 10)).toBe(0.4);
    store.removeLayerPropertyKeyframe(id, 'clipLeft', key);
    expect(getLayerPropertyValueAtFrame(layerById(id), 'clipLeft', 10)).toBe(0);
    expect(isLayerPropertyAnimated(layerById(id), 'clipLeft')).toBe(false);
  });

  it('keeps linked components sparse while allowing a static instance override and independent animation', () => {
    const store = useProjectStore.getState();
    const source = store.addLayer('rectangle');
    const componentId = store.createComponent([source], 'Static component')!;
    const [copy] = store.instantiateComponent(componentId, { x: 40, y: 40 });
    expect(layerById(source).animationTracks).toEqual({});
    expect(layerById(copy!).animationTracks).toEqual({});
    store.updateLayerTransform(copy!, 0, { x: 800 });
    expect(getLayerTransformAtFrame(layerById(copy!), 0).x).toBe(800);
    const definition = composition().components.find((component) => component.id === componentId)!;
    const master = definition.layers[0]!;
    store.updateComponentLayer(componentId, master.id, { name: 'Updated source' });
    expect(getLayerTransformAtFrame(layerById(copy!), 0).x).toBe(800);
    expect(layerById(copy!).animationTracks).toEqual({});
    store.enableLayerPropertyAnimation(copy!, 'x', 0);
    store.updateLayerTransform(copy!, 10, { x: 1000 });
    expect(layerById(copy!).animationTracks.x?.map((key) => key.frame)).toEqual([0, 10]);
    expect(isLayerPropertyAnimated(layerById(source), 'x')).toBe(false);
  });
});
