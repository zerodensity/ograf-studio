import type { ComponentDefinition, Project } from './types';
import { transitionLogicErrors, type TransitionLogicDefinition } from './transitionLogic';

/** Asset-free context keeps the authoring host's pre-commit guard aligned with Studio's set. */
export interface ComponentGraphContext {
  projectId: string;
  templateIds: string[];
  definition: TransitionLogicDefinition | null;
  componentLayers: Record<string, string[]>;
}

export function createComponentGraphContext(
  projectId: string,
  templateIds: readonly string[],
  definition: TransitionLogicDefinition | null | undefined,
  components: readonly ComponentDefinition[],
): ComponentGraphContext {
  return {
    projectId,
    templateIds: [...templateIds],
    definition: definition ? structuredClone(definition) : null,
    componentLayers: Object.fromEntries(
      components.map((component) => [
        component.id,
        component.layers.filter((layer) => !layer.isGuide).map((layer) => layer.id),
      ]),
    ),
  };
}

/** Reject an unsafe parent edit before a session changes its project, revision or undo stack. */
export function assertComponentGraphProjectUpdate(
  previous: Project,
  candidate: Project,
  context: ComponentGraphContext | null,
): void {
  if (
    !context?.definition ||
    previous.id !== context.projectId ||
    candidate.id !== context.projectId
  )
    return;
  const layers = structuredClone(context.componentLayers);
  const relevant = new Set(
    context.definition.sharedInstances.map((instance) => instance.componentAssetId),
  );
  const candidates = new Set(
    candidate.compositions.flatMap((composition) =>
      composition.components
        .filter((component) => component.scope === 'set')
        .map((component) => component.id),
    ),
  );
  let changed = false;
  for (const composition of previous.compositions)
    for (const component of composition.components) {
      if (
        component.scope === 'set' &&
        relevant.has(component.id) &&
        !candidates.has(component.id)
      ) {
        delete layers[component.id];
        changed = true;
      }
    }
  const seen = new Map<string, string>();
  for (const composition of candidate.compositions) {
    const before = previous.compositions.find((entry) => entry.id === composition.id);
    for (const component of composition.components) {
      if (component.scope !== 'set' || !relevant.has(component.id)) continue;
      const old = before?.components.find((entry) => entry.id === component.id);
      const ids = component.layers.filter((layer) => !layer.isGuide).map((layer) => layer.id);
      if (
        JSON.stringify(old?.layers.filter((layer) => !layer.isGuide).map((layer) => layer.id)) ===
        JSON.stringify(ids)
      )
        continue;
      const signature = JSON.stringify(ids);
      if (seen.has(component.id) && seen.get(component.id) !== signature)
        throw new Error(`Component update has conflicting source layers for "${component.name}".`);
      seen.set(component.id, signature);
      layers[component.id] = ids;
      changed = true;
    }
  }
  if (!changed) return;
  const errors = transitionLogicErrors(context.definition, {
    templateIds: context.templateIds,
    componentLayers: layers,
  });
  if (errors.length)
    throw new Error(
      `Component update blocked by playout transitions: ${errors.join(' ')} Retarget or remove these references in Transitions before changing the component.`,
    );
}
