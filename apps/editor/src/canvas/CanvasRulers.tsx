import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import type { CanvasGuide, Composition } from '@ograf-editor/scene-model';
import { useProjectStore } from '../state/projectStore';
import { buildRulerTicks, guidePositionFromViewport, rulerScaleForZoom } from './canvasRuler';
import type { StageCameraOrigin } from './stagePasteboard';

const RULER_SIZE = 20;

interface GuideDrag {
  axis: CanvasGuide['axis'];
  guideId?: string;
  position: number;
}

interface RulerStyle extends CSSProperties {
  '--ruler-position': string;
}

export function CanvasRulers({
  composition,
  zoom,
  viewportRef,
  stageOriginRef,
}: {
  composition: Composition;
  zoom: number;
  viewportRef: RefObject<HTMLDivElement | null>;
  stageOriginRef: RefObject<StageCameraOrigin>;
}) {
  const addGuide = useProjectStore((state) => state.addCanvasGuide);
  const updateGuide = useProjectStore((state) => state.updateCanvasGuide);
  const removeGuide = useProjectStore((state) => state.removeCanvasGuide);
  const [drag, setDrag] = useState<GuideDrag | null>(null);
  const [visibleRange, setVisibleRange] = useState({
    minX: -composition.width,
    maxX: composition.width * 2,
    minY: -composition.height,
    maxY: composition.height * 2,
  });
  const scale = useMemo(() => rulerScaleForZoom(zoom), [zoom]);
  const horizontalTicks = useMemo(
    () => buildRulerTicks(visibleRange.minX - scale.major, visibleRange.maxX + scale.major, scale),
    [scale, visibleRange.maxX, visibleRange.minX],
  );
  const verticalTicks = useMemo(
    () => buildRulerTicks(visibleRange.minY - scale.major, visibleRange.maxY + scale.major, scale),
    [scale, visibleRange.maxY, visibleRange.minY],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const origin = stageOriginRef.current;
      if (!origin) return;
      setVisibleRange({
        minX: (viewport.scrollLeft - origin.x) / zoom,
        maxX: (viewport.scrollLeft + viewport.clientWidth - origin.x) / zoom,
        minY: (viewport.scrollTop - origin.y) / zoom,
        maxY: (viewport.scrollTop + viewport.clientHeight - origin.y) / zoom,
      });
    };
    update();
    viewport.addEventListener('scroll', update);
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => {
      viewport.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [composition.height, composition.id, composition.width, stageOriginRef, viewportRef, zoom]);

  const positionForPointer = useCallback(
    (axis: CanvasGuide['axis'], clientX: number, clientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return 0;
      const rect = viewport.getBoundingClientRect();
      return guidePositionFromViewport(
        axis,
        { x: clientX, y: clientY },
        rect,
        { left: viewport.scrollLeft, top: viewport.scrollTop },
        composition,
        zoom,
        stageOriginRef.current ?? undefined,
      );
    },
    [composition, stageOriginRef, viewportRef, zoom],
  );

  const beginGuide = (event: React.PointerEvent, axis: CanvasGuide['axis'], guideId?: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDrag({
      axis,
      guideId,
      position: positionForPointer(axis, event.clientX, event.clientY),
    });
  };

  useEffect(() => {
    if (!drag) return;
    const handlePointerMove = (event: PointerEvent) => {
      setDrag((current) =>
        current
          ? {
              ...current,
              position: positionForPointer(current.axis, event.clientX, event.clientY),
            }
          : null,
      );
    };
    const handlePointerUp = (event: PointerEvent) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        setDrag(null);
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const position = positionForPointer(drag.axis, event.clientX, event.clientY);
      const returnedToRuler =
        drag.axis === 'vertical'
          ? event.clientX - rect.left <= RULER_SIZE
          : event.clientY - rect.top <= RULER_SIZE;
      if (drag.guideId) {
        if (returnedToRuler) removeGuide(drag.guideId);
        else updateGuide(drag.guideId, position);
      } else if (!returnedToRuler) {
        addGuide(drag.axis, position);
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [addGuide, drag, positionForPointer, removeGuide, updateGuide, viewportRef]);

  const shownGuides = composition.layout.guides.map((guide) =>
    drag?.guideId === guide.id ? { ...guide, position: drag.position } : guide,
  );
  if (drag && !drag.guideId) {
    shownGuides.push({ id: 'new-guide-preview', axis: drag.axis, position: drag.position });
  }

  return (
    <div className="canvas-rulers-overlay" aria-label="Canvas pixel rulers and guides">
      {composition.layout.showRulers && (
        <>
          <div
            className="canvas-viewport-ruler horizontal"
            title="Pixel ruler — drag down to create a horizontal guide"
            onPointerDown={(event) => beginGuide(event, 'horizontal')}
          >
            {horizontalTicks.map((tick) => (
              <span
                key={tick.value}
                className={`canvas-ruler-tick ${tick.kind}`}
                style={
                  {
                    '--ruler-position': `calc(var(--stage-origin-x, 0px) + ${tick.value * zoom}px - var(--stage-scroll-left, 0px) - ${RULER_SIZE}px)`,
                  } as RulerStyle
                }
              >
                {tick.kind === 'major' && <span>{tick.value}</span>}
              </span>
            ))}
          </div>
          <div
            className="canvas-viewport-ruler vertical"
            title="Pixel ruler — drag right to create a vertical guide"
            onPointerDown={(event) => beginGuide(event, 'vertical')}
          >
            {verticalTicks.map((tick) => (
              <span
                key={tick.value}
                className={`canvas-ruler-tick ${tick.kind}`}
                style={
                  {
                    '--ruler-position': `calc(var(--stage-origin-y, 0px) + ${tick.value * zoom}px - var(--stage-scroll-top, 0px) - ${RULER_SIZE}px)`,
                  } as RulerStyle
                }
              >
                {tick.kind === 'major' && <span>{tick.value}</span>}
              </span>
            ))}
          </div>
          <div className="canvas-ruler-origin" title="Ruler origin: composition top-left (pixels)">
            <span />
          </div>
        </>
      )}

      {shownGuides.map((guide) => {
        const position =
          guide.axis === 'vertical'
            ? `calc(var(--stage-origin-x, 0px) + ${guide.position * zoom}px - var(--stage-scroll-left, 0px))`
            : `calc(var(--stage-origin-y, 0px) + ${guide.position * zoom}px - var(--stage-scroll-top, 0px))`;
        return (
          <button
            type="button"
            key={guide.id}
            className={`canvas-viewport-guide ${guide.axis}${drag?.guideId === guide.id || guide.id === 'new-guide-preview' ? ' dragging' : ''}`}
            style={{ '--ruler-position': position } as RulerStyle}
            aria-label={`${guide.axis === 'vertical' ? 'Vertical' : 'Horizontal'} guide at ${guide.position} pixels`}
            title={`${guide.position}px — drag to move; drag back onto its ruler to remove`}
            onPointerDown={(event) => {
              if (guide.id !== 'new-guide-preview') beginGuide(event, guide.axis, guide.id);
            }}
          >
            {drag && (drag.guideId === guide.id || guide.id === 'new-guide-preview') && (
              <span className="canvas-guide-coordinate">{guide.position}px</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
