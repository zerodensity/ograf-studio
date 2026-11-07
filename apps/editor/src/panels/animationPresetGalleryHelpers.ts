import {
  isAnimatableLayerPropertyApplicable,
  layerMotionWindows,
  type AnimationPluginPreset,
  type AnimationPresetApplyOptions,
  type Composition,
  type Layer,
  type LayerMotionSide,
} from '@ograf-editor/scene-model';

export const animationSelectionKey = (ids: readonly string[]) =>
  [...new Set(ids)].sort().join('\0');

export function animationPresetParameters(preset: AnimationPluginPreset): Record<string, string> {
  return Object.fromEntries(
    (preset.parameters ?? []).map((parameter) => [parameter.id, String(parameter.default)]),
  );
}

export function animationPresetTargetReason(
  preset: AnimationPluginPreset,
  side: LayerMotionSide,
  targets: readonly Layer[],
): string | null {
  const tracks = preset.tracks[side];
  if (!tracks?.length) return `This preset has no ${side === 'in' ? 'In' : 'Out'} animation.`;
  for (const layer of targets.filter((target) => !target.isLocked)) {
    if (preset.targetKinds && !preset.targetKinds.includes(layer.element.type))
      return `${layer.name}: this preset does not support ${layer.element.type} objects.`;
    for (const track of tracks)
      if (!isAnimatableLayerPropertyApplicable(layer, track.property))
        return `${layer.name}: ${track.property} is unavailable.`;
  }
  return null;
}

/** Numeric draft fields remain local; only an explicit Apply publishes baked keys. */
export function parseAnimationPresetOptions(
  preset: AnimationPluginPreset,
  side: LayerMotionSide,
  composition: Composition,
  durationText: string,
  drafts: Record<string, string>,
  offsetText = '0',
): AnimationPresetApplyOptions {
  const windows = layerMotionWindows(composition);
  const available = windows ? (side === 'in' ? windows.inFrames : windows.outFrames) : 0;
  if (available < 1)
    throw new Error('Add a Step and enough timeline frames for this animation window.');
  const durationFrames = Number(durationText);
  const offsetFrames = Number(offsetText);
  if (!offsetText.trim() || !Number.isInteger(offsetFrames) || offsetFrames < 0)
    throw new Error('Finish offset must be a non-negative frame count.');
  if (
    !durationText.trim() ||
    !Number.isInteger(durationFrames) ||
    durationFrames < 1 ||
    durationFrames + offsetFrames > available
  )
    throw new Error(
      `Duration plus finish offset must fit inside this ${available}-frame ${side === 'in' ? 'In' : 'Out'} window.`,
    );
  const parameters = Object.fromEntries(
    (preset.parameters ?? []).map((parameter) => {
      const draft = drafts[parameter.id] ?? String(parameter.default);
      const value = Number(draft);
      if (
        !draft.trim() ||
        !Number.isFinite(value) ||
        value < parameter.min ||
        value > parameter.max
      )
        throw new Error(
          `${parameter.label} must be between ${parameter.min} and ${parameter.max}.`,
        );
      return [parameter.id, value];
    }),
  );
  for (const track of preset.tracks[side] ?? []) {
    const frames = track.keys.map((key) => Math.round(key.at * durationFrames));
    if (new Set(frames).size !== frames.length)
      throw new Error('Increase the duration: preset key times overlap at this frame count.');
  }
  return { durationFrames, parameters, ...(offsetFrames ? { offsetFrames } : {}) };
}
