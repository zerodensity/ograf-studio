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
}: {
  composition: Composition;
  zoom: number;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const addGuide = useProjectStore((state) => state.addCanvasGuide);
  const updateGuide = useProjectStore((state) => state.updateCanvasGuide);
  const removeGuide = useProjectStore((state) => state.removeCanvasGuide);
  const [drag, setDrag] = useState<GuideDrag | null>(null);
  const scale = useMemo(() => rulerScaleForZoom(zoom), [zoom]);
  const horizontalTicks = useMemo(
    () => buildRulerTicks(-composition.width, composition.width * 2, scale),
    [composition.width, scale],
  );
  const verticalTicks = useMemo(
    () => buildRulerTicks(-composition.height, composition.height * 2, scale),
    [composition.height, scale],
  );

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
      );
    },
    [composition, viewportRef, zoom],
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
                    '--ruler-position': `calc(${(composition.width + tick.value) * zoom}px - var(--stage-scroll-left, 0px) - ${RULER_SIZE}px)`,
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
                    '--ruler-position': `calc(${(composition.height + tick.value) * zoom}px - var(--stage-scroll-top, 0px) - ${RULER_SIZE}px)`,
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
            ? `calc(${(composition.width + guide.position) * zoom}px - var(--stage-scroll-left, 0px))`
            : `calc(${(composition.height + guide.position) * zoom}px - var(--stage-scroll-top, 0px))`;
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
