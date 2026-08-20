import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { compileDescriptor } from '@ograf-editor/codegen';
import { registerGraphicElement } from '@ograf-editor/ograf-runtime';
import type { Graphic, RenderType, ReturnPayload } from '@ograf-editor/ograf-types';
import type { Project } from '@ograf-editor/scene-model';
import { useTestDataStore } from '../state/testDataStore';
import { isInteractiveShortcutTarget } from '../state/keyboardShortcuts';
import { buildPreviewDataFromTestValues } from '../state/previewData';
import { useFitZoom } from './useFitZoom';
import { transparencyCheckerboardStyle } from './compositionBackground';
import { getCenteredStageScroll, getStagePasteboardLayout } from './stagePasteboard';
import {
  captureStageZoomAnchor,
  nextStageZoom,
  scrollForStageZoom,
  type StageZoomAnchor,
} from './stageZoom';
import { viewportScrollForPointer, type ViewportPanOrigin } from './viewportPan';
import './RuntimePreviewStage.css';

type RuntimeGraphic = HTMLElement & Graphic;
type PreviewPhase = 'unloaded' | 'start' | 'step' | 'end' | 'disposed' | 'error';

interface RuntimePreviewStageProps {
  project: Project;
  stale: boolean;
  onExit: () => void;
  onReload: () => void;
  style?: CSSProperties;
}

function successful(result: ReturnPayload | undefined): boolean {
  return !result || result.statusCode < 400;
}

