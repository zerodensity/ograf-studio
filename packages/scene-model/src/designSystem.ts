import type {
  Composition,
  DesignToken,
  DesignTokenBinding,
  DesignTokenTargetProperty,
  DesignTokenType,
  DesignTokenValue,
  Layer,
} from './types';

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
  if (property === 'fill') {
    if (!['rectangle', 'ellipse', 'path'].includes(layer.element.type)) {
      throw new Error(`Property fill is not supported by ${layer.element.type} layers.`);
    }
    if (token.type !== 'color') throw new Error('Property fill requires a color design token.');
    return;
  }
  if (property === 'strokeColor') {
    if (!['rectangle', 'ellipse', 'path'].includes(layer.element.type)) {
      throw new Error(`Property strokeColor is not supported by ${layer.element.type} layers.`);
    }
    if (token.type !== 'color') {
      throw new Error('Property strokeColor requires a color design token.');
    }
    return;
  }
  if (property === 'strokeWidth') {
    if (!['rectangle', 'ellipse', 'path'].includes(layer.element.type)) {
      throw new Error(`Property strokeWidth is not supported by ${layer.element.type} layers.`);
    }
    if (token.type !== 'number') {
      throw new Error('Property strokeWidth requires a number design token.');
    }
    return;
  }
  if (property === 'borderRadius') {
    if (layer.element.type !== 'rectangle') {
      throw new Error(`Property borderRadius is not supported by ${layer.element.type} layers.`);
    }
    if (token.type !== 'number') {
      throw new Error('Property borderRadius requires a number design token.');
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

export function applyDesignTokenBinding(
  layer: Layer,
  binding: DesignTokenBinding,
  token: DesignToken,
): void {
  assertCompatible(layer, binding, token);
  const value = normalizeDesignTokenValue(token.type, token.value);
  const property: DesignTokenTargetProperty = binding.targetProperty;
  if (property === 'fill' && 'fill' in layer.element) layer.element.fill = String(value);
  else if (property === 'strokeColor' && 'strokeColor' in layer.element) {
    layer.element.strokeColor = String(value);
  } else if (property === 'strokeWidth' && 'strokeWidth' in layer.element) {
    layer.element.strokeWidth = Math.max(0, Number(value));
  } else if (property === 'borderRadius' && layer.element.type === 'rectangle') {
    layer.element.borderRadius = Math.max(0, Number(value));
  } else if (property === 'color' && layer.element.type === 'text') {
    layer.element.color = String(value);
  } else if (property === 'fontFamily' && layer.element.type === 'text') {
    layer.element.fontFamily = String(value);
  } else if (property === 'fontSize' && layer.element.type === 'text') {
    layer.element.fontSize = Math.max(1, Number(value));
  } else if (property === 'fontWeight' && layer.element.type === 'text') {
    layer.element.fontWeight = Math.max(1, Math.round(Number(value)));
  }
}

export function syncDesignToken(composition: Composition, tokenId: string): string[] {
  const token = composition.designSystem.tokens.find((candidate) => candidate.id === tokenId);
  if (!token) throw new Error(`Design token not found: ${tokenId}`);
  const affected: string[] = [];
  for (const layer of composition.layers) {
    for (const binding of layer.designTokenBindings.filter((item) => item.tokenId === tokenId)) {
      applyDesignTokenBinding(layer, binding, token);
      affected.push(layer.id);
    }
  }
  return [...new Set(affected)];
}
