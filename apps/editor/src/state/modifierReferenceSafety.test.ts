import { beforeEach, describe, expect, it } from 'vitest';
import {
  addLayerModifier,
  buildComponentDefinition,
  createFieldDefinition,
  createLayerOfKind,
  instantiateComponentDefinition,
  layerModifiersErrors,
} from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';

function seed(linked = false) {
  const state = useProjectStore.getState(),
    project = structuredClone(state.project);
  const composition = getActiveComposition(project, state.activeCompositionId);
  const title = createLayerOfKind('text'),
    panel = createLayerOfKind('rectangle');
  title.groupId = 'smart';
  panel.groupId = 'smart';
  const field = createFieldDefinition('text', { key: 'headline', defaultValue: 'Name' });
  addLayerModifier(panel, 'auto-size', { source: { kind: 'layer', layerId: title.id } });
  addLayerModifier(panel, 'hide-empty', {
    source: { kind: 'field', fieldId: field.id, sourcePath: [] },
  });
  composition.layers = [title, panel];
  composition.dataFields = [field];
  if (linked) {
    const definition = buildComponentDefinition(composition, [title.id, panel.id], 'Lower Third');
    composition.components = [definition];
    const instance = instantiateComponentDefinition(composition, definition);
    composition.layers = instance.layers;
    composition.dataFields = instance.dataFields;
  }
  useProjectStore.setState({ project });
  return getActiveComposition(useProjectStore.getState().project, state.activeCompositionId);
}
describe('editor modifier reference safety', () => {
  beforeEach(() => useProjectStore.getState().newProject());
  it('duplicates internal sources independently while preserving linked baselines and modifier-only field identity', () => {
    const source = seed(true),
      panel = source.layers.find((layer) => layer.element.type === 'rectangle')!;
    const copies = useProjectStore.getState().duplicateLayers([panel.id]);
    const state = useProjectStore.getState(),
      composition = getActiveComposition(state.project, state.activeCompositionId);
    const cloned = composition.layers.filter((layer) => copies.includes(layer.id));
    const clonedPanel = cloned.find((layer) => layer.element.type === 'rectangle')!,
      clonedText = cloned.find((layer) => layer.element.type === 'text')!;
    expect(clonedPanel.modifiers?.[0]).toMatchObject({
      params: { source: { layerId: clonedText.id } },
    });
    expect(clonedPanel.componentLink?.baseline?.modifiers?.[0]).toMatchObject({
      params: { source: { layerId: clonedText.id } },
    });
    const hide = clonedPanel.modifiers?.find((modifier) => modifier.type === 'hide-empty');
    expect(hide?.params.source).toMatchObject({ kind: 'field' });
    if (hide?.params.source.kind !== 'field') throw new Error('Expected field source.');
    const copiedFieldId = hide.params.source.fieldId;
    expect(copiedFieldId).not.toBe(source.dataFields[0]!.id);
    expect(composition.dataFields.some((field) => field.id === copiedFieldId)).toBe(true);
    expect(layerModifiersErrors(composition.layers, composition.dataFields)).toEqual([]);
  });
  it('prevents deleting a referenced layer or Hide field without changing project data', () => {
    const composition = seed(),
      title = composition.layers.find((layer) => layer.element.type === 'text')!;
    const before = structuredClone(useProjectStore.getState().project);
    expect(() => useProjectStore.getState().removeLayer(title.id)).toThrow(/Retarget/);
    expect(useProjectStore.getState().project).toEqual(before);
    expect(() => useProjectStore.getState().removeDataField(composition.dataFields[0]!.id)).toThrow(
      /Hide on Empty/,
    );
    expect(useProjectStore.getState().project).toEqual(before);
  });
  it('preserves referenced complete group rename and rejects ungrouping or external clipboard gaps', () => {
    const composition = seed(),
      title = composition.layers.find((layer) => layer.element.type === 'text')!;
    const project = structuredClone(useProjectStore.getState().project),
      draft = getActiveComposition(project, composition.id);
    const panel = draft.layers.find((layer) => layer.element.type === 'rectangle')!;
    const draftTitle = draft.layers.find((layer) => layer.id === title.id)!;
    addLayerModifier(draftTitle, 'hide-empty', {
      source: { kind: 'layer', layerId: title.id, property: 'content' },
      target: { kind: 'group', groupId: 'smart' },
    });
    useProjectStore.setState({ project });
    const groupId = useProjectStore.getState().groupLayers(draft.layers.map((layer) => layer.id));
    const updated = getActiveComposition(useProjectStore.getState().project, composition.id);
    expect(updated.layers.find((layer) => layer.id === title.id)?.modifiers?.[0]).toMatchObject({
      params: { target: { groupId } },
    });
    expect(() => useProjectStore.getState().ungroupLayers([title.id])).toThrow(/Retarget/);
    const external = structuredClone(panel);
    external.modifiers![0]!.params = {
      ...external.modifiers![0]!.params,
      source: { kind: 'layer', layerId: 'missing-source' },
    } as never;
    expect(() => useProjectStore.getState().pasteLayers([external])).toThrow(/missing layer/);
  });
});
