/** A sample must never be applied to another document, selection or remounted control. */
export interface ColorSamplingTarget {
  root: HTMLElement | null;
  project: object;
  compositionId: string;
  selection: object;
}
export function isColorSamplingTargetCurrent(
  start: ColorSamplingTarget,
  current: ColorSamplingTarget,
): boolean {
  return (
    !!start.root &&
    start.root.isConnected &&
    start.root === current.root &&
    start.project === current.project &&
    start.compositionId === current.compositionId &&
    start.selection === current.selection
  );
}
