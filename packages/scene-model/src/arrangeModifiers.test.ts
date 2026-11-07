import { describe, expect, it } from 'vitest';
import {
  addLayerModifier,
  createLayerModifier,
  evaluateLayerModifiers,
  layerModifiersErrors,
  modifierStackErrors,
  modifierTransformBounds,
  remapLayerModifierReferences,
  type ModifierLayerNode,
  type ModifierVisualState,
} from './modifiers';
import { attachTransformToMotionPath } from './motionPath';
import { createDefaultTransform, createLayerOfKind } from './factory';
import type { Layer, LayerModifier, LayerTransform, PathElement } from './types';

function node(id: string, parentId: string | null = null, modifiers: LayerModifier[] = []) {
  const layer = createLayerOfKind('rectangle');
  layer.id = id;
  layer.name = id;
  layer.parentId = parentId;
  layer.modifiers = modifiers;
  return layer;
}
function statesFor(
  layers: readonly Layer[],
  transforms: Record<string, Partial<LayerTransform>>,
  hidden: readonly string[] = [],
): Map<string, ModifierVisualState> {
  return new Map(
    layers.map((layer) => [
      layer.id,
      {
        transform: createDefaultTransform({
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          ...transforms[layer.id],
        }),
        element: layer.element,
        isVisible: !hidden.includes(layer.id),
      },
    ]),
  );
}
const position = (states: Map<string, ModifierVisualState>, id: string) => {
  const transform = states.get(id)!.transform;
  return [Math.round(transform.x * 1000) / 1000, Math.round(transform.y * 1000) / 1000];
};

