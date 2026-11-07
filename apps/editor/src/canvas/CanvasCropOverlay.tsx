import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { cropRectPoints, type CropRect } from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import {
  useCropToolStore,
  type CropToolGeometry,
  type CropToolMatrix,
} from '../state/cropToolStore';
import './CanvasCropOverlay.css';

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type Mode = Handle | 'move' | 'draw';
const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const handleNames: Record<Handle, string> = {
  nw: 'top left',
  n: 'top',
  ne: 'top right',
  e: 'right',
  se: 'bottom right',
  s: 'bottom',
  sw: 'bottom left',
  w: 'left',
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const full: CropRect = { x: 0, y: 0, width: 1, height: 1 };

function affine(value: DOMMatrix): CropToolMatrix {
  return { a: value.a, b: value.b, c: value.c, d: value.d, e: value.e, f: value.f };
}

function domMatrix(value: CropToolMatrix): DOMMatrix {
  return new DOMMatrix([value.a, value.b, value.c, value.d, value.e, value.f]);
}

function invertible(value: DOMMatrix) {
  return (
    value.is2D &&
    [value.a, value.b, value.c, value.d, value.e, value.f].every(Number.isFinite) &&
    Math.abs(value.a * value.d - value.b * value.c) > 1e-10
  );
}

function point(matrix: CropToolMatrix, value: Point): Point {
  return {
    x: matrix.a * value.x + matrix.c * value.y + matrix.e,
    y: matrix.b * value.x + matrix.d * value.y + matrix.f,
  };
}

function cssMatrix(value: CropToolMatrix) {
  return `matrix(${value.a}, ${value.b}, ${value.c}, ${value.d}, ${value.e}, ${value.f})`;
}

function polygon(matrix: CropToolMatrix, rect: CropRect) {
  return cropRectPoints(rect).map((value) => point(matrix, value));
}

function path(points: Point[]) {
  return `${points.map((value, index) => `${index ? 'L' : 'M'} ${value.x} ${value.y}`).join(' ')} Z`;
}

/** Runtime transforms already include parenting, rules, motion paths, and auto layout. */
function measureLayer(element: HTMLDivElement, pasteboard: HTMLDivElement) {
  const owner = element.ownerDocument.defaultView;
  if (!owner) throw new Error('The selected layer is not attached to a canvas.');
  const style = owner.getComputedStyle(element);
  const width = Number.parseFloat(style.width) || element.offsetWidth;
  const height = Number.parseFloat(style.height) || element.offsetHeight;
  if (!(width > 0 && height > 0)) throw new Error('This layer has no visible bounds to crop.');
  let matrix = new DOMMatrix();
  let node: HTMLElement | null = element;
  while (node && node !== pasteboard) {
    const computed = owner.getComputedStyle(node);
    const transform = new DOMMatrix(computed.transform === 'none' ? undefined : computed.transform);
    if (!transform.is2D) throw new Error('Cropping requires a two-dimensional layer transform.');
    const origins = computed.transformOrigin.split(' ').map(Number.parseFloat);
    const ox = origins[0] || 0;
    const oy = origins[1] || 0;
    const local = new DOMMatrix()
      .translate(node.offsetLeft, node.offsetTop)
      .translate(ox, oy)
      .multiply(transform)
      .translate(-ox, -oy);
    matrix = local.multiply(matrix);
    node = node.offsetParent as HTMLElement | null;
  }
  if (node !== pasteboard || !invertible(matrix))
    throw new Error('The layer transform cannot be cropped. Restore a non-zero scale first.');
  return { width, height, matrix: affine(matrix) };
}

function selectionGeometry(
  layerIds: string[],
  layerRefs: Map<string, HTMLDivElement>,
  pasteboard: HTMLDivElement,
): CropToolGeometry {
  const entries = layerIds.map((layerId) => {
    const element = layerRefs.get(layerId);
    if (!element?.isConnected) throw new Error('The selected layer is not visible on the canvas.');
    return { layerId, ...measureLayer(element, pasteboard) };
  });
  if (!entries.length) throw new Error('Select a visible layer to crop.');
  const first = entries[0]!;
  if (entries.length === 1)
    return {
      entries,
      matrix: affine(domMatrix(first.matrix).scale(first.width, first.height)),
      pixelSize: { width: first.width, height: first.height },
    };
  const corners = entries.flatMap((entry) =>
    polygon(affine(domMatrix(entry.matrix).scale(entry.width, entry.height)), full),
  );
  const x = Math.min(...corners.map((value) => value.x));
  const y = Math.min(...corners.map((value) => value.y));
  const width = Math.max(...corners.map((value) => value.x)) - x;
  const height = Math.max(...corners.map((value) => value.y)) - y;
  if (!(width > 0 && height > 0)) throw new Error('This selection has no area to crop.');
  return {
    entries,
    matrix: { a: width, b: 0, c: 0, d: height, e: x, f: y },
    pixelSize: { width, height },
  };
}

function resizeCrop(
  original: CropRect,
  mode: Mode,
  start: Point,
  next: Point,
  size: Size,
): CropRect {
  const minWidth = Math.min(1, 1 / size.width);
  const minHeight = Math.min(1, 1 / size.height);
  if (mode === 'move')
    return {
      ...original,
      x: clamp(original.x + next.x - start.x, 0, 1 - original.width),
      y: clamp(original.y + next.y - start.y, 0, 1 - original.height),
    };
  const p = { x: clamp(next.x, 0, 1), y: clamp(next.y, 0, 1) };
  if (mode === 'draw') {
    const x = Math.min(start.x, p.x, 1 - minWidth);
    const y = Math.min(start.y, p.y, 1 - minHeight);
    return {
      x,
      y,
      width: Math.max(minWidth, Math.abs(p.x - start.x)),
      height: Math.max(minHeight, Math.abs(p.y - start.y)),
    };
  }
  let left = original.x;
  let top = original.y;
  let right = original.x + original.width;
  let bottom = original.y + original.height;
  if (mode.includes('w')) left = Math.min(p.x, right - minWidth);
  if (mode.includes('e')) right = Math.max(p.x, left + minWidth);
  if (mode.includes('n')) top = Math.min(p.y, bottom - minHeight);
  if (mode.includes('s')) bottom = Math.max(p.y, top + minHeight);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function handlePoint(rect: CropRect, handle: Handle): Point {
  return {
    x: rect.x + rect.width * (handle.includes('w') ? 0 : handle.includes('e') ? 1 : 0.5),
    y: rect.y + rect.height * (handle.includes('n') ? 0 : handle.includes('s') ? 1 : 0.5),
  };
}

function handleCursor(matrix: CropToolMatrix, handle: Handle) {
  const vector = {
    x: handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0,
    y: handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0,
  };
  const angle = Math.atan2(
    matrix.b * vector.x + matrix.d * vector.y,
    matrix.a * vector.x + matrix.c * vector.y,
  );
  const direction = ((Math.round(angle / (Math.PI / 4)) % 4) + 4) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][direction];
}

interface ScreenGeometry {
  matrix: CropToolMatrix;
  size: Size;
  pixelSize: Size;
}

export function CanvasCropOverlay({
  viewportRef,
  pasteboardRef,
  layerRefs,
  zoom,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  pasteboardRef: RefObject<HTMLDivElement | null>;
  layerRefs: RefObject<Map<string, HTMLDivElement>>;
  zoom: number;
}) {
  const request = useCropToolStore((state) => state.request);
  const storeError = useCropToolStore((state) => state.error);
  const [screen, setScreen] = useState<ScreenGeometry | null>(null);
  const [error, setError] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const mediaSize = useRef<{ requestId: string; size: Size } | null>(null);
  const drag = useRef<{
    pointerId: number;
    mode: Mode;
    start: Point;
    original: CropRect;
  } | null>(null);

  useEffect(() => {
    setScreen(null);
    setError('');
    drag.current = null;
    if (!request) return;
    const requestId = request.id;
    const viewport = viewportRef.current;
    const pasteboard = pasteboardRef.current;
    const owner = viewport?.ownerDocument.defaultView;
    if (!viewport || !pasteboard || !owner) return;
    let tick = 0;
    let frame = 0;
    let stopped = false;
    let frozen: CropToolGeometry | null = null;
    let previousScreen = '';
    let previousGeometry = '';
    owner.focus();
    overlayRef.current?.focus({ preventScroll: true });
    const measure = () => {
      if (stopped) return;
      const current = useCropToolStore.getState().request;
      if (!current || current.id !== requestId) return;
      // Let Stage's runtime sampler finish applying the requested frame before measuring.
      if (++tick < 2) {
        frame = owner.requestAnimationFrame(measure);
        return;
      }
      try {
        const project = useProjectStore.getState().project;
        const composition = project.compositions.find(
          (value) => value.id === current.compositionId,
        );
        if (!composition) return;
        const viewportBounds = viewport.getBoundingClientRect();
        const pasteboardBounds = pasteboard.getBoundingClientRect();
        const zoomValue = zoomRef.current;
        if (!(zoomValue > 0)) throw new Error('The canvas is not visible at this zoom.');
        const compositionToScreen = new DOMMatrix([
          zoomValue,
          0,
          0,
          zoomValue,
          pasteboardBounds.left - viewportBounds.left,
          pasteboardBounds.top - viewportBounds.top,
        ]);
        const size = { width: viewport.clientWidth, height: viewport.clientHeight };
        let geometry: CropToolGeometry;
        if (current.kind === 'source') {
          if (!current.source?.src) throw new Error('Choose media before cropping its source.');
          const natural =
            mediaSize.current?.requestId === requestId ? mediaSize.current.size : null;
          if (!natural) {
            frame = owner.requestAnimationFrame(measure);
            return;
          }
          const target = current.source.layerId
            ? layerRefs.current.get(current.source.layerId)
            : undefined;
          if (!frozen && target) {
            const targetFrame = measureLayer(target, pasteboard);
            const scale = Math.min(
              targetFrame.width / natural.width,
              targetFrame.height / natural.height,
            );
            const width = natural.width * scale;
            const height = natural.height * scale;
            frozen = {
              entries: [],
              matrix: affine(
                domMatrix(targetFrame.matrix)
                  .translate((targetFrame.width - width) / 2, (targetFrame.height - height) / 2)
                  .scale(width, height),
              ),
              pixelSize: natural,
            };
          }
          if (frozen) geometry = frozen;
          else {
            const scale = Math.min(
              Math.max(1, size.width - 96) / natural.width,
              Math.max(1, size.height - 152) / natural.height,
            );
            const width = natural.width * scale;
            const height = natural.height * scale;
            geometry = {
              entries: [],
              matrix: affine(
                compositionToScreen
                  .inverse()
                  .translate((size.width - width) / 2, (size.height - height) / 2 + 12)
                  .scale(width, height),
              ),
              pixelSize: natural,
            };
          }
        } else {
          if (!frozen)
            frozen =
              current.kind === 'canvas'
                ? {
                    entries: [],
                    matrix: { a: composition.width, b: 0, c: 0, d: composition.height, e: 0, f: 0 },
                    pixelSize: { width: composition.width, height: composition.height },
                  }
                : selectionGeometry(current.layerIds, layerRefs.current, pasteboard);
          geometry = frozen;
        }
        const nextGeometry = JSON.stringify(geometry);
        if (nextGeometry !== previousGeometry) {
          useCropToolStore.getState().configureGeometry(geometry);
          previousGeometry = nextGeometry;
        }
        const matrix = compositionToScreen.multiply(domMatrix(geometry.matrix));
        if (!invertible(matrix)) throw new Error('The crop area has no visible size.');
        const next = { matrix: affine(matrix), size, pixelSize: geometry.pixelSize };
        const signature = JSON.stringify(next);
        if (signature !== previousScreen) {
          setScreen(next);
          previousScreen = signature;
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The crop area could not be displayed.');
        setScreen(null);
        return;
      }
      frame = owner.requestAnimationFrame(measure);
    };
    frame = owner.requestAnimationFrame(measure);
    return () => {
      stopped = true;
      owner.cancelAnimationFrame(frame);
      drag.current = null;
    };
    // A crop session freezes the rendered layer frame; zoom and scroll only change screen placement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id, viewportRef, pasteboardRef, layerRefs]);

  if (!request) return null;
  const current = request.draft;
  const cropPoints = screen ? polygon(screen.matrix, current) : [];
  const fullPoints = screen ? polygon(screen.matrix, full) : [];
  const title =
    request.kind === 'canvas'
      ? 'Crop canvas'
      : request.kind === 'source'
        ? 'Crop source'
        : request.layerIds.length > 1
          ? 'Crop group'
          : 'Crop layer';
  const position = (event: ReactPointerEvent<HTMLDivElement>): Point | null => {
    if (!screen) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    return point(affine(domMatrix(screen.matrix).inverse()), {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };
  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || !screen) return;
    const target = event.target as Element;
    if (target.closest('.canvas-crop-toolbar')) return;
    event.stopPropagation();
    event.preventDefault();
    const handle = target.closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle as
      Handle | undefined;
    const p = position(event);
    if (!p) return;
    if (!handle && (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return;
    const inside =
      p.x >= current.x &&
      p.x <= current.x + current.width &&
      p.y >= current.y &&
      p.y <= current.y + current.height;
    const mode: Mode = handle ?? (inside && !event.shiftKey ? 'move' : 'draw');
    drag.current = {
      pointerId: event.pointerId,
      mode,
      start: { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) },
      original: current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !screen) return;
    const p = position(event);
    if (!p) return;
    event.preventDefault();
    event.stopPropagation();
    useCropToolStore
      .getState()
      .setDraft(resizeCrop(gesture.original, gesture.mode, gesture.start, p, screen.pixelSize));
  };
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    event.stopPropagation();
  };
  const sourceSize = screen?.pixelSize;
  const sourceStyle: CSSProperties =
    screen && sourceSize
      ? {
          width: sourceSize.width,
          height: sourceSize.height,
          transform: cssMatrix(
            affine(domMatrix(screen.matrix).scale(1 / sourceSize.width, 1 / sourceSize.height)),
          ),
        }
      : { visibility: 'hidden', width: 1, height: 1 };

  return (
    <div
      ref={overlayRef}
      className="canvas-crop-overlay"
      role="region"
      aria-label={title}
      tabIndex={-1}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={(event) => {
        const gesture = drag.current;
        if (gesture) useCropToolStore.getState().setDraft(gesture.original);
        finish(event);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onMouseDown={(event) => {
        if (event.button === 0) event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {request.kind === 'source' && request.source?.src ? (
        <div className="canvas-crop-source" style={sourceStyle}>
          {request.source.video ? (
            <video
              key={`${request.id}:video`}
              src={request.source.src}
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (video.videoWidth && video.videoHeight)
                  mediaSize.current = {
                    requestId: request.id,
                    size: { width: video.videoWidth, height: video.videoHeight },
                  };
                const liveVideo = request.source?.layerId
                  ? layerRefs.current.get(request.source.layerId)?.querySelector('video')
                  : null;
                if (liveVideo && Number.isFinite(liveVideo.currentTime))
                  video.currentTime = liveVideo.currentTime;
              }}
              onError={() => setError('The video source could not be loaded for cropping.')}
            />
          ) : (
            <img
              key={`${request.id}:image`}
              src={request.source.src}
              alt="Uncropped source"
              draggable={false}
              onLoad={(event) => {
                mediaSize.current = {
                  requestId: request.id,
                  size: {
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  },
                };
              }}
              onError={() => setError('The image source could not be loaded for cropping.')}
            />
          )}
        </div>
      ) : null}
      {screen ? (
        <>
          <svg className="canvas-crop-guides" width="100%" height="100%" aria-hidden="true">
            <path
              d={`M 0 0 H ${screen.size.width} V ${screen.size.height} H 0 Z ${path(cropPoints)}`}
              fillRule="evenodd"
              className="canvas-crop-dim"
            />
            <path d={path(cropPoints)} className="canvas-crop-hit" />
            <path d={path(fullPoints)} className="canvas-crop-full-outline" />
            <path d={path(cropPoints)} className="canvas-crop-outline-shadow" />
            <path d={path(cropPoints)} className="canvas-crop-outline" />
            {[1 / 3, 2 / 3]
              .flatMap((part) => [
                [
                  point(screen.matrix, { x: current.x + current.width * part, y: current.y }),
                  point(screen.matrix, {
                    x: current.x + current.width * part,
                    y: current.y + current.height,
                  }),
                ],
                [
                  point(screen.matrix, { x: current.x, y: current.y + current.height * part }),
                  point(screen.matrix, {
                    x: current.x + current.width,
                    y: current.y + current.height * part,
                  }),
                ],
              ])
              .map((points, index) => (
                <line
                  key={index}
                  x1={points[0]!.x}
                  y1={points[0]!.y}
                  x2={points[1]!.x}
                  y2={points[1]!.y}
                  className="canvas-crop-thirds"
                />
              ))}
          </svg>
          {handles.map((handle) => {
            const p = point(screen.matrix, handlePoint(current, handle));
            return (
              <button
                key={handle}
                type="button"
                className="canvas-crop-handle"
                data-crop-handle={handle}
                aria-label={`Resize crop ${handleNames[handle]}`}
                title="Drag to resize; arrow keys adjust by one pixel"
                style={{ left: p.x, top: p.y, cursor: handleCursor(screen.matrix, handle) }}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  const step = event.shiftKey ? 10 : 1;
                  const startPoint = handlePoint(current, handle);
                  const next = {
                    x:
                      startPoint.x +
                      (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) /
                        screen.pixelSize.width,
                    y:
                      startPoint.y +
                      (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) /
                        screen.pixelSize.height,
                  };
                  useCropToolStore
                    .getState()
                    .setDraft(resizeCrop(current, handle, startPoint, next, screen.pixelSize));
                }}
              />
            );
          })}
        </>
      ) : null}
      <div
        className="canvas-crop-toolbar"
        role="toolbar"
        aria-label="Crop controls"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <strong>{title}</strong>
        {screen ? (
          <output>
            {Math.round(current.width * screen.pixelSize.width)} ×{' '}
            {Math.round(current.height * screen.pixelSize.height)} px
          </output>
        ) : null}
        <button
          type="button"
          title="Restore the full uncropped bounds"
          onClick={() => useCropToolStore.getState().resetDraft()}
        >
          Reset
        </button>
        <button
          type="button"
          title="Cancel crop (Escape)"
          onClick={() => useCropToolStore.getState().close()}
        >
          Cancel
        </button>
        <button
          type="button"
          className="canvas-crop-apply"
          disabled={!screen || !!error}
          title="Apply crop (Enter)"
          onClick={() => useCropToolStore.getState().apply()}
        >
          Apply
        </button>
      </div>
      {error || storeError ? (
        <div className="canvas-crop-message is-error" role="alert">
          {error || storeError}
        </div>
      ) : (
        <div className="canvas-crop-message">
          Drag handles to crop · Drag inside to move · Shift-drag to draw · Enter to apply · Esc to
          cancel
        </div>
      )}
    </div>
  );
}
