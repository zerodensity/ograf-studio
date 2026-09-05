import { describe, it, expect } from 'vitest';
import {
  createLayerOfKind as emptyLayer,
  createLayerKeyframe,
  defaultTransformFor,
} from './factory';
function createLayerOfKind(kind: Parameters<typeof emptyLayer>[0]) {
  const layer = emptyLayer(kind);
  layer.keyframes = [createLayerKeyframe(0, defaultTransformFor(kind))];
  return layer;
}
import {
  applyPathEdit,
  editablePathBounds,
  convertLayerToPath,
  editPathGeometry,
  parseEditablePath,
  pathConversionError,
  serializeEditablePath,
} from './pathEditing';

describe('editable vector geometry', () => {
  it('uses curve extrema for overflow and preserves the original bounds of an inset stroke', () => {
    const layer = createLayerOfKind('rectangle');
    if (layer.element.type === 'rectangle') layer.element.strokeWidth = 10;
    convertLayerToPath(layer);
    if (layer.element.type !== 'path') throw new Error('Expected path');
    expect(editablePathBounds(layer.element)).toEqual({ x: 0, y: 0, width: 200, height: 200 });
    layer.element.d = 'M0 0 C0 -100 100 -100 100 0';
    layer.element.strokeWidth = 0;
    expect(editablePathBounds(layer.element)).toEqual({ x: 0, y: -75, width: 200, height: 275 });
  });
  it('handles packed arc flags and commands following a closed contour', () => {
    const packed = parseEditablePath('M0 0 A10 10 0 0110 10');
    expect(packed[0]!.nodes.at(-1)).toMatchObject({ x: 10, y: 10 });
    const closed = parseEditablePath('M0 0 L10 0 L10 10 Z l20 20');
    expect(closed).toHaveLength(2);
    expect(closed[0]!.closed).toBe(true);
    expect(closed[1]!.closed).toBe(false);
    expect(closed[1]!.nodes).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 20 },
    ]);
  });
  it('converts a rectangle to four anchors without changing its identity or timeline', () => {
    const layer = createLayerOfKind('rectangle');
    const before = structuredClone(layer);
    convertLayerToPath(layer);
    expect(layer.element.type).toBe('path');
    if (layer.element.type !== 'path') throw new Error('Expected path');
    expect(parseEditablePath(layer.element.d)[0]!.nodes).toHaveLength(4);
    expect({ ...layer, element: before.element }).toEqual(before);
    expect(layer.element).toMatchObject({
      viewBoxWidth: 200,
      viewBoxHeight: 200,
      fill: (before.element as { fill: string }).fill,
    });
  });
  it('converts rounded corners and ellipses to closed cubic curves', () => {
    for (const kind of ['rectangle', 'ellipse'] as const) {
      const layer = createLayerOfKind(kind);
      if (layer.element.type === 'rectangle')
        layer.element.borderRadius = { topLeft: 30, topRight: 30, bottomLeft: 30, bottomRight: 30 };
      convertLayerToPath(layer);
      if (layer.element.type !== 'path') throw new Error('Expected path');
      const path = parseEditablePath(layer.element.d)[0]!;
      expect(path.closed).toBe(true);
      expect(path.nodes.some((n) => n.out)).toBe(true);
      expect(path.nodes).toHaveLength(kind === 'rectangle' ? 8 : 4);
    }
  });
  it('retains compound contours, relative commands, smooth cubics and quadratic handles', () => {
    const d =
      'm 10 20 h 40 v 30 h -40 z M 20 25 q 10 -5 20 0 t 0 15 C 30 50 20 50 20 40 s -5 -5 0 -15 Z';
    const paths = parseEditablePath(d);
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => p.closed)).toBe(true);
    const normalized = serializeEditablePath(paths);
    expect(serializeEditablePath(parseEditablePath(normalized))).toBe(normalized);
  });
  it('splits a cubic with de Casteljau while preserving the curve', () => {
    const d = 'M 0 0 C 0 100 100 100 100 0';
    const next = editPathGeometry(d, {
      action: 'insert',
      expectedD: d,
      contour: 0,
      node: 0,
      t: 0.5,
    });
    const nodes = parseEditablePath(next)[0]!.nodes;
    expect(nodes).toHaveLength(3);
    expect(nodes[1]).toMatchObject({ x: 50, y: 75, in: { x: 25, y: 75 }, out: { x: 75, y: 75 } });
    expect(nodes[0]!.out).toEqual({ x: 0, y: 50 });
    expect(nodes[2]!.in).toEqual({ x: 100, y: 50 });
  });
  it('moves attached handles with anchors and allows independent handle edits', () => {
    const d = 'M 0 0 C 0 100 100 100 100 0';
    const moved = editPathGeometry(d, {
      action: 'move',
      expectedD: d,
      contour: 0,
      node: 1,
      x: 120,
      y: 10,
    });
    expect(parseEditablePath(moved)[0]!.nodes[1]).toMatchObject({
      x: 120,
      y: 10,
      in: { x: 120, y: 110 },
    });
    const changed = editPathGeometry(moved, {
      action: 'handles',
      expectedD: moved,
      contour: 0,
      node: 1,
      incoming: { x: 90, y: 60 },
    });
    expect(parseEditablePath(changed)[0]!.nodes[1]!.in).toEqual({ x: 90, y: 60 });
  });
  it('rejects stale edits, invalid indices, invalid coordinates and destructive small contours', () => {
    const d = 'M0 0L100 0L50 100Z';
    for (const edit of [
      { action: 'move' as const, expectedD: 'old', contour: 0, node: 0, x: 5, y: 10 },
      { action: 'move' as const, expectedD: d, contour: 0, node: 9, x: 5, y: 10 },
      { action: 'move' as const, expectedD: d, contour: 0, node: 0, x: NaN, y: 10 },
      { action: 'remove' as const, expectedD: d, contour: 0, node: 0 },
    ])
      expect(() => editPathGeometry(d, edit)).toThrow();
    expect(() => parseEditablePath('M 5 C 2 3')).toThrow();
    expect(() => parseEditablePath('M0 0 X2 3')).toThrow();
  });
  it('protects locks, unsupported elements, corner tokens and rounded child clipping', () => {
    const layer = createLayerOfKind('rectangle');
    layer.isLocked = true;
    expect(() => convertLayerToPath(layer)).toThrow(/Unlock/);
    layer.isLocked = false;
    layer.designTokenBindings = [{ tokenId: 'radius', targetProperty: 'borderRadius' }];
    expect(pathConversionError(layer)).toMatch(/Unlink/);
    layer.designTokenBindings = [];
    if (layer.element.type === 'rectangle') layer.element.borderRadius.topLeft = 20;
    layer.clipChildren = true;
    expect(() => convertLayerToPath(layer)).toThrow(/clips children/);
    expect(() => convertLayerToPath(createLayerOfKind('image'))).toThrow(/supports/);
  });
  it('can undo shape edits by restoring ordinary path data without special runtime metadata', () => {
    const layer = createLayerOfKind('rectangle');
    convertLayerToPath(layer);
    const before = structuredClone(layer);
    if (layer.element.type !== 'path') throw new Error('Expected path');
    applyPathEdit(layer, {
      action: 'move',
      expectedD: layer.element.d,
      contour: 0,
      node: 0,
      x: 35,
      y: 25,
    });
    expect(layer.keyframes).toEqual(before.keyframes);
    expect(layer.animationTracks).toEqual(before.animationTracks);
    expect(parseEditablePath(layer.element.d)[0]!.nodes[0]).toMatchObject({ x: 35, y: 25 });
  });
});
