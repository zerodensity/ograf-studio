import { normalizeLayerEffects } from './layerEffects';
import {
  effectParameterSpec,
  effectParameterValue,
  numericEffectProperties,
  parseEffectProperty,
  sampleEffectStack,
  getEffectStack,
} from './effectStack';
import type {
  AnimatableLayerProperty,
  CubicBezierCurve,
  EasingPreset,
  GradientPaint,
  GradientStopOffsetProperty,
  Layer,
  LayerAnimationTracks,
  LayerEffects,
  LayerKeyframe,
  LayerPropertyKeyframe,
  LayerTransform,
} from './types';

export const TRANSFORM_ANIMATION_PROPERTIES: Array<keyof LayerTransform> = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'transformOriginX',
  'transformOriginY',
];

export const EFFECT_ANIMATION_PROPERTIES = [
  'blur',
  'dropShadowOpacity',
  'dropShadowOffsetX',
  'dropShadowOffsetY',
  'dropShadowBlur',
] as const satisfies readonly (keyof LayerEffects)[];

/** Fixed property vocabulary; layer-specific applicability is filtered below. */
export const ANIMATABLE_LAYER_PROPERTIES: readonly AnimatableLayerProperty[] = [
  ...TRANSFORM_ANIMATION_PROPERTIES,
  'strokeWidth',
  ...EFFECT_ANIMATION_PROPERTIES,
];

export const ANIMATABLE_PROPERTY_LABELS: Record<string, string> = {
  x: 'Position X',
  y: 'Position Y',
  width: 'Width',
  height: 'Height',
  rotation: 'Rotation',
  opacity: 'Alpha',
  strokeWidth: 'Text Stroke Width',
  transformOriginX: 'Origin X',
  transformOriginY: 'Origin Y',
  blur: 'Blur',
  dropShadowOpacity: 'Shadow Alpha',
  dropShadowOffsetX: 'Shadow X',
  dropShadowOffsetY: 'Shadow Y',
  dropShadowBlur: 'Shadow Softness',
};

const GRADIENT_STOP_OFFSET_PROPERTY = /^fill\.stops\[(0|[1-9]\d*)\]\.offset$/;

export function gradientStopOffsetProperty(index: number): GradientStopOffsetProperty {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('Gradient stop index must be non-negative.');
  }
  return `fill.stops[${index}].offset`;
}

export function gradientStopIndexForProperty(property: string): number | null {
  const match = GRADIENT_STOP_OFFSET_PROPERTY.exec(property);
  return match ? Number(match[1]) : null;
}

export function isGradientStopOffsetProperty(
  property: string,
): property is GradientStopOffsetProperty {
  return gradientStopIndexForProperty(property) !== null;
}

export function isAnimatableLayerProperty(property: string): property is AnimatableLayerProperty {
  return (
    ANIMATABLE_LAYER_PROPERTIES.includes(property as AnimatableLayerProperty) ||
    isGradientStopOffsetProperty(property) ||
    (parseEffectProperty(property) !== null && !property.endsWith('.color'))
  );
}

export function isAnimatableLayerPropertyApplicable(
  layer: Layer,
  property: AnimatableLayerProperty,
): boolean {
  if (parseEffectProperty(property))
    return typeof effectParameterSpec(layer.effects, property)?.default === 'number';
  if (property === 'blur') return getEffectStack(layer.effects).some((e) => e.legacy === 'blur');
  if (property.startsWith('dropShadow'))
    return getEffectStack(layer.effects).some((e) => e.legacy === 'drop-shadow');
  return property !== 'strokeWidth' || layer.element.type === 'text';
}

export function animatablePropertyLabel(property: AnimatableLayerProperty, layer?: Layer): string {
  const effectPath = parseEffectProperty(property);
  if (effectPath) {
    const effect = layer?.effects.stack?.find((e) => e.id === effectPath.id);
    return `${effect?.name ?? 'Effect ' + effectPath.id.slice(-6)} · ${layer ? (effectParameterSpec(layer.effects, property)?.label ?? effectPath.param) : effectPath.param}`;
  }
  const stopIndex = gradientStopIndexForProperty(property);
  return stopIndex === null
    ? (ANIMATABLE_PROPERTY_LABELS[property] ?? property)
    : `Gradient stop ${stopIndex + 1} position`;
}

