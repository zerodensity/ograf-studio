import type { CompiledGraphicDescriptor } from '@ograf-editor/ograf-types';
import { GraphicElement } from './GraphicElement';

export { GraphicElement } from './GraphicElement';
export { CoordinatedGraphicElement } from './CoordinatedGraphicElement';
export {
  applyLayerBackdropFilter,
  backdropBorderRadius,
  compositionHasBackdropBlur,
  disposeLayerBackdropFilter,
  refreshBackdropClip,
  setCompositionBackdropRoot,
} from './backdropEffectRendering';
export {
  assertRendererPluginPolicy,
  waitForChartsReady,
  type RendererPluginPolicy,
  type RuntimeRendererPluginSnapshot,
} from './chartRendering';
export type {
  ChartRenderer,
  ChartRendererProvider,
  ChartRendererHostAPI,
} from './chartProviderTypes';
export { buildRuntimeTimeline } from './buildRuntimeTimeline';
export {
  createClockTimerRuntime,
  clockTimerAnimationFrameAtTime,
  clockTimerTextAnimationAtTime,
  clockTimerStateAtTime,
  resolveClockTimerText,
  type ClockTimerRuntime,
  type ClockTimerRuntimeOptions,
  type ClockTimerEvent,
  type ClockTimerState,
} from './clockTimerRuntime';
export {
  createClockTimerAlarmTracker,
  clockTimerAlarmEventsAtTime,
  type ClockTimerAlarmDefinition,
  type ClockTimerAlarmEvent,
} from './timerAlarms';
export { renderTextAnimationAtFrame, setTextAnimationPrevious } from './textAnimationRendering';
export {
  FramePlayer,
  tickFramePlayers,
  type FramePlayerOptions,
  type FramePlayerEvent,
  type FrameTransition,
  type FrameTransitionOptions,
} from './framePlayer';
export { applyCompiledMasks } from './maskRendering';
export { renderPatternAtElapsed } from './patternRendering';
export { shaderStrokePaddingForLayer, updateShaderPaintUniforms } from './shaderPaintRendering';
export {
  disposeMediaPaintContent,
  mediaFitRect,
  renderMediaPaintAtTime,
  waitForMediaPaintContentReady,
} from './mediaPaintRendering';
export {
  createShaderRenderer,
  shaderContextCounts,
  subscribeShaderContexts,
  shaderContextsLostIn,
  restoreShaderContextsIn,
  pausedShaderLayerIds,
  restoreShaderLayer,
  shaderBackingSizeForLayer,
  shaderTimeSeconds,
  updateShaderParameters,
  waitForShadersComplete,
} from './shaderRendering';
export {
  applyAnimatedPaint,
  disposeElementContent,
  lottieBackingSizeForLayer,
  MAX_LOTTIE_BACKING_AXIS,
  MAX_LOTTIE_BACKING_PIXELS,
  renderElementContent,
  renderAnimatedElementAtTime,
  refreshLottiePresentation,
  setLottieDeterministicRendering,
  waitForElementContentReady,
  resolveBoundElement,
  resolveBoundEffects,
} from './renderElement';
export { easingForProgress } from './easing';
export {
  mountTicker,
  renderTickerAtTime,
  updateTicker,
  disposeTicker,
  waitForTickersReady,
  pauseTickerAnimations,
  mirrorTickerTransport,
  getTickerUpdateStatuses,
  renderTickerHistory,
  inheritTickerPlayback,
  type TickerUpdateStatus,
} from './tickerRendering';
export {
  applyCompiledClipPaths,
  applyCompiledLayerVisualState,
  compiledLoopElapsedFrames,
  sampleCompiledLayerVisualState,
  type CompiledLayerVisualState,
} from './loopRendering';
export { applyCompiledAutoLayout, hasAutoSizedTextClip } from './autoLayoutRendering';
export { applyCompiledMotionPaths } from './motionPathRendering';
export { getTextGradientSource } from './textGradientTint';
export {
  applyCompiledTextPaths,
  assertTextPathFxSupported,
  cachedTextPathGeometry,
  mountTextPathGlyphs,
  renderTextPathGlyphs,
} from './textPathRendering';
export { applyCompiledModifiers } from './modifierRendering';
export { resolveModifierElement, type CompiledModifierContext } from './modifierRendering';
export { prepareModifierTextElement, applyModifierTextFit } from './modifierTextRendering';
export { resolveMediaTimelinePosition } from './mediaTimeline';
export { MediaCueRuntime, mediaCueAutomaticStartMs } from './mediaCueRuntime';
export {
  createRuntimeVisualRuleEngine,
  publishRuntimeVisualRuleEffect,
  layerHasRuntimeVisualInputs,
  resolveVisualRuleEffects,
  resolveVisualRuleElement,
  RuntimeVisualRules,
  visualRuleEffectFor,
  visualRuleLayerVisible,
  type RuntimeVisualRuleEffect,
} from './runtimeVisualRules';
export { expandRuntimeCollections, isRuntimeCollectionLayerActive } from './runtimeCollections';
export {
  mountTransitionLogicComposition,
  sharedLayerKey,
  type TransitionLogicMount,
} from './transitionLogicRendering';
export { resolvePlayTarget, type LifecycleTarget } from './lifecycle';

/** A concrete (non-abstract), constructible GraphicElement subclass — `typeof GraphicElement`
 * itself is an abstract-constructor type and can't be passed to `customElements.define`. */
type ConcreteGraphicElement = CustomElementConstructor & (new () => GraphicElement);

/** A concrete, instantiable GraphicElement bound to one descriptor — see GraphicElement's own doc comment. */
export function createGraphicClass(descriptor: CompiledGraphicDescriptor): ConcreteGraphicElement {
  return class extends GraphicElement {
    static override descriptor = descriptor;
  };
}

let registrationCounter = 0;

/**
 * Registers a fresh Custom Element tag for this descriptor and returns the tag name — used by the
 * live preview harness, which needs a new tag every recompile (`customElements.define` can't be
 * called twice for the same name, and there's no way to update an already-defined element's class).
 */
export function registerGraphicElement(descriptor: CompiledGraphicDescriptor): string {
  let tagName: string;
  do {
    tagName = `ograf-preview-graphic-${registrationCounter++}`;
  } while (customElements.get(tagName));
  customElements.define(tagName, createGraphicClass(descriptor));
  return tagName;
}
export {
  applyLayerEffectsFilter,
  disposeLayerEffects,
  waitForLayerEffectsReady,
} from './effectCompositing';
