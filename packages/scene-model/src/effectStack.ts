import { createId } from './id';
import type {
  AnimatableLayerProperty,
  EffectParameterProperty,
  EffectType,
  Layer,
  LayerEffect,
  LayerEffects,
} from './types';

export interface EffectParameterSpec {
  label: string;
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
}
export const EFFECT_CATALOG: Record<
  EffectType,
  { label: string; params: Record<string, EffectParameterSpec> }
> = {
  blur: {
    label: 'Blur',
    params: { radius: { label: 'Radius', default: 8, min: 0, max: 256, step: 0.5 } },
  },
  'drop-shadow': {
    label: 'Drop shadow',
    params: {
      offsetX: { label: 'Offset X', default: 8, min: -2048, max: 2048 },
      offsetY: { label: 'Offset Y', default: 8, min: -2048, max: 2048 },
      radius: { label: 'Softness', default: 12, min: 0, max: 256, step: 0.5 },
      color: { label: 'Color', default: '#000000' },
      opacity: { label: 'Opacity', default: 0.65, min: 0, max: 1, step: 0.01 },
    },
  },
  glow: {
    label: 'Glow',
    params: {
      radius: { label: 'Radius', default: 12, min: 0, max: 256, step: 0.5 },
      color: { label: 'Color', default: '#a8d8ff' },
      opacity: { label: 'Intensity', default: 0.5, min: 0, max: 1, step: 0.01 },
    },
  },
  brightness: {
    label: 'Brightness',
    params: { amount: { label: 'Amount', default: 1, min: 0, max: 4, step: 0.05 } },
  },
  contrast: {
    label: 'Contrast',
    params: { amount: { label: 'Amount', default: 1, min: 0, max: 4, step: 0.05 } },
  },
  saturate: {
    label: 'Saturation',
    params: { amount: { label: 'Amount', default: 1, min: 0, max: 4, step: 0.05 } },
  },
  'hue-rotate': {
    label: 'Hue rotation',
    params: { angle: { label: 'Angle', default: 0, min: -3600, max: 3600, step: 1 } },
  },
};
export const EFFECT_TYPES = Object.keys(EFFECT_CATALOG) as EffectType[];
export const MAX_EFFECTS = 16;
export function ensureLegacyEffects(
  effects: LayerEffects,
  patch: Partial<LayerEffects>,
): LayerEffects {
  if (effects.stack === undefined) return effects;
  const stack = copyEffectStack(effects.stack);
  for (const legacy of ['blur', 'drop-shadow'] as const) {
    const touched =
      legacy === 'blur'
        ? patch.blur !== undefined
        : Object.keys(patch).some((k) => k.startsWith('dropShadow'));
    if (!touched) continue;
    let entry = stack.find((e) => e.legacy === legacy);
    if (!entry) {
      entry = legacyEffectStack().find((e) => e.legacy === legacy)!;
      if (stack.some((e) => e.id === entry!.id)) entry.id = createId('fx');
      stack.unshift(entry);
    }
    entry.enabled = true;
  }
  const result = { ...effects, stack };
  assertStack(result);
  return result;
}
export function legacyEffectStack(): LayerEffect[] {
  return [
    { id: 'base-blur', name: 'Blur', type: 'blur', enabled: true, params: {}, legacy: 'blur' },
    {
      id: 'base-shadow',
      name: 'Drop shadow',
      type: 'drop-shadow',
      enabled: true,
      params: {},
      legacy: 'drop-shadow',
    },
  ];
}
export function getEffectStack(effects: LayerEffects): LayerEffect[] {
  return effects.stack ?? legacyEffectStack();
}
export function copyEffectStack(stack: LayerEffect[]): LayerEffect[] {
  return stack.map((e) => ({ ...e, params: { ...e.params } }));
}
export function effectParams(
  effect: LayerEffect,
  effects: LayerEffects,
): Record<string, number | string> {
  if (effect.legacy === 'blur') return { radius: effects.blur };
  if (effect.legacy === 'drop-shadow')
    return {
      offsetX: effects.dropShadowOffsetX,
      offsetY: effects.dropShadowOffsetY,
      radius: effects.dropShadowBlur,
      color: effects.dropShadowColor,
      opacity: effects.dropShadowOpacity,
    };
  return effect.params;
}
export function effectEnabled(effect: LayerEffect, effects: LayerEffects): boolean {
  return effect.enabled && (effect.legacy !== 'drop-shadow' || effects.dropShadowEnabled);
}
export function effectProperty(effect: LayerEffect, param: string): string {
  if (effect.legacy === 'blur') return 'blur';
  if (effect.legacy === 'drop-shadow')
    return (
      {
        offsetX: 'dropShadowOffsetX',
        offsetY: 'dropShadowOffsetY',
        radius: 'dropShadowBlur',
        color: 'dropShadowColor',
        opacity: 'dropShadowOpacity',
      } as Record<string, string>
    )[param]!;
  return `effects.${effect.id}.${param}`;
}
export function parseEffectProperty(property: string): { id: string; param: string } | null {
  const m = /^effects\.([a-zA-Z0-9_-]+)\.([a-zA-Z][a-zA-Z0-9]*)$/.exec(property);
  return m ? { id: m[1]!, param: m[2]! } : null;
}
export function effectParameterSpec(
  effects: LayerEffects,
  property: string,
): EffectParameterSpec | undefined {
  const path = parseEffectProperty(property),
    effect = path && getEffectStack(effects).find((e) => e.id === path.id && !e.legacy);
  return effect ? EFFECT_CATALOG[effect.type]?.params[path!.param] : undefined;
}
export function effectParameterValue(
  effects: LayerEffects,
  property: string,
): number | string | undefined {
  const path = parseEffectProperty(property),
    effect = path && getEffectStack(effects).find((e) => e.id === path.id && !e.legacy);
  return effect?.params[path!.param];
}
export function numericEffectProperties(effects: LayerEffects): EffectParameterProperty[] {
  return getEffectStack(effects)
    .filter((e) => !e.legacy)
    .flatMap((e) =>
      Object.entries(EFFECT_CATALOG[e.type]?.params ?? {})
        .filter(([, s]) => typeof s.default === 'number')
        .map(([key]) => effectProperty(e, key) as EffectParameterProperty),
    );
}
export function withEffectParameter(
  effects: LayerEffects,
  property: string,
  value: unknown,
): LayerEffects {
  const path = parseEffectProperty(property),
    spec = effectParameterSpec(effects, property);
  if (!path || !spec) return effects;
  const resolved =
    typeof spec.default === 'number'
      ? Math.max(spec.min ?? -Infinity, Math.min(spec.max ?? Infinity, Number(value)))
      : String(value);
  if (typeof resolved === 'number' && !Number.isFinite(resolved)) return effects;
  return {
    ...effects,
    stack: getEffectStack(effects).map((e) =>
      e.id === path.id ? { ...e, params: { ...e.params, [path.param]: resolved } } : e,
    ),
  };
}
export function sampleEffectStack(
  effects: LayerEffects,
  sample: (property: AnimatableLayerProperty, value: number) => number,
): LayerEffects {
  let result = effects;
  for (const property of numericEffectProperties(effects))
    result = withEffectParameter(
      result,
      property,
      sample(property, Number(effectParameterValue(effects, property))),
    );
  return result;
}
export function effectStackErrors(effects: LayerEffects): string[] {
  if (effects.stack === undefined) return [];
  if (!Array.isArray(effects.stack)) return ['Effects stack must be an array.'];
  const errors: string[] = [],
    ids = new Set<string>(),
    legacy = new Set<string>();
  if (effects.stack.length > MAX_EFFECTS)
    errors.push(`Use at most ${MAX_EFFECTS} effects per layer.`);
  for (const effect of effects.stack) {
    if (!effect || typeof effect !== 'object') {
      errors.push('Effect entries must be objects.');
      continue;
    }
    if (
      typeof effect.id !== 'string' ||
      !/^[-a-zA-Z0-9_]{1,100}$/.test(effect.id) ||
      ids.has(effect.id)
    )
      errors.push('Effect IDs must be unique simple identifiers.');
    ids.add(effect.id);
    if (!EFFECT_TYPES.includes(effect.type)) {
      errors.push('Unknown effect type.');
      continue;
    }
    if (
      typeof effect.name !== 'string' ||
      !effect.name.trim() ||
      typeof effect.enabled !== 'boolean'
    )
      errors.push('Effects need a name and boolean enabled flag.');
    if (effect.legacy !== undefined) {
      if (
        !['blur', 'drop-shadow'].includes(effect.legacy) ||
        effect.type !== effect.legacy ||
        legacy.has(effect.legacy)
      )
        errors.push('Invalid or duplicate legacy effect adapter.');
      legacy.add(effect.legacy);
      continue;
    }
    const params = effect.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      errors.push('Effect params must be an object.');
      continue;
    }
    for (const key of Object.keys(params))
      if (!EFFECT_CATALOG[effect.type].params[key])
        errors.push(`Unknown ${effect.type} parameter: ${key}.`);
    for (const [key, spec] of Object.entries(EFFECT_CATALOG[effect.type].params)) {
      const value = params[key];
      if (typeof spec.default === 'number') {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < (spec.min ?? -Infinity) ||
          value > (spec.max ?? Infinity)
        )
          errors.push(`${effect.name}.${key} must be ${spec.min}–${spec.max}.`);
      } else if (typeof value !== 'string' || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value))
        errors.push(`${effect.name}.${key} must use #RRGGBB or #RRGGBBAA.`);
    }
  }
  return errors;
}
function assertStack(effects: LayerEffects): void {
  const errors = effectStackErrors(effects);
  if (errors.length) throw Error(errors.join(' '));
}
export type EffectPatch = {
  name?: string;
  enabled?: boolean;
  params?: Record<string, number | string>;
};
export function addEffect(
  layer: Layer,
  type: EffectType,
  patch: EffectPatch = {},
  index?: number,
  id = createId('fx'),
): LayerEffect {
  const spec = EFFECT_CATALOG[type];
  if (!spec) throw Error('Unknown effect type.');
  const effect: LayerEffect = {
    id,
    type,
    name: patch.name ?? spec.label,
    enabled: patch.enabled ?? true,
    params: {
      ...Object.fromEntries(Object.entries(spec.params).map(([k, s]) => [k, s.default])),
      ...patch.params,
    },
  };
  const stack = copyEffectStack(getEffectStack(layer.effects));
  if (index !== undefined && (!Number.isInteger(index) || index < 0 || index > stack.length))
    throw Error('Effect insertion index is out of range.');
  stack.splice(index ?? stack.length, 0, effect);
  assertStack({ ...layer.effects, stack });
  layer.effects.stack = stack;
  return effect;
}
export function updateEffect(layer: Layer, id: string, patch: EffectPatch): LayerEffect {
  const effects = { ...layer.effects, stack: copyEffectStack(getEffectStack(layer.effects)) };
  const effect = effects.stack.find((e) => e.id === id);
  if (!effect) throw Error(`Effect not found: ${id}`);
  if (patch.name !== undefined) effect.name = patch.name;
  if (patch.enabled !== undefined) {
    effect.enabled = patch.enabled;
    if (effect.legacy === 'drop-shadow') effects.dropShadowEnabled = patch.enabled;
  }
  const params = { ...effectParams(effect, effects), ...patch.params };
  const checkedParams = effect.legacy
    ? {
        ...Object.fromEntries(
          Object.entries(EFFECT_CATALOG[effect.type].params).map(([key, spec]) => [
            key,
            spec.default,
          ]),
        ),
        ...patch.params,
      }
    : params;
  const resolved = { ...effect, params: checkedParams };
  delete resolved.legacy;
  assertStack({ ...effects, stack: [resolved] });
  if (effect.legacy) {
    for (const [key, value] of Object.entries(patch.params ?? {})) {
      const property = effectProperty(effect, key);
      if (!property) throw Error(`Unknown effect parameter: ${key}`);
      (effects as unknown as Record<string, unknown>)[property] = value;
    }
  } else effect.params = params;
  assertStack(effects);
  layer.effects = effects;
  return effect;
}
export function removeEffect(layer: Layer, id: string): void {
  const effect = getEffectStack(layer.effects).find((e) => e.id === id);
  if (!effect) throw Error(`Effect not found: ${id}`);
  const owned = new Set(
    Object.keys(EFFECT_CATALOG[effect.type].params).map((key) => effectProperty(effect, key)),
  );
  layer.effects.stack = getEffectStack(layer.effects).filter((e) => e.id !== id);
  for (const p of Object.keys(layer.animationTracks))
    if (owned.has(p)) delete layer.animationTracks[p as AnimatableLayerProperty];
  for (const p of Object.keys(layer.loop?.tracks ?? {}))
    if (owned.has(p)) delete layer.loop!.tracks[p as AnimatableLayerProperty];
  layer.designTokenBindings = layer.designTokenBindings.filter((b) => !owned.has(b.targetProperty));
  layer.bindings = layer.bindings.filter((b) => !owned.has(b.targetProperty));
  if (effect.legacy === 'blur') layer.effects.blur = 0;
  if (effect.legacy === 'drop-shadow') layer.effects.dropShadowEnabled = false;
}
export function reorderEffects(layer: Layer, ids: string[]): void {
  const stack = getEffectStack(layer.effects);
  if (
    ids.length !== stack.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !stack.some((e) => e.id === id))
  )
    throw Error('Reorder must include every effect ID exactly once.');
  layer.effects.stack = ids.map((id) => stack.find((e) => e.id === id)!);
}
export function duplicateEffect(layer: Layer, id: string, newId = createId('fx')): LayerEffect {
  const source = getEffectStack(layer.effects).find((e) => e.id === id);
  if (!source) throw Error(`Effect not found: ${id}`);
  const copy = addEffect(
    layer,
    source.type,
    {
      name: `${source.name} copy`,
      enabled: effectEnabled(source, layer.effects),
      params: { ...effectParams(source, layer.effects) },
    },
    getEffectStack(layer.effects).findIndex((e) => e.id === id) + 1,
    newId,
  );
  for (const key of Object.keys(EFFECT_CATALOG[source.type].params)) {
    const from = effectProperty(source, key),
      to = effectProperty(copy, key) as EffectParameterProperty;
    for (const tracks of [layer.animationTracks, layer.loop?.tracks])
      if (tracks?.[from as AnimatableLayerProperty])
        tracks[to] = tracks[from as AnimatableLayerProperty]!.map((k) => ({
          ...k,
          id: createId('prop-key'),
        }));
    layer.designTokenBindings.push(
      ...layer.designTokenBindings
        .filter((b) => b.targetProperty === from)
        .map((b) => ({ ...b, targetProperty: to })),
    );
    layer.bindings.push(
      ...layer.bindings
        .filter((b) => b.targetProperty === from)
        .map((b) => ({ ...b, targetProperty: to })),
    );
  }
  return copy;
}
