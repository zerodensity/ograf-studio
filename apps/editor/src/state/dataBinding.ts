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
};

/**
 * The element a layer should render with, given live test data — the authored `element` is left
 * untouched; a bound property is overridden only for display when a test value is present.
 * Fill bindings may carry a complete gradient object; other bindable properties stringify.
 */
export function resolveEffectiveElement(
  layer: Layer,
  testValues: Record<string, TestValue>,
  assets: Asset[] = [],
  dataFields: FieldDefinition[] = [],
): Element {
  if (!layer.binding) return resolveElementAssetReferences(layer.element, assets);
  const hasTestValue = Object.prototype.hasOwnProperty.call(testValues, layer.binding.fieldId);
  const value = hasTestValue
    ? testValues[layer.binding.fieldId]
    : dataFields.find((field) => field.id === layer.binding?.fieldId)?.defaultValue;
  const element =
    value === undefined
      ? layer.element
      : ({
          ...layer.element,
          [layer.binding.targetProperty]:
            layer.binding.targetProperty === 'fill' && typeof value === 'object'
              ? value
              : String(value),
        } as Element);
  return resolveElementAssetReferences(element, assets);
}
