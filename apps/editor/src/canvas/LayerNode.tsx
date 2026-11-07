import { canvasFrame, useCanvasViewStore } from '../state/canvasViewStore';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  applyElementDataValue,
  bakeChartMarkAnimations,
  layerMotionWindows,
  getLayerEffectsAtFrame,
  effectEnabled,
  getEffectStack,
  hasElementMediaPaint,
  hasElementShaderPaint,
  layerRuleModifiers,
  applyLayerRuleGeometry,
  shaderParameterTarget,
  type Element,
  type Asset,
  type FieldDefinition,
  type Layer,
  type LayerTransform,
  type TextElement,
  type TilingPattern,
} from '@ograf-editor/scene-model';
import {
  applyLayerEffectsFilter,
  disposeLayerEffects,
  applyAnimatedPaint,
  disposeElementContent,
  lottieBackingSizeForLayer,
  shaderBackingSizeForLayer,
  shaderStrokePaddingForLayer,
  updateShaderPaintUniforms,
  updateShaderParameters,
  renderAnimatedElementAtTime,
  renderElementContent,
  setLottieDeterministicRendering,
  waitForElementContentReady,
  createClockTimerRuntime,
  renderTextAnimationAtFrame,
  setTextAnimationPrevious,
  prepareModifierTextElement,
  subscribeShaderContexts,
  shaderContextsLostIn,
  restoreShaderContextsIn,
  type ClockTimerRuntime,
} from '@ograf-editor/ograf-runtime';
import {
  editorVisualRuleEffects,
  resolveEffectiveElement,
  resolveEffectiveEffects,
  resolveEffectiveVisibility,
} from '../state/dataBinding';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import {
  registerClockTimerPreview,
  publishClockTimerPreviewState,
} from '../state/clockTimerPreviewStore';
import { useTestDataStore, type TestValue } from '../state/testDataStore';
import { useTimelineStore } from '../state/timelineStore';
import type { ShaderPreviewClock } from './shaderPreviewClock';
import { useShaderParameterPreviewStore } from '../state/shaderParameterPreviewStore';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import {
  inlineTextEditTarget,
  inlineTextValue,
  placeInlineTextCaret,
  type InlineTextCaretPoint,
} from './inlineTextEditing';
import './LayerNode.css';
import {
  EMPTY_LAYER_RULE_EFFECT,
  stableLayerBindingValues,
  stableLayerRuleEffect,
} from './layerDataSnapshot';

interface LayerNodeProps {
  renderActive?: boolean;
  layer: Layer;
  pose: LayerTransform;
  isSelected: boolean;
  onSelect: (modifiers: {
    additive: boolean;
    deep: boolean;
    clientX: number;
    clientY: number;
  }) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  assets: Asset[];
  dataFields: FieldDefinition[];
  clipPath?: string;
  compositionFrameRate: number;
  shaderPreviewClock: ShaderPreviewClock;
  patterns: TilingPattern[];
  onCommitInlineText: (layer: Layer, value: string) => void;
  onInlineTextEditingChange: (
    layerId: string,
    editing: boolean,
    caretPoint?: InlineTextCaretPoint,
  ) => void;
  allowInlineTextEditing: boolean;
  editingInlineText: boolean;
  inlineTextCaretPoint?: InlineTextCaretPoint;
  onPreviewInlineText: (layer: Layer, value: string) => void;
  onClockDisplay?: (layerId: string, display: TextElement | null) => void;
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
  if (element.type === 'audio' && !element.src) return 'Audio';
  return null;
}