export function getLayerAnimatableProperties(layer: Layer): AnimatableLayerProperty[] {
  const properties = new Set<AnimatableLayerProperty>(
    ANIMATABLE_LAYER_PROPERTIES.filter((property) =>
      isAnimatableLayerPropertyApplicable(layer, property),
    ),
  );
  for (const property of numericEffectProperties(layer.effects)) properties.add(property);
  const fill =
    layer.element.type === 'rectangle' ||
    layer.element.type === 'ellipse' ||
    layer.element.type === 'path' ||
    layer.element.type === 'pattern'
      ? layer.element.fill
      : null;
  if (fill && typeof fill !== 'string') {
    fill.stops.forEach((_, index) => properties.add(gradientStopOffsetProperty(index)));
  }
  for (const property of Object.keys(layer.animationTracks ?? {})) {
    if (
      isAnimatableLayerProperty(property) &&
      isAnimatableLayerPropertyApplicable(layer, property)
    ) {
      properties.add(property);
    }
  }
  for (const property of Object.keys(layer.loop?.tracks ?? {})) {
    if (
      isAnimatableLayerProperty(property) &&
      isAnimatableLayerPropertyApplicable(layer, property)
    ) {
      properties.add(property);
    }
  }
  return [...properties];
}

/** Removes stop tracks that no longer have a target after a paint kind/stop-count edit. */
export function pruneInvalidGradientStopTracks(layer: Layer): void {
  const fill =
    layer.element.type === 'rectangle' ||
    layer.element.type === 'ellipse' ||
    layer.element.type === 'path' ||
    layer.element.type === 'pattern'
      ? layer.element.fill
      : null;
  for (const property of Object.keys(layer.animationTracks ?? {})) {
    const stopIndex = gradientStopIndexForProperty(property);
    if (stopIndex !== null && (!fill || typeof fill === 'string' || !fill.stops[stopIndex])) {
      delete layer.animationTracks[property as AnimatableLayerProperty];
    }
  }
  for (const property of Object.keys(layer.loop?.tracks ?? {})) {
    const stopIndex = gradientStopIndexForProperty(property);
    if (stopIndex !== null && (!fill || typeof fill === 'string' || !fill.stops[stopIndex])) {
      delete layer.loop?.tracks[property as AnimatableLayerProperty];
    }
  }
}

function bounceOut(progress: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (progress < 1 / d1) return n1 * progress * progress;
  if (progress < 2 / d1) {
    const shifted = progress - 1.5 / d1;
    return n1 * shifted * shifted + 0.75;
  }
  if (progress < 2.5 / d1) {
    const shifted = progress - 2.25 / d1;
    return n1 * shifted * shifted + 0.9375;
  }
  const shifted = progress - 2.625 / d1;
  return n1 * shifted * shifted + 0.984375;
}

/** Shared deterministic easing sampler used by editor evaluation and the GSAP runtime. */
export function easedProgress(progress: number, easing: EasingPreset): number {
  const inverse = 1 - progress;
  switch (easing) {
    case 'linear':
      return progress;
    case 'ease-in':
    case 'quad-in':
      return progress * progress;
    case 'ease-out':
    case 'quad-out':
      return 1 - (1 - progress) * (1 - progress);
    case 'ease-in-out':
    case 'quad-in-out':
      return progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    case 'cubic-in':
      return progress ** 3;
    case 'cubic-out':
      return 1 - inverse ** 3;
    case 'cubic-in-out':
      return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    case 'quart-in':
      return progress ** 4;
    case 'quart-out':
      return 1 - inverse ** 4;
    case 'quart-in-out':
      return progress < 0.5 ? 8 * progress ** 4 : 1 - (-2 * progress + 2) ** 4 / 2;
    case 'quint-in':
      return progress ** 5;
    case 'quint-out':
      return 1 - inverse ** 5;
    case 'quint-in-out':
      return progress < 0.5 ? 16 * progress ** 5 : 1 - (-2 * progress + 2) ** 5 / 2;
    case 'sine-in':
      return 1 - Math.cos((progress * Math.PI) / 2);
    case 'sine-out':
      return Math.sin((progress * Math.PI) / 2);
    case 'sine-in-out':
      return -(Math.cos(Math.PI * progress) - 1) / 2;
    case 'expo-in':
      return progress === 0 ? 0 : 2 ** (10 * progress - 10);
    case 'expo-out':
      return progress === 1 ? 1 : 1 - 2 ** (-10 * progress);
    case 'expo-in-out':
      if (progress === 0 || progress === 1) return progress;
      return progress < 0.5 ? 2 ** (20 * progress - 10) / 2 : (2 - 2 ** (-20 * progress + 10)) / 2;
    case 'circ-in':
      return 1 - Math.sqrt(1 - progress ** 2);
    case 'circ-out':
      return Math.sqrt(1 - (progress - 1) ** 2);
    case 'circ-in-out':
      return progress < 0.5
        ? (1 - Math.sqrt(1 - (2 * progress) ** 2)) / 2
        : (Math.sqrt(1 - (-2 * progress + 2) ** 2) + 1) / 2;
    case 'back-in': {
      const c1 = 1.70158;
      return (c1 + 1) * progress ** 3 - c1 * progress ** 2;
    }
    case 'back-out': {
      const c1 = 1.70158;
      return 1 + (c1 + 1) * (progress - 1) ** 3 + c1 * (progress - 1) ** 2;
    }
    case 'back-in-out': {
      const c2 = 1.70158 * 1.525;
      return progress < 0.5
        ? ((2 * progress) ** 2 * ((c2 + 1) * 2 * progress - c2)) / 2
        : ((2 * progress - 2) ** 2 * ((c2 + 1) * (progress * 2 - 2) + c2) + 2) / 2;
    }
    case 'bounce-in':
      return 1 - bounceOut(1 - progress);
    case 'bounce-out':
      return bounceOut(progress);
    case 'bounce-in-out':
      return progress < 0.5
        ? (1 - bounceOut(1 - 2 * progress)) / 2
        : (1 + bounceOut(2 * progress - 1)) / 2;
    case 'elastic-in': {
      if (progress === 0 || progress === 1) return progress;
      const c4 = (2 * Math.PI) / 3;
      return -(2 ** (10 * progress - 10)) * Math.sin((progress * 10 - 10.75) * c4);
    }
    case 'elastic-out': {
      if (progress === 0 || progress === 1) return progress;
      const c4 = (2 * Math.PI) / 3;
      return 2 ** (-10 * progress) * Math.sin((progress * 10 - 0.75) * c4) + 1;
    }
    case 'elastic-in-out': {
      if (progress === 0 || progress === 1) return progress;
      const c5 = (2 * Math.PI) / 4.5;
      return progress < 0.5
        ? -(2 ** (20 * progress - 10) * Math.sin((20 * progress - 11.125) * c5)) / 2
        : (2 ** (-20 * progress + 10) * Math.sin((20 * progress - 11.125) * c5)) / 2 + 1;
    }
  }
}

