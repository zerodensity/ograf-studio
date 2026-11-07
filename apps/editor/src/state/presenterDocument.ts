import {
  createId,
  PRESENTER_DEFAULT_DURATION_SECONDS,
  PRESENTER_MAX_NOTES_LENGTH,
  PRESENTER_MAX_TITLE_LENGTH,
  validatePresenterDefinition,
  type PresenterDefinition,
  type PresenterEntry,
  type Project,
} from '@ograf-editor/scene-model';
import { runDiscreteHistoryStep } from './historyStore';
import { saveProjectSetTemplateEdits, type ProjectSetDocument } from './projectSet';
import { applyProjectSetChange } from './projectSetSession';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';

export interface PresenterCandidate {
  templateId: string;
  stateId?: string;
  title: string;
  notes: string;
}

export interface ResolvedPresenterEntry extends PresenterEntry {
  title: string;
  notes: string;
  durationSeconds: number;
  available: boolean;
  problem?: string;
  candidate?: PresenterCandidate;
}

export interface PresenterDocumentSnapshot {
  id: string;
  name: string;
  projectSet: ProjectSetDocument | null;
  project: Project;
  definition: PresenterDefinition;
  candidates: PresenterCandidate[];
  entries: ResolvedPresenterEntry[];
}

/** Stable default IDs avoid rewriting a source merely by opening the Presenter pane. */
function defaultEntryId(templateId: string, index: number): string {
  return `presenter-default-${index}-${templateId}`.slice(0, 256);
}

function candidatesFor(project: Project, set: ProjectSetDocument | null): PresenterCandidate[] {
  if (!set) return [{ templateId: project.id, title: project.name, notes: project.description }];
  return set.templates.flatMap((template) => {
    const base = {
      templateId: template.id,
      title: template.name,
      notes: template.project.description,
    };
    const states = set.transitionLogic?.states.filter((state) => state.templateId === template.id);
    return states?.length
      ? states.map((state) => ({
          ...base,
          stateId: state.id,
          title: states.length > 1 ? `${template.name} · ${state.name}` : template.name,
        }))
      : [base];
  });
}

/** Defaults are a view until the operator edits them, so older documents remain unchanged. */
export function defaultPresenterDefinition(
  project: Project,
  set: ProjectSetDocument | null,
): PresenterDefinition {
  const sources = set
    ? set.templates.map((template) => ({ id: template.id }))
    : [{ id: project.id }];
  return {
    version: 1,
    defaultDurationSeconds: PRESENTER_DEFAULT_DURATION_SECONDS,
    loop: false,
    playback: 'auto',
    entries: sources.map((source, index) => {
      const states = set?.transitionLogic?.states.filter((state) => state.templateId === source.id);
      return {
        id: defaultEntryId(source.id, index),
        templateId: source.id,
        ...(states?.length === 1 ? { stateId: states[0]!.id } : {}),
      };
    }),
  };
}

