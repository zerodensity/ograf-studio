import { applyDesignTokenBinding } from './designSystem';
import { effectParameterValue, parseEffectProperty, withEffectParameter } from './effectStack';
import type {
  Composition,
  DesignTokenTargetProperty,
  Layer,
  StylePackPropertyRestore,
  StylePackRestoreState,
  AnimatableLayerProperty,
} from './types';

// Snapshots also run against the editor's Immer drafts; JSON-domain copying accepts those proxies.
function copyStyleData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const ELEMENT_PROPERTIES = [
  'fill',
  'strokeColor',
  'strokeWidth',
  'borderRadius',
  'color',
  'fontFamily',
  'fontSize',
  'fontWeight',
] as const;
const CORNERS = {
  borderRadiusTopLeft: 'topLeft',
  borderRadiusTopRight: 'topRight',
  borderRadiusBottomLeft: 'bottomLeft',
  borderRadiusBottomRight: 'bottomRight',
} as const;

function styleValue(
  layer: Layer,
  property: DesignTokenTargetProperty,
): StylePackPropertyRestore['value'] | undefined {
  if (parseEffectProperty(property)) return effectParameterValue(layer.effects, property);
  if (property === 'dropShadowColor') return layer.effects.dropShadowColor;
  const stop = /^fill\.stops\[(\d+)\]\.color$/.exec(property);
  if (stop && 'fill' in layer.element && typeof layer.element.fill !== 'string')
    return layer.element.fill.stops[Number(stop[1])]?.color;
  if (Object.hasOwn(CORNERS, property) && layer.element.type === 'rectangle')
    return layer.element.borderRadius[CORNERS[property as keyof typeof CORNERS]];
  if (ELEMENT_PROPERTIES.includes(property as (typeof ELEMENT_PROPERTIES)[number]))
    return (layer.element as unknown as Record<string, StylePackPropertyRestore['value']>)[
      property
    ];
  return undefined;
}

export function createStylePackRestore(
  composition: Composition,
  tokenKeys: Set<string>,
): StylePackRestoreState {
  return {
    name: composition.designSystem.name,
    updateTransitionFrames: composition.updateTransitionFrames,
    tokens: composition.designSystem.tokens.flatMap((token, index) =>
      tokenKeys.has(token.key) ? [{ index, token: copyStyleData(token) }] : [],
    ),
    layers: [],
    fields: composition.dataFields
      .filter((field) => field.type === 'color')
      .map((field) => ({
        fieldId: field.id,
        defaultValue: copyStyleData(field.defaultValue),
        ...(field.defaultTokenId ? { defaultTokenId: field.defaultTokenId } : {}),
      })),
  };
}

export function rememberPackProperty(
  composition: Composition,
  layer: Layer,
  property: DesignTokenTargetProperty,
): void {
  const restore = composition.designSystem.stylePackRestore;
  if (!restore) return;
  const value = styleValue(layer, property);
  if (value === undefined) return;
  let record = restore.layers.find((entry) => entry.layerId === layer.id);
  if (!record) {
    record = {
      layerId: layer.id,
      elementType: layer.element.type,
      properties: [],
      bindingOrder: layer.designTokenBindings.map((b) => b.targetProperty),
    };
    restore.layers.push(record);
  }
  if (record.properties.some((entry) => entry.property === property)) return;
  const track = layer.animationTracks[property as AnimatableLayerProperty];
  record.properties.push({
    property,
    value: copyStyleData(value),
    ...(property === 'fontSize' && layer.element.type === 'text'
      ? { minFontSize: layer.element.minFontSize }
      : {}),
    bindings: copyStyleData(
      layer.designTokenBindings.filter((binding) => binding.targetProperty === property),
    ),
    ...(track?.length === 1 && track[0]!.value === value
      ? { constantKey: { id: track[0]!.id, value: track[0]!.value } }
      : {}),
  });
}

export function rememberPackToken(composition: Composition, tokenId: string): void {
  const restore = composition.designSystem.stylePackRestore;
  if (!restore || restore.tokens.some((t) => t.token.id === tokenId)) return;
  const index = composition.designSystem.tokens.findIndex((t) => t.id === tokenId);
  if (index >= 0)
    restore.tokens.push({ index, token: copyStyleData(composition.designSystem.tokens[index]!) });
}

