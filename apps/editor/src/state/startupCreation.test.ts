import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createComposition,
  createLayerOfKind,
  createProject,
  getTotalFrames,
} from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useProjectSetStore } from './projectSetStore';
import { useSelectionStore } from './selectionStore';
import { useTimelineStore } from './timelineStore';
import { createProjectSet, resolveProjectSetTemplate } from './projectSet';
import { onAirFrame } from './onAirFrame';
import { shouldSuspendAutosave, useStartupScreenStore } from './startupScreenStore';

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
vi.stubGlobal('window', {
  setTimeout: (callback: () => void, timeout?: number) => setTimeout(callback, timeout),
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});
const history = await import('./historyStore');
const { requestStartupCreation, commitStartupCreation, initialStartupSettings } =
  await import('./startupCreation');

const settings = { width: 1080, height: 1920, frameRate: 50 };
const active = () => {
  const state = useProjectStore.getState();
  return state.project.compositions.find(
    (composition) => composition.id === state.activeCompositionId,
  )!;
};

function existingProject() {
  const project = createProject({ name: 'Existing graphic' });
  const composition = project.compositions[0]!;
  composition.width = 1280;
  composition.height = 720;
  composition.frameRate = 25;
  const layer = createLayerOfKind('rectangle');
  layer.name = 'Keep this panel';
  composition.layers.push(layer);
  return project;
}

function existingSet() {
  const project = existingProject();
  const set = createProjectSet('Existing set', project);
  const templateId = set.templates[0]!.id;
  useProjectSetStore.getState().setProjectSet(set);
  useProjectSetStore.getState().setActiveTemplateId(templateId);
  useProjectStore.getState().loadProject(resolveProjectSetTemplate(set, templateId));
  return { set, templateId };
}