/** CSS cubic-bezier sampler: solve x(t)=progress, then return y(t). */
export function cubicBezierProgress(progress: number, curve: CubicBezierCurve): number {
  const sample = (t: number, a: number, b: number) => {
    const inverse = 1 - t;
    return 3 * inverse * inverse * t * a + 3 * inverse * t * t * b + t * t * t;
  };
  let low = 0;
  let high = 1;
  let t = progress;
  for (let index = 0; index < 14; index++) {
    const x = sample(t, curve.x1, curve.x2);
    if (Math.abs(x - progress) < 0.00001) break;
    if (x < progress) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return sample(t, curve.y1, curve.y2);
}

export function sortLayerKeyframes(keyframes: LayerKeyframe[]): LayerKeyframe[] {
  return [...keyframes].sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id));
}

export function sortLayerPropertyKeyframes(
  keyframes: LayerPropertyKeyframe[],
): LayerPropertyKeyframe[] {
  return [...keyframes].sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id));
}

function staticPropertyValue(layer: Layer, property: AnimatableLayerProperty): number {
  if (parseEffectProperty(property)) {
    const value = effectParameterValue(layer.effects, property);
    if (typeof value !== 'number')
      throw Error(`Layer "${layer.name}" has no numeric effect parameter ${property}.`);
    return value;
  }
  if (TRANSFORM_ANIMATION_PROPERTIES.includes(property as keyof LayerTransform)) {
    const first = sortLayerKeyframes(layer.keyframes)[0];
    if (!first) throw new Error(`Layer "${layer.name}" has no animation keyframes.`);
    return first.transform[property as keyof LayerTransform];
  }
  const stopIndex = gradientStopIndexForProperty(property);
  if (stopIndex !== null) {
    const fill =
      layer.element.type === 'rectangle' ||
      layer.element.type === 'ellipse' ||
      layer.element.type === 'path' ||
      layer.element.type === 'pattern'
        ? layer.element.fill
        : null;
    if (!fill || typeof fill === 'string' || !fill.stops[stopIndex]) {
      throw new Error(`Layer "${layer.name}" has no gradient stop ${stopIndex}.`);
    }
    return fill.stops[stopIndex].offset;
  }
  if (property === 'strokeWidth') {
    if (layer.element.type !== 'text') {
      throw new Error(`Layer "${layer.name}" does not support animated text stroke width.`);
    }
    return layer.element.strokeWidth;
  }
  return layer.effects[
    property as keyof Pick<
      LayerEffects,
      'blur' | 'dropShadowOpacity' | 'dropShadowOffsetX' | 'dropShadowOffsetY' | 'dropShadowBlur'
    >
  ];
}

