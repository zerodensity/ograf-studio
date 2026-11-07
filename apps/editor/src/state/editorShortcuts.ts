import { undo, redo, runDiscreteHistoryStep } from './historyStore';
import { useTimelineStore } from './timelineStore';
import { useProjectStore } from './projectStore';
import { useSelectionStore } from './selectionStore';
import { selectableLayerIds } from './selectAllLayers';
import { isInteractiveShortcutTarget } from './keyboardShortcuts';
import { copyLayers, cutLayers, groupLayers, pasteLayers, ungroupLayers } from './layerCommands';
import { useCropToolStore } from './cropToolStore';

export function duplicateLayerSelection(layerIds: string[]): string[] {
  const state = useProjectStore.getState();
  const composition = state.project.compositions.find(
    (candidate) => candidate.id === state.activeCompositionId,
  );
  if (!composition || !layerIds.some((layerId) => composition.layers.some((l) => l.id === layerId)))
    return [];
  const duplicatedIds = runDiscreteHistoryStep(
    () => state.duplicateLayers(layerIds),
    'Duplicate layers',
  );
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
    const crop = useCropToolStore.getState();
    if (crop.request && !insideModal) {
      if (key === 'escape') {
        e.preventDefault();
        crop.close();
      } else if (
        key === 'enter' &&
        (targetTagName !== 'BUTTON' || target?.getAttribute?.('data-crop-handle'))
      ) {
        e.preventDefault();
        if (crop.request.geometry) crop.apply();
      } else if (!interactiveTarget && !modifier && !e.altKey && key.startsWith('arrow')) {
        e.preventDefault();
        const { draft, pixelSize } = crop.request;
        const step = e.shiftKey ? 10 : 1;
        crop.setDraft({
          ...draft,
          x: Math.max(
            0,
            Math.min(
              1 - draft.width,
              draft.x +
                (key === 'arrowright' ? step : key === 'arrowleft' ? -step : 0) / pixelSize.width,
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              1 - draft.height,
              draft.y +
                (key === 'arrowdown' ? step : key === 'arrowup' ? -step : 0) / pixelSize.height,
            ),
          ),
        });
      } else if (
        !interactiveTarget &&
        (e.code === 'Space' ||
          key === 'delete' ||
          key === 'backspace' ||
          (modifier && ['a', 'c', 'd', 'g', 'v', 'x', 'y', 'z'].includes(key)))
      ) {
        // Crop gestures stay in the draft; scene commands must not alter its frozen targets.
        e.preventDefault();
      }
      return;
    }
    if (
      !modifier &&
      !e.altKey &&
      !e.shiftKey &&
      !e.repeat &&
      key === 'c' &&
      !interactiveTarget &&
      !insideModal
    ) {
      e.preventDefault();
      const ids = useSelectionStore.getState().selectedLayerIds;
      if (ids.length) crop.open(ids);
      else crop.openCanvas();
      return;
    }
    const deselectShortcut =
      modifier &&
      !e.altKey &&
      !e.repeat &&
      key === 'd' &&
      !e.shiftKey &&
      !insideModal &&
      (!interactiveTarget || targetTagName === 'BUTTON');
    if (deselectShortcut) {
      e.preventDefault();
      useSelectionStore.getState().deselectAll();
      return;
    }
    if (
      modifier &&
      !e.altKey &&
      e.shiftKey &&
      !e.repeat &&
      key === 'd' &&
      !insideModal &&
      (!interactiveTarget || toolbarButtonAllowsShortcut)
    ) {
      e.preventDefault();
      duplicateSelectedLayers();
      return;
    }
    if (
      modifier &&
      !e.altKey &&
      (key === 'z' || key === 'y') &&
      (!interactiveTarget || targetTagName === 'BUTTON')
    ) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    if (interactiveTarget) return;
    // Layer clipboard and grouping. Text fields returned above, so they keep native copy/paste,
    // and nothing is prevented when there is nothing to act on.
    if (modifier && !e.altKey && !e.repeat && !insideModal) {
      if (key === 'c' && !e.shiftKey && copyLayers() > 0) return e.preventDefault();
      if (key === 'x' && !e.shiftKey && cutLayers() > 0) return e.preventDefault();
      if (key === 'v' && !e.shiftKey && pasteLayers().length > 0) return e.preventDefault();
      if (key === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupLayers();
        else groupLayers();
        return;
      }
    }
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
  };
  owner.addEventListener('keydown', handleKeyDown);
  return () => owner.removeEventListener('keydown', handleKeyDown);
}
