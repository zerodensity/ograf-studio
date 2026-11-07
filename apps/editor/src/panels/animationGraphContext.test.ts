import { describe, expect, it } from 'vitest';
import { graphInsertionAtPoint, graphKeyForContextMenu } from './animationGraphContext';
import type { AnimationGraphBounds, GraphScreenInverse } from './animationGraph';

describe('Graph context-menu insertion geometry', () => {
  const inverse: GraphScreenInverse = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const bounds: AnimationGraphBounds = { minFrame: 0, maxFrame: 100, minValue: -20, maxValue: 80 };

  it('inverts zero-padding graph coordinates, rounding only the inserted frame', () => {
    expect(graphInsertionAtPoint({ x: 34.6, y: 12.5 }, inverse, bounds, 100, 50, 100)).toEqual({
      frame: 35,
      value: 55,
    });
  });

  it('accounts for timeline scrolling/zoom and independently scaled CSS width and height', () => {
    const scrolled = { minFrame: 120, maxFrame: 200, minValue: -20, maxValue: 80 };
    // SVG viewBox 800×200 displayed at 400×100, positioned at client (400,300).
    const scaled = { a: 2, b: 0, c: 0, d: 2, e: -800, f: -600 };
    expect(graphInsertionAtPoint({ x: 650, y: 325 }, scaled, scrolled, 800, 200, 300)).toEqual({
      frame: 170,
      value: 55,
    });
    // The same graph location after a different aspect scaling and page offset.
    const stretched = { a: 4, b: 0, c: 0, d: 0.5, e: -1200, f: -50 };
    expect(graphInsertionAtPoint({ x: 425, y: 200 }, stretched, scrolled, 800, 200, 300)).toEqual({
      frame: 170,
      value: 55,
    });
  });

  it('uses every affine component, including skew, rotation and mirrored axes', () => {
    const affine = { a: 0, b: 2, c: -0.5, d: 1, e: 200, f: -100 };
    expect(graphInsertionAtPoint({ x: 25, y: 300 }, affine, bounds, 100, 500, 100)).toEqual({
      frame: 50,
      value: 30,
    });
    expect(
      graphInsertionAtPoint({ x: 25, y: 20 }, { ...inverse, a: -1, e: 100 }, bounds, 100, 50, 100),
    ).toEqual({
      frame: 75,
      value: 40,
    });
  });

  it('includes exact graph boundaries and clamps pointers outside the visible plot', () => {
    expect(graphInsertionAtPoint({ x: 0, y: 0 }, inverse, bounds, 100, 50, 100)).toEqual({
      frame: 0,
      value: 80,
    });
    expect(graphInsertionAtPoint({ x: 100, y: 50 }, inverse, bounds, 100, 50, 100)).toEqual({
      frame: 100,
      value: -20,
    });
    expect(graphInsertionAtPoint({ x: -20, y: 90 }, inverse, bounds, 100, 50, 100)).toEqual({
      frame: 0,
      value: -20,
    });
    expect(graphInsertionAtPoint({ x: 180, y: -10 }, inverse, bounds, 100, 50, 100)).toEqual({
      frame: 100,
      value: 80,
    });
  });

  it('clamps whole frames to the composition duration even when the graph viewport extends beyond it', () => {
    expect(
      graphInsertionAtPoint(
        { x: 100, y: 25 },
        inverse,
        { ...bounds, minFrame: 50, maxFrame: 150 },
        100,
        50,
        80,
      ),
    ).toEqual({ frame: 80, value: 30 });
    expect(
      graphInsertionAtPoint({ x: 0, y: 25 }, inverse, { ...bounds, minFrame: -50 }, 100, 50, 80),
    ).toEqual({ frame: 0, value: 30 });
    expect(graphInsertionAtPoint({ x: 99, y: 25 }, inverse, bounds, 100, 50, 0)).toEqual({
      frame: 0,
      value: 30,
    });
    expect(graphInsertionAtPoint({ x: 99, y: 25 }, inverse, bounds, 100, 50, 3.5)).toEqual({
      frame: 3,
      value: 30,
    });
  });

  it('keeps the visible value scale without imposing a property-specific range', () => {
    expect(
      graphInsertionAtPoint(
        { x: 40, y: 20 },
        inverse,
        { ...bounds, minValue: -1000, maxValue: 1000 },
        100,
        50,
        100,
      ),
    ).toEqual({ frame: 40, value: 200 });
  });

  it('rejects non-finite inputs, invalid ranges/dimensions, singular matrices and numeric overflow', () => {
    const insert = (
      patch: Partial<GraphScreenInverse> = {},
      range: AnimationGraphBounds = bounds,
      width = 100,
      height = 50,
      duration = 100,
    ) =>
      graphInsertionAtPoint(
        { x: 40, y: 20 },
        { ...inverse, ...patch },
        range,
        width,
        height,
        duration,
      );
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(
        graphInsertionAtPoint({ x: invalid, y: 20 }, inverse, bounds, 100, 50, 100),
      ).toBeNull();
      expect(
        graphInsertionAtPoint({ x: 40, y: invalid }, inverse, bounds, 100, 50, 100),
      ).toBeNull();
      for (const field of ['a', 'b', 'c', 'd', 'e', 'f'] as const)
        expect(insert({ [field]: invalid })).toBeNull();
      for (const field of ['minFrame', 'maxFrame', 'minValue', 'maxValue'] as const)
        expect(insert({}, { ...bounds, [field]: invalid })).toBeNull();
      expect(insert({}, bounds, invalid)).toBeNull();
      expect(insert({}, bounds, 100, invalid)).toBeNull();
      expect(insert({}, bounds, 100, 50, invalid)).toBeNull();
    }
    for (const dimension of [0, -1]) {
      expect(insert({}, bounds, dimension)).toBeNull();
      expect(insert({}, bounds, 100, dimension)).toBeNull();
    }
    expect(insert({}, bounds, 100, 50, -1)).toBeNull();
    expect(insert({}, { ...bounds, minFrame: 100 })).toBeNull();
    expect(insert({}, { ...bounds, maxFrame: -1 })).toBeNull();
    expect(insert({}, { ...bounds, minValue: 80 })).toBeNull();
    expect(insert({}, { ...bounds, maxValue: -30 })).toBeNull();
    expect(insert({ a: 0 })).toBeNull();
    expect(insert({ a: 1, b: 2, c: 2, d: 4 })).toBeNull();
    expect(insert({ a: 1e308, d: 1e-308 })).toBeNull();
    expect(insert({ a: 1e308, d: 1e308 })).toBeNull();
    expect(insert({}, { ...bounds, minFrame: -1e308, maxFrame: 1e308 })).toBeNull();
    expect(insert({}, { ...bounds, minValue: -1e308, maxValue: 1e308 })).toBeNull();
  });
});

