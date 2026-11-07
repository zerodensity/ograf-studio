import {
  createId,
  getLayerTransformAtFrame,
  TRANSITION_LOGIC_SHARED_PROPERTIES,
  TRANSITION_LOGIC_VERSION,
  transitionLogicErrors,
  compositionPlayoutActionErrors,
  type ComponentDefinition,
  type TransitionLogicDefinition,
  type TransitionLogicSharedInstance,
  type TransitionLogicSharedValue,
} from '@ograf-editor/scene-model';
import { componentLibraryFromTemplates } from './componentSetLibrary';
import {
  createProjectSet,
  DEFAULT_PROJECT_SET_NAME,
  saveProjectSetTemplateEdits,
  validateProjectSetDocument,
  type ProjectSetDocument,
} from './projectSet';
import { applyProjectSetChange } from './projectSetSession';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { runDiscreteHistoryStep } from './historyStore';

/** Include the active template's unsaved edits without publishing or taking anything to air. */
export function transitionLogicEditorSetSnapshot(
  set: ProjectSetDocument,
  project = useProjectStore.getState().project,
): ProjectSetDocument {
  const session = useProjectSetStore.getState();
  const active = set.templates.find((template) => template.id === session.activeTemplateId);
  return session.projectSet?.id === set.id && active?.project.id === project.id
    ? saveProjectSetTemplateEdits(set, active.id, project)
    : set;
}

export function createDefaultTransitionLogic(set: ProjectSetDocument): TransitionLogicDefinition {
  const slotId = createId('slot');
  const transitionId = createId('transition');
  const outId = createId('transition');
  return {
    version: TRANSITION_LOGIC_VERSION,
    id: createId('transition-logic'),
    name: `${set.name} transitions`,
    defaultTransitionId: transitionId,
    slots: [{ id: slotId, name: 'Main', order: 0, defaultTransitionId: transitionId }],
    states: set.templates.map((template) => ({
      id: createId('state'),
      name: template.name,
      slotId,
      templateId: template.id,
    })),
    transitions: [
      {
        id: transitionId,
        name: 'Dissolve',
        durationFrames: 24,
        outgoingFrames: 24,
        incomingStartFrame: 0,
        incomingFrames: 24,
        sharedFrames: 24,
        easing: 'ease-in-out',
      },
      {
        id: outId,
        name: 'Take out',
        durationFrames: 24,
        outgoingFrames: 24,
        incomingStartFrame: 0,
        incomingFrames: 0,
        sharedFrames: 24,
        easing: 'ease-in-out',
      },
    ],
    routes: [
      { id: createId('route'), slotId, from: '*', to: null, transitionId: outId, priority: 0 },
    ],
    sharedInstances: [],
    initialSharedValues: [],
  };
}

export function transitionLogicEditorComponents(
  set: ProjectSetDocument,
  project = useProjectStore.getState().project,
): ComponentDefinition[] {
  const components = new Map(
    componentLibraryFromTemplates(set).map((source) => [source.id, source]),
  );
  if (useProjectSetStore.getState().projectSet?.id === set.id) {
    for (const composition of project.compositions)
      for (const source of composition.components)
        if (source.scope === 'set') components.set(source.id, source);
  }
  return [...components.values()];
}

export function transitionLogicEditorErrors(
  set: ProjectSetDocument,
  definition: TransitionLogicDefinition,
  components = transitionLogicEditorComponents(set),
): string[] {
  const errors = transitionLogicErrors(definition, {
    templateIds: set.templates.map((template) => template.id),
    componentLayers: Object.fromEntries(
      components.map((component) => [component.id, component.layers.map((layer) => layer.id)]),
    ),
  });
  if (!set.templates.length)
    errors.unshift('Add a template to this set before applying playout transitions.');
  for (const template of set.templates)
    for (const composition of template.project.compositions)
      errors.push(...compositionPlayoutActionErrors(composition, definition));
  return errors;
}

/** A shared component starts from its source pose. Slot-owned instances begin hidden in Off. */
export function sharedComponentInitialValues(
  set: ProjectSetDocument,
  instance: TransitionLogicSharedInstance,
): TransitionLogicSharedValue[] {
  const source = transitionLogicEditorComponents(set).find(
    (component) => component.id === instance.componentAssetId,
  );
  if (!source) return [];
  return source.layers.flatMap((layer) => {
    const pose = getLayerTransformAtFrame(layer, 0);
    return TRANSITION_LOGIC_SHARED_PROPERTIES.map((property) => ({
      instanceId: instance.id,
      sourceLayerId: layer.id,
      property,
      value: property === 'opacity' && instance.slotId ? 0 : pose[property],
    }));
  });
}

/** Store a validated draft as one undoable set edit, preserving the current template. */
export function applyTransitionLogicDefinition(
  definition: TransitionLogicDefinition | null,
  expected?: { setId: string; baseline: string },
): void {
  const current = useProjectSetStore.getState().projectSet;
  if (!current)
    throw new Error('Create or open a template set before editing playout transitions.');
  if (
    expected &&
    (current.id !== expected.setId ||
      JSON.stringify(current.transitionLogic ?? null) !== expected.baseline)
  )
    throw new Error(
      'The applied playout transitions changed. Revert to load the current definition before applying this draft.',
    );
  const updated = structuredClone(transitionLogicEditorSetSnapshot(current));
  if (definition === null) delete updated.transitionLogic;
  else updated.transitionLogic = structuredClone(definition);
  validateProjectSetDocument(updated);
  applyProjectSetChange(updated, false, definition ? 'Edit Transitions' : 'Remove Transitions');
}

/** Wrap the current source in a set; existing layers, bindings, assets and history are retained. */
export function createTransitionLogicTemplateSet(): void {
  if (useProjectSetStore.getState().projectSet) return;
  runDiscreteHistoryStep(() => {
    const project = useProjectStore.getState().project;
    const created = createProjectSet(DEFAULT_PROJECT_SET_NAME, project);
    const components = componentLibraryFromTemplates(created);
    if (components.length) created.componentAssets = components;
    const session = useProjectSetStore.getState();
    session.setProjectSet(created);
    session.setActiveTemplateId(created.templates[0]!.id);
  }, 'Create Template Set');
}
