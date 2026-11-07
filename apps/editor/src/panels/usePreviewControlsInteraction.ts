import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import { installPreviewControlsInteraction } from './previewControlsInteraction';
import './PreviewControlsInteraction.css';

/** Fullscreen browser-menu guard plus temporary value-editing emphasis. */
export function usePreviewControlsInteraction(
  viewportRef: RefObject<HTMLElement | null>,
  controlsRef: RefObject<HTMLElement | null>,
  active: boolean,
  onContextMenu?: (event: MouseEvent) => void,
): void {
  const { document: ownerDocument } = useEditorWindow();
  const contextMenu = useRef(onContextMenu);
  contextMenu.current = onContextMenu;
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport)
      return installPreviewControlsInteraction(
        viewport,
        controlsRef.current,
        active,
        (event) => contextMenu.current?.(event),
        ownerDocument,
      );
  }, [viewportRef, controlsRef, active, ownerDocument]);
}
