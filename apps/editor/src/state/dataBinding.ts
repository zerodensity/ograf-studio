import {
  resolveElementAssetReferences,
  resolvePatternElement,
  applyElementDataValue,
  parseEffectProperty,
  withEffectParameter,
  getEffectStack,
  EFFECT_CATALOG,
  effectProperty,
  type LayerEffects,
  type TilingPattern,
  valueAtSourcePath,
  type Asset,
  type Element,
  type ElementType,
  type FieldDefinition,
  type Layer,
} from '@ograf-editor/scene-model';
import type { TestValue } from './testDataStore';

interface BindableProperty {
  value: string;
  label: string;
}

/** Layer properties a data field can drive — deliberately just the "content" surface of each element type. */
export const BINDABLE_PROPERTIES: Record<ElementType, BindableProperty[]> = {
  text: [
    { value: 'content', label: 'Text Content' },
    { value: 'color', label: 'Text Color' },
  ],
  image: [{ value: 'src', label: 'Image URL' }],
  rectangle: [{ value: 'fill', label: 'Fill Paint' }],
  ellipse: [{ value: 'fill', label: 'Fill Paint' }],
  path: [{ value: 'fill', label: 'Fill Paint' }],
  pattern: [{ value: 'fill', label: 'Fill Paint' }],
  // An image sequence's frame list isn't a sensible single-value data-binding target (v1 scope).
  'image-sequence': [],
  lottie: [],
};

/**
 * The element a layer should render with, given live test data — the authored `element` is left
 * untouched; each bound property is overridden only for display when a test value is present.
 * Fill bindings may carry a complete gradient object; other bindable properties stringify.
 */
export function resolveEffectiveElement(
  layer: Layer,
  testValues: Record<string, TestValue>,
  assets: Asset[] = [],
  dataFields: FieldDefinition[] = [],
  patterns: TilingPattern[] = [],
): Element {
  const element = layer.bindings.reduce<Element>((resolved, binding) => {
    const hasTestValue = Object.prototype.hasOwnProperty.call(testValues, binding.fieldId);
    const rootValue = hasTestValue
      ? testValues[binding.fieldId]
      : dataFields.find((field) => field.id === binding.fieldId)?.defaultValue;
    const field = dataFields.find((candidate) => candidate.id === binding.fieldId);
    const itemValue =
      field?.type === 'array' && Array.isArray(rootValue) ? rootValue[0] : rootValue;
    const value = valueAtSourcePath(itemValue, binding.sourcePath);
    if (value === undefined) return resolved;
    const mapped = binding.valueMap?.[String(value)] ?? value;
    return applyElementDataValue(resolved, binding.targetProperty, mapped);
  }, layer.element);
  return resolvePatternElement(resolveElementAssetReferences(element, assets), patterns);
}

export function bindableProperties(element: Element, effects?: LayerEffects): BindableProperty[] {
  const result = [
    ...BINDABLE_PROPERTIES[element.type],
    { value: 'dropShadowColor', label: 'Shadow Color' },
  ];
  if (effects)
    for (const effect of getEffectStack(effects).filter((e) => !e.legacy))
      for (const [key, spec] of Object.entries(EFFECT_CATALOG[effect.type].params))
        result.push({
          value: effectProperty(effect, key),
          label: `${effect.name} · ${spec.label}`,
        });
  if ('strokeColor' in element) result.push({ value: 'strokeColor', label: 'Outline Color' });
  if ('fill' in element && typeof element.fill !== 'string')
    result.push(
      ...element.fill.stops.map((_, i) => ({
        value: `fill.stops[${i}].color`,
        label: `Gradient Stop ${i + 1} Color`,
      })),
    );
  return result;
}

export function previewBindingData(
  fields: FieldDefinition[],
  values: Record<string, TestValue>,
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((f) => [f.key, Object.hasOwn(values, f.id) ? values[f.id] : f.defaultValue]),
  );
}

export function resolveEffectiveEffects(
  layer: Layer,
  effects: LayerEffects,
  testValues: Record<string, TestValue>,
  dataFields: FieldDefinition[],
): LayerEffects {
  let resolved = effects;
  for (const binding of layer.bindings) {
    if (
      binding.targetProperty !== 'dropShadowColor' &&
      !parseEffectProperty(binding.targetProperty)
    )
      continue;
    const field = dataFields.find((f) => f.id === binding.fieldId);
    const root = Object.hasOwn(testValues, binding.fieldId)
      ? testValues[binding.fieldId]
      : field?.defaultValue;
    const value = valueAtSourcePath(
      field?.type === 'array' && Array.isArray(root) ? root[0] : root,
      binding.sourcePath,
    );
    if (value !== undefined) {
      const mapped = binding.valueMap?.[String(value)] ?? value;
      resolved =
        binding.targetProperty === 'dropShadowColor'
          ? { ...resolved, dropShadowColor: String(mapped) }
          : withEffectParameter(resolved, binding.targetProperty, mapped);
    }
  }
  return resolved;
}
