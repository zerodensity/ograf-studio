import { describe, expect, it } from 'vitest';
import { createDefaultTransform, createPathElement } from './factory';
import {
  createTextPathGeometry,
  layoutTextPathSegments,
  layoutTextPathUnits,
} from './textPathGeometry';

describe('text path geometry', () => {
  it('maps and samples path positions in the text layer local coordinates', () => {
    const path = createPathElement({ d: 'M0 0 L100 0', viewBoxWidth: 100, viewBoxHeight: 100 });
    const source = createDefaultTransform({
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    const text = createDefaultTransform({
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    const geometry = createTextPathGeometry(path, source, text);
    expect(geometry.length).toBeCloseTo(200);
    expect(geometry.sample(100)).toMatchObject({ x: 100, y: 0, angle: 0 });
    expect(geometry.sample(-1)).toBeNull();
    expect(geometry.sample(201)).toBeNull();
  });
  it('resolves source and target rotation without depending on playback order', () => {
    const path = createPathElement({ d: 'M0 0 L100 0', viewBoxWidth: 100, viewBoxHeight: 100 });
    const source = createDefaultTransform({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 90,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    const text = createDefaultTransform({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 90,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    const geometry = createTextPathGeometry(path, source, text);
    const end = geometry.sample(geometry.length)!;
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(0);
    expect(end.angle).toBeCloseTo(0);
    expect(geometry.sample(20)).toEqual(geometry.sample(20));
  });
  it('accounts for source and target scale around their authored origins', () => {
    const path = createPathElement({ d: 'M0 0 L100 0', viewBoxWidth: 100, viewBoxHeight: 100 });
    const transform = createDefaultTransform({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    });
    const sourceScaled = createTextPathGeometry(path, transform, transform, 2, 1);
    expect(sourceScaled.sample(0)).toMatchObject({ x: -50, y: -50 });
    expect(sourceScaled.sample(sourceScaled.length)).toMatchObject({ x: 150, y: -50 });
    const textScaled = createTextPathGeometry(path, transform, transform, 1, 2);
    expect(textScaled.sample(0)).toMatchObject({ x: 25, y: 25 });
    expect(textScaled.sample(textScaled.length)).toMatchObject({ x: 75, y: 25 });
  });
  it('retains collinear cubic overshoot and rejects collapsed paths', () => {
    const transform = createDefaultTransform({ x: 0, y: 0, width: 100, height: 100 });
    const path = createPathElement({
      d: 'M0 0 C200 0 -100 0 100 0',
      viewBoxWidth: 100,
      viewBoxHeight: 100,
    });
    expect(createTextPathGeometry(path, transform, transform).length).toBeGreaterThan(100);
    expect(() =>
      createTextPathGeometry(createPathElement({ d: 'M0 0 L0 0' }), transform, transform),
    ).toThrow(/no length/);
    const repeated = createPathElement({
      d: 'M0 0 L0 0 L0 100',
      viewBoxWidth: 100,
      viewBoxHeight: 100,
    });
    expect(createTextPathGeometry(repeated, transform, transform).sample(0)?.angle).toBeCloseTo(90);
  });
  it('positions grapheme widths, including spaces, deterministically and clips at path ends', () => {
    const transform = createDefaultTransform({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      transformOriginX: 0,
      transformOriginY: 0,
    });
    const geometry = createTextPathGeometry(
      createPathElement({ d: 'M0 0 L100 0', viewBoxWidth: 100, viewBoxHeight: 100 }),
      transform,
      transform,
    );
    const centered = layoutTextPathUnits(geometry, [10, 4, 10], 0, 'center');
    centered.forEach((unit, index) => expect(unit?.x).toBeCloseTo([43, 50, 57][index]!));
    expect(layoutTextPathUnits(geometry, [10, 10], 96)).toEqual([null, null]);
  });
  it('preserves grapheme clusters and word animation boundaries', () => {
    const transform = createDefaultTransform({ x: 0, y: 0, width: 100, height: 100 });
    const geometry = createTextPathGeometry(
      createPathElement({ d: 'M0 0 L100 0', viewBoxWidth: 100, viewBoxHeight: 100 }),
      transform,
      transform,
    );
    const measure = (text: string) => [...text].length * 4;
    const graphemes = layoutTextPathSegments(geometry, 'A👩‍🚀 B', 'grapheme', measure);
    expect(graphemes.map((item) => item.text)).toEqual(['A', '👩‍🚀', ' ', 'B']);
    const words = layoutTextPathSegments(geometry, 'NEWS NOW', 'word', measure);
    expect(words.map((item) => item.animated)).toEqual([true, false, true]);
    expect(() => layoutTextPathSegments(geometry, 'one\ntwo', 'word', measure)).toThrow(/one line/);
  });
  it('bounds work for long updates instead of measuring growing prefixes', () => {
    const transform = createDefaultTransform({ x: 0, y: 0, width: 10000, height: 100 });
    const geometry = createTextPathGeometry(
      createPathElement({ d: 'M0 0 L10000 0', viewBoxWidth: 10000, viewBoxHeight: 100 }),
      transform,
      transform,
    );
    const lengths: number[] = [];
    expect(
      layoutTextPathSegments(geometry, 'A'.repeat(512), 'grapheme', (value) => {
        lengths.push(value.length);
        return value.length;
      }),
    ).toHaveLength(512);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(2);
    expect(lengths.length).toBeLessThanOrEqual(1024);
    expect(() =>
      layoutTextPathSegments(geometry, 'A'.repeat(513), 'grapheme', (value) => value.length),
    ).toThrow(/segment limit/);
  });
});
