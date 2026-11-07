import { describe, expect, it } from 'vitest';
import { validateProject } from '@ograf-editor/validation';
import {
  addEffect,
  addLayerModifier,
  createComposition,
  createProject,
  createDefaultGradient,
  createDefaultTransform,
  createFieldDefinition,
  createLayerKeyframe,
  createLayerLoopClip,
  createLayerOfKind,
  createLayerPropertyKeyframe,
  createLayerVisualRule,
  createKeyframe,
  createTransition,
  createShaderPaint,
  effectProperty,
  getLayerPropertyValueAtFrame,
  getEffectStack,
  getLayerPropertyWithLighting,
  getLayerTransformAtFrame,
  getResolvedLayerAnimationTracks,
  isLayerPropertyAnimated,
  modifierProperty,
  resetLayerPropertyAnimation,
  setLayerLighting,
  setTilingPattern,
  type AnimatableLayerProperty,
} from './index';

const keys = (from: number, to: number) => [
  createLayerPropertyKeyframe(0, from),
  createLayerPropertyKeyframe(10, to),
];

function fixture(kind: 'rectangle' | 'text' = 'rectangle') {
  const composition = createComposition();
  const layer = createLayerOfKind(kind);
  layer.animationTrackMode = 'independent';
  layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ x: 100, y: 200 }))];
  composition.layers.push(layer);
  return { composition, layer };
}

