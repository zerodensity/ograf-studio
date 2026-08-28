export const DEFAULT_TIMELINE_GUTTER_WIDTH = 170;
export const MIN_TIMELINE_GUTTER_WIDTH = 120;
export const MAX_TIMELINE_GUTTER_WIDTH = 520;
export const MIN_TIMELINE_TRACK_WIDTH = 140;
export const TIMELINE_GUTTER_HANDLE_WIDTH = 7;

export function clampTimelineGutterWidth(requested: number, timelineBodyWidth: number): number {
  const availableMaximum = Math.max(
    MIN_TIMELINE_GUTTER_WIDTH,
    Math.min(
      MAX_TIMELINE_GUTTER_WIDTH,
      timelineBodyWidth - MIN_TIMELINE_TRACK_WIDTH - TIMELINE_GUTTER_HANDLE_WIDTH,
    ),
  );
  return Math.round(Math.max(MIN_TIMELINE_GUTTER_WIDTH, Math.min(availableMaximum, requested)));
}
