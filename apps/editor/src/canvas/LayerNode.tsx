import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import {
  layerEffectsToCssFilter,
  getLayerEffectsAtFrame,
  type Element,
  type Asset,
  type FieldDefinition,
  type Layer,
  type LayerTransform,
} from '@ograf-editor/scene-model';
import {
  applyAnimatedPaint,
  renderAnimatedElementAtTime,
  renderElementContent,
} from '@ograf-editor/ograf-runtime';
import { resolveEffectiveElement } from '../state/dataBinding';
import { useTestDataStore } from '../state/testDataStore';
import { useTimelineStore } from '../state/timelineStore';
import './LayerNode.css';

interface LayerNodeProps {
  layer: Layer;
  pose: LayerTransform;
  isSelected: boolean;
  onSelect: (additive: boolean) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  assets: Asset[];
  dataFields: FieldDefinition[];
  clipPath?: string;
  compositionFrameRate: number;
}

/**
 * Editor-only affordance: what to show when an element has no renderable content yet. The runtime
 * correctly renders nothing in these cases (an unset image must not draw a grey box on air), so
 * this is deliberately layered *on top of* the shared renderer rather than being a divergent
 * branch inside it.
 */
function emptyContentLabel(element: Element): string | null {
  if (element.type === 'image' && !element.src) return 'Image';
  if (element.type === 'image-sequence' && element.frames.length === 0) return 'Sequence';
  if (element.type === 'lottie' && !element.animationData) return 'Lottie';
  return null;
}

export function LayerNode({
  layer,
  pose: transform,
  isSelected,
  onSelect,
  registerRef,
  assets,
  dataFields,
  clipPath,
  compositionFrameRate,
}: LayerNodeProps) {
  const testValues = useTestDataStore((s) => s.values);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const contentRef = useRef<HTMLDivElement>(null);

  const element = useMemo(
    () => resolveEffectiveElement(layer, testValues, assets, dataFields),
    [assets, dataFields, layer, testValues],
  );

  // THE canvas render path — deliberately the exact same `renderElementContent` the OGraf runtime
  // uses for both the preview harness and every exported package, so the design canvas cannot
  // drift from broadcast output. (It previously had its own parallel JSX switch, which had already
  // silently diverged: images rendered `object-fit: fill` here but `contain` at runtime.)
  // Hooks must run unconditionally, so this sits above the `isVisible` early return; the ref is
  // null when hidden and the effect simply no-ops.
  useLayoutEffect(() => {
    const host = contentRef.current;
    if (host) {
      renderElementContent(host, element);
      applyAnimatedPaint(host, layer.animationTracks, useTimelineStore.getState().currentFrame);
    }
  }, [element, layer.animationTracks, layer.isVisible]);

  useLayoutEffect(() => {
    const renderAtFrame = (frame: number) => {
      const host = contentRef.current;
      if (host) renderAnimatedElementAtTime(host, element, (frame / compositionFrameRate) * 1000);
    };
    renderAtFrame(useTimelineStore.getState().currentFrame);
    let previousFrame = useTimelineStore.getState().currentFrame;
    return useTimelineStore.subscribe((state) => {
      if (state.currentFrame === previousFrame) return;
      previousFrame = state.currentFrame;
      renderAtFrame(state.currentFrame);
    });
  }, [compositionFrameRate, element, layer.isVisible]);

  if (!layer.isVisible) return null;

  const style: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: transform.width,
    height: transform.height,
    opacity: transform.opacity,
    transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg)`,
    transformOrigin: `${transform.transformOriginX * 100}% ${transform.transformOriginY * 100}%`,
    filter: layerEffectsToCssFilter(
      getLayerEffectsAtFrame(layer, useTimelineStore.getState().currentFrame),
    ),
    clipPath,
  };

  const placeholder = emptyContentLabel(element);

  return (
    <div
      ref={registerRef}
      data-layer-id={layer.id}
      className={[
        'layer-node',
        isSelected && 'selected',
        layer.isGuide && 'guide',
        layer.isLocked && 'locked',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onSelect(e.ctrlKey || e.metaKey);
      }}
      style={style}
    >
      <div className="layer-content-host" ref={contentRef} />
      {layer.bindings.length > 0 && !isPlaying && (
        <span
          className="layer-binding-indicator"
          title={`${layer.bindings.length} data binding${layer.bindings.length === 1 ? '' : 's'} — edit fields and properties in the Inspector`}
          aria-label="Data-bound layer"
        />
      )}
      {placeholder && <div className="layer-content-placeholder">{placeholder}</div>}
    </div>
  );
}
