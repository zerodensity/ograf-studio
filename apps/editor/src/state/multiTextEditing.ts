import { getElementFill, type TextElement } from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';
import { runCoalescedHistoryStep, runDiscreteHistoryStep } from './historyStore';

export type SharedTextProperty =
  'fontFamily' | 'fontSize' | 'fontWeight' | 'textAlign' | 'verticalAlign';

/** Use the same designer edit paths as individual objects; never replace runs or animation data. */
export function applySharedTextProperty(
  ids: string[],
  property: SharedTextProperty,
  value: TextElement[SharedTextProperty],
): void {
  const state = useProjectStore.getState();
  const composition = getActiveComposition(state.project, state.activeCompositionId);
  const targets = composition.layers.filter(
    (layer) => ids.includes(layer.id) && !layer.isLocked && layer.element.type === 'text',
  );
  if (!targets.length) return;
  runDiscreteHistoryStep(() => {
    for (const layer of targets)
      useProjectStore.getState().updateLayerElement(layer.id, { [property]: value });
  }, `Set text ${property} for selected layers`);
}

/** Only solid text fills are changed; gradient, shader and media paints remain untouched. */
export function applySharedTextColor(ids: string[], frame: number, color: string): void {
  const state = useProjectStore.getState();
  const composition = getActiveComposition(state.project, state.activeCompositionId);
  const targets = composition.layers.filter(
    (layer) => ids.includes(layer.id) && !layer.isLocked && layer.element.type === 'text',
  );
  if (!targets.length || targets.some((layer) => typeof getElementFill(layer.element) !== 'string'))
    return;
  runCoalescedHistoryStep(() => {
    for (const layer of targets)
      useProjectStore.getState().updateLayerPaint(layer.id, frame, color);
  }, 'Set text color for selected layers');
}
