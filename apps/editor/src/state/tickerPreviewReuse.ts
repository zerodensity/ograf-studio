import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';

/** Item edits update the existing content; Rules, bindings, poses and transition keys stay intact. */
export function canReusePreviewForTickerElements(
  previous: CompiledGraphicDescriptor,
  next: CompiledGraphicDescriptor,
): boolean {
  if (previous === next) return false;
  let changed = false;
  for (const layer of next.layers) {
    const before = previous.layers.find((candidate) => candidate.id === layer.id);
    if (
      layer.element.type === 'ticker' &&
      before?.element.type === 'ticker' &&
      JSON.stringify(before.element) !== JSON.stringify(layer.element)
    )
      changed = true;
  }
  if (!changed) return false;
  const structure = (descriptor: CompiledGraphicDescriptor) => ({
    ...descriptor,
    layers: descriptor.layers.map((layer) => ({
      ...layer,
      element: layer.element.type === 'ticker' ? { type: 'ticker' } : layer.element,
    })),
  });
  return JSON.stringify(structure(previous)) === JSON.stringify(structure(next));
}
