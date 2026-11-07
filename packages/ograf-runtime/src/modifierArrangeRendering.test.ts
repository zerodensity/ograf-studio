import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createDefaultTransform,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerModifier,
  createLayerOfKind,
  modifierProperty,
  layerModifiersErrors,
  type Layer,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from '@ograf-editor/codegen';
import { applyCompiledAutoLayout } from './autoLayoutRendering';
import { applyCompiledModifiers } from './modifierRendering';
import { sampleCompiledLayerVisualState } from './loopRendering';
import { expandRuntimeCollections } from './runtimeCollections';
import { applyCompiledMotionPaths } from './motionPathRendering';

function render(descriptor: ReturnType<typeof compileDescriptor>, frame = 0, data = {}) {
  const states = new Map(
    descriptor.layers.map((layer) => [
      layer.id,
      sampleCompiledLayerVisualState(layer, frame, undefined, data),
    ]),
  );
  applyCompiledMotionPaths(descriptor, states);
  applyCompiledAutoLayout(descriptor, states, data);
  applyCompiledModifiers(descriptor, states, data);
  return states;
}
function box(layer: Layer, x: number, y: number, width: number, height: number) {
  layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ x, y, width, height }))];
  return layer;
}

function cards(count: number) {
  const owner = box(createLayerOfKind('rectangle'), 100, 50, 1000, 200);
  owner.id = 'row';
  const items = Array.from({ length: count }, (_, index) => {
    const card = box(createLayerOfKind('rectangle'), 0, 0, 150, 200);
    card.id = `card${index}`;
    card.parentId = owner.id;
    return card;
  });
  const label = box(createLayerOfKind('text'), 10, 170, 100, 20);
  label.id = 'label';
  label.parentId = 'card0';
  owner.modifiers = [
    createLayerModifier('grid-arrange', { columns: 6, spreadX: 160 }, { id: 'grid' }),
    createLayerModifier('justify', { horizontal: 'center' }, { id: 'justify' }),
  ];
  return { owner, items, label };
}

