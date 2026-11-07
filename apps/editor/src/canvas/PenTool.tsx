import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { serializeEditablePath, type PathAnchor, type PathPoint } from '@ograf-editor/scene-model';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { usePenToolStore } from '../state/penToolStore';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { constrainPenAngle, penPath } from './penGeometry';

/** Temporary canvas overlay; commits an ordinary editable SVG path in one history step. */
export function PenTool({ width, height, zoom }: { width: number; height: number; zoom: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<PathAnchor[]>([]);
  const drag = useRef<number | null>(null);
  const [nodes, setNodes] = useState<PathAnchor[]>([]);
  const [cursor, setCursor] = useState<PathPoint | null>(null);
  const update = (next: PathAnchor[]) => {
    nodesRef.current = next;
    setNodes(next);
  };
  const finish = (closed: boolean) => {
    const current = nodesRef.current;
    if (current.length >= (closed ? 3 : 2)) {
      const path = penPath(current, closed);
      runDiscreteHistoryStep(() => {
        const id = useProjectStore.getState().addDrawnPath(path);
        useSelectionStore.getState().select(id);
      }, 'Draw path');
    }
    usePenToolStore.getState().stop();
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(false);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  const point = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  };
  const preview = nodes.length
    ? serializeEditablePath([
        { nodes: cursor && drag.current === null ? [...nodes, cursor] : nodes, closed: false },
      ])
    : '';
  return (
    <svg
      ref={svg}
      className="pen-tool-overlay"
      aria-label="Pen drawing canvas"
      style={{
        position: 'absolute',
        inset: 0,
        width,
        height,
        zIndex: 100,
        cursor: 'crosshair',
        touchAction: 'none',
        overflow: 'visible',
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        let p = point(event);
        const current = nodesRef.current;
        if (
          current.length >= 3 &&
          Math.hypot(p.x - current[0]!.x, p.y - current[0]!.y) * zoom <= 12
        ) {
          finish(true);
          return;
        }
        if (event.shiftKey && current.length)
          p = constrainPenAngle(current[current.length - 1]!, p);
        update([...current, p]);
        drag.current = current.length;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        let p = point(event);
        if (drag.current !== null) {
          const current = nodesRef.current;
          const anchor = current[drag.current]!;
          if (event.shiftKey) p = constrainPenAngle(anchor, p);
          if (Math.hypot(p.x - anchor.x, p.y - anchor.y) * zoom > 3) {
            update(
              current.map((n, i) =>
                i === drag.current
                  ? {
                      x: anchor.x,
                      y: anchor.y,
                      out: p,
                      in: { x: 2 * anchor.x - p.x, y: 2 * anchor.y - p.y },
                    }
                  : n,
              ),
            );
          }
        } else {
          if (event.shiftKey && nodesRef.current.length)
            p = constrainPenAngle(nodesRef.current.at(-1)!, p);
          setCursor(p);
        }
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {preview && <path d={preview} fill="none" stroke="#38bdf8" strokeWidth={2 / zoom} />}
      {nodes.map((n, i) => (
        <g key={i}>
          {n.in && n.out && (
            <line
              x1={n.in.x}
              y1={n.in.y}
              x2={n.out.x}
              y2={n.out.y}
              stroke="#38bdf8"
              strokeWidth={1 / zoom}
            />
          )}
          <circle
            cx={n.x}
            cy={n.y}
            r={5 / zoom}
            fill={i === 0 ? '#fff' : '#38bdf8'}
            stroke="#075985"
            strokeWidth={1 / zoom}
          />
        </g>
      ))}
    </svg>
  );
}
