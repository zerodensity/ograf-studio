import { useTimelineStore } from '../state/timelineStore';

interface ArrowModifiers {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

export function timelineFrameDirection(event: ArrowModifiers): -1 | 1 | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing)
    return null;
  return event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null;
}

/** Editors and accessible value/resize widgets own their arrow keys. */
export function timelineTargetOwnsArrows(target: Element): boolean {
  return Boolean(
    target.closest(
      'input, textarea, select, [role="textbox"], [role="spinbutton"], [role="slider"], [role="separator"], [contenteditable]:not([contenteditable="false"])',
    ),
  );
}

/** Fresh store state avoids stale closure steps during keyboard repeat or rapid clicks. */
export function stepTimelineFrame(delta: -1 | 1): boolean {
  const controller = useTimelineStore.getState().controller;
  if (!controller) return false;
  controller.pause();
  const state = useTimelineStore.getState();
  state.setPreviewLoopLayerId(null);
  controller.seek(
    Math.max(0, Math.min(state.durationFrames, Math.round(state.currentFrame) + delta)),
  );
  return true;
}
