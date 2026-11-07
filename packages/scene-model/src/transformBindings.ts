import type { FieldDefinition, LayerBinding, LayerTransform } from './types';
import { fieldDefinitionAtPath, valueAtSourcePath } from './fieldSchema';

export const LAYER_TRANSFORM_BINDING_PROPERTIES = [
  { value: 'layer.x', label: 'Position X', channel: 'x' },
  { value: 'layer.y', label: 'Position Y', channel: 'y' },
  { value: 'layer.width', label: 'Width', channel: 'width' },
  { value: 'layer.height', label: 'Height', channel: 'height' },
  { value: 'layer.rotation', label: 'Rotation', channel: 'rotation' },
  { value: 'layer.opacity', label: 'Opacity factor', channel: 'opacity' },
] as const;
export type LayerTransformBindingChannel =
  (typeof LAYER_TRANSFORM_BINDING_PROPERTIES)[number]['channel'];
export function layerTransformBindingChannel(
  property: string,
): LayerTransformBindingChannel | undefined {
  return LAYER_TRANSFORM_BINDING_PROPERTIES.find((entry) => entry.value === property)?.channel;
}
export function layerTransformBindingValueError(property: string, value: unknown): string | null {
  const channel = layerTransformBindingChannel(property);
  if (!channel) return null;
  if (typeof value !== 'number' || !Number.isFinite(value))
    return `${property} requires a finite number.`;
  if ((channel === 'width' || channel === 'height') && value < 0)
    return `${property} must be zero or greater.`;
  if (channel === 'opacity' && (value < 0 || value > 1))
    return `${property} must be between 0 and 1.`;
  return null;
}

/** Data replaces sampled geometry; alpha is a factor so authored IN/OUT fades stay authoritative. */
export function applyLayerTransformBindings<
  B extends { targetProperty: string; valueMap?: Record<string, unknown> },
>(pose: LayerTransform, bindings: readonly B[], read: (binding: B) => unknown): LayerTransform {
  let result = pose;
  for (const binding of bindings) {
    const channel = layerTransformBindingChannel(binding.targetProperty);
    if (!channel) continue;
    const value = read(binding);
    const mapped = binding.valueMap?.[String(value)] ?? value;
    if (value === undefined || layerTransformBindingValueError(binding.targetProperty, mapped))
      continue;
    if (result === pose) result = { ...pose };
    result[channel] =
      channel === 'opacity' ? pose.opacity * (mapped as number) : (mapped as number);
  }
  return result;
}

/** Shared schema/default validation, including nested object and collection-item leaves. */
export function layerTransformBindingErrors(
  binding: LayerBinding,
  field: FieldDefinition | undefined,
): string[] {
  const channel = layerTransformBindingChannel(binding.targetProperty);
  if (!channel)
    return binding.targetProperty.startsWith('layer.')
      ? [`Unknown layer transform binding ${binding.targetProperty}.`]
      : [];
  if (!field) return [`${binding.targetProperty} references a missing field.`];
  const array = field.type === 'array';
  const leaf = fieldDefinitionAtPath(field, binding.sourcePath ?? [], { fromArrayItem: array });
  if (!leaf) return [`${binding.targetProperty} needs a valid numeric field path.`];
  const errors: string[] = [];
  if (!['number', 'integer', 'percentage', 'duration-ms'].includes(leaf.type) && !binding.valueMap)
    errors.push(`${binding.targetProperty} requires a numeric field or numeric value mapping.`);
  for (const mapped of Object.values(binding.valueMap ?? {})) {
    const error = layerTransformBindingValueError(binding.targetProperty, mapped);
    if (error) errors.push(error);
  }
  const roots =
    array && Array.isArray(field.defaultValue) ? field.defaultValue : [field.defaultValue];
  const defaults = roots.map((root) => valueAtSourcePath(root, binding.sourcePath));
  if (!defaults.some((value) => value !== undefined)) defaults.push(leaf.defaultValue);
  for (const value of defaults) {
    if (value === undefined) continue;
    const error = layerTransformBindingValueError(
      binding.targetProperty,
      binding.valueMap?.[String(value)] ?? value,
    );
    if (error) errors.push(`Field default: ${error}`);
  }
  return [...new Set(errors)];
}