describe('Grid Arrange', () => {
  const grid = (params: Record<string, unknown>) =>
    createLayerModifier('grid-arrange', { spreadX: 120, spreadY: 60, ...params }, { id: 'grid' });
  function scene(params: Record<string, unknown>, hidden: string[] = []) {
    const owner = node('owner', null, [grid(params)]);
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => node(id, 'owner'));
    const label = node('label', 'a');
    const layers = [owner, ...items, label];
    const states = statesFor(
      layers,
      { owner: { x: 10, y: 20, width: 400, height: 300 }, label: { x: 5, y: 5, width: 20 } },
      hidden,
    );
    return { layers, states };
  }

  it('fills rows from the top-left with a cell pitch and moves descendants rigidly', () => {
    const { layers, states } = scene({ columns: 2 });
    const result = evaluateLayerModifiers({ layers, states }).states;
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => position(result, id))).toEqual([
      [10, 20],
      [130, 20],
      [10, 80],
      [130, 80],
      [10, 140],
    ]);
    expect(position(result, 'label')).toEqual([15, 25]);
    // Authored source poses are never rewritten.
    expect(position(states, 'a')).toEqual([0, 0]);
  });

  it('supports start corners, column-first fill, capacity and hidden children', () => {
    const { layers, states } = scene(
      { columns: 2, rows: 2, startCorner: 'bottom-right', direction: 'vertical' },
      ['b'],
    );
    const result = evaluateLayerModifiers({ layers, states }).states;
    // Visible items a, c, d and e fill down the columns from the bottom-right corner.
    expect(position(result, 'a')).toEqual([130, 80]);
    expect(position(result, 'c')).toEqual([130, 20]);
    expect(position(result, 'd')).toEqual([10, 80]);
    expect(position(result, 'e')).toEqual([10, 20]);
    expect(result.get('b')!.isVisible).toBe(false);
    const limited = scene({ columns: 2, rows: 1 });
    const overflow = evaluateLayerModifiers(limited).states;
    expect(['c', 'd', 'e'].map((id) => overflow.get(id)!.isVisible)).toEqual([false, false, false]);
    // Capacity overflow hides nested artwork too; a manually hidden child is simply skipped.
    const reversed = scene({ columns: 1, rows: 1, startCorner: 'top-right' }, ['b']);
    reversed.layers.find((layer) => layer.id === 'label')!.parentId = 'c';
    const single = evaluateLayerModifiers(reversed).states;
    expect(single.get('c')!.isVisible).toBe(false);
    expect(single.get('label')!.isVisible).toBe(false);
    expect(position(single, 'a')).toEqual([10, 20]);
  });

  it('re-centers the visible arrangement with a following Justify', () => {
    const owner = node('owner', null, [
      grid({ columns: 5 }),
      createLayerModifier('justify', { horizontal: 'center' }, { id: 'justify' }),
    ]);
    const items = ['a', 'b', 'c'].map((id) => node(id, 'owner'));
    const layers = [owner, ...items];
    const states = statesFor(layers, { owner: { x: 0, y: 0, width: 1000, height: 100 } });
    const result = evaluateLayerModifiers({ layers, states }).states;
    // Three cells span 2 * 120 + 100 = 340px, centered in a 1000px box.
    expect(position(result, 'a')).toEqual([330, 0]);
    expect(position(result, 'c')).toEqual([570, 0]);
    states.get('c')!.isVisible = false;
    const fewer = evaluateLayerModifiers({ layers, states }).states;
    expect(position(fewer, 'a')).toEqual([390, 0]);
    expect(position(fewer, 'b')).toEqual([510, 0]);
  });

  it('validates its settings and conflicts', () => {
    expect(
      modifierStackErrors([
        { ...grid({}), params: { ...grid({}).params, startCorner: 'middle' } },
      ]).join(' '),
    ).toMatch(/startCorner/);
    const owner = node('owner', null, [grid({})]);
    owner.autoLayout = { ...owner.autoLayout, direction: 'horizontal' };
    expect(layerModifiersErrors([owner, node('a', 'owner')]).join(' ')).toMatch(/Auto Layout/);
    const follower = node('a', 'owner', [
      createLayerModifier('auto-follow', { source: { kind: 'layer', layerId: 'b' } }),
    ]);
    expect(
      layerModifiersErrors([node('owner', null, [grid({})]), follower, node('b')]).join(' '),
    ).toMatch(/conflicting modifier drivers/);
  });

  it('runs a descendant driver after the rigid move', () => {
    const owner = node('owner', null, [grid({ columns: 1 })]);
    const item = node('a', 'owner');
    const badge = node('badge', 'a', [
      createLayerModifier('auto-follow', {
        source: { kind: 'layer', layerId: 'a' },
        axisY: false,
        sourceAnchorX: 1,
        targetAnchorX: 0,
      }),
    ]);
    const layers = [badge, owner, item];
    const states = statesFor(layers, { owner: { x: 300, y: 0 }, badge: { width: 10 } });
    const result = evaluateLayerModifiers({ layers, states }).states;
    expect(position(result, 'a')).toEqual([300, 0]);
    expect(position(result, 'badge')).toEqual([400, 0]);
  });

  it('places scaled rotated children using visual world bounds without scaling the grid pitch', () => {
    const owner = node('owner', null, [grid({ columns: 2, spreadX: 120 })]);
    const first = node('first', 'owner'),
      second = node('second', 'owner');
    const layers = [owner, first, second];
    const states = statesFor(layers, {
      owner: { x: 100, y: 100, width: 400, height: 200, rotation: 90 },
      first: { width: 40, height: 20, rotation: 90 },
      second: { width: 40, height: 20, rotation: 90 },
    });
    states.get('owner')!.scale = 2;
    states.get('first')!.scale = 3;
    states.get('second')!.scale = 2;
    const ownerBounds = modifierTransformBounds(states.get('owner')!.transform, 2);
    const result = evaluateLayerModifiers({ layers, states }).states;
    const bounds = ['first', 'second'].map((id) =>
      modifierTransformBounds(result.get(id)!.transform, result.get(id)!.scale),
    );
    expect(bounds[0]!.x).toBeCloseTo(ownerBounds.x);
    expect(bounds[1]!.x).toBeCloseTo(ownerBounds.x + 120);
    expect(bounds[0]!.y).toBeCloseTo(ownerBounds.y);
    expect(bounds[1]!.y).toBeCloseTo(ownerBounds.y);
    expect(result.get('first')!.transform.rotation).toBe(90);
    expect(result.get('first')!.scale).toBe(3);
  });

  it('orders nested arrangement after its parent move, regardless of layer order', () => {
    const owner = node('owner', null, [grid({ columns: 1 })]);
    const child = node('child', 'owner', [grid({ columns: 2, spreadX: 30 })]);
    const first = node('first', 'child'),
      second = node('second', 'child');
    const layers = [second, first, child, owner];
    const states = statesFor(layers, {
      owner: { x: 300, y: 200 },
      first: { width: 10, height: 10 },
      second: { width: 10, height: 10 },
    });
    const source = structuredClone(states);
    const result = evaluateLayerModifiers({ layers, states }).states;
    expect(position(result, 'child')).toEqual([300, 200]);
    // Scene order within this container is second, first.
    expect(position(result, 'second')).toEqual([300, 200]);
    expect(position(result, 'first')).toEqual([330, 200]);
    expect(evaluateLayerModifiers({ layers, states }).states).toEqual(result);
    expect(states).toEqual(source);
  });
});

