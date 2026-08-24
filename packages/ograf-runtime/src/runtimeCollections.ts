import type {
  CompiledGraphicDescriptor,
  CompiledLayer,
  CompiledRuntimeCollection,
} from '@ograf-editor/ograf-types';

function instanceId(collectionId: string, index: number, prototypeLayerId: string): string {
  return `${collectionId}::${index}::${prototypeLayerId}`;
}

function offsetLayer(
  collection: CompiledRuntimeCollection,
  prototype: CompiledLayer,
  index: number,
  idByPrototypeId: Map<string, string>,
): CompiledLayer {
  const offsetX = collection.offsetPerItem.x * index;
  const offsetY = collection.offsetPerItem.y * index;
  const layer = structuredClone(prototype);
  layer.id = idByPrototypeId.get(prototype.id)!;
  layer.keyframes = layer.keyframes.map((keyframe) => ({
    ...keyframe,
    transform: {
      ...keyframe.transform,
      x: keyframe.transform.x + offsetX,
      y: keyframe.transform.y + offsetY,
    },
  }));
  for (const [property, offset] of [
    ['x', offsetX],
    ['y', offsetY],
  ] as const) {
    const keys = layer.animationTracks[property];
    if (keys)
      layer.animationTracks[property] = keys.map((key) => ({ ...key, value: key.value + offset }));
    const loopKeys = layer.loop?.tracks[property];
    if (loopKeys && layer.loop) {
      layer.loop.tracks[property] = loopKeys.map((key) => ({ ...key, value: key.value + offset }));
    }
  }
  layer.clipParentId = prototype.clipParentId
    ? (idByPrototypeId.get(prototype.clipParentId) ?? null)
    : null;
  layer.bindings = layer.bindings.map((binding) => ({ ...binding, itemIndex: index }));
  layer.collectionItem = { collectionId: collection.id, dataKey: collection.dataKey, index };
  return layer;
}

function expandCollection(collection: CompiledRuntimeCollection): CompiledLayer[] {
  const result: CompiledLayer[] = [];
  for (let index = 0; index < collection.capacity; index++) {
    const idByPrototypeId = new Map(
      collection.prototypeLayers.map((layer) => [
        layer.id,
        instanceId(collection.id, index, layer.id),
      ]),
    );
    for (const prototype of collection.prototypeLayers) {
      result.push(offsetLayer(collection, prototype, index, idByPrototypeId));
    }
  }
  return result;
}

/** Pure bounded expansion shared by the packaged runtime and browser-authoritative capture. */
export function expandRuntimeCollections(
  descriptor: CompiledGraphicDescriptor,
): CompiledGraphicDescriptor {
  const collections = descriptor.collections ?? [];
  if (collections.length === 0) return descriptor;
  const layerById = new Map(descriptor.layers.map((layer) => [layer.id, layer]));
  const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
  const layers: CompiledLayer[] = [];
  const paintOrder = descriptor.paintOrder ?? [
    ...descriptor.layers.map((layer) => ({ type: 'layer' as const, id: layer.id })),
    ...collections.map((collection) => ({ type: 'collection' as const, id: collection.id })),
  ];
  for (const entry of paintOrder) {
    if (entry.type === 'layer') {
      const layer = layerById.get(entry.id);
      if (layer) layers.push(layer);
    } else {
      const collection = collectionById.get(entry.id);
      if (collection) layers.push(...expandCollection(collection));
    }
  }
  return { ...descriptor, layers };
}

export function isRuntimeCollectionLayerActive(
  layer: CompiledLayer,
  data: Record<string, unknown>,
): boolean {
  const item = layer.collectionItem;
  if (!item) return true;
  const value = data[item.dataKey];
  return Array.isArray(value) && item.index < value.length;
}
