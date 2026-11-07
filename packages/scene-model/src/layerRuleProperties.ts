import type { LayerTransform } from './types';

/** Geometry replaces only the named pose channel while a rule holds; offsets remain additive. */
export const LAYER_RULE_PROPERTIES = [
  { value: 'layer.x', label: 'Position X', unit: 'px', neutral: 0 },
  { value: 'layer.y', label: 'Position Y', unit: 'px', neutral: 0 },
  { value: 'layer.width', label: 'Width', unit: 'px', neutral: 0 },
  { value: 'layer.height', label: 'Height', unit: 'px', neutral: 0 },
  { value: 'layer.offsetX', label: 'Move horizontally', unit: 'px', neutral: 0 },
  { value: 'layer.offsetY', label: 'Move vertically', unit: 'px', neutral: 0 },
  { value: 'layer.rotation', label: 'Rotate by', unit: '°', neutral: 0 },
  { value: 'layer.scale', label: 'Scale', unit: '×', neutral: 1 },
  { value: 'layer.opacity', label: 'Opacity', unit: '×', neutral: 1 },
] as const;

export type LayerRuleGeometryProperty = 'x' | 'y' | 'width' | 'height';
export type LayerRuleProperty =
  (typeof LAYER_RULE_PROPERTIES)[number]['value'] | LayerRuleGeometryProperty;

/** Older templates used bare geometry names. Canonical keys preserve last-rule-wins ordering. */
export function canonicalLayerRuleProperty(property: string): string {
  return layerRuleGeometryProperty(property)
    ? `layer.${property.replace(/^layer\./, '')}`
    : property;
}

export function layerRuleGeometryProperty(property: string): LayerRuleGeometryProperty | null {
  const channel = property.replace(/^layer\./, '');
  return channel === 'x' || channel === 'y' || channel === 'width' || channel === 'height'
    ? channel
    : null;
}

export interface LayerRuleModifiers {
  offsetX: number;
  offsetY: number;
  rotation: number;
  scale: number;
  opacity: number;
  geometry?: Partial<Pick<LayerTransform, LayerRuleGeometryProperty>>;
}

export function isLayerRuleProperty(property: string): property is LayerRuleProperty {
  return LAYER_RULE_PROPERTIES.some(
    (entry) => entry.value === canonicalLayerRuleProperty(property),
  );
}

/** The value that leaves a layer exactly as its animation draws it. */
export function layerRuleNeutralValue(property: LayerRuleProperty, pose?: LayerTransform): number {
  const geometry = layerRuleGeometryProperty(property);
  if (geometry && pose) return pose[geometry];
  return LAYER_RULE_PROPERTIES.find(
    (entry) => entry.value === canonicalLayerRuleProperty(property),
  )!.neutral;
}

/** Shared validation for authored Rules and MCP operations; numeric legacy strings are accepted. */
export function layerRulePropertyValueError(property: string, value: unknown): string | null {
  if (!isLayerRuleProperty(property)) return null;
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number))
    return `Needs a finite number for "${property}".`;
  const channel = layerRuleGeometryProperty(property);
  if ((channel === 'width' || channel === 'height' || property === 'layer.scale') && number < 0)
    return `"${property}" must be zero or more.`;
  if (property === 'layer.opacity' && (number < 0 || number > 1))
    return `"${property}" must be between 0 and 1.`;
  return null;
}

function finiteOr(value: unknown, fallback: number): number {
  const number = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Rule output as layer offsets; `null` when no layer-level property is set. */
export function layerRuleModifiers(
  properties: Readonly<Record<string, unknown>> | undefined,
): LayerRuleModifiers | null {
  if (!properties || !Object.keys(properties).some(isLayerRuleProperty)) return null;
  const geometry: NonNullable<LayerRuleModifiers['geometry']> = {};
  for (const [property, value] of Object.entries(properties)) {
    const channel = layerRuleGeometryProperty(property);
    if (channel && !layerRulePropertyValueError(property, value)) geometry[channel] = Number(value);
  }
  return {
    offsetX: finiteOr(properties['layer.offsetX'], 0),
    offsetY: finiteOr(properties['layer.offsetY'], 0),
    rotation: finiteOr(properties['layer.rotation'], 0),
    scale: Math.max(0, finiteOr(properties['layer.scale'], 1)),
    opacity: Math.min(1, Math.max(0, finiteOr(properties['layer.opacity'], 1))),
    ...(Object.keys(geometry).length ? { geometry } : {}),
  };
}

/** Real dimensions/positions, shared by Studio and the exported runtime, never a CSS scale. */
export function applyLayerRuleGeometry(
  pose: LayerTransform,
  modifiers: LayerRuleModifiers | null,
): LayerTransform {
  return modifiers?.geometry ? { ...pose, ...modifiers.geometry } : pose;
}
