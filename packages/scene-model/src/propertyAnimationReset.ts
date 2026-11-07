import {
  EFFECT_ANIMATION_PROPERTIES,
  TRANSFORM_ANIMATION_PROPERTIES,
  getLayerPropertyValueAtFrame,
  getLayerTransformAtFrame,
  getResolvedLayerAnimationTracks,
  gradientStopIndexForProperty,
  isAnimatableLayerProperty,
  isAnimatableLayerPropertyApplicable,
  isRevealAnimationProperty,
  revealPropertyDefault,
  sortLayerKeyframes,
} from './layerAnimation';
import { createLayerKeyframe } from './factory';
import { computeKeyframeFrames } from './keyframeTiming';
import { timedLoopElapsedFrames } from './loopAnimation';
import { getLayerPropertyWithLighting } from './patternLighting';
import { getEffectStack, parseEffectProperty, withEffectParameter } from './effectStack';
import { normalizeLayerEffects } from './layerEffects';
import { parseModifierProperty, withModifierParameter } from './modifiers';
import { applyShaderAnimationValues, parseShaderAnimationProperty } from './shaderAnimation';
import { isGradientPaint } from './paint';
import { getElementShaderPaint, inspectShaderSource } from './shader';
import { shaderParameterTarget } from './shaderParameters';
import { shaderParameterFieldValue } from './shaderFields';
import type {
  AnimatableLayerProperty,
  Composition,
  Layer,
  LayerAnimationTracks,
  LayerTransform,
} from './types';

export interface ResetLayerPropertyAnimationOptions {
  /** Supplies the lifecycle activation window, hold-field default and shared-light phase. */
  composition?: Composition;
  /** Explicit authored elapsed frames for a held/custom-action loop; null means inactive. */
  loopElapsedFrames?: number | null;
}

function activeLoopElapsed(
  layer: Layer,
  frame: number,
  options: ResetLayerPropertyAnimationOptions,
): number | undefined {
  if (options.loopElapsedFrames !== undefined) return options.loopElapsedFrames ?? undefined;
  const composition = options.composition;
  if (!layer.loop || !composition) return undefined;
  const activation =
    layer.lighting || layer.element.type === 'pattern'
      ? { type: 'lifecycle' as const }
      : layer.loop.activation;
  if (activation.type === 'customAction') return undefined;
  const ruler = computeKeyframeFrames(composition).map((entry) => ({
    ...entry,
    role: composition.keyframes.find((key) => key.id === entry.keyframeId)?.role,
  }));
  const start =
    activation.type === 'lifecycle'
      ? ruler.find((key) => key.role === 'step')
      : ruler.find((key) => key.keyframeId === activation.stepKeyframeId);
  if (!start || frame < start.frame) return undefined;
  const end =
    activation.type === 'lifecycle'
      ? ruler.find((key) => key.role === 'end')
      : ruler.find((key) => key.frame > start.frame);
  if (end && frame >= end.frame) return undefined;
  const hold = composition.dataFields.find((field) => field.id === layer.loop?.timing?.holdFieldId);
  return timedLoopElapsedFrames(
    layer.loop,
    frame - start.frame,
    composition.frameRate,
    hold?.defaultValue,
  );
}

function lightingOwnsProperty(layer: Layer, property: AnimatableLayerProperty): boolean {
  if (!layer.lighting) return false;
  if (property === 'opacity') return true;
  if (layer.lighting.role !== 'glow') return false;
  if (property === 'blur' || property === 'dropShadowBlur') return true;
  const effect = parseEffectProperty(property);
  return Boolean(
    effect?.param === 'radius' &&
    getEffectStack(layer.effects).some(
      (entry) => entry.id === effect.id && ['blur', 'glow', 'drop-shadow'].includes(entry.type),
    ),
  );
}

function freezeProperty(layer: Layer, property: AnimatableLayerProperty, value: number): void {
  if (TRANSFORM_ANIMATION_PROPERTIES.includes(property as keyof LayerTransform)) {
    for (const key of layer.keyframes) key.transform[property as keyof LayerTransform] = value;
  } else if (parseShaderAnimationProperty(property))
    layer.element = applyShaderAnimationValues(layer.element, { [property]: value });
  else if (parseEffectProperty(property))
    layer.effects = withEffectParameter(layer.effects, property, value);
  else if (parseModifierProperty(property)) {
    const modifiers = withModifierParameter(layer, property, value).modifiers;
    if (modifiers) layer.modifiers = modifiers;
  } else if (property === 'strokeWidth' && layer.element.type === 'text')
    layer.element = { ...layer.element, strokeWidth: value };
  else if (property === 'motionPathProgress' && layer.motionPath)
    layer.motionPath = { ...layer.motionPath, progress: value };
  else if (
    EFFECT_ANIMATION_PROPERTIES.includes(property as (typeof EFFECT_ANIMATION_PROPERTIES)[number])
  )
    layer.effects = normalizeLayerEffects({ ...layer.effects, [property]: value });
  else {
    const index = gradientStopIndexForProperty(property);
    const fill = 'fill' in layer.element ? layer.element.fill : undefined;
    if (index !== null && isGradientPaint(fill))
      layer.element = {
        ...layer.element,
        fill: {
          ...fill,
          stops: fill.stops.map((stop, stopIndex) =>
            stopIndex === index ? { ...stop, offset: value } : stop,
          ),
        },
      } as Layer['element'];
  }
}

