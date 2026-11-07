import type { Element, Paint } from './types';
import { inspectShaderSource, resolveShaderParameters, getElementShaderPaint } from './shader';
import { isGradientPaint, validatePaint } from './paint';
import {
  normalizeShaderParameterValue,
  SHADER_PARAMETER_TARGET,
  shaderColorToHex,
} from './shaderParameters';
import { parseChartData } from './chartData';
import { clockDataSetting, clockSettingsWithData, parseClockTimerManualValue } from './clockTimer';
import { isLayerRuleProperty } from './layerRuleProperties';
import { normalizeTicker } from './ticker';
import { createLayerEffects } from './factory';
import { effectParameterValue, parseEffectProperty, withEffectParameter } from './effectStack';

const NUMERIC_TEXT_PROPERTIES = new Set([
  'fontSize',
  'fontWeight',
  'strokeWidth',
  'lineHeight',
  'letterSpacing',
  'baselineShift',
  'minFontSize',
]);

/** Immutable data overrides, shared by Studio, diagnostic capture and exported runtime. */
export function applyElementDataValue(element: Element, property: string, value: unknown): Element {
  if (element.type === 'ticker') {
    if (property === 'items') {
      let items = value;
      if (typeof items === 'string') {
        try {
          items = JSON.parse(items);
        } catch {
          throw new Error('Ticker items must be a JSON array.');
        }
      }
      return normalizeTicker({ ...element, items: items as typeof element.items });
    }
    const target = /^items\.([^.]+)\.(.+)$/.exec(property);
    if (target) {
      const childProperty = target[2]!;
      if (childProperty === 'width' || childProperty === 'height')
        return normalizeTicker({
          ...element,
          items: element.items.map((item) =>
            item.id === target[1] ? { ...item, [childProperty]: Number(value) } : item,
          ),
        });
      return {
        ...element,
        items: element.items.map((item) =>
          item.id === target[1]
            ? childProperty === 'dropShadowColor' || parseEffectProperty(childProperty)
              ? {
                  ...item,
                  effects:
                    childProperty === 'dropShadowColor'
                      ? {
                          ...(item.effects ?? createLayerEffects()),
                          dropShadowColor: String(value),
                        }
                      : withEffectParameter(
                          item.effects ?? createLayerEffects(),
                          childProperty,
                          value,
                        ),
                }
              : {
                  ...item,
                  element: applyElementDataValue(
                    item.element,
                    target[2]!,
                    value,
                  ) as typeof item.element,
                }
            : item,
        ),
      };
    }
    if (['speedPixelsPerSecond', 'gap', 'entryFade', 'exitFade', 'fadeSoftness'].includes(property))
      return normalizeTicker({ ...element, [property]: Number(value) });
    if (['direction', 'textDirection', 'updatePolicy'].includes(property))
      return normalizeTicker({ ...element, [property]: value });
  }
  if (property === 'clock.manualValue') {
    if (element.type !== 'text' || element.clock?.source !== 'manual') return element;
    if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      parseClockTimerManualValue(element.clock, value) === null
    )
      return element;
    return { ...element, clock: { ...element.clock, manualValue: value } };
  }
  const clockSetting = clockDataSetting(property);
  if (clockSetting) {
    if (element.type !== 'text' || !element.clock) return element;
    const clock = clockSettingsWithData(element.clock, clockSetting, value);
    return clock ? { ...element, clock } : element;
  }
  if (element.type === 'chart' && property === 'data') {
    return { ...element, data: parseChartData(value) };
  }
  if (element.type === 'chart' && property === 'fill') {
    if (value == null) {
      const { fill: _fill, ...original } = element;
      return original;
    }
    const errors = validatePaint(value as Paint);
    if (errors.length) throw new Error('Chart mark fill: ' + errors.join(' '));
    return { ...element, fill: value as Paint };
  }
  // Layer offsets and effect parameters are applied to the pose and effect stack, not the element.
  if (
    property === 'dropShadowColor' ||
    property.startsWith('effects.') ||
    isLayerRuleProperty(property)
  )
    return element;
  if (property === 'strokeWidth' && 'strokeWidth' in element) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0
      ? ({ ...element, strokeWidth: numeric } as Element)
      : element;
  }
  if (property === 'cornerRadius') {
    const radius = Number(value);
    if (element.type !== 'rectangle' || !Number.isFinite(radius) || radius < 0) return element;
    return {
      ...element,
      borderRadius: { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius },
    };
  }
  const shaderTarget = SHADER_PARAMETER_TARGET.exec(property);
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
    if (element.type === 'shader') return fill;
    if (!('fill' in element))
      throw new Error(`Shader parameter binding "${property}" requires a paintable object.`);
    return { ...element, fill };
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
  if (element.type === 'text' && property === 'content') {
    const content = String(value);
    const authoredText = element.runs.length
      ? element.runs.map((run) => run.text).join('')
      : element.content;
    return { ...element, content, runs: content === authoredText ? element.runs : [] };
  }
  if (element.type === 'text' && NUMERIC_TEXT_PROPERTIES.has(property)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? ({ ...element, [property]: numeric } as Element) : element;
  }
  return {
    ...element,
    [property]: property === 'fill' && value && typeof value === 'object' ? value : String(value),
  } as Element;
}

/** The value `applyElementDataValue` would replace; `undefined` when the element lacks it. */
export function readElementDataValue(element: Element, property: string): unknown {
  if (element.type === 'ticker') {
    if (property === 'items') return element.items;
    const target = /^items\.([^.]+)\.(.+)$/.exec(property);
    if (target) {
      const item = element.items.find((item) => item.id === target[1]);
      if (!item) return undefined;
      if (target[2] === 'width' || target[2] === 'height') return item[target[2]];
      if (target[2] === 'dropShadowColor')
        return (item.effects ?? createLayerEffects()).dropShadowColor;
      if (parseEffectProperty(target[2]!))
        return effectParameterValue(item.effects ?? createLayerEffects(), target[2]!);
      return readElementDataValue(item.element, target[2]!);
    }
  }
  if (property === 'clock.manualValue')
    return element.type === 'text' && element.clock?.source === 'manual'
      ? element.clock.manualValue
      : undefined;
  const clockSetting = clockDataSetting(property);
  if (clockSetting)
    return element.type === 'text' && element.clock ? element.clock[clockSetting] : undefined;
  if (element.type === 'chart' && property === 'data') return JSON.stringify(element.data);
  if (
    property === 'dropShadowColor' ||
    property.startsWith('effects.') ||
    isLayerRuleProperty(property)
  )
    return undefined;
  if (property === 'cornerRadius')
    return element.type === 'rectangle' ? element.borderRadius.topLeft : undefined;
  const shaderTarget = SHADER_PARAMETER_TARGET.exec(property);
  if (shaderTarget) {
    const shader = getElementShaderPaint(
      element,
      shaderTarget[1] === 'strokePaint' ? 'stroke' : 'fill',
    );
    return shader ? resolveShaderParameters(shader)[shaderTarget[2]!] : undefined;
  }
  const stop = /^fill\.stops\[(0|[1-9]\d*)\]\.color$/.exec(property);
  if (stop)
    return 'fill' in element && isGradientPaint(element.fill)
      ? element.fill.stops[Number(stop[1])]?.color
      : undefined;
  return (element as unknown as Record<string, unknown>)[property];
}
