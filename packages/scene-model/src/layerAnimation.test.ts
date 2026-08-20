import { describe, expect, it } from 'vitest';
import { createLayerKeyframe, createLayerOfKind, createLayerPropertyKeyframe } from './factory';
import {
  cubicBezierProgress,
  easedProgress,
  findLayerKeyframeAtFrame,
  getLayerTransformAtFrame,
  getLayerEffectsAtFrame,
  getLayerAnimatableProperties,
  getPaintAtFrame,
  getResolvedLayerAnimationTracks,
} from './layerAnimation';

const transform = (x: number) => ({
  x,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  transformOriginX: 0.5,
  transformOriginY: 0.5,
});

describe('independent layer animation', () => {
  it('samples only that layer keys on arbitrary frames', () => {
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = [
      createLayerKeyframe(3, transform(0), { easing: 'linear' }),
      createLayerKeyframe(13, transform(100), { easing: 'linear' }),
    ];
    expect(getLayerTransformAtFrame(layer, 0).x).toBe(0);
    expect(getLayerTransformAtFrame(layer, 8).x).toBe(50);
    expect(getLayerTransformAtFrame(layer, 20).x).toBe(100);
    expect(findLayerKeyframeAtFrame(layer, 13)?.transform.x).toBe(100);
  });

  it('applies the destination key easing without changing key timing', () => {
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = [
      createLayerKeyframe(0, transform(0)),
      createLayerKeyframe(10, transform(100), { easing: 'ease-in' }),
    ];
    expect(getLayerTransformAtFrame(layer, 5).x).toBe(25);
  });

  it('keeps evaluated animation subpixel-precise between integer authored keys', () => {
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = [
      createLayerKeyframe(0, transform(0), { easing: 'linear' }),
      createLayerKeyframe(10, transform(101), { easing: 'linear' }),
    ];

    expect(getLayerTransformAtFrame(layer, 5).x).toBe(50.5);
  });

  it('samples overshoot and bounce trajectories deterministically', () => {
    expect(easedProgress(0, 'elastic-out')).toBe(0);
    expect(easedProgress(1, 'elastic-out')).toBe(1);
    expect(easedProgress(0.5, 'back-out')).toBeGreaterThan(1);
    expect(easedProgress(0.5, 'bounce-in-out')).toBe(0.5);
  });

  it('evaluates position, size, alpha, and effects on independent property timings', () => {
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = [createLayerKeyframe(0, transform(0))];
    layer.animationTracks = {
      x: [
        createLayerPropertyKeyframe(0, 0, { easing: 'linear' }),
        createLayerPropertyKeyframe(10, 100, { easing: 'linear' }),
      ],
      y: [
        createLayerPropertyKeyframe(0, 0, { easing: 'linear' }),
        createLayerPropertyKeyframe(20, 100, { easing: 'linear' }),
      ],
      opacity: [
        createLayerPropertyKeyframe(0, 0, { easing: 'linear' }),
        createLayerPropertyKeyframe(5, 1, { easing: 'linear' }),
      ],
      blur: [
        createLayerPropertyKeyframe(0, 0, { easing: 'linear' }),
        createLayerPropertyKeyframe(20, 20, { easing: 'linear' }),
      ],
    };

    expect(getLayerTransformAtFrame(layer, 10)).toMatchObject({ x: 100, y: 50, opacity: 1 });
    expect(getLayerEffectsAtFrame(layer, 10).blur).toBe(10);
  });

  it('samples editable cubic Bézier curves deterministically', () => {
    const curve = { x1: 0.42, y1: 0, x2: 1, y2: 1 };
    expect(cubicBezierProgress(0, curve)).toBeCloseTo(0);
    expect(cubicBezierProgress(1, curve)).toBeCloseTo(1);
    expect(cubicBezierProgress(0.5, curve)).toBeLessThan(0.5);
  });

  it('animates each gradient stop offset on its own incoming-eased track', () => {
    const layer = createLayerOfKind('rectangle');
    if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle.');
    layer.element.fill = {
      type: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: '#ffffff', opacity: 1 },
        { offset: 0.25, color: '#ffffff', opacity: 0.5 },
        { offset: 1, color: '#000000', opacity: 1 },
      ],
    };
    layer.animationTracks['fill.stops[1].offset'] = [
      createLayerPropertyKeyframe(0, 0.25, { easing: 'linear' }),
      createLayerPropertyKeyframe(10, 0.75, { easing: 'linear' }),
    ];

    expect(getLayerAnimatableProperties(layer)).toContain('fill.stops[1].offset');
    const paint = getPaintAtFrame(layer.element.fill, getResolvedLayerAnimationTracks(layer), 5);
    expect(typeof paint === 'string' ? null : paint.stops[1]?.offset).toBe(0.5);
  });
});
