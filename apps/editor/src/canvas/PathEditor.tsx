import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  editPathGeometry,
  parseEditablePath,
  type Layer,
  type LayerTransform,
  type PathEdit,
  type PathPoint,
} from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { runDiscreteHistoryStep, undo, redo } from '../state/historyStore';
import { usePathEditStore } from '../state/pathEditStore';
import './PathEditor.css';

interface Props {
  layer: Layer;
  pose: LayerTransform;
  zoom: number;
  container: HTMLDivElement | null;
  onPreview: (d: string | null) => void;
}
type Selection = { contour: number; node: number };
type Drag = Selection & {
  pointerId: number;
  source: string;
  incoming?: boolean;
  handle: boolean;
  start: PathPoint;
  latest: PathEdit | null;
};

export function PathEditor({ layer, pose, zoom, container, onPreview }: Props) {
  const [selection, setSelection] = useState<Selection>({ contour: 0, node: 0 });
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const group = useRef<SVGGElement>(null);
  const d = layer.element.type === 'path' ? layer.element.d : '';
  const parsed = useMemo(() => {
    try {
      return { paths: parseEditablePath(draft ?? d), error: null };
    } catch (e) {
      return { paths: [], error: (e as Error).message };
    }
  }, [d, draft]);
  const current = parsed.paths[selection.contour]?.nodes[selection.node];
  const stop = usePathEditStore((s) => s.stop);
  const commit = (edit: PathEdit) => {
    try {
      runDiscreteHistoryStep(() => useProjectStore.getState().editLayerPath(layer.id, edit));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const change = (action: PathEdit['action']) => {
    commit({ action, expectedD: d, ...selection });
    if (action === 'remove') setSelection({ ...selection, node: Math.max(0, selection.node - 1) });
  };
  const cancel = useCallback(() => {
    drag.current = null;
    setDraft(null);
    onPreview(null);
  }, [onPreview]);
  // Selection, undo, or a remote edit invalidates any active gesture; never overwrite newer data.
  useEffect(() => {
    cancel();
  }, [
    cancel,
    d,
    layer.id,
    pose.x,
    pose.y,
    pose.width,
    pose.height,
    pose.rotation,
    pose.transformOriginX,
    pose.transformOriginY,
  ]);
  useEffect(() => () => onPreview(null), [onPreview]);
  if (layer.element.type !== 'path') return null;
  const el = layer.element,
    sx = pose.width / el.viewBoxWidth,
    sy = pose.height / el.viewBoxHeight;
  const screenPoint = (clientX: number, clientY: number): PathPoint => {
    const matrix = group.current?.getScreenCTM();
    if (!matrix) throw new Error('The path editor is not visible.');
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  };
  const keyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      if (event.key.toLowerCase() === 'y' || event.shiftKey) redo();
      else undo();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (drag.current) cancel();
      else stop();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      change('remove');
      return;
    }
    if (current && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      commit({
        action: 'move',
        expectedD: d,
        ...selection,
        x: current.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        y: current.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
      });
    }
  };
  return (
    <>
      <div
        className="path-editor-toolbar"
        role="toolbar"
        aria-label="Path editing"
        title="Drag anchors; Shift constrains movement. Arrows nudge; Shift nudges 10 units. Alt-drag a handle independently. Escape cancels a drag or exits."
        onKeyDown={keyDown}
      >
        <strong>Path</strong>
        <button
          onClick={() => change('insert')}
          disabled={!current}
          title="Split the following segment at its midpoint without changing its curve"
        >
          + Point
        </button>
        <button onClick={() => change('remove')} disabled={!current} title="Remove selected anchor">
          Remove point
        </button>
        <button
          onClick={() => change('smooth')}
          disabled={!current}
          title="Align handles into a smooth curve"
        >
          Smooth
        </button>
        <button
          onClick={() => change('corner')}
          disabled={!current}
          title="Remove this anchor's curve handles"
        >
          Corner
        </button>
        <span className="path-editor-hint">
          Drag points · Alt-drag handles independently · arrows nudge
        </span>
        <button onClick={stop} title="Finish editing points (Escape)">
          Done
        </button>
      </div>
      {(error || parsed.error) && (
        <div className="path-editor-error" role="alert">
          {error || parsed.error}
        </div>
      )}
      {container &&
        createPortal(
          <svg
            className="path-editor-overlay"
            width={pose.width}
            height={pose.height}
            style={{
              left: pose.x,
              top: pose.y,
              transform: `rotate(${pose.rotation}deg)`,
              transformOrigin: `${pose.transformOriginX * 100}% ${pose.transformOriginY * 100}%`,
            }}
            aria-label={`Edit path points: ${layer.name}`}
            tabIndex={0}
            onKeyDown={keyDown}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onPointerMove={(event) => {
              const gesture = drag.current;
              if (!gesture || gesture.pointerId !== event.pointerId) return;
              event.preventDefault();
              event.stopPropagation();
              const p = screenPoint(event.clientX, event.clientY);
              const sourceNode = parseEditablePath(gesture.source)[gesture.contour]!.nodes[
                gesture.node
              ]!;
              let edit: PathEdit;
              if (gesture.handle) {
                edit = {
                  action: 'handles',
                  expectedD: gesture.source,
                  contour: gesture.contour,
                  node: gesture.node,
                  [gesture.incoming ? 'incoming' : 'outgoing']: p,
                };
                const opposite = gesture.incoming ? sourceNode.out : sourceNode.in;
                if (!event.altKey && opposite) {
                  const len = Math.hypot(opposite.x - sourceNode.x, opposite.y - sourceNode.y),
                    dx = p.x - sourceNode.x,
                    dy = p.y - sourceNode.y,
                    n = Math.hypot(dx, dy) || 1;
                  edit[gesture.incoming ? 'outgoing' : 'incoming'] = {
                    x: sourceNode.x - (dx / n) * len,
                    y: sourceNode.y - (dy / n) * len,
                  };
                }
              } else {
                let dx = p.x - gesture.start.x,
                  dy = p.y - gesture.start.y;
                if (event.shiftKey) {
                  if (Math.abs(dx) > Math.abs(dy)) dy = 0;
                  else dx = 0;
                }
                edit = {
                  action: 'move',
                  expectedD: gesture.source,
                  contour: gesture.contour,
                  node: gesture.node,
                  x: sourceNode.x + dx,
                  y: sourceNode.y + dy,
                };
              }
              const next = editPathGeometry(gesture.source, edit);
              gesture.latest = edit;
              setDraft(next);
              onPreview(next);
            }}
            onPointerUp={(event) => {
              const gesture = drag.current;
              if (!gesture || gesture.pointerId !== event.pointerId) return;
              event.stopPropagation();
              if (gesture.latest) commit(gesture.latest);
              cancel();
            }}
            onPointerCancel={cancel}
            onLostPointerCapture={() => {
              if (drag.current) cancel();
            }}
          >
            <g ref={group} transform={`scale(${sx} ${sy})`}>
              <path
                d={draft ?? d}
                fill="none"
                stroke="#43cfff"
                strokeWidth={1.2 / zoom}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
              {parsed.paths.flatMap((contour, ci) =>
                contour.nodes.map((node, ni) => {
                  const chosen = ci === selection.contour && ni === selection.node;
                  const start = (
                    event: React.PointerEvent<SVGElement>,
                    handle = false,
                    incoming = false,
                  ) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setSelection({ contour: ci, node: ni });
                    const svg = event.currentTarget.ownerSVGElement!;
                    svg.focus();
                    svg.setPointerCapture(event.pointerId);
                    drag.current = {
                      contour: ci,
                      node: ni,
                      pointerId: event.pointerId,
                      source: d,
                      handle,
                      incoming,
                      start: screenPoint(event.clientX, event.clientY),
                      latest: null,
                    };
                  };
                  const radiusX = 4 / (zoom * sx),
                    radiusY = 4 / (zoom * sy);
                  return (
                    <g key={`${ci}:${ni}`}>
                      {chosen &&
                        (['in', 'out'] as const).map(
                          (key) =>
                            node[key] && (
                              <g key={key}>
                                <line
                                  x1={node.x}
                                  y1={node.y}
                                  x2={node[key]!.x}
                                  y2={node[key]!.y}
                                  stroke="#ffc76a"
                                  strokeWidth={1 / zoom}
                                  vectorEffect="non-scaling-stroke"
                                  pointerEvents="none"
                                />
                                <ellipse
                                  cx={node[key]!.x}
                                  cy={node[key]!.y}
                                  rx={radiusX}
                                  ry={radiusY}
                                  fill="#ffc76a"
                                  stroke="#17191d"
                                  strokeWidth={1 / zoom}
                                  vectorEffect="non-scaling-stroke"
                                  className="path-editor-handle"
                                  onPointerDown={(e) => start(e, true, key === 'in')}
                                >
                                  <title>
                                    {key === 'in' ? 'Incoming' : 'Outgoing'} curve handle
                                  </title>
                                </ellipse>
                              </g>
                            ),
                        )}
                      <rect
                        x={node.x - radiusX}
                        y={node.y - radiusY}
                        width={radiusX * 2}
                        height={radiusY * 2}
                        fill={chosen ? '#43cfff' : '#202631'}
                        stroke="#43cfff"
                        strokeWidth={1 / zoom}
                        vectorEffect="non-scaling-stroke"
                        className="path-editor-anchor"
                        role="button"
                        tabIndex={0}
                        onFocus={() => setSelection({ contour: ci, node: ni })}
                        aria-label={`Contour ${ci + 1} point ${ni + 1}`}
                        onPointerDown={(e) => start(e)}
                      >
                        <title>
                          Point {ni + 1} · {node.x.toFixed(1)}, {node.y.toFixed(1)}
                        </title>
                      </rect>
                    </g>
                  );
                }),
              )}
            </g>
          </svg>,
          container,
        )}
    </>
  );
}
