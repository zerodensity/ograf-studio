import type {
  Composition,
  Layer,
  LayerEffects,
  LayerLoopClip,
  LayerTransform,
  PatternLighting,
  PatternLightingLink,
  TilingPattern,
} from './types';
import { getLayerPropertyValueAtFrame, getTrackValueAtFrame } from './layerAnimation';
import { getLoopFrameAtElapsed } from './loopAnimation';
export type TilingPatternPatch = Omit<Partial<Omit<TilingPattern, 'id'>>, 'lighting'> & {
  lighting?: Partial<PatternLighting> | null;
};

export function createPatternLighting(cycleFrames = 600): PatternLighting {
  return {
    enabled: true,
    cycleFrames: Math.max(1, Math.round(cycleFrames)),
    phase: 0,
    intensity: 1,
    glow: 1,
    softness: 1,
  };
}

export function patternLightingErrors(value: PatternLighting): string[] {
  if (!value || typeof value !== 'object') return ['Lighting must be an object.'];
  const errors: string[] = [];
  if (
    Object.keys(value).some(
      (key) => !['enabled', 'cycleFrames', 'phase', 'intensity', 'glow', 'softness'].includes(key),
    )
  )
    errors.push('Unknown lighting property.');
  if (typeof value.enabled !== 'boolean') errors.push('Lighting enabled must be boolean.');
  for (const [key, maximum] of [
    ['cycleFrames', 1000000],
    ['phase', 1],
    ['intensity', 4],
    ['glow', 4],
    ['softness', 4],
  ] as const) {
    const n = value[key];
    if (
      !Number.isFinite(n) ||
      n < (key === 'cycleFrames' ? 1 : 0) ||
      n > maximum ||
      (key === 'cycleFrames' && !Number.isInteger(n))
    )
      errors.push(`Lighting ${key} is outside its supported range.`);
  }
  return errors;
}

export function layerLightingErrors(layer: Layer, patterns: readonly TilingPattern[]): string[] {
  const link = layer.lighting;
  if (link == null) return [];
  const errors: string[] = [];
  if (typeof link !== 'object') return [`Layer "${layer.name}" has invalid lighting.`];
  if (
    Object.keys(link).some(
      (key) => !['patternId', 'role', 'phaseOffset', 'gain', 'cyclesPerLoop'].includes(key),
    )
  )
    errors.push('Unknown lighting link property.');
  if (!patterns.some((p) => p.id === link.patternId && p.lighting))
    errors.push('Lighting references a missing pattern controller.');
  if (!['light', 'glow'].includes(link.role)) errors.push('Lighting role must be light or glow.');
  if (!Number.isFinite(link.phaseOffset) || link.phaseOffset < 0 || link.phaseOffset > 1)
    errors.push('Light phase offset must be 0–1.');
  if (!Number.isFinite(link.gain) || link.gain < 0 || link.gain > 4)
    errors.push('Light gain must be 0–4.');
  if (!Number.isInteger(link.cyclesPerLoop) || link.cyclesPerLoop < 1 || link.cyclesPerLoop > 64)
    errors.push('Light cyclesPerLoop must be an integer from 1 to 64.');
  if (layer.loop && (layer.loop.activation.type !== 'lifecycle' || layer.loop.repeatCount !== null))
    errors.push('Shared lights require an infinite lifecycle loop, or no loop for a static light.');
  return errors.map((error) => `Layer "${layer.name}": ${error}`);
}

export function setLayerLighting(
  composition: Composition,
  layerId: string,
  link: PatternLightingLink | null,
): void {
  const layer = composition.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error('Lighting layer not found.');
  if (layer.isLocked) throw new Error('Unlock the layer before changing its lighting link.');
  const errors = layerLightingErrors({ ...layer, lighting: link }, composition.patterns);
  if (errors.length) throw new Error(errors.join(' '));
  layer.lighting = link ? { ...link } : null;
}

/** Maps the shared clock to each untouched source curve, including its authored phase offset. */
export function patternLightLoopFrame(
  loop: LayerLoopClip,
  settings: PatternLighting,
  link: PatternLightingLink,
  elapsedFrames: number,
): number {
  const turns =
    (elapsedFrames / settings.cycleFrames) * link.cyclesPerLoop +
    settings.phase +
    link.phaseOffset +
    loop.phaseOffsetFrames / loop.durationFrames;
  return (((turns % 1) + 1) % 1) * loop.durationFrames;
}

/** Multiply sampled values; no controller edit changes a source track, token or runtime color. */
export function applyPatternLighting(
  settings: PatternLighting | null | undefined,
  link: PatternLightingLink,
  transform: LayerTransform,
  effects: LayerEffects,
): { transform: LayerTransform; effects: LayerEffects } {
  if (!settings?.enabled) return { transform, effects };
  const glow = link.role === 'glow';
  const gain = settings.intensity * link.gain * (glow ? settings.glow : 1);
  return {
    transform: { ...transform, opacity: Math.min(1, Math.max(0, transform.opacity * gain)) },
    effects:
      !glow || settings.softness === 1
        ? effects
        : {
            ...effects,
            blur: Math.min(256, effects.blur * settings.softness),
            dropShadowBlur: Math.min(256, effects.dropShadowBlur * settings.softness),
            ...(effects.stack
              ? {
                  stack: effects.stack.map((effect) =>
                    !effect.legacy && ['blur', 'glow', 'drop-shadow'].includes(effect.type)
                      ? {
                          ...effect,
                          params: {
                            ...effect.params,
                            radius: Math.min(256, Number(effect.params.radius) * settings.softness),
                          },
                        }
                      : effect,
                  ),
                }
              : {}),
          },
  };
}

/** Canonical numeric inspection of shared light timing, including curve sampling and gains. */
export function getLayerPropertyWithLighting(
  layer: Layer,
  patterns: readonly TilingPattern[],
  property: Parameters<typeof getLayerPropertyValueAtFrame>[1],
  frame: number,
  elapsedFrames?: number,
): number {
  const link = layer.lighting;
  const settings = link ? patterns.find((p) => p.id === link.patternId)?.lighting : undefined;
  let value = getLayerPropertyValueAtFrame(layer, property, frame);
  if (layer.loop && elapsedFrames !== undefined) {
    const local =
      settings?.enabled && link
        ? patternLightLoopFrame(layer.loop, settings, link, elapsedFrames)
        : getLoopFrameAtElapsed(layer.loop, elapsedFrames);
    value = getTrackValueAtFrame(layer.loop.tracks[property] ?? [], local, value);
  }
  if (!settings?.enabled || !link) return value;
  if (property === 'opacity')
    return Math.min(
      1,
      Math.max(
        0,
        value * settings.intensity * link.gain * (link.role === 'glow' ? settings.glow : 1),
      ),
    );
  if (
    link.role === 'glow' &&
    (property === 'blur' ||
      property === 'dropShadowBlur' ||
      layer.effects.stack?.some(
        (e) =>
          ['blur', 'drop-shadow', 'glow'].includes(e.type) && property === `effects.${e.id}.radius`,
      ))
  )
    return Math.min(256, Math.max(0, value * settings.softness));
  return value;
}
