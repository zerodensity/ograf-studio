import type { ReactNode } from 'react';
import { exitPreviewFullscreen } from '../state/previewPresentation';
import { PreviewControlsDragHandle } from './PreviewControlsDragHandle';
import type { usePreviewControlsPosition } from './usePreviewControlsPosition';

/** Exit stays available even when the graphic is loading or a transport call is pending. */
export function PreviewControlsHeading({
  position,
  children,
}: {
  position: ReturnType<typeof usePreviewControlsPosition>;
  children?: ReactNode;
}) {
  return (
    <div className="preview-fullscreen-data-heading">
      <PreviewControlsDragHandle position={position} />
      {children}
      <button
        type="button"
        className="preview-exit-fullscreen"
        aria-label="Exit fullscreen"
        title="Exit fullscreen (Escape)"
        onClick={(event) => {
          const viewport = event.currentTarget.closest<HTMLElement>(
            '.preview-stage-wrap, .template-preview-surface',
          );
          if (viewport) void exitPreviewFullscreen(viewport).catch(() => undefined);
        }}
      >
        Exit fullscreen
      </button>
    </div>
  );
}