export function rememberPackColorField(composition: Composition, fieldId: string): void {
  const restore = composition.designSystem.stylePackRestore;
  if (!restore) return;
  const field = [
    ...composition.dataFields,
    ...composition.components.flatMap((c) => c.dataFields),
  ].find((f) => f.id === fieldId && f.type === 'color');
  if (!field) return;
  if (!restore.fields.some((f) => f.fieldId === fieldId))
    restore.fields.push({
      fieldId,
      defaultValue: copyStyleData(field.defaultValue),
      ...(field.defaultTokenId ? { defaultTokenId: field.defaultTokenId } : {}),
    });
  restore.colorFieldIds ??= [];
  if (!restore.colorFieldIds.includes(fieldId)) restore.colorFieldIds.push(fieldId);
}

function restoreProperty(layer: Layer, entry: StylePackPropertyRestore): void {
  const { property, value } = entry;
  // Only known style paths may write to a layer; imported restore metadata is untrusted.
  if (styleValue(layer, property) === undefined) return;
  if (parseEffectProperty(property))
    layer.effects = withEffectParameter(layer.effects, property, value);
  else if (property === 'dropShadowColor') layer.effects.dropShadowColor = String(value);
  else if (Object.hasOwn(CORNERS, property) && layer.element.type === 'rectangle')
    layer.element.borderRadius[CORNERS[property as keyof typeof CORNERS]] = Number(value);
  else {
    const stop = /^fill\.stops\[(\d+)\]\.color$/.exec(property);
    if (stop && 'fill' in layer.element && typeof layer.element.fill !== 'string')
      layer.element.fill.stops[Number(stop[1])]!.color = String(value);
    else if (ELEMENT_PROPERTIES.includes(property as (typeof ELEMENT_PROPERTIES)[number]))
      (layer.element as unknown as Record<string, unknown>)[property] = copyStyleData(value);
  }
  if (entry.minFontSize !== undefined && layer.element.type === 'text')
    layer.element.minFontSize = entry.minFontSize;
  const track = layer.animationTracks[property as AnimatableLayerProperty];
  if (entry.constantKey && track?.length === 1 && track[0]!.id === entry.constantKey.id)
    track[0]!.value = entry.constantKey.value;
}

export function restorePackAppearance(
  composition: Composition,
  removedTokenIds: Set<string>,
): string[] {
  const restore = composition.designSystem.stylePackRestore;
  if (!restore) return [];
  for (const { token, index } of [...restore.tokens].sort((a, b) => a.index - b.index)) {
    const existing = composition.designSystem.tokens.findIndex((t) => t.id === token.id);
    if (existing >= 0) composition.designSystem.tokens[existing] = copyStyleData(token);
    else
      composition.designSystem.tokens.splice(
        Math.min(index, composition.designSystem.tokens.length),
        0,
        copyStyleData(token),
      );
  }
  const affected: string[] = [];
  for (const layer of [
    ...composition.layers,
    ...composition.components.flatMap((component) => component.layers),
  ]) {
    const record = restore.layers.find(
      (entry) => entry.layerId === layer.id && entry.elementType === layer.element.type,
    );
    if (!record) continue;
    for (const entry of record.properties) {
      restoreProperty(layer, entry);
      layer.designTokenBindings = layer.designTokenBindings.filter(
        (binding) => binding.targetProperty !== entry.property,
      );
      for (const binding of entry.bindings) {
        const token = composition.designSystem.tokens.find((t) => t.id === binding.tokenId);
        if (!token || styleValue(layer, binding.targetProperty) === undefined) continue;
        layer.designTokenBindings.push(copyStyleData(binding));
        applyDesignTokenBinding(layer, binding, token);
      }
    }
    if (record.bindingOrder) {
      const order = new Map(record.bindingOrder.map((property, index) => [property, index]));
      layer.designTokenBindings.sort(
        (a, b) =>
          (order.get(a.targetProperty) ?? Infinity) - (order.get(b.targetProperty) ?? Infinity),
      );
    }
    affected.push(layer.id);
  }
  for (const field of [
    ...composition.dataFields,
    ...composition.components.flatMap((component) => component.dataFields),
  ]) {
    if (
      (!field.defaultTokenId || !removedTokenIds.has(field.defaultTokenId)) &&
      !restore.colorFieldIds?.includes(field.id)
    )
      continue;
    const record = restore.fields.find((entry) => entry.fieldId === field.id);
    if (!record) continue;
    field.defaultValue = copyStyleData(record.defaultValue);
    if (
      record.defaultTokenId &&
      composition.designSystem.tokens.some((t) => t.id === record.defaultTokenId)
    )
      field.defaultTokenId = record.defaultTokenId;
    else delete field.defaultTokenId;
  }
  composition.updateTransitionFrames = restore.updateTransitionFrames;
  delete composition.designSystem.stylePackRestore;
  return affected;
}
