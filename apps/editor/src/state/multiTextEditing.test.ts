import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { createDefaultGradient, getElementFill } from '@ograf-editor/scene-model';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { resetHistory, getHistorySnapshot, undo } from './historyStore';
import { applySharedTextColor, applySharedTextProperty } from './multiTextEditing';

vi.useFakeTimers();
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
});

describe('homogeneous multi-selection text edits', () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useSelectionStore.getState().select(null);
    resetHistory();
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('updates unlocked text in one undo step and preserves bindings and animation tracks', () => {
    const store = useProjectStore.getState();
    const first = store.addLayer('text'),
      second = store.addLayer('text'),
      locked = store.addLayer('text');
    const field = store.addDataField('text');
    store.setLayerBindings(first, [{ fieldId: field, targetProperty: 'content' }]);
    store.toggleLayerLock(locked);
    const before = structuredClone(useProjectStore.getState().project);
    resetHistory();
    applySharedTextProperty([first, second, locked], 'fontSize', 72);
    const after = useProjectStore.getState().project;
    const layers = after.compositions[0]!.layers;
    expect(layers[0]!.element).toMatchObject({ type: 'text', fontSize: 72 });
    expect(layers[1]!.element).toMatchObject({ type: 'text', fontSize: 72 });
    expect(layers[2]!.element).toEqual(before.compositions[0]!.layers[2]!.element);
    expect(layers[0]!.bindings).toEqual(before.compositions[0]!.layers[0]!.bindings);
    expect(layers[0]!.animationTracks).toEqual(before.compositions[0]!.layers[0]!.animationTracks);
    expect(getHistorySnapshot().past.map((item) => item.label)).toEqual([
      'Set text fontSize for selected layers',
    ]);
    undo();
    expect(useProjectStore.getState().project).toEqual(before);
  });

  it('coalesces color dragging into one named undo and skips locked text', () => {
    const store = useProjectStore.getState();
    const first = store.addLayer('text'),
      second = store.addLayer('text'),
      locked = store.addLayer('text');
    store.toggleLayerLock(locked);
    const before = structuredClone(useProjectStore.getState().project);
    resetHistory();
    applySharedTextColor([first, second, locked], 0, '#ff0000');
    applySharedTextColor([first, second, locked], 0, '#00ff00');
    const layers = useProjectStore.getState().project.compositions[0]!.layers;
    expect(getElementFill(layers[0]!.element)).toBe('#00ff00');
    expect(getElementFill(layers[1]!.element)).toBe('#00ff00');
    expect(layers[2]!.element).toEqual(before.compositions[0]!.layers[2]!.element);
    expect(getHistorySnapshot().past.map((item) => item.label)).toEqual([
      'Set text color for selected layers',
    ]);
    vi.advanceTimersByTime(600);
    undo();
    expect(useProjectStore.getState().project).toEqual(before);
  });

  it('does not replace a gradient, shader or media text fill through the shared solid-color control', () => {
    const store = useProjectStore.getState();
    const first = store.addLayer('text'),
      second = store.addLayer('text');
    store.updateLayerPaint(first, 0, createDefaultGradient());
    const before = structuredClone(useProjectStore.getState().project);
    resetHistory();
    applySharedTextColor([first, second], 0, '#ff0000');
    expect(useProjectStore.getState().project).toEqual(before);
    expect(getHistorySnapshot().past).toHaveLength(0);
  });
});
