import type { Project } from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';
import { describeProjectChange } from './historyLabels';
import { useSelectionStore } from './selectionStore';
import { useProjectSetStore } from './projectSetStore';
import type { ProjectSetDocument } from './projectSet';
import { changedTemplateSetSettingKeys } from './templateSetSettings';
import { changedSharedBrandTokenIds } from './templateSetTheme';
import { synchronizeSetComponentLibrary } from './componentSetLibrary';
import { useTestDataStore } from './testDataStore';
import { useTimelineStore } from './timelineStore';

const MAX_HISTORY = 50;
const DEBOUNCE_MS = 500;

interface StoredHistoryEntry {
  id: number;
  project: Project;
  label: string;
  timestamp: number;
  templateSet?: ProjectSetDocument | null;
  activeTemplateId?: string | null;
  selectedLayerIds?: string[];
  editorContext?: EditorHistoryContext;
}

interface EditorHistoryContext {
  activeCompositionId: string;
  activeKeyframeId: string;
  currentFrame: number;
  restoreFreshSession: () => void;
}

function captureEditorHistoryContext(): EditorHistoryContext {
  const project = useProjectStore.getState();
  return {
    activeCompositionId: project.activeCompositionId,
    activeKeyframeId: project.activeKeyframeId,
    currentFrame: useTimelineStore.getState().currentFrame,
    restoreFreshSession: project.captureFreshTemplateSession(),
  };
}

function restoreEditorHistoryContext(context: EditorHistoryContext): void {
  context.restoreFreshSession();
  useProjectStore.setState({
    activeCompositionId: context.activeCompositionId,
    activeKeyframeId: context.activeKeyframeId,
  });
  useTimelineStore.getState().setCurrentFrame(context.currentFrame);
  try {
    useTimelineStore.getState().controller?.seek(context.currentFrame);
  } catch {
    // The stage may already have discarded its old controller during the document switch.
  }
}

export interface HistoryItem {
  id: number;
  label: string;
  timestamp: number;
}

export interface HistorySnapshot {
  past: HistoryItem[];
  future: HistoryItem[];
  canUndo: boolean;
  canRedo: boolean;
}

let past: StoredHistoryEntry[] = [];
let future: StoredHistoryEntry[] = [];
// The state right before the current burst of (debounced) edits — flushed into `past` once
// the burst settles, so rapid changes (typing, dragging) coalesce into one undo step.
let pendingEntry: StoredHistoryEntry | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let suppressNextCapture = false;
let previousProject = useProjectStore.getState().project;
let previousTemplateSet = useProjectSetStore.getState().projectSet;
let previousTemplateId = useProjectSetStore.getState().activeTemplateId;
let restoringSet = false;
let nextHistoryId = 1;
const listeners = new Set<() => void>();
let publicSnapshot: HistorySnapshot = { past: [], future: [], canUndo: false, canRedo: false };

const publicItem = ({ id, label, timestamp }: StoredHistoryEntry): HistoryItem => ({
  id,
  label,
  timestamp,
});

