import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  getResolvedLayerAnimationTracks,
  getLayerPropertyValueAtFrame,
  animatablePropertyLabel,
  type AnimatableLayerProperty,
  type Layer,
} from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { ContextMenu } from '../components/ContextMenu';
import {
  commitAnimationGraphDrag,
  deleteAnimationGraphKey,
  insertAnimationGraphKey,
  seekGraphFrame,
  type GraphKeyEdit,
  type GraphKeyTarget,
  type GraphKeyInsertion,
} from './animationGraphEditing';
import {
  timelineGraphBounds,
  animationGraphPath,
  createAnimationGraphDrag,
  graphCoordinates,
  type AnimationGraphDrag,
} from './animationGraph';
import { graphKeyForContextMenu, graphInsertionAtPoint } from './animationGraphContext';
import './AnimationGraphEditor.css';

const WIDTH = 720;
const HEIGHT = 180;

export interface TimelineGraphViewport {
  left: number;
  width: number;
  scrollLeft: number;
  pixelsPerFrame: number;
}

interface GraphDrag extends GraphKeyEdit {
  pointerId: number;
  svg: SVGSVGElement;
  geometry: AnimationGraphDrag;
}

interface GraphKeyMenu {
  x: number;
  y: number;
  target: GraphKeyTarget | null;
  insertion: GraphKeyInsertion | null;
}

