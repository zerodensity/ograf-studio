import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type Layer } from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import { getActiveComposition, useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import {
  addProjectSetTemplate,
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
} from './projectSet';

const composition = () => {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
};
const layer = (id: string) => composition().layers.find((item) => item.id === id)!;
const text = (item: Layer) => {
  if (item.element.type !== 'text') throw new Error('Expected text.');
  return item.element;
};
function createSource() {
  const store = useProjectStore.getState();
  const id = store.addLayer('text');
  const fieldId = store.addDataField('text');
  store.updateDataField(fieldId, { key: 'headline', defaultValue: 'Source headline' });
  store.setLayerBindings(id, [{ fieldId, targetProperty: 'content' }]);
  return { id, fieldId };
}

describe('live component editing in Studio', () => {
  beforeEach(() => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
  });

  it('propagates source edits atomically while preserving instance style, animation and bindings', () => {
    const store = useProjectStore.getState();
    const source = createSource();
    const componentId = store.createComponent([source.id], 'Headline')!;
    expect(layer(source.id).componentLink?.componentId).toBe(componentId);
    const [instanceId] = store.instantiateComponent(componentId);
    const localField = store.addDataField('text');
    store.updateDataField(localField, { key: 'local_headline', defaultValue: 'Local headline' });
    store.setLayerBindings(instanceId!, [{ fieldId: localField, targetProperty: 'content' }]);
    store.updateLayerElement(instanceId!, { fill: '#ff3300' });
    store.updateLayerTransform(instanceId!, 7, { x: 432 });
    const before = structuredClone(layer(instanceId!));
    const sourceElement = text(
      composition().components.find((item) => item.id === componentId)!.layers[0]!,
    );
    let incompletePublications = 0;
    const unsubscribe = useProjectStore.subscribe((state) => {
      const scope = getActiveComposition(state.project, state.activeCompositionId);
      const master = scope.components.find((item) => item.id === componentId)!;
      if (text(master.layers[0]!).fontSize === 81)
        for (const item of scope.layers.filter(
          (candidate) => candidate.componentLink?.componentId === componentId,
        ))
          if (text(item).fontSize !== 81) incompletePublications++;
    });
    store.updateComponentLayer(componentId, source.id, {
      element: { ...sourceElement, fontSize: 81, fill: '#0044aa' },
    });
    unsubscribe();
    const after = layer(instanceId!);
    expect(incompletePublications).toBe(0);
    expect(text(layer(source.id)).fill).toBe('#0044aa');
    expect(text(after)).toMatchObject({ fill: '#ff3300', fontSize: 81 });
    expect(after.animationTracks.x).toEqual(before.animationTracks.x);
    expect(after.bindings).toEqual(before.bindings);
    expect(after.id).toBe(before.id);
    expect(after.componentLink?.instanceId).toBe(before.componentLink?.instanceId);
    expect(composition().dataFields.find((field) => field.id === localField)?.defaultValue).toBe(
      'Local headline',
    );
    expect(validateProject(useProjectStore.getState().project).errors).toEqual([]);
  });

  it('updates inactive templates and retains inheritance and overrides after archive reopening', async () => {
    const store = useProjectStore.getState();
    const source = createSource();
    let set = createProjectSet('News set', useProjectStore.getState().project);
    set = addProjectSetTemplate(set, createProject({ name: 'Second template' }));
    const firstId = set.templates[0]!.id;
    const secondId = set.templates[1]!.id;
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(firstId);
    const componentId = store.createComponent([source.id], 'Shared headline')!;
    set = useProjectSetStore.getState().projectSet!;
    useProjectSetStore.getState().setActiveTemplateId(secondId);
    store.loadProject(resolveProjectSetTemplate(set, secondId));
    const [secondLayerId] = store.instantiateComponent(componentId);
    store.updateLayerElement(secondLayerId!, { fill: '#dd2200' });
    const secondBindings = structuredClone(layer(secondLayerId!).bindings);
    set = saveProjectSetTemplateEdits(
      useProjectSetStore.getState().projectSet!,
      secondId,
      useProjectStore.getState().project,
    );
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(firstId);
    store.loadProject(resolveProjectSetTemplate(set, firstId));
    const master = composition().components.find((item) => item.id === componentId)!;
    store.updateComponentLayer(componentId, source.id, {
      element: { ...text(master.layers[0]!), fontSize: 72, fill: '#00aacc' },
    });
    set = useProjectSetStore.getState().projectSet!;
    const second = resolveProjectSetTemplate(set, secondId);
    const child = second.compositions
      .flatMap((scope) => scope.layers)
      .find((item) => item.id === secondLayerId)!;
    expect(text(child)).toMatchObject({ fill: '#dd2200', fontSize: 72 });
    expect(child.bindings).toEqual(secondBindings);
    const archived = await createProjectSetArchive(set);
    const reopened = await openProjectSetArchive(await archived.arrayBuffer());
    const restored = resolveProjectSetTemplate(reopened, secondId);
    const restoredChild = restored.compositions
      .flatMap((scope) => scope.layers)
      .find((item) => item.id === secondLayerId)!;
    expect(restoredChild.componentLink).toEqual(child.componentLink);
    expect(restoredChild.bindings).toEqual(secondBindings);
    expect(validateProject(restored).errors).toEqual([]);
  });

  it('allows removing an unused shared source after its active instance was deleted', () => {
    const store = useProjectStore.getState();
    const source = createSource();
    const set = createProjectSet('Set', useProjectStore.getState().project);
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(set.templates[0]!.id);
    const componentId = store.createComponent([source.id], 'Shared headline')!;
    store.removeLayer(source.id);
    expect(() => store.removeComponent(componentId)).not.toThrow();
    expect(composition().components.some((item) => item.id === componentId)).toBe(false);
    expect(useProjectSetStore.getState().projectSet?.componentAssets).toEqual([]);
  });

  it('keeps duplicated instances inheriting with their own stable parameter and animation identities', () => {
    const store = useProjectStore.getState();
    const source = createSource();
    const componentId = store.createComponent([source.id], 'Headline')!;
    const [inserted] = store.instantiateComponent(componentId);
    const [copied] = store.duplicateLayers([inserted!]);
    const copyField = layer(copied!).bindings[0]!.fieldId;
    expect(copyField).not.toBe(layer(inserted!).bindings[0]!.fieldId);
    expect(layer(copied!).componentLink?.overridePaths).not.toContain('/bindings');
    expect(layer(copied!).componentLink?.overridePaths).not.toContain('/animationTracks/x');
    store.updateComponentField(componentId, source.fieldId, { defaultValue: 'Updated parent' });
    expect(composition().dataFields.find((field) => field.id === copyField)?.defaultValue).toBe(
      'Updated parent',
    );
    expect(layer(copied!).bindings[0]!.fieldId).toBe(copyField);
    expect(validateProject(useProjectStore.getState().project).errors).toEqual([]);
  });
});
