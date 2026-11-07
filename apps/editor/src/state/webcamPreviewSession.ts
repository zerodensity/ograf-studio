import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { stopLiveWebcamPreview, stopWebcamPreview } from './webcamPreview';

interface ProjectState {
  project: { id: string };
}
interface SetState {
  projectSet: { id: string; templates: ReadonlyArray<{ project: { id: string } }> } | null;
}
interface ReadableStore<State> {
  getState(): State;
  subscribe(listener: (next: State, previous: State) => void): () => void;
}

/** Capture belongs to the open document/set; a live Media tag belongs to one child project. */
export function subscribeWebcamPreviewSession({
  projects,
  projectSets,
  stopCapture,
  stopLive,
}: {
  projects: ReadableStore<ProjectState>;
  projectSets: ReadableStore<SetState>;
  stopCapture(): void;
  stopLive(): void;
}): () => void {
  let closed = false;
  const stopSet = projectSets.subscribe((next, previous) => {
    if (closed) return;
    if ((next.projectSet?.id ?? null) !== (previous.projectSet?.id ?? null)) stopCapture();
  });
  const stopProject = projects.subscribe((next, previous) => {
    if (closed || next.project.id === previous.project.id) return;
    // Template activation loads the child before publishing its active selection. Membership
    // in the current set is authoritative; activeTemplateId can still name the previous child.
    const set = projectSets.getState().projectSet;
    if (set?.templates.some((template) => template.project.id === next.project.id)) stopLive();
    else stopCapture();
  });
  return () => {
    if (closed) return;
    closed = true;
    stopSet();
    stopProject();
  };
}

let stopSession: (() => void) | null = null;
export function initializeWebcamPreviewSession(): () => void {
  if (stopSession) return stopSession;
  const unsubscribe = subscribeWebcamPreviewSession({
    projects: useProjectStore,
    projectSets: useProjectSetStore,
    stopCapture: stopWebcamPreview,
    stopLive: stopLiveWebcamPreview,
  });
  const stop = () => {
    if (stopSession !== stop) return;
    unsubscribe();
    stopSession = null;
  };
  stopSession = stop;
  return stop;
}

// Replacing the observer is not a request to stop an explicitly started camera.
if (import.meta.hot) import.meta.hot.dispose(() => stopSession?.());
