import { describe, expect, it } from 'vitest';
import { createLayerPropertyKeyframe, getTrackValueAtFrame } from '@ograf-editor/scene-model';
import {
  animationGraphBounds,
  animationGraphPath,
  createAnimationGraphDrag,
  graphCoordinates,
  timelineGraphBounds,
} from './animationGraph';

const pathPoints = (path: string) =>
  [...path.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));

describe('animation graph geometry', () => {
  it('maps frames and values into a padded graph and samples easing', () => {
    const keys = [
      createLayerPropertyKeyframe(0, 0),
      createLayerPropertyKeyframe(10, 100, { easing: 'quad-in' }),
    ];
    const bounds = animationGraphBounds(keys, 10);
    expect(graphCoordinates(0, 0, bounds, 200, 100).x).toBe(16);
    expect(graphCoordinates(10, 100, bounds, 200, 100).x).toBe(184);
    expect(animationGraphPath(keys, bounds, 200, 100)).toMatch(/^M /);
  });

  it.each([
    { pixelsPerFrame: 2, scrollLeft: 0, width: 280 },
    { pixelsPerFrame: 12, scrollLeft: 137.5, width: 640 },
    { pixelsPerFrame: 32, scrollLeft: 1_024, width: 1_800 },
  ])('shares the timeline frame origin and zoom: %j', (viewport) => {
    const keys = [createLayerPropertyKeyframe(0, 0), createLayerPropertyKeyframe(250, 100)];
    const bounds = timelineGraphBounds(keys, 300, viewport);
    for (const frame of [0, 17, 250, 300])
      expect(graphCoordinates(frame, 50, bounds, viewport.width, 180, 0).x).toBeCloseTo(
        frame * viewport.pixelsPerFrame - viewport.scrollLeft,
        9,
      );
    expect(graphCoordinates(bounds.minFrame, 50, bounds, viewport.width, 180, 0).x).toBe(0);
    expect(graphCoordinates(bounds.maxFrame, 50, bounds, viewport.width, 180, 0).x).toBe(
      viewport.width,
    );
  });

  it('keeps beginning, end and key positions fixed when the pane is resized', () => {
    const keys = [createLayerPropertyKeyframe(20, 20), createLayerPropertyKeyframe(50, 100)];
    const viewport = { scrollLeft: 72, pixelsPerFrame: 12 };
    for (const width of [240, 800, 1_400]) {
      const bounds = timelineGraphBounds(keys, 100, { ...viewport, width });
      // Keys do not stretch to the viewport edges or pull the authored end into view.
      expect(graphCoordinates(0, 0, bounds, width, 180, 0).x).toBeCloseTo(-72);
      expect(graphCoordinates(20, 20, bounds, width, 180, 0).x).toBeCloseTo(168);
      expect(graphCoordinates(50, 100, bounds, width, 180, 0).x).toBeCloseTo(528);
      expect(graphCoordinates(100, 100, bounds, width, 180, 0).x).toBeCloseTo(1_128);
    }
  });

  it('samples only the visible part of long tracks while matching canonical easing', () => {
    const keys = [
      createLayerPropertyKeyframe(0, 5),
      createLayerPropertyKeyframe(1_000_000, 100, { easing: 'elastic-in-out' }),
    ];
    const viewport = { scrollLeft: 250, width: 600, pixelsPerFrame: 0.001 };
    const bounds = timelineGraphBounds(keys, 1_000_000, viewport);
    const points = pathPoints(animationGraphPath(keys, bounds, viewport.width, 180, 0));
    expect(points).toHaveLength(601);
    expect(points[0]!.x).toBe(0);
    expect(points.at(-1)!.x).toBe(600);
    for (const point of points) {
      const frame = (point.x + viewport.scrollLeft) / viewport.pixelsPerFrame;
      const value = getTrackValueAtFrame(keys, frame, keys[0]!.value);
      const expected = graphCoordinates(frame, value, bounds, viewport.width, 180, 0);
      expect(point.y).toBeCloseTo(expected.y, 2);
    }
  });

  it('includes exact keys in a short transition between pixel samples', () => {
    const keys = [
      createLayerPropertyKeyframe(0, 0),
      createLayerPropertyKeyframe(17, 0),
      createLayerPropertyKeyframe(18, 100),
      createLayerPropertyKeyframe(100, 100),
    ];
    const bounds = timelineGraphBounds(keys, 100, {
      scrollLeft: 0,
      width: 13,
      pixelsPerFrame: 0.13,
    });
    const points = pathPoints(animationGraphPath(keys, bounds, 13, 180, 0));
    expect(points).toContainEqual({ x: 2.21, y: 165 });
    expect(points).toContainEqual({ x: 2.34, y: 15 });
    expect(points.filter((point) => point.x < 2.21).every((point) => point.y === 165)).toBe(true);
  });

  it('ends the visible curve at the composition end without stretching its frame scale', () => {
    const keys = [createLayerPropertyKeyframe(0, 0), createLayerPropertyKeyframe(100, 100)];
    const viewport = { scrollLeft: 480, width: 720, pixelsPerFrame: 6 };
    const bounds = timelineGraphBounds(keys, 100, viewport);
    const points = pathPoints(
      animationGraphPath(keys, bounds, viewport.width, 180, 0, { minFrame: 0, maxFrame: 100 }),
    );
    expect(points[0]!.x).toBe(0);
    expect(points.at(-1)!.x).toBe(100 * viewport.pixelsPerFrame - viewport.scrollLeft);
    expect(points.at(-1)!.x).toBe(120);
    expect(points.every((point) => point.x <= 120)).toBe(true);
    // Omitting the optional composition range keeps the original full-viewport behavior.
    expect(pathPoints(animationGraphPath(keys, bounds, viewport.width, 180, 0)).at(-1)!.x).toBe(
      720,
    );
  });

  it('does not draw a held curve when the visible timeline is entirely after Out', () => {
    const keys = [createLayerPropertyKeyframe(0, 0), createLayerPropertyKeyframe(100, 100)];
    const viewport = { scrollLeft: 606, width: 720, pixelsPerFrame: 6 };
    const bounds = timelineGraphBounds(keys, 100, viewport);
    expect(
      animationGraphPath(keys, bounds, viewport.width, 180, 0, { minFrame: 0, maxFrame: 100 }),
    ).toBe('');
  });

  it('clips both sample boundaries using the original viewport coordinates', () => {
    const keys = [createLayerPropertyKeyframe(0, 0), createLayerPropertyKeyframe(100, 100)];
    const bounds = { minFrame: -10, maxFrame: 30, minValue: -10, maxValue: 110 };
    const points = pathPoints(
      animationGraphPath(keys, bounds, 400, 180, 0, { minFrame: 0, maxFrame: 20 }),
    );
    expect(points[0]!.x).toBe(100);
    expect(points.at(-1)!.x).toBe(300);
  });

  it('bounds sampling cost by viewport pixels even at extreme duration and display width', () => {
    const keys = [createLayerPropertyKeyframe(0, 0), createLayerPropertyKeyframe(1e9, 100)];
    const bounds = timelineGraphBounds(keys, 1e9, {
      scrollLeft: 0,
      width: 10_000,
      pixelsPerFrame: 0.00001,
    });
    const points = pathPoints(animationGraphPath(keys, bounds, 10_000, 180, 0));
    expect(points).toHaveLength(4_097);
    expect(points.at(-1)!.x).toBe(10_000);
  });

  it('moves a graph key by the same pixel-to-frame distance as the scrolled timeline', () => {
    const key = createLayerPropertyKeyframe(50, 60);
    const keys = [createLayerPropertyKeyframe(0, 0), key];
    const viewport = { scrollLeft: 90, width: 600, pixelsPerFrame: 6 };
    const bounds = timelineGraphBounds(keys, 100, viewport);
    const pointer = graphCoordinates(key.frame, key.value, bounds, viewport.width, 180, 0);
    const drag = createAnimationGraphDrag(
      key,
      bounds,
      { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      pointer,
      viewport.width,
      180,
      0,
    );
    expect(drag.sample(pointer)).toEqual({ frame: 50, value: 60 });
    expect(drag.sample({ x: pointer.x + 36, y: pointer.y })).toEqual({ frame: 56, value: 60 });
  });

  it.each([
    { name: 'wide horizontal letterbox', scale: 1, left: 360, top: 20 },
    { name: 'narrow vertical letterbox', scale: 0.5, left: 20, top: 45 },
    { name: 'large proportional resize', scale: 2, left: 40, top: 60 },
  ])('maps a small drag through the SVG screen transform: $name', ({ scale, left, top }) => {
    const bounds = { minFrame: 0, maxFrame: 100, minValue: -10, maxValue: 110 };
    const key = createLayerPropertyKeyframe(50, 60);
    const position = graphCoordinates(key.frame, key.value, bounds, 720, 180);
    const pointer = { x: left + position.x * scale + 3, y: top + position.y * scale - 2 };
    const drag = createAnimationGraphDrag(
      key,
      bounds,
      {
        a: 1 / scale,
        b: 0,
        c: 0,
        d: 1 / scale,
        e: -left / scale,
        f: -top / scale,
      },
      pointer,
      720,
      180,
    );
    // Clicking the circle away from its centre and releasing without movement must be exact.
    expect(drag.sample(pointer)).toEqual({ frame: key.frame, value: key.value });
    const sampled = drag.sample({ x: pointer.x + 3, y: pointer.y + 1 });
    expect(sampled.frame).toBe(Math.round(50 + (3 / scale / 688) * 100));
    expect(sampled.value).toBeCloseTo(60 - (1 / scale / 148) * 120, 10);
  });

  it('keeps value and coordinate scales fixed throughout a drag as extrema change', () => {
    const key = createLayerPropertyKeyframe(50, 100);
    const keys = [createLayerPropertyKeyframe(0, 0), key];
    const bounds = animationGraphBounds(keys, 100);
    const inverse = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const pointer = graphCoordinates(key.frame, key.value, bounds, 720, 180);
    const drag = createAnimationGraphDrag(key, bounds, inverse, pointer, 720, 180);
    const first = drag.sample({ x: pointer.x, y: pointer.y - 3 });
    key.value = first.value;
    Object.assign(bounds, animationGraphBounds(keys, 200));
    inverse.a = inverse.d = 2;
    expect(drag.sample({ x: pointer.x, y: pointer.y - 3 })).toEqual(first);
    expect(drag.sample({ x: pointer.x, y: pointer.y - 6 }).value - first.value).toBeCloseTo(
      first.value - 100,
      10,
    );
    expect(drag.bounds).toEqual({ minFrame: 0, maxFrame: 100, minValue: -10, maxValue: 110 });
  });
});
