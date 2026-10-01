import { describe, expect, it } from 'vitest';
import {
  resolveExpressionTransforms,
  type ExpressionLayerState,
  type ExpressionDiagnostic,
} from './expressionTransforms';

function layer(
  id: string,
  expressions?: ExpressionLayerState['expressions'],
): ExpressionLayerState {
  return {
    id,
    name: id,
    expressions,
    transform: {
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    },
  };
}

describe('resolveExpressionTransforms', () => {
  it('provides the sampled value and read-only metadata for each current property', () => {
    const target = layer('Title');
    target.expressions = Object.fromEntries(
      ['x', 'y', 'width', 'height', 'rotation', 'opacity'].map((property) => [
        property,
        `if (thisProperty.name !== ${JSON.stringify(property)} || thisProperty.layerId !== thisLayer.id || thisLayer.name !== "Title") throw new Error("metadata"); return value + thisProperty.value;`,
      ]),
    );
    const diagnostics: ExpressionDiagnostic[] = [];
    expect(resolveExpressionTransforms([target], {}, diagnostics).get('Title')).toMatchObject({
      x: 20,
      y: 40,
      width: 200,
      height: 100,
      rotation: 0,
      opacity: 2,
    });
    expect(diagnostics).toEqual([]);
    target.expressions = {
      x: 'thisProperty.value = 99; return 1;',
      y: 'thisLayer.id = "Other"; return 1;',
    };
    expect(resolveExpressionTransforms([target], {}, diagnostics).get('Title')).toMatchObject({
      x: 10,
      y: 20,
    });
    expect(diagnostics).toHaveLength(2);
  });
  it('reads layer identity without evaluating its transform properties', () => {
    const broken = layer('Broken', { x: 'missing()' });
    const target = layer('Target', {
      x: 'layer("Broken").id === "Broken" && layerById("Broken").name === "Broken" ? value + 5 : 0',
    });
    const diagnostics: ExpressionDiagnostic[] = [];
    expect(resolveExpressionTransforms([target, broken], {}, diagnostics).get('Target')!.x).toBe(
      15,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.layerId).toBe('Broken');
  });
  it('exposes the runtime identity for scoped collection references', () => {
    const a = { ...layer('rows::0::a'), name: 'A', prototypeLayerId: 'a', referenceScope: 'rows0' };
    const b = {
      ...layer('rows::0::b', {
        x: 'layer("A").id === "rows::0::a" && layerById("a").id === layer("A").id ? value : 0',
      }),
      name: 'B',
      prototypeLayerId: 'b',
      referenceScope: 'rows0',
    };
    expect(resolveExpressionTransforms([a, b], {}).get(b.id)!.x).toBe(10);
  });

  it('supports spread, Object.keys and JSON serialization for supplied API values', () => {
    const target = layer('Target', {
      x: '({...data}).padding + Object.keys(data).length',
      y: 'JSON.parse(JSON.stringify(thisLayer)).y',
      width: 'Object.values(comp).reduce((sum, value) => sum + value, 0)',
      height: 'Object.keys(timeline).length',
    });
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms(
      [target],
      {
        'data.padding': 15,
        'comp.width': 1920,
        'comp.height': 1080,
        'timeline.startFrame': 0,
      },
      diagnostics,
    );
    expect(result.get('Target')).toMatchObject({ x: 16, y: 20, width: 3000, height: 1 });
    expect(diagnostics).toEqual([]);
  });

  it('copies computed layer values through explicit name and ID references', () => {
    const source = layer('Source', { width: '200' });
    const target = layer('Target', {
      x: '({...layer("Source")}).width',
      y: '({...layerById("Source")}).width',
      width: 'JSON.parse(JSON.stringify(layer("Source"))).width',
    });
    // Enumerating keys must not create a dependency on Broken.x.
    const broken = layer('Broken', { x: 'layer("Missing").x' });
    target.expressions!.height = 'Object.keys(layer("Broken")).length';
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([target, source, broken], {}, diagnostics);
    expect(result.get('Target')).toMatchObject({ x: 200, y: 200, width: 200, height: 6 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.layerId).toBe('Broken');
  });

  it('treats indentation-only drafts as empty expressions', () => {
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([layer('Draft', { x: '  \n  ' })], {}, diagnostics);
    expect(result.get('Draft')!.x).toBe(10);
    expect(diagnostics).toEqual([]);
  });

  it('retains v1 behavior for legacy expressions and rejects future versions before execution', () => {
    const legacy = layer('legacy', { x: 'Math.max(x, 42)' });
    const future = layer('future', { x: 'throw new Error("executed")' });
    const diagnostics: ExpressionDiagnostic[] = [];
    expect(resolveExpressionTransforms([legacy], {}).get('legacy')!.x).toBe(42);
    const result = resolveExpressionTransforms([future], {}, diagnostics, 2);
    expect(result.get('future')!.x).toBe(10);
    expect(diagnostics[0]!.message).toBe('Unsupported expression API version: 2');
  });

  it('keeps ID references stable after renaming and resolves collection prototypes locally', () => {
    const target = { ...layer('stable-id', { width: '200' }), name: 'Renamed' };
    const follower = layer('follower', { x: 'layerById("stable-id").width' });
    const items = [0, 1].flatMap((index) => [
      {
        ...layer('box-' + index, { width: String(300 + index) }),
        prototypeLayerId: 'box',
        referenceScope: 'item-' + index,
      },
      {
        ...layer('text-' + index, { x: 'layerById("box").width' }),
        prototypeLayerId: 'text',
        referenceScope: 'item-' + index,
      },
    ]);
    const diagnostics: ExpressionDiagnostic[] = [];
    const outside = layer('outside', { x: 'layerById("box").width' });
    const result = resolveExpressionTransforms(
      [follower, target, ...items, outside],
      {},
      diagnostics,
    );
    expect(result.get('follower')!.x).toBe(200);
    expect(result.get('text-0')!.x).toBe(300);
    expect(result.get('text-1')!.x).toBe(301);
    expect(diagnostics[0]!.message).toBe('Unknown layer ID: box');
    target.expressions = { width: 'layerById("follower").x' };
    const cycles: ExpressionDiagnostic[] = [];
    expect(resolveExpressionTransforms([target, follower], {}, cycles).get('follower')!.x).toBe(10);
    expect(cycles.every((entry) => entry.message.includes('Circular'))).toBe(true);
  });

  it('reports failed properties and their dependents, and clears errors after repair or disabling', () => {
    const a = layer('A', { x: 'layer("Missing").x', y: '42' });
    const b = layer('B', { x: 'layer("A").x + 1' });
    const diagnostics: ExpressionDiagnostic[] = [];
    expect(resolveExpressionTransforms([b, a], {}, diagnostics).get('A')).toMatchObject({
      x: 10,
      y: 42,
    });
    expect(diagnostics.map((entry) => [entry.layerId, entry.property, entry.message])).toEqual([
      ['B', 'x', 'Unknown layer: Missing'],
      ['A', 'x', 'Unknown layer: Missing'],
    ]);
    a.expressionsEnabled = { x: false };
    const repaired: ExpressionDiagnostic[] = [];
    expect(resolveExpressionTransforms([b, a], {}, repaired).get('B')!.x).toBe(11);
    expect(repaired).toEqual([]);
  });

  it('resolves item siblings first and global layers second without leaking across instances', () => {
    const global = layer('Global', { width: '500' });
    const rows = [0, 1].flatMap((index) => [
      {
        ...layer('box' + index, { width: String(100 + index) }),
        name: 'Box',
        referenceScope: 'row' + index,
      },
      {
        ...layer('text' + index, { x: 'layer("Box").width', y: 'layer("Global").width' }),
        referenceScope: 'row' + index,
      },
    ]);
    const outside = layer('Outside', { x: 'layer("Box").width' });
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms(
      [outside, ...rows.reverse(), global],
      {},
      diagnostics,
    );
    expect(result.get('text0')).toMatchObject({ x: 100, y: 500 });
    expect(result.get('text1')).toMatchObject({ x: 101, y: 500 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.layerId).toBe('Outside');
  });

  it('does not hide ambiguous item names by falling through to a global layer', () => {
    const global = layer('Box', { width: '999' });
    const local = [layer('A'), layer('B')].map((entry) => ({
      ...entry,
      name: 'Box',
      referenceScope: 'row',
    }));
    const text = { ...layer('Text', { x: 'layer("Box").width' }), referenceScope: 'row' };
    const diagnostics: ExpressionDiagnostic[] = [];
    expect(
      resolveExpressionTransforms([global, ...local, text], {}, diagnostics).get('Text')!.x,
    ).toBe(10);
    expect(diagnostics).toEqual([
      expect.objectContaining({ layerId: 'Text', message: 'Ambiguous layer name: Box' }),
    ]);
  });

  it('resolves computed references independently of layer and property order', () => {
    const a = layer('A', { x: 'layer("B").width + 1', width: '200', y: 'thisLayer.width' });
    const b = layer('B', { width: 'layer("A").width + 50' });
    for (const layers of [
      [a, b],
      [b, a],
    ]) {
      const result = resolveExpressionTransforms(layers, {});
      expect(result.get('A')).toMatchObject({ x: 251, width: 200, y: 100 });
      expect(result.get('B')!.width).toBe(250);
      expect(a.transform.width).toBe(100);
    }
    a.expressionsEnabled = { width: false };
    expect(resolveExpressionTransforms([a, b], {}).get('A')).toMatchObject({ x: 151, width: 100 });
  });

  it('does not confuse layers named data or comp with expression variables', () => {
    const data = layer('data', { x: '30' });
    const comp = layer('comp', { width: '40' });
    const text = layer('Text', {
      x: 'data.x + layer("data").x',
      width: 'comp.width + layer("comp").width',
    });
    const result = resolveExpressionTransforms([data, comp, text], {
      'data.x': 5,
      'comp.width': 1920,
    });
    expect(result.get('Text')).toMatchObject({ x: 35, width: 1960 });
  });

  it('keeps native globals and API namespaces independent of layer names', () => {
    const globals = ['Math', 'console', 'Number', 'data', 'timeline'].map((name) =>
      layer(name, { width: '75' }),
    );
    const target = layer('Target', {
      x: 'Math.max(2, 8) + Number("2") + layer("Math").width',
      y: 'typeof console.log === "function" ? 50 : 0',
      width: 'data.width',
    });
    const diagnostics: ExpressionDiagnostic[] = [];
    const result = resolveExpressionTransforms([...globals, target], {}, diagnostics);
    expect(result.get('Target')).toMatchObject({ x: 85, y: 50, width: 100 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.property).toBe('width');
  });

  it('reports a readable dependency path for circular references', () => {
    const a = layer('A', { x: 'layer("B").width' });
    const b = layer('B', { width: 'layer("A").x' });
    const diagnostics: ExpressionDiagnostic[] = [];
    resolveExpressionTransforms([a, b], {}, diagnostics);
    expect(diagnostics[0]!.message).toBe('Circular expression dependency: A.x -> B.width -> A.x');
  });

  it('rejects every reference to duplicate names, including three duplicates', () => {
    const duplicates = [layer('A'), layer('B'), layer('C')].map((l) => ({
      ...l,
      name: 'Duplicate',
    }));
    const text = layer('Text', { x: 'layer("Duplicate").x + 100', y: '99' });
    for (const layers of [[...duplicates, text], [text, ...duplicates].reverse()]) {
      expect(resolveExpressionTransforms(layers, {}).get('Text')).toMatchObject({ x: 10, y: 99 });
    }
  });

  it('retains base values for invalid/circular dependencies and still evaluates other properties', () => {
    const a = layer('A', { x: 'layer("B").x', y: '35' });
    const b = layer('B', { x: 'layer("A").x', width: '1 / 0' });
    const c = layer('C', { x: 'layer("B").width', y: 'layer("Missing").y' });
    for (const layers of [
      [a, b, c],
      [c, b, a],
    ]) {
      const result = resolveExpressionTransforms(layers, {});
      expect(result.get('A')).toMatchObject({ x: 10, y: 35 });
      expect(result.get('B')).toMatchObject({ x: 10, width: 100 });
      expect(result.get('C')).toMatchObject({ x: 10, y: 20 });
    }
  });
});
