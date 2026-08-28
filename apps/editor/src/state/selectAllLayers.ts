import type { Composition } from '@ograf-editor/scene-model';

/** Every authored layer remains selectable through Layers/Timeline regardless of visual flags. */
export function selectableLayerIds(composition: Composition): string[] {
  return composition.layers.map((layer) => layer.id);
}