function publishHistory(): void {
  const visiblePast = pendingEntry ? [...past, pendingEntry] : past;
  publicSnapshot = {
    past: visiblePast.map(publicItem),
    // The last internal future entry is the next redo action.
    future: [...future].reverse().map(publicItem),
    canUndo: visiblePast.length > 0,
    canRedo: future.length > 0,
  };
  listeners.forEach((listener) => listener());
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getHistorySnapshot(): HistorySnapshot {
  return publicSnapshot;
}

function flushPending(): void {
  if (pendingEntry) {
    past.push(pendingEntry);
    if (past.length > MAX_HISTORY) past.shift();
    pendingEntry = null;
    publishHistory();
  }
}

/** Commits any pending edit burst before and after one explicit command such as Duplicate. */
export function runDiscreteHistoryStep<T>(mutation: () => T, label?: string): T {
  window.clearTimeout(debounceTimer);
  flushPending();
  const selectionBefore = [...useSelectionStore.getState().selectedLayerIds];
  try {
    return mutation();
  } finally {
    window.clearTimeout(debounceTimer);
    if (pendingEntry && label) {
      pendingEntry.label = label;
      if (label === 'Repeat selection') pendingEntry.selectedLayerIds = selectionBefore;
    }
    flushPending();
  }
}

/** Run one multi-store command, restoring its state and history if any part fails. */
export function runAtomicHistoryStep<T>(mutation: () => T, rollback: () => void, label: string): T {
  window.clearTimeout(debounceTimer);
  flushPending();
  const previousPast = [...past];
  const previousFuture = [...future];
  const previousEditorContext = captureEditorHistoryContext();
  try {
    const result = mutation();
    window.clearTimeout(debounceTimer);
    if (pendingEntry) {
      pendingEntry.label = label;
      pendingEntry.editorContext = previousEditorContext;
    }
    flushPending();
    return result;
  } catch (error) {
    window.clearTimeout(debounceTimer);
    restoringSet = true;
    suppressNextCapture = true;
    try {
      rollback();
    } finally {
      restoringSet = false;
      suppressNextCapture = false;
      previousProject = useProjectStore.getState().project;
      previousTemplateSet = useProjectSetStore.getState().projectSet;
      previousTemplateId = useProjectSetStore.getState().activeTemplateId;
      pendingEntry = null;
      past = previousPast;
      future = previousFuture;
      publishHistory();
    }
    throw error;
  }
}

/** Continuous controls, such as a color drag, coalesce into one named history entry. */
export function runCoalescedHistoryStep<T>(mutation: () => T, label: string): T {
  if (pendingEntry && pendingEntry.label !== label) {
    window.clearTimeout(debounceTimer);
    flushPending();
  }
  try {
    return mutation();
  } finally {
    if (pendingEntry) {
      pendingEntry.label = label;
      publishHistory();
    }
  }
}

export interface RemoteHistoryUpdate {
  source: string;
  documentContext?: 'standalone';
  reason?: string;
  summary?: { operationCount?: number; operationTypes?: string[] };
}

export function remoteHistoryLabel(update: RemoteHistoryUpdate): string {
  const acceptedTitle = update.reason?.match(/^Accepted proposal:\s*(.+)$/)?.[1];
  const prefix = acceptedTitle
    ? 'AI'
    : update.source === 'undo'
      ? 'Agent undo'
      : update.source === 'redo'
        ? 'Agent redo'
        : update.source === 'system'
          ? 'System'
          : 'AI';
  const description =
    acceptedTitle ||
    update.reason ||
    update.summary?.operationTypes?.join(', ') ||
    'Update project';
  const count = update.summary?.operationCount;
  return `${prefix}: ${description}${count ? ` (${count} ${count === 1 ? 'action' : 'actions'})` : ''}`;
}

/** Keep accepted batches in the same undo stack as direct editing, without echoing a server undo. */
export function applyRemoteProjectUpdate(project: Project, update: RemoteHistoryUpdate): void {
  // Same-project MCP echoes intentionally bypass the full loader to preserve exact browser edits.
  // Establish only the new first-release collection; never infer it from experimental media data.
  if (project.compositions.some((composition) => !Array.isArray(composition.mediaCues))) {
    project = {
      ...project,
      compositions: project.compositions.map((composition) => ({
        ...composition,
        mediaCues: composition.mediaCues ?? [],
      })),
    };
  }
  const current = useProjectStore.getState().project;
  // A standalone file can share its project ID with an exported set child. Its explicit open
  // boundary must still close the old set, before snapshot/autosave readers can copy it back.
  if (update.documentContext === 'standalone') {
    useProjectSetStore.getState().clearProjectSet();
    useTestDataStore.getState().resetAll();
    useProjectStore.getState().loadProject(project);
    useSelectionStore.getState().select(null);
    resetHistory();
    return;
  }
  if (JSON.stringify(current) === JSON.stringify(project)) return;
  if (current.id !== project.id) {
    useProjectStore.getState().loadProject(project);
    useSelectionStore.getState().select(null);
    resetHistory();
    return;
  }
  const session = useProjectSetStore.getState();
  const template = session.projectSet?.templates.find(
    (item) => item.id === session.activeTemplateId,
  );
  let stagedSet = session.projectSet;
  if (stagedSet && template) {
    const settings =
      stagedSet.settings && template.inheritSettings !== false
        ? changedTemplateSetSettingKeys(current, project)
        : [];
    const tokens = stagedSet.brandKit
      ? changedSharedBrandTokenIds(current, project, stagedSet.brandKit)
      : [];
    if (settings.length || tokens.length)
      stagedSet = {
        ...stagedSet,
        templates: stagedSet.templates.map((item) =>
          item.id === template.id
            ? {
                ...item,
                settingsOverrides: [...new Set([...(item.settingsOverrides ?? []), ...settings])],
                brandKitOverrides: [...new Set([...(item.brandKitOverrides ?? []), ...tokens])],
              }
            : item,
        ),
      };
  }
  if (stagedSet && session.activeTemplateId) {
    const synchronized = synchronizeSetComponentLibrary(
      stagedSet,
      session.activeTemplateId,
      project,
      current,
    );
    if (synchronized !== stagedSet) {
      stagedSet = synchronized;
      project =
        synchronized.templates.find((item) => item.id === session.activeTemplateId)?.project ??
        project;
    }
  }
  // A failed shared-source edit has not changed settings, selection or either history stack.
  window.clearTimeout(debounceTimer);
  flushPending();
  const stack = update.source === 'undo' ? past : update.source === 'redo' ? future : [];
  if (stack.length && JSON.stringify(stack.at(-1)!.project) === JSON.stringify(project)) {
    if (update.source === 'undo') undo();
    else redo();
    return;
  }
  runDiscreteHistoryStep(() => {
    if (stagedSet !== session.projectSet) session.setProjectSet(stagedSet);
    useProjectStore.setState({ project });
    reconcileActiveKeyframe();
    reconcileLayerSelection();
  }, remoteHistoryLabel(update));
}

useProjectStore.subscribe((state) => {
  if (state.project === previousProject) return;
  if (suppressNextCapture) {
    suppressNextCapture = false;
    previousProject = state.project;
    return;
  }
  if (pendingEntry === null) {
    pendingEntry = {
      id: nextHistoryId++,
      project: previousProject,
      label: describeProjectChange(previousProject, state.project),
      timestamp: Date.now(),
      templateSet: previousTemplateSet,
      activeTemplateId: previousTemplateId,
    };
  } else {
    pendingEntry.label = describeProjectChange(pendingEntry.project, state.project);
    pendingEntry.timestamp = Date.now();
  }
  future = [];
  window.clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushPending, DEBOUNCE_MS);
  previousProject = state.project;
  publishHistory();
});

