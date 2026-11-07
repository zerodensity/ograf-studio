import { describe, expect, it } from 'vitest';
import { createComposition, createLayerOfKind } from './factory';
import { createDefaultGradient } from './paint';
import { createShaderPaint } from './shader';
import { createMediaPaint } from './mediaPaint';
import { getLayerTransformAtFrame } from './layerAnimation';
import {
  compositionBackgroundLayer,
  compositionLayersWithBackground,
  backgroundStylesErrors,
} from './compositionBackgroundPaint';

describe('render-only composition background paint', () => {
  it('does not create a render layer for a legacy background color', () => {
    const composition = createComposition({ backgroundColor: '#112233' });
    expect(compositionBackgroundLayer(composition)).toBeNull();
    expect(compositionLayersWithBackground(composition)).toEqual(composition.layers);
  });

  it('creates a stable locked full-canvas rectangle without inserting an authored object', () => {
    const composition = createComposition({ width: 1280, height: 720, backgroundPaint: '#112233' });
    const original = structuredClone(composition);
    const first = compositionBackgroundLayer(composition)!;
    const second = compositionBackgroundLayer(composition)!;
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      name: 'Composition background',
      isLocked: true,
      isGuide: false,
      isVisible: true,
      parentId: null,
      bindings: [],
      element: { type: 'rectangle', fill: '#112233', strokeWidth: 0 },
    });
    for (const frame of [0, 12, 100])
      expect(getLayerTransformAtFrame(first, frame)).toMatchObject({
        x: 0,
        y: 0,
        width: 1280,
        height: 720,
        rotation: 0,
        opacity: 1,
      });
    expect(composition).toEqual(original);
  });

  it('keeps transparent gradients independent and paints below every authored layer', () => {
    const foreground = createLayerOfKind('text');
    const composition = createComposition({
      layers: [foreground],
      backgroundPaint: createDefaultGradient('radial'),
    });
    const layers = compositionLayersWithBackground(composition);
    expect(layers).toHaveLength(2);
    expect(layers[1]).toBe(foreground);
    expect(layers[0]!.element).toMatchObject({
      type: 'rectangle',
      fill: { type: 'radial', stops: [{ opacity: 0.34 }, { opacity: 0.42 }] },
    });
    if (layers[0]!.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    const paint = layers[0]!.element.fill;
    if (typeof paint === 'string' || !('stops' in paint)) throw new Error('Expected gradient.');
    paint.stops[0]!.opacity = 0;
    expect(composition.backgroundPaint).toMatchObject({
      stops: [{ opacity: 0.34 }, { opacity: 0.42 }],
    });
  });

  it('preserves shader and Media paints without adding bindings or changing their clock settings', () => {
    const shader = createShaderPaint({
      fragmentSource: 'void mainImage(out vec4 c,in vec2 p){c=vec4(sin(iTime),0.0,0.0,0.5);}',
      speed: 2,
      resolutionScale: 0.5,
    });
    const media = createMediaPaint({
      source: { kind: 'live', tag: 'camera-1' },
      fit: 'cover',
      speed: 0.75,
    });
    for (const paint of [shader, media]) {
      const layer = compositionBackgroundLayer(createComposition({ backgroundPaint: paint }))!;
      expect(layer.element).toMatchObject({ type: 'rectangle', fill: paint });
      expect(layer.bindings).toEqual([]);
      expect(layer.loop).toBeNull();
    }
  });

  it('uses a deterministic collision-safe ID and rebuilds dimensions after canvas changes', () => {
    const composition = createComposition({ backgroundPaint: 'transparent' });
    const first = compositionBackgroundLayer(composition)!;
    const authored = createLayerOfKind('rectangle');
    authored.id = first.id;
    composition.layers.push(authored);
    const collisionSafe = compositionBackgroundLayer(composition)!;
    expect(collisionSafe.id).not.toBe(authored.id);
    expect(compositionBackgroundLayer(composition)!.id).toBe(collisionSafe.id);
    composition.width = 640;
    composition.height = 360;
    expect(compositionBackgroundLayer(composition)!.keyframes[0]!.transform).toMatchObject({
      width: 640,
      height: 360,
    });
  });
});

describe('background style catalog validation', () => {
  it('accepts reusable solid, gradient, shader and Media backgrounds', () => {
    const paints = [
      '#223344',
      createDefaultGradient('radial'),
      createShaderPaint(),
      createMediaPaint({ source: { kind: 'live', tag: 'camera-1' } }),
    ];
    expect(
      backgroundStylesErrors(
        paints.map((paint, index) => ({
          id: `background-${index}`,
          name: `Background ${index}`,
          paint,
        })),
      ),
    ).toEqual([]);
    expect(backgroundStylesErrors([])).toEqual([]);
  });

  it('strictly checks catalog structure, IDs, names, limits and duplicate identities', () => {
    const style = { id: 'background', name: 'Background', paint: '#112233' };
    for (const styles of [
      null,
      {},
      'not-array',
      [null],
      [[]],
      [7],
      [{ ...style, id: '' }],
      [{ ...style, id: 'a'.repeat(101) }],
      [{ ...style, name: '' }],
      [{ ...style, name: 'a'.repeat(257) }],
      [{ ...style, name: 12 }],
      [{ ...style, extra: 'not allowed' }],
      Array.from({ length: 257 }, () => style),
    ]) {
      expect(() => backgroundStylesErrors(styles)).not.toThrow();
      expect(backgroundStylesErrors(styles)).not.toHaveLength(0);
    }
    expect(backgroundStylesErrors([style, style])).toContain(
      'Duplicate background style ID: background.',
    );
  });

  it('reports malformed paints and gradient stops as errors instead of throwing', () => {
    const gradient = createDefaultGradient();
    for (const paint of [
      null,
      undefined,
      3,
      '',
      { ...gradient, stops: [null, null] },
      { ...gradient, stops: [{ offset: 0, color: 4, opacity: 1 }, gradient.stops[1]] },
      { ...gradient, stops: 'not-array' },
      { ...gradient, stops: [{ ...gradient.stops[0], offset: NaN }, gradient.stops[1]] },
      { type: 'media', source: null },
      { type: 'shader', fragmentSource: null },
    ]) {
      const styles = [{ id: 'bad', name: 'Bad', paint }];
      expect(() => backgroundStylesErrors(styles)).not.toThrow();
      expect(backgroundStylesErrors(styles)).not.toHaveLength(0);
    }
  });
});
