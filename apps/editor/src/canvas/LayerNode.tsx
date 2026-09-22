import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  getLayerEffectsAtFrame,
  hasElementShaderPaint,
  type Element,
  type Asset,
  type FieldDefinition,
  type Layer,
  type LayerTransform,
  type TilingPattern,
} from '@ograf-editor/scene-model';
import {
  applyLayerEffectsFilter,
  applyAnimatedPaint,
  disposeElementContent,
  lottieBackingSizeForLayer,
  shaderBackingSizeForLayer,
  shaderStrokePaddingForLayer,
  renderAnimatedElementAtTime,
  renderElementContent,
  setLottieDeterministicRendering,
  waitForElementContentReady,
} from '@ograf-editor/ograf-runtime';
import { resolveEffectiveElement, resolveEffectiveEffects } from '../state/dataBinding';
import { useTestDataStore } from '../state/testDataStore';
import { useTimelineStore } from '../state/timelineStore';
import type { ShaderPreviewClock } from './shaderPreviewClock';
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
  shaderPreviewClock: ShaderPreviewClock;
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
  shaderPreviewClock,
  patterns,
}: LayerNodeProps) {
  const testValues = useTestDataStore((s) => s.values);
  const contentRef = useRef<HTMLDivElement>(null);
  const readinessGeneration = useRef(0);
  const [contentError, setContentError] = useState<string | null>(null);

  const lastEffectiveElement = useRef<Element>(layer.element);
  const resolvedContent = useMemo(() => {
    try {
      const next = resolveEffectiveElement(layer, testValues, assets, dataFields, patterns);
      lastEffectiveElement.current = next;
      return { element: next, error: null };
    } catch (error) {
      return {
        element: lastEffectiveElement.current,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [assets, dataFields, layer, testValues, patterns]);
  const element = resolvedContent.element;
  const hasShaderPaint = hasElementShaderPaint(element);
  const lottieBackingSize = useMemo(() => lottieBackingSizeForLayer(layer), [layer]);
  const shaderBackingSize = useMemo(() => shaderBackingSizeForLayer(layer), [layer]);
  const shaderStrokePadding = useMemo(() => shaderStrokePaddingForLayer(layer), [layer]);
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
      renderElementContent(host, element, 0, {
        ...(element.type === 'lottie' ? { lottieBackingSize } : {}),
        ...(hasShaderPaint ? { shaderBackingSize, shaderStrokePadding } : {}),
      });
      applyAnimatedPaint(host, layer.animationTracks, useTimelineStore.getState().currentFrame);
      if (element.type === 'lottie' || hasShaderPaint) watchContentReadiness(host);
      else setContentError(null);
    }
    return () => {
      readinessGeneration.current += 1;
    };
  }, [
    element,
    hasShaderPaint,
    layer.animationTracks,
    layer.isVisible,
    lottieBackingSize,
    shaderBackingSize,
    shaderStrokePadding,
    watchContentReadiness,
  ]);

  // Value-only shader edits reuse the mounted GPU program. Release it only when the host leaves
  // the canvas; renderElementContent handles source/type/backing changes itself.
  useLayoutEffect(() => {
    const host = contentRef.current;
    return () => {
      if (host) disposeElementContent(host);
    };
  }, [layer.isVisible]);

  useLayoutEffect(() => {
    if (hasShaderPaint) {
      let animationFrame: number | null = null;
      const render = () => {
        animationFrame = null;
        const host = contentRef.current;
        if (!host) return;
        try {
          if (element.type === 'lottie')
            setLottieDeterministicRendering(host, !shaderPreviewClock.running);
          // The master timeline and Stage's local-loop sampler own animated uniforms. This
          // independent clock advances iTime only, so a held loop's values are never replaced.
          renderAnimatedElementAtTime(host, element, shaderPreviewClock.sample(performance.now()));
          if (!shaderPreviewClock.running) watchContentReadiness(host);
        } catch (error) {
          setContentError(error instanceof Error ? error.message : String(error));
          // A restored context can resume itself. Compilation/draw failures await a source edit.
          if (!(error instanceof Error) || error.name !== 'ShaderContextLostError') return;
        }
        if (shaderPreviewClock.running) animationFrame = requestAnimationFrame(render);
      };
      const sync = () => {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        render();
      };
      const unsubscribe = shaderPreviewClock.subscribe(sync);
      sync();
      return () => {
        unsubscribe();
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      };
    }
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
  }, [
    compositionFrameRate,
    element,
    hasShaderPaint,
    layer.isVisible,
    lottieBackingSize,
    shaderBackingSize,
    shaderPreviewClock,
    watchContentReadiness,
  ]);

  useLayoutEffect(() => {
    const host = contentRef.current?.parentElement;
    if (host)
      applyLayerEffectsFilter(
        host,
        resolveEffectiveEffects(
          layer,
          getLayerEffectsAtFrame(layer, useTimelineStore.getState().currentFrame),
          testValues,
          dataFields,
        ),
      );
  }, [layer, testValues, dataFields, transform.width, transform.height]);

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
    clipPath,
  };

  const placeholder = emptyContentLabel(element);
  const visibleError = resolvedContent.error ?? (hasShaderPaint ? null : contentError);

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
      {visibleError ? (
        <div className="layer-content-placeholder" title={visibleError} role="alert">
          Render error: {visibleError}
        </div>
      ) : (
        placeholder && <div className="layer-content-placeholder">{placeholder}</div>
      )}
    </div>
  );
}
