import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLayerTransformAtFrame } from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { useLayerClipboardStore } from './layerClipboardStore';

vi.useFakeTimers();
vi.stubGlobal('window', {
  clearTimeout: (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
});

const { installEditorShortcuts } = await import('./editorShortcuts');
const { resetHistory, undo } = await import('./historyStore');

class ShortcutWindow {
  keydown: ((event: KeyboardEvent) => void) | null = null;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === 'keydown') this.keydown = listener as (event: KeyboardEvent) => void;
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === 'keydown' && this.keydown === listener) this.keydown = null;
  }

  getSelection() {
    return { removeAllRanges: vi.fn() };
  }

  dispatch(patch: Omit<Partial<KeyboardEvent>, 'target'> & { target?: unknown } = {}) {
    const preventDefault = vi.fn();
    this.keydown?.({
      key: 'd',
      code: 'KeyD',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      defaultPrevented: false,
      target: { tagName: 'DIV' },
      preventDefault,
      ...patch,
    } as unknown as KeyboardEvent);
    return preventDefault;
  }
}

function activeComposition() {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId);
}

describe('editor duplicate shortcut', () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useSelectionStore.getState().select(null);
    useLayerClipboardStore.getState().copy([]);
    resetHistory();
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ['Ctrl', { ctrlKey: true, metaKey: false }],
    ['Command', { ctrlKey: false, metaKey: true }],
  ])('duplicates the current selection in place with %s+D', (_label, modifier) => {
    const sourceId = useProjectStore.getState().addLayer('rectangle');
    useProjectStore.getState().updateLayerTransform(sourceId, 7, { x: 345, y: 217 });
    const source = activeComposition().layers.find((layer) => layer.id === sourceId)!;
    useSelectionStore.getState().select(sourceId);
    useLayerClipboardStore.getState().copy([source]);
    const clipboardBefore = structuredClone(useLayerClipboardStore.getState().layers);
    const owner = new ShortcutWindow();
    const uninstall = installEditorShortcuts(owner as unknown as Window);

    const preventDefault = owner.dispatch(modifier);
    const composition = activeComposition();
    const copy = composition.layers[1]!;

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(composition.layers).toHaveLength(2);
    expect(getLayerTransformAtFrame(copy, 7)).toEqual(getLayerTransformAtFrame(source, 7));
    expect(useSelectionStore.getState().selectedLayerIds).toEqual([copy.id]);
    expect(useLayerClipboardStore.getState().layers).toEqual(clipboardBefore);
    uninstall();
  });

  it('duplicates after an add-toolbar click leaves focus on its button', () => {
    const sourceId = useProjectStore.getState().addLayer('rectangle');
    useSelectionStore.getState().select(sourceId);
    const owner = new ShortcutWindow();
    const uninstall = installEditorShortcuts(owner as unknown as Window);

    const preventDefault = owner.dispatch({
      target: {
        tagName: 'BUTTON',
        getAttribute: (name: string) => (name === 'data-editor-shortcuts' ? 'allow' : null),
      },
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(activeComposition().layers).toHaveLength(2);
    uninstall();
  });

  it('keeps each Duplicate command in its own undo step and clears removed selections', () => {
    const sourceId = useProjectStore.getState().addLayer('rectangle');
    useSelectionStore.getState().select(sourceId);
    const owner = new ShortcutWindow();
    const uninstall = installEditorShortcuts(owner as unknown as Window);

    owner.dispatch();
    owner.dispatch();
    expect(activeComposition().layers).toHaveLength(3);

    undo();
    expect(activeComposition().layers).toHaveLength(2);
    expect(useSelectionStore.getState().selectedLayerIds).toEqual([]);
    undo();
    expect(activeComposition().layers).toHaveLength(1);
    uninstall();
  });

  it('ignores editable targets, modified/repeated keys, and stale selections', () => {
    const sourceId = useProjectStore.getState().addLayer('rectangle');
    useSelectionStore.getState().select(sourceId);
    const owner = new ShortcutWindow();
    const uninstall = installEditorShortcuts(owner as unknown as Window);
    const ignored = [
      { target: { tagName: 'INPUT' } },
      { target: { isContentEditable: true } },
      { repeat: true },
      { altKey: true },
      { shiftKey: true },
      { ctrlKey: false, metaKey: false },
    ];

    for (const patch of ignored) expect(owner.dispatch(patch)).not.toHaveBeenCalled();
    useSelectionStore.getState().select('missing-layer');
    expect(owner.dispatch()).toHaveBeenCalledOnce();
    expect(activeComposition().layers).toHaveLength(1);
    uninstall();
  });

  it('does not duplicate through a modal dialog', () => {
    const sourceId = useProjectStore.getState().addLayer('rectangle');
    useSelectionStore.getState().select(sourceId);
    const owner = new ShortcutWindow();
    const uninstall = installEditorShortcuts(owner as unknown as Window);

    const preventDefault = owner.dispatch({
      target: { tagName: 'DIV', closest: () => ({ role: 'dialog' }) },
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(activeComposition().layers).toHaveLength(1);
    uninstall();
  });
});
