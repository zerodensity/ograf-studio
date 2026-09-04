import { describe, expect, it } from 'vitest';
import { compileDescriptor } from '@ograf-editor/codegen';
import {
  createProject,
  createLayerOfKind,
  createLayerLoopClip,
  createLayerKeyframe,
  createDefaultTransform,
  createLayerPropertyKeyframe,
  setTilingPattern,
  setLayerLighting,
  addEffect,
  effectProperty,
  effectParameterValue,
  getLayerPropertyWithLighting,
  type EffectParameterProperty,
  patternRows,
  patternRowOffset,
} from '@ograf-editor/scene-model';
import {
  sampleCompiledLayerVisualState,
  compiledLoopElapsedFrames,
  interpolateCompiledLayerVisualState,
} from './loopRendering';

function fixture() {
  const c = createProject().compositions[0]!;
  const pattern = setTilingPattern(c, {
    lighting: { cycleFrames: 200, intensity: 0.5, glow: 0.5, softness: 2 },
  });
  const layer = createLayerOfKind('pattern');
  if (layer.element.type === 'pattern') layer.element.patternId = pattern.id;
  layer.keyframes = [createLayerKeyframe(0, createDefaultTransform({ opacity: 0.8 }))];
  layer.loop = createLayerLoopClip({
    durationFrames: 100,
    tracks: {
      x: [
        createLayerPropertyKeyframe(0, 0),
        createLayerPropertyKeyframe(50, 100),
        createLayerPropertyKeyframe(100, 0),
      ],
      blur: [
        createLayerPropertyKeyframe(0, 2),
        createLayerPropertyKeyframe(50, 8),
        createLayerPropertyKeyframe(100, 2),
      ],
    },
  });
  const fx = addEffect(layer, 'glow', { params: { radius: 10, color: '#00ffff', opacity: 0.3 } });
  c.layers.push(layer);
  setLayerLighting(c, layer.id, {
    patternId: pattern.id,
    role: 'glow',
    gain: 1,
    phaseOffset: 0,
    cyclesPerLoop: 1,
  });
  return { c, layer, pattern, fx };
}

describe('shared light runtime sampling', () => {
  it('synchronizes original curves and glow while leaving row offsets and paint intact', () => {
    const { c, layer, pattern, fx } = fixture();
    const compiled = compileDescriptor(c).layers[0]!;
    const before = structuredClone(layer);
    const atPeak = sampleCompiledLayerVisualState(compiled, 12, 100);
    expect(atPeak.transform.x).toBeCloseTo(100);
    expect(atPeak.transform.opacity).toBeCloseTo(0.2);
    expect(atPeak.effects.blur).toBeCloseTo(16);
    expect(effectParameterValue(atPeak.effects, effectProperty(fx, 'radius'))).toBe(20);
    expect(effectParameterValue(atPeak.effects, effectProperty(fx, 'color'))).toBe('#00ffff');
    expect(atPeak.patternFrame).toBe(100);
    expect(patternRowOffset(pattern, patternRows(pattern)[0]!, atPeak.patternFrame!)).toBe(
      patternRowOffset(pattern, patternRows(pattern)[0]!, 100),
    );
    expect(sampleCompiledLayerVisualState(compiled, 12, 300)).toEqual({
      ...atPeak,
      patternFrame: 300,
    });
    expect(layer).toEqual(before);
  });
  it('is repeatable across reverse seeks and matches agent numeric inspection', () => {
    const { c, layer, fx } = fixture();
    const compiled = compileDescriptor(c).layers[0]!;
    for (const elapsed of [0, 25, 200, 50, 1000, 25, 0]) {
      const state = sampleCompiledLayerVisualState(compiled, 12, elapsed);
      expect(state.transform.x).toBeCloseTo(
        getLayerPropertyWithLighting(layer, c.patterns, 'x', 12, elapsed),
      );
      expect(state.transform.opacity).toBeCloseTo(
        getLayerPropertyWithLighting(layer, c.patterns, 'opacity', 12, elapsed),
      );
      expect(state.effects.blur).toBeCloseTo(
        getLayerPropertyWithLighting(layer, c.patterns, 'blur', 12, elapsed),
      );
      expect(effectParameterValue(state.effects, effectProperty(fx, 'radius'))).toBeCloseTo(
        getLayerPropertyWithLighting(
          layer,
          c.patterns,
          effectProperty(fx, 'radius') as EffectParameterProperty,
          12,
          elapsed,
        ),
      );
    }
  });
  it('bypass restores the original local loop and unlink leaves it untouched', () => {
    const { c, layer, pattern } = fixture();
    setTilingPattern(c, { lighting: { enabled: false } }, pattern.id);
    const bypassed = sampleCompiledLayerVisualState(compileDescriptor(c).layers[0]!, 12, 25);
    setLayerLighting(c, layer.id, null);
    expect(sampleCompiledLayerVisualState(compileDescriptor(c).layers[0]!, 12, 25)).toEqual(
      bypassed,
    );
  });
  it('supports static lights and fades cleanly through direct lifecycle exits', () => {
    const { c, layer } = fixture();
    layer.loop = null;
    const descriptor = compileDescriptor(c),
      compiled = descriptor.layers[0]!;
    const step = descriptor.keyframes.find((k) => k.role === 'step')!.frame;
    expect(compiledLoopElapsedFrames(descriptor, compiled, step, 75)).toBe(75);
    const source = sampleCompiledLayerVisualState(compiled, step, 75);
    const target = { ...source, transform: { ...source.transform, opacity: 0 } };
    expect(
      interpolateCompiledLayerVisualState(compiled, source, target, 0.5, 24).transform.opacity,
    ).toBeCloseTo(0.1);
    expect(
      interpolateCompiledLayerVisualState(compiled, source, target, 1, 24).transform.opacity,
    ).toBe(0);
  });
});