describe('reset one property animation', () => {
  it.each([
    ['main', 0, 1],
    ['main', 1, 0],
    ['loop', 0, 1],
    ['loop', 1, 0],
  ] as const)(
    'freezes visible Alpha for %s easing overshoot from %i to %i and retains a valid project',
    (driver, from, to) => {
      const { composition, layer } = fixture();
      const track = keys(from, to);
      track[1]!.easing = 'back-out';
      if (driver === 'main') layer.animationTracks.opacity = track;
      else layer.loop = createLayerLoopClip({ durationFrames: 10, tracks: { opacity: track } });
      const project = createProject({
        compositions: [composition],
        mainCompositionId: composition.id,
      });
      expect(validateProject(project).errors).toEqual([]);
      const sampled = getLayerPropertyWithLighting(
        layer,
        [],
        'opacity',
        6,
        driver === 'loop' ? 6 : undefined,
      );
      if (to === 1) expect(sampled).toBeGreaterThan(1);
      else expect(sampled).toBeLessThan(0);
      const frozen = resetLayerPropertyAnimation(layer, 'opacity', 6, {
        composition,
        ...(driver === 'loop' ? { loopElapsedFrames: 6 } : {}),
      });
      expect(frozen).toBe(to);
      expect(layer.animationTracks.opacity).toBeUndefined();
      expect(layer.loop?.tracks.opacity).toBeUndefined();
      for (const frame of [0, 6, 12, 24])
        expect(getLayerTransformAtFrame(layer, frame).opacity).toBe(to);
      expect(validateProject(project).errors).toEqual([]);
    },
  );

  it.each(['width', 'height'] as const)(
    'rejects a nonpositive or subpixel %s sample atomically',
    (property) => {
      for (const [from, to, easing, frame] of [
        [100, 1, 'back-out', 6],
        [1, 2, 'back-in', 3],
      ] as const) {
        const { composition, layer } = fixture();
        const track = keys(from, to);
        track[1]!.easing = easing;
        layer.animationTracks[property] = track;
        expect(getLayerPropertyValueAtFrame(layer, property, frame)).toBeLessThan(1);
        const before = structuredClone(layer);
        expect(() => resetLayerPropertyAnimation(layer, property, frame, { composition })).toThrow(
          'at least 1 pixel',
        );
        expect(layer).toEqual(before);
        const project = createProject({
          compositions: [composition],
          mainCompositionId: composition.id,
        });
        expect(validateProject(project).errors).toEqual([]);
      }
    },
  );

  it.each(['x', 'y'] as const)(
    'retains fractional %s samples when freezing a valid transform',
    (property) => {
      const { layer } = fixture();
      layer.animationTracks[property] = keys(1.25, 5.75);
      const sampled = getLayerPropertyValueAtFrame(layer, property, 3);
      expect(Number.isInteger(sampled)).toBe(false);
      expect(resetLayerPropertyAnimation(layer, property, 3)).toBe(sampled);
      expect(getLayerPropertyValueAtFrame(layer, property, 100)).toBe(sampled);
    },
  );

  it('freezes the evaluated playhead value and removes only the selected main and loop channel', () => {
    const { composition, layer } = fixture();
    layer.animationTracks = { x: keys(100, 300), y: keys(200, 500) };
    layer.keyframes.push(createLayerKeyframe(10, getLayerTransformAtFrame(layer, 10)));
    layer.loop = createLayerLoopClip({
      durationFrames: 10,
      phaseOffsetFrames: 2,
      tracks: { x: keys(0, 100), y: keys(200, 300) },
    });
    const y = structuredClone(layer.animationTracks.y);
    const loop = structuredClone(layer.loop);
    expect(resetLayerPropertyAnimation(layer, 'x', 17, { composition })).toBe(70);
    expect(layer.animationTracks.x).toBeUndefined();
    expect(layer.loop.tracks.x).toBeUndefined();
    expect(layer.animationTracks.y).toEqual(y);
    delete loop.tracks.x;
    expect(layer.loop).toEqual(loop);
    for (const frame of [0, 5, 17, 24, 100])
      expect(getLayerPropertyValueAtFrame(layer, 'x', frame)).toBe(70);
    expect(isLayerPropertyAnimated(layer, 'x')).toBe(false);
  });

  it('preserves legacy motion on every other channel while opting out of the selected channel', () => {
    const { layer } = fixture();
    delete layer.animationTrackMode;
    layer.keyframes = [
      createLayerKeyframe(0, createDefaultTransform({ x: 100, y: 200 })),
      createLayerKeyframe(10, createDefaultTransform({ x: 300, y: 700 })),
      createLayerKeyframe(20, createDefaultTransform({ x: 900, y: 300 })),
    ];
    const before = [0, 5, 10, 15, 20, 30].map((frame) => getLayerTransformAtFrame(layer, frame));
    const y = getResolvedLayerAnimationTracks(layer).y;
    resetLayerPropertyAnimation(layer, 'x', 4);
    expect(layer.animationTrackMode).toBe('independent');
    expect(layer.animationTracks.x).toBeUndefined();
    expect(layer.animationTracks.y).toEqual(y);
    expect(layer.animationTracks.blur).toBeUndefined();
    for (const [index, frame] of [0, 5, 10, 15, 20, 30].entries())
      expect(getLayerTransformAtFrame(layer, frame)).toEqual({ ...before[index], x: 180 });
  });

  it.each([
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'opacity',
    'transformOriginX',
    'transformOriginY',
  ] as const)('freezes transform %s without a hidden return at lifecycle markers', (property) => {
    const { composition, layer } = fixture();
    const unit = property === 'opacity' || property.startsWith('transformOrigin');
    layer.animationTracks[property] = keys(unit ? 0.2 : 10, unit ? 0.8 : 30);
    const frozen = getLayerPropertyValueAtFrame(layer, property, 5);
    expect(resetLayerPropertyAnimation(layer, property, 5, { composition })).toBe(frozen);
    for (const frame of [0, 5, 12, 24])
      expect(getLayerPropertyValueAtFrame(layer, property, frame)).toBe(frozen);
  });

  it.each([
    'legacy-effect',
    'stack-effect',
    'modifier',
    'shader',
    'gradient',
    'stroke',
    'motion-path',
  ] as const)('stores the frozen value in the existing %s field', (kind) => {
    const { composition, layer } = fixture(
      kind === 'stroke' || kind === 'modifier' ? 'text' : 'rectangle',
    );
    let property: AnimatableLayerProperty = 'blur';
    let range = [2, 8];
    if (kind === 'stack-effect')
      property = effectProperty(addEffect(layer, 'glow'), 'radius') as AnimatableLayerProperty;
    if (kind === 'modifier') {
      const modifier = addLayerModifier(layer, 'max-text-width', { maxWidth: 600 });
      property = modifierProperty(modifier, 'maxWidth');
      range = [100, 400];
    }
    if (kind === 'shader') {
      if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle');
      layer.element.fill = createShaderPaint({
        fragmentSource:
          '#pragma ograf strength slider min(0) max(100)\nconst float strength = 0.0;\nvoid mainImage(out vec4 c, in vec2 p) { c=vec4(vec3(strength),1.0); }',
      });
      property = 'fill.parameters.strength';
    }
    if (kind === 'gradient') {
      if (layer.element.type !== 'rectangle') throw new Error('Expected rectangle');
      layer.element.fill = createDefaultGradient();
      property = 'fill.stops[1].offset';
      range = [0.4, 1];
    }
    if (kind === 'stroke') property = 'strokeWidth';
    if (kind === 'motion-path') {
      layer.motionPath = {
        sourceLayerId: 'path',
        progress: 0,
        orientToPath: false,
        offsetX: 0,
        offsetY: 0,
        rotationOffset: 0,
      };
      property = 'motionPathProgress';
      range = [0.2, 0.8];
    }
    layer.animationTracks[property] = keys(range[0]!, range[1]!);
    const expected = getLayerPropertyValueAtFrame(layer, property, 5);
    expect(resetLayerPropertyAnimation(layer, property, 5, { composition })).toBe(expected);
    expect(layer.animationTracks[property]).toBeUndefined();
    expect(getLayerPropertyValueAtFrame(layer, property, 0)).toBe(expected);
    expect(getLayerPropertyValueAtFrame(layer, property, 100)).toBe(expected);
  });

  it('samples lifecycle loops only inside their activation window and honors finite repeats', () => {
    for (const [frame, expected] of [
      [6, 220],
      [17, 50],
      [22, 100],
      [24, 300],
    ]) {
      const { composition, layer } = fixture();
      layer.animationTracks.x = keys(100, 300);
      layer.loop = createLayerLoopClip({
        durationFrames: 10,
        repeatCount: 1,
        tracks: { x: keys(0, 100) },
      });
      expect(resetLayerPropertyAnimation(layer, 'x', frame!, { composition })).toBe(expected);
    }
  });

  it('does not enable a disabled legacy effect when its animation is reset', () => {
    const { layer } = fixture();
    layer.effects.stack = getEffectStack(layer.effects).map((entry) => ({
      ...entry,
      enabled: false,
    }));
    layer.animationTracks.blur = keys(2, 8);
    const stack = structuredClone(layer.effects.stack);
    resetLayerPropertyAnimation(layer, 'blur', 5);
    expect(layer.effects.blur).toBe(5);
    expect(layer.effects.stack).toEqual(stack);
    expect(layer.effects.dropShadowEnabled).toBe(false);
  });

  it('honors the default timing field when mapping the playhead to a stretched loop hold', () => {
    const { composition, layer } = fixture();
    const hold = createFieldDefinition('number', { defaultValue: 0.4 });
    composition.dataFields.push(hold);
    layer.loop = createLayerLoopClip({
      durationFrames: 10,
      tracks: { x: keys(0, 100) },
      timing: {
        groupId: 'timed',
        holdFieldId: hold.id,
        holdRanges: [{ startFrame: 0, endFrame: 4 }],
      },
    });
    expect(resetLayerPropertyAnimation(layer, 'x', 17, { composition })).toBe(20);
  });

  it('uses only the selected Step activation window and accepts an explicit inactive loop sample', () => {
    for (const [frame, expected] of [
      [13, 10],
      [17, 300],
    ]) {
      const { composition, layer } = fixture();
      const [start, first, end] = composition.keyframes;
      const second = createKeyframe({ name: 'Second', role: 'step' });
      composition.keyframes = [start!, first!, second, end!];
      composition.transitions = [
        createTransition(start!.id, first!.id, { durationFrames: 12 }),
        createTransition(first!.id, second.id, { durationFrames: 4 }),
        createTransition(second.id, end!.id, { durationFrames: 8 }),
      ];
      layer.animationTracks.x = keys(100, 300);
      layer.loop = createLayerLoopClip({
        durationFrames: 10,
        activation: { type: 'step', stepKeyframeId: first!.id },
        tracks: { x: keys(0, 100) },
      });
      expect(resetLayerPropertyAnimation(layer, 'x', frame!, { composition })).toBe(expected);
    }
    const { composition, layer } = fixture();
    layer.animationTracks.x = keys(100, 300);
    layer.loop = createLayerLoopClip({ durationFrames: 10, tracks: { x: keys(0, 100) } });
    expect(
      resetLayerPropertyAnimation(layer, 'x', 17, { composition, loopElapsedFrames: null }),
    ).toBe(300);
  });

  it('supports an explicit held/custom-action loop time and otherwise treats custom loops as inactive', () => {
    for (const explicit of [true, false]) {
      const { composition, layer } = fixture();
      layer.animationTracks.x = keys(100, 300);
      layer.loop = createLayerLoopClip({
        durationFrames: 10,
        activation: { type: 'customAction', customActionId: 'burst' },
        tracks: { x: keys(0, 100) },
      });
      expect(
        resetLayerPropertyAnimation(layer, 'x', 5, {
          composition,
          ...(explicit ? { loopElapsedFrames: 7 } : {}),
        }),
      ).toBe(explicit ? 70 : 200);
    }
  });

  it('preserves shared light phase and other channels while guarding lighting-owned reset atomically', () => {
    const { composition, layer } = fixture();
    const pattern = setTilingPattern(composition, { lighting: { cycleFrames: 20, phase: 0.25 } });
    layer.loop = createLayerLoopClip({
      durationFrames: 10,
      tracks: { x: keys(0, 100), opacity: keys(0, 1) },
    });
    setLayerLighting(composition, layer.id, {
      patternId: pattern.id,
      role: 'glow',
      phaseOffset: 0,
      gain: 1,
      cyclesPerLoop: 1,
    });
    const before = structuredClone(layer);
    expect(() => resetLayerPropertyAnimation(layer, 'opacity', 17, { composition })).toThrow(
      'Unlink shared lighting',
    );
    expect(layer).toEqual(before);
    const opacity = getLayerPropertyWithLighting(layer, composition.patterns, 'opacity', 17, 5);
    expect(resetLayerPropertyAnimation(layer, 'x', 17, { composition })).toBe(50);
    expect(layer.lighting).toEqual(before.lighting);
    expect(layer.loop?.tracks.opacity).toEqual(before.loop!.tracks.opacity);
    expect(getLayerPropertyWithLighting(layer, composition.patterns, 'opacity', 17, 5)).toBe(
      opacity,
    );
  });

  it('guards every gain-controlled glow channel without detaching its shared lighting link', () => {
    const { composition, layer } = fixture();
    const glow = addEffect(layer, 'glow');
    const pattern = setTilingPattern(composition, { lighting: {} });
    setLayerLighting(composition, layer.id, {
      patternId: pattern.id,
      role: 'glow',
      phaseOffset: 0,
      gain: 1,
      cyclesPerLoop: 1,
    });
    for (const property of [
      'blur',
      'dropShadowBlur',
      effectProperty(glow, 'radius'),
    ] as AnimatableLayerProperty[]) {
      layer.animationTracks[property] = keys(2, 8);
      const before = structuredClone(layer);
      expect(() => resetLayerPropertyAnimation(layer, property, 5, { composition })).toThrow(
        'Unlink shared lighting',
      );
      expect(layer).toEqual(before);
    }
  });

  it.each(['scale', 'clipLeft', 'clipRight', 'clipTop', 'clipBottom'] as const)(
    'returns virtual %s to neutral without new metadata',
    (property) => {
      const { composition, layer } = fixture();
      layer.animationTracks[property] = keys(0.1, 0.7);
      layer.loop = createLayerLoopClip({ tracks: { [property]: keys(0.2, 0.5) } });
      expect(resetLayerPropertyAnimation(layer, property, 5, { composition })).toBe(
        property === 'scale' ? 1 : 0,
      );
      expect(layer.animationTracks[property]).toBeUndefined();
      expect(layer.loop.tracks[property]).toBeUndefined();
      expect(getLayerPropertyValueAtFrame(layer, property, 100)).toBe(property === 'scale' ? 1 : 0);
    },
  );

  it('retains bindings and visual rules, cleans orphan summary keys and keeps the base pose', () => {
    const { layer } = fixture();
    layer.animationTracks.x = keys(100, 300);
    layer.bindings = [{ fieldId: 'position', targetProperty: 'transform.x' }];
    layer.visualRules = [createLayerVisualRule({ trigger: 'click' })];
    layer.keyframes.push(createLayerKeyframe(10, getLayerTransformAtFrame(layer, 10)));
    const bindings = layer.bindings;
    const rules = layer.visualRules;
    resetLayerPropertyAnimation(layer, 'x', 5);
    expect(layer.keyframes.map((key) => key.frame)).toEqual([0]);
    expect(layer.bindings).toBe(bindings);
    expect(layer.visualRules).toBe(rules);
  });

  it('rejects locked, invalid and unavailable requests before changing source', () => {
    const { layer } = fixture();
    layer.animationTracks.x = keys(100, 300);
    layer.isLocked = true;
    const before = structuredClone(layer);
    expect(() => resetLayerPropertyAnimation(layer, 'x', 5)).toThrow('Unlock');
    expect(layer).toEqual(before);
    layer.isLocked = false;
    const unlocked = structuredClone(layer);
    expect(() => resetLayerPropertyAnimation(layer, 'strokeWidth', 5)).toThrow('unavailable');
    expect(() => resetLayerPropertyAnimation(layer, 'x', NaN)).toThrow('finite');
    expect(() =>
      resetLayerPropertyAnimation(layer, 'x', 5, { loopElapsedFrames: Infinity }),
    ).toThrow('finite');
    expect(layer).toEqual(unlocked);
  });
});
