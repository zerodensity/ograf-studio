import type { AlignmentTarget } from '../state/projectStore';

/** One layer has no shared bounds to align to, so it always aligns to the canvas. */
export function effectiveAlignmentTarget(
  selectedCount: number,
  picked: AlignmentTarget | null,
): AlignmentTarget {
  if (selectedCount < 2) return 'canvas';
  return picked ?? 'selection';
}
