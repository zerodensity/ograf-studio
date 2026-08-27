import { describe, expect, it } from 'vitest';
import {
  clipPathForParentBounds,
  clipPathSvgForParentBounds,
  intersectTransformBounds,
} from './clipping';
import type { LayerTransform } from './types';

const transform = (patch: Partial<LayerTransform> = {}): LayerTransform => ({
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  rotation: 0,
  opacity: 1,
  transformOriginX: 0.5,
  transformOriginY: 0.5,
  ...patch,
});

describe('transform-aware clipping', () => {
  it('rotates the parent clip path into child-local coordinates for diagonal wipes', () => {
    const child = transform({ x: 50, y: 50, width: 300, height: 180 });
    const parent = transform({ x: 100, y: 70, width: 120, height: 90, rotation: 20 });

    const path = clipPathSvgForParentBounds(child, parent);

    expect(path).toMatch(/^M /);
    expect(path).toContain(' L ');
    expect(path).not.toBe('M 50 20 L 170 20 L 170 110 L 50 110 Z');
    expect(clipPathForParentBounds(child, parent)).toBe(`path("${path}")`);
  });

  it('keeps rounded corners when the clipping parent is rotated', () => {
    const path = clipPathSvgForParentBounds(
      transform({ width: 300, height: 200 }),
      transform({ x: 40, y: 30, width: 120, height: 80, rotation: -15 }),
      12,
    );
    expect(path.match(/ Q /g)).toHaveLength(4);
  });

  it('uses each clipping-parent corner radius independently', () => {
    const path = clipPathSvgForParentBounds(transform(), transform({ width: 100, height: 80 }), {
      topLeft: 4,
      topRight: 8,
      bottomRight: 12,
      bottomLeft: 16,
    });

    expect(path).toContain('M 4 0');
    expect(path).toContain('L 92 0');
    expect(path).toContain('L 16 80');
    expect(path).toContain('L 0 4');
  });

  it('moves the clip window through a translating wide child for ticker motion', () => {
    const parent = transform({ x: 100, y: 50, width: 160, height: 50 });
    const first = clipPathSvgForParentBounds(
      transform({ x: 100, y: 50, width: 600, height: 50 }),
      parent,
    );
    const later = clipPathSvgForParentBounds(
      transform({ x: 0, y: 50, width: 600, height: 50 }),
      parent,
    );

    expect(first).not.toBe(later);
    expect(first).toContain('M 0 0');
    expect(later).toContain('M 100 0');
  });

  it('uses rotated polygons for visible diagnostic bounds', () => {
    const visible = intersectTransformBounds(
      transform({ width: 300, height: 200 }),
      transform({ x: 80, y: 40, width: 100, height: 60, rotation: 30 }),
    );
    expect(visible).not.toBeNull();
    expect(visible!.width).toBeGreaterThan(100);
    expect(visible!.height).toBeGreaterThan(60);
  });
});