export function AnimationGraphEditor({
  layer,
  property,
  durationFrames,
  viewport,
  ticks = [],
  lifecycleFrames = [],
  currentFrame = 0,
  onHorizontalScroll,
}: {
  layer: Layer;
  property: AnimatableLayerProperty;
  durationFrames: number;
  viewport?: TimelineGraphViewport;
  ticks?: number[];
  lifecycleFrames?: number[];
  currentFrame?: number;
  onHorizontalScroll?: (delta: number) => void;
}) {
  const width = Math.max(1, viewport?.width ?? WIDTH);
  const pixelsPerFrame = viewport?.pixelsPerFrame ?? WIDTH / Math.max(1, durationFrames);
  const scrollLeft = viewport?.scrollLeft ?? 0;
  const [drag, setDrag] = useState<GraphDrag | null>(null);
  const [keyMenu, setKeyMenu] = useState<GraphKeyMenu | null>(null);
  const dragRef = useRef<GraphDrag | null>(null);
  const keys = useMemo(
    () =>
      layer.animationTrackMode === 'independent'
        ? (layer.animationTracks[property] ?? [])
        : (getResolvedLayerAnimationTracks(layer)[property] ?? []),
    [layer, property],
  );
  const staticValue = keys.length ? 0 : getLayerPropertyValueAtFrame(layer, property, currentFrame);
  const computedBounds = useMemo(
    () =>
      timelineGraphBounds(keys.length ? keys : [{ frame: 0, value: staticValue }], durationFrames, {
        width,
        pixelsPerFrame,
        scrollLeft,
      }),
    [durationFrames, keys, width, pixelsPerFrame, scrollLeft, staticValue],
  );
  const activeDrag = drag?.layerId === layer.id && drag.property === property ? drag : null;
  const bounds = activeDrag?.geometry.bounds ?? computedBounds;
  const previewKeys = activeDrag
    ? keys
        .map((key) => (key.id === activeDrag.keyframeId ? { ...key, ...activeDrag.preview } : key))
        .sort((left, right) => left.frame - right.frame)
    : keys;
  const path = useMemo(
    () =>
      animationGraphPath(previewKeys, bounds, width, HEIGHT, 0, {
        minFrame: 0,
        maxFrame: durationFrames,
      }),
    [previewKeys, bounds, width, durationFrames],
  );
  const frameX = (frame: number) => graphCoordinates(frame, 0, bounds, width, HEIGHT, 0).x;
  const selected = useSelectionStore((state) => state.selectedLayerKeyframes);
  const selectKey = useSelectionStore((state) => state.selectLayerKeyframe);
  const selectKeys = useSelectionStore((state) => state.selectLayerKeyframes);
  const trackTarget = (): Omit<GraphKeyTarget, 'keyframeId'> => {
    const state = useProjectStore.getState();
    return {
      projectId: state.project.id,
      compositionId: state.activeCompositionId,
      layerId: layer.id,
      property,
      originalTrack: structuredClone(keys),
    };
  };
  const keyTarget = (keyframeId: string): GraphKeyTarget => ({ ...trackTarget(), keyframeId });

  const releaseCapture = (drag: GraphDrag) => {
    if (drag.svg.hasPointerCapture(drag.pointerId)) drag.svg.releasePointerCapture(drag.pointerId);
  };
  const finishDrag = (commit: boolean, pointerId: number) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== pointerId) return;
    dragRef.current = null;
    setDrag(null);
    releaseCapture(current);
    if (commit) commitAnimationGraphDrag(current);
  };
  const openKeyMenu = (
    keyframeId: string | null,
    x: number,
    y: number,
    insertion: { frame: number; value: number } | null = null,
  ) => {
    if (dragRef.current) finishDrag(false, dragRef.current.pointerId);
    if (keyframeId) selectKey(layer.id, keyframeId, property);
    setKeyMenu({
      target: keyframeId ? keyTarget(keyframeId) : null,
      insertion: insertion ? { ...trackTarget(), ...insertion } : null,
      x,
      y,
    });
  };
  useEffect(() => {
    setDrag(null);
    return () => {
      const current = dragRef.current;
      dragRef.current = null;
      if (current) releaseCapture(current);
    };
  }, [layer.id, property, width, pixelsPerFrame, scrollLeft]);
  useEffect(() => {
    setKeyMenu(null);
  }, [layer.id, property]);

  const updateFromPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const preview = current.geometry.sample({ x: event.clientX, y: event.clientY });
    preview.frame = Math.max(0, Math.min(durationFrames, preview.frame));
    if (
      current.originalTrack.some(
        (key) => key.id !== current.keyframeId && key.frame === preview.frame,
      )
    )
      preview.frame = current.preview.frame;
    const next = { ...current, preview };
    dragRef.current = next;
    setDrag(next);
  };

  return (
    <section className="animation-graph-editor" aria-label="Animation graph editor">
      <header title="Drag keys horizontally for time and vertically for value. Right-click empty space to add a key at that time and value, or a key/selected curve for actions. Frame scale and scrolling follow Timeline. Edit segment curves in Property easing.">
        <strong>Graph · {property}</strong>
        {keys.length === 0 && <span role="status">No keyframes — right-click to add one.</span>}
        <span>
          {bounds.minValue.toFixed(2)} – {bounds.maxValue.toFixed(2)}
        </span>
      </header>
      <div
        className="animation-graph-viewport"
        style={{ marginLeft: viewport?.left ?? 0, width }}
        onWheel={(event) => {
          const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
          if (delta && onHorizontalScroll) onHorizontalScroll(delta);
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="none"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const matrix = event.currentTarget.getScreenCTM();
            const points = matrix
              ? previewKeys
                  .filter((key) => key.frame >= bounds.minFrame && key.frame <= bounds.maxFrame)
                  .map((key) => {
                    const point = graphCoordinates(key.frame, key.value, bounds, width, HEIGHT, 0);
                    return {
                      id: key.id,
                      x: matrix.a * point.x + matrix.c * point.y + matrix.e,
                      y: matrix.b * point.x + matrix.d * point.y + matrix.f,
                    };
                  })
              : [];
            const selectedIds = selected
              .filter((key) => key.layerId === layer.id && key.property === property)
              .map((key) => key.keyframeId);
            const targetId = graphKeyForContextMenu(points, selectedIds, {
              x: event.clientX,
              y: event.clientY,
            });
            let insertion = null;
            if (matrix) {
              try {
                insertion = graphInsertionAtPoint(
                  { x: event.clientX, y: event.clientY },
                  matrix.inverse(),
                  bounds,
                  width,
                  HEIGHT,
                  durationFrames,
                );
              } catch {
                // A transient non-invertible SVG transform cannot produce an authored key.
              }
            }
            openKeyMenu(targetId, event.clientX, event.clientY, insertion);
          }}
          onPointerMove={updateFromPointer}
          onPointerUp={(event) => {
            updateFromPointer(event);
            finishDrag(true, event.pointerId);
          }}
          onPointerCancel={(event) => finishDrag(false, event.pointerId)}
          onLostPointerCapture={(event) => finishDrag(false, event.pointerId)}
        >
          <rect x={0} y={0} width={width} height={HEIGHT} />
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line key={ratio} x1={0} x2={width} y1={ratio * HEIGHT} y2={ratio * HEIGHT} />
          ))}
          {ticks
            .filter((frame) => frame >= bounds.minFrame && frame <= bounds.maxFrame)
            .map((frame) => (
              <line
                key={frame}
                className="animation-graph-frame-grid"
                x1={frameX(frame)}
                x2={frameX(frame)}
                y1={0}
                y2={HEIGHT}
              />
            ))}
          {[...new Set([0, durationFrames, ...lifecycleFrames])]
            .filter((frame) => frame >= bounds.minFrame && frame <= bounds.maxFrame)
            .map((frame) => (
              <line
                key={frame}
                data-frame={frame}
                className="animation-graph-boundary"
                x1={frameX(frame)}
                x2={frameX(frame)}
                y1={0}
                y2={HEIGHT}
              />
            ))}
          <path d={path} />
          <line
            className="animation-graph-playhead"
            x1={frameX(currentFrame)}
            x2={frameX(currentFrame)}
            y1={0}
            y2={HEIGHT}
          />
          {previewKeys
            .filter((key) => key.frame >= bounds.minFrame && key.frame <= bounds.maxFrame)
            .map((key) => {
              const point = graphCoordinates(key.frame, key.value, bounds, width, HEIGHT, 0);
              const isSelected = selected.some(
                (candidate) =>
                  candidate.layerId === layer.id &&
                  candidate.property === property &&
                  candidate.keyframeId === key.id,
              );
              return (
                <g
                  key={key.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${property} key at frame ${key.frame}, value ${key.value}`}
                  aria-haspopup="menu"
                  aria-keyshortcuts="Shift+F10 ContextMenu Delete Backspace"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    const keyboard = event.clientX === 0 && event.clientY === 0;
                    openKeyMenu(
                      key.id,
                      keyboard ? rect.left + rect.width / 2 : event.clientX,
                      keyboard ? rect.bottom : event.clientY,
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                      event.preventDefault();
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      openKeyMenu(key.id, rect.left + rect.width / 2, rect.bottom);
                    } else if (
                      (event.key === 'Delete' || event.key === 'Backspace') &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.altKey &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      if (dragRef.current) finishDrag(false, dragRef.current.pointerId);
                      deleteAnimationGraphKey(keyTarget(key.id));
                    }
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || layer.isLocked || dragRef.current) return;
                    const svg = event.currentTarget.ownerSVGElement;
                    const screen = svg?.getScreenCTM();
                    if (!svg || !screen) return;
                    let inverse;
                    try {
                      inverse = screen.inverse();
                    } catch {
                      return;
                    }
                    if (
                      ![inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(
                        Number.isFinite,
                      )
                    )
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    const state = useProjectStore.getState();
                    const next: GraphDrag = {
                      projectId: state.project.id,
                      compositionId: state.activeCompositionId,
                      layerId: layer.id,
                      property,
                      keyframeId: key.id,
                      originalTrack: structuredClone(keys),
                      preview: { frame: key.frame, value: key.value },
                      pointerId: event.pointerId,
                      svg,
                      geometry: createAnimationGraphDrag(
                        key,
                        bounds,
                        inverse,
                        { x: event.clientX, y: event.clientY },
                        width,
                        HEIGHT,
                        0,
                      ),
                    };
                    svg.setPointerCapture(event.pointerId);
                    dragRef.current = next;
                    setDrag(next);
                    if (event.ctrlKey || event.metaKey) {
                      const next = { layerId: layer.id, property, keyframeId: key.id };
                      selectKeys([...selected, next], next);
                    } else {
                      selectKey(layer.id, key.id, property);
                      if (!event.shiftKey) seekGraphFrame(key.frame);
                    }
                  }}
                >
                  <title>
                    Right-click or Shift+F10 for keyframe actions. Delete removes this key.
                  </title>
                  <circle
                    className="animation-graph-key-hit"
                    cx={point.x}
                    cy={point.y}
                    r={isSelected ? 6 : 4.5}
                  />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={isSelected ? 6 : 4.5}
                    className={isSelected ? 'selected' : undefined}
                    pointerEvents="none"
                  />
                </g>
              );
            })}
        </svg>
      </div>
      {keyMenu && (
        <ContextMenu
          x={keyMenu.x}
          y={keyMenu.y}
          ariaLabel={`${animatablePropertyLabel(property, layer)} graph keyframe actions`}
          onClose={() => setKeyMenu(null)}
          items={[
            ...(keyMenu.insertion
              ? [
                  {
                    id: 'add-graph-keyframe',
                    label: 'Add keyframe here',
                    disabled:
                      layer.isLocked || keys.some((key) => key.frame === keyMenu.insertion!.frame),
                    title: keys.some((key) => key.frame === keyMenu.insertion!.frame)
                      ? `Frame ${keyMenu.insertion.frame} already has a keyframe.`
                      : `Add a ${animatablePropertyLabel(property, layer)} key at frame ${keyMenu.insertion.frame}, value ${keyMenu.insertion.value.toFixed(3)}.`,
                    onSelect: () => {
                      if (keyMenu.insertion) insertAnimationGraphKey(keyMenu.insertion);
                    },
                  },
                ]
              : []),
            {
              id: 'delete-graph-keyframe',
              label: 'Delete keyframe',
              disabled: layer.isLocked || !keyMenu.target,
              title: keyMenu.target
                ? `Delete ${animatablePropertyLabel(property, layer)} key at frame ${keyMenu.target.originalTrack.find((key) => key.id === keyMenu.target!.keyframeId)?.frame}.`
                : 'Select a keyframe or right-click near one to delete it.',
              onSelect: () => {
                if (keyMenu.target) deleteAnimationGraphKey(keyMenu.target);
              },
            },
          ]}
        />
      )}
    </section>
  );
}