export function RuntimePreviewStage({
  project,
  stale,
  onExit,
  onReload,
  style,
}: RuntimePreviewStageProps) {
  const composition =
    project.compositions.find((candidate) => candidate.id === project.mainCompositionId) ??
    project.compositions[0]!;
  const testValues = useTestDataStore((state) => state.values);
  const descriptor = useMemo(() => compileDescriptor(composition), [composition]);
  const stepNames = useMemo(
    () =>
      composition.keyframes
        .filter((keyframe) => keyframe.role === 'step')
        .map((keyframe, index) => keyframe.name || `Step ${index + 1}`),
    [composition.keyframes],
  );
  const data = useMemo(
    () => buildPreviewDataFromTestValues(composition, testValues),
    [composition, testValues],
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphicRef = useRef<RuntimeGraphic | null>(null);
  const fitZoom = useFitZoom(viewportRef, composition.width, composition.height);
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const zoom = manualZoom ?? fitZoom;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pendingZoomAnchorRef = useRef<StageZoomAnchor | null>(null);
  const panGestureRef = useRef<(ViewportPanOrigin & { pointerId: number }) | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [renderType, setRenderType] = useState<RenderType>('realtime');
  const [phase, setPhase] = useState<PreviewPhase>('unloaded');
  const [isLoaded, setIsLoaded] = useState(false);
  const [currentStep, setCurrentStep] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Compiled snapshot ready — press Load.');
  const pasteboard = useMemo(
    () => getStagePasteboardLayout(composition.width, composition.height, zoom),
    [composition.height, composition.width, zoom],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const tagName = registerGraphicElement(descriptor);
    const graphic = document.createElement(tagName) as RuntimeGraphic;
    container.replaceChildren(graphic);
    graphicRef.current = graphic;
    return () => {
      graphicRef.current = null;
      void graphic.dispose({});
      graphic.remove();
    };
  }, [descriptor]);

  const requestStageZoom = useCallback(
    (direction: 'in' | 'out', client?: { x: number; y: number }) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const currentZoom = zoomRef.current;
      const nextZoom = nextStageZoom(currentZoom, direction);
      if (nextZoom === currentZoom) return;
      const rect = viewport.getBoundingClientRect();
      pendingZoomAnchorRef.current = captureStageZoomAnchor(
        currentZoom,
        viewport.scrollLeft,
        viewport.scrollTop,
        client ? client.x - rect.left : viewport.clientWidth / 2,
        client ? client.y - rect.top : viewport.clientHeight / 2,
      );
      setManualZoom(nextZoom);
    },
    [],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      requestStageZoom(event.deltaY < 0 ? 'in' : 'out', { x: event.clientX, y: event.clientY });
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [requestStageZoom]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isInteractiveShortcutTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '_'].includes(event.key)) {
        event.preventDefault();
        requestStageZoom(event.key === '+' || event.key === '=' ? 'in' : 'out');
      }
    };
    const handleBlur = () => {
      panGestureRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [requestStageZoom]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const anchor = pendingZoomAnchorRef.current;
    const scroll = anchor
      ? scrollForStageZoom(anchor, zoom)
      : getCenteredStageScroll(pasteboard, viewport.clientWidth, viewport.clientHeight);
    pendingZoomAnchorRef.current = null;
    viewport.scrollLeft = scroll.left;
    viewport.scrollTop = scroll.top;
  }, [pasteboard, zoom]);

  const invoke = async <T extends ReturnPayload | undefined>(
    label: string,
    call: (graphic: RuntimeGraphic) => Promise<T>,
    onSuccess: (result: T) => void,
  ) => {
    const graphic = graphicRef.current;
    if (!graphic || busy) return;
    setBusy(true);
    try {
      const result = await call(graphic);
      if (!successful(result)) {
        setPhase('error');
        setMessage(`${label} failed: ${result?.statusMessage ?? `status ${result?.statusCode}`}`);
      } else {
        onSuccess(result);
      }
    } catch (error) {
      setPhase('error');
      setMessage(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleLoad = () =>
    void invoke(
      'Load',
      (graphic) =>
        graphic.load({
          data,
          renderType,
          renderCharacteristics: {
            resolution: { width: composition.width, height: composition.height },
            frameRate: composition.frameRate,
            accessToPublicInternet: false,
          },
        }),
      () => {
        setIsLoaded(true);
        setCurrentStep(undefined);
        setPhase('start');
        setMessage('Loaded at Start.');
      },
    );

  const handlePlay = (params: { delta?: number; goto?: number }) =>
    void invoke(
      'playAction',
      (graphic) => graphic.playAction(params),
      (result) => {
        const step = result?.currentStep;
        setCurrentStep(step);
        if (step === undefined) {
          setPhase(params.delta === -1 ? 'start' : 'end');
          setMessage(params.delta === -1 ? 'Returned to Start.' : 'Reached End.');
        } else {
          setPhase('step');
          setMessage(`On ${stepNames[step] ?? `Step ${step + 1}`}.`);
        }
      },
    );

  const handleUpdate = () =>
    void invoke(
      'updateAction',
      (graphic) => graphic.updateAction({ data }),
      () => setMessage('Data updated on the loaded graphic.'),
    );

  const handleStop = () =>
    void invoke(
      'stopAction',
      (graphic) => graphic.stopAction({}),
      () => {
        setCurrentStep(undefined);
        setPhase('end');
        setMessage('stopAction completed at End.');
      },
    );

  const handleDispose = () =>
    void invoke(
      'Dispose',
      (graphic) => graphic.dispose({}),
      () => {
        setIsLoaded(false);
        setCurrentStep(undefined);
        setPhase('disposed');
        setMessage('Runtime disposed. Press Load to initialize it again.');
      },
    );

  const handleCustomAction = (id: string) =>
    void invoke(
      `customAction(${id})`,
      (graphic) => graphic.customAction({ id, payload: {} }),
      () => setMessage(`customAction(${id}) completed.`),
    );

  const beginViewportPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    const viewport = event.currentTarget;
    panGestureRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    setIsPanning(true);
  };

  const updateViewportPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = panGestureRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    const scroll = viewportScrollForPointer(origin, event.clientX, event.clientY);
    event.currentTarget.scrollLeft = scroll.left;
    event.currentTarget.scrollTop = scroll.top;
  };

  const endViewportPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panGestureRef.current?.pointerId !== event.pointerId) return;
    panGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
  };

  const canNavigate = isLoaded && phase !== 'end';
  const phaseLabel =
    phase === 'step' && currentStep !== undefined
      ? `${stepNames[currentStep] ?? `Step ${currentStep + 1}`} (${currentStep + 1}/${descriptor.stepCount})`
      : phase === 'start'
        ? 'Start'
        : phase === 'end'
          ? 'End'
          : phase === 'disposed'
            ? 'Disposed'
            : phase === 'error'
              ? 'Error'
              : 'Unloaded';

  return (
    <section className="canvas-stage runtime-preview-stage" style={style}>
      <div className="runtime-preview-toolbar">
        <div className="stage-mode-switch" role="group" aria-label="Canvas mode">
          <button type="button" onClick={onExit} aria-pressed="false">
            Edit
          </button>
          <button type="button" className="active" aria-pressed="true">
            OGraf Preview
          </button>
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <select
          aria-label="OGraf render type"
          value={renderType}
          disabled={busy || isLoaded}
          onChange={(event) => setRenderType(event.target.value as RenderType)}
        >
          <option value="realtime">Realtime</option>
          <option value="non-realtime">Non-realtime</option>
        </select>
        <button type="button" onClick={handleLoad} disabled={busy}>
          Load
        </button>
        <button
          type="button"
          onClick={() => handlePlay({ delta: -1 })}
          disabled={busy || !isLoaded || phase !== 'step'}
          title="playAction({ delta: -1 })"
        >
          ◀ Previous Step
        </button>
        <button
          type="button"
          onClick={() => handlePlay({ delta: 1 })}
          disabled={busy || !canNavigate}
          title="playAction({ delta: 1 })"
        >
          Next Step ▶
        </button>
        {stepNames.length > 0 && (
          <select
            aria-label="Go to OGraf Step"
            value={currentStep ?? ''}
            disabled={busy || !canNavigate}
            onChange={(event) => {
              if (event.target.value !== '') handlePlay({ goto: Number(event.target.value) });
            }}
          >
            <option value="">Go to Step…</option>
            {stepNames.map((name, index) => (
              <option key={`${name}-${index}`} value={index}>
                {index + 1}. {name}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={handleUpdate} disabled={busy || !isLoaded}>
          Update Data
        </button>
        <button
          type="button"
          onClick={handleStop}
          disabled={busy || !isLoaded || phase === 'end'}
          title="stopAction"
        >
          Stop / Take Out
        </button>
        <button type="button" onClick={handleDispose} disabled={busy || !isLoaded}>
          Dispose
        </button>
        {descriptor.customActions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={busy || !isLoaded}
            onClick={() => handleCustomAction(action.id)}
            title={`customAction(${action.id})`}
          >
            {action.name || action.id}
          </button>
        ))}
        <span className={`runtime-preview-state ${phase === 'error' ? 'error' : ''}`}>
          {busy ? 'Working…' : phaseLabel}
        </span>
      </div>
      {(stale || message) && (
        <div className={`runtime-preview-notice${stale ? ' stale' : ''}`} role="status">
          <span>
            {stale
              ? 'Template changed — this preview is still running the previous snapshot.'
              : message}
          </span>
          {stale && (
            <button type="button" onClick={onReload}>
              Reload Preview
            </button>
          )}
        </div>
      )}
      <div className="canvas-stage-workspace">
        <div
          className={`canvas-stage-viewport${isPanning ? ' is-panning' : ''}`}
          ref={viewportRef}
          aria-label={`OGraf runtime preview, ${Math.round(zoom * 100)}% zoom`}
          title="Compiled OGraf runtime preview — Ctrl+wheel to zoom, middle-drag to pan"
          tabIndex={0}
          style={transparencyCheckerboardStyle(1)}
          onPointerDownCapture={beginViewportPan}
          onPointerMoveCapture={updateViewportPan}
          onPointerUpCapture={endViewportPan}
          onPointerCancelCapture={endViewportPan}
          onAuxClick={(event) => {
            if (event.button === 1) event.preventDefault();
          }}
        >
          <div
            className="canvas-stage-measure"
            style={{ width: pasteboard.measureWidth, height: pasteboard.measureHeight }}
          >
            <div
              className="canvas-stage-pasteboard"
              style={{
                width: composition.width * 3,
                height: composition.height * 3,
                transform: `scale(${zoom})`,
              }}
            >
              <div
                className="canvas-stage-frame runtime-preview-frame"
                style={{
                  left: composition.width,
                  top: composition.height,
                  width: composition.width,
                  height: composition.height,
                  backgroundColor: composition.backgroundColor,
                }}
              >
                <div ref={containerRef} className="runtime-preview-host" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
