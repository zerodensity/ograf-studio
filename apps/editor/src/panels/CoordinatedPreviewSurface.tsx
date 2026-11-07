import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useEditorWindow } from '../layout/EditorWindow';
import { useFitZoom } from '../canvas/useFitZoom';
import { PresentationBackground } from '../components/PresentationBackground';
import { ProgramGuides } from '../components/ProgramGuides';
import { PreviewFpsControls, PreviewFpsOverlay } from '../components/PreviewFpsOverlay';
import { useDockPaneVisible } from '../layout/PaneVisibilityContext';
import { transparencyCheckerboardStyle } from '../canvas/compositionBackground';
import {
  enterPreviewFullscreen,
  exitPreviewFullscreen,
  installPreviewShortcuts,
  isPreviewPresented,
} from '../state/previewPresentation';
import { dispatchPreviewKeyboardInput } from '../state/previewKeyboardInput';
import { registerPreviewPresentation } from '../state/previewPresentationStore';
import { PreviewControlsHeading } from './PreviewControlsHeading';
import { usePreviewControlsPosition } from './usePreviewControlsPosition';
import { usePreviewControlsInteraction } from './usePreviewControlsInteraction';
import { useTickerUpdateStatuses } from './useTickerUpdateStatuses';
import { TickerPendingUpdates } from './TickerPendingUpdates';
import { PreviewBackgroundControls } from './PreviewBackgroundControls';
import './PreviewExportPanel.css';
import './LivePlayoutPanel.css';

/** The graphic remains owned by its session; this surface only hosts and scales it. */
export function CoordinatedPreviewSurface({
  width,
  height,
  attach,
  controls,
  registerPresentation = false,
  emptyMessage,
}: {
  width: number;
  height: number;
  attach(container: HTMLElement): (() => void) | void;
  controls?: ReactNode;
  registerPresentation?: boolean;
  emptyMessage?: string;
}) {
  const { document: ownerDocument } = useEditorWindow();
  const paneVisible = useDockPaneVisible();
  const viewportRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tickerUpdates = useTickerUpdateStatuses(stageRef);
  const controlsRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showData, setShowData] = useState(false);
  const showDataRef = useRef(showData);
  showDataRef.current = showData;
  const controlsPosition = usePreviewControlsPosition(
    viewportRef,
    controlsRef,
    fullscreen && showData,
  );
  usePreviewControlsInteraction(viewportRef, controlsRef, fullscreen && showData, (event) => {
    viewportRef.current?.focus({ preventScroll: true });
    controlsPosition.openAt(event.clientX, event.clientY);
    setShowData(true);
  });
  const [error, setError] = useState('');
  const zoom = useFitZoom(measureRef, width, height, fullscreen ? 0 : 8, fullscreen ? Infinity : 1);
  useLayoutEffect(() => {
    if (stageRef.current) return attach(stageRef.current);
  }, [attach, ownerDocument]);
  const enter = useCallback(async () => {
    const viewport = viewportRef.current;
    if (!viewport) throw new Error('Preview is not available.');
    try {
      setError('');
      await enterPreviewFullscreen(viewport);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }, []);
  useLayoutEffect(() => {
    if (registerPresentation && viewportRef.current)
      return registerPreviewPresentation({ viewport: viewportRef.current, enter, ownerDocument });
  }, [registerPresentation, enter, ownerDocument]);
  const toggle = useCallback(() => {
    if (
      controlsRef.current
        ?.querySelector('.preview-popup-body')
        ?.contains(ownerDocument.activeElement)
    )
      viewportRef.current?.focus({ preventScroll: true });
    setShowData(!showDataRef.current);
  }, [ownerDocument]);
  useEffect(() => {
    const viewport = viewportRef.current;
    const changed = () => setFullscreen(isPreviewPresented(viewport));
    const releaseShortcuts = viewport
      ? installPreviewShortcuts(
          ownerDocument,
          viewport,
          viewport,
          () => {},
          () => false,
          {
            toggleControls: toggle,
            onKeyboard: (event) =>
              dispatchPreviewKeyboardInput(stageRef.current, event, (cause) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              ),
          },
        )
      : () => {};
    changed();
    ownerDocument.addEventListener('fullscreenchange', changed);
    return () => {
      ownerDocument.removeEventListener('fullscreenchange', changed);
      releaseShortcuts();
      if (viewport && isPreviewPresented(viewport))
        void exitPreviewFullscreen(viewport).catch(() => undefined);
    };
  }, [ownerDocument, toggle]);
  return (
    <>
      <div
        className="preview-stage-wrap playout-presentation"
        data-ograf-keyboard-scope
        ref={viewportRef}
        tabIndex={0}
        aria-label="Coordinated output preview. In fullscreen, right-click for controls at the pointer. D toggles controls; Escape exits."
        onMouseDown={(event) => {
          if (
            event.button === 0 &&
            !(event.target as HTMLElement).closest('[data-preview-controls]')
          )
            event.currentTarget.focus({ preventScroll: true });
        }}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
          const target = event.target as HTMLElement;
          if (
            (target === event.currentTarget || target.closest('.playout-viewport')) &&
            [' ', 'ArrowLeft', 'ArrowRight'].includes(event.key)
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div
          className="playout-viewport"
          ref={measureRef}
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <div
            className="preview-stage-measure"
            style={{ width: width * zoom, height: height * zoom }}
          >
            <div
              className="preview-stage playout-stage"
              style={{
                width,
                height,
                transform: `scale(${zoom})`,
                ...transparencyCheckerboardStyle(zoom),
              }}
            >
              <PresentationBackground />
              <div className="preview-graphic-content" ref={stageRef} />
              <ProgramGuides width={width} height={height} />
            </div>
          </div>
          {emptyMessage && <p className="playout-viewport-message">{emptyMessage}</p>}
          <PreviewFpsOverlay targetRef={measureRef} active={fullscreen || paneVisible} />
        </div>
        <aside
          ref={controlsRef}
          className="preview-fullscreen-data playout-fullscreen-controls"
          style={controlsPosition.style}
          data-preview-controls
          aria-label="Coordinated playout controls"
          hidden={fullscreen && !showData}
        >
          <div className="preview-popup-body">
            {fullscreen && <PreviewControlsHeading position={controlsPosition} />}
            {controls}
            <PreviewBackgroundControls />
            <PreviewFpsControls />
            <TickerPendingUpdates statuses={tickerUpdates} />
            {fullscreen && (
              <p className="playout-note">
                Right-click for controls at the pointer. Drag the header to move this window. D
                toggles controls; Escape exits preview.
              </p>
            )}
          </div>
        </aside>
      </div>
      {registerPresentation && (
        <div className="playout-session-actions">
          <button
            type="button"
            title="Show the live template-set output fullscreen"
            onClick={() => void enter().catch(() => undefined)}
          >
            Fullscreen
          </button>
        </div>
      )}
      {error && (
        <p className="playout-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
