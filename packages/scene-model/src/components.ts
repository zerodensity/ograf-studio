import { createId } from './id';
import { assertMaskSourcesRemovable } from './masking';
import {
  getLayerTransformAtFrame,
  sortLayerKeyframes,
  sortLayerPropertyKeyframes,
} from './layerAnimation';
import type { ComponentDefinition, Composition, FieldDefinition, Layer } from './types';

const clone = <T>(value: T): T => structuredClone(value);

function uniqueFieldKey(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  const key = `${base}_${suffix}`;
  used.add(key);
  return key;
}

export interface ComponentInstantiation {
  instanceId: string;
  groupId: string;
  layers: Layer[];
  dataFields: FieldDefinition[];
  layerIds: Record<string, string>;
  fieldIds: Record<string, string>;
}

export function buildComponentDefinition(
  composition: Composition,
  layerIds: string[],
  name: string,
  id = createId('component'),
): ComponentDefinition {
  const wanted = new Set(layerIds);
  if (wanted.size === 0) throw new Error('A reusable component requires at least one layer.');
  if (wanted.size !== layerIds.length) throw new Error('Component layer IDs cannot repeat.');
  const layers = composition.layers.filter((layer) => wanted.has(layer.id));
  for (const layer of layers) {
    if (layer.mask && !wanted.has(layer.mask.sourceLayerId))
      throw new Error(`Include the mask source when saving component layer "${layer.name}".`);
  }
  const missing = layerIds.filter((layerId) => !layers.some((layer) => layer.id === layerId));
  if (missing.length > 0) throw new Error(`Component layers not found: ${missing.join(', ')}`);
  const fieldIds = new Set(layers.flatMap((layer) => layer.bindings.map((item) => item.fieldId)));
  const dataFields = composition.dataFields.filter((field) => fieldIds.has(field.id)).map(clone);
  if (dataFields.length !== fieldIds.size) {
    throw new Error('Component selection contains a binding to an unknown data field.');
  }
  return {
    id,
    name: name.trim() || `Component ${composition.components.length + 1}`,
    layers: layers.map((source) => {
      const layer = clone(source);
      if (layer.parentId && !wanted.has(layer.parentId)) layer.parentId = null;
      layer.componentLink = null;
      return layer;
    }),
    dataFields,
  };
}

export function instantiateComponentDefinition(
  composition: Composition,
  definition: ComponentDefinition,
  offset: { x: number; y: number } = { x: 40, y: 40 },
  linked = false,
): ComponentInstantiation {
  if (definition.layers.length === 0) throw new Error('Component contains no layers.');
  const layerIds = Object.fromEntries(
    definition.layers.map((layer) => [layer.id, createId('layer')]),
  );
  const fieldIds = Object.fromEntries(
    definition.dataFields.map((field) => [field.id, createId('field')]),
  );
  const usedFieldKeys = new Set(composition.dataFields.map((field) => field.key));
  const dataFields = definition.dataFields.map((source) => ({
    ...clone(source),
    id: fieldIds[source.id]!,
    key: uniqueFieldKey(source.key, usedFieldKeys),
  }));
  const groupId = createId('group');
  const instanceId = createId('component-instance');
  const sourceIds = new Set(definition.layers.map((layer) => layer.id));
  const layers = definition.layers.map((source) => {
    const layer = clone(source);
    layer.id = layerIds[source.id]!;
    layer.name = `${definition.name} — ${source.name}`;
    layer.groupId = groupId;
    layer.componentLink = linked
      ? { componentId: definition.id, instanceId, sourceLayerId: source.id }
      : null;
    layer.parentId =
      source.parentId && sourceIds.has(source.parentId) ? layerIds[source.parentId]! : null;
    layer.mask = source.mask
      ? {
          ...source.mask,
          sourceLayerId: layerIds[source.mask.sourceLayerId] ?? source.mask.sourceLayerId,
        }
      : null;
    layer.keyframes = sortLayerKeyframes(
      layer.keyframes.map((key) => ({
        ...key,
        id: createId('layer-key'),
        transform: {
          ...key.transform,
          x: key.transform.x + offset.x,
          y: key.transform.y + offset.y,
        },
      })),
    );
    layer.animationTracks = Object.fromEntries(
      Object.entries(layer.animationTracks).map(([property, keys]) => [
        property,
        sortLayerPropertyKeyframes(
          (keys ?? []).map((key) => ({
            ...key,
            id: createId('property-key'),
            value:
              property === 'x'
                ? key.value + offset.x
                : property === 'y'
                  ? key.value + offset.y
                  : key.value,
            ...(key.curve ? { curve: { ...key.curve } } : {}),
          })),
        ),
      ]),
    );
    if (layer.loop) {
      layer.loop.id = createId('layer-loop');
      layer.loop.tracks = Object.fromEntries(
        Object.entries(layer.loop.tracks).map(([property, keys]) => [
          property,
          (keys ?? []).map((key) => ({
            ...key,
            id: createId('loop-property-key'),
            value:
              property === 'x'
                ? key.value + offset.x
                : property === 'y'
                  ? key.value + offset.y
                  : key.value,
            ...(key.curve ? { curve: { ...key.curve } } : {}),
          })),
        ]),
      );
    }
    layer.bindings = layer.bindings.map((binding) => ({
      ...binding,
      fieldId: fieldIds[binding.fieldId]!,
      ...(binding.valueMap ? { valueMap: { ...binding.valueMap } } : {}),
    }));
    return layer;
  });
  return { instanceId, groupId, layers, dataFields, layerIds, fieldIds };
}

