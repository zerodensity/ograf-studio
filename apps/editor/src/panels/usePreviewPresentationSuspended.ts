import { useEffect, useRef, useState, type RefObject } from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import { useDockPaneVisible } from '../layout/PaneVisibilityContext';

/** Fullscreen is shown whatever its tab says; otherwise the pane and its scroll position decide. */
export function isPreviewPresentationSuspended(state: {
  paneVisible: boolean;
  onScreen: boolean;
  fullscreen: boolean;
}): boolean {
  return !state.fullscreen && (!state.paneVisible || !state.onScreen);
}

/**
 * Whether nobody can see the preview: its dock tab is inactive, its section is collapsed, or it is
 * scrolled out of the panel. The pane's flag changes in the same commit as the tab, so showing the
 * tab resumes at once. An observer in a hidden pane only reports that hiding, so it is ignored.
 */
export function usePreviewPresentationSuspended(
  viewportRef: RefObject<HTMLElement | null>,
  fullscreen: boolean,
): boolean {
  const { window } = useEditorWindow();
  const paneVisible = useDockPaneVisible();
  const paneVisibleRef = useRef(paneVisible);
  paneVisibleRef.current = paneVisible;
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !window.IntersectionObserver) return;
    const observer = new window.IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry && paneVisibleRef.current) setOnScreen(entry.isIntersecting);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewportRef, window]);

  return isPreviewPresentationSuspended({ paneVisible, onScreen, fullscreen });
}