useProjectSetStore.subscribe((state) => {
  if (state.projectSet === previousTemplateSet && state.activeTemplateId === previousTemplateId)
    return;
  if (!restoringSet) {
    if (!pendingEntry)
      pendingEntry = {
        id: nextHistoryId++,
        project: previousProject,
        label: 'Update Template Set',
        timestamp: Date.now(),
        templateSet: previousTemplateSet,
        activeTemplateId: previousTemplateId,
      };
    future = [];
    window.clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushPending, DEBOUNCE_MS);
    publishHistory();
  }
  previousTemplateSet = state.projectSet;
  previousTemplateId = state.activeTemplateId;
});

function currentSetContext() {
  const state = useProjectSetStore.getState();
  return { templateSet: state.projectSet, activeTemplateId: state.activeTemplateId };
}

function restoreSetContext(entry: StoredHistoryEntry) {
  if (entry.templateSet === undefined) return;
  restoringSet = true;
  try {
    useProjectSetStore.setState({
      projectSet: entry.templateSet,
      activeTemplateId: entry.activeTemplateId ?? null,
    });
  } finally {
    restoringSet = false;
  }
}

/** After restoring a past/future project snapshot, the active keyframe may no longer exist. */
function reconcileActiveKeyframe(): void {
  let state = useProjectStore.getState();
  let composition = state.project.compositions.find(
    (candidate) => candidate.id === state.activeCompositionId,
  );
  if (!composition) {
    composition =
      state.project.compositions.find(
        (candidate) => candidate.id === state.project.mainCompositionId,
      ) ?? state.project.compositions[0];
    if (!composition) return;
    useProjectStore.setState({
      activeCompositionId: composition.id,
      activeKeyframeId: composition.keyframes[0]?.id ?? '',
    });
    state = useProjectStore.getState();
  }
  composition = getActiveComposition(state.project, state.activeCompositionId);
  const exists = composition.keyframes.some((k) => k.id === state.activeKeyframeId);
  if (!exists && composition.keyframes[0]) {
    state.setActiveKeyframe(composition.keyframes[0].id);
  }
}

function reconcileLayerSelection(): void {
  const state = useProjectStore.getState();
  const composition = state.project.compositions.find(
    (candidate) => candidate.id === state.activeCompositionId,
  );
  const selection = useSelectionStore.getState();
  const validLayerIds = new Set(composition?.layers.map((layer) => layer.id) ?? []);
  const selectedLayerIds = selection.selectedLayerIds.filter((layerId) =>
    validLayerIds.has(layerId),
  );
  if (
    selectedLayerIds.length !== selection.selectedLayerIds.length ||
    (selection.selectedLayerId !== null && !validLayerIds.has(selection.selectedLayerId))
  ) {
    selection.selectMany(selectedLayerIds);
  }
}

