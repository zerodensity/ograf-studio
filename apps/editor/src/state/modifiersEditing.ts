import {
  addLayerModifier,
  createFieldDefinition,
  createLayerModifier,
  duplicateLayerModifier,
  getLayerPropertyValueAtFrame,
  getTotalFrames,
  layerModifiersErrors,
  modifierParameterSpec,
  modifierProperty,
  numericModifierProperties,
  reconcileProjectComponentInstances,
  removeLayerModifier,
  reorderLayerModifiers,
  syncDesignerBindingDefaults,
  updateLayerModifier,
  type AnimatableLayerProperty,
  type Composition,
  type Layer,
  type LayerModifier,
  type LayerModifierPatch,
  type LayerModifierType,
  type ModifierParamsByType,
} from '@ograf-editor/scene-model';
import { getActiveComposition, keyPropertyEdit, useProjectStore } from './projectStore';
import { canvasFrame } from './canvasViewStore';
import { runDiscreteHistoryStep } from './historyStore';
import { useTimelineStore } from './timelineStore';
import { useTestDataStore } from './testDataStore';

/** Validate the complete dependency graph before publishing a single undoable source edit. */
function editModifier<T>(
  layerId: string,
  label: string,
  edit: (layer: Layer, composition: Composition) => T,
): T {
  const state = useProjectStore.getState();
  const project = structuredClone(state.project);
  const composition = getActiveComposition(project, state.activeCompositionId);
  const layer = composition.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error('The selected object is no longer in this composition.');
  if (layer.isLocked) throw new Error('Unlock this object before editing its modifiers.');
  const result = edit(layer, composition);
  reconcileProjectComponentInstances(project, state.project);
  const errors = project.compositions.flatMap((item) =>
    layerModifiersErrors(item.layers, item.dataFields),
  );
  if (errors.length) throw new Error(errors.join('\n'));
  runDiscreteHistoryStep(() => useProjectStore.setState({ project }), label);
  return result;
}

export function addModifier<Type extends LayerModifierType>(
  layerId: string,
  type: Type,
  params: Partial<ModifierParamsByType[Type]>,
): string {
  return editModifier(layerId, 'Add modifier', (layer) => addLayerModifier(layer, type, params).id);
}

export function editLayerModifier(layerId: string, id: string, patch: LayerModifierPatch): void {
  editModifier(layerId, 'Edit modifier', (layer) => updateLayerModifier(layer, id, patch));
}

export function deleteModifier(layerId: string, id: string): void {
  editModifier(layerId, 'Remove modifier', (layer) => removeLayerModifier(layer, id));
}

export function copyModifier(layerId: string, id: string): string {
  return editModifier(
    layerId,
    'Duplicate modifier',
    (layer) => duplicateLayerModifier(layer, id).id,
  );
}

export function moveModifier(layerId: string, id: string, direction: -1 | 1): void {
  editModifier(layerId, 'Reorder modifiers', (layer) => {
    const ids = (layer.modifiers ?? []).map((modifier) => modifier.id);
    const from = ids.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    reorderLayerModifiers(layer, ids);
  });
}

/** Reset settings without discarding the stable entry ID or its selected references. */
export function resetModifier(layerId: string, id: string): void {
  let resets: ReturnType<typeof syncDesignerBindingDefaults> = [];
  editModifier(layerId, 'Reset modifier', (layer, composition) => {
    const before = structuredClone(layer);
    const modifier = layer.modifiers?.find((entry) => entry.id === id);
    if (!modifier) throw new Error('This modifier no longer exists.');
    const references = 'source' in modifier.params ? { source: modifier.params.source } : {};
    const reset = createLayerModifier(modifier.type, references as never, {
      id: modifier.id,
      name: modifier.name,
      enabled: modifier.enabled,
    });
    if (modifier.type === 'hide-empty' && reset.type === 'hide-empty' && modifier.params.target)
      reset.params.target = structuredClone(modifier.params.target);
    layer.modifiers = layer.modifiers!.map((entry) => (entry.id === id ? reset : entry));
    const prefix = `modifiers.${id}.`;
    for (const property of Object.keys(layer.animationTracks))
      if (property.startsWith(prefix))
        delete layer.animationTracks[property as AnimatableLayerProperty];
    if (layer.loop)
      for (const property of Object.keys(layer.loop.tracks))
        if (property.startsWith(prefix))
          delete layer.loop.tracks[property as AnimatableLayerProperty];
    resets = syncDesignerBindingDefaults(
      composition,
      layer,
      before,
      numericModifierProperties({ modifiers: [reset] }),
      useTestDataStore.getState().values,
    );
  });
  useTestDataStore.getState().clearOverrides(resets);
}

