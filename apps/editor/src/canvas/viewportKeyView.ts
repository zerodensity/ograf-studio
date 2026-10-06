/** SVG filter id applied to the canvas frame while the key view is on. */
export const KEY_VIEW_FILTER_ID = 'ograf-viewport-key-view';

/**
 * feColorMatrix that shows the key signal: every colour channel takes the alpha value and the
 * result is fully opaque, so transparent pixels read black and opaque pixels read white.
 */
export const KEY_VIEW_COLOR_MATRIX = '0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 0 1';

/** A plain K press (no modifiers, not auto-repeat) toggles the key view. */
export function isKeyViewShortcut(event: {
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
}): boolean {
  return (
    event.code === 'KeyK' &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.repeat
  );
}
