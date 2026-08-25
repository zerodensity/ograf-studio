export const TIMELINE_KEY_DRAG_THRESHOLD_PX = 3;

/** Prevents an ordinary click or tiny pointer jitter from becoming a timeline drag. */
export function isTimelineKeyDrag(startClientX: number, currentClientX: number): boolean {
  return Math.abs(currentClientX - startClientX) >= TIMELINE_KEY_DRAG_THRESHOLD_PX;
}