describe('in-session new template wizard', () => {
  beforeEach(() => {
    useStartupScreenStore.getState().close();
    useProjectSetStore.getState().clearProjectSet();
    useProjectStore.getState().loadProject(existingProject());
    useSelectionStore.getState().deselectAll();
    history.resetHistory();
  });

  afterAll(() => {
    useStartupScreenStore.getState().close();
    history.resetHistory();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('defaults new documents to Full HD at 50 fps without changing existing settings', () => {
    expect(initialStartupSettings(null)).toEqual({ width: 1920, height: 1080, frameRate: 50 });
    requestStartupCreation('new-template');
    expect(initialStartupSettings(useStartupScreenStore.getState().request)).toEqual({
      width: 1920,
      height: 1080,
      frameRate: 50,
    });
    expect(active()).toMatchObject({ width: 1280, height: 720, frameRate: 25 });
    requestStartupCreation('new-set');
    expect(initialStartupSettings(useStartupScreenStore.getState().request)).toEqual({
      width: 1280,
      height: 720,
      frameRate: 25,
    });
    const { set } = existingSet();
    requestStartupCreation('set-template');
    expect(initialStartupSettings(useStartupScreenStore.getState().request)).toEqual({
      width: set.settings!.width,
      height: set.settings!.height,
      frameRate: set.settings!.frameRate,
    });
  });

  it('suppresses autosave only for the initial empty startup, never for an in-session wizard', () => {
    const base = { projectId: null, compositionId: null, setId: null, activeTemplateId: null };
    expect(shouldSuspendAutosave(null)).toBe(false);
    expect(shouldSuspendAutosave({ ...base, kind: 'startup' })).toBe(true);
    for (const kind of ['new-template', 'new-set', 'set-template', 'second-template'] as const)
      expect(shouldSuspendAutosave({ ...base, kind })).toBe(false);
  });

  it.each(['new-template', 'new-set'] as const)(
    'cancelling %s leaves the project, set, selection and timeline intact',
    (kind) => {
      existingSet();
      const beforeProject = useProjectStore.getState().project;
      const beforeSet = useProjectSetStore.getState().projectSet;
      const panelId = active().layers[0]!.id;
      useSelectionStore.getState().select(panelId);
      useTimelineStore.getState().setCurrentFrame(3);
      requestStartupCreation(kind);
      expect(useStartupScreenStore.getState().visible).toBe(true);
      expect(useProjectStore.getState().project).toBe(beforeProject);
      expect(useProjectSetStore.getState().projectSet).toBe(beforeSet);
      useStartupScreenStore.getState().close();
      expect(useProjectStore.getState().project).toBe(beforeProject);
      expect(useProjectSetStore.getState().projectSet).toBe(beforeSet);
      expect(useSelectionStore.getState().selectedLayerIds).toEqual([panelId]);
      expect(useTimelineStore.getState().currentFrame).toBe(3);
    },
  );

  it('keeps the old document and wizard if the final replace confirmation is declined', () => {
    existingSet();
    const beforeProject = useProjectStore.getState().project;
    const beforeSet = useProjectSetStore.getState().projectSet;
    const confirm = vi.fn(() => false);
    requestStartupCreation('new-template');
    expect(commitStartupCreation(settings, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(useStartupScreenStore.getState().visible).toBe(true);
    expect(useProjectStore.getState().project).toBe(beforeProject);
    expect(useProjectSetStore.getState().projectSet).toBe(beforeSet);
  });

  it('rejects invalid settings before changing the active project', () => {
    const before = useProjectStore.getState().project;
    const confirm = vi.fn(() => true);
    requestStartupCreation('new-template');
    expect(() => commitStartupCreation({ ...settings, width: 0 }, confirm)).toThrow();
    expect(confirm).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project).toBe(before);
    expect(useStartupScreenStore.getState().visible).toBe(true);
  });

  it('creates a new blank template with selected settings and a frame-zero playhead', () => {
    existingSet();
    const beforeId = useProjectStore.getState().project.id;
    requestStartupCreation('new-template');
    expect(commitStartupCreation(settings, () => true)).toBe(true);
    expect(useProjectSetStore.getState().projectSet).toBeNull();
    expect(useProjectStore.getState().project.id).not.toBe(beforeId);
    expect(active()).toMatchObject(settings);
    expect(active().layers).toHaveLength(0);
    expect(getTotalFrames(active()) / active().frameRate).toBeGreaterThanOrEqual(5);
    expect(useTimelineStore.getState().currentFrame).toBe(0);
    expect(onAirFrame(active())).toBeGreaterThan(0);
  });

  it('cancels adding a new second template without converting or changing the original', () => {
    const original = useProjectStore.getState().project;
    const layerId = active().layers[0]!.id;
    useSelectionStore.getState().select(layerId);
    requestStartupCreation('second-template');
    expect(useProjectSetStore.getState().projectSet).toBeNull();
    useStartupScreenStore.getState().close();
    expect(useProjectStore.getState().project).toBe(original);
    expect(useProjectSetStore.getState().projectSet).toBeNull();
    expect(useSelectionStore.getState().selectedLayerIds).toEqual([layerId]);
  });

  it('promotes the first graphic on creating a second and retains chosen child settings', () => {
    const original = structuredClone(useProjectStore.getState().project);
    const confirm = vi.fn(() => true);
    requestStartupCreation('second-template');
    expect(commitStartupCreation(settings, confirm)).toBe(true);
    const set = useProjectSetStore.getState().projectSet!;
    expect(confirm).not.toHaveBeenCalled();
    expect(set.templates).toHaveLength(2);
    expect(set.templates[0]!.project.id).toBe(original.id);
    expect(resolveProjectSetTemplate(set, set.templates[0]!.id).compositions[0]!.layers).toEqual(
      original.compositions[0]!.layers,
    );
    expect(useProjectSetStore.getState().activeTemplateId).toBe(set.templates[1]!.id);
    expect(active()).toMatchObject(settings);
    expect(active().layers).toHaveLength(0);
    expect(useTimelineStore.getState().currentFrame).toBe(0);
    expect(resolveProjectSetTemplate(set, set.templates[1]!.id).compositions[0]).toMatchObject(
      settings,
    );
    useProjectStore.getState().addLowerThird();
    expect(active().layers.length).toBeGreaterThan(0);
    expect(resolveProjectSetTemplate(set, set.templates[0]!.id).compositions[0]!.layers).toEqual(
      original.compositions[0]!.layers,
    );
  });

  it('does not promote a different document if the active document changes while the wizard is open', () => {
    requestStartupCreation('second-template');
    useProjectStore.getState().loadProject(createProject({ name: 'Different graphic' }));
    expect(() => commitStartupCreation(settings, () => true)).toThrow('changed');
    expect(useProjectSetStore.getState().projectSet).toBeNull();
    expect(useProjectStore.getState().project.name).toBe('Different graphic');
  });

  it('makes second-template creation one undoable and redoable operation', () => {
    history.runDiscreteHistoryStep(() => {
      useProjectStore.getState().setProjectMeta({ name: 'Edited original' });
    }, 'Rename original');
    const original = structuredClone(useProjectStore.getState().project);
    const previousHistory = history.getHistorySnapshot().past.length;
    requestStartupCreation('second-template');
    commitStartupCreation(settings, () => true);
    const newProject = structuredClone(useProjectStore.getState().project);
    const newSet = structuredClone(useProjectSetStore.getState().projectSet!);
    expect(history.getHistorySnapshot().past).toHaveLength(previousHistory + 1);
    expect(history.getHistorySnapshot().past.at(-1)?.label).toBe('Create template set');

    history.undo();
    expect(useProjectSetStore.getState().projectSet).toBeNull();
    expect(useProjectStore.getState().project).toEqual(original);
    expect(history.getHistorySnapshot().past).toHaveLength(previousHistory);
    history.redo();
    expect(useProjectStore.getState().project).toEqual(newProject);
    expect(useProjectSetStore.getState().projectSet).toEqual(newSet);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(newSet.activeTemplateId);
  });

  it('restores fresh blank recipe timing and playhead after undo and redo of promotion', () => {
    useProjectStore.getState().newProject();
    history.resetHistory();
    useSelectionStore.getState().select(null);
    const originalFrame = useTimelineStore.getState().currentFrame;
    requestStartupCreation('second-template');
    commitStartupCreation(settings, () => true);
    const secondFrame = useTimelineStore.getState().currentFrame;
    history.undo();
    expect(useProjectSetStore.getState().projectSet).toBeNull();
    expect(useTimelineStore.getState().currentFrame).toBe(originalFrame);
    history.redo();
    expect(useTimelineStore.getState().currentFrame).toBe(secondFrame);
    history.undo();
    useProjectStore.getState().addLowerThird();
    expect(getTotalFrames(active()) / active().frameRate).toBeLessThan(5);
  });

  it('keeps the new child fresh for recipe creation after redoing promotion', () => {
    useProjectStore.getState().newProject();
    history.resetHistory();
    useSelectionStore.getState().select(null);
    requestStartupCreation('second-template');
    commitStartupCreation(settings, () => true);
    history.undo();
    history.redo();
    useProjectStore.getState().addLowerThird();
    expect(getTotalFrames(active()) / active().frameRate).toBeLessThan(5);
    expect(useProjectSetStore.getState().projectSet?.templates).toHaveLength(2);
  });

  it('rolls back the project, selection, timeline and history if loading the new template fails', () => {
    history.runDiscreteHistoryStep(() => {
      useProjectStore.getState().setProjectMeta({ name: 'Edited original' });
    }, 'Rename original');
    const original = useProjectStore.getState().project;
    const layerId = active().layers[0]!.id;
    useSelectionStore.getState().select(layerId);
    useTimelineStore.getState().setCurrentFrame(3);
    const historyBefore = structuredClone(history.getHistorySnapshot());
    requestStartupCreation('second-template');
    const loader = vi
      .spyOn(useProjectStore.getState(), 'loadProject')
      .mockImplementation((next) => {
        useProjectStore.setState({ project: next });
        useSelectionStore.getState().deselectAll();
        useTimelineStore.getState().setCurrentFrame(0);
        throw new Error('Simulated load failure');
      });
    try {
      expect(() => commitStartupCreation(settings, () => true)).toThrow('Simulated load failure');
      expect(useProjectStore.getState().project).toBe(original);
      expect(useProjectSetStore.getState().projectSet).toBeNull();
      expect(useSelectionStore.getState().selectedLayerIds).toEqual([layerId]);
      expect(useTimelineStore.getState().currentFrame).toBe(3);
      expect(history.getHistorySnapshot()).toEqual(historyBefore);
      expect(useStartupScreenStore.getState().visible).toBe(true);
    } finally {
      loader.mockRestore();
    }
  });

  it('retains the first blank template’s fresh-recipe timing after a failed activation', () => {
    useProjectStore.getState().newProject();
    history.resetHistory();
    const initialId = useProjectStore.getState().project.id;
    useTimelineStore.getState().setController({
      stop: () => {
        throw new Error('Simulated controller failure');
      },
      seek: () => {},
      play: () => {},
      pause: () => {},
    });
    requestStartupCreation('second-template');
    expect(() => commitStartupCreation(settings, () => true)).toThrow(
      'Simulated controller failure',
    );
    expect(useProjectStore.getState().project.id).toBe(initialId);
    expect(useProjectSetStore.getState().projectSet).toBeNull();
    useTimelineStore.getState().setController(null);
    useProjectStore.getState().addLowerThird();
    expect(getTotalFrames(active()) / active().frameRate).toBeLessThan(5);
  });

  it('preserves redo history when second-template activation fails', () => {
    history.runDiscreteHistoryStep(() => {
      useProjectStore.getState().setProjectMeta({ name: 'First edit' });
    }, 'First edit');
    history.runDiscreteHistoryStep(() => {
      useProjectStore.getState().setProjectMeta({ name: 'Second edit' });
    }, 'Second edit');
    useSelectionStore.getState().select(null);
    history.undo();
    expect(history.getHistorySnapshot().canRedo).toBe(true);
    const before = structuredClone(history.getHistorySnapshot());
    requestStartupCreation('second-template');
    const loader = vi
      .spyOn(useProjectStore.getState(), 'loadProject')
      .mockImplementation((next) => {
        useProjectStore.setState({ project: next });
        throw new Error('Simulated load failure');
      });
    try {
      expect(() => commitStartupCreation(settings, () => true)).toThrow('Simulated load failure');
      expect(history.getHistorySnapshot()).toEqual(before);
      history.redo();
      expect(useProjectStore.getState().project.name).toBe('Second edit');
    } finally {
      loader.mockRestore();
    }
  });

  it('creates a set from the existing graphic without dropping its authored layers', () => {
    const beforeProject = structuredClone(useProjectStore.getState().project);
    requestStartupCreation('new-set');
    expect(commitStartupCreation(settings, () => true)).toBe(true);
    const set = useProjectSetStore.getState().projectSet!;
    expect(set.templates).toHaveLength(1);
    expect(set.settings).toMatchObject(settings);
    const saved = resolveProjectSetTemplate(set, set.templates[0]!.id);
    expect(saved.compositions[0]).toMatchObject(settings);
    expect(saved.compositions[0]!.layers.map((layer) => layer.id)).toEqual(
      beforeProject.compositions[0]!.layers.map((layer) => layer.id),
    );
    expect(useProjectStore.getState().project.compositions[0]).toMatchObject(settings);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(set.templates[0]!.id);
  });

  it('keeps existing layers, animation tracks and timing when set settings do not change', () => {
    const before = structuredClone(active());
    const beforeProject = useProjectStore.getState().project;
    const confirm = vi.fn(() => true);
    requestStartupCreation('new-set');
    expect(
      commitStartupCreation(
        { width: before.width, height: before.height, frameRate: before.frameRate },
        confirm,
      ),
    ).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project).toBe(beforeProject);
    const set = useProjectSetStore.getState().projectSet!;
    const saved = resolveProjectSetTemplate(set, set.templates[0]!.id).compositions[0]!;
    expect(saved.layers).toEqual(before.layers);
    expect(saved.keyframes).toEqual(before.keyframes);
    expect(saved.transitions).toEqual(before.transitions);
  });

  it('keeps same-document edits made while the wizard is open when creating a set', () => {
    requestStartupCreation('new-set');
    useProjectStore.getState().setProjectMeta({ name: 'Edited while choosing settings' });
    expect(commitStartupCreation(settings, () => true)).toBe(true);
    const set = useProjectSetStore.getState().projectSet!;
    expect(set.templates[0]!.project.name).toBe('Edited while choosing settings');
    expect(set.templates[0]!.project.compositions[0]!.layers).toHaveLength(1);
  });

  it('does not change the previous set while creating another set from its active template', () => {
    const { set } = existingSet();
    const oldSnapshot = structuredClone(set);
    requestStartupCreation('new-set');
    expect(commitStartupCreation(settings, () => true)).toBe(true);
    expect(set).toEqual(oldSnapshot);
    expect(useProjectSetStore.getState().projectSet?.id).not.toBe(set.id);
  });

  it('uses the active composition for set defaults without changing a different main composition', () => {
    const project = existingProject();
    const secondary = createComposition({
      name: 'Secondary',
      width: 1024,
      height: 576,
      frameRate: 30,
    });
    secondary.layers.push(createLayerOfKind('ellipse'));
    project.compositions.push(secondary);
    useProjectStore.getState().loadProject(project);
    const main = structuredClone(useProjectStore.getState().project.compositions[0]!);
    useProjectStore.getState().setActiveComposition(secondary.id);

    requestStartupCreation('new-set');
    expect(commitStartupCreation(settings, () => true)).toBe(true);
    const set = useProjectSetStore.getState().projectSet!;
    const resolved = resolveProjectSetTemplate(set, set.templates[0]!.id);
    expect(set.settings).toMatchObject(settings);
    expect(resolved.compositions.find((composition) => composition.id === main.id)).toEqual(main);
    expect(
      resolved.compositions.find((composition) => composition.id === secondary.id),
    ).toMatchObject(settings);
    expect(useProjectStore.getState().activeCompositionId).toBe(secondary.id);
    expect(active()).toMatchObject(settings);
  });

  it('does not replace a different document opened while the wizard was visible', () => {
    requestStartupCreation('new-template');
    const replacement = createProject({ name: 'Opened while wizard was visible' });
    useProjectStore.getState().loadProject(replacement);
    const current = useProjectStore.getState().project;
    expect(() => commitStartupCreation(settings, () => true)).toThrow();
    expect(useProjectStore.getState().project).toBe(current);
    expect(useProjectStore.getState().project.name).toBe(replacement.name);
  });

  it('inserts a new template at the requested position with its custom settings', () => {
    const { templateId } = existingSet();
    requestStartupCreation('set-template', templateId, 'before');
    expect(commitStartupCreation(settings, () => true)).toBe(true);
    const set = useProjectSetStore.getState().projectSet!;
    expect(set.templates).toHaveLength(2);
    expect(set.templates[1]!.id).toBe(templateId);
    expect(useProjectSetStore.getState().activeTemplateId).toBe(set.templates[0]!.id);
    expect(resolveProjectSetTemplate(set, set.templates[0]!.id).compositions[0]).toMatchObject(
      settings,
    );
    expect(useProjectStore.getState().project.compositions[0]).toMatchObject(settings);
    expect(getTotalFrames(active()) / active().frameRate).toBeGreaterThanOrEqual(5);
    expect(useTimelineStore.getState().currentFrame).toBe(0);
    expect(resolveProjectSetTemplate(set, templateId).compositions[0]).toMatchObject({
      width: 1280,
      height: 720,
      frameRate: 25,
    });
  });
});
