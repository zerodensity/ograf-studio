import { undo, redo } from './historyStore';
import { useTimelineStore } from './timelineStore';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { selectableLayerIds } from './selectAllLayers';
import { isInteractiveShortcutTarget } from './keyboardShortcuts';

export function installEditorShortcuts(owner: Window) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || isInteractiveShortcutTarget(e.target)) return;
    if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      const { controller, isPlaying } = useTimelineStore.getState();
      if (!controller) return;
      e.preventDefault();
      if (isPlaying) controller.pause();
      else controller.play();
      return;
    }
    const modifier = e.ctrlKey || e.metaKey,
      key = e.key.toLowerCase();
    if (modifier && !e.altKey && key === 'a') {
      e.preventDefault();
      owner.getSelection()?.removeAllRanges();
      const state = useProjectStore.getState();
      const composition = state.project.compositions.find(
        (c) => c.id === state.activeCompositionId,
      );
      useSelectionStore.getState().selectMany(composition ? selectableLayerIds(composition) : []);
      return;
    }
    if (!modifier || (key !== 'z' && key !== 'y')) return;
    e.preventDefault();
    if (key === 'y' || e.shiftKey) redo();
    else undo();
  };
  owner.addEventListener('keydown', handleKeyDown);
  return () => owner.removeEventListener('keydown', handleKeyDown);
}
