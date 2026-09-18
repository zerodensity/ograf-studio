import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AgentAreaReference } from '@ograf-editor/agent-tools/chat-references';
import { useProjectStore } from '../state/projectStore';
import { useTimelineStore } from '../state/timelineStore';
import { useAgentBridgeStatus } from '../state/agentBridge';
import { captureAgentPng } from '../state/agentCapture';
import {
  appendFreehandPoint,
  areaRectFromPoints,
  freehandAreaFromPoints,
  cropAreaImage,
  type AreaPoint,
} from '../state/agentAreaReference';
import './AreaReferenceCapture.css';
import { VoiceDictationButton } from './VoiceDictationButton';
import { appendDictatedText, useDictationState } from '../state/speechDictation';

type Snapshot = Omit<AgentAreaReference, 'rect' | 'polygon' | 'image' | 'instruction'> & {
  dataUrl: string;
};
interface DraftArea {
  id: string;
  rect: AgentAreaReference['rect'];
  polygon?: AreaPoint[];
  instruction: string;
}

export function AreaReferenceCapture({
  ownerDocument,
  onAttach,
  onClose,
  maxAreas = 8,
  numberOffset = 0,
}: {
  ownerDocument: Document;
  onAttach: (references: AgentAreaReference[]) => void;
  onClose: (reason?: string) => void;
  maxAreas?: number;
  numberOffset?: number;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [rect, setRect] = useState<AgentAreaReference['rect'] | null>(null);
  const [mode, setMode] = useState<'rectangle' | 'freehand'>('rectangle');
  const [polygon, setPolygon] = useState<AreaPoint[]>([]);
  const traceRef = useRef<AreaPoint[]>([]);
  const pointerRef = useRef<number | null>(null);
  const [areas, setAreas] = useState<DraftArea[]>([]);
  const noteRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const maskId = useId();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const dictating = useDictationState((state) => Boolean(state.activeId));
  const startRef = useRef<AreaPoint | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; viewport: HTMLElement } | null>(null);
  const [canvasHost, setCanvasHost] = useState<HTMLElement | null>(null);
  const [fit, setFit] = useState({ width: 1, height: 1 });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const host = ownerDocument.querySelector<HTMLElement>('.canvas-stage-measure');
    const border = ownerDocument.querySelector<HTMLElement>('.canvas-stage-border');
    if (!host || !border) {
      setError('Finish reviewing the proposal before marking canvas areas.');
      return;
    }
    setCanvasHost(host);
    const resize = () => {
      const bounds = border.getBoundingClientRect();
      setFit({ width: bounds.width, height: bounds.height });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(border);
    resize();
    return () => observer.disconnect();
  }, [ownerDocument]);

  useEffect(() => {
    let active = true;
    const notesDocument = panelRef.current?.ownerDocument ?? ownerDocument;
    const previousFocus = notesDocument.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (overlayRef.current?.contains(event.target as Node)) {
        // A drawn-area surface is not an editable scene: prevent background editor shortcuts.
        event.stopPropagation();
        if (event.code === 'Space' || event.ctrlKey || event.metaKey) event.preventDefault();
      }
    };
    const documents = [...new Set([ownerDocument, notesDocument])];
    for (const doc of documents) doc.addEventListener('keydown', keyDown, true);
    const timeline = useTimelineStore.getState();
    timeline.controller?.pause();
    timeline.setPlaying(false);
    const state = useProjectStore.getState();
    const composition = state.project.compositions.find(
      (item) => item.id === state.activeCompositionId,
    )!;
    const project = structuredClone(state.project);
    const frame = timeline.currentFrame;
    const revision = useAgentBridgeStatus.getState().revision;
    const unsubscribe = useProjectStore.subscribe((current) => {
      const currentComposition = current.project.compositions.find(
        (item) => item.id === current.activeCompositionId,
      );
      if (
        current.project.id !== project.id ||
        !currentComposition ||
        currentComposition.id !== composition.id ||
        currentComposition.width !== composition.width ||
        currentComposition.height !== composition.height
      )
        closeRef.current('The canvas changed. Capture the areas again.');
    });
    void captureAgentPng({
      target: 'composition',
      project,
      compositionId: composition.id,
      frame,
      maxDimension: 2048,
      matte: 'checker',
    })
      .then((capture) => {
        if (active)
          setSnapshot({
            projectId: project.id,
            compositionId: composition.id,
            frame,
            revision,
            compositionWidth: composition.width,
            compositionHeight: composition.height,
            dataUrl: `data:image/png;base64,${capture.data}`,
          });
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Could not capture the canvas.');
      });
    return () => {
      active = false;
      unsubscribe();
      for (const doc of documents) doc.removeEventListener('keydown', keyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [ownerDocument]);

  const pointAt = (event: { clientX: number; clientY: number }): AreaPoint => {
    const bounds = overlayRef.current!.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          snapshot!.compositionWidth,
          ((event.clientX - bounds.left) / bounds.width) * snapshot!.compositionWidth,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          snapshot!.compositionHeight,
          ((event.clientY - bounds.top) / bounds.height) * snapshot!.compositionHeight,
        ),
      ),
    };
  };
  const extendTrace = (event: PointerEvent, force = false) => {
    const bounds = overlayRef.current!.getBoundingClientRect();
    const distance = force ? 0 : (snapshot!.compositionWidth / bounds.width) * 2;
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const sample of [...samples, event]) {
      traceRef.current = appendFreehandPoint(traceRef.current, pointAt(sample), distance);
    }
    setPolygon(traceRef.current);
  };
  const clearDrawing = () => {
    panRef.current = null;
    startRef.current = null;
    pointerRef.current = null;
    traceRef.current = [];
    setPolygon([]);
    setRect(null);
  };
  const attach = async () => {
    if (!snapshot || !areas.length || !imageRef.current || attaching) return;
    setAttaching(true);
    try {
      const { dataUrl: _dataUrl, ...metadata } = snapshot;
      const references: AgentAreaReference[] = [];
      for (const area of areas) {
        const image = await cropAreaImage(
          imageRef.current,
          area.rect,
          snapshot.compositionWidth,
          snapshot.compositionHeight,
          area.polygon,
        );
        references.push({
          ...metadata,
          rect: area.rect,
          ...(area.polygon ? { polygon: area.polygon } : {}),
          instruction: area.instruction,
          image,
        });
      }
      onAttach(references);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not attach the area.');
      setAttaching(false);
    }
  };

  const visibleAreas: DraftArea[] = [
    ...areas,
    ...(rect ? [{ id: 'drawing', rect, instruction: '' }] : []),
  ];

  return (
    <>
      {canvasHost && snapshot
        ? createPortal(
            <div
              className="area-capture-image area-capture-canvas-overlay"
              ref={overlayRef}
              role="region"
              aria-label="Mark areas on the main canvas"
              tabIndex={0}
              style={fit}
              onPointerDown={(event) => {
                if (pointerRef.current !== null || !event.isPrimary) return;
                if (event.button === 1) {
                  const viewport =
                    event.currentTarget.closest<HTMLElement>('.canvas-stage-viewport');
                  if (viewport) {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    pointerRef.current = event.pointerId;
                    panRef.current = { x: event.clientX, y: event.clientY, viewport };
                  }
                  return;
                }
                if (!ready || event.button !== 0 || attaching || areas.length >= maxAreas) return;
                event.currentTarget.focus({ preventScroll: true });
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                pointerRef.current = event.pointerId;
                startRef.current = pointAt(event);
                traceRef.current = [startRef.current];
                setPolygon(mode === 'freehand' ? traceRef.current : []);
                setRect(null);
                setError('');
              }}
              onPointerMove={(event) => {
                if (event.pointerId !== pointerRef.current) return;
                const pan = panRef.current;
                if (pan) {
                  pan.viewport.scrollLeft -= event.clientX - pan.x;
                  pan.viewport.scrollTop -= event.clientY - pan.y;
                  pan.x = event.clientX;
                  pan.y = event.clientY;
                  return;
                }
                if (startRef.current && mode === 'freehand') extendTrace(event);
                else if (startRef.current)
                  setRect(
                    areaRectFromPoints(
                      startRef.current,
                      pointAt(event),
                      snapshot.compositionWidth,
                      snapshot.compositionHeight,
                    ),
                  );
              }}
              onPointerUp={(event) => {
                if (event.pointerId !== pointerRef.current) return;
                if (panRef.current) {
                  clearDrawing();
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  return;
                }
                if (!startRef.current) return;
                if (mode === 'freehand') extendTrace(event, true);
                const selection =
                  mode === 'freehand'
                    ? freehandAreaFromPoints(
                        traceRef.current,
                        snapshot.compositionWidth,
                        snapshot.compositionHeight,
                      )
                    : {
                        rect: areaRectFromPoints(
                          startRef.current,
                          pointAt(event),
                          snapshot.compositionWidth,
                          snapshot.compositionHeight,
                        ),
                      };
                clearDrawing();
                event.currentTarget.releasePointerCapture(event.pointerId);
                if (selection && selection.rect.width >= 2 && selection.rect.height >= 2) {
                  const id = crypto.randomUUID();
                  setAreas((current) =>
                    [...current, { id, ...selection, instruction: '' }].slice(0, maxAreas),
                  );
                  requestAnimationFrame(() => {
                    const note = noteRefs.current[id];
                    note?.closest('.area-capture-note')?.scrollIntoView({ block: 'nearest' });
                    note?.focus({ preventScroll: true });
                  });
                } else if (mode === 'freehand') {
                  setError('Draw around an area, then release to close the outline.');
                }
              }}
              onPointerCancel={clearDrawing}
              onLostPointerCapture={clearDrawing}
            >
              <img
                ref={imageRef}
                src={snapshot.dataUrl}
                alt="Canvas snapshot to select an area from"
                draggable={false}
                onLoad={() => setReady(true)}
                onError={() => setError('Could not display the captured canvas.')}
              />
              {areas.length || rect || polygon.length ? (
                <svg
                  className="area-capture-shade"
                  viewBox={`0 0 ${snapshot.compositionWidth} ${snapshot.compositionHeight}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <mask id={maskId}>
                      <rect width="100%" height="100%" fill="white" />
                      {visibleAreas.map((area) =>
                        area.polygon ? (
                          <polygon
                            key={area.id}
                            points={area.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                            fill="black"
                            fillRule="evenodd"
                          />
                        ) : (
                          <rect key={area.id} {...area.rect} fill="black" />
                        ),
                      )}
                    </mask>
                  </defs>
                  <rect width="100%" height="100%" fill="#0009" mask={`url(#${maskId})`} />
                  {areas
                    .filter((area) => area.polygon)
                    .map((area) => (
                      <polygon
                        key={area.id}
                        className="area-capture-outline"
                        points={area.polygon!.map((p) => `${p.x},${p.y}`).join(' ')}
                      />
                    ))}
                  {polygon.length ? (
                    <polyline
                      className="area-capture-outline is-drawing"
                      points={polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                    />
                  ) : null}
                </svg>
              ) : null}
              {visibleAreas.map((area, index) => (
                <div
                  key={area.id}
                  className={`area-capture-selection${area.polygon ? ' is-freehand' : ''}`}
                  style={{
                    left: `${(area.rect.x / snapshot.compositionWidth) * 100}%`,
                    top: `${(area.rect.y / snapshot.compositionHeight) * 100}%`,
                    width: `${(area.rect.width / snapshot.compositionWidth) * 100}%`,
                    height: `${(area.rect.height / snapshot.compositionHeight) * 100}%`,
                  }}
                >
                  <span
                    className="area-capture-number"
                    style={{
                      left: index % 2 === 0 ? 0 : 'auto',
                      right: index % 2 === 1 ? 0 : 'auto',
                      top: index % 4 < 2 ? 0 : 'auto',
                      bottom: index % 4 >= 2 ? 0 : 'auto',
                    }}
                  >
                    {numberOffset + index + 1}
                  </span>
                </div>
              ))}
            </div>,
            canvasHost,
          )
        : null}
      <section
        className="area-capture-panel"
        aria-label="Canvas area annotations"
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="area-capture-toolbar">
          <strong>Mark areas</strong>
          <button type="button" onClick={() => onClose()}>
            Cancel
          </button>
          <button
            type="button"
            className="area-capture-attach"
            disabled={!ready || !areas.length || attaching || dictating}
            onClick={() => void attach()}
          >
            {attaching ? 'Attaching…' : `Attach areas (${areas.length})`}
          </button>
        </div>
        <div className="area-capture-modes" role="group" aria-label="Selection shape">
          {(['rectangle', 'freehand'] as const).map((shape) => (
            <button
              key={shape}
              type="button"
              aria-pressed={mode === shape}
              disabled={attaching}
              onClick={() => {
                clearDrawing();
                setMode(shape);
                setError('');
              }}
            >
              {shape === 'rectangle' ? 'Rectangle' : 'Freehand'}
            </button>
          ))}
        </div>
        <p className="area-capture-guidance">
          {snapshot
            ? `Frame ${Math.round(snapshot.frame)} snapshot · ${mode === 'freehand' ? 'Hold the left mouse button to draw. Release to select.' : 'Draw boxes on the main canvas.'}`
            : 'Capturing canvas…'}
        </p>
        {error ? (
          <div className="area-capture-error" role="alert">
            {error}
          </div>
        ) : null}
        <aside className="area-capture-notes" aria-label="Area instructions">
          {areas.length ? (
            areas.map((area, index) => (
              <div className="area-capture-note" key={area.id}>
                <div>
                  <strong>Area {numberOffset + index + 1}</strong>
                  <small>
                    {area.rect.width} × {area.rect.height}
                  </small>
                  <VoiceDictationButton
                    label={`area ${numberOffset + index + 1} annotation`}
                    disabled={attaching}
                    onError={setError}
                    onText={(spoken) =>
                      setAreas((current) =>
                        current.map((item) =>
                          item.id === area.id
                            ? {
                                ...item,
                                instruction: appendDictatedText(item.instruction, spoken),
                              }
                            : item,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    disabled={attaching || dictating}
                    aria-label={`Remove area ${numberOffset + index + 1}`}
                    onClick={() =>
                      setAreas((current) => current.filter((item) => item.id !== area.id))
                    }
                  >
                    ×
                  </button>
                </div>
                <textarea
                  ref={(element) => {
                    noteRefs.current[area.id] = element;
                  }}
                  aria-label={`Instruction for area ${numberOffset + index + 1}`}
                  placeholder="What should change here?"
                  rows={2}
                  maxLength={2000}
                  disabled={attaching}
                  value={area.instruction}
                  onChange={(event) =>
                    setAreas((current) =>
                      current.map((item) =>
                        item.id === area.id ? { ...item, instruction: event.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
            ))
          ) : (
            <p>
              Draw your first area on the canvas. You can add a separate instruction to each
              selection.
            </p>
          )}
        </aside>
        <div className="area-capture-footer">
          {dictating
            ? 'Stop dictation before attaching.'
            : areas.length >= maxAreas
              ? 'Area limit reached. Remove one to draw another.'
              : `${areas.length} / ${maxAreas} areas · Esc cancels.`}
        </div>
      </section>
    </>
  );
}
