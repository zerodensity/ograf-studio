import {
  reconcileProjectComponentInstances,
  transitionLogicErrors,
  type ComponentDefinition,
  type Project,
} from '@ograf-editor/scene-model';
import type { ProjectSetDocument } from './projectSet';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const equal = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** Check the prospective library, before either the editor or its set is published. */
export function assertComponentLibraryGraphReferences(
  set: ProjectSetDocument,
  definitions: readonly ComponentDefinition[],
): void {
  if (!set.transitionLogic) return;
  const errors = transitionLogicErrors(set.transitionLogic, {
    templateIds: set.templates.map((template) => template.id),
    componentLayers: Object.fromEntries(
      definitions.map((definition) => [
        definition.id,
        definition.layers.filter((layer) => !layer.isGuide).map((layer) => layer.id),
      ]),
    ),
  });
  if (errors.length)
    throw new Error(
      `Cannot change the shared component because Transitions still references its source. ${errors.join(' ')} Update the shared instance, template state or resize targets in Transitions before removing the referenced source.`,
    );
}

/** Shared component sources are also embedded in child .ogs files for portable extraction. */
export function componentLibraryFromTemplates(set: ProjectSetDocument): ComponentDefinition[] {
  const definitions = new Map<string, ComponentDefinition>();
  for (const definition of set.componentAssets ?? []) definitions.set(definition.id, definition);
  for (const template of set.templates)
    for (const composition of template.project.compositions)
      for (const definition of composition.components)
        if (definition.scope === 'set' && !definitions.has(definition.id))
          definitions.set(definition.id, definition);
  return [...definitions.values()];
}

/** Installs the source library without changing placed instance identities or their overrides. */
export function applySetComponentLibrary(
  project: Project,
  definitions: ComponentDefinition[],
  removedIds: ReadonlySet<string> = new Set(),
): Project {
  if (!definitions.length && !removedIds.size) return project;
  const needsUpdate = project.compositions.some(
    (composition) =>
      composition.components.some((definition) => removedIds.has(definition.id)) ||
      definitions.some(
        (definition) =>
          !equal(
            composition.components.find((candidate) => candidate.id === definition.id),
            definition,
          ) ||
          (definition.resources ?? []).some(
            (resource) => !composition.assets.some((asset) => asset.id === resource.id),
          ) ||
          (definition.patterns ?? []).some(
            (pattern) => !composition.patterns.some((candidate) => candidate.id === pattern.id),
          ),
      ),
  );
  if (!needsUpdate) return project;
  const next = copy(project);
  for (const composition of next.compositions) {
    composition.components = composition.components.filter(
      (definition) => !removedIds.has(definition.id),
    );
    for (const definition of definitions) {
      const index = composition.components.findIndex((item) => item.id === definition.id);
      const previousDefinition = index < 0 ? undefined : composition.components[index];
      if (index < 0) composition.components.push(copy(definition));
      else composition.components[index] = copy(definition);
      for (const resource of definition.resources ?? []) {
        const existing = composition.assets.find((asset) => asset.id === resource.id);
        if (!existing) composition.assets.push(copy(resource));
        else if (existing.kind !== resource.kind || existing.dataUri !== resource.dataUri)
          throw new Error(`Shared component resource conflicts with asset “${existing.name}”.`);
      }
      for (const pattern of definition.patterns ?? []) {
        const index = composition.patterns.findIndex((item) => item.id === pattern.id);
        if (index < 0) composition.patterns.push(copy(pattern));
        else {
          const previous = previousDefinition?.patterns?.find((item) => item.id === pattern.id);
          if (previous && equal(composition.patterns[index], previous))
            composition.patterns[index] = copy(pattern);
        }
      }
    }
  }
  reconcileProjectComponentInstances(next, project);
  return next;
}

/** Publish an edited parent once and reconcile every template that uses the shared source. */
export function synchronizeSetComponentLibrary(
  set: ProjectSetDocument,
  templateId: string,
  editedProject: Project,
  previousProject?: Project,
): ProjectSetDocument {
  const definitions = new Map(
    componentLibraryFromTemplates(set).map((definition) => [definition.id, definition]),
  );
  const before = new Map(
    (previousProject?.compositions ?? [])
      .flatMap((composition) => composition.components)
      .map((definition) => [definition.id, definition]),
  );
  const current = new Map<string, ComponentDefinition>();
  const editedDefinitions = new Map<string, ComponentDefinition>();
  for (const composition of editedProject.compositions) {
    const previous = previousProject?.compositions.find((item) => item.id === composition.id);
    for (const definition of composition.components) {
      if (!current.has(definition.id)) current.set(definition.id, definition);
      const old = previous?.components.find((item) => item.id === definition.id);
      if (previous && !equal(old, definition)) editedDefinitions.set(definition.id, definition);
    }
  }
  let changed = false;
  for (const fallback of current.values()) {
    const definition = editedDefinitions.get(fallback.id) ?? fallback;
    if (definition.scope !== 'set') continue;
    if (!definitions.has(definition.id) || editedDefinitions.has(definition.id)) {
      if (!equal(definitions.get(definition.id), definition)) changed = true;
      definitions.set(definition.id, copy(definition));
    }
  }
  const removedIds = new Set<string>();
  for (const definition of before.values()) {
    if (definition.scope !== 'set' || current.has(definition.id)) continue;
    if (
      set.templates.some((template) =>
        (template.id === templateId ? editedProject : template.project).compositions.some(
          (composition) =>
            composition.layers.some((layer) => layer.componentLink?.componentId === definition.id),
        ),
      )
    )
      throw new Error(
        'A shared component cannot be deleted while templates contain its instances.',
      );
    definitions.delete(definition.id);
    removedIds.add(definition.id);
    changed = true;
  }
  if (!changed) return set;
  const library = [...definitions.values()];
  assertComponentLibraryGraphReferences(set, library);
  return {
    ...set,
    componentAssets: library,
    templates: set.templates.map((template) => ({
      ...template,
      project: applySetComponentLibrary(
        template.id === templateId ? editedProject : template.project,
        library,
        removedIds,
      ),
    })),
  };
}
