import {
  appendAuthoringPrompt,
  createId,
  migrateProject,
  type AuthoringPrompt,
  type Project,
} from '@ograf-editor/scene-model';
import { validateProject } from '@ograf-editor/validation';
import { applyAuthoringOperations } from './operations';
import type {
  ApplyOperationsRequest,
  AuthoringChangeRecord,
  AuthoringChangeSummary,
  AuthoringMutationResult,
  AuthoringSessionChange,
  AuthoringSessionSnapshot,
} from './types';

const clone = <T>(value: T): T => structuredClone(value);

export class RevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Revision conflict: expected ${expectedRevision}, current revision is ${actualRevision}.`,
    );
    this.name = 'RevisionConflictError';
  }
}

interface HistoryEntry {
  token: string;
  project: Project;
  summary?: AuthoringChangeSummary;
}

const CHANGE_HISTORY_LIMIT = 100;

function changedLayerIds(previous: Project, next: Project): string[] {
  const previousLayers = new Map(
    previous.compositions.flatMap((composition) =>
      composition.layers.map((layer) => [layer.id, JSON.stringify(layer)] as const),
    ),
  );
  const nextLayers = new Map(
    next.compositions.flatMap((composition) =>
      composition.layers.map((layer) => [layer.id, JSON.stringify(layer)] as const),
    ),
  );
  return [...new Set([...previousLayers.keys(), ...nextLayers.keys()])].filter(
    (id) => previousLayers.get(id) !== nextLayers.get(id),
  );
}

function retainPrompts(project: Project, current: Project): Project {
  if (project.id !== current.id || !current.authoringPrompts?.length) return project;
  const prompts = new Map(current.authoringPrompts.map((prompt) => [prompt.id, prompt]));
  for (const prompt of project.authoringPrompts ?? []) {
    const existing = prompts.get(prompt.id);
    if (existing && existing.text !== prompt.text)
      throw new Error('That authoring prompt ID is already used.');
    if (!existing) prompts.set(prompt.id, prompt);
  }
  return { ...project, authoringPrompts: [...prompts.values()] };
}

export class AuthoringSession {
  readonly id: string;
  #project: Project;
  #revision = 0;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  #listeners = new Set<(change: AuthoringSessionChange) => void>();
  #changes: AuthoringChangeRecord[] = [];
  #mutationValidator:
    | ((
        previous: Project,
        candidate: Project,
        context?: { documentContext?: 'standalone' },
      ) => void)
    | null = null;

  constructor(project: Project, id = createId('session')) {
    this.id = id;
    this.#project = migrateProject(clone(project));
  }

  get revision(): number {
    return this.#revision;
  }

  /** Host-owned document context, evaluated before any mutation or history publication. */
  setMutationValidator(
    validator:
      | ((
          previous: Project,
          candidate: Project,
          context?: { documentContext?: 'standalone' },
        ) => void)
      | null,
  ): void {
    this.#mutationValidator = validator;
  }

  snapshot(): AuthoringSessionSnapshot {
    const project = clone(this.#project);
    return {
      sessionId: this.id,
      revision: this.#revision,
      project,
      validation: validateProject(project),
    };
  }

  subscribe(listener: (change: AuthoringSessionChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(change: AuthoringSessionChange): void {
    this.#changes.push({
      revision: change.revision,
      source: change.source,
      timestamp: new Date().toISOString(),
      ...(change.reason ? { reason: change.reason } : {}),
      ...(change.summary ? { summary: clone(change.summary) } : {}),
      affectedLayerIds: change.summary?.affectedLayerIds ?? [],
    });
    if (this.#changes.length > CHANGE_HISTORY_LIMIT) this.#changes.shift();
    for (const listener of this.#listeners) listener(change);
  }

  getChanges(sinceRevision: number): AuthoringChangeRecord[] {
    return this.#changes
      .filter((change) => change.revision > sinceRevision)
      .map((change) => clone(change));
  }

  matchesExternal(project: Project): boolean {
    return JSON.stringify(migrateProject(clone(project))) === JSON.stringify(this.#project);
  }

  initializeExternal(project: Project): AuthoringSessionSnapshot {
    if (this.#revision !== 0 || this.#changes.length > 0 || this.#undo.length > 0) {
      throw new Error('An external baseline can only initialize an untouched session.');
    }
    this.#project = migrateProject(clone(project));
    return this.snapshot();
  }

  /** Record a Studio chat submission without creating a graphic edit to undo. */
  recordAuthoringPrompt(projectId: string, prompt: AuthoringPrompt): number {
    if (this.#project.id !== projectId)
      throw new Error(
        'The active template changed. Send the prompt again from the intended template.',
      );
    const next = { ...this.#project };
    if (!appendAuthoringPrompt(next, prompt)) return this.#revision;
    this.#project = next;
    this.#revision++;
    this.#emit({
      sessionId: this.id,
      revision: this.#revision,
      source: 'editor',
      reason: 'Recorded an authoring prompt',
      project: clone(next),
    });
    return this.#revision;
  }

  replaceExternal(project: Project, reason = 'Editor project update'): AuthoringSessionSnapshot {
    const next = retainPrompts(migrateProject(clone(project)), this.#project);
    const current = migrateProject(clone(this.#project));
    if (JSON.stringify(next) === JSON.stringify(current)) return this.snapshot();
    const affectedLayerIds = changedLayerIds(this.#project, next);
    this.#mutationValidator?.(this.#project, next);
    // The browser owns undo history for direct UI edits. Mirroring every drag/keystroke into this
    // history would make an agent undo disagree with the editor's undo stack.
    this.#undo = [];
    this.#redo = [];
    this.#project = next;
    this.#revision++;
    this.#emit({
      sessionId: this.id,
      revision: this.#revision,
      source: 'editor',
      reason,
      project: clone(this.#project),
      summary: {
        operationCount: 1,
        operationTypes: ['editor_project_update'],
        affectedCompositionIds: next.compositions.map((composition) => composition.id),
        affectedLayerIds,
        affectedFrames: [],
        generatedIds: [],
        clearedBindings: [],
        warnings: [],
        duplicateGroups: [],
        componentInstances: [],
        semanticBlocks: [],
        stylePacks: [],
        repeaters: [],
      },
    });
    return this.snapshot();
  }

  reset(
    project: Project,
    expectedRevision: number,
    reason = 'Reset project',
    options: { documentContext?: 'standalone' } = {},
  ): AuthoringMutationResult {
    if (expectedRevision !== this.#revision) {
      throw new RevisionConflictError(expectedRevision, this.#revision);
    }
    const previousRevision = this.#revision;
    const next = migrateProject(clone(project));
    this.#mutationValidator?.(this.#project, next, options);
    const summary: AuthoringChangeSummary = {
      operationCount: 1,
      operationTypes: ['reset_project'],
      affectedCompositionIds: [
        ...new Set([
          ...this.#project.compositions.map((composition) => composition.id),
          ...next.compositions.map((composition) => composition.id),
        ]),
      ],
      affectedLayerIds: changedLayerIds(this.#project, next),
      affectedFrames: [],
      generatedIds: [],
      clearedBindings: [],
      warnings: [],
      duplicateGroups: [],
      componentInstances: [],
      semanticBlocks: [],
      stylePacks: [],
      repeaters: [],
    };
    const undoToken = createId('undo');
    this.#undo.push({ token: undoToken, project: clone(this.#project), summary });
    this.#redo = [];
    this.#project = next;
    this.#revision++;
    const validation = validateProject(this.#project);
    this.#emit({
      sessionId: this.id,
      revision: this.#revision,
      source: 'agent',
      reason,
      ...(options.documentContext ? { documentContext: options.documentContext } : {}),
      project: clone(this.#project),
      summary,
    });
    return {
      sessionId: this.id,
      revision: this.#revision,
      previousRevision,
      dryRun: false,
      undoToken,
      summary,
      validation,
      project: clone(this.#project),
    };
  }

  apply(request: ApplyOperationsRequest): AuthoringMutationResult {
    if (request.expectedRevision !== this.#revision) {
      throw new RevisionConflictError(request.expectedRevision, this.#revision);
    }
    const previousRevision = this.#revision;
    const { project, summary } = applyAuthoringOperations(this.#project, request.operations);
    const validation = validateProject(project);
    this.#mutationValidator?.(this.#project, project);
    if (request.dryRun) {
      return {
        sessionId: this.id,
        revision: this.#revision,
        previousRevision,
        dryRun: true,
        summary,
        validation,
        project: clone(project),
      };
    }
    const undoToken = createId('undo');
    this.#undo.push({ token: undoToken, project: clone(this.#project), summary });
    this.#redo = [];
    this.#project = project;
    this.#revision++;
    this.#emit({
      sessionId: this.id,
      revision: this.#revision,
      source: 'agent',
      ...(request.reason ? { reason: request.reason } : {}),
      project: clone(this.#project),
      summary,
    });
    return {
      sessionId: this.id,
      revision: this.#revision,
      previousRevision,
      dryRun: false,
      undoToken,
      summary,
      validation,
      project: clone(this.#project),
    };
  }

  undo(expectedRevision: number): AuthoringSessionSnapshot {
    if (expectedRevision !== this.#revision) {
      throw new RevisionConflictError(expectedRevision, this.#revision);
    }
    const previous = this.#undo.at(-1);
    if (!previous) throw new Error('Nothing to undo.');
    const project = retainPrompts(previous.project, this.#project);
    this.#mutationValidator?.(this.#project, project);
    this.#undo.pop();
    this.#redo.push({
      token: previous.token,
      project: clone(this.#project),
      ...(previous.summary ? { summary: previous.summary } : {}),
    });
    this.#project = project;
    this.#revision++;
    this.#emit({
      sessionId: this.id,
      revision: this.#revision,
      source: 'undo',
      project: clone(this.#project),
      ...(previous.summary ? { summary: previous.summary } : {}),
    });
    return this.snapshot();
  }

  redo(expectedRevision: number): AuthoringSessionSnapshot {
    if (expectedRevision !== this.#revision) {
      throw new RevisionConflictError(expectedRevision, this.#revision);
    }
    const next = this.#redo.at(-1);
    if (!next) throw new Error('Nothing to redo.');
    const project = retainPrompts(next.project, this.#project);
    this.#mutationValidator?.(this.#project, project);
    this.#redo.pop();
    this.#undo.push({
      token: next.token,
      project: clone(this.#project),
      ...(next.summary ? { summary: next.summary } : {}),
    });
    this.#project = project;
    this.#revision++;
    this.#emit({
      sessionId: this.id,
      revision: this.#revision,
      source: 'redo',
      project: clone(this.#project),
      ...(next.summary ? { summary: next.summary } : {}),
    });
    return this.snapshot();
  }
}
