import type {
  Project,
  TransitionLogicDefinition,
  TransitionLogicReferences,
} from '@ograf-editor/scene-model';
import { runDiscreteHistoryStep } from './historyStore';
import { validateProjectSetDocument, type ProjectSetDocument } from './projectSet';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { setElementValue } from './transitionChoreography';
import { transitionLogicEditorErrors } from './transitionLogicEditing';
import { useTransitionLogicDraftStore } from './transitionLogicDraftStore';
import { sharedValueFor, type LandingBox } from './transitionsDesign';

export interface LandingMove {
  set: ProjectSetDocument;
  /** The moved template's project, also to load when it is the template being edited. */
  project: Project;
  templateId: string;
}

/**
 * Move a shared element where one template places it: its linked layers (the placement under the
 * element's own instance ID, else the template's first placement of the component) shift by
 * (dx, dy) on every position key, so the template's own animation is kept. The playout values for
 * that template follow the new layout, so nothing reads as drift and no override is stored.
 */
export function moveElementInTemplate(
  snapshot: ProjectSetDocument,
  definition: TransitionLogicDefinition,
  box: LandingBox,
  stateId: string,
  delta: { dx: number; dy: number },
  references: TransitionLogicReferences,
): LandingMove {
  const state = definition.states.find((entry) => entry.id === stateId);
  const instance = definition.sharedInstances.find((entry) => entry.id === box.instanceId);
  if (!state || !instance) throw new Error('This element or template was removed.');
  const template = snapshot.templates.find((entry) => entry.id === state.templateId);
  if (!template) throw new Error('This template was removed from the set.');
  const project = structuredClone(template.project);
  const composition =
    project.compositions.find((entry) => entry.id === project.mainCompositionId) ??
    project.compositions[0];
  if (!composition) throw new Error('The template has no composition.');
  const links = composition.layers.flatMap((layer) =>
    layer.componentLink?.componentId === instance.componentAssetId ? [layer.componentLink] : [],
  );
  const placement = links.some((link) => link.instanceId === instance.id)
    ? instance.id
    : links[0]?.instanceId;
  const layers = composition.layers.filter(
    (layer) =>
      layer.componentLink?.componentId === instance.componentAssetId &&
      layer.componentLink.instanceId === placement &&
      layer.componentLink.sourceLayerId === box.sourceLayerId,
  );
  if (!layers.length)
    throw new Error(
      `${state.name} doesn’t place ${instance.name}. Add it to that template to position it.`,
    );
  const dx = Math.round(delta.dx * 100) / 100;
  const dy = Math.round(delta.dy * 100) / 100;
  for (const layer of layers) {
    // Positions live in the per-property tracks; the keyframe poses mirror them.
    const tracks = layer.animationTracks as Record<string, Array<{ value: unknown }> | undefined>;
    for (const [property, change] of [
      ['x', dx],
      ['y', dy],
    ] as const)
      tracks[property] = tracks[property]?.map((key) =>
        typeof key.value === 'number' ? { ...key, value: key.value + change } : key,
      );
    for (const keyframe of layer.keyframes)
      keyframe.transform = {
        ...keyframe.transform,
        x: keyframe.transform.x + dx,
        y: keyframe.transform.y + dy,
      };
  }
  let next = definition;
  for (const [property, change] of [
    ['x', dx],
    ['y', dy],
  ] as const) {
    if (!change) continue;
    const identity = { instanceId: box.instanceId, sourceLayerId: box.sourceLayerId, property };
    next = setElementValue(
      next,
      identity,
      stateId,
      box[property] + change,
      sharedValueFor(next, null, identity) ?? box[property],
      references,
    );
  }
  const set: ProjectSetDocument = {
    ...snapshot,
    templates: snapshot.templates.map((entry) =>
      entry.id === template.id ? { ...entry, project } : entry,
    ),
    transitionLogic: next,
  };
  return { set, project, templateId: template.id };
}

/** Store a landing move as one undoable step, including the template being edited. */
export function applyLandingMove(move: LandingMove): void {
  validateProjectSetDocument(move.set);
  const errors = transitionLogicEditorErrors(move.set, move.set.transitionLogic!);
  if (errors.length) throw new Error(errors.join(' '));
  runDiscreteHistoryStep(() => {
    const session = useProjectSetStore.getState();
    if (session.activeTemplateId === move.templateId) {
      const { activeCompositionId } = useProjectStore.getState();
      useProjectStore.setState({ project: move.project });
      if (move.project.compositions.some((entry) => entry.id === activeCompositionId))
        useProjectStore.getState().setActiveComposition(activeCompositionId);
    }
    session.setProjectSet(move.set);
    useTransitionLogicDraftStore.getState().reset(move.set.id, move.set.transitionLogic);
  }, 'Move element in template');
}