export function LayerNode({
  renderActive = true,
  layer,
  pose: authoredTransform,
  isSelected,
  onSelect,
  registerRef,
  assets,
  dataFields,
  clipPath,
  compositionFrameRate,
  shaderPreviewClock,
  patterns,
  onCommitInlineText,
  onInlineTextEditingChange,
  allowInlineTextEditing,
  editingInlineText,
  inlineTextCaretPoint,
  onPreviewInlineText,
  onClockDisplay,
}: LayerNodeProps) {
  const allTestValues = useTestDataStore((s) => s.values);
  const overflow = useTestDataStore((s) => s.overflowLayerIds.includes(layer.id));
  const ruleOverrides = useTestDataStore((s) => s.visualRuleStateOverrides);
  const composition = useActiveComposition();
  const canvasViewMode = useCanvasViewStore((state) => state.mode);
  const compositionRef = useRef(composition);
  compositionRef.current = composition;
  const projectId = useProjectStore((state) => state.project.id);
  const compositionLayers = composition.layers;
  const rendererPlugins = useMemo(
    () => composition.rendererPlugins ?? [],
    [composition.rendererPlugins],
  );
  const pluginPolicyRevision = useRendererPluginSettingsStore((state) => state.revision);
  // Rules on any layer may drive this one; one shared evaluation serves every canvas node.
  const currentRuleEffect = editorVisualRuleEffects(
    compositionLayers,
    dataFields,
    allTestValues,
    ruleOverrides,
  ).get(layer.id);
  const bindingValuesRef = useRef<Record<string, TestValue>>({});
  bindingValuesRef.current = stableLayerBindingValues(
    bindingValuesRef.current,
    layer.bindings,
    allTestValues,
  );
  const testValues = bindingValuesRef.current;
  const ruleEffectRef = useRef(EMPTY_LAYER_RULE_EFFECT);
  ruleEffectRef.current = stableLayerRuleEffect(ruleEffectRef.current, currentRuleEffect);
  const ruleEffect = ruleEffectRef.current;
  const ruleModifiers = layerRuleModifiers(ruleEffect?.properties);
  const transform = applyLayerRuleGeometry(authoredTransform, ruleModifiers);
  const contentRef = useRef<HTMLDivElement>(null);
  const [shaderPaused, setShaderPaused] = useState(false);
  useLayoutEffect(() => {
    const update = () =>
      setShaderPaused(!!contentRef.current && shaderContextsLostIn(contentRef.current));
    const unsubscribe = subscribeShaderContexts(update);
    update();
    return unsubscribe;
  }, []);
  const readinessGeneration = useRef(0);
  const [contentError, setContentError] = useState<string | null>(null);
  const inlineTarget = inlineTextEditTarget(layer, dataFields);
  const initialInlineText = useRef('');
  const finishingInlineText = useRef(false);

  const lastEffectiveElement = useRef<Element>(layer.element);
  const resolvedContent = useMemo(() => {
    try {
      const next = resolveEffectiveElement(
        layer,
        testValues,
        assets,
        dataFields,
        patterns,
        ruleEffect,
      );
      lastEffectiveElement.current = next;
      return { element: next, error: null };
    } catch (error) {
      return {
        element: lastEffectiveElement.current,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [assets, dataFields, layer, testValues, patterns, ruleEffect]);
  const element = useMemo(
    () => prepareModifierTextElement(resolvedContent.element, layer.modifiers),
    [resolvedContent.element, layer.modifiers],
  );
  const effectiveVisible = resolveEffectiveVisibility(layer, testValues, dataFields, ruleEffect);
  const chartMarkContent = useMemo(() => {
    try {
      return {
        compiled:
          layer.element.type === 'chart'
            ? bakeChartMarkAnimations(
                layer.element,
                composition.animationPresetPlugins ?? [],
                layerMotionWindows(composition),
              )
            : undefined,
        error: null,
      };
    } catch (error) {
      return { compiled: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  }, [layer.element, composition]);
  const hasShaderPaint = hasElementShaderPaint(element);
  const hasMediaPaint = hasElementMediaPaint(element);
  const isClock = element.type === 'text' && !!element.clock;
  const clockRuntimeRef = useRef<ClockTimerRuntime | null>(null);
  const clockRegistrationRef = useRef<(() => void) | null>(null);
  const clockDisplayRef = useRef<TextElement | null>(null);
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
  const clockRenderContext = useRef({
    layer,
    compositionFrameRate,
    rendererPlugins,
    shaderBackingSize,
    shaderStrokePadding,
    hasShaderPaint,
    hasMediaPaint,
    shaderPreviewClock,
    testValues,
    dataFields,
    ruleEffect,
    onClockDisplay,
  });
  clockRenderContext.current = {
    layer,
    compositionFrameRate,
    rendererPlugins,
    shaderBackingSize,
    shaderStrokePadding,
    hasShaderPaint,
    hasMediaPaint,
    shaderPreviewClock,
    testValues,
    dataFields,
    ruleEffect,
    onClockDisplay,
  };

  useLayoutEffect(
    () => () => {
      clockRuntimeRef.current?.dispose();
      clockRuntimeRef.current = null;
      clockRegistrationRef.current?.();
      clockRegistrationRef.current = null;
      clockDisplayRef.current = null;
      clockRenderContext.current.onClockDisplay?.(layer.id, null);
      if (contentRef.current) delete contentRef.current.dataset.ografTextAnimationFrame;
    },
    [projectId, composition.id, layer.id, effectiveVisible, pluginPolicyRevision],
  );

  useLayoutEffect(() => {
    if (!editingInlineText) return;
    const text = contentRef.current?.firstElementChild as HTMLElement | null;
    if (!text) return;
    initialInlineText.current =
      element.type === 'text'
        ? element.runs.length
          ? element.runs.map((run) => run.text).join('')
          : element.content
        : text.innerText;
    text.textContent = initialInlineText.current;
    text.contentEditable = 'plaintext-only';
    text.spellcheck = false;
    text.dataset.inlineTextEditor = 'true';
    const finish = (commit: boolean) => {
      if (finishingInlineText.current) return;
      finishingInlineText.current = true;
      if (commit) onCommitInlineText(layer, inlineTextValue(text));
      else text.innerText = initialInlineText.current;
      onInlineTextEditingChange(layer.id, false);
      text.blur();
      finishingInlineText.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        finish(true);
      }
    };
    const onBlur = () => finish(true);
    const onInput = () => onPreviewInlineText(layer, inlineTextValue(text));
    const onMouseDown = (event: MouseEvent) => {
      event.stopPropagation();
      if (event.button === 0 && event.detail >= 2) {
        event.preventDefault();
        text.focus({ preventScroll: true });
        placeInlineTextCaret(text, { x: event.clientX, y: event.clientY });
      }
    };
    const onDoubleClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      placeInlineTextCaret(text, { x: event.clientX, y: event.clientY });
    };
    text.addEventListener('keydown', onKeyDown);
    text.addEventListener('blur', onBlur);
    text.addEventListener('input', onInput);
    text.addEventListener('mousedown', onMouseDown);
    text.addEventListener('dblclick', onDoubleClick);
    text.focus();
    placeInlineTextCaret(text, inlineTextCaretPoint);
    return () => {
      text.removeEventListener('keydown', onKeyDown);
      text.removeEventListener('blur', onBlur);
      text.removeEventListener('input', onInput);
      text.removeEventListener('mousedown', onMouseDown);
      text.removeEventListener('dblclick', onDoubleClick);
      text.removeAttribute('contenteditable');
      delete text.dataset.inlineTextEditor;
    };
  }, [
    editingInlineText,
    element,
    layer,
    onCommitInlineText,
    onInlineTextEditingChange,
    onPreviewInlineText,
    inlineTextCaretPoint,
  ]);

  // THE canvas render path — deliberately the exact same `renderElementContent` the OGraf runtime
  // uses for both the preview harness and every exported package, so the design canvas cannot
  // drift from broadcast output. (It previously had its own parallel JSX switch, which had already
  // silently diverged: images rendered `object-fit: fill` here but `contain` at runtime.)
  // Hooks must run unconditionally, so this sits above the `isVisible` early return; the ref is
  // null when hidden and the effect simply no-ops.
  useLayoutEffect(() => {
    if (editingInlineText) return;
    if (!renderActive && !isClock) return;
    const host = contentRef.current;
    if (!isClock && clockRuntimeRef.current) {
      clockRuntimeRef.current.dispose();
      clockRuntimeRef.current = null;
      clockRegistrationRef.current?.();
      clockRegistrationRef.current = null;
      clockDisplayRef.current = null;
      if (host) delete host.dataset.ografTextAnimationFrame;
    }
    if (host) {
      try {
        if (element.type === 'text' && element.clock) {
          const refreshClockEffects = () => {
            const current = clockRenderContext.current;
            const root = host.parentElement;
            if (!root) return;
            const frame = canvasFrame(compositionRef.current);
            applyLayerEffectsFilter(
              root,
              resolveEffectiveEffects(
                current.layer,
                getLayerEffectsAtFrame(current.layer, frame),
                current.testValues,
                current.dataFields,
                current.ruleEffect,
              ),
              current.shaderPreviewClock.sample(performance.now()),
            );
          };
          if (!clockRuntimeRef.current) {
            const runtime = createClockTimerRuntime({
              element,
              frameRate: compositionFrameRate,
              owner: host.ownerDocument.defaultView,
              render: (display) => {
                try {
                  const current = clockRenderContext.current;
                  clockDisplayRef.current = display;
                  renderElementContent(host, display, 0, {
                    frameRate: current.compositionFrameRate,
                    rendererPlugins: current.rendererPlugins,
                    ...(current.hasShaderPaint || current.hasMediaPaint
                      ? {
                          shaderBackingSize: current.shaderBackingSize,
                          shaderStrokePadding: current.shaderStrokePadding,
                        }
                      : {}),
                  });
                  applyAnimatedPaint(
                    host,
                    current.layer.animationTracks,
                    canvasFrame(compositionRef.current),
                  );
                  current.onClockDisplay?.(current.layer.id, display);
                  refreshClockEffects();
                  if (current.hasShaderPaint || current.hasMediaPaint) watchContentReadiness(host);
                  else setContentError(null);
                } catch (error) {
                  setContentError(error instanceof Error ? error.message : String(error));
                }
              },
              animate: (display, frame, previous) => {
                try {
                  host.dataset.ografTextAnimationFrame = String(frame);
                  setTextAnimationPrevious(host, previous);
                  renderTextAnimationAtFrame(host, display, frame);
                  const current = clockRenderContext.current;
                  if (current.hasShaderPaint || current.hasMediaPaint)
                    renderAnimatedElementAtTime(
                      host,
                      display,
                      current.shaderPreviewClock.sample(performance.now()),
                      { playing: current.shaderPreviewClock.running },
                    );
                  refreshClockEffects();
                } catch (error) {
                  setContentError(error instanceof Error ? error.message : String(error));
                }
              },
              onState: (state) => publishClockTimerPreviewState(layer.id, state.running),
            });
            clockRuntimeRef.current = runtime;
            clockRegistrationRef.current = registerClockTimerPreview(layer.id, {
              projectId,
              compositionId: composition.id,
              command: (command) => runtime.command(command),
            });
          } else clockRuntimeRef.current.configure(element, compositionFrameRate);
          clockRuntimeRef.current.startRealtime();
          return;
        }
        if (chartMarkContent.error) throw new Error(chartMarkContent.error);
        renderElementContent(host, element, 0, {
          frameRate: compositionFrameRate,
          rendererPlugins,
          chartMarkAnimations: chartMarkContent.compiled,
          ...(element.type === 'ticker' ? { tickerUpdateContext: 'authoring' as const } : {}),
          ...(element.type === 'ticker' && host.querySelector('[data-ograf-ticker="true"]')
            ? { timestampMs: shaderPreviewClock.sample(performance.now()) }
            : {}),
          ...(element.type === 'lottie' ? { lottieBackingSize } : {}),
          ...(hasShaderPaint || hasMediaPaint ? { shaderBackingSize, shaderStrokePadding } : {}),
        });
        applyAnimatedPaint(host, layer.animationTracks, canvasFrame(compositionRef.current));
        if (
          element.type === 'chart' ||
          element.type === 'lottie' ||
          element.type === 'ticker' ||
          hasShaderPaint ||
          hasMediaPaint
        )
          watchContentReadiness(host);
        else setContentError(null);
      } catch (error) {
        disposeElementContent(host);
        setContentError(error instanceof Error ? error.message : String(error));
      }
    }
    return () => {
      readinessGeneration.current += 1;
    };
  }, [
    compositionFrameRate,
    element,
    hasShaderPaint,
    hasMediaPaint,
    layer.animationTracks,
    effectiveVisible,
    lottieBackingSize,
    shaderBackingSize,
    shaderStrokePadding,
    watchContentReadiness,
    editingInlineText,
    rendererPlugins,
    pluginPolicyRevision,
    chartMarkContent,
    shaderPreviewClock,
    isClock,
    projectId,
    composition.id,
    layer.id,
    renderActive,
  ]);

  useLayoutEffect(() => {
    const host = contentRef.current?.parentElement;
    return () => {
      if (host) disposeLayerEffects(host);
    };
  }, [effectiveVisible]);

  useLayoutEffect(() => {
    if (renderActive || isClock) return;
    const host = contentRef.current;
    if (host) {
      if (hasShaderPaint) disposeElementContent(host);
      if (
        host.parentElement &&
        getEffectStack(layer.effects).some(
          (effect) => effect.type === 'shader' && effectEnabled(effect, layer.effects),
        )
      )
        disposeLayerEffects(host.parentElement);
    }
  }, [renderActive, isClock, hasShaderPaint, layer.effects]);

  useLayoutEffect(() => {
    const host = contentRef.current;
    if (!host || !hasShaderPaint) return;
    let previewing = false;
    const applyPreview = (
      preview: ReturnType<typeof useShaderParameterPreviewStore.getState>['preview'],
    ) => {
      if (preview?.layerId === layer.id) {
        const previewElement = applyElementDataValue(
          element,
          shaderParameterTarget(preview.name, preview.slot),
          preview.value,
        );
        const updated =
          previewElement.type === 'shader'
            ? updateShaderParameters(host, previewElement, shaderBackingSize)
            : updateShaderPaintUniforms(host, previewElement);
        if (!updated) throw new Error('The shader preview renderer is not mounted.');
        previewing = true;
      } else if (previewing) {
        renderElementContent(host, element, 0, {
          frameRate: compositionFrameRate,
          rendererPlugins,
          chartMarkAnimations: chartMarkContent.compiled,
          shaderBackingSize,
          shaderStrokePadding,
        });
        applyAnimatedPaint(host, layer.animationTracks, canvasFrame(compositionRef.current));
        previewing = false;
      }
    };
    applyPreview(useShaderParameterPreviewStore.getState().preview);
    return useShaderParameterPreviewStore.subscribe((state) => applyPreview(state.preview));
  }, [
    compositionFrameRate,
    element,
    hasShaderPaint,
    layer.animationTracks,
    layer.id,
    shaderBackingSize,
    shaderStrokePadding,
    rendererPlugins,
    chartMarkContent,
  ]);

  // Value-only shader edits reuse the mounted GPU program. Release it only when the host leaves
  // the canvas; renderElementContent handles source/type/backing changes itself.
  useLayoutEffect(() => {
    const host = contentRef.current;
    return () => {
      if (host) disposeElementContent(host);
    };
  }, [effectiveVisible, pluginPolicyRevision]);

  useLayoutEffect(() => {
    if (!renderActive) return;
    if (
      hasShaderPaint ||
      hasMediaPaint ||
      element.type === 'ticker' ||
      (element.type === 'text' && element.crawl)
    ) {
      let animationFrame: number | null = null;
      const render = () => {
        animationFrame = null;
        const host = contentRef.current;
        if (!host) return;
        if (shaderContextsLostIn(host)) return;
        try {
          if (element.type === 'lottie' || element.type === 'ticker')
            setLottieDeterministicRendering(host, !shaderPreviewClock.running);
          // The master timeline and Stage's local-loop sampler own animated uniforms. This
          // independent clock advances iTime only, so a held loop's values are never replaced.
          renderAnimatedElementAtTime(
            host,
            clockDisplayRef.current ?? element,
            shaderPreviewClock.sample(performance.now()),
            {
              playing: shaderPreviewClock.running,
              chartMarkFrame: canvasFrame(compositionRef.current),
            },
          );
          if (!shaderPreviewClock.running && !hasMediaPaint) watchContentReadiness(host);
        } catch (error) {
          setContentError(error instanceof Error ? error.message : String(error));
          // A restored context can resume itself. Compilation/draw failures await a source edit.
          return;
        }
        if (shaderPreviewClock.running || hasMediaPaint)
          animationFrame = requestAnimationFrame(render);
      };
      const sync = () => {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        render();
      };
      const unsubscribe = shaderPreviewClock.subscribe(sync);
      let paused = false;
      const unsubscribeContexts = subscribeShaderContexts(() => {
        const lost = !!contentRef.current && shaderContextsLostIn(contentRef.current);
        if (paused && !lost) sync();
        paused = lost;
      });
      sync();
      return () => {
        unsubscribe();
        unsubscribeContexts();
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      };
    }
    if (isClock) return;
    const renderAtFrame = (frame: number, playing: boolean) => {
      const host = contentRef.current;
      if (host) {
        try {
          setLottieDeterministicRendering(host, !playing);
          renderAnimatedElementAtTime(host, element, (frame / compositionFrameRate) * 1000, {
            playing,
            chartMarkFrame: frame,
          });
          if (element.type === 'lottie') watchContentReadiness(host);
        } catch (error) {
          setContentError(error instanceof Error ? error.message : String(error));
        }
      }
    };
    const initialState = useTimelineStore.getState();
    renderAtFrame(
      canvasFrame(compositionRef.current, initialState.currentFrame),
      initialState.isPlaying,
    );
    let previousFrame = initialState.currentFrame;
    let previousPlaying = initialState.isPlaying;
    return useTimelineStore.subscribe((state) => {
      if (state.currentFrame === previousFrame && state.isPlaying === previousPlaying) return;
      previousFrame = state.currentFrame;
      previousPlaying = state.isPlaying;
      renderAtFrame(canvasFrame(compositionRef.current, state.currentFrame), state.isPlaying);
    });
  }, [
    compositionFrameRate,
    element,
    hasShaderPaint,
    hasMediaPaint,
    effectiveVisible,
    lottieBackingSize,
    shaderBackingSize,
    shaderPreviewClock,
    watchContentReadiness,
    rendererPlugins,
    pluginPolicyRevision,
    renderActive,
    isClock,
    canvasViewMode,
  ]);

  useLayoutEffect(() => {
    if (!renderActive) return;
    const host = contentRef.current?.parentElement;
    if (!host) return;
    const effects = resolveEffectiveEffects(
      layer,
      getLayerEffectsAtFrame(layer, canvasFrame(compositionRef.current)),
      testValues,
      dataFields,
      ruleEffect,
    );
    const shaderEffect = getEffectStack(effects).some(
      (effect) => effect.type === 'shader' && effectEnabled(effect, effects),
    );
    const apply = () =>
      applyLayerEffectsFilter(host, effects, shaderPreviewClock.sample(performance.now()));
    apply();
    if (!shaderEffect) return;
    let animationFrame: number | null = null;
    const render = () => {
      animationFrame = null;
      apply();
      if (shaderPreviewClock.running || hasMediaPaint)
        animationFrame = requestAnimationFrame(render);
    };
    const sync = () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      render();
    };
    const unsubscribe = shaderPreviewClock.subscribe(sync);
    // Properties edits replace this effect while the content clock may already be running.
    // Re-arm rendering now; an already-running clock does not publish another Play notification.
    sync();
    return () => {
      unsubscribe();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    };
  }, [
    layer,
    testValues,
    dataFields,
    ruleEffect,
    transform.width,
    transform.height,
    shaderPreviewClock,
    hasMediaPaint,
    renderActive,
  ]);

  if (!effectiveVisible) return null;

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

  // Rule-driven move/rotate/scale/opacity preview on the content, so selection handles keep the
  // authored box. The move is counter-rotated to stay in canvas axes, as it is at runtime.
  let contentStyle: CSSProperties | undefined;
  if (ruleModifiers) {
    const angle = (-transform.rotation * Math.PI) / 180;
    const localX =
      ruleModifiers.offsetX * Math.cos(angle) - ruleModifiers.offsetY * Math.sin(angle);
    const localY =
      ruleModifiers.offsetX * Math.sin(angle) + ruleModifiers.offsetY * Math.cos(angle);
    contentStyle = {
      transform: `translate(${localX}px, ${localY}px) rotate(${ruleModifiers.rotation}deg) scale(${ruleModifiers.scale})`,
      transformOrigin: style.transformOrigin,
      opacity: ruleModifiers.opacity,
    };
  }

  const placeholder = emptyContentLabel(element);
  const visibleError = resolvedContent.error ?? (hasShaderPaint ? null : contentError);

  return (
    <div
      ref={registerRef}
      data-layer-id={layer.id}
      data-layer-name={layer.name}
      className={[
        'layer-node',
        isSelected && 'selected',
        editingInlineText && 'inline-text-editing',
        layer.isGuide && 'guide',
        layer.isLocked && 'locked',
        layer.crop && 'cropped',
        overflow && 'test-data-overflow',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (editingInlineText) return;
        onSelect({
          additive: e.shiftKey,
          deep: e.ctrlKey || e.metaKey,
          clientX: e.clientX,
          clientY: e.clientY,
        });
      }}
      onDoubleClick={(event) => {
        if (!allowInlineTextEditing || !inlineTarget || editingInlineText) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect({ additive: false, deep: true, clientX: event.clientX, clientY: event.clientY });
        onInlineTextEditingChange(layer.id, true, { x: event.clientX, y: event.clientY });
      }}
      style={style}
    >
      <div className="layer-content-host" ref={contentRef} style={contentStyle} />
      {shaderPaused && (
        <div
          className="layer-shader-paused"
          role="status"
          onMouseDown={(event) => event.stopPropagation()}
        >
          Shader paused: too many WebGL views
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (contentRef.current) restoreShaderContextsIn(contentRef.current);
            }}
          >
            Restore
          </button>
        </div>
      )}
      {editingInlineText && inlineTarget?.type === 'bound' ? (
        <div className="layer-inline-text-badge">Bound to: {inlineTarget.label}</div>
      ) : null}
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