/** Read the full source without changing the editor selection, scene, or live output. */
export function presenterDocumentSnapshot(
  project: Project,
  projectSet: ProjectSetDocument | null,
  activeTemplateId?: string | null,
): PresenterDocumentSnapshot {
  const active = projectSet?.templates.find((template) => template.id === activeTemplateId);
  const set =
    projectSet && active?.project.id === project.id
      ? saveProjectSetTemplateEdits(projectSet, active.id, project)
      : projectSet;
  const stored = set ? set.presenter : project.presenter;
  if (stored !== undefined) validatePresenterDefinition(stored);
  const definition = stored ?? defaultPresenterDefinition(project, set);
  const candidates = candidatesFor(project, set);
  const entries: ResolvedPresenterEntry[] = definition.entries.map((entry) => {
    const templateExists = set
      ? set.templates.some((template) => template.id === entry.templateId)
      : entry.templateId === project.id;
    const state = entry.stateId
      ? set?.transitionLogic?.states.find((item) => item.id === entry.stateId)
      : undefined;
    const candidate =
      candidates.find(
        (item) => item.templateId === entry.templateId && item.stateId === entry.stateId,
      ) ?? candidates.find((item) => item.templateId === entry.templateId);
    const problem = !templateExists
      ? 'The template is missing. Choose another template or remove this entry.'
      : definition.playback !== 'independent' && entry.stateId && !state
        ? 'The playout state is missing. Choose another state or independent playback.'
        : definition.playback !== 'independent' && state && state.templateId !== entry.templateId
          ? 'This playout state belongs to a different template.'
          : undefined;
    return {
      ...entry,
      title: entry.title ?? candidate?.title ?? 'Missing template',
      notes: entry.notes ?? candidate?.notes ?? '',
      durationSeconds: entry.durationSeconds ?? definition.defaultDurationSeconds,
      available: !problem,
      ...(problem ? { problem } : {}),
      ...(candidate ? { candidate } : {}),
    };
  });
  return {
    id: set?.id ?? project.id,
    name: set?.name ?? project.name,
    projectSet: set,
    project,
    definition,
    candidates,
    entries,
  };
}

export function currentPresenterDocument(): PresenterDocumentSnapshot {
  const { projectSet, activeTemplateId } = useProjectSetStore.getState();
  return presenterDocumentSnapshot(
    useProjectStore.getState().project,
    projectSet,
    activeTemplateId,
  );
}

/**
 * Preview follows the template navigator. Older presentation metadata remains in the
 * source for round-tripping, but cannot hide, repeat, rename, or time preview entries.
 */
export function templatePreviewDocumentSnapshot(
  project: Project,
  projectSet: ProjectSetDocument | null,
  activeTemplateId?: string | null,
): PresenterDocumentSnapshot {
  const active = projectSet?.templates.find((template) => template.id === activeTemplateId);
  const set =
    projectSet && active?.project.id === project.id
      ? saveProjectSetTemplateEdits(projectSet, active.id, project)
      : projectSet;
  const definition = defaultPresenterDefinition(project, set);
  const candidates: PresenterCandidate[] = definition.entries.map((entry) => ({
    templateId: entry.templateId,
    ...(entry.stateId ? { stateId: entry.stateId } : {}),
    title:
      set?.templates.find((template) => template.id === entry.templateId)?.name ?? project.name,
    notes: '',
  }));
  return {
    id: set?.id ?? project.id,
    name: set?.name ?? project.name,
    projectSet: set,
    project,
    definition,
    candidates,
    entries: definition.entries.map((entry, index) => ({
      ...entry,
      title: candidates[index]!.title,
      notes: '',
      durationSeconds: definition.defaultDurationSeconds,
      available: true,
      candidate: candidates[index]!,
    })),
  };
}

export function currentTemplatePreviewDocument(): PresenterDocumentSnapshot {
  const { projectSet, activeTemplateId } = useProjectSetStore.getState();
  return templatePreviewDocumentSnapshot(
    useProjectStore.getState().project,
    projectSet,
    activeTemplateId,
  );
}

/** Persist one undoable edit; autosave already subscribes to both document stores. */
export function applyPresenterDefinition(
  definition: PresenterDefinition | null,
  expected?: { documentId: string; baseline: string },
): void {
  const current = currentPresenterDocument();
  const stored = current.projectSet ? current.projectSet.presenter : current.project.presenter;
  if (
    expected &&
    (expected.documentId !== current.id || expected.baseline !== JSON.stringify(stored ?? null))
  )
    throw new Error('The presentation changed. Reopen its settings before applying this edit.');
  if (definition !== null) validatePresenterDefinition(definition);
  if (JSON.stringify(stored ?? null) === JSON.stringify(definition)) return;
  if (current.projectSet) {
    const updated = { ...current.projectSet };
    if (definition === null) delete updated.presenter;
    else updated.presenter = structuredClone(definition);
    applyProjectSetChange(updated, false, 'Edit Presenter sequence');
  } else {
    runDiscreteHistoryStep(() => {
      const updated = { ...current.project };
      if (definition === null) delete updated.presenter;
      else updated.presenter = structuredClone(definition);
      useProjectStore.setState({ project: updated });
    }, 'Edit Presenter sequence');
  }
}

