import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@ograf-editor/scene-model';
import { initializeEditorSession } from './editorStartup';
import { useProjectSetStore } from './projectSetStore';
import { useProjectStore } from './projectStore';
import { createProjectSet } from './projectSet';
import { requestStartupCreation } from './startupCreation';
import { useStartupScreenStore } from './startupScreenStore';
import { parseWorkspaceState } from './workspaceModel';
import { loadAutosave, saveProjectSetAutosave } from './fileIO';
import { startAutosave } from './useAutosave';
import {
  hydrateWorkspaceState,
  serializeWorkspaceState,
  useWorkspaceStore,
} from './workspaceStore';
import { resetHistory } from './historyStore';

const original = serializeWorkspaceState(useWorkspaceStore.getState());
vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
let stopAutosave: (() => void) | undefined;

beforeEach(() => {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  vi.stubGlobal('localStorage', localStorage);
  vi.stubGlobal('window', { clearTimeout, setTimeout, localStorage });
});

afterEach(() => {
  stopAutosave?.();
  stopAutosave = undefined;
  useStartupScreenStore.getState().close();
  useStartupScreenStore.getState().setPristineStartupProject(null);
  useStartupScreenStore.getState().setBootCreatedProject(null);
  useProjectSetStore.getState().clearProjectSet();
  resetHistory();
  vi.unstubAllGlobals();
  hydrateWorkspaceState(original);
  vi.clearAllTimers();
});

afterAll(() => vi.useRealTimers());

describe('welcome screen preference', () => {
  it('defaults older profiles to showing welcome and round-trips an explicit choice', () => {
    const old = serializeWorkspaceState(useWorkspaceStore.getState());
    delete old.editorPreferences?.showWelcomeOnStartup;
    expect(parseWorkspaceState(old)?.editorPreferences?.showWelcomeOnStartup).toBe(true);

    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: false });
    const saved = serializeWorkspaceState(useWorkspaceStore.getState());
    expect(saved.editorPreferences?.showWelcomeOnStartup).toBe(false);
    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: true });
    hydrateWorkspaceState(saved);
    expect(useWorkspaceStore.getState().editorPreferences.showWelcomeOnStartup).toBe(false);
    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: true });
    expect(useWorkspaceStore.getState().editorPreferences.showWelcomeOnStartup).toBe(true);
  });

  it('waits for profile hydration before deciding about an empty session', async () => {
    useProjectSetStore.getState().clearProjectSet();
    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: true });
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const pending = initializeEditorSession(null, ready);
    await Promise.resolve();
    const standaloneProfile = serializeWorkspaceState(useWorkspaceStore.getState());
    standaloneProfile.editorPreferences!.showWelcomeOnStartup = false;
    hydrateWorkspaceState(standaloneProfile);
    finish();
    await pending;
    expect(useStartupScreenStore.getState().visible).toBe(false);
  });

  it('restores autosaved work regardless of the welcome preference', async () => {
    useProjectSetStore.getState().clearProjectSet();
    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: false });
    const saved = createProject({ name: 'Recovered work' });
    await initializeEditorSession(saved);
    expect(useProjectStore.getState().project.name).toBe('Recovered work');
    expect(useStartupScreenStore.getState().visible).toBe(false);
  });

  it('restores an autosaved template set even when welcome is disabled', async () => {
    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: false });
    const set = createProjectSet('Recovered set', createProject({ name: 'Recovered member' }));
    const activeTemplateId = set.templates[0]!.id;
    expect(await saveProjectSetAutosave({ projectSet: set, activeTemplateId })).toBe(true);
    await initializeEditorSession(null);
    expect(useProjectSetStore.getState().projectSet?.name).toBe('Recovered set');
    expect(useProjectStore.getState().project.name).toBe('Recovered member');
    expect(useStartupScreenStore.getState().visible).toBe(false);
  });

  it('does not autosave the pristine startup blank, so re-enabling welcome works on restart', async () => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    const bootProject = useProjectStore.getState().project;
    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: false });
    await initializeEditorSession(null, Promise.resolve(), bootProject);
    stopAutosave = startAutosave(10);
    await vi.advanceTimersByTimeAsync(20);
    expect(loadAutosave()).toBeNull();

    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: true });
    stopAutosave();
    stopAutosave = undefined;
    await initializeEditorSession(null, Promise.resolve(), bootProject);
    expect(useStartupScreenStore.getState().visible).toBe(true);
  });

  it('does not save the untouched blank when the user opts out from the first welcome screen', async () => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    const bootProject = useProjectStore.getState().project;
    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: true });
    await initializeEditorSession(null, Promise.resolve(), bootProject);
    expect(useStartupScreenStore.getState().visible).toBe(true);
    stopAutosave = startAutosave(10);

    // This is the same change made by the initial welcome checkbox.
    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: false });
    useStartupScreenStore
      .getState()
      .setPristineStartupProject(useStartupScreenStore.getState().bootCreatedProject);
    useProjectStore
      .getState()
      .updateCompositionSettings({ width: 1920, height: 1080, frameRate: 25 });
    useStartupScreenStore.getState().close();
    await vi.advanceTimersByTimeAsync(20);
    expect(loadAutosave()).toBeNull();

    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: true });
    stopAutosave();
    stopAutosave = undefined;
    await initializeEditorSession(null, Promise.resolve(), bootProject);
    expect(useStartupScreenStore.getState().visible).toBe(true);
  });

  it('autosaves and restores an edited project when welcome is disabled', async () => {
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    const bootProject = useProjectStore.getState().project;
    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: false });
    await initializeEditorSession(null, Promise.resolve(), bootProject);
    stopAutosave = startAutosave(10);
    useProjectStore.getState().setProjectMeta({ name: 'My edited graphic' });
    useProjectStore.getState().addLayer('text');
    await vi.advanceTimersByTimeAsync(20);
    const saved = loadAutosave();
    expect(saved?.name).toBe('My edited graphic');
    expect(saved?.compositions[0]?.layers).toHaveLength(1);

    stopAutosave();
    stopAutosave = undefined;
    await initializeEditorSession(saved);
    expect(useProjectStore.getState().project.name).toBe('My edited graphic');
    expect(useProjectStore.getState().project.compositions[0]?.layers).toHaveLength(1);
    expect(useStartupScreenStore.getState().visible).toBe(false);
  });

  it('does not disable explicit new-template or new-set requests', () => {
    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: false });
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().newProject();
    for (const kind of ['new-template', 'new-set'] as const) {
      requestStartupCreation(kind);
      expect(useStartupScreenStore.getState().request?.kind).toBe(kind);
      expect(useStartupScreenStore.getState().visible).toBe(true);
      useStartupScreenStore.getState().close();
    }
    const set = createProjectSet('Set', useProjectStore.getState().project);
    useProjectSetStore.getState().setProjectSet(set);
    useProjectSetStore.getState().setActiveTemplateId(set.templates[0]!.id);
    requestStartupCreation('set-template');
    expect(useStartupScreenStore.getState().request?.kind).toBe('set-template');
    expect(useStartupScreenStore.getState().visible).toBe(true);
  });

  it('reports unavailable browser storage rather than silently claiming persistence', () => {
    vi.stubGlobal('window', {
      clearTimeout,
      setTimeout,
      localStorage: {
        setItem: () => {
          throw new Error('blocked');
        },
      },
    });
    useWorkspaceStore.getState().updateEditorPreferences({ showWelcomeOnStartup: false });
    expect(useWorkspaceStore.getState().editorPreferences.showWelcomeOnStartup).toBe(false);
    expect(useWorkspaceStore.getState().storageError).toMatch(/could not save/i);
  });
});