describe('Radial Arrange', () => {
  function scene(params: Record<string, unknown>, count = 4) {
    const owner = node('owner', null, [
      createLayerModifier('radial-arrange', { innerRadius: 100, ...params }, { id: 'radial' }),
    ]);
    const items = Array.from({ length: count }, (_, index) => node(`i${index}`, 'owner'));
    const layers = [owner, ...items];
    const states = statesFor(layers, {
      owner: { x: 0, y: 0, width: 200, height: 200 },
      ...Object.fromEntries(items.map((item) => [item.id, { width: 20, height: 20 }])),
    });
    return { layers, states };
  }
  const center = (states: Map<string, ModifierVisualState>, id: string) => {
    const transform = states.get(id)!.transform;
    return [
      Math.round(transform.x + transform.width / 2),
      Math.round(transform.y + transform.height / 2),
    ];
  };

  it('places children evenly around the owner center and can orient them outward', () => {
    const { layers, states } = scene({ orient: true, baseRotation: 90 });
    const result = evaluateLayerModifiers({ layers, states }).states;
    expect(['i0', 'i1', 'i2', 'i3'].map((id) => center(result, id))).toEqual([
      [200, 100],
      [100, 200],
      [0, 100],
      [100, 0],
    ]);
    expect(result.get('i1')!.transform.rotation).toBe(180);
  });

  it('spreads an open arc end to end, limits count and supports radiating rings', () => {
    const arc = scene({ startAngle: 180, endAngle: 360 }, 3);
    const arcResult = evaluateLayerModifiers(arc).states;
    expect(['i0', 'i1', 'i2'].map((id) => center(arcResult, id))).toEqual([
      [0, 100],
      [100, 0],
      [200, 100],
    ]);
    const limited = evaluateLayerModifiers(scene({ count: 2 })).states;
    expect(limited.get('i2')!.isVisible).toBe(false);
    const rings = evaluateLayerModifiers(
      scene({ rings: 2, outerRadius: 150, arrangement: 'radiate' }),
    ).states;
    expect(center(rings, 'i0')).toEqual([200, 100]);
    expect(center(rings, 'i1')).toEqual([250, 100]);
    expect(center(rings, 'i2')).toEqual([0, 100]);
    const outer = evaluateLayerModifiers(
      scene({ rings: 2, outerRadius: 150, arrangement: 'radiate', startFromOuter: true }),
    ).states;
    expect(center(outer, 'i0')).toEqual([250, 100]);
  });
});