describe('Graph context-menu key targeting', () => {
  it('includes the 18 CSS-pixel radius and rejects points beyond it', () => {
    const points = [{ id: 'key', x: 100, y: 200 }];
    expect(graphKeyForContextMenu(points, [], { x: 118, y: 200 })).toBe('key');
    expect(graphKeyForContextMenu(points, [], { x: 100, y: 182 })).toBe('key');
    expect(graphKeyForContextMenu(points, [], { x: 118.01, y: 200 })).toBeNull();
    expect(graphKeyForContextMenu(points, [], { x: 114, y: 214 })).toBeNull();
  });

  it('chooses a nearer unselected key before an older selected key', () => {
    const points = [
      { id: 'selected', x: 0, y: 0 },
      { id: 'nearby', x: 14, y: 0 },
    ];
    expect(graphKeyForContextMenu(points, ['selected'], { x: 12, y: 0 })).toBe('nearby');
    expect(graphKeyForContextMenu(points, ['selected'], { x: 28, y: 0 })).toBe('nearby');
  });

  it('prefers a selected key only when nearby points are equally distant', () => {
    const points = [
      { id: 'first', x: 90, y: 100 },
      { id: 'selected', x: 110, y: 100 },
    ];
    expect(graphKeyForContextMenu(points, ['selected'], { x: 100, y: 100 })).toBe('selected');
    expect(graphKeyForContextMenu(points, [], { x: 100, y: 100 })).toBe('first');
  });

  it.each([
    { key: { x: 485, y: 664 }, pointer: { x: 500, y: 664 } },
    { key: { x: 1120.5, y: 390.25 }, pointer: { x: 1135.5, y: 390.25 } },
    { key: { x: 24, y: 48 }, pointer: { x: 39, y: 48 } },
  ])('uses supplied screen pixels directly after zooming or resizing: $key', ({ key, pointer }) => {
    expect(graphKeyForContextMenu([{ id: 'key', ...key }], [], pointer)).toBe('key');
  });

  it('falls back to exactly one visible selected ID and deduplicates selection entries', () => {
    const points = [
      { id: 'chosen', x: 100, y: 100 },
      { id: 'other', x: 200, y: 200 },
    ];
    expect(graphKeyForContextMenu(points, ['chosen'], { x: 600, y: 500 })).toBe('chosen');
    expect(graphKeyForContextMenu(points, ['chosen', 'chosen'], { x: 600, y: 500 })).toBe('chosen');
    expect(graphKeyForContextMenu(points, ['offscreen', 'chosen'], { x: 600, y: 500 })).toBe(
      'chosen',
    );
  });

  it('rejects ambiguous or offscreen-only selections without a nearby key', () => {
    const points = [
      { id: 'one', x: 100, y: 100 },
      { id: 'two', x: 200, y: 200 },
    ];
    expect(graphKeyForContextMenu(points, ['one', 'two'], { x: 600, y: 500 })).toBeNull();
    expect(graphKeyForContextMenu(points, ['offscreen'], { x: 600, y: 500 })).toBeNull();
    expect(graphKeyForContextMenu(points, [], { x: 600, y: 500 })).toBeNull();
    expect(graphKeyForContextMenu([], ['one'], { x: 0, y: 0 })).toBeNull();
    expect(graphKeyForContextMenu(points, ['one', 'two'], { x: 200, y: 201 })).toBe('two');
  });

  it('ignores invalid points and rejects invalid pointers before considering selection fallback', () => {
    const points = [
      { id: 'invalid-x', x: Number.NaN, y: 100 },
      { id: 'invalid-y', x: 100, y: Number.POSITIVE_INFINITY },
      { id: 'valid', x: 300, y: 100 },
    ];
    expect(
      graphKeyForContextMenu(points, ['invalid-x', 'invalid-y'], { x: 100, y: 100 }),
    ).toBeNull();
    expect(graphKeyForContextMenu(points, ['valid', 'invalid-x'], { x: 100, y: 100 })).toBe(
      'valid',
    );
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(graphKeyForContextMenu(points, ['valid'], { x: invalid, y: 100 })).toBeNull();
      expect(graphKeyForContextMenu(points, ['valid'], { x: 100, y: invalid })).toBeNull();
    }
  });
});
