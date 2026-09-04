import { applyElementDataValue } from './boundPaint';
import { effectParameterValue, parseEffectProperty, withEffectParameter } from './effectStack';
import type { Composition, Layer, StylePackColorLink } from './types';

export function readColor(value: unknown): { rgb: number[]; alpha: number } | null {
  if (typeof value !== 'string') return null;
  let text = value.trim().toLowerCase();
  text =
    ({ white: '#ffffff', black: '#000000', transparent: '#00000000' } as Record<string, string>)[
      text
    ] ?? text;
  if (/^#[0-9a-f]{3,4}$/.test(text)) text = '#' + [...text.slice(1)].map((c) => c + c).join('');
  if (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/.test(text))
    return {
      rgb: [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16)),
      alpha: text.length === 9 ? parseInt(text.slice(7), 16) / 255 : 1,
    };
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(
    text,
  );
  return match
    ? { rgb: match.slice(1, 4).map(Number), alpha: match[4] === undefined ? 1 : Number(match[4]) }
    : null;
}

export function packColorValue(
  source: string,
  factor: number,
  alpha: number,
  hexAlpha = false,
): string {
  const color = readColor(source);
  if (!color) return source;
  if (factor === 1 && alpha === 1) return source;
  alpha *= color.alpha;
  const rgb = color.rgb.map((n) => Math.min(255, Math.max(0, Math.round(n * factor))));
  const hex =
    '#' +
    rgb
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  if (alpha === 1) return hex;
  return hexAlpha
    ? hex +
        Math.round(alpha * 255)
          .toString(16)
          .padStart(2, '0')
    : `rgba(${rgb.join(', ')}, ${alpha})`;
}

export function layerColorValue(layer: Layer, property: string): string | undefined {
  if (parseEffectProperty(property)) {
    const value = effectParameterValue(layer.effects, property);
    return typeof value === 'string' ? value : undefined;
  }
  if (property === 'dropShadowColor') return layer.effects.dropShadowColor;
  const stop = /^fill\.stops\[(\d+)\]\.color$/.exec(property);
  if (stop && 'fill' in layer.element && typeof layer.element.fill !== 'string')
    return layer.element.fill.stops[Number(stop[1])]?.color;
  if (['fill', 'color', 'strokeColor'].includes(property) && property in layer.element) {
    const value = (layer.element as unknown as Record<string, unknown>)[property];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

function writeLayerColor(layer: Layer, property: string, value: string): boolean {
  if (layerColorValue(layer, property) === undefined) return false;
  if (parseEffectProperty(property))
    layer.effects = withEffectParameter(layer.effects, property, value);
  else if (property === 'dropShadowColor') layer.effects.dropShadowColor = value;
  else layer.element = applyElementDataValue(layer.element, property, value);
  return true;
}

/** Parent swatch edits update existing custom controls, GDD defaults and authored colors together. */
export function syncStylePackColorLinks(
  composition: Composition,
  changedTokenId?: string,
): string[] {
  const affected = new Set<string>();
  const layers = [...composition.layers, ...composition.components.flatMap((c) => c.layers)];
  const fields = [
    ...composition.dataFields,
    ...composition.components.flatMap((c) => c.dataFields),
  ];
  for (const link of composition.designSystem.stylePackColors ?? []) {
    if (
      changedTokenId &&
      link.sourceTokenId !== changedTokenId &&
      link.targetTokenId !== changedTokenId
    )
      continue;
    const source = composition.designSystem.tokens.find(
      (t) => t.id === link.sourceTokenId && t.type === 'color',
    );
    if (!source || !Number.isFinite(link.factor) || !Number.isFinite(link.alpha)) continue;
    const token = composition.designSystem.tokens.find(
      (t) => t.id === link.targetTokenId && t.type === 'color',
    );
    const color =
      token && changedTokenId === token.id
        ? String(token.value)
        : packColorValue(String(source.value), link.factor, link.alpha, Boolean(token));
    if (token) {
      token.value = color;
      for (const field of fields)
        if (field.defaultTokenId === token.id && field.type === 'color') field.defaultValue = color;
      for (const layer of layers)
        for (const binding of layer.designTokenBindings)
          if (binding.tokenId === token.id && writeLayerColor(layer, binding.targetProperty, color))
            affected.add(layer.id);
    }
    const field = fields.find((f) => f.id === link.targetFieldId && f.type === 'color');
    if (field) field.defaultValue = color;
    for (const target of link.targets) {
      const layer = layers.find((l) => l.id === target.layerId);
      if (layer && writeLayerColor(layer, target.property, color)) affected.add(layer.id);
    }
  }
  return [...affected];
}

export function stylePackColorUsesToken(composition: Composition, tokenId: string): boolean {
  return (composition.designSystem.stylePackColors ?? []).some(
    (link) => link.sourceTokenId === tokenId || link.targetTokenId === tokenId,
  );
}

export function stylePackColorLinkErrors(composition: Composition): string[] {
  const errors: string[] = [];
  const links = composition.designSystem.stylePackColors ?? [];
  if (!Array.isArray(links)) return ['Pack palette links must be an array.'];
  const sources = new Set(
    links.filter((link) => link && typeof link === 'object').map((link) => link.sourceTokenId),
  );
  const keys = new Set<string>();
  for (const link of links) {
    if (!link || typeof link !== 'object') {
      errors.push('Invalid pack palette link.');
      continue;
    }
    if (
      !composition.designSystem.tokens.some(
        (t) => t.id === link.sourceTokenId && t.type === 'color',
      )
    )
      errors.push('Pack palette source token is missing.');
    if (
      link.targetTokenId &&
      !composition.designSystem.tokens.some(
        (t) => t.id === link.targetTokenId && t.type === 'color',
      )
    )
      errors.push('Pack palette target token is missing.');
    if (
      (link.targetTokenId && sources.has(link.targetTokenId)) ||
      !Number.isFinite(link.factor) ||
      link.factor < 0 ||
      link.factor > 1 ||
      !Number.isFinite(link.alpha) ||
      link.alpha < 0 ||
      link.alpha > 1
    )
      errors.push('Invalid pack palette color transform.');
    if (!Array.isArray(link.targets)) {
      errors.push('Pack palette targets must be an array.');
      continue;
    }
    if (
      link.targets.some(
        (t) => !t || typeof t.layerId !== 'string' || typeof t.property !== 'string',
      )
    )
      errors.push('Invalid pack palette layer target.');
    const key = colorLinkKey(link);
    if (keys.has(key)) errors.push('Duplicate pack palette target.');
    keys.add(key);
  }
  return errors;
}

export function colorLinkKey(
  link: Pick<StylePackColorLink, 'targetTokenId' | 'targetFieldId' | 'targets'>,
): string {
  return link.targetTokenId
    ? `token:${link.targetTokenId}`
    : link.targetFieldId
      ? `field:${link.targetFieldId}`
      : `layer:${link.targets[0]?.layerId}:${link.targets[0]?.property}`;
}
