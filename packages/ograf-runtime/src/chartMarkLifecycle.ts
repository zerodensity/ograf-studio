import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';

/** A direct Take Out skips later Steps but still plays the complete final authored Out window. */
export function chartMarkLifecycleFrame(
  descriptor: Pick<CompiledGraphicDescriptor, 'keyframes' | 'stepKeyframeIds' | 'endKeyframeId'>,
  frame: number,
  direct?: { startFrame: number; targetFrame: number } | null,
): number {
  const end = descriptor.keyframes.find((key) => key.id === descriptor.endKeyframeId)?.frame;
  const lastStep = descriptor.keyframes.find(
    (key) => key.id === descriptor.stepKeyframeIds.at(-1),
  )?.frame;
  if (!direct || end === undefined || lastStep === undefined || direct.targetFrame !== end)
    return frame;
  const distance = direct.targetFrame - direct.startFrame;
  const progress =
    distance === 0 ? 1 : Math.max(0, Math.min(1, (frame - direct.startFrame) / distance));
  return lastStep + (end - lastStep) * progress;
}