describe('Look At', () => {
  it('rotates the chosen axis toward the reference center, with flip and offset', () => {
    const target = node('target');
    const arrow = node('arrow', null, [
      createLayerModifier('look-at', { source: { kind: 'layer', layerId: 'target' } }),
    ]);
    const layers: ModifierLayerNode[] = [arrow, target];
    const states = statesFor([arrow, target], {
      arrow: { x: 0, y: 0, width: 100, height: 20, transformOriginX: 0, transformOriginY: 0.5 },
      target: { x: 90, y: 100, width: 20, height: 20 },
    });
    expect(evaluateLayerModifiers({ layers, states }).states.get('arrow')!.transform.rotation).toBe(
      45,
    );
    arrow.modifiers![0] = {
      ...arrow.modifiers![0]!,
      params: { ...(arrow.modifiers![0]!.params as object), axis: 'y', flip: true },
    } as LayerModifier;
    expect(evaluateLayerModifiers({ layers, states }).states.get('arrow')!.transform.rotation).toBe(
      135,
    );
    arrow.modifiers![0] = {
      ...arrow.modifiers![0]!,
      params: {
        ...(arrow.modifiers![0]!.params as object),
        axis: 'x',
        flip: false,
        rotationOffset: -45,
      },
    } as LayerModifier;
    expect(evaluateLayerModifiers({ layers, states }).states.get('arrow')!.transform.rotation).toBe(
      0,
    );
  });

  it('orders after a moving reference, remaps references and rejects self/cycles', () => {
    const target = node('target', null, [
      createLayerModifier('auto-follow', { source: { kind: 'layer', layerId: 'anchor' } }),
    ]);
    const arrow = node('arrow', null, [
      createLayerModifier('look-at', { source: { kind: 'layer', layerId: 'target' } }),
    ]);
    const layers = [arrow, target, node('anchor')];
    const states = statesFor(layers, {
      arrow: { x: 0, y: 0, width: 20, height: 20 },
      target: { x: 500, y: 0, width: 20, height: 20 },
      anchor: { x: 0, y: 200, width: 20, height: 20 },
    });
    // Follow places target's center under the anchor's (10, 210), straight below the arrow.
    expect(evaluateLayerModifiers({ layers, states }).states.get('arrow')!.transform.rotation).toBe(
      90,
    );
    expect(
      remapLayerModifierReferences(arrow.modifiers, { layers: { target: 'copy' } })![0]!.params,
    ).toMatchObject({ source: { kind: 'layer', layerId: 'copy' } });
    const self = node('self');
    expect(() =>
      addLayerModifier(self, 'look-at', { source: { kind: 'layer', layerId: 'self' } }),
    ).not.toThrow();
    expect(layerModifiersErrors([self]).join(' ')).toMatch(/itself/);
  });

  it('rejects a group containing its owner instead of reading unresolved self geometry', () => {
    const owner = node('arrow', null, [
      createLayerModifier('look-at', { source: { kind: 'group', groupId: 'target' } }),
    ]);
    owner.groupId = 'target';
    const target = node('target');
    target.groupId = 'target';
    expect(layerModifiersErrors([owner, target]).join(' ')).toMatch(/itself.*group/);
    owner.groupId = 'other';
    expect(layerModifiersErrors([owner, target])).toEqual([]);
  });
});

describe('Spline Path base orientation', () => {
  it('stretches the tangent with the path bounds before applying source and base rotations', () => {
    const path = createLayerOfKind('path').element as PathElement;
    const diagonal = { ...path, d: 'M0 0 L100 100', viewBoxWidth: 100, viewBoxHeight: 100 };
    const source = createDefaultTransform({ width: 200, height: 100, rotation: 30 });
    const target = createDefaultTransform({ width: 10, height: 10, rotation: 7 });
    const link = {
      sourceLayerId: 'path',
      progress: 0.5,
      orientToPath: true,
      offsetX: 0,
      offsetY: 0,
      rotationOffset: 10,
    };
    const expected = (Math.atan2(100, 200) * 180) / Math.PI + 40;
    for (const progress of [0, 0.5, 1, 0.1, 1, 0]) {
      expect(
        attachTransformToMotionPath(target, source, diagonal, link, progress).rotation,
      ).toBeCloseTo(expected);
    }
    expect(
      attachTransformToMotionPath(target, source, diagonal, { ...link, orientToPath: false })
        .rotation,
    ).toBe(7);
  });

  it('adds the base orientation to the path tangent only while orienting', () => {
    const path: PathElement = {
      type: 'path',
      d: 'M0 0 L100 100',
      fill: { type: 'solid', color: '#fff' } as never,
      fillRule: 'nonzero',
      strokeColor: '#fff',
      strokeWidth: 1,
      viewBoxWidth: 100,
      viewBoxHeight: 100,
    };
    const source = createDefaultTransform({ x: 0, y: 0, width: 100, height: 100 });
    const target = createDefaultTransform({ width: 10, height: 10, rotation: 7 });
    const link = {
      sourceLayerId: 'path',
      progress: 0.5,
      orientToPath: true,
      offsetX: 0,
      offsetY: 0,
      rotationOffset: 30,
    };
    expect(attachTransformToMotionPath(target, source, path, link).rotation).toBeCloseTo(75);
    expect(
      attachTransformToMotionPath(target, source, path, { ...link, orientToPath: false }).rotation,
    ).toBe(7);
  });
});
