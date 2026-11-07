import {
  getLayerTransformAtFrame,
  layerMotionWindows,
  resolveStylePackMotion,
  stylePackIdForComposition,
  CHART_ANIMATION_EASINGS,
  type EasingPreset,
  type Composition,
  type Layer,
  type LayerMotionSide,
  type LayerMotionSpec,
} from '@ograf-editor/scene-model';

/** A stable visual hierarchy: panels, primary text, secondary text, then images/logos. */
export function groupMotionPlan(composition: Composition, layers: Layer[], side: LayerMotionSide) {
  const windows = layerMotionWindows(composition);
  if (!windows) return [];
  const available = side === 'in' ? windows.inFrames : windows.outFrames;
  if (available < 1) return [];
  const frame = windows.firstStep;
  const ordered = layers
    .filter((layer) => !layer.isLocked)
    .map((layer, index) => {
      const pose = getLayerTransformAtFrame(layer, frame);
      const type = layer.element.type;
      const role =
        type === 'rectangle' || type === 'ellipse' || type === 'path' ? 0 : type === 'text' ? 1 : 2;
      const size = type === 'text' ? layer.element.fontSize : pose.width * pose.height;
      return { layer, index, role, size };
    })
    .sort((a, b) => a.role - b.role || b.size - a.size || a.index - b.index);
  const packId = stylePackIdForComposition(composition);
  const hasMotionTokens = composition.designSystem.tokens.some((token) =>
    /^motion\.(entrance|exit|stagger)\.(frames|easing)$/.test(token.key),
  );
  const brandMotion =
    packId || hasMotionTokens ? resolveStylePackMotion(composition, packId ?? 'news') : null;
  const easingToken = composition.designSystem.tokens.find(
    (token) => token.key === `motion.${side === 'in' ? 'entrance' : 'exit'}.easing`,
  )?.value;
  const brandEasing =
    typeof easingToken === 'string' && CHART_ANIMATION_EASINGS.includes(easingToken as EasingPreset)
      ? (easingToken as EasingPreset)
      : brandMotion
        ? side === 'in'
          ? brandMotion.entranceEasing
          : brandMotion.exitEasing
        : undefined;
  const requestedDuration = brandMotion
    ? side === 'in'
      ? brandMotion.entranceFrames
      : brandMotion.exitFrames
    : Math.max(1, Math.floor(available * (side === 'in' ? 0.55 : 0.4)));
  const requestedSpread = brandMotion
    ? brandMotion.staggerFrames * Math.max(0, ordered.length - 1)
    : available - requestedDuration;
  const spread = Math.max(0, Math.min(available - 1, requestedSpread));
  const durationFrames = Math.max(1, Math.min(requestedDuration, available - spread));
  return ordered.map(({ layer, role }, index) => {
    const position =
      ordered.length <= 1
        ? 0
        : (side === 'in' ? ordered.length - 1 - index : index) / (ordered.length - 1);
    const style = role === 0 ? 'wipe' : role === 1 ? 'slide' : 'fade';
    const spec: LayerMotionSpec = {
      style,
      durationFrames,
      offsetFrames: Math.round(spread * position),
      ...(brandEasing ? { easing: brandEasing } : {}),
      ...(style === 'wipe'
        ? { direction: 'left' as const }
        : style === 'slide'
          ? { direction: 'up' as const, distance: 80 }
          : {}),
    };
    return { layerId: layer.id, spec };
  });
}
