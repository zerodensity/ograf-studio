import { getElementFill, type Layer, type CornerRadii } from '@ograf-editor/scene-model';
import { getActiveComposition, useProjectStore } from './projectStore';
import { runCoalescedHistoryStep, runDiscreteHistoryStep } from './historyStore';

export function isSharedShape(layer: Layer): boolean {
  return ['rectangle', 'ellipse', 'path'].includes(layer.element.type);
}

/** Change only a named safe scalar; source assets, paint, bindings and tracks stay intact. */
export function applySharedElementScalar(
  ids: string[],
  type: Layer['element']['type'],
  property: string,
  value: string | number | boolean,
): void {
  const state = useProjectStore.getState();
  const targets = getActiveComposition(state.project, state.activeCompositionId).layers.filter(
    (layer) => ids.includes(layer.id) && !layer.isLocked && layer.element.type === type,
  );
  if (!targets.length) return;
  const apply = () => {
    for (const layer of targets)
      useProjectStore.getState().updateLayerElement(layer.id, { [property]: value });
  };
  if (property === 'textColor')
    runCoalescedHistoryStep(apply, `Set ${property} for selected layers`);
  else runDiscreteHistoryStep(apply, `Set ${property} for selected layers`);
}

function shapeTargets(ids: string[]) {
  const state = useProjectStore.getState();
  return getActiveComposition(state.project, state.activeCompositionId).layers.filter(
    (layer) => ids.includes(layer.id) && !layer.isLocked && isSharedShape(layer),
  );
}

export function applySharedShapeColor(ids: string[], frame: number, color: string): void {
  const targets = shapeTargets(ids);
  if (!targets.length || targets.some((layer) => typeof getElementFill(layer.element) !== 'string'))
    return;
  runCoalescedHistoryStep(() => {
    for (const layer of targets)
      useProjectStore.getState().updateLayerPaint(layer.id, frame, color);
  }, 'Set fill for selected shapes');
}

export function applySharedShapeStroke(
  ids: string[],
  property: 'strokeColor' | 'strokeWidth',
  value: string | number,
): void {
  const targets = shapeTargets(ids);
  if (!targets.length) return;
  const apply = () => {
    for (const layer of targets)
      useProjectStore.getState().updateLayerElement(layer.id, { [property]: value });
  };
  if (property === 'strokeColor')
    runCoalescedHistoryStep(apply, 'Set stroke color for selected shapes');
  else runDiscreteHistoryStep(apply, 'Set stroke width for selected shapes');
}

export function applySharedCorner(ids: string[], corner: keyof CornerRadii, value: number): void {
  const targets = shapeTargets(ids).filter((layer) => layer.element.type === 'rectangle');
  if (!targets.length) return;
  runDiscreteHistoryStep(() => {
    for (const layer of targets)
      if (layer.element.type === 'rectangle')
        useProjectStore.getState().updateLayerElement(layer.id, {
          borderRadius: { ...layer.element.borderRadius, [corner]: value },
        });
  }, `Set ${corner} radius for selected rectangles`);
}
