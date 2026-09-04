import type { Project } from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';
import { describeProjectChange } from './historyLabels';
import { useSelectionStore } from './selectionStore';

const MAX_HISTORY = 50;
const DEBOUNCE_MS = 500;

interface StoredHistoryEntry {
  id: number;
  project: Project;
  label: string;
  timestamp: number;
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
export function runDiscreteHistoryStep<T>(mutation: () => T): T {
  window.clearTimeout(debounceTimer);
  flushPending();
  try {
    return mutation();
  } finally {
    window.clearTimeout(debounceTimer);
    flushPending();
  }
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
  window.clearTimeout(debounceTimer);
  flushPending();
  let restored = useProjectStore.getState().project;
  let applied = 0;
  for (let index = 0; index < Math.max(1, Math.round(steps)); index++) {
    const previous = past.pop();
    if (!previous) break;
    future.push({ ...previous, project: restored });
    restored = previous.project;
    applied++;
  }
  if (applied === 0) return;
  suppressNextCapture = true;
  useProjectStore.setState({ project: restored });
  reconcileActiveKeyframe();
  reconcileLayerSelection();
  publishHistory();
}

export function redo(steps = 1): void {
  window.clearTimeout(debounceTimer);
  flushPending();
  let restored = useProjectStore.getState().project;
  let applied = 0;
  for (let index = 0; index < Math.max(1, Math.round(steps)); index++) {
    const next = future.pop();
    if (!next) break;
    past.push({ ...next, project: restored });
    restored = next.project;
    applied++;
  }
  if (applied === 0) return;
  suppressNextCapture = true;
  useProjectStore.setState({ project: restored });
  reconcileActiveKeyframe();
  reconcileLayerSelection();
  publishHistory();
}

/** Call after loading/creating a project so its predecessor isn't undo-able back into. */
export function resetHistory(): void {
  past = [];
  future = [];
  pendingEntry = null;
  window.clearTimeout(debounceTimer);
  previousProject = useProjectStore.getState().project;
  publishHistory();
}
