import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { useProjectSetStore } from './projectSetStore';
import { createProject, createRectangleLayer } from '@ograf-editor/scene-model';

vi.useFakeTimers();
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});

const history = await import('./historyStore');

describe('editor history store', () => {
  it('records a ten-action accepted proposal immediately, separate from a pending manual edit', () => {
    useProjectStore.getState().setProjectMeta({ name: 'Manual name' });
    const before = useProjectStore.getState().project;
    const after = structuredClone(before);
    after.compositions[0]!.layers.push(...Array.from({ length: 10 }, () => createRectangleLayer()));
    history.applyRemoteProjectUpdate(after, {
      source: 'agent',
      reason: 'Accepted proposal: Four area corrections',
      summary: { operationCount: 10, operationTypes: ['add_layer'] },
    });
    expect(history.getHistorySnapshot().past.map((item) => item.label)).toEqual([
      'Rename project to “Manual name”',
      'AI: Four area corrections (10 actions)',
    ]);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(before);
    history.undo();
    expect(useProjectStore.getState().project.name).toBe('Untitled Template');
    history.redo(2);
    expect(useProjectStore.getState().project).toEqual(after);
  });

  it('keeps edits made immediately after an AI batch in their own undo step', () => {
    const before = useProjectStore.getState().project;
    const after = { ...before, name: 'AI name' };
    history.applyRemoteProjectUpdate(after, {
      source: 'agent',
      reason: 'Accepted proposal: Rename',
      summary: { operationCount: 1 },
    });
    useProjectStore.getState().setProjectMeta({ description: 'Manual description' });
    expect(history.getHistorySnapshot().past).toHaveLength(2);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(after);
    history.undo();
    expect(useProjectStore.getState().project).toEqual(before);
  });

  it('moves the existing entry for server undo/redo instead of recording an inverse edit', () => {
    const before = useProjectStore.getState().project;
    const after = { ...before, name: 'AI name' };
    history.applyRemoteProjectUpdate(after, {
      source: 'agent',
      reason: 'Accepted proposal: Rename',
    });
    history.applyRemoteProjectUpdate(structuredClone(before), { source: 'undo' });
    expect(history.getHistorySnapshot()).toMatchObject({ past: [], canRedo: true });
    history.applyRemoteProjectUpdate(structuredClone(after), { source: 'redo' });
    expect(history.getHistorySnapshot()).toMatchObject({
      past: [{ label: 'AI: Rename' }],
      future: [],
    });
  });

  it('preserves history on duplicate synchronization and resets it for a different project', () => {
    useProjectStore.getState().setProjectMeta({ name: 'Manual edit' });
    history.applyRemoteProjectUpdate(structuredClone(useProjectStore.getState().project), {
      source: 'system',
    });
    expect(history.getHistorySnapshot().past).toHaveLength(1);
    history.undo();
    history.applyRemoteProjectUpdate(structuredClone(useProjectStore.getState().project), {
      source: 'system',
    });
    expect(history.getHistorySnapshot().canRedo).toBe(true);
    history.applyRemoteProjectUpdate(createProject(), { source: 'system' });
    expect(history.getHistorySnapshot()).toMatchObject({
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
    });
  });
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

  it('undoes explicit property enabling and playhead edits without restoring implicit lifecycle keys', () => {
    const id = useProjectStore.getState().addLayer('rectangle');
    const layer = () =>
      useProjectStore.getState().project.compositions[0]!.layers.find((item) => item.id === id)!;
    history.resetHistory();
    history.runDiscreteHistoryStep(
      () => useProjectStore.getState().enableLayerPropertyAnimation(id, 'x', 0),
      'Animate Position X',
    );
    history.runDiscreteHistoryStep(
      () => useProjectStore.getState().updateLayerTransform(id, 8, { x: 500 }),
      'Key Position X',
    );
    expect(layer().animationTracks.x?.map((key) => key.frame)).toEqual([0, 8]);
    history.undo();
    expect(layer().animationTracks.x?.map((key) => key.frame)).toEqual([0]);
    history.undo();
    expect(layer().animationTracks).toEqual({});
    expect(layer().keyframes.map((key) => key.frame)).toEqual([0]);
    history.redo(2);
    expect(layer().animationTracks.x?.map(({ frame, value }) => ({ frame, value }))).toEqual([
      { frame: 0, value: 100 },
      { frame: 8, value: 500 },
    ]);
  });

  it('restores the original selection in one undo after repeating', () => {
    const source = useProjectStore.getState().addLayer('rectangle');
    useSelectionStore.getState().select(source);
    history.resetHistory();
    history.runDiscreteHistoryStep(() => {
      const result = useProjectStore.getState().addRepeater([source], 3, 'horizontal', 24)!;
      useSelectionStore
        .getState()
        .selectMany(result.items.flatMap((item) => Object.values(item.layers)));
    }, 'Repeat selection');
    expect(useProjectStore.getState().project.compositions[0]!.layers).toHaveLength(3);
    expect(history.getHistorySnapshot().past.at(-1)?.label).toBe('Repeat selection');
    history.undo();
    expect(useProjectStore.getState().project.compositions[0]!.layers).toHaveLength(1);
    expect(useSelectionStore.getState().selectedLayerIds).toEqual([source]);
    history.redo();
    expect(useProjectStore.getState().project.compositions[0]!.layers).toHaveLength(3);
    expect(useSelectionStore.getState().selectedLayerIds).toHaveLength(3);
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

  it('jumps to the state after a named action and forward again, even with selection undo pending', () => {
    const original = useProjectStore.getState().project;
    let id = '';
    history.runDiscreteHistoryStep(() => {
      id = useProjectStore.getState().addLayer('text');
    }, 'Add Text');
    history.runDiscreteHistoryStep(
      () => useProjectStore.getState().updateLayerTransform(id, 0, { x: 345, y: 234 }),
      'Move Text',
    );
    useSelectionStore.getState().select(id);
    history.runDiscreteHistoryStep(() => {
      const result = useProjectStore.getState().addRepeater([id], 3, 'horizontal', 24)!;
      useSelectionStore
        .getState()
        .selectMany(result.items.flatMap((item) => Object.values(item.layers)));
    }, 'Repeat selection');
    expect(history.getHistorySnapshot().past.map((item) => item.label)).toEqual([
      'Add Text',
      'Move Text',
      'Repeat selection',
    ]);
    history.jumpToHistoryPosition(1);
    expect(useProjectStore.getState().project.compositions[0]!.layers).toHaveLength(1);
    expect(history.getHistorySnapshot()).toMatchObject({
      past: [{ label: 'Add Text' }],
      future: [{ label: 'Move Text' }, { label: 'Repeat selection' }],
    });
    history.jumpToHistoryPosition(3);
    expect(useProjectStore.getState().project.compositions[0]!.layers).toHaveLength(3);
    history.jumpToHistoryPosition(0);
    expect(useProjectStore.getState().project).toEqual(original);
  });

  it('records the next project edit after jumping over a set-only change', () => {
    useProjectSetStore.getState().setActiveTemplateId('test-template');
    history.jumpToHistoryPosition(0);
    expect(useProjectSetStore.getState().activeTemplateId).toBeNull();
    useProjectStore.getState().setProjectMeta({ name: 'After set change' });
    expect(history.getHistorySnapshot().past.at(-1)?.label).toBe(
      'Rename project to “After set change”',
    );
    expect(history.getHistorySnapshot().future).toHaveLength(0);
    useProjectSetStore.getState().clearProjectSet();
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
