import type { TransitionLogicSlot } from '@ograf-editor/scene-model';

/** Resolve stale or removed selections without changing the order of the remaining lanes. */
export function activeTransitionLane(
  lanes: readonly TransitionLogicSlot[],
  selectedLaneId: string | null,
): TransitionLogicSlot | undefined {
  return lanes.find((lane) => lane.id === selectedLaneId) ?? lanes[0];
}
