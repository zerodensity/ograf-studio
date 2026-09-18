import { describe, expect, it } from 'vitest';
import {
  appendFreehandPoint,
  areaRectFromPoints,
  freehandAreaFromPoints,
} from './agentAreaReference';
import { MAX_AREA_POLYGON_POINTS } from '@ograf-editor/agent-tools/chat-references';

describe('canvas area selection', () => {
  it('normalizes reverse drags and rounds outward to avoid clipping the chosen pixels', () => {
    expect(areaRectFromPoints({ x: 800.7, y: 220.4 }, { x: 120.2, y: 80.8 }, 1920, 1080)).toEqual({
      x: 120,
      y: 80,
      width: 681,
      height: 141,
    });
  });
  it('clips a drag at composition edges and preserves empty clicks', () => {
    expect(areaRectFromPoints({ x: -20, y: 60 }, { x: 2000, y: 1200 }, 1920, 1080)).toEqual({
      x: 0,
      y: 60,
      width: 1920,
      height: 1020,
    });
    expect(areaRectFromPoints({ x: 12, y: 60 }, { x: 12, y: 60 }, 1920, 1080)).toEqual({
      x: 12,
      y: 60,
      width: 0,
      height: 0,
    });
  });
  it('retains a concave outline with outward-rounded crop bounds and clips canvas edges', () => {
    const points = [
      { x: -10, y: 20.2 },
      { x: 70.3, y: 20.2 },
      { x: 40, y: 40 },
      { x: 120, y: 90.4 },
    ];
    expect(freehandAreaFromPoints(points, 100, 80)).toEqual({
      rect: { x: 0, y: 20, width: 100, height: 60 },
      polygon: [
        { x: 0, y: 20.2 },
        { x: 70.3, y: 20.2 },
        { x: 40, y: 40 },
        { x: 100, y: 80 },
      ],
    });
  });
  it('rejects clicks and diagonal lines but accepts a self-crossing outline', () => {
    expect(freehandAreaFromPoints([{ x: 20, y: 30 }], 100, 100)).toBeNull();
    expect(
      freehandAreaFromPoints(
        [
          { x: 0, y: 0 },
          { x: 20, y: 20 },
          { x: 80, y: 80 },
        ],
        100,
        100,
      ),
    ).toBeNull();
    expect(
      freehandAreaFromPoints(
        [
          { x: 0, y: 0 },
          { x: 80, y: 80 },
          { x: 80, y: 0 },
          { x: 0, y: 80 },
        ],
        100,
        100,
      ),
    ).not.toBeNull();
  });
  it('bounds very long gestures while keeping their beginning and latest endpoint', () => {
    let points = [{ x: 0, y: 0 }];
    expect(appendFreehandPoint(points, { x: 0.1, y: 0.1 }, 2)).toBe(points);
    for (let index = 1; index <= 10_000; index++) {
      points = appendFreehandPoint(points, { x: index, y: Math.sin(index) }, 0);
      expect(points.length).toBeLessThanOrEqual(MAX_AREA_POLYGON_POINTS);
    }
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)?.x).toBe(10_000);
  });
});
