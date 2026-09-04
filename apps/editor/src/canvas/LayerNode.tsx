import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  layerEffectsToCssFilter,
  getLayerEffectsAtFrame,
  type Element,
  type Asset,
  type FieldDefinition,
  type Layer,
  type LayerTransform,
  type TilingPattern,
} from '@ograf-editor/scene-model';
import {
  applyAnimatedPaint,
  disposeElementContent,
  lottieBackingSizeForLayer,
  renderAnimatedElementAtTime,
  renderElementContent,
  setLottieDeterministicRendering,
  waitForElementContentReady,
} from '@ograf-editor/ograf-runtime';
import { resolveEffectiveElement, resolveEffectiveEffects } from '../state/dataBinding';
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
  patterns: TilingPattern[];
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
  patterns,
}: LayerNodeProps) {
  const testValues = useTestDataStore((s) => s.values);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const contentRef = useRef<HTMLDivElement>(null);
  const readinessGeneration = useRef(0);
  const [contentError, setContentError] = useState<string | null>(null);

  const element = useMemo(
    () => resolveEffectiveElement(layer, testValues, assets, dataFields, patterns),
    [assets, dataFields, layer, testValues, patterns],
  );
  const lottieBackingSize = useMemo(() => lottieBackingSizeForLayer(layer), [layer]);
  const watchContentReadiness = useCallback((host: HTMLElement) => {
    const generation = ++readinessGeneration.current;
    void waitForElementContentReady(host).then(
      () => {
        if (readinessGeneration.current === generation) setContentError(null);
      },
      (error: unknown) => {
        if (readinessGeneration.current === generation) {
          setContentError(error instanceof Error ? error.message : String(error));
        }
      },
    );
  }, []);

  // THE canvas render path — deliberately the exact same `renderElementContent` the OGraf runtime
  // uses for both the preview harness and every exported package, so the design canvas cannot
  // drift from broadcast output. (It previously had its own parallel JSX switch, which had already
  // silently diverged: images rendered `object-fit: fill` here but `contain` at runtime.)
  // Hooks must run unconditionally, so this sits above the `isVisible` early return; the ref is
  // null when hidden and the effect simply no-ops.
  useLayoutEffect(() => {
    const host = contentRef.current;
    if (host) {
      renderElementContent(
        host,
        element,
        0,
        element.type === 'lottie' ? { lottieBackingSize } : undefined,
      );
      if (element.type === 'lottie') watchContentReadiness(host);
      else setContentError(null);
      applyAnimatedPaint(host, layer.animationTracks, useTimelineStore.getState().currentFrame);
    }
    return () => {
      readinessGeneration.current += 1;
      if (host) disposeElementContent(host);
    };
  }, [element, layer.animationTracks, layer.isVisible, lottieBackingSize, watchContentReadiness]);

  useLayoutEffect(() => {
    const renderAtFrame = (frame: number, playing: boolean) => {
      const host = contentRef.current;
      if (host) {
        try {
          setLottieDeterministicRendering(host, !playing);
          renderAnimatedElementAtTime(host, element, (frame / compositionFrameRate) * 1000);
          if (element.type === 'lottie') watchContentReadiness(host);
        } catch (error) {
          setContentError(error instanceof Error ? error.message : String(error));
        }
      }
    };
    const initialState = useTimelineStore.getState();
    renderAtFrame(initialState.currentFrame, initialState.isPlaying);
    let previousFrame = initialState.currentFrame;
    let previousPlaying = initialState.isPlaying;
    return useTimelineStore.subscribe((state) => {
      if (state.currentFrame === previousFrame && state.isPlaying === previousPlaying) return;
      previousFrame = state.currentFrame;
      previousPlaying = state.isPlaying;
      renderAtFrame(state.currentFrame, state.isPlaying);
    });
  }, [compositionFrameRate, element, layer.isVisible, lottieBackingSize, watchContentReadiness]);

  if (!layer.isVisible) return null;

  const style: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: transform.width,
    height: transform.height,
    opacity: transform.opacity,
    visibility: layer.isMaskOnly ? 'hidden' : undefined,
    mixBlendMode: layer.blendMode === 'normal' ? undefined : layer.blendMode,
    transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg)`,
    transformOrigin: `${transform.transformOriginX * 100}% ${transform.transformOriginY * 100}%`,
    filter: layerEffectsToCssFilter(
      resolveEffectiveEffects(
        layer,
        getLayerEffectsAtFrame(layer, useTimelineStore.getState().currentFrame),
        testValues,
        dataFields,
      ),
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
          title={`${layer.bindings.length} data binding${layer.bindings.length === 1 ? '' : 's'} — edit fields and properties in Properties`}
          aria-label="Data-bound layer"
        />
      )}
      {contentError ? (
        <div className="layer-content-placeholder" title={contentError}>
          Lottie render error
        </div>
      ) : (
        placeholder && <div className="layer-content-placeholder">{placeholder}</div>
      )}
    </div>
  );
}
