import type {
  Composition,
  DesignToken,
  DesignTokenBinding,
  DesignTokenTargetProperty,
  DesignTokenType,
  DesignTokenValue,
  AnimatableLayerProperty,
  FieldDefinition,
  Layer,
} from './types';
import { createCornerRadii } from './cornerRadii';
import { syncStylePackColorLinks } from './stylePackColorLinks';
import {
  parseEffectProperty,
  effectParameterSpec,
  effectParameterValue,
  withEffectParameter,
} from './effectStack';

const CORNER_RADIUS_PROPERTIES = [
  'borderRadius',
  'borderRadiusTopLeft',
  'borderRadiusTopRight',
  'borderRadiusBottomRight',
  'borderRadiusBottomLeft',
] as const;

function assertTokenValue(type: DesignTokenType, value: DesignTokenValue): void {
  if ((type === 'number' || type === 'font-weight') && typeof value !== 'number') {
    throw new Error(`Design token type ${type} requires a numeric value.`);
  }
  if (
    (type === 'color' || type === 'text' || type === 'font-family') &&
    typeof value !== 'string'
  ) {
    throw new Error(`Design token type ${type} requires a string value.`);
  }
  if (type === 'color' && !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(String(value))) {
    throw new Error('Color design tokens must use #RRGGBB or #RRGGBBAA.');
  }
}

function assertCompatible(layer: Layer, binding: DesignTokenBinding, token: DesignToken): void {
  const property = binding.targetProperty;
  if (parseEffectProperty(property)) {
    const spec = effectParameterSpec(layer.effects, property);
    if (!spec) throw Error(`Effect parameter not found: ${property}`);
    if (token.type !== (typeof spec.default === 'number' ? 'number' : 'color'))
      throw Error(
        `Effect parameter ${property} needs a ${typeof spec.default === 'number' ? 'number' : 'color'} token.`,
      );
    if (
      typeof spec.default === 'number' &&
      (Number(token.value) < spec.min! || Number(token.value) > spec.max!)
    )
      throw Error('Effect token value is outside its allowed range.');
    return;
  }
  const stopIndex = gradientColorIndex(property);
  if (stopIndex !== null) {
    if (
      !('fill' in layer.element) ||
      typeof layer.element.fill === 'string' ||
      !layer.element.fill.stops[stopIndex]
    ) {
      throw new Error(`Property ${property} requires an existing gradient stop.`);
    }
    if (token.type !== 'color')
      throw new Error('Gradient stop colors require a color design token.');
    return;
  }
  if (property === 'dropShadowColor') {
    if (token.type !== 'color') throw new Error('Shadow color requires a color design token.');
    return;
  }
  if (property === 'fill') {
    if (!['rectangle', 'ellipse', 'path', 'pattern'].includes(layer.element.type)) {
      throw new Error(`Property fill is not supported by ${layer.element.type} layers.`);
    }
    if (token.type !== 'color') throw new Error('Property fill requires a color design token.');
    return;
  }
  if (property === 'strokeColor') {
    if (!['rectangle', 'ellipse', 'text', 'path', 'pattern'].includes(layer.element.type)) {
      throw new Error(`Property strokeColor is not supported by ${layer.element.type} layers.`);
    }
    if (token.type !== 'color') {
      throw new Error('Property strokeColor requires a color design token.');
    }
    return;
  }
  if (property === 'strokeWidth') {
    if (!['rectangle', 'ellipse', 'text', 'path', 'pattern'].includes(layer.element.type)) {
      throw new Error(`Property strokeWidth is not supported by ${layer.element.type} layers.`);
    }
    if (token.type !== 'number') {
      throw new Error('Property strokeWidth requires a number design token.');
    }
    return;
  }
  if ((CORNER_RADIUS_PROPERTIES as readonly string[]).includes(property)) {
    if (layer.element.type !== 'rectangle') {
      throw new Error(`Property ${property} is not supported by ${layer.element.type} layers.`);
    }
    if (token.type !== 'number') {
      throw new Error(`Property ${property} requires a number design token.`);
    }
    return;
  }
  if (!['color', 'fontFamily', 'fontSize', 'fontWeight'].includes(property)) {
    throw new Error(`Unknown design-token target property: ${property}`);
  }
  if (layer.element.type !== 'text') {
    throw new Error(`Property ${property} is supported only by text layers.`);
  }
  if (property === 'color' && token.type !== 'color') {
    throw new Error('Property color requires a color design token.');
  }
  if (property === 'fontFamily' && token.type !== 'font-family') {
    throw new Error('Property fontFamily requires a font-family design token.');
  }
  if (property === 'fontSize' && token.type !== 'number') {
    throw new Error('Property fontSize requires a number design token.');
  }
  if (property === 'fontWeight' && token.type !== 'font-weight') {
    throw new Error('Property fontWeight requires a font-weight design token.');
  }
}

export function normalizeDesignTokenValue(
  type: DesignTokenType,
  value: DesignTokenValue,
): DesignTokenValue {
  assertTokenValue(type, value);
  if (typeof value === 'string') return value.trim();
  return Number(value);
}

