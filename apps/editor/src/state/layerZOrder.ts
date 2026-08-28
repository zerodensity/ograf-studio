export function moveLayerToZOrder(
  orderedLayerIds: string[],
  layerId: string,
  zOrder: number,
): string[] {
  const currentIndex = orderedLayerIds.indexOf(layerId);
  if (currentIndex < 0 || orderedLayerIds.length === 0) return [...orderedLayerIds];

  const targetIndex = Math.max(0, Math.min(orderedLayerIds.length - 1, Math.round(zOrder) - 1));
  if (targetIndex === currentIndex) return [...orderedLayerIds];

  const next = [...orderedLayerIds];
  const movedLayerId = next.splice(currentIndex, 1)[0]!;
  next.splice(targetIndex, 0, movedLayerId);
  return next;
}

export type LayerArrangeAction =
  'send-to-back' | 'send-backward' | 'bring-forward' | 'bring-to-front';

export function arrangeSelectedLayers(
  orderedLayerIds: string[],
  selectedLayerIds: string[],
  action: LayerArrangeAction,
): string[] {
  const selected = new Set(selectedLayerIds.filter((layerId) => orderedLayerIds.includes(layerId)));
  if (selected.size === 0) return [...orderedLayerIds];

  if (action === 'send-to-back') {
    return [
      ...orderedLayerIds.filter((layerId) => selected.has(layerId)),
      ...orderedLayerIds.filter((layerId) => !selected.has(layerId)),
    ];
  }

  if (action === 'bring-to-front') {
    return [
      ...orderedLayerIds.filter((layerId) => !selected.has(layerId)),
      ...orderedLayerIds.filter((layerId) => selected.has(layerId)),
    ];
  }

  const next = [...orderedLayerIds];
  if (action === 'send-backward') {
    for (let index = 1; index < next.length; index += 1) {
      if (selected.has(next[index]!) && !selected.has(next[index - 1]!)) {
        [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
      }
    }
  } else {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selected.has(next[index]!) && !selected.has(next[index + 1]!)) {
        [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
      }
    }
  }
  return next;
}
