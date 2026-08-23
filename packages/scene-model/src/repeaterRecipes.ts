import { buildComponentDefinition, instantiateComponentDefinition } from './components';
import { computeKeyframeFrames } from './keyframeTiming';
import { getLayerTransformAtFrame } from './layerAnimation';
import { createId } from './id';
import type { Composition, FieldValue } from './types';

export interface RepeaterRecipeItem {
  label?: string;
  data?: Record<string, FieldValue>;
}

export interface RepeaterRecipeOptions {
  name?: string;
  layerIds: string[];
  items: RepeaterRecipeItem[];
  direction?: 'horizontal' | 'vertical';
  gap?: number;
}

export interface MaterializedRepeaterItem {
  index: number;
  label: string;
  groupId: string;
  layers: Record<string, string>;
  fields: Record<string, string>;
}

export interface MaterializedRepeater {
  recipe: 'repeater';
  name: string;
  direction: 'horizontal' | 'vertical';
  gap: number;
  items: MaterializedRepeaterItem[];
}

function applyItemData(
  composition: Composition,
  sourceFieldIds: Record<string, string>,
  fieldIds: Record<string, string>,
  data: Record<string, FieldValue> | undefined,
): void {
  if (!data) return;
  for (const [key, value] of Object.entries(data)) {
    const sourceFieldId = sourceFieldIds[key];
    if (!sourceFieldId) {
      throw new Error(`Repeater data key is not bound by the source layers: ${key}`);
    }
    const fieldId = fieldIds[sourceFieldId];
    const field = composition.dataFields.find((candidate) => candidate.id === fieldId);
    if (!field) throw new Error(`Repeater field mapping is missing for key: ${key}`);
    field.defaultValue = structuredClone(value);
  }
}

/** Materializes a data-driven row/column into ordinary grouped layers and independent fields. */
export function materializeRepeater(
  composition: Composition,
  options: RepeaterRecipeOptions,
): MaterializedRepeater {
  const layerIds = [...new Set(options.layerIds)];
  if (layerIds.length === 0) throw new Error('A repeater requires at least one source layer.');
  if (layerIds.length !== options.layerIds.length) {
    throw new Error('Repeater source layer IDs cannot repeat.');
  }
  if (options.items.length < 2) throw new Error('A repeater requires at least two data items.');
  const name = options.name?.trim() || 'Repeater';
  const direction = options.direction ?? 'horizontal';
  const gap = Math.max(0, Number(options.gap ?? 24));
  const definition = buildComponentDefinition(
    composition,
    layerIds,
    name,
    createId('repeater-snapshot'),
  );
  const sourceLayers = composition.layers.filter((layer) => layerIds.includes(layer.id));
  const frameById = new Map(
    computeKeyframeFrames(composition).map((item) => [item.keyframeId, item.frame]),
  );
  const stepId = composition.keyframes.find((keyframe) => keyframe.role === 'step')?.id;
  const frame = stepId ? (frameById.get(stepId) ?? 0) : 0;
  const poses = sourceLayers.map((layer) => getLayerTransformAtFrame(layer, frame));
  const left = Math.min(...poses.map((pose) => pose.x));
  const top = Math.min(...poses.map((pose) => pose.y));
  const right = Math.max(...poses.map((pose) => pose.x + pose.width));
  const bottom = Math.max(...poses.map((pose) => pose.y + pose.height));
  const stride = (direction === 'horizontal' ? right - left : bottom - top) + gap;
  const sourceFieldIds = Object.fromEntries(
    definition.dataFields.map((field) => [field.key, field.id]),
  );
  const identityFields = Object.fromEntries(
    definition.dataFields.map((field) => [field.id, field.id]),
  );
  const sourceGroupId = createId('group');
  for (const layer of sourceLayers) {
    layer.groupId = sourceGroupId;
    layer.semantics.tags = [
      ...new Set([...layer.semantics.tags, 'repeater-item', 'repeater-index-1']),
    ];
  }
  const sourceLayerMap = Object.fromEntries(sourceLayers.map((layer) => [layer.id, layer.id]));
  const resultItems: MaterializedRepeaterItem[] = [
    {
      index: 0,
      label: options.items[0]?.label?.trim() || 'Item 1',
      groupId: sourceGroupId,
      layers: sourceLayerMap,
      fields: identityFields,
    },
  ];
  applyItemData(composition, sourceFieldIds, identityFields, options.items[0]?.data);

  for (let index = 1; index < options.items.length; index++) {
    const item = options.items[index]!;
    const instance = instantiateComponentDefinition(
      composition,
      definition,
      {
        x: direction === 'horizontal' ? stride * index : 0,
        y: direction === 'vertical' ? stride * index : 0,
      },
      false,
    );
    const label = item.label?.trim() || `Item ${index + 1}`;
    for (const layer of instance.layers) {
      const sourceLayerId = Object.entries(instance.layerIds).find(
        ([, generatedId]) => generatedId === layer.id,
      )?.[0];
      const sourceName =
        definition.layers.find((candidate) => candidate.id === sourceLayerId)?.name ?? layer.name;
      layer.name = `${label} — ${sourceName}`;
      layer.semantics.tags = [
        ...new Set([...layer.semantics.tags, 'repeater-item', `repeater-index-${index + 1}`]),
      ];
    }
    composition.dataFields.push(...instance.dataFields);
    composition.layers.push(...instance.layers);
    applyItemData(composition, sourceFieldIds, instance.fieldIds, item.data);
    resultItems.push({
      index,
      label,
      groupId: instance.groupId,
      layers: instance.layerIds,
      fields: instance.fieldIds,
    });
  }

  return { recipe: 'repeater', name, direction, gap, items: resultItems };
}
