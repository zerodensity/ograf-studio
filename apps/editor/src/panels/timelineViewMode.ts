export type TimelineViewMode = 'keys' | 'graph';

export interface TimelineViewSelection {
  contextId: string;
  channelId: string | null;
  animated: boolean;
}

/** Navigation may open a curve; edits and deselection must retain the chosen editor. */
export function timelineViewAfterSelectionChange(
  current: TimelineViewMode,
  previous: TimelineViewSelection,
  next: TimelineViewSelection,
): TimelineViewMode {
  if (previous.contextId !== next.contextId) return next.animated ? 'graph' : 'keys';
  if (next.channelId && next.channelId !== previous.channelId && next.animated) return 'graph';
  return current;
}
