import {
  getResolvedLayerAnimationTracks,
  parseShaderAnimationProperty,
  type AnimatableLayerProperty,
  type Composition,
} from '@ograf-editor/scene-model';

export type StageDeleteTarget =
  | { kind: 'layer-key'; layerId: string; keyframeId: string }
  | {
      kind: 'property-key';
      layerId: string;
      keyframeId: string;
      property: AnimatableLayerProperty;
    }
  | { kind: 'blocked-key' }
  | { kind: 'layers'; layerIds: string[] }
  | { kind: 'none' };

/** Do not fall through to deleting an object when a selected key is missing or protected. */
export function stageDeleteTarget(
  composition: Composition,
  selection: {
    selectedLayerId: string | null;
    selectedLayerIds: string[];
    selectedLayerKeyframeId: string | null;
    selectedLayerProperty: AnimatableLayerProperty | null;
  },
): StageDeleteTarget {
  const { selectedLayerId: layerId, selectedLayerKeyframeId: keyframeId } = selection;
  if (!layerId) return { kind: 'none' };
  if (!keyframeId) return { kind: 'layers', layerIds: selection.selectedLayerIds };
  const layer = composition.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.isLocked) return { kind: 'blocked-key' };
  const property = selection.selectedLayerProperty;
  if (property) {
    const keys = getResolvedLayerAnimationTracks(layer)[property] ?? [];
    if (!keys.some((key) => key.id === keyframeId)) return { kind: 'blocked-key' };
    if (keys.length <= 1 && !parseShaderAnimationProperty(property)) return { kind: 'blocked-key' };
    return { kind: 'property-key', layerId, keyframeId, property };
  }
  if (layer.keyframes.length <= 1 || !layer.keyframes.some((key) => key.id === keyframeId))
    return { kind: 'blocked-key' };
  return { kind: 'layer-key', layerId, keyframeId };
}