/** Remove one channel's main and local-loop animation, retaining its sampled authored value.
 * Data bindings, visual rules, shared light links, other channels and loop settings are untouched.
 * Reveal-only channels have no static field and return to their neutral value instead.
 */
export function resetLayerPropertyAnimation(
  layer: Layer,
  property: AnimatableLayerProperty,
  frame: number,
  options: ResetLayerPropertyAnimationOptions = {},
): number {
  if (layer.isLocked) throw new Error('Unlock the object before resetting its animation.');
  if (!Number.isFinite(frame) || frame < 0)
    throw new Error('Reset animation requires a finite, non-negative frame.');
  if (
    options.loopElapsedFrames != null &&
    (!Number.isFinite(options.loopElapsedFrames) || options.loopElapsedFrames < 0)
  )
    throw new Error('Loop elapsed frames must be finite and non-negative.');
  if (!isAnimatableLayerProperty(property) || !isAnimatableLayerPropertyApplicable(layer, property))
    throw new Error(`Animation property "${property}" is unavailable on this object.`);
  if (lightingOwnsProperty(layer, property))
    throw new Error('Unlink shared lighting before resetting this lighting-controlled property.');
  if (layer.lighting && layer.loop?.tracks[property]?.length && !options.composition)
    throw new Error('Resetting a shared-light loop requires its composition context.');

  const sampled = isRevealAnimationProperty(property)
    ? revealPropertyDefault(property)
    : getLayerPropertyWithLighting(
        layer,
        options.composition?.patterns ?? [],
        property,
        frame,
        activeLoopElapsed(layer, frame, options),
      );
  if (!Number.isFinite(sampled)) throw new Error('This animation has no finite value to freeze.');
  // CSS clamps alpha after easing, so retain the displayed value rather than an overshoot.
  const value = property === 'opacity' ? Math.max(0, Math.min(1, sampled)) : sampled;
  if ((property === 'width' || property === 'height') && value < 1)
    throw new Error('Reset Width/Height at a frame where the sampled size is at least 1 pixel.');

  const tracks: LayerAnimationTracks = { ...layer.animationTracks };
  if (layer.animationTrackMode !== 'independent') {
    const resolved = getResolvedLayerAnimationTracks(layer);
    for (const channel of TRANSFORM_ANIMATION_PROPERTIES)
      if (!tracks[channel]?.length && resolved[channel]?.length)
        tracks[channel] = resolved[channel];
  }
  delete tracks[property];
  const candidate: Layer = {
    ...layer,
    animationTrackMode: 'independent',
    animationTracks: tracks,
    keyframes: layer.keyframes.map((key) => ({ ...key, transform: { ...key.transform } })),
    loop: layer.loop ? { ...layer.loop, tracks: { ...layer.loop.tracks } } : null,
  };
  if (!candidate.keyframes.some((key) => key.frame === 0))
    candidate.keyframes.push(createLayerKeyframe(0, getLayerTransformAtFrame(layer, 0)));
  if (candidate.loop) delete candidate.loop.tracks[property];
  freezeProperty(candidate, property, value);
  if (
    !isRevealAnimationProperty(property) &&
    Math.abs(getLayerPropertyValueAtFrame(candidate, property, frame) - value) > 1e-9
  )
    throw new Error('The sampled value cannot be stored in this property without changing it.');
  const keyedFrames = new Set(
    Object.values(candidate.animationTracks).flatMap((keys) => keys?.map((key) => key.frame) ?? []),
  );
  candidate.keyframes = sortLayerKeyframes(
    candidate.keyframes.filter((key) => key.frame === 0 || keyedFrames.has(key.frame)),
  );
  Object.assign(layer, candidate);
  return value;
}

/** Synchronize only the generated fallback for a reset uniform; ordinary bindings keep ownership. */
export function syncResetShaderParameterDefault(
  composition: Composition,
  layer: Layer,
  property: AnimatableLayerProperty,
): void {
  const shader = parseShaderAnimationProperty(property);
  if (!shader) return;
  const paint = getElementShaderPaint(layer.element, shader.slot);
  const definition =
    paint &&
    inspectShaderSource(paint.fragmentSource).parameters.find(
      (parameter) => parameter.name === shader.name,
    );
  if (!paint || !definition) return;
  const target = shaderParameterTarget(shader.name, shader.slot);
  const binding = layer.bindings.find((entry) => entry.targetProperty === target);
  if (!binding || binding.valueMap || binding.sourcePath?.length) return;
  const field = composition.dataFields.find((entry) => entry.id === binding.fieldId);
  const generated = field?.generatedShaderParameter;
  if (
    !field ||
    !generated ||
    generated.layerId !== layer.id ||
    generated.name !== shader.name ||
    (generated.paintSlot ?? 'fill') !== shader.slot
  )
    return;
  const value = paint.parameters[shader.name] ?? definition.defaultValue;
  field.defaultValue = shaderParameterFieldValue(definition, value);
  generated.value = Array.isArray(value) ? [...value] : value;
  if (definition.control === 'vector2' && Array.isArray(value))
    for (const child of field.properties) {
      const index = child.key === 'x' ? 0 : child.key === 'y' ? 1 : null;
      if (index !== null && value[index] !== undefined) child.defaultValue = value[index]!;
    }
}