function gradientColorIndex(property: string): number | null {
  const match = /^fill\.stops\[(0|[1-9]\d*)\]\.color$/.exec(property);
  return match ? Number(match[1]) : null;
}

export function applyDesignTokenBinding(
  layer: Layer,
  binding: DesignTokenBinding,
  token: DesignToken,
): void {
  assertCompatible(layer, binding, token);
  const value = normalizeDesignTokenValue(token.type, token.value);
  const property: DesignTokenTargetProperty = binding.targetProperty;
  if (parseEffectProperty(property)) {
    const before = effectParameterValue(layer.effects, property);
    layer.effects = withEffectParameter(layer.effects, property, value);
    const track = layer.animationTracks[property as AnimatableLayerProperty];
    if (typeof value === 'number' && track?.length === 1 && track[0]!.value === before)
      track[0]!.value = value;
    return;
  }
  const stopIndex = gradientColorIndex(property);
  if (stopIndex !== null && 'fill' in layer.element && typeof layer.element.fill !== 'string') {
    layer.element.fill.stops[stopIndex]!.color = String(value);
    return;
  }
  if (property === 'dropShadowColor') {
    layer.effects.dropShadowColor = String(value);
    return;
  }
  const previousStrokeWidth = 'strokeWidth' in layer.element ? layer.element.strokeWidth : null;
  if (property === 'fill' && 'fill' in layer.element) layer.element.fill = String(value);
  else if (property === 'strokeColor' && 'strokeColor' in layer.element) {
    layer.element.strokeColor = String(value);
  } else if (property === 'strokeWidth' && 'strokeWidth' in layer.element) {
    layer.element.strokeWidth = Math.max(0, Number(value));
    const track = layer.animationTracks.strokeWidth;
    if (track?.length === 1 && track[0]!.value === previousStrokeWidth) {
      track[0]!.value = layer.element.strokeWidth;
    }
  } else if (property === 'borderRadius' && layer.element.type === 'rectangle') {
    layer.element.borderRadius = createCornerRadii(Number(value));
  } else if (property === 'borderRadiusTopLeft' && layer.element.type === 'rectangle') {
    layer.element.borderRadius.topLeft = Math.max(0, Number(value));
  } else if (property === 'borderRadiusTopRight' && layer.element.type === 'rectangle') {
    layer.element.borderRadius.topRight = Math.max(0, Number(value));
  } else if (property === 'borderRadiusBottomRight' && layer.element.type === 'rectangle') {
    layer.element.borderRadius.bottomRight = Math.max(0, Number(value));
  } else if (property === 'borderRadiusBottomLeft' && layer.element.type === 'rectangle') {
    layer.element.borderRadius.bottomLeft = Math.max(0, Number(value));
  } else if (property === 'color' && layer.element.type === 'text') {
    layer.element.color = String(value);
  } else if (property === 'fontFamily' && layer.element.type === 'text') {
    layer.element.fontFamily = String(value);
  } else if (property === 'fontSize' && layer.element.type === 'text') {
    const previousSize = Math.max(1, layer.element.fontSize);
    const floorRatio = layer.element.minFontSize / previousSize;
    layer.element.fontSize = Math.max(1, Number(value));
    layer.element.minFontSize = Math.min(
      layer.element.fontSize,
      Math.max(1, layer.element.fontSize * floorRatio),
    );
  } else if (property === 'fontWeight' && layer.element.type === 'text') {
    layer.element.fontWeight = Math.max(1, Math.round(Number(value)));
  }
}

export function syncDesignToken(composition: Composition, tokenId: string): string[] {
  const token = composition.designSystem.tokens.find((candidate) => candidate.id === tokenId);
  if (!token) throw new Error(`Design token not found: ${tokenId}`);
  syncDesignTokenFieldDefaults(composition, tokenId);
  const affected: string[] = [];
  for (const layer of composition.layers) {
    for (const binding of layer.designTokenBindings.filter((item) => item.tokenId === tokenId)) {
      applyDesignTokenBinding(layer, binding, token);
      affected.push(layer.id);
    }
  }
  affected.push(...syncStylePackColorLinks(composition, tokenId));
  return [...new Set(affected)];
}

export function bindFieldDefaultToken(
  composition: Composition,
  field: FieldDefinition,
  tokenId: string | null,
): void {
  if (tokenId === null) {
    delete field.defaultTokenId;
    return;
  }
  const token = composition.designSystem.tokens.find((t) => t.id === tokenId);
  if (field.type !== 'color' || token?.type !== 'color')
    throw new Error('A field default token must link a color field to a color Brand Kit token.');
  field.defaultTokenId = token.id;
  field.defaultValue = String(token.value);
}

export function syncDesignTokenFieldDefaults(composition: Composition, tokenId: string): void {
  for (const field of composition.dataFields)
    if (field.defaultTokenId === tokenId) bindFieldDefaultToken(composition, field, tokenId);
}
