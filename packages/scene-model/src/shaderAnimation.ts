import { getTrackValueAtFrame, sortLayerPropertyKeyframes } from './layerAnimation';
import { getElementShaderPaint, getElementShaderPaints, inspectShaderSource } from './shader';
import { shaderParameterTarget, normalizeShaderParameterValue } from './shaderParameters';
import type {
  Element,
  Layer,
  LayerAnimationTracks,
  LayerPropertyKeyframe,
  ShaderAnimationProperty,
  ShaderPaint,
  ShaderPaintSlot,
  ShaderParameterDefinition,
} from './types';

export type ShaderAnimationComponent = 'x' | 'y' | 'r' | 'g' | 'b' | 'a';
export interface ParsedShaderAnimationProperty {
  slot: ShaderPaintSlot;
  name: string;
  component?: ShaderAnimationComponent;
}
export interface ShaderAnimationPropertySpec extends ParsedShaderAnimationProperty {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  discrete: boolean;
  glslType: ShaderParameterDefinition['glslType'];
}

const definitionCache = new Map<string, ShaderParameterDefinition[]>();
function definitions(paint: ShaderPaint): ShaderParameterDefinition[] {
  const cached = definitionCache.get(paint.fragmentSource);
  if (cached) return cached;
  const inspection = inspectShaderSource(paint.fragmentSource);
  const result = inspection.valid ? inspection.parameters : [];
  if (definitionCache.size >= 64) definitionCache.delete(definitionCache.keys().next().value!);
  definitionCache.set(paint.fragmentSource, result);
  return result;
}

function channels(definition: ShaderParameterDefinition): ShaderAnimationComponent[] {
  if (definition.glslType === 'vec2') return ['x', 'y'];
  if (definition.glslType === 'vec3') return ['r', 'g', 'b'];
  if (definition.glslType === 'vec4') return ['r', 'g', 'b', 'a'];
  return [];
}

export function parseShaderAnimationProperty(
  property: string,
): ParsedShaderAnimationProperty | null {
  const match =
    /^(fill|strokePaint)\.parameters\.([A-Za-z_][A-Za-z_0-9]*)(?:\.(x|y|r|g|b|a))?$/.exec(property);
  return match
    ? {
        slot: match[1] === 'strokePaint' ? 'stroke' : 'fill',
        name: match[2]!,
        ...(match[3] ? { component: match[3] as ShaderAnimationComponent } : {}),
      }
    : null;
}

export function getShaderAnimatableProperties(element: Element): ShaderAnimationProperty[] {
  return getElementShaderPaints(element).flatMap(({ slot, paint }) =>
    definitions(paint).flatMap((definition) => {
      const prefix = shaderParameterTarget(definition.name, slot) as ShaderAnimationProperty;
      const components = channels(definition);
      return components.length
        ? components.map((component) => `${prefix}.${component}` as ShaderAnimationProperty)
        : [prefix];
    }),
  );
}

export function shaderAnimationPropertySpec(
  element: Element,
  property: string,
): ShaderAnimationPropertySpec | undefined {
  const parsed = parseShaderAnimationProperty(property);
  if (!parsed) return undefined;
  const paint = getElementShaderPaint(element, parsed.slot);
  if (!paint) return undefined;
  const definition = definitions(paint).find((entry) => entry.name === parsed.name);
  if (!definition) return undefined;
  const components = channels(definition);
  if (
    components.length
      ? !parsed.component || !components.includes(parsed.component)
      : parsed.component !== undefined
  )
    return undefined;
  const label = definition.name
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
  return {
    ...parsed,
    label: `${parsed.slot === 'stroke' ? 'Outline' : 'Fill'} shader · ${label}${parsed.component ? ` · ${parsed.component.toUpperCase()}` : ''}`,
    ...(definition.min !== undefined ? { min: definition.min } : {}),
    ...(definition.max !== undefined ? { max: definition.max } : {}),
    ...(definition.step !== undefined ? { step: definition.step } : {}),
    ...(definition.control === 'color' ? { min: 0, max: 1, step: 0.01 } : {}),
    ...(definition.glslType === 'bool' ? { min: 0, max: 1, step: 1 } : {}),
    ...(definition.glslType === 'int' ? { step: definition.step ?? 1 } : {}),
    discrete: definition.glslType === 'bool' || definition.glslType === 'int',
    glslType: definition.glslType,
  };
}

function componentIndex(component: ShaderAnimationComponent): number {
  return component === 'x' || component === 'r'
    ? 0
    : component === 'y' || component === 'g'
      ? 1
      : component === 'b'
        ? 2
        : 3;
}

function parameterValue(paint: ShaderPaint, name: string) {
  const definition = definitions(paint).find((entry) => entry.name === name)!;
  return normalizeShaderParameterValue(
    definition,
    Object.prototype.hasOwnProperty.call(paint.parameters ?? {}, name)
      ? paint.parameters[name]
      : definition.defaultValue,
  );
}

