import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createFieldDefinition,
  createKeyframe,
  createLayerKeyframe,
  createLayerPropertyKeyframe,
  createLayerOfKind,
  createTransition,
  type Composition,
  type Layer,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from './compileDescriptor';

function compositionWith(layers: Layer[], overrides: Partial<Composition> = {}): Composition {
  const composition = createComposition({ layers, ...overrides });
  for (const layer of layers) {
    layer.keyframes = [createLayerKeyframe(0, POSE)];
  }
  return composition;
}

const POSE = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  transformOriginX: 0.5,
  transformOriginY: 0.5,
};

describe('compileDescriptor', () => {
  it('carries composition settings through to the descriptor', () => {
    const composition = compositionWith([], { width: 1280, height: 720, frameRate: 50 });
    const descriptor = compileDescriptor(composition);
    expect(descriptor.width).toBe(1280);
    expect(descriptor.height).toBe(720);
    expect(descriptor.frameRate).toBe(50);
  });

  it('excludes guide layers from the compiled output', () => {
    const normal = createLayerOfKind('rectangle');
    const guide = createLayerOfKind('rectangle');
    guide.isGuide = true;
    const descriptor = compileDescriptor(compositionWith([normal, guide]));
    expect(descriptor.layers.map((l) => l.id)).toEqual([normal.id]);
  });

  it('keeps authoring-only layout relationships out of the runtime descriptor', () => {
    const parent = createLayerOfKind('rectangle');
    const child = createLayerOfKind('text');
    parent.isLocked = true;
    parent.groupId = 'lower-third';
    child.groupId = 'lower-third';
    child.parentId = parent.id;
    child.constraints = { horizontal: 'right', vertical: 'bottom' };
    const composition = compositionWith([parent, child]);
    composition.layout.showTitleSafe = true;
    composition.layout.guides.push({ id: 'guide-v', axis: 'vertical', position: 960 });
    composition.layout.timelineFolders.push({
      id: 'folder-day-one',
      name: 'Day 1',
      color: '#7c6cff',
      layerIds: [parent.id, child.id],
    });

    const serialized = JSON.stringify(compileDescriptor(composition));

    expect(serialized).not.toContain('isLocked');
    expect(serialized).not.toContain('groupId');
    expect(serialized).not.toContain('parentId');
    expect(serialized).not.toContain('constraints');
    expect(serialized).not.toContain('showTitleSafe');
    expect(serialized).not.toContain('guide-v');
    expect(serialized).not.toContain('folder-day-one');
  });

  it('compiles only clipping parent relationships and preserves gradient paint', () => {
    const parent = createLayerOfKind('rectangle');
    const child = createLayerOfKind('rectangle');
    parent.clipChildren = true;
    child.parentId = parent.id;
    if (child.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    child.element.fill = {
      type: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: '#ffffff', opacity: 0.3 },
        { offset: 1, color: '#00133f', opacity: 0.4 },
      ],
    };

    const descriptor = compileDescriptor(compositionWith([parent, child]));

    expect(descriptor.layers[0]!.clipParentId).toBeNull();
    expect(descriptor.layers[1]!.clipParentId).toBe(parent.id);
    expect(descriptor.layers[1]!.element).toMatchObject({ fill: child.element.fill });
  });

  it('resolves a binding fieldId to the field key as dataKey', () => {
    const layer = createLayerOfKind('text');
    const field = createFieldDefinition('text', { key: 'headline', label: 'Headline' });
    layer.binding = { fieldId: field.id, targetProperty: 'content' };
    const descriptor = compileDescriptor(compositionWith([layer], { dataFields: [field] }));
    // The runtime only ever sees data keyed by the public field key, never internal field ids.
    expect(descriptor.layers[0]!.binding).toEqual({
      dataKey: 'headline',
      targetProperty: 'content',
    });
  });

  it('drops a binding whose field no longer exists', () => {
    const layer = createLayerOfKind('text');
    layer.binding = { fieldId: 'field-that-was-deleted', targetProperty: 'content' };
    const descriptor = compileDescriptor(compositionWith([layer], { dataFields: [] }));
    expect(descriptor.layers[0]!.binding).toBeNull();
  });

  it('preserves each layer independent animation key timing', () => {
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = [
      createLayerKeyframe(2, POSE),
      createLayerKeyframe(19, { ...POSE, x: 500 }, { easing: 'ease-out' }),
    ];
    const descriptor = compileDescriptor(createComposition({ layers: [layer] }));
    expect(descriptor.layers[0]!.keyframes.map((keyframe) => keyframe.frame)).toEqual([2, 19]);
    expect(descriptor.layers[0]!.keyframes[1]!.easing).toBe('ease-out');
  });

  it('carries layer effects into the runtime descriptor', () => {
    const layer = createLayerOfKind('text');
    layer.effects.blur = 2;
    layer.effects.dropShadowEnabled = true;
    const descriptor = compileDescriptor(compositionWith([layer]));
    expect(descriptor.layers[0]!.effects).toMatchObject({
      blur: 2,
      dropShadowEnabled: true,
    });
  });

  it('preserves independent property keys and custom curves in the runtime descriptor', () => {
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = [createLayerKeyframe(0, POSE)];
    layer.animationTracks.x = [
      createLayerPropertyKeyframe(0, 0),
      createLayerPropertyKeyframe(17, 500, {
        easing: 'linear',
        curve: { x1: 0.2, y1: 0.8, x2: 0.7, y2: 0.1 },
      }),
    ];

    const descriptor = compileDescriptor(createComposition({ layers: [layer] }));

    expect(descriptor.layers[0]!.animationTracks.x?.map((keyframe) => keyframe.frame)).toEqual([
      0, 17,
    ]);
    expect(descriptor.layers[0]!.animationTracks.x?.[1]?.curve).toEqual({
      x1: 0.2,
      y1: 0.8,
      x2: 0.7,
      y2: 0.1,
    });
  });

  it('compiles explicit lifecycle boundaries separately from pausable steps', () => {
    const start = createKeyframe({ name: 'Start', role: 'start' });
    const step = createKeyframe({ name: 'Step 1', role: 'step' });
    const end = createKeyframe({ name: 'End', role: 'end' });
    const composition = createComposition({
      keyframes: [start, step, end],
      transitions: [
        createTransition(start.id, step.id, { durationFrames: 10 }),
        createTransition(step.id, end.id, { durationFrames: 20 }),
      ],
    });
    const descriptor = compileDescriptor(composition);
    expect(descriptor.stepCount).toBe(1);
    expect(descriptor.stepKeyframeIds).toEqual([step.id]);
    expect(descriptor.startKeyframeId).toBe(start.id);
    expect(descriptor.endKeyframeId).toBe(end.id);
    expect(descriptor.keyframes.map((k) => k.frame)).toEqual([0, 10, 30]);
  });

  it('supports an explicit zero-step graphic', () => {
    const start = createKeyframe({ name: 'Start', role: 'start' });
    const end = createKeyframe({ name: 'End', role: 'end' });
    const descriptor = compileDescriptor(
      createComposition({
        keyframes: [start, end],
        transitions: [createTransition(start.id, end.id)],
      }),
    );
    expect(descriptor.stepCount).toBe(0);
    expect(descriptor.stepKeyframeIds).toEqual([]);
  });

  it('rejects a descriptor without both lifecycle boundaries', () => {
    const only = createKeyframe({ name: 'Step 1', role: 'step' });
    expect(() => compileDescriptor(createComposition({ keyframes: [only] }))).toThrow(
      /start and end/,
    );
  });
});
