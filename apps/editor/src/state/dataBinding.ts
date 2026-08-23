import {
  resolveElementAssetReferences,
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
  path: [{ value: 'fill', label: 'Fill Color' }],
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
): Element {
  const element = layer.bindings.reduce<Element>((resolved, binding) => {
    const hasTestValue = Object.prototype.hasOwnProperty.call(testValues, binding.fieldId);
    const value = hasTestValue
      ? testValues[binding.fieldId]
      : dataFields.find((field) => field.id === binding.fieldId)?.defaultValue;
    if (value === undefined) return resolved;
    const mapped = binding.valueMap?.[String(value)] ?? value;
    return {
      ...resolved,
      [binding.targetProperty]:
        binding.targetProperty === 'fill' && typeof mapped === 'object' ? mapped : String(mapped),
    } as Element;
  }, layer.element);
  return resolveElementAssetReferences(element, assets);
}
