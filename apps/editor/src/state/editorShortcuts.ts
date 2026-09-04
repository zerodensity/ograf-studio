import { undo, redo, runDiscreteHistoryStep } from './historyStore';
import { useTimelineStore } from './timelineStore';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { selectableLayerIds } from './selectAllLayers';
import { isInteractiveShortcutTarget } from './keyboardShortcuts';

export function duplicateLayerSelection(layerIds: string[]): string[] {
  const state = useProjectStore.getState();
  const composition = state.project.compositions.find(
    (candidate) => candidate.id === state.activeCompositionId,
  );
  if (!composition || !layerIds.some((layerId) => composition.layers.some((l) => l.id === layerId)))
    return [];
  const duplicatedIds = runDiscreteHistoryStep(() => state.duplicateLayers(layerIds));
  if (duplicatedIds.length > 0) useSelectionStore.getState().selectMany(duplicatedIds);
  return duplicatedIds;
}

export function duplicateSelectedLayers(): string[] {
  return duplicateLayerSelection(useSelectionStore.getState().selectedLayerIds);
}

export function installEditorShortcuts(owner: Window) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const modifier = e.ctrlKey || e.metaKey,
      key = e.key.toLowerCase();
    const interactiveTarget = isInteractiveShortcutTarget(e.target);
    const target = e.target as {
      tagName?: string;
      getAttribute?: (name: string) => string | null;
      closest?: (selector: string) => unknown;
    } | null;
    const targetTagName = target?.tagName?.toUpperCase();
    const toolbarButtonAllowsShortcut =
      targetTagName === 'BUTTON' && target?.getAttribute?.('data-editor-shortcuts') === 'allow';
    const insideModal = Boolean(target?.closest?.('[role="dialog"], dialog, [aria-modal="true"]'));
    if (
      modifier &&
      !e.altKey &&
      !e.shiftKey &&
      !e.repeat &&
      key === 'd' &&
      !insideModal &&
      (!interactiveTarget || toolbarButtonAllowsShortcut)
    ) {
      e.preventDefault();
      duplicateSelectedLayers();
      return;
    }
    if (interactiveTarget) return;
    if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      const { controller, isPlaying } = useTimelineStore.getState();
      if (!controller) return;
      e.preventDefault();
      if (isPlaying) controller.pause();
      else controller.play();
      return;
    }
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
