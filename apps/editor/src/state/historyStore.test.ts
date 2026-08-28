import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from './projectStore';
import { createProject } from '@ograf-editor/scene-model';

vi.useFakeTimers();
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});

const history = await import('./historyStore');

describe('editor history store', () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    history.resetHistory();
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('publishes pending history immediately and supports undo and redo', () => {
    const originalName = useProjectStore.getState().project.name;
    useProjectStore.getState().setProjectMeta({ name: 'Renamed package' });

    expect(history.getHistorySnapshot()).toMatchObject({
      canUndo: true,
      canRedo: false,
      past: [{ label: 'Rename project to “Renamed package”' }],
    });

    history.undo();
    expect(useProjectStore.getState().project.name).toBe(originalName);
    expect(history.getHistorySnapshot()).toMatchObject({ canUndo: false, canRedo: true });

    history.redo();
    expect(useProjectStore.getState().project.name).toBe('Renamed package');
    expect(history.getHistorySnapshot()).toMatchObject({ canUndo: true, canRedo: false });
  });

  it('jumps across multiple displayed actions', () => {
    useProjectStore.getState().setProjectMeta({ name: 'First name' });
    vi.advanceTimersByTime(600);
    useProjectStore.getState().setProjectMeta({ name: 'Second name' });
    vi.advanceTimersByTime(600);

    expect(history.getHistorySnapshot().past).toHaveLength(2);
    history.undo(2);
    expect(useProjectStore.getState().project.name).toBe('Untitled Template');
    expect(history.getHistorySnapshot().future).toHaveLength(2);

    history.redo(2);
    expect(useProjectStore.getState().project.name).toBe('Second name');
    expect(history.getHistorySnapshot().past).toHaveLength(2);
  });

  it('reconciles the active composition when undo restores another project snapshot', () => {
    const original = useProjectStore.getState().project;
    const replacement = createProject();
    useProjectStore.setState({
      project: replacement,
      activeCompositionId: replacement.mainCompositionId,
      activeKeyframeId: replacement.compositions[0]!.keyframes[0]!.id,
    });

    history.undo();

    expect(useProjectStore.getState().project.id).toBe(original.id);
    expect(useProjectStore.getState().activeCompositionId).toBe(original.mainCompositionId);
  });
});