export function updatePresenterEntry(
  entryId: string,
  patch: Partial<Omit<PresenterEntry, 'id'>>,
): void {
  const definition = structuredClone(currentPresenterDocument().definition);
  const entry = definition.entries.find((item) => item.id === entryId);
  if (!entry) throw new Error('The presentation entry no longer exists.');
  Object.assign(entry, patch);
  applyPresenterDefinition(definition);
}

export function addPresenterEntry(candidate: PresenterCandidate, index?: number): string {
  const current = currentPresenterDocument();
  if (
    !current.candidates.some(
      (item) => item.templateId === candidate.templateId && item.stateId === candidate.stateId,
    )
  )
    throw new Error('The selected template or playout state no longer exists.');
  const definition = structuredClone(current.definition);
  const id = createId('presenter-entry');
  const entry: PresenterEntry = {
    id,
    templateId: candidate.templateId,
    ...(candidate.stateId ? { stateId: candidate.stateId } : {}),
  };
  const at = index === undefined ? definition.entries.length : Math.trunc(index);
  if (!Number.isFinite(at) || at < 0 || at > definition.entries.length)
    throw new Error('The presentation insertion position is invalid.');
  definition.entries.splice(at, 0, entry);
  applyPresenterDefinition(definition);
  return id;
}

export function duplicatePresenterEntry(entryId: string): string {
  const definition = structuredClone(currentPresenterDocument().definition);
  const index = definition.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) throw new Error('The presentation entry no longer exists.');
  const id = createId('presenter-entry');
  definition.entries.splice(index + 1, 0, { ...definition.entries[index]!, id });
  applyPresenterDefinition(definition);
  return id;
}

export function removePresenterEntry(entryId: string): void {
  const definition = structuredClone(currentPresenterDocument().definition);
  definition.entries = definition.entries.filter((entry) => entry.id !== entryId);
  applyPresenterDefinition(definition);
}

export function movePresenterEntry(entryId: string, offset: -1 | 1): void {
  const definition = structuredClone(currentPresenterDocument().definition);
  const index = definition.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) throw new Error('The presentation entry no longer exists.');
  const target = index + offset;
  if (target < 0 || target >= definition.entries.length) return;
  [definition.entries[index], definition.entries[target]] = [
    definition.entries[target]!,
    definition.entries[index]!,
  ];
  applyPresenterDefinition(definition);
}

export function reorderPresenterEntry(
  entryId: string,
  targetId: string,
  side: 'before' | 'after' = 'before',
): void {
  if (entryId === targetId) return;
  const definition = structuredClone(currentPresenterDocument().definition);
  const source = definition.entries.find((entry) => entry.id === entryId);
  if (!source || !definition.entries.some((entry) => entry.id === targetId))
    throw new Error('The presentation entry no longer exists.');
  definition.entries = definition.entries.filter((entry) => entry.id !== entryId);
  const target = definition.entries.findIndex((entry) => entry.id === targetId);
  definition.entries.splice(target + (side === 'after' ? 1 : 0), 0, source);
  applyPresenterDefinition(definition);
}

/** Remove saved editorial choices and resume following the natural template order. */
export function resetPresenterSequence(): void {
  applyPresenterDefinition(null);
}

/** A convenient bounded copy for notes initialized by external editor integrations. */
export function presenterCandidateLabels(candidate: PresenterCandidate) {
  return {
    title: candidate.title.slice(0, PRESENTER_MAX_TITLE_LENGTH),
    notes: candidate.notes.slice(0, PRESENTER_MAX_NOTES_LENGTH),
  };
}
