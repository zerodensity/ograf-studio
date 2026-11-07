import {
  applyElementDataValue,
  parseEffectProperty,
  valueAtSourcePath,
  withEffectParameter,
  type Element,
  type LayerEffects,
  type LayerTransform,
  applyLayerTransformBindings,
} from '@ograf-editor/scene-model';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
import { runtimeCollectionItemSelection } from './runtimeCollections';

export function resolveLayerBindingTransform(
  layer: CompiledLayer,
  data: Record<string, unknown>,
  pose: LayerTransform,
): LayerTransform {
  const index = layer.collectionItem
    ? runtimeCollectionItemSelection(layer, data)?.index
    : undefined;
  return applyLayerTransformBindings(
    pose,
    layer.bindings ?? (layer.binding ? [layer.binding] : []),
    (binding) => {
      const root = data[binding.dataKey];
      const itemIndex = layer.collectionItem ? index : binding.itemIndex;
      if (layer.collectionItem && itemIndex === undefined) return undefined;
      const item =
        itemIndex === undefined ? root : Array.isArray(root) ? root[itemIndex] : undefined;
      return valueAtSourcePath(item, binding.sourcePath);
    },
  );
}

/**
 * The element a compiled layer renders with from its data bindings alone — mirrors the editor's
 * design-time `resolveEffectiveElement` (apps/editor/src/state/dataBinding.ts), adapted to the
 * compiled descriptor's shape (data keyed by field `key`, not `fieldId`). Visual rules apply on
 * top of this in `resolveBoundElement`.
 */
export function resolveLayerBindingElement(
  layer: CompiledLayer,
  data: Record<string, unknown>,
): Element {
  const bindings = layer.bindings ?? (layer.binding ? [layer.binding] : []);
  const collectionIndex = layer.collectionItem
    ? runtimeCollectionItemSelection(layer, data)?.index
    : undefined;
  return bindings.reduce<Element>((element, binding) => {
    const root = data[binding.dataKey];
    const itemIndex = layer.collectionItem ? collectionIndex : binding.itemIndex;
    const itemValue =
      itemIndex === undefined ? root : Array.isArray(root) ? root[itemIndex] : undefined;
    const value = valueAtSourcePath(itemValue, binding.sourcePath);
    if (value === undefined) return element;
    const mappedValue = binding.valueMap?.[String(value)] ?? value;
    return applyElementDataValue(element, binding.targetProperty, mappedValue);
  }, layer.element);
}

/** Effect parameters driven by data bindings alone. */
export function resolveLayerBindingEffects(
  layer: CompiledLayer,
  data: Record<string, unknown>,
  effects: LayerEffects = layer.effects,
): LayerEffects {
  let resolved = effects;
  for (const binding of layer.bindings ?? (layer.binding ? [layer.binding] : [])) {
    if (
      binding.targetProperty !== 'dropShadowColor' &&
      !parseEffectProperty(binding.targetProperty)
    )
      continue;
    const root = data[binding.dataKey];
    const item =
      binding.itemIndex === undefined
        ? root
        : Array.isArray(root)
          ? root[binding.itemIndex]
          : undefined;
    const value = valueAtSourcePath(item, binding.sourcePath);
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
