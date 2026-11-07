import type { usePreviewControlsPosition } from './usePreviewControlsPosition';

export function PreviewControlsDragHandle({
  position,
}: {
  position: ReturnType<typeof usePreviewControlsPosition>;
}) {
  return (
    <button
      type="button"
      className={`preview-controls-drag-handle${position.dragging ? ' is-dragging' : ''}`}
      data-preview-controls-drag
      aria-label="Move preview controls"
      title="Drag to move. Arrow keys move; Home or double-click resets the position."
      {...position.handleProps}
    >
      <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
        <circle cx="3" cy="3" r="1" />
        <circle cx="8" cy="3" r="1" />
        <circle cx="3" cy="7" r="1" />
        <circle cx="8" cy="7" r="1" />
        <circle cx="3" cy="11" r="1" />
        <circle cx="8" cy="11" r="1" />
      </svg>
      <strong>Preview controls</strong>
    </button>
  );
}
