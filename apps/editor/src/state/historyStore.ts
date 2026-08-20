import type { Project } from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';

const MAX_HISTORY = 50;
const DEBOUNCE_MS = 500;

let past: Project[] = [];
let future: Project[] = [];
// The state right before the current burst of (debounced) edits — flushed into `past` once
// the burst settles, so rapid changes (typing, dragging) coalesce into one undo step.
let pendingSnapshot: Project | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let suppressNextCapture = false;
let previousProject = useProjectStore.getState().project;

function flushPending(): void {
  if (pendingSnapshot) {
    past.push(pendingSnapshot);
    if (past.length > MAX_HISTORY) past.shift();
    pendingSnapshot = null;
  }
}

useProjectStore.subscribe((state) => {
  if (state.project === previousProject) return;
  if (suppressNextCapture) {
    suppressNextCapture = false;
    previousProject = state.project;
    return;
  }
  if (pendingSnapshot === null) {
    pendingSnapshot = previousProject;
  }
  future = [];
  window.clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushPending, DEBOUNCE_MS);
  previousProject = state.project;
});

/** After restoring a past/future project snapshot, the active keyframe may no longer exist. */
function reconcileActiveKeyframe(): void {
  const state = useProjectStore.getState();
  const composition = getActiveComposition(state.project, state.activeCompositionId);
  const exists = composition.keyframes.some((k) => k.id === state.activeKeyframeId);
  if (!exists && composition.keyframes[0]) {
    state.setActiveKeyframe(composition.keyframes[0].id);
  }
}

export function undo(): void {
  window.clearTimeout(debounceTimer);
  flushPending();
  const prev = past.pop();
  if (!prev) return;
  future.push(useProjectStore.getState().project);
  suppressNextCapture = true;
  useProjectStore.setState({ project: prev });
  reconcileActiveKeyframe();
}

export function redo(): void {
  const next = future.pop();
  if (!next) return;
  past.push(useProjectStore.getState().project);
  suppressNextCapture = true;
  useProjectStore.setState({ project: next });
  reconcileActiveKeyframe();
}

/** Call after loading/creating a project so its predecessor isn't undo-able back into. */
export function resetHistory(): void {
  past = [];
  future = [];
  pendingSnapshot = null;
  window.clearTimeout(debounceTimer);
  previousProject = useProjectStore.getState().project;
}
