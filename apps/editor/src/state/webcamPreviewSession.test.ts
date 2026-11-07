import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializeWebcamPreviewSession,
  subscribeWebcamPreviewSession,
} from './webcamPreviewSession';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import {
  getWebcamPresentationStream,
  getWebcamPreviewState,
  startWebcamPresentation,
  startWebcamPreview,
  stopLiveWebcamPreview,
  stopWebcamPreview,
} from './webcamPreview';

function fakeStore<State>(initial: State) {
  let state = initial;
  const listeners = new Set<(next: State, previous: State) => void>();
  return {
    getState: () => state,
    subscribe(listener: (next: State, previous: State) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: State) {
      const previous = state;
      state = next;
      for (const listener of listeners) listener(next, previous);
    },
    listenerCount: () => listeners.size,
  };
}
const set = (id: string, ids = ['one', 'two']) => ({
  id,
  templates: ids.map((id) => ({ project: { id } })),
});
const cleanups: Array<() => void> = [];
function fixture(initialSet: ReturnType<typeof set> | null = set('set-a')) {
  const projects = fakeStore({ project: { id: 'one' }, revision: 0 });
  const projectSets = fakeStore({ projectSet: initialSet, activeTemplateId: 'template-one' });
  const stopCapture = vi.fn(),
    stopLive = vi.fn();
  const stop = subscribeWebcamPreviewSession({ projects, projectSets, stopCapture, stopLive });
  cleanups.push(stop);
  return { projects, projectSets, stopCapture, stopLive, stop };
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  stopWebcamPreview();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('webcam document/set ownership', () => {
  it('clears only the child live tag when project-first template navigation precedes the selection update', () => {
    const f = fixture();
    f.projects.set({ project: { id: 'two' }, revision: 0 });
    f.projectSets.set({ projectSet: set('set-a'), activeTemplateId: 'template-two' });
    expect(f.stopLive).toHaveBeenCalledOnce();
    expect(f.stopCapture).not.toHaveBeenCalled();
  });

  it('retains capture for in-set edits, same-ID set replacement and selection changes', () => {
    const f = fixture();
    f.projects.set({ project: { id: 'one' }, revision: 1 });
    f.projectSets.set({ projectSet: set('set-a'), activeTemplateId: 'template-two' });
    f.projectSets.set({
      projectSet: set('set-a', ['one', 'two', 'three']),
      activeTemplateId: 'template-three',
    });
    expect(f.stopCapture).not.toHaveBeenCalled();
    expect(f.stopLive).not.toHaveBeenCalled();
    f.projects.set({ project: { id: 'three' }, revision: 0 });
    expect(f.stopLive).toHaveBeenCalledOnce();
  });

  it('stops capture when a different set is published before its child project', () => {
    const f = fixture();
    f.projectSets.set({ projectSet: set('set-b', ['new']), activeTemplateId: 'new' });
    expect(f.stopCapture).toHaveBeenCalledOnce();
    f.projects.set({ project: { id: 'new' }, revision: 0 });
    expect(f.stopCapture).toHaveBeenCalledOnce();
    expect(f.stopLive).toHaveBeenCalledOnce();
  });

  it('stops capture on leaving a set even when the standalone project ID matches a former child', () => {
    const f = fixture();
    f.projects.set({ project: { id: 'two' }, revision: 0 });
    expect(f.stopCapture).not.toHaveBeenCalled();
    f.projectSets.set({ projectSet: null, activeTemplateId: 'template-two' });
    expect(f.stopCapture).toHaveBeenCalledOnce();
  });

  it('stops an unrelated import immediately even before the previous set is cleared', () => {
    const f = fixture();
    f.projects.set({ project: { id: 'unrelated-import' }, revision: 0 });
    expect(f.stopCapture).toHaveBeenCalledOnce();
    expect(f.stopLive).not.toHaveBeenCalled();
    f.projectSets.set({ projectSet: null, activeTemplateId: 'template-one' });
    expect(f.stopCapture).toHaveBeenCalledTimes(2);
  });

  it('stops capture for unrelated standalone/project imports and unregisters without stopping media', () => {
    const f = fixture(null);
    f.projects.set({ project: { id: 'imported' }, revision: 0 });
    expect(f.stopCapture).toHaveBeenCalledOnce();
    expect(f.stopLive).not.toHaveBeenCalled();
    f.stop();
    f.stop();
    expect(f.projects.listenerCount()).toBe(0);
    expect(f.projectSets.listenerCount()).toBe(0);
    f.projects.set({ project: { id: 'another' }, revision: 0 });
    expect(f.stopCapture).toHaveBeenCalledOnce();
  });

  it('initializes the application observer only once', () => {
    const projectSubscribe = vi.spyOn(useProjectStore, 'subscribe');
    const setSubscribe = vi.spyOn(useProjectSetStore, 'subscribe');
    const first = initializeWebcamPreviewSession();
    cleanups.push(first);
    expect(initializeWebcamPreviewSession()).toBe(first);
    expect(projectSubscribe).toHaveBeenCalledOnce();
    expect(setSubscribe).toHaveBeenCalledOnce();
    first();
    const next = initializeWebcamPreviewSession();
    cleanups.push(next);
    expect(projectSubscribe).toHaveBeenCalledTimes(2);
    expect(setSubscribe).toHaveBeenCalledTimes(2);
  });

  it('retains the actual presentation stream across children without reacquiring and stops it on set close', async () => {
    stopWebcamPreview();
    const stopTrack = vi.fn();
    const track = { readyState: 'live', stop: stopTrack, addEventListener: vi.fn() };
    const captured = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => captured);
    const player = {
      srcObject: null,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
      readyState: 2,
      videoWidth: 1280,
      videoHeight: 720,
    };
    const registry = new Map<string, CustomElementConstructor>();
    vi.stubGlobal(
      'HTMLElement',
      class {
        dataset = {};
      },
    );
    vi.stubGlobal('customElements', {
      get: (name: string) => registry.get(name),
      define: (name: string, value: CustomElementConstructor) => registry.set(name, value),
    });
    const owner = {
      document: { createElement: () => player },
      navigator: { mediaDevices: { getUserMedia } },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window & typeof globalThis;
    const projects = fakeStore({ project: { id: 'one' } });
    const projectSets = fakeStore<{ projectSet: ReturnType<typeof set> | null }>({
      projectSet: set('set-a'),
    });
    cleanups.push(
      subscribeWebcamPreviewSession({
        projects,
        projectSets,
        stopCapture: stopWebcamPreview,
        stopLive: stopLiveWebcamPreview,
      }),
    );
    await startWebcamPreview('camera.program', '', owner);
    await startWebcamPresentation('', owner);
    projects.set({ project: { id: 'two' } });
    expect(getWebcamPresentationStream()).toBe(captured);
    expect(getWebcamPreviewState()).toMatchObject({
      status: 'running',
      presentation: true,
      tag: null,
    });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(stopTrack).not.toHaveBeenCalled();
    projectSets.set({ projectSet: null });
    expect(getWebcamPresentationStream()).toBeNull();
    expect(stopTrack).toHaveBeenCalledOnce();
  });
});