export function undo(steps = 1): void {
  if (steps === 1 && useSelectionStore.getState().undoDeselectAll()) return;
  undoProjectSteps(steps);
}

function undoProjectSteps(steps: number): void {
  window.clearTimeout(debounceTimer);
  flushPending();
  let restored = useProjectStore.getState().project;
  let context = currentSetContext();
  let selectedLayerIds = [...useSelectionStore.getState().selectedLayerIds];
  let restoreSelection = false;
  let editorContext = captureEditorHistoryContext();
  let restoreEditorContext = false;
  let applied = 0;
  for (let index = 0; index < Math.max(1, Math.round(steps)); index++) {
    const previous = past.pop();
    if (!previous) break;
    future.push({
      ...previous,
      project: restored,
      ...context,
      ...(previous.editorContext ? { editorContext } : {}),
      ...(previous.selectedLayerIds ? { selectedLayerIds } : {}),
    });
    restored = previous.project;
    if (previous.editorContext) {
      editorContext = previous.editorContext;
      restoreEditorContext = true;
    }
    if (previous.selectedLayerIds) {
      selectedLayerIds = previous.selectedLayerIds;
      restoreSelection = true;
    }
    if (previous.templateSet !== undefined)
      context = {
        templateSet: previous.templateSet,
        activeTemplateId: previous.activeTemplateId ?? null,
      };
    applied++;
  }
  if (applied === 0) return;
  suppressNextCapture = restored !== useProjectStore.getState().project;
  restoreSetContext({ id: 0, label: '', timestamp: 0, project: restored, ...context });
  useProjectStore.setState({ project: restored });
  if (restoreEditorContext) restoreEditorHistoryContext(editorContext);
  reconcileActiveKeyframe();
  if (restoreSelection) useSelectionStore.getState().selectMany(selectedLayerIds);
  reconcileLayerSelection();
  publishHistory();
}

/** Jump to a boundary in the displayed history, without consuming selection-only undo. */
export function jumpToHistoryPosition(position: number): void {
  window.clearTimeout(debounceTimer);
  flushPending();
  if (!Number.isInteger(position) || position < 0 || position > past.length + future.length) return;
  const delta = position - past.length;
  if (delta < 0) undoProjectSteps(-delta);
  else if (delta > 0) redo(delta);
}

export function redo(steps = 1): void {
  window.clearTimeout(debounceTimer);
  flushPending();
  let restored = useProjectStore.getState().project;
  let context = currentSetContext();
  let selectedLayerIds = [...useSelectionStore.getState().selectedLayerIds];
  let restoreSelection = false;
  let editorContext = captureEditorHistoryContext();
  let restoreEditorContext = false;
  let applied = 0;
  for (let index = 0; index < Math.max(1, Math.round(steps)); index++) {
    const next = future.pop();
    if (!next) break;
    past.push({
      ...next,
      project: restored,
      ...context,
      ...(next.editorContext ? { editorContext } : {}),
      ...(next.selectedLayerIds ? { selectedLayerIds } : {}),
    });
    restored = next.project;
    if (next.editorContext) {
      editorContext = next.editorContext;
      restoreEditorContext = true;
    }
    if (next.selectedLayerIds) {
      selectedLayerIds = next.selectedLayerIds;
      restoreSelection = true;
    }
    if (next.templateSet !== undefined)
      context = { templateSet: next.templateSet, activeTemplateId: next.activeTemplateId ?? null };
    applied++;
  }
  if (applied === 0) return;
  suppressNextCapture = restored !== useProjectStore.getState().project;
  restoreSetContext({ id: 0, label: '', timestamp: 0, project: restored, ...context });
  useProjectStore.setState({ project: restored });
  if (restoreEditorContext) restoreEditorHistoryContext(editorContext);
  reconcileActiveKeyframe();
  if (restoreSelection) useSelectionStore.getState().selectMany(selectedLayerIds);
  reconcileLayerSelection();
  publishHistory();
}

/** Call after loading/creating a project so its predecessor isn't undo-able back into. */
export function resetHistory(): void {
  past = [];
  future = [];
  pendingEntry = null;
  suppressNextCapture = false;
  window.clearTimeout(debounceTimer);
  previousProject = useProjectStore.getState().project;
  previousTemplateSet = useProjectSetStore.getState().projectSet;
  previousTemplateId = useProjectSetStore.getState().activeTemplateId;
  publishHistory();
}