/** Resolve old full-pose keys into tracks lazily so v4 objects remain readable during migration/tests. */
export function getResolvedLayerAnimationTracks(layer: Layer): LayerAnimationTracks {
  const tracks: LayerAnimationTracks = {};
  for (const property of getLayerAnimatableProperties(layer)) {
    const existing = layer.animationTracks?.[property];
    if (existing?.length) {
      tracks[property] = sortLayerPropertyKeyframes(existing);
      continue;
    }
    if (TRANSFORM_ANIMATION_PROPERTIES.includes(property as keyof LayerTransform)) {
      tracks[property] = sortLayerKeyframes(layer.keyframes).map((keyframe) => ({
        id: `${keyframe.id}:${property}`,
        frame: keyframe.frame,
        value: keyframe.transform[property as keyof LayerTransform],
        easing: keyframe.easing,
      }));
    } else {
      tracks[property] = [
        {
          id: `${layer.id}:${property}:0`,
          frame: 0,
          value: staticPropertyValue(layer, property),
          easing: 'linear',
        },
      ];
    }
  }
  return tracks;
}

export function createAnimationTracksFromLegacyLayer(layer: Layer): LayerAnimationTracks {
  return getResolvedLayerAnimationTracks({ ...layer, animationTracks: {} });
}

export function findLayerPropertyKeyframeAtFrame(
  layer: Layer,
  property: AnimatableLayerProperty,
  frame: number,
): LayerPropertyKeyframe | undefined {
  const roundedFrame = Math.round(frame);
  return getResolvedLayerAnimationTracks(layer)[property]?.find(
    (keyframe) => keyframe.frame === roundedFrame,
  );
}

export function getLayerPropertyValueAtFrame(
  layer: Layer,
  property: AnimatableLayerProperty,
  frame: number,
): number {
  const keyframes = getResolvedLayerAnimationTracks(layer)[property] ?? [];
  return getTrackValueAtFrame(keyframes, frame, staticPropertyValue(layer, property));
}

export function getTrackValueAtFrame(
  keyframes: LayerPropertyKeyframe[],
  frame: number,
  fallback: number,
): number {
  const sorted = sortLayerPropertyKeyframes(keyframes);
  const first = sorted[0];
  if (!first) return fallback;
  if (frame <= first.frame) return first.value;
  const last = sorted.at(-1)!;
  if (frame >= last.frame) return last.value;
  const nextIndex = sorted.findIndex((keyframe) => keyframe.frame >= frame);
  const next = sorted[nextIndex]!;
  if (next.frame === frame) return next.value;
  const previous = sorted[nextIndex - 1]!;
  const rawProgress = (frame - previous.frame) / (next.frame - previous.frame);
  const progress = next.curve
    ? cubicBezierProgress(rawProgress, next.curve)
    : easedProgress(rawProgress, next.easing);
  return previous.value + (next.value - previous.value) * progress;
}

/** Applies canonical stop-offset tracks without mutating the authored or data-bound paint. */
export function getPaintAtFrame(
  paint: string | GradientPaint,
  tracks: LayerAnimationTracks,
  frame: number,
): string | GradientPaint {
  if (typeof paint === 'string') return paint;
  return {
    ...paint,
    stops: paint.stops.map((stop, index) => {
      const property = gradientStopOffsetProperty(index);
      const offset = getTrackValueAtFrame(tracks[property] ?? [], frame, stop.offset);
      return { ...stop, offset: Math.max(0, Math.min(1, offset)) };
    }),
  };
}

export function findLayerKeyframeAtFrame(layer: Layer, frame: number): LayerKeyframe | undefined {
  const roundedFrame = Math.round(frame);
  return layer.keyframes.find((keyframe) => keyframe.frame === roundedFrame);
}

/** Sample a layer's independent transform track at any frame. */
export function getLayerTransformAtFrame(layer: Layer, frame: number): LayerTransform {
  const result = {} as LayerTransform;
  for (const property of TRANSFORM_ANIMATION_PROPERTIES) {
    result[property] = getLayerPropertyValueAtFrame(layer, property, frame);
  }
  return result;
}

export function getLayerEffectsAtFrame(layer: Layer, frame: number): LayerEffects {
  return sampleEffectStack(
    normalizeLayerEffects({
      ...layer.effects,
      blur: getLayerPropertyValueAtFrame(layer, 'blur', frame),
      dropShadowOpacity: getLayerPropertyValueAtFrame(layer, 'dropShadowOpacity', frame),
      dropShadowOffsetX: getLayerPropertyValueAtFrame(layer, 'dropShadowOffsetX', frame),
      dropShadowOffsetY: getLayerPropertyValueAtFrame(layer, 'dropShadowOffsetY', frame),
      dropShadowBlur: getLayerPropertyValueAtFrame(layer, 'dropShadowBlur', frame),
    }),
    (property, value) => getTrackValueAtFrame(layer.animationTracks[property] ?? [], frame, value),
  );
}