/** Numeric edits follow the same playhead versus whole-animation scope as Properties. */
export function setModifierNumber(
  layerId: string,
  id: string,
  parameter: string,
  value: number,
): void {
  let resets: ReturnType<typeof syncDesignerBindingDefaults> = [];
  editModifier(layerId, 'Edit modifier value', (layer, composition) => {
    const modifier = layer.modifiers?.find((entry) => entry.id === id);
    if (!modifier) throw new Error('This modifier no longer exists.');
    const property = modifierProperty(modifier, parameter);
    const spec = modifierParameterSpec(layer, property);
    if (!spec || !Number.isFinite(value) || value < spec.min || value > spec.max)
      throw new Error(`Enter a value between ${spec?.min ?? 0} and ${spec?.max ?? 0}.`);
    const before = structuredClone(layer);
    const timeline = useTimelineStore.getState();
    const frame = Math.max(
      0,
      Math.min(
        getTotalFrames(composition),
        Math.round(canvasFrame(composition, timeline.currentFrame)),
      ),
    );
    const previous = getLayerPropertyValueAtFrame(layer, property, frame);
    updateLayerModifier(layer, id, { params: { [parameter]: value } });
    if (!keyPropertyEdit(layer, property, frame, value, previous)) {
      const delta = value - previous;
      for (const keys of [layer.animationTracks[property], layer.loop?.tracks[property]])
        for (const key of keys ?? [])
          key.value = Math.min(spec.max, Math.max(spec.min, key.value + delta));
    }
    resets = syncDesignerBindingDefaults(
      composition,
      layer,
      before,
      [property],
      useTestDataStore.getState().values,
    );
  });
  useTestDataStore.getState().clearOverrides(resets);
}

/** Bind the requested control directly; no prerequisite trip to the Data pane is necessary. */
export function exposeModifierNumber(layerId: string, id: string, parameter: string): string {
  const state = useProjectStore.getState();
  const composition = getActiveComposition(state.project, state.activeCompositionId);
  const existing = composition.layers
    .find((layer) => layer.id === layerId)
    ?.bindings.find((binding) => binding.targetProperty === modifierProperty(id, parameter));
  if (existing) return existing.fieldId;
  return editModifier(layerId, 'Create data control', (layer, composition) => {
    const modifier = layer.modifiers?.find((entry) => entry.id === id);
    if (!modifier) throw new Error('This modifier no longer exists.');
    const property = modifierProperty(modifier, parameter);
    const existing = layer.bindings.find((binding) => binding.targetProperty === property);
    if (existing) return existing.fieldId;
    const spec = modifierParameterSpec(layer, property);
    if (!spec) throw new Error('Only numeric modifier controls can be exposed.');
    const stem = `${layer.name}_${modifier.name}_${parameter}`
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60)
      .toLowerCase();
    const base = /^[a-zA-Z_]/.test(stem) ? stem : `modifier_${stem}`;
    let key = base;
    let suffix = 2;
    while (composition.dataFields.some((field) => field.key === key)) key = `${base}_${suffix++}`;
    const field = createFieldDefinition('number', {
      key,
      label: `${layer.name}: ${modifier.name} · ${spec.label}`,
      defaultValue: getLayerPropertyValueAtFrame(
        layer,
        property,
        useTimelineStore.getState().currentFrame,
      ),
      constraints: { minimum: spec.min, maximum: spec.max },
    });
    composition.dataFields.push(field);
    layer.bindings.push({ fieldId: field.id, targetProperty: property });
    return field.id;
  });
}

export function modifierDrivenProperties(modifiers: readonly LayerModifier[]): string[] {
  const driven = new Set<string>();
  for (const modifier of modifiers.filter((entry) => entry.enabled)) {
    if (modifier.type === 'max-text-width') driven.add('text width');
    if (modifier.type === 'auto-size') {
      if (modifier.params.width) driven.add('Width');
      if (modifier.params.height) driven.add('Height');
    }
    if (modifier.type === 'auto-follow') {
      if (modifier.params.axisX) driven.add('X');
      if (modifier.params.axisY) driven.add('Y');
    }
    if (modifier.type === 'hide-empty') driven.add('visibility');
    if (modifier.type === 'grid-arrange' || modifier.type === 'radial-arrange')
      driven.add('child positions');
    if (modifier.type === 'radial-arrange' && modifier.params.orient) driven.add('child rotation');
    if (modifier.type === 'justify') driven.add('child positions');
    if (modifier.type === 'look-at') driven.add('Rotation');
  }
  return [...driven];
}
