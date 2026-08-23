import { createId, migrateProject, type Project } from '@ograf-editor/scene-model';
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

export class AuthoringSession {
  readonly id: string;
  #project: Project;
  #revision = 0;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  #listeners = new Set<(change: AuthoringSessionChange) => void>();
  #changes: AuthoringChangeRecord[] = [];

  constructor(project: Project, id = createId('session')) {
    this.id = id;
    this.#project = migrateProject(clone(project));
  }

  get revision(): number {
    return this.#revision;
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

  replaceExternal(project: Project, reason = 'Editor project update'): AuthoringSessionSnapshot {
    const next = migrateProject(clone(project));
    if (JSON.stringify(next) === JSON.stringify(this.#project)) return this.snapshot();
    const affectedLayerIds = changedLayerIds(this.#project, next);
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
      },
    });
    return this.snapshot();
  }

  reset(
    project: Project,
    expectedRevision: number,
    reason = 'Reset project',
  ): AuthoringMutationResult {
    if (expectedRevision !== this.#revision) {
      throw new RevisionConflictError(expectedRevision, this.#revision);
    }
    const previousRevision = this.#revision;
    const next = migrateProject(clone(project));
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
    const previous = this.#undo.pop();
    if (!previous) throw new Error('Nothing to undo.');
    this.#redo.push({
      token: previous.token,
      project: clone(this.#project),
      ...(previous.summary ? { summary: previous.summary } : {}),
    });
    this.#project = previous.project;
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
    const next = this.#redo.pop();
    if (!next) throw new Error('Nothing to redo.');
    this.#undo.push({
      token: next.token,
      project: clone(this.#project),
      ...(next.summary ? { summary: next.summary } : {}),
    });
    this.#project = next.project;
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
