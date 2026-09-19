import type { Element } from './types';
import { inspectShaderSource, resolveShaderParameters, getElementShaderPaint } from './shader';
import { isGradientPaint } from './paint';
import { normalizeShaderParameterValue, shaderColorToHex } from './shaderParameters';

/** Immutable data overrides, shared by Studio, diagnostic capture and exported runtime. */
export function applyElementDataValue(element: Element, property: string, value: unknown): Element {
  if (property === 'dropShadowColor' || property.startsWith('effects.')) return element;
  const shaderTarget = /^(?:(fill|strokePaint)\.)?parameters\.(.+)$/.exec(property);
  const slot = shaderTarget?.[1] === 'strokePaint' ? 'stroke' : 'fill';
  const shader = getElementShaderPaint(element, slot);
  if (shaderTarget && !shader)
    throw new Error(`Shader parameter binding "${property}" requires a shader paint.`);
  if (shader && shaderTarget) {
    const name = shaderTarget[2]!;
    const definition = inspectShaderSource(shader.fragmentSource).parameters.find(
      (parameter) => parameter.name === name,
    );
    if (!definition) throw new Error(`Unknown shader parameter "${name}".`);
    let normalized = normalizeShaderParameterValue(definition, value);
    const authored = resolveShaderParameters(shader)[name];
    // GDD hex defaults quantize to 8 bits; retain exact authored channels for that default.
    if (
      definition.control === 'color' &&
      Array.isArray(authored) &&
      typeof value === 'string' &&
      shaderColorToHex(authored).toLowerCase() === value.toLowerCase()
    )
      normalized = authored;
    const fill = { ...shader, parameters: { ...shader.parameters, [name]: normalized } };
    if (slot === 'stroke' && element.type === 'text') return { ...element, strokePaint: fill };
    return element.type === 'shader' ? fill : { ...element, fill };
  }
  const stop = /^fill\.stops\[(0|[1-9]\d*)\]\.color$/.exec(property);
  if (stop) {
    if (!('fill' in element) || !isGradientPaint(element.fill)) return element;
    const index = Number(stop[1]);
    if (!element.fill.stops[index]) return element;
    return {
      ...element,
      fill: {
        ...element.fill,
        stops: element.fill.stops.map((s, i) => (i === index ? { ...s, color: String(value) } : s)),
      },
    } as Element;
  }
  if (element.type === 'text' && property === 'color') {
    return {
      ...element,
      color: String(value),
      ...(typeof element.fill === 'string' ? { fill: String(value) } : {}),
    };
  }
  return {
    ...element,
    [property]: property === 'fill' && value && typeof value === 'object' ? value : String(value),
  } as Element;
}
