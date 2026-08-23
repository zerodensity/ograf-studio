import {
  computeKeyframeFrames,
  getResolvedLayerAnimationTracks,
  resolveElementAssetReferences,
  type Composition,
} from '@ograf-editor/scene-model';
import type {
  CompiledGraphicDescriptor,
  CompiledKeyframe,
  CompiledLayer,
} from '@ograf-editor/ograf-types';

export type {
  CompiledGraphicDescriptor,
  CompiledKeyframe,
  CompiledLayer,
} from '@ograf-editor/ograf-types';

/**
 * Project/Composition -> CompiledGraphicDescriptor. Resolves each layer binding's `fieldId` to the
 * field's `key` (the name the runtime `data` payload actually uses), and drops guide layers
 * (design-time-only, excluded from anything that ships).
 */
export function compileDescriptor(
  composition: Composition,
  options: { includeGuides?: boolean } = {},
): CompiledGraphicDescriptor {
  const keyframeFrames = computeKeyframeFrames(composition);
  const frameByKeyframeId = new Map(keyframeFrames.map((k) => [k.keyframeId, k.frame]));
  const fieldKeyById = new Map(composition.dataFields.map((f) => [f.id, f.key]));

  const keyframes: CompiledKeyframe[] = composition.keyframes.map((keyframe) => ({
    id: keyframe.id,
    frame: frameByKeyframeId.get(keyframe.id) ?? 0,
    role: keyframe.role,
  }));

  const startKeyframeId = keyframes.find((keyframe) => keyframe.role === 'start')?.id;
  const endKeyframeId = keyframes.find((keyframe) => keyframe.role === 'end')?.id;
  if (!startKeyframeId || !endKeyframeId) {
    throw new Error('Composition must contain exactly one explicit start and end keyframe.');
  }
  const stepKeyframeIds = keyframes
    .filter((keyframe) => keyframe.role === 'step')
    .map((keyframe) => keyframe.id);

  const layers: CompiledLayer[] = composition.layers
    .filter((layer) => options.includeGuides || !layer.isGuide)
    .map((layer) => {
      const animationTracks = getResolvedLayerAnimationTracks(layer);
      const clipParent = layer.parentId
        ? composition.layers.find(
            (candidate) => candidate.id === layer.parentId && candidate.clipChildren,
          )
        : undefined;
      return {
        id: layer.id,
        isVisible: layer.isVisible,
        element: resolveElementAssetReferences(layer.element, composition.assets),
        effects: layer.effects,
        keyframes: layer.keyframes.map((keyframe) => ({
          id: keyframe.id,
          frame: keyframe.frame,
          transform: keyframe.transform,
          easing: keyframe.easing,
        })),
        animationTracks: Object.fromEntries(
          Object.entries(animationTracks).map(([property, keyframes]) => [
            property,
            keyframes?.map((keyframe) => ({ ...keyframe })) ?? [],
          ]),
        ),
        loop: layer.loop
          ? {
              ...layer.loop,
              activation: { ...layer.loop.activation },
              tracks: Object.fromEntries(
                Object.entries(layer.loop.tracks).map(([property, keys]) => [
                  property,
                  keys?.map((key) => ({
                    ...key,
                    ...(key.curve ? { curve: { ...key.curve } } : {}),
                  })) ?? [],
                ]),
              ),
            }
          : null,
        bindings: layer.bindings.flatMap((binding) => {
          const dataKey = fieldKeyById.get(binding.fieldId);
          return dataKey === undefined
            ? []
            : [
                {
                  dataKey,
                  targetProperty: binding.targetProperty,
                  ...(binding.valueMap ? { valueMap: structuredClone(binding.valueMap) } : {}),
                },
              ];
        }),
        clipParentId: clipParent?.id ?? null,
      };
    });

  return {
    width: composition.width,
    height: composition.height,
    backgroundColor: composition.backgroundColor,
    frameRate: composition.frameRate,
    updateTransitionFrames: composition.updateTransitionFrames,
    fonts: composition.assets
      .filter((asset) => asset.kind === 'font')
      .map((asset) => ({
        family: asset.fontFamily || asset.name.replace(/\.[^.]+$/, ''),
        source: `asset:${asset.id}`,
        mimeType: asset.mimeType,
        weight: asset.fontWeight || '100 900',
        style: asset.fontStyle || 'normal',
      })),
    layers,
    keyframes,
    transitions: composition.transitions.map((t) => ({
      fromKeyframeId: t.fromKeyframeId,
      toKeyframeId: t.toKeyframeId,
      durationFrames: t.durationFrames,
      easing: t.easing,
    })),
    stepKeyframeIds,
    stepCount: stepKeyframeIds.length,
    startKeyframeId,
    endKeyframeId,
    customActions: composition.customActions.map((a) => ({ id: a.actionId, name: a.name })),
  };
}