describe('compiled arrange modifiers', () => {
  it('keeps the authoring hierarchy only when an arrange modifier needs it', () => {
    const { owner, items, label } = cards(3);
    const descriptor = compileDescriptor(createComposition({ layers: [owner, ...items, label] }));
    expect(descriptor.layers.find((layer) => layer.id === 'label')!.modifierParentId).toBe('card0');
    owner.modifiers = [];
    const plain = compileDescriptor(createComposition({ layers: [owner, ...items, label] }));
    expect(plain.layers.some((layer) => 'modifierParentId' in layer)).toBe(false);
  });

  it('arranges, justifies and moves nested artwork in exported playback; data can hide a card', () => {
    const { owner, items, label } = cards(4);
    const field = createFieldDefinition('number', { key: 'columns', defaultValue: 6 });
    owner.bindings = [{ fieldId: field.id, targetProperty: modifierProperty('grid', 'columns') }];
    items[3]!.isVisible = false;
    const descriptor = compileDescriptor(
      createComposition({ layers: [owner, ...items, label], dataFields: [field] }),
    );
    const states = render(descriptor);
    // Three visible cards span 2 * 160 + 150 = 470px, centered in the 1000px row from x = 100.
    expect(['card0', 'card1', 'card2'].map((id) => states.get(id)!.transform.x)).toEqual([
      365, 525, 685,
    ]);
    expect(states.get('card0')!.transform.y).toBe(50);
    expect(states.get('label')!.transform).toMatchObject({ x: 375, y: 220 });
    const twoColumns = render(descriptor, 0, { columns: 2 });
    expect(twoColumns.get('card2')!.transform).toMatchObject({ x: 445, y: 150 });
  });

  it('arranges expanded runtime collection rows under a container outside the collection', () => {
    const { owner, items } = cards(1);
    const field = createFieldDefinition('array', {
      key: 'people',
      defaultValue: [],
      items: createFieldDefinition('object', {
        key: 'person',
        properties: [createFieldDefinition('text', { key: 'name' })],
      }),
    });
    owner.modifiers = [
      createLayerModifier('grid-arrange', { columns: 1, spreadY: 60 }, { id: 'grid' }),
    ];
    const composition = createComposition({ layers: [owner, ...items], dataFields: [field] });
    composition.runtimeCollections = [
      {
        id: 'people',
        name: 'People',
        fieldId: field.id,
        prototypeLayerIds: ['card0'],
        offsetPerItem: { x: 0, y: 0 },
        capacity: 3,
        overflow: 'truncate',
        itemKeyPath: [],
        sortPath: [],
        sortDirection: 'none',
        pageSize: 0,
        page: 0,
      },
    ];
    const descriptor = expandRuntimeCollections(compileDescriptor(composition));
    const states = render(descriptor, 0, { people: [{ name: 'A' }, { name: 'B' }] });
    expect(states.get('people::0::card0')!.transform).toMatchObject({ x: 100, y: 50 });
    expect(states.get('people::1::card0')!.transform).toMatchObject({ x: 100, y: 110 });
    expect(states.get('people::2::card0')!.isVisible).toBe(false);
  });

  it('places radial children, rotates Look At owners and adds Spline Path base orientation', () => {
    const hub = box(createLayerOfKind('ellipse'), 0, 0, 200, 200);
    hub.id = 'hub';
    hub.modifiers = [
      createLayerModifier('radial-arrange', { innerRadius: 100, orient: true }, { id: 'radial' }),
    ];
    const spokes = [0, 1].map((index) => {
      const spoke = box(createLayerOfKind('rectangle'), 0, 0, 20, 20);
      spoke.id = `spoke${index}`;
      spoke.parentId = hub.id;
      return spoke;
    });
    const arrow = box(createLayerOfKind('rectangle'), 500, 500, 100, 20);
    arrow.id = 'arrow';
    arrow.modifiers = [
      createLayerModifier('look-at', { source: { kind: 'layer', layerId: 'spoke1' } }),
    ];
    const path = box(createLayerOfKind('path'), 0, 400, 100, 100);
    path.id = 'path';
    if (path.element.type !== 'path') throw new Error('fixture');
    path.element = { ...path.element, d: 'M0 0 L100 0', viewBoxWidth: 100, viewBoxHeight: 100 };
    const rider = box(createLayerOfKind('rectangle'), 0, 0, 10, 10);
    rider.id = 'rider';
    rider.motionPath = {
      sourceLayerId: 'path',
      progress: 0.5,
      orientToPath: true,
      offsetX: 0,
      offsetY: 0,
      rotationOffset: 21,
    };
    const states = render(
      compileDescriptor(createComposition({ layers: [hub, ...spokes, arrow, path, rider] })),
    );
    expect(states.get('spoke0')!.transform).toMatchObject({ x: 190, y: 90, rotation: 0 });
    const spoke = states.get('spoke1')!.transform;
    expect([spoke.x, spoke.y, spoke.rotation].map(Math.round)).toEqual([-10, 90, 180]);
    // Arrow pivot (550, 510) faces the spoke centered at (0, 100).
    expect(states.get('arrow')!.transform.rotation).toBeCloseTo(
      (Math.atan2(100 - 510, 0 - 550) * 180) / Math.PI,
    );
    expect(states.get('rider')!.transform).toMatchObject({ x: 45, y: 395, rotation: 21 });
  });

  it('orients a Spline rider along a nonuniformly stretched path on repeated backward seeks', () => {
    const path = box(createLayerOfKind('path'), 0, 400, 200, 100);
    path.id = 'path';
    if (path.element.type !== 'path') throw new Error('fixture');
    path.element = { ...path.element, d: 'M0 0 L100 100', viewBoxWidth: 100, viewBoxHeight: 100 };
    const rider = box(createLayerOfKind('rectangle'), 0, 0, 10, 10);
    rider.id = 'rider';
    rider.motionPath = {
      sourceLayerId: path.id,
      progress: 0,
      orientToPath: true,
      offsetX: 0,
      offsetY: 0,
      rotationOffset: 21,
    };
    rider.animationTracks.motionPathProgress = [
      { id: 'start', frame: 0, value: 0, easing: 'linear' },
      { id: 'end', frame: 10, value: 1, easing: 'linear' },
    ];
    const descriptor = compileDescriptor(createComposition({ layers: [path, rider] }));
    for (const frame of [0, 10, 3, 0, 10, 0]) {
      const transform = render(descriptor, frame).get('rider')!.transform;
      expect(transform.rotation).toBeCloseTo((Math.atan2(100, 200) * 180) / Math.PI + 21);
      expect(transform.x).toBeCloseTo(frame * 20 - 5);
      expect(transform.y).toBeCloseTo(395 + frame * 10);
    }
  });

  it('resolves an arranged source path before its rider and consumers, preserving offsets and pivots', () => {
    const owner = box(createLayerOfKind('rectangle'), 300, 200, 500, 300);
    owner.id = 'owner';
    owner.modifiers = [createLayerModifier('grid-arrange', { columns: 1 })];
    const path = box(createLayerOfKind('path'), 0, 0, 200, 100);
    path.id = 'path';
    path.parentId = owner.id;
    if (path.element.type !== 'path') throw new Error('fixture');
    path.element = { ...path.element, d: 'M0 0 L100 100', viewBoxWidth: 100, viewBoxHeight: 100 };
    const rider = box(createLayerOfKind('rectangle'), 0, 0, 20, 10);
    rider.id = 'rider';
    rider.keyframes[0]!.transform.transformOriginX = 0.25;
    rider.keyframes[0]!.transform.transformOriginY = 0.75;
    rider.motionPath = {
      sourceLayerId: path.id,
      progress: 0.5,
      orientToPath: true,
      offsetX: 17,
      offsetY: -9,
      rotationOffset: 21,
    };
    owner.animationTracks.x = [
      { id: 'start', frame: 0, value: 300, easing: 'linear' },
      { id: 'end', frame: 10, value: 500, easing: 'linear' },
    ];
    const arrow = box(createLayerOfKind('rectangle'), 0, 0, 10, 10);
    arrow.id = 'arrow';
    arrow.modifiers = [
      createLayerModifier('look-at', { source: { kind: 'layer', layerId: rider.id } }),
    ];
    // Paint order intentionally runs opposite to the geometry dependencies.
    const descriptor = compileDescriptor(
      createComposition({ layers: [arrow, rider, path, owner] }),
    );
    const initial = structuredClone(descriptor);
    for (const frame of [10, 0, 5, 10, 0]) {
      const states = render(descriptor, frame);
      const transform = states.get('rider')!.transform;
      const x = 412 + frame * 20;
      expect(transform.x).toBeCloseTo(x);
      expect(transform.y).toBeCloseTo(233.5);
      expect(transform.rotation).toBeCloseTo((Math.atan2(100, 200) * 180) / Math.PI + 21);
      // An off-center pivot means the final rotated rider AABB center differs from its origin.
      const radians = (transform.rotation * Math.PI) / 180;
      const cx = x + 5 + 5 * Math.cos(radians) + 2.5 * Math.sin(radians);
      const cy = 241 + 5 * Math.sin(radians) - 2.5 * Math.cos(radians);
      expect(states.get('arrow')!.transform.rotation).toBeCloseTo(
        (Math.atan2(cy - 5, cx - 5) * 180) / Math.PI,
      );
    }
    expect(descriptor).toEqual(initial);
  });

  it('rejects a Spline and modifier dependency cycle before sampling unresolved geometry', () => {
    const path = box(createLayerOfKind('path'), 0, 0, 100, 100);
    path.id = 'path';
    path.modifiers = [
      createLayerModifier('auto-follow', { source: { kind: 'layer', layerId: 'rider' } }),
    ];
    const rider = box(createLayerOfKind('rectangle'), 0, 0, 10, 10);
    rider.id = 'rider';
    rider.motionPath = {
      sourceLayerId: path.id,
      progress: 0.5,
      orientToPath: false,
      offsetX: 0,
      offsetY: 0,
    };
    const composition = createComposition({ layers: [path, rider] });
    expect(layerModifiersErrors(composition.layers).join(' ')).toMatch(/cycle/);
    expect(() => render(compileDescriptor(composition))).toThrow(/cycle/);
  });

  it('uses the source path rotation from Look At in the same frame', () => {
    const path = box(createLayerOfKind('path'), 0, 0, 200, 100);
    path.id = 'path';
    if (path.element.type !== 'path') throw new Error('fixture');
    path.element = { ...path.element, d: 'M0 0 L100 100', viewBoxWidth: 100, viewBoxHeight: 100 };
    path.modifiers = [
      createLayerModifier('look-at', { source: { kind: 'layer', layerId: 'anchor' } }),
    ];
    const anchor = box(createLayerOfKind('rectangle'), 90, 140, 20, 20);
    anchor.id = 'anchor';
    const rider = box(createLayerOfKind('rectangle'), 0, 0, 10, 10);
    rider.id = 'rider';
    rider.motionPath = {
      sourceLayerId: path.id,
      progress: 1,
      orientToPath: true,
      offsetX: 0,
      offsetY: 0,
      rotationOffset: 21,
    };
    const descriptor = compileDescriptor(createComposition({ layers: [rider, path, anchor] }));
    const transform = render(descriptor).get('rider')!.transform;
    expect(transform.x).toBeCloseTo(45);
    expect(transform.y).toBeCloseTo(145);
    expect(transform.rotation).toBeCloseTo((Math.atan2(100, 200) * 180) / Math.PI + 90 + 21);
  });
});