export function getShaderAnimationValue(element: Element, property: string): number {
  const spec = shaderAnimationPropertySpec(element, property);
  if (!spec) throw new Error(`Unknown shader animation property "${property}".`);
  const paint = getElementShaderPaint(element, spec.slot)!;
  const value = parameterValue(paint, spec.name);
  return spec.component
    ? (value as number[])[componentIndex(spec.component)]!
    : typeof value === 'boolean'
      ? Number(value)
      : (value as number);
}

export function shaderAnimationValueErrors(
  element: Element,
  property: string,
  value: number,
): string[] {
  const spec = shaderAnimationPropertySpec(element, property);
  if (!spec) return [`Unknown shader animation property "${property}".`];
  if (!Number.isFinite(value)) return [`Shader animation value "${property}" must be finite.`];
  if (spec.glslType === 'bool' && value !== 0 && value !== 1)
    return [`Shader toggle keys "${property}" must be 0 or 1.`];
  if (
    spec.glslType === 'int' &&
    (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
  )
    return [`Shader integer keys "${property}" must be signed 32-bit integers.`];
  if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max))
    return [`Shader animation value "${property}" is outside its declared range.`];
  if (!Number.isFinite(Math.fround(value)))
    return [`Shader animation value "${property}" is outside the GLSL float range.`];
  return [];
}

export function clampShaderAnimationValue(
  element: Element,
  property: string,
  value: number,
): number {
  const spec = shaderAnimationPropertySpec(element, property);
  if (!spec) throw new Error(`Unknown shader animation property "${property}".`);
  if (!Number.isFinite(value))
    throw new Error(`Shader animation value "${property}" must be finite.`);
  let result = Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, value));
  if (spec.discrete) result = Math.round(result);
  if (spec.glslType === 'int') result = Math.min(2147483647, Math.max(-2147483648, result));
  if (!Number.isFinite(Math.fround(result)))
    throw new Error(`Shader animation value "${property}" is outside the GLSL float range.`);
  return result;
}

export const normalizeShaderAnimationValue = clampShaderAnimationValue;

/** Integer and toggle properties hold the outgoing key; all other channels use ordinary easing. */
export function getShaderTrackValueAtFrame(
  element: Element,
  property: string,
  keys: LayerPropertyKeyframe[],
  frame: number,
  fallback = getShaderAnimationValue(element, property),
): number {
  const spec = shaderAnimationPropertySpec(element, property);
  if (!spec) throw new Error(`Unknown shader animation property "${property}".`);
  let value: number;
  if (spec.discrete) {
    const sorted = sortLayerPropertyKeyframes(keys);
    value =
      [...sorted].reverse().find((key) => key.frame <= frame)?.value ??
      sorted[0]?.value ??
      fallback;
  } else value = getTrackValueAtFrame(keys, frame, fallback);
  return clampShaderAnimationValue(element, property, value);
}

/** Only authored nonempty tracks are returned; unkeyed values must remain data-driven. */
export function sampleShaderAnimationValues(
  element: Element,
  tracks: LayerAnimationTracks,
  frame: number,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(tracks)
      .filter(
        ([property, keys]) =>
          parseShaderAnimationProperty(property) &&
          keys?.length &&
          shaderAnimationPropertySpec(element, property),
      )
      .map(([property, keys]) => [
        property,
        getShaderTrackValueAtFrame(element, property, keys!, frame),
      ]),
  );
}

/** Apply sampled channels after data binding, retaining every unanimated component. */
export function applyShaderAnimationValues(
  element: Element,
  values: Readonly<Record<string, number>>,
): Element {
  let result = element;
  for (const [property, sampled] of Object.entries(values)) {
    const spec = shaderAnimationPropertySpec(result, property);
    if (!spec) throw new Error(`Unknown shader animation property "${property}".`);
    const paint = getElementShaderPaint(result, spec.slot)!;
    const value = clampShaderAnimationValue(result, property, sampled);
    const parameters = { ...paint.parameters };
    if (spec.component) {
      const vector = [...(parameterValue(paint, spec.name) as number[])];
      vector[componentIndex(spec.component)] = value;
      parameters[spec.name] = vector;
    } else parameters[spec.name] = spec.glslType === 'bool' ? value === 1 : value;
    const next = { ...paint, parameters };
    if (spec.slot === 'stroke' && result.type === 'text') result = { ...result, strokePaint: next };
    else result = result.type === 'shader' ? next : { ...result, fill: next };
  }
  return result;
}

export function sampleShaderAnimationTracks(
  element: Element,
  tracks: LayerAnimationTracks,
  frame: number,
): Element {
  return applyShaderAnimationValues(element, sampleShaderAnimationValues(element, tracks, frame));
}

/** Remove only properties no longer present after source/paint edits; retain valid motion. */
export function pruneInvalidShaderAnimationTracks(layer: Layer): void {
  for (const tracks of [layer.animationTracks, layer.loop?.tracks]) {
    if (!tracks) continue;
    for (const property of Object.keys(tracks)) {
      if (
        parseShaderAnimationProperty(property) &&
        !shaderAnimationPropertySpec(layer.element, property)
      )
        delete tracks[property as ShaderAnimationProperty];
    }
  }
}
