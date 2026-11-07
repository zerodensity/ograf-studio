import { isGradientPaint } from './paint';
import { describe, expect, it } from 'vitest';
import {
  createLayerKeyframe,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createLayerLoopClip,
} from './factory';
import {
  cubicBezierProgress,
  easedProgress,
  findLayerKeyframeAtFrame,
  getLayerTransformAtFrame,
  getLayerEffectsAtFrame,
  getLayerAnimatableProperties,
  getLayerPropertyValueAtFrame,
  getPaintAtFrame,
  getResolvedLayerAnimationTracks,
  isLayerPropertyAnimated,
  findLayerPropertyKeyframeAtFrame,
  TRANSFORM_ANIMATION_PROPERTIES,
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
  it('recognizes legacy pose animation without treating static effect fallbacks as authored keys', () => {
    const layer = createLayerOfKind('rectangle');
    expect(isLayerPropertyAnimated(layer, 'x')).toBe(false);
    expect(isLayerPropertyAnimated(layer, 'blur')).toBe(false);
    layer.keyframes = [createLayerKeyframe(0, transform(100))];
    expect(isLayerPropertyAnimated(layer, 'x')).toBe(true);
    expect(isLayerPropertyAnimated(layer, 'blur')).toBe(false);
    expect(findLayerPropertyKeyframeAtFrame(layer, 'blur', 0)).toBeUndefined();
    layer.animationTracks.blur = [createLayerPropertyKeyframe(0, 0)];
    expect(isLayerPropertyAnimated(layer, 'blur')).toBe(true);
    expect(findLayerPropertyKeyframeAtFrame(layer, 'blur', 0)).toBeDefined();
  });

  it('uses a static base for opted-in missing channels instead of aggregate lifecycle snapshots', () => {
    const layer = createLayerOfKind('rectangle');
    layer.animationTrackMode = 'independent';
    layer.keyframes = [
      createLayerKeyframe(0, { ...transform(100), opacity: 1 }),
      createLayerKeyframe(12, { ...transform(100), opacity: 0.2 }),
      createLayerKeyframe(24, { ...transform(20), opacity: 0 }),
    ];
    layer.animationTracks = {
      x: [createLayerPropertyKeyframe(0, 100), createLayerPropertyKeyframe(7, 700)],
    };
    expect(getLayerTransformAtFrame(layer, 24)).toMatchObject({ x: 700, opacity: 1 });
    expect(getResolvedLayerAnimationTracks(layer).opacity).toMatchObject([{ frame: 0, value: 1 }]);
    expect(isLayerPropertyAnimated(layer, 'x')).toBe(true);
    expect(isLayerPropertyAnimated(layer, 'opacity')).toBe(false);
    expect(findLayerPropertyKeyframeAtFrame(layer, 'opacity', 0)).toBeUndefined();
    delete layer.animationTrackMode;
    expect(getLayerTransformAtFrame(layer, 24).opacity).toBe(0);
    expect(isLayerPropertyAnimated(layer, 'opacity')).toBe(true);
  });

  it.each(['rectangle', 'text', 'shader', 'ticker'] as const)(
    'samples a complete %s pose exactly like independent property reads through delays, curves and loop boundaries',
    (kind) => {
      const layer = createLayerOfKind(kind);
      layer.semantics = {
        role: 'container',
        tags: ['pose-parity'],
        description: 'Semantic metadata must not affect sampling.',
      };
      layer.keyframes = [
        createLayerKeyframe(
          30,
          {
            ...transform(130),
            y: -20,
            width: 240,
            height: 60,
            rotation: 27,
            opacity: 0.7,
            transformOriginX: 0.2,
            transformOriginY: 0.9,
          },
          { easing: 'quad-out' },
        ),
        createLayerKeyframe(0, {
          ...transform(10),
          y: 20,
          width: 120,
          height: 80,
          rotation: -12,
          opacity: 0.8,
          transformOriginY: 0.1,
        }),
      ];
      // Mixed explicit and legacy channels intentionally have independent, unsorted timings.
      layer.animationTracks = {
        x: [
          createLayerPropertyKeyframe(30, 125.5, { easing: 'bounce-out' }),
          createLayerPropertyKeyframe(7, 10.25),
          createLayerPropertyKeyframe(18, 65.75, {
            easing: 'linear',
            curve: { x1: 0.2, y1: 0.05, x2: 0.8, y2: 0.95 },
          }),
        ],
        opacity: [createLayerPropertyKeyframe(12, 1), createLayerPropertyKeyframe(8, 0)],
        transformOriginX: [
          createLayerPropertyKeyframe(0, 0.25),
          createLayerPropertyKeyframe(24, 0.75),
        ],
      };
      layer.loop = createLayerLoopClip({
        durationFrames: 10,
        phaseOffsetFrames: 3,
        tracks: { x: [createLayerPropertyKeyframe(0, 900), createLayerPropertyKeyframe(10, 950)] },
      });
      const before = structuredClone(layer);
      for (const frame of [-3, 0, 6.5, 7, 8, 9.25, 12, 17.5, 24, 30, 75, 0]) {
        const expected = Object.fromEntries(
          TRANSFORM_ANIMATION_PROPERTIES.map((property) => [
            property,
            getLayerPropertyValueAtFrame(layer, property, frame),
          ]),
        );
        expect(getLayerTransformAtFrame(layer, frame)).toEqual(expected);
      }
      expect(layer).toEqual(before);
      // No cross-frame cache may hide an authored edit, even when a caller edits a key in place.
      layer.animationTracks.x![0]!.value = 155.5;
      expect(getLayerTransformAtFrame(layer, 30).x).toBe(155.5);
      expect(getLayerTransformAtFrame(layer, 30).x).toBe(
        getLayerPropertyValueAtFrame(layer, 'x', 30),
      );
    },
  );

  it('retains the missing-keyframe error instead of fabricating a pose from explicit tracks alone', () => {
    const layer = createLayerOfKind('rectangle');
    layer.keyframes = [];
    layer.animationTracks.x = [createLayerPropertyKeyframe(0, 12)];
    expect(() => getLayerTransformAtFrame(layer, 0)).toThrow(
      `Layer "${layer.name}" has no animation keyframes.`,
    );
  });

  it('resolves unkeyed Spline progress from its authored path link and preserves explicit tracks', () => {
    const layer = createLayerOfKind('rectangle');
    layer.motionPath = {
      sourceLayerId: 'path',
      progress: 0.45,
      orientToPath: true,
      offsetX: 0,
      offsetY: 0,
      rotationOffset: 0,
    };
    expect(layer.animationTracks.motionPathProgress).toBeUndefined();
    expect(getResolvedLayerAnimationTracks(layer).motionPathProgress).toMatchObject([
      { frame: 0, value: 0.45 },
    ]);
    for (const frame of [0, 12, 24, 0])
      expect(getLayerPropertyValueAtFrame(layer, 'motionPathProgress', frame)).toBe(0.45);
    layer.animationTracks.motionPathProgress = [
      createLayerPropertyKeyframe(0, 0, { easing: 'linear' }),
      createLayerPropertyKeyframe(10, 1, { easing: 'linear' }),
    ];
    expect(getLayerPropertyValueAtFrame(layer, 'motionPathProgress', 5)).toBe(0.5);
    layer.motionPath = null;
    expect(getLayerAnimatableProperties(layer)).not.toContain('motionPathProgress');
  });

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
    expect(isGradientPaint(paint) ? paint.stops[1]?.offset : null).toBe(0.5);
  });

  it('exposes and samples text stroke width without creating invalid image tracks', () => {
    const text = createLayerOfKind('text');
    text.animationTracks.strokeWidth = [
      createLayerPropertyKeyframe(0, 0, { easing: 'linear' }),
      createLayerPropertyKeyframe(10, 8, { easing: 'linear' }),
    ];
    const image = createLayerOfKind('image');

    expect(getLayerAnimatableProperties(text)).toContain('strokeWidth');
    expect(getLayerPropertyValueAtFrame(text, 'strokeWidth', 5)).toBe(4);
    expect(getLayerAnimatableProperties(image)).not.toContain('strokeWidth');
  });
});
