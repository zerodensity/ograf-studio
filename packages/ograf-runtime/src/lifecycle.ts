import type { PlayActionParams } from '@ograf-editor/ograf-types';

export interface LifecycleTarget {
  keyframeId: string;
  currentStep: number | undefined;
}

/** Pure OGraf step resolution shared by realtime actions and non-realtime schedule replay. */
export function resolvePlayTarget(
  stepKeyframeIds: string[],
  startKeyframeId: string,
  endKeyframeId: string,
  currentStep: number | undefined,
  params: PlayActionParams,
): LifecycleTarget {
  const targetStep = params.goto ?? (currentStep ?? -1) + (params.delta ?? 1);
  if (targetStep < 0) return { keyframeId: startKeyframeId, currentStep: undefined };
  if (targetStep >= stepKeyframeIds.length) {
    return { keyframeId: endKeyframeId, currentStep: undefined };
  }
  return { keyframeId: stepKeyframeIds[targetStep]!, currentStep: targetStep };
}