export interface RefreshedComponentInstance {
  instanceId: string;
  removedLayerIds: string[];
  removedFieldIds: string[];
  instance: ComponentInstantiation;
}

/** Re-materializes explicitly linked instances while retaining each instance's authored offset. */
export function refreshComponentInstances(
  composition: Composition,
  definition: ComponentDefinition,
  requestedInstanceIds?: string[],
): RefreshedComponentInstance[] {
  const availableInstanceIds = [
    ...new Set(
      composition.layers
        .filter((layer) => layer.componentLink?.componentId === definition.id)
        .map((layer) => layer.componentLink!.instanceId),
    ),
  ];
  const instanceIds = requestedInstanceIds ?? availableInstanceIds;
  const unknown = instanceIds.filter((instanceId) => !availableInstanceIds.includes(instanceId));
  if (unknown.length > 0) {
    throw new Error(`Linked component instances not found: ${unknown.join(', ')}`);
  }

  return instanceIds.flatMap((instanceId) => {
    const oldLayers = composition.layers.filter(
      (layer) => layer.componentLink?.instanceId === instanceId,
    );
    if (oldLayers.length === 0) return [];
    const oldIds = new Set(oldLayers.map((layer) => layer.id));
    const insertionIndex = Math.min(
      ...oldLayers.map((layer) =>
        composition.layers.findIndex((candidate) => candidate.id === layer.id),
      ),
    );
    const reference = oldLayers.find((layer) =>
      definition.layers.some((source) => source.id === layer.componentLink?.sourceLayerId),
    );
    const source = definition.layers.find(
      (layer) => layer.id === reference?.componentLink?.sourceLayerId,
    );
    const offset =
      reference && source
        ? {
            x: getLayerTransformAtFrame(reference, 0).x - getLayerTransformAtFrame(source, 0).x,
            y: getLayerTransformAtFrame(reference, 0).y - getLayerTransformAtFrame(source, 0).y,
          }
        : { x: 40, y: 40 };
    const oldFieldIds = new Set(
      oldLayers.flatMap((layer) => layer.bindings.map((binding) => binding.fieldId)),
    );
    assertMaskSourcesRemovable(composition, oldIds);
    composition.layers = composition.layers.filter((layer) => !oldIds.has(layer.id));
    const stillUsedFieldIds = new Set(
      composition.layers.flatMap((layer) => layer.bindings.map((binding) => binding.fieldId)),
    );
    const removedFieldIds = [...oldFieldIds].filter((fieldId) => !stillUsedFieldIds.has(fieldId));
    composition.dataFields = composition.dataFields.filter(
      (field) => !removedFieldIds.includes(field.id),
    );

    const instance = instantiateComponentDefinition(composition, definition, offset, true);
    for (const layer of instance.layers) {
      if (layer.componentLink) layer.componentLink.instanceId = instanceId;
    }
    instance.instanceId = instanceId;
    composition.dataFields.push(...instance.dataFields);
    composition.layers.splice(insertionIndex, 0, ...instance.layers);
    return [
      {
        instanceId,
        removedLayerIds: [...oldIds],
        removedFieldIds,
        instance,
      },
    ];
  });
}
