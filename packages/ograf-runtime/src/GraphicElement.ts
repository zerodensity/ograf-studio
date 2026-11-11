import {
  hasTextAnimationSettings,
  textAnimationCarriesUpdate,
  textAnimationTotalFrames,
} from '@ograf-editor/scene-model';
import {
  applyLayerEffectsFilter,
  resumeLayerEffects,
  suspendLayerEffects,
} from './effectCompositing';
import { filterExposedData } from './dataExposure';
import { compositionHasBackdropBlur, setCompositionBackdropRoot } from './backdropEffectRendering';
import {
  GRAPHIC_ERROR_STATUS_CODE,
  type CompiledGraphicDescriptor,
  type CustomActionParams,
  type Graphic,
  type GoToTimeParams,
  type LoadParams,
  type PlayActionParams,
  type PlayActionReturnPayload,
  type ReturnPayload,
  type ScheduledAction,
  type SetActionsScheduleParams,
  type StopActionParams,
  type UpdateActionParams,
} from '@ograf-editor/ograf-types';
import { buildRuntimeTimeline } from './buildRuntimeTimeline';
import { chartMarkLifecycleFrame } from './chartMarkLifecycle';
import {
  collectExportedLayers,
  dispatchStudioFrameCue,
  type GraphicInstance,
  type GraphicInstances,
} from './graphicInstances';
import { LoopPlaybackController, type LoopPlaybackAction } from './loopPlayback';
import { applyCompiledMasks } from './maskRendering';
import { resolvePlayTarget } from './lifecycle';
import {
  ShaderContextLostError,
  shaderBackingSizeForLayer,
  shaderContextCounts,
} from './shaderRendering';
import {
  applyAnimatedPaint,
  disposeElementContent,
  lottieBackingSizeForLayer,
  renderAnimatedElementAtTime,
  renderElementContent,
  refreshLottiePresentation,
  resolveBoundElement,
  resolveBoundEffects,
  setLottieDeterministicRendering,
  waitForElementContentReady,
} from './renderElement';
import {
  getElementShaderPaints,
  effectEnabled,
  getEffectStack,
  getShaderAnimationValue,
  hasElementMediaPaint,
  normalizeTextAnimation,
  normalizeChartAnimation,
  parseShaderAnimationProperty,
  shaderAnimationPropertySpec,
  hasElementShaderPaint,
  resolveShaderParameters,
  SHADER_PARAMETER_TARGET,
  clockTimerActionId,
  normalizeClockTimerSettings,
  visualRuleSetDataValue,
  type TextElement,
  type TickerElement,
  type VisualRuleAction,
  modifierParameterValue,
  numericModifierProperties,
  sampleLayerModifiers,
} from '@ograf-editor/scene-model';
import { waitForMediaPaintContentReady } from './mediaPaintRendering';
import {
  shaderStrokePaddingForLayer,
  waitForShaderPaintContentReady,
} from './shaderPaintRendering';
import {
  EFFECT_ANIMATION_PROPERTIES,
  numericEffectProperties,
  effectParameterValue,
  withEffectParameter,
  isGradientStopOffsetProperty,
  isRevealAnimationProperty,
  TRANSFORM_ANIMATION_PROPERTIES,
  type AnimatableLayerProperty,
  type LayerTransform,
} from '@ograf-editor/scene-model';
import {
  applyCompiledClipPaths,
  applyCompiledLayerVisualState,
  interpolateCompiledLayerVisualState,
  sampleCompiledLayerVisualState,
} from './loopRendering';
import {
  expandRuntimeCollections,
  isRuntimeCollectionLayerActive,
  runtimeCollectionItemSelection,
} from './runtimeCollections';
import { registerDocumentFonts } from './documentFonts';
import { bindRuntimePointerPosition, runtimeRelatedLayerId } from './runtimePointer';
import {
  bindRuntimeKeyboard,
  claimsRuntimeKeyboardInput,
  hasRuntimeKeyboardRules,
  type RuntimeKeyboardTrigger,
} from './runtimeKeyboard';
import type { VisualRuleKeyboardInput } from '@ograf-editor/scene-model';
import { applyCompiledAutoLayout } from './autoLayoutRendering';
import { applyCompiledMotionPaths } from './motionPathRendering';
import { applyCompiledTextPaths } from './textPathRendering';
import { applyCompiledModifiers } from './modifierRendering';
import {
  layerHasRuntimeVisualInputs,
  pointerVisualRuleTriggers,
  RuntimeVisualRules,
  sameValue,
  visualRuleEffectFor,
  visualRuleLayerVisible,
  type FiredRuntimeVisualRule,
} from './runtimeVisualRules';
import { MediaCueRuntime } from './mediaCueRuntime';
import { createLogicFunctionRuntime } from './logicFunctionRuntime';
import { renderTextAnimationAtFrame, setTextAnimationPrevious } from './textAnimationRendering';
import {
  chartAnimationEndFrame,
  renderChartAnimationAtFrame,
  resetChartAnimation,
  renderChartAnimationHistoryAtFrame,
  type ChartAnimationHistoryEntry,
} from './chartRendering';
import {
  createClockTimerRuntime,
  type ClockTimerRuntime,
  type ClockTimerCommand,
  type ClockTimerEvent,
} from './clockTimerRuntime';
import { clockTimerAlarmEventsAtTime, compiledTimerAlarms } from './timerAlarms';
import {
  resolveUpdateMotion,
  sampleUpdateMotion,
  UPDATE_MOTION_EASING,
  type UpdateMotion,
  type UpdateMotionSample,
} from './updateMotion';
import {
  pauseTickerAnimations,
  getTickerUpdateStatuses,
  renderTickerHistory,
  type TickerPlaybackUpdate,
} from './tickerRendering';

/** How deep rule -> custom action -> rule chains may go before rules stop answering. */
const MAX_RULE_CUSTOM_ACTION_DEPTH = 4;

/** Blanks the host through CSS: captures and inline-style checks must not see it as hidden. */
const PRESENTATION_SUSPENDED_ATTRIBUTE = 'data-ograf-presentation-suspended';
const SINGLE_INSTANCE_ID = 'single';
/** A stuck capture may show an old picture after this long, but never leaves the graphic blank. */
const PRESENTATION_REVEAL_TIMEOUT_MS = 1000;

/** Whether a data change fades or slides this layer, rather than cutting or animating its text. */
function layerPlaysUpdateTransition(layer: CompiledGraphicDescriptor['layers'][number]): boolean {
  const transition = layer.updateTransition;
  const style = transition?.style ?? 'inherit';
  if (style === 'none') return false;
  // A layer that chose no transition of its own must not have the composition's crossfade hide the
  // value its count or roll is carrying to the new one.
  return !(
    style === 'inherit' &&
    !transition?.durationFrames &&
    layer.element.type === 'text' &&
    textAnimationCarriesUpdate(layer.element.textAnimation)
  );
}

const MEDIA_CANVAS_SELECTOR = 'canvas[data-ograf-media-canvas="true"]';

function isShaderEffectOutput(element: HTMLElement): boolean {
  return element.dataset.ografShaderEffectOutput === 'true';
}

/** An overlay effect's output rests at its blend opacity, which an update must come back to. */
function restingOpacity(target: HTMLElement): number {
  return isShaderEffectOutput(target) ? Number(target.style.opacity || 1) : 1;
}

function errorPayload(err: unknown): ReturnPayload {
  return {
    statusCode: GRAPHIC_ERROR_STATUS_CODE,
    statusMessage: err instanceof Error ? err.message : String(err),
  };
}

/**
 * The keys of `patch` whose value differs from `current`. Playout hosts normally resend their whole
 * data object, and a value parsed from JSON each time has a new identity, so compare by content.
 */
function changedDataKeys(patch: unknown, current: Record<string, unknown>): Set<string> {
  if (!patch || typeof patch !== 'object') return new Set();
  return new Set(
    Object.entries(patch as Record<string, unknown>)
      .filter(([key, value]) => !sameValue(current[key], value))
      .map(([key]) => key),
  );
}

function contentOptions(
  layer: CompiledGraphicDescriptor['layers'][number],
  frameRate: number,
  rendererPlugins?: CompiledGraphicDescriptor['rendererPlugins'],
) {
  return {
    frameRate,
    rendererPlugins,
    chartMarkAnimations: layer.chartMarkAnimations,
    ...(layer.element.type === 'lottie'
      ? { lottieBackingSize: lottieBackingSizeForLayer(layer) }
      : {}),
    ...(hasElementShaderPaint(layer.element) || hasElementMediaPaint(layer.element)
      ? {
          shaderBackingSize: shaderBackingSizeForLayer(layer),
          shaderStrokePadding: shaderStrokePaddingForLayer(layer),
        }
      : {}),
  };
}

interface LoopExitCorrection {
  startFrame: number;
  targetFrame: number;
  layers: Map<
    string,
    {
      transform: Partial<LayerTransform>;
      effects: Partial<Record<(typeof EFFECT_ANIMATION_PROPERTIES)[number], number>>;
      paint: Partial<Record<AnimatableLayerProperty, number>>;
      discreteShader: Partial<Record<AnimatableLayerProperty, number>>;
      stack: Record<string, number>;
      modifiers: Record<string, number>;
    }
  >;
}

interface DirectLifecycleTransition {
  startFrame: number;
  targetFrame: number;
  layers: Map<
    string,
    {
      source: ReturnType<typeof sampleCompiledLayerVisualState>;
      target: ReturnType<typeof sampleCompiledLayerVisualState>;
    }
  >;
}

/**
 * The generic, descriptor-driven `Graphic` implementation — interprets a CompiledGraphicDescriptor
 * rather than being generated per-project. The SAME class (via this same npm-published/bundled
 * source) drives both the editor's in-app preview harness and every exported package's `main.js`,
 * keeping preview and exported playback on the same interpreter.
 *
 * Custom Elements can't take constructor arguments (the browser calls `new SubClass()` with no
 * args when upgrading/creating one), so the descriptor is read via a `static descriptor` on the
 * concrete subclass instead: `class Foo extends GraphicElement { static descriptor = {...} }`.
 * The in-app preview harness dynamically declares one such subclass per compile and registers it
 * under a fresh tag name; an exported package's main.js does the same thing once, statically.
 */
function exitDurationFrames(descriptor: CompiledGraphicDescriptor): number {
  const end = descriptor.keyframes.find((key) => key.id === descriptor.endKeyframeId)?.frame;
  if (descriptor.exitTailStartFrame !== undefined && end !== undefined)
    return Math.max(0, end - descriptor.exitTailStartFrame);
  return (
    descriptor.transitions.find(
      (transition) => transition.toKeyframeId === descriptor.endKeyframeId,
    )?.durationFrames ?? 0
  );
}

export abstract class GraphicElement extends HTMLElement implements Graphic {
  static descriptor: CompiledGraphicDescriptor;
  #frameRequestId = 0;
  /** `request` is null while a suspended presentation parks the callback under its ID. */
  #frameRequests = new Map<
    number,
    { owner: Window | null; request: number | null; callback: FrameRequestCallback }
  >();
  #presentationSuspended = false;
  #presentationRevealFrame: number | null = null;
  #presentationReveal = 0;

  #scheduleFrame(id: number, callback: FrameRequestCallback): void {
    const owner = this.ownerDocument?.defaultView ?? null;
    const invoke = () => {
      this.#frameRequests.delete(id);
      callback(performance.now());
    };
    const request = owner ? owner.requestAnimationFrame(invoke) : requestAnimationFrame(invoke);
    this.#frameRequests.set(id, { owner, request, callback });
  }

  #unscheduleFrame(entry: { owner: Window | null; request: number | null }): void {
    if (entry.request === null) return;
    if (entry.owner) entry.owner.cancelAnimationFrame(entry.request);
    else cancelAnimationFrame(entry.request);
    entry.request = null;
  }

  #requestFrame(callback: FrameRequestCallback): number {
    const id = ++this.#frameRequestId;
    if (this.#presentationSuspended)
      this.#frameRequests.set(id, { owner: null, request: null, callback });
    else this.#scheduleFrame(id, callback);
    return id;
  }

  #cancelFrame(id: number): void {
    const entry = this.#frameRequests.get(id);
    if (!entry) return;
    this.#unscheduleFrame(entry);
    this.#frameRequests.delete(id);
  }

  /**
   * For a host that retains this graphic while nobody can see it, such as an inactive preview tab.
   * Per-frame drawing and effect commits stop; transport, data, rules and clocks keep running, and
   * every parked loop derives its phase from an absolute clock, so resuming lands on the current
   * picture. The host stays blank from suspending until that picture has committed.
   */
  setPresentationSuspended(suspended: boolean): void {
    if (suspended === this.#presentationSuspended) return;
    this.#presentationSuspended = suspended;
    const reveal = ++this.#presentationReveal;
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    if (suspended) {
      this.setAttribute(PRESENTATION_SUSPENDED_ATTRIBUTE, '');
      suspendLayerEffects(root);
      if (this.#presentationRevealFrame !== null) this.#cancelFrame(this.#presentationRevealFrame);
      this.#presentationRevealFrame = null;
      for (const entry of this.#frameRequests.values()) this.#unscheduleFrame(entry);
      return;
    }
    const parked = [...this.#frameRequests].filter(([, entry]) => entry.request === null);
    const refresh = resumeLayerEffects(root, parked.length > 0);
    for (const [id, entry] of parked) this.#scheduleFrame(id, entry.callback);
    if (!parked.length && !refresh) {
      this.removeAttribute(PRESENTATION_SUSPENDED_ATTRIBUTE);
      return;
    }
    // Queued after the parked frames, so it waits for what they ask to be drawn.
    this.#presentationRevealFrame = this.#requestFrame(() => {
      this.#presentationRevealFrame = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, PRESENTATION_REVEAL_TIMEOUT_MS);
      });
      const current = async () => {
        // These paints draw asynchronously, so until they land their canvases hold the old frame.
        await Promise.allSettled([
          waitForShaderPaintContentReady(root),
          waitForMediaPaintContentReady(root),
        ]);
        await refresh?.();
      };
      void Promise.race([current(), expired]).finally(() => {
        clearTimeout(timer);
        if (reveal === this.#presentationReveal)
          this.removeAttribute(PRESENTATION_SUSPENDED_ATTRIBUTE);
      });
    });
  }

  adoptedCallback(): void {
    this.#logicFunctions?.pointerChanged(null);
    this.#documentFontsReady = registerDocumentFonts(
      this.ownerDocument,
      this.descriptor.fonts ?? [],
    );
    this.#timeline?.setClockOwner(this.ownerDocument.defaultView);
    for (const clock of this.#clocks.values()) clock.setClockOwner(this.ownerDocument.defaultView);
    // Keep callbacks on the visible document's clock without changing their IDs or phase.
    for (const [id, entry] of this.#frameRequests) {
      if (entry.request === null) continue;
      this.#unscheduleFrame(entry);
      this.#scheduleFrame(id, entry.callback);
    }
    if (this.shadowRoot) refreshLottiePresentation(this.shadowRoot);
  }

  #layerEls = new Map<string, HTMLElement>();
  #renderDescriptor: CompiledGraphicDescriptor | null = null;
  #mediaCueRuntime: MediaCueRuntime | null = null;
  #logicFunctions: ReturnType<typeof createLogicFunctionRuntime> | null = null;
  #functionGeneration = 0;
  #timeline: ReturnType<typeof buildRuntimeTimeline> | null = null;
  #activeTransition: { cancel(): void } | null = null;
  /** Index into `descriptor.stepKeyframeIds` — the OGraf "current step", not a keyframe index. */
  #currentStep: number | undefined;
  #lastData: Record<string, unknown> = {};
  /** Visual rule state: event overrides, hover, delays and transitions. */
  #rules: RuntimeVisualRules | null = null;
  #ruleTimers = new Set<ReturnType<typeof setTimeout>>();
  #ruleTransitionFrame: number | null = null;
  /** Layers whose content opacity a rule visibility fade currently owns. */
  #ruleFadingLayers = new Set<string>();
  #clickTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Layers pressed with the primary button, so only their own release fires `pointer-up`. */
  #pressedLayers = new Set<string>();
  #disposeRulePointer: (() => void) | null = null;
  #disposeKeyboard: (() => void) | null = null;
  #keyboardOnAir = false;
  #loaded = false;
  #schedule: ScheduledAction[] = [];
  #externalSchedule = new WeakSet<ScheduledAction>();
  /** Snapshot of `#lastData` taken when `setActionsSchedule` is called — the baseline `goToTime`
   * replays scheduled `updateAction` entries on top of, so scrubbing backward past a scheduled
   * update correctly reverts keys that update doesn't touch, instead of leaving them stuck. */
  #scheduleBaseData: Record<string, unknown> = {};
  /** Realtime self-animated-content redraw requests. Phase is derived from absolute elapsed time. */
  #contentAnimationFrame: number | null = null;
  #contentElapsedMs = 0;
  #textAnimationFrame: number | null = null;
  #textAnimationEpochs = new Map<string, number>();
  #textAnimationPrevious = new Map<string, TextElement>();
  #clocks = new Map<string, ClockTimerRuntime>();
  #clockText = new Map<string, TextElement>();
  #clockAlarmRuleDepth = 0;
  #chartAnimationFrame: number | null = null;
  #chartAnimationEpochs = new Map<string, number>();
  #contentPlaybackError: Error | null = null;
  #operationQueue: Promise<void> = Promise.resolve();
  #renderType: LoadParams['renderType'] = 'realtime';
  /** Absolute clock epochs for active layer-local loops. Values use performance.now() in realtime
   * and the scheduled OGraf timestamp in non-realtime; sampling always derives phase absolutely. */
  #activeLoopEpochs = new Map<string, number>();
  #loopAnimationFrame: number | null = null;
  #loopPlayback = new LoopPlaybackController();
  #loopExitCorrection: LoopExitCorrection | null = null;
  #directLifecycleTransition: DirectLifecycleTransition | null = null;
  #updateAnimations: Animation[] = [];
  /** What scheduled replay last drew on a shader effect's output, by layer. */
  #updateSampleHolds = new Map<string, Animation>();
  /** The `replace` update in progress, for a repeat of its data to wait on. */
  #runningUpdate: Promise<ReturnPayload | undefined> | null = null;
  /** The data of that update until it has gone on air. */
  #unappliedUpdateData: Record<string, unknown> | null = null;
  #updateGeneration = 0;

  private get descriptor(): CompiledGraphicDescriptor {
    return (this.constructor as typeof GraphicElement).descriptor;
  }

  private get activeDescriptor(): CompiledGraphicDescriptor {
    return this.#renderDescriptor ?? this.descriptor;
  }

  /** The mounted graphic has one instance, with an ID scoped to this element. */
  get instances(): GraphicInstances {
    const instances: Record<string, GraphicInstance> = Object.create(null);
    if (this.#loaded) {
      instances[SINGLE_INSTANCE_ID] = Object.freeze({
        instanceId: SINGLE_INSTANCE_ID,
        layers: Object.freeze(
          collectExportedLayers(this.descriptor.layers, (id) => this.#layerEls.get(id)),
        ),
      });
    }
    return Object.freeze(instances);
  }

  getTickerUpdates() {
    return this.shadowRoot ? getTickerUpdateStatuses(this.shadowRoot) : [];
  }

  /** Studio may edit ticker artwork without replacing the loaded timeline or Rules engine. */
  updateTickerElements(next: CompiledGraphicDescriptor): boolean {
    const current = this.activeDescriptor;
    if (
      current.layers.length !== next.layers.length ||
      current.width !== next.width ||
      current.height !== next.height
    )
      return false;
    const layers = current.layers.map((layer) => {
      const candidate = next.layers.find((value) => value.id === layer.id);
      return layer.element.type === 'ticker' && candidate?.element.type === 'ticker'
        ? { ...layer, element: candidate.element }
        : layer;
    });
    this.#renderDescriptor = { ...current, layers };
    for (const layer of layers)
      if (layer.element.type === 'ticker') {
        const host = this.#layerEls.get(layer.id);
        if (!host) continue;
        renderElementContent(host, this.#resolveLayerElement(layer), 0, {
          ...contentOptions(layer, current.frameRate, current.rendererPlugins),
          timestampMs: this.#contentElapsedMs,
          tickerUpdateContext: 'authoring',
          tickerAuthoringPaused: this.#currentStep === undefined && this.#activeTransition === null,
        });
        renderAnimatedElementAtTime(host, layer.element, this.#contentElapsedMs, {
          playing: this.#renderType === 'realtime' && this.#contentAnimationFrame !== null,
        });
      }
    return true;
  }

  #resolveLayerElement(layer: CompiledGraphicDescriptor['layers'][number], data = this.#lastData) {
    return resolveBoundElement(layer, data);
  }

  #visualRuleVisible(layer: CompiledGraphicDescriptor['layers'][number]): boolean {
    return visualRuleLayerVisible(layer, this.#lastData);
  }

  #ruleClock(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  #clearRuleTimers(): void {
    for (const timer of this.#ruleTimers) clearTimeout(timer);
    this.#ruleTimers.clear();
    if (this.#ruleTransitionFrame !== null && typeof cancelAnimationFrame !== 'undefined')
      this.#cancelFrame(this.#ruleTransitionFrame);
    this.#ruleTransitionFrame = null;
  }

  /**
   * Re-derives rule output from current data, then redraws what it changed. Rule transitions run
   * on the page clock in real time; outside schedule replay, non-real-time output lands at once.
   */
  #refreshRuleOutput(): void {
    const rules = this.#rules;
    if (rules) {
      const now = this.#ruleClock();
      rules.update(this.#lastData, now);
      const running = rules.publish(
        this.#renderType === 'realtime' ? now : Number.POSITIVE_INFINITY,
      );
      if (running) this.#ensureRuleTransitionRendering();
    }
    this.#refreshBoundLayers();
    this.#renderLoopSnapshot(this.#ruleClock());
  }

  #ensureRuleTransitionRendering(): void {
    if (
      this.#renderType !== 'realtime' ||
      this.#ruleTransitionFrame !== null ||
      typeof requestAnimationFrame === 'undefined'
    )
      return;
    const render = (now: number) => {
      this.#ruleTransitionFrame = null;
      if (!this.#rules || this.#renderType !== 'realtime') return;
      const running = this.#rules.publish(now);
      this.#refreshBoundLayers();
      this.#renderLoopSnapshot(now);
      if (running) this.#ruleTransitionFrame = this.#requestFrame(render);
    };
    this.#ruleTransitionFrame = this.#requestFrame(render);
  }

  /**
   * Runs fired rules: visibility and property actions change rule state, the rest (sounds, media,
   * custom actions) run afterwards. Delayed rules wait on a timer in real time only; `depth` stops
   * a rule that runs a custom action that fires the same rule from looping forever.
   */
  #runRules(fired: FiredRuntimeVisualRule[], depth = 0, delayed = false): void {
    const rules = this.#rules;
    if (!rules) return;
    const sideEffects: VisualRuleAction[] = [];
    for (const entry of fired) {
      const delay = delayed ? 0 : rules.delayMs(entry);
      if (delay > 0 && this.#renderType === 'realtime') {
        const timer = setTimeout(() => {
          this.#ruleTimers.delete(timer);
          if (this.#rules === rules) this.#runRules([entry], depth, true);
        }, delay);
        this.#ruleTimers.add(timer);
        continue;
      }
      sideEffects.push(...rules.run(entry));
    }
    this.#refreshRuleOutput();
    this.#runVisualRuleEventActions(sideEffects, depth);
  }

  #fireLifecycleRules(
    trigger: 'play' | 'step' | 'stop' | 'custom-action',
    eventId?: string,
    depth = 0,
  ): void {
    if (!this.#rules) return;
    this.#runRules(
      this.#rules.eventFired(trigger, this.#lastData, eventId === undefined ? {} : { eventId }),
      depth,
    );
  }

  async #serializeOperation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operationQueue;
    let release = () => {};
    this.#operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  connectedCallback(): void {
    this.#logicFunctions?.rebindOwnerDocument();
    if (this.shadowRoot && this.#layerEls.size > 0) return;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.#buildDom();
  }

  handleKeyboardInput(trigger: RuntimeKeyboardTrigger, input: VisualRuleKeyboardInput): boolean {
    if (
      this.#renderType !== 'realtime' ||
      !this.#keyboardOnAir ||
      !this.#loaded ||
      this.style.visibility === 'hidden' ||
      this.style.opacity === '0' ||
      !this.#rules ||
      !this.#timeline ||
      !claimsRuntimeKeyboardInput(this.activeDescriptor.layers, trigger, input)
    )
      return false;
    const fired = this.#rules.eventFired(trigger, this.#lastData, { keyboard: input });
    if (fired.length) this.#runRules(fired);
    return true;
  }

  disconnectedCallback(): void {
    queueMicrotask(() => {
      if (this.isConnected) return;
      this.#keyboardOnAir = false;
      this.#loaded = false;
      this.#disposeKeyboard?.();
      this.#disposeKeyboard = null;
      this.#disposeLogicFunctions();
      this.#activeTransition?.cancel();
      this.#timeline?.dispose();
      this.#clearContentAnimationFrames();
      this.#clearTextAnimationFrames();
      this.#disposeClocks();
      this.#clearChartAnimationFrames();
      this.#stopLoopRendering();
      this.#abandonRunningUpdate();
      for (const timer of this.#clickTimers.values()) clearTimeout(timer);
      this.#clickTimers.clear();
      this.#clearRuleTimers();
      this.#disposeRulePointer?.();
      this.#disposeRulePointer = null;
      for (const element of this.#layerEls.values()) disposeElementContent(element);
      this.#mediaCueRuntime?.dispose();
      this.#mediaCueRuntime = null;
      this.#layerEls.clear();
      this.#renderDescriptor = null;
    });
  }

  #clearContentAnimationFrames(): void {
    if (this.shadowRoot) pauseTickerAnimations(this.shadowRoot);
    if (this.#contentAnimationFrame !== null && typeof cancelAnimationFrame !== 'undefined') {
      this.#cancelFrame(this.#contentAnimationFrame);
    }
    this.#contentAnimationFrame = null;
  }

  #disposeClocks(): void {
    for (const clock of this.#clocks.values()) clock.dispose();
    this.#clocks.clear();
    this.#clockText.clear();
  }

  #clockLayoutDepth = 0;
  #clockLayoutDirty = false;

  #refreshClockLayout(): void {
    this.#clockLayoutDirty = true;
    if (this.#clockLayoutDepth || !this.#timeline) return;
    this.#clockLayoutDirty = false;
    // Layout does not render clock content: rebuilding a glyph host cannot recursively tick it.
    this.#renderLoopSnapshot(this.#ruleClock());
  }

  #initializeClocks(): void {
    this.#clockLayoutDepth += 1;
    try {
      this.#disposeClocks();
      for (const layer of this.activeDescriptor.layers) {
        const element = this.#resolveLayerElement(layer);
        const host = this.#layerEls.get(layer.id);
        if (!host || element.type !== 'text' || !element.clock) continue;
        const clock = createClockTimerRuntime({
          element,
          frameRate: this.activeDescriptor.frameRate,
          owner: this.ownerDocument.defaultView,
          lifecycleDriven: true,
          alarms: compiledTimerAlarms(this.activeDescriptor.layers, layer.id),
          onAlarm: (alarm) => {
            if (
              this.#renderType !== 'realtime' ||
              !this.#rules ||
              this.#clockAlarmRuleDepth >= MAX_RULE_CUSTOM_ACTION_DEPTH
            )
              return;
            this.#runRules(
              this.#rules.eventFired('timer-alarm', this.#lastData, {
                hostLayerId: layer.id,
                eventId: alarm.id,
                ...(alarm.ownerLayerId === undefined
                  ? {}
                  : { timerAlarmOwnerLayerId: alarm.ownerLayerId }),
              }),
              this.#clockAlarmRuleDepth,
            );
          },
          render: (resolved) => {
            this.#clockText.set(layer.id, resolved);
            renderElementContent(
              host,
              resolved,
              0,
              contentOptions(
                layer,
                this.activeDescriptor.frameRate,
                this.activeDescriptor.rendererPlugins,
              ),
            );
            const frame = this.#timeline?.frame() ?? 0;
            const state = sampleCompiledLayerVisualState(layer, frame, undefined, this.#lastData);
            applyLayerEffectsFilter(host, state.effects, this.#contentElapsedMs);
            applyAnimatedPaint(host, layer.animationTracks, frame);
            this.#refreshClockLayout();
          },
          animate: (resolved, frame, previous) => {
            host.dataset.ografTextAnimationFrame = String(frame);
            setTextAnimationPrevious(host, previous);
            renderTextAnimationAtFrame(host, resolved, frame);
          },
        });
        this.#clocks.set(layer.id, clock);
        clock.renderAtTime(0, [], true);
      }
    } finally {
      this.#clockLayoutDepth -= 1;
      if (this.#clockLayoutDirty) this.#refreshClockLayout();
    }
  }

  #clockCommandFor(layerId: string, actionId: string): ClockTimerCommand | undefined {
    const layer = this.activeDescriptor.layers.find((candidate) => candidate.id === layerId);
    const prototypeId = layer?.collectionItem?.prototypeLayerId;
    return (['start', 'pause', 'reset', 'restart'] as const).find(
      (command) =>
        clockTimerActionId(layerId, command) === actionId ||
        (prototypeId !== undefined && clockTimerActionId(prototypeId, command) === actionId),
    );
  }

  #renderClocksAt(timestamp: number, events?: Map<string, ClockTimerEvent[]>): void {
    this.#clockLayoutDepth += 1;
    try {
      for (const [layerId, clock] of this.#clocks)
        clock.renderAtTime(timestamp, events?.get(layerId), events !== undefined);
    } finally {
      this.#clockLayoutDepth -= 1;
      // Every deterministic caller evaluates its complete pose after all clocks have published.
      this.#clockLayoutDirty = false;
    }
  }

  #clearTextAnimationFrames(): void {
    if (this.#textAnimationFrame !== null && typeof cancelAnimationFrame !== 'undefined') {
      this.#cancelFrame(this.#textAnimationFrame);
    }
    this.#textAnimationFrame = null;
    this.#textAnimationEpochs.clear();
    this.#textAnimationPrevious.clear();
    for (const host of this.#layerEls.values()) delete host.dataset.ografTextAnimationFrame;
  }

  #renderTextAnimationReplays(now: number): void {
    const frameRate = this.activeDescriptor.frameRate;
    for (const [layerId, epoch] of this.#textAnimationEpochs) {
      const layer = this.activeDescriptor.layers.find((candidate) => candidate.id === layerId);
      const host = this.#layerEls.get(layerId);
      const element = layer ? this.#resolveLayerElement(layer) : null;
      if (!host || element?.type !== 'text') {
        this.#textAnimationEpochs.delete(layerId);
        this.#textAnimationPrevious.delete(layerId);
        continue;
      }
      const animation = normalizeTextAnimation(element.textAnimation);
      const frame = Math.max(0, ((now - epoch) / 1000) * frameRate);
      host.dataset.ografTextAnimationFrame = String(frame);
      setTextAnimationPrevious(host, this.#textAnimationPrevious.get(layerId) ?? null);
      renderTextAnimationAtFrame(host, element, frame);
      if (frame >= textAnimationTotalFrames(animation)) {
        this.#textAnimationEpochs.delete(layerId);
        host.dataset.ografTextAnimationFrame = String(textAnimationTotalFrames(animation));
      }
    }
  }

  #ensureTextAnimationRendering(): void {
    if (
      this.#renderType !== 'realtime' ||
      this.#textAnimationEpochs.size === 0 ||
      this.#textAnimationFrame !== null ||
      typeof requestAnimationFrame === 'undefined'
    )
      return;
    const render = (now: number) => {
      this.#textAnimationFrame = null;
      this.#renderTextAnimationReplays(now);
      if (this.#textAnimationEpochs.size > 0) this.#textAnimationFrame = this.#requestFrame(render);
    };
    this.#textAnimationFrame = this.#requestFrame(render);
  }

  #triggerTextAnimationReplays(
    predicate: (layer: CompiledGraphicDescriptor['layers'][number]) => boolean,
    epoch = typeof performance !== 'undefined' ? performance.now() : Date.now(),
    previous?: ReadonlyMap<string, TextElement>,
  ): string[] {
    const triggered: string[] = [];
    for (const layer of this.activeDescriptor.layers) {
      if (layer.element.type !== 'text' || !predicate(layer)) continue;
      if (layer.element.clock) continue;
      const element = this.#resolveLayerElement(layer);
      if (element.type !== 'text' || !hasTextAnimationSettings(element.textAnimation)) continue;
      this.#textAnimationEpochs.set(layer.id, epoch);
      const previousElement = previous?.get(layer.id);
      if (previousElement) this.#textAnimationPrevious.set(layer.id, previousElement);
      else this.#textAnimationPrevious.delete(layer.id);
      const host = this.#layerEls.get(layer.id);
      if (host) {
        host.dataset.ografTextAnimationFrame = '0';
        setTextAnimationPrevious(host, previous?.get(layer.id) ?? null);
        renderTextAnimationAtFrame(host, element, 0);
      }
      triggered.push(layer.id);
    }
    this.#ensureTextAnimationRendering();
    return triggered;
  }

  #clearChartAnimationFrames(): void {
    if (this.#chartAnimationFrame !== null) this.#cancelFrame(this.#chartAnimationFrame);
    this.#chartAnimationFrame = null;
    this.#chartAnimationEpochs.clear();
    for (const host of this.#layerEls.values()) delete host.dataset.ografChartAnimationFrame;
  }

  #startChartAnimations(skipAnimation: boolean, changedKeys?: Set<string>): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const layer of this.activeDescriptor.layers) {
      if (layer.element.type !== 'chart') continue;
      const element = this.#resolveLayerElement(layer);
      if (element.type !== 'chart') continue;
      const animation = normalizeChartAnimation(element.animation);
      if (animation.type === 'none') continue;
      if (
        changedKeys &&
        (!animation.replayOnUpdate ||
          !(layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
            (binding) => binding.targetProperty === 'data' && changedKeys.has(binding.dataKey),
          ))
      )
        continue;
      const host = this.#layerEls.get(layer.id);
      if (!host) continue;
      if (!changedKeys) resetChartAnimation(host);
      const settle = skipAnimation || this.#renderType !== 'realtime';
      const frame = settle ? chartAnimationEndFrame(element) : 0;
      host.dataset.ografChartAnimationFrame = String(frame);
      renderChartAnimationAtFrame(host, element, frame, this.#chartMarkFrame());
      if (settle) this.#chartAnimationEpochs.delete(layer.id);
      else this.#chartAnimationEpochs.set(layer.id, now);
    }
    this.#ensureChartAnimationRendering();
  }

  #ensureChartAnimationRendering(): void {
    if (
      this.#renderType !== 'realtime' ||
      this.#chartAnimationEpochs.size === 0 ||
      this.#chartAnimationFrame !== null ||
      typeof requestAnimationFrame === 'undefined'
    )
      return;
    const render = (now: number) => {
      this.#chartAnimationFrame = null;
      for (const [layerId, epoch] of this.#chartAnimationEpochs) {
        const layer = this.activeDescriptor.layers.find((candidate) => candidate.id === layerId);
        const host = this.#layerEls.get(layerId);
        const element = layer ? this.#resolveLayerElement(layer) : null;
        if (!host || element?.type !== 'chart') {
          this.#chartAnimationEpochs.delete(layerId);
          continue;
        }
        const endFrame = chartAnimationEndFrame(element);
        const frame = Math.min(
          endFrame,
          Math.max(0, ((now - epoch) / 1000) * this.activeDescriptor.frameRate),
        );
        host.dataset.ografChartAnimationFrame = String(frame);
        renderChartAnimationAtFrame(host, element, frame, this.#chartMarkFrame());
        // Keep the completed snapshot while parked at a Step or during OUT. Returning to the
        // lifecycle's earlier frame must not replay the chart's entrance after an update.
        if (frame >= endFrame) this.#chartAnimationEpochs.delete(layerId);
      }
      if (this.#chartAnimationEpochs.size > 0)
        this.#chartAnimationFrame = this.#requestFrame(render);
    };
    this.#chartAnimationFrame = this.#requestFrame(render);
  }

  #cancelUpdateAnimations(): void {
    for (const animation of this.#updateAnimations) animation.cancel();
    this.#updateAnimations = [];
    for (const layer of this.activeDescriptor.layers) {
      const host = this.#layerEls.get(layer.id);
      const content = host?.firstElementChild as HTMLElement | null | undefined;
      if (!content) continue;
      // Hidden under a shader effect, its inline opacity belongs to the effect stack.
      if (this.#updateMotionTargets(host).includes(content)) content.style.opacity = '';
      content.style.translate = '';
    }
  }

  /**
   * The data keys whose change fades this layer's content out and back in. A shader takes new
   * uniform values in place, and fading the object for each one makes a slider drag flicker, so a
   * shader parameter fades only a layer that chose its own update transition.
   */
  #contentFadeKeys(layer: CompiledGraphicDescriptor['layers'][number]): string[] {
    if (!layerPlaysUpdateTransition(layer)) return [];
    const inherits = (layer.updateTransition?.style ?? 'inherit') === 'inherit';
    return [
      ...(layer.bindings ?? (layer.binding ? [layer.binding] : []))
        .filter((binding) => !(inherits && SHADER_PARAMETER_TARGET.test(binding.targetProperty)))
        .map((binding) => binding.dataKey),
      ...(layer.collectionItem ? [layer.collectionItem.dataKey] : []),
      ...(this.#rules?.dataKeysFor(layer.id) ?? []),
    ];
  }

  #updateMotion(layer: CompiledGraphicDescriptor['layers'][number]): UpdateMotion | undefined {
    return resolveUpdateMotion(
      layer.updateTransition,
      this.descriptor.updateTransitionFrames,
      this.descriptor.frameRate,
    );
  }

  /**
   * The subset of `changed` that fades some layer. Callers work out `changed` against their own
   * baseline: `#lastData` on air, but scheduled replay's running data, because there `#lastData`
   * only holds whatever the previous seek displayed.
   */
  #changedBindingKeys(changed: ReadonlySet<string>): Set<string> {
    return new Set(
      this.activeDescriptor.layers
        .flatMap((layer) => this.#contentFadeKeys(layer))
        .filter((key) => changed.has(key)),
    );
  }

  #captureTextAnimationElements(): Map<string, TextElement> {
    const previous = new Map<string, TextElement>();
    for (const layer of this.activeDescriptor.layers) {
      const element = this.#resolveLayerElement(layer);
      if (element.type === 'text' && !element.clock) previous.set(layer.id, element);
    }
    return previous;
  }

  #replayUpdatedText(dataKeys: Set<string>, previous: ReadonlyMap<string, TextElement>): void {
    this.#triggerTextAnimationReplays(
      (layer) => {
        if (layer.element.type !== 'text') return false;
        const animation = normalizeTextAnimation(layer.element.textAnimation);
        if (!animation.replayOnUpdate) return false;
        return (layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
          (binding) => binding.targetProperty === 'content' && dataKeys.has(binding.dataKey),
        );
      },
      undefined,
      previous,
    );
  }

  #settleUpdatedText(dataKeys: Set<string>): void {
    for (const layer of this.activeDescriptor.layers) {
      if (layer.element.type !== 'text' || layer.element.clock) continue;
      if (
        !(layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
          (binding) => binding.targetProperty === 'content' && dataKeys.has(binding.dataKey),
        )
      )
        continue;
      const host = this.#layerEls.get(layer.id);
      const element = this.#resolveLayerElement(layer);
      if (!host || element.type !== 'text') continue;
      this.#textAnimationEpochs.delete(layer.id);
      this.#textAnimationPrevious.delete(layer.id);
      const frame = textAnimationTotalFrames(element.textAnimation);
      host.dataset.ografTextAnimationFrame = String(frame);
      setTextAnimationPrevious(host, null);
      renderTextAnimationAtFrame(host, element, frame);
    }
  }

  /**
   * Draws a scheduled update at the time goToTime is replaying. Every other layer is cleared, so
   * nothing an earlier seek sampled can survive into this one.
   */
  #setUpdateMotionSamples(samples: ReadonlyMap<string, UpdateMotionSample>): void {
    for (const layer of this.activeDescriptor.layers) {
      const host = this.#layerEls.get(layer.id);
      const content = host?.firstElementChild as HTMLElement | null;
      if (!host || !content) continue;
      const sample = samples.get(layer.id);
      const targets = this.#updateMotionTargets(host);
      // Not `transform`, which text content keeps its baseline shift and squeeze in.
      const translate = sample && (sample.x || sample.y) ? `${sample.x}px ${sample.y}px` : '';
      content.style.translate = targets.includes(content) ? translate : '';
      if (targets.includes(content)) {
        if (sample) content.style.opacity = String(sample.opacity);
        else if (!this.#ruleFadingLayers.has(layer.id)) content.style.opacity = '';
      }
      this.#updateSampleHolds.get(layer.id)?.cancel();
      this.#updateSampleHolds.delete(layer.id);
      const output = targets.find((target) => target !== content);
      if (!output || !sample) continue;
      // Its effect stack writes this output's inline opacity with every frame it draws.
      const pose = {
        opacity: restingOpacity(output) * sample.opacity,
        translate: translate || '0px 0px',
      };
      this.#updateSampleHolds.set(
        layer.id,
        output.animate([pose, pose], { duration: 0, fill: 'forwards' }),
      );
    }
  }

  /**
   * What an update moves on a layer. Under a shader effect the output is what shows, and the content
   * is the effect's input: held invisible, it would be captured invisible and stay that way. A Media
   * input feeds the effect from its own canvas and leaves the rest of the content showing, so there
   * the content moves along with the output.
   */
  #updateMotionTargets(host: HTMLElement | undefined): HTMLElement[] {
    const content = host?.firstElementChild as HTMLElement | null | undefined;
    if (!host || !content) return [];
    const output = ([...host.children] as HTMLElement[]).find(isShaderEffectOutput);
    if (!output) return [content];
    return host.querySelectorAll(MEDIA_CANVAS_SELECTOR).length ? [content, output] : [output];
  }

  async #animateBoundContent(dataKeys: Set<string>, phase: 'out' | 'hold' | 'in'): Promise<void> {
    if (dataKeys.size === 0) return;
    const animations: Animation[] = [];
    for (const layer of this.activeDescriptor.layers) {
      if (!this.#contentFadeKeys(layer).some((key) => dataKeys.has(key))) continue;
      const motion = this.#updateMotion(layer);
      if (!motion) continue;
      for (const target of this.#updateMotionTargets(this.#layerEls.get(layer.id))) {
        // Not `transform`, which text content keeps its baseline shift and squeeze in.
        const resting = { opacity: restingOpacity(target), translate: '0px 0px' };
        const shifted = { opacity: 0, translate: `${motion.x}px ${motion.y}px` };
        const keyframes =
          phase === 'out'
            ? [resting, shifted]
            : phase === 'hold'
              ? [shifted, shifted]
              : [shifted, resting];
        const animation = target.animate(keyframes, {
          duration: phase === 'hold' ? 0 : motion.halfMs,
          easing: UPDATE_MOTION_EASING,
          // Only the fade-in lets go. A held fade-in would outrank every later inline opacity, so a
          // Rule's visibility fade on this layer would never paint.
          fill: phase === 'in' ? 'none' : 'forwards',
        });
        animations.push(animation);
      }
    }
    // Its replacement has started in this same task, so dropping a hold cannot flash the content.
    for (const held of this.#updateAnimations) held.cancel();
    this.#updateAnimations = animations;
    if (phase === 'hold') return;
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
    // A finished fade-out stays listed, so whatever ends this update can still release its hold.
    if (phase === 'in' && this.#updateAnimations === animations) this.#updateAnimations = [];
  }

  #stopLoopRendering(): void {
    if (this.#loopAnimationFrame !== null && typeof cancelAnimationFrame !== 'undefined') {
      this.#cancelFrame(this.#loopAnimationFrame);
    }
    this.#loopAnimationFrame = null;
    this.#activeLoopEpochs.clear();
  }

  #chartMarkFrame(
    frame = this.#timeline?.frame() ?? 0,
    direct = this.#directLifecycleTransition,
  ): number {
    return chartMarkLifecycleFrame(this.activeDescriptor, frame, direct);
  }

  #renderLoopSnapshot(clockMs: number, epochs = this.#activeLoopEpochs): void {
    const baseFrame = this.#timeline?.frame() ?? 0;
    const states = new Map<string, ReturnType<typeof sampleCompiledLayerVisualState>>();
    for (const layer of this.activeDescriptor.layers) {
      const direct = this.#directLifecycleTransition;
      const directLayer = direct?.layers.get(layer.id);
      const directDistance = direct ? Math.abs(direct.targetFrame - direct.startFrame) : 0;
      const directProgress =
        !direct || directDistance === 0
          ? 1
          : Math.min(1, Math.abs(baseFrame - direct.startFrame) / directDistance);
      const epoch = epochs.get(layer.id);
      const rawElapsedFrames =
        epoch === undefined
          ? undefined
          : Math.max(0, ((clockMs - epoch) / 1000) * this.descriptor.frameRate);
      const elapsedFrames = this.#loopPlayback.sample(
        layer,
        rawElapsedFrames,
        this.#lastData,
        (clockMs * this.descriptor.frameRate) / 1000,
      );
      const state =
        direct && directLayer
          ? interpolateCompiledLayerVisualState(
              layer,
              directLayer.source,
              directLayer.target,
              directProgress,
              direct.targetFrame,
              this.#lastData,
            )
          : sampleCompiledLayerVisualState(layer, baseFrame, elapsedFrames, this.#lastData);
      const correction = this.#loopExitCorrection?.layers.get(layer.id);
      if (!direct && correction && this.#loopExitCorrection) {
        const distance = Math.abs(
          this.#loopExitCorrection.targetFrame - this.#loopExitCorrection.startFrame,
        );
        const progress =
          distance === 0
            ? 1
            : Math.min(1, Math.abs(baseFrame - this.#loopExitCorrection.startFrame) / distance);
        const remaining = 1 - progress;
        for (const [property, delta] of Object.entries(correction.transform) as [
          keyof LayerTransform,
          number,
        ][]) {
          state.transform[property] += delta * remaining;
        }
        for (const [property, delta] of Object.entries(correction.effects) as [
          (typeof EFFECT_ANIMATION_PROPERTIES)[number],
          number,
        ][]) {
          state.effects[property] += delta * remaining;
        }
        for (const [property, delta] of Object.entries(correction.stack))
          state.effects = withEffectParameter(
            state.effects,
            property,
            Number(effectParameterValue(state.effects, property)) + delta * remaining,
          );
        if (state.modifiers?.length)
          state.modifiers = sampleLayerModifiers(
            { modifiers: state.modifiers },
            (property, value) => value + (correction.modifiers[property] ?? 0) * remaining,
          );
        for (const [property, delta] of Object.entries(correction.paint) as [
          AnimatableLayerProperty,
          number,
        ][]) {
          const sampled = state.paintTracks[property]?.[0];
          if (sampled) sampled.value += delta * remaining;
          else if (remaining > 0 && parseShaderAnimationProperty(property)) {
            const value =
              getShaderAnimationValue(this.#resolveLayerElement(layer), property) +
              delta * remaining;
            state.paintTracks[property] = [
              { id: `${layer.id}:${property}:loop-exit`, frame: 0, value, easing: 'linear' },
            ];
          }
        }
        if (remaining > 0) {
          for (const [property, value] of Object.entries(correction.discreteShader) as [
            AnimatableLayerProperty,
            number,
          ][]) {
            state.paintTracks[property] = [
              { id: `${layer.id}:${property}:loop-exit`, frame: 0, value, easing: 'linear' },
            ];
          }
        }
      }
      state.effects = resolveBoundEffects(layer, this.#lastData, state.effects);
      states.set(layer.id, state);
    }
    const modifierContext = { timestampMs: clockMs, clockText: this.#clockText };
    applyCompiledAutoLayout(
      this.activeDescriptor,
      states,
      this.#lastData,
      this.#layerEls,
      modifierContext,
    );
    applyCompiledMotionPaths(this.activeDescriptor, states);
    applyCompiledModifiers(
      this.activeDescriptor,
      states,
      this.#lastData,
      this.#layerEls,
      modifierContext,
    );
    for (const layer of this.activeDescriptor.layers) {
      const element = this.#layerEls.get(layer.id);
      const state = states.get(layer.id);
      if (element && state) {
        applyCompiledLayerVisualState(element, state, this.#contentElapsedMs);
        if (layer.element.type === 'chart' && layer.chartMarkAnimations) {
          const resolved = this.#resolveLayerElement(layer);
          if (resolved.type === 'chart')
            renderChartAnimationAtFrame(
              element,
              resolved,
              baseFrame,
              this.#chartMarkFrame(baseFrame),
            );
        }
      }
    }
    applyCompiledTextPaths(this.activeDescriptor, states, this.#layerEls, (layer) =>
      this.#resolveLayerElement(layer),
    );
    applyCompiledClipPaths(this.activeDescriptor, this.#layerEls, states);
    applyCompiledMasks(this.activeDescriptor, this.#layerEls, states, this.#lastData);
  }

  #createDirectLifecycleTransition(
    startFrame: number,
    targetFrame: number,
    clockMs: number,
    epochs = this.#activeLoopEpochs,
    data = this.#lastData,
  ): DirectLifecycleTransition {
    const layers = new Map<
      string,
      DirectLifecycleTransition['layers'] extends Map<string, infer V> ? V : never
    >();
    for (const layer of this.activeDescriptor.layers) {
      const epoch = epochs.get(layer.id);
      const elapsedFrames =
        epoch === undefined
          ? undefined
          : Math.max(0, ((clockMs - epoch) / 1000) * this.descriptor.frameRate);
      layers.set(layer.id, {
        source: sampleCompiledLayerVisualState(layer, startFrame, elapsedFrames, data),
        target: sampleCompiledLayerVisualState(layer, targetFrame, undefined, data),
      });
    }
    return { startFrame, targetFrame, layers };
  }

  #renderDirectLifecycleTransition(transition: DirectLifecycleTransition, progress: number): void {
    const frame =
      transition.startFrame + (transition.targetFrame - transition.startFrame) * progress;
    const states = new Map<string, ReturnType<typeof sampleCompiledLayerVisualState>>();
    for (const layer of this.activeDescriptor.layers) {
      const resolved = transition.layers.get(layer.id);
      if (!resolved) continue;
      const state = interpolateCompiledLayerVisualState(
        layer,
        resolved.source,
        resolved.target,
        progress,
        transition.targetFrame,
        this.#lastData,
      );
      state.effects = resolveBoundEffects(layer, this.#lastData, state.effects);
      states.set(layer.id, state);
    }
    const modifierContext = { timestampMs: this.#contentElapsedMs, clockText: this.#clockText };
    applyCompiledAutoLayout(
      this.activeDescriptor,
      states,
      this.#lastData,
      this.#layerEls,
      modifierContext,
    );
    applyCompiledMotionPaths(this.activeDescriptor, states);
    applyCompiledModifiers(
      this.activeDescriptor,
      states,
      this.#lastData,
      this.#layerEls,
      modifierContext,
    );
    for (const layer of this.activeDescriptor.layers) {
      const element = this.#layerEls.get(layer.id);
      const state = states.get(layer.id);
      if (element && state) {
        applyCompiledLayerVisualState(element, state, this.#contentElapsedMs);
        if (layer.element.type === 'chart' && layer.chartMarkAnimations) {
          const resolved = this.#resolveLayerElement(layer);
          if (resolved.type === 'chart')
            renderChartAnimationAtFrame(
              element,
              resolved,
              frame,
              this.#chartMarkFrame(frame, transition),
            );
        }
      }
    }
    applyCompiledTextPaths(this.activeDescriptor, states, this.#layerEls, (layer) =>
      this.#resolveLayerElement(layer),
    );
    applyCompiledClipPaths(this.activeDescriptor, this.#layerEls, states);
    applyCompiledMasks(this.activeDescriptor, this.#layerEls, states, this.#lastData);
  }

  #beginDirectLifecycleTransition(targetFrame: number, clockMs: number): void {
    const startFrame = this.#timeline?.frame() ?? 0;
    this.#loopExitCorrection = null;
    this.#directLifecycleTransition = this.#createDirectLifecycleTransition(
      startFrame,
      targetFrame,
      clockMs,
    );
  }

  #beginLoopExit(
    targetFrame: number,
    clockMs: number,
    shouldExit: (layer: CompiledGraphicDescriptor['layers'][number]) => boolean,
    baseFrame = this.#timeline?.frame() ?? 0,
    epochs = this.#activeLoopEpochs,
    data = this.#lastData,
  ): void {
    this.#directLifecycleTransition = null;
    const layers = new Map<
      string,
      LoopExitCorrection['layers'] extends Map<string, infer V> ? V : never
    >();
    for (const layer of this.activeDescriptor.layers) {
      const epoch = epochs.get(layer.id);
      if (epoch === undefined || !layer.loop || !shouldExit(layer)) continue;
      const elapsed = Math.max(0, ((clockMs - epoch) / 1000) * this.descriptor.frameRate);
      const looped = sampleCompiledLayerVisualState(
        layer,
        baseFrame,
        this.#loopPlayback.sample(
          layer,
          elapsed,
          data,
          (clockMs * this.descriptor.frameRate) / 1000,
        ),
        data,
      );
      const base = sampleCompiledLayerVisualState(layer, baseFrame, undefined, data);
      const transform: Partial<LayerTransform> = {};
      const effects: Partial<Record<(typeof EFFECT_ANIMATION_PROPERTIES)[number], number>> = {};
      const paint: Partial<Record<AnimatableLayerProperty, number>> = {};
      const discreteShader: Partial<Record<AnimatableLayerProperty, number>> = {};
      const boundElement = this.#resolveLayerElement(layer, data);
      for (const property of Object.keys(layer.loop.tracks) as AnimatableLayerProperty[]) {
        if (!layer.loop.tracks[property]?.length) continue;
        if (TRANSFORM_ANIMATION_PROPERTIES.includes(property as keyof LayerTransform)) {
          const key = property as keyof LayerTransform;
          transform[key] = looped.transform[key] - base.transform[key];
        } else if (EFFECT_ANIMATION_PROPERTIES.some((candidate) => candidate === property)) {
          const key = property as (typeof EFFECT_ANIMATION_PROPERTIES)[number];
          effects[key] = looped.effects[key] - base.effects[key];
        } else if (
          isGradientStopOffsetProperty(property) ||
          property === 'strokeWidth' ||
          isRevealAnimationProperty(property)
        ) {
          paint[property] =
            (looped.paintTracks[property]?.[0]?.value ?? 0) -
            (base.paintTracks[property]?.[0]?.value ?? 0);
        } else if (shaderAnimationPropertySpec(boundElement, property)) {
          const fallback = getShaderAnimationValue(boundElement, property);
          const value = looped.paintTracks[property]?.[0]?.value ?? fallback;
          if (shaderAnimationPropertySpec(boundElement, property)!.discrete)
            discreteShader[property] = value;
          else paint[property] = value - (base.paintTracks[property]?.[0]?.value ?? fallback);
        }
      }
      const stack: Record<string, number> = {};
      for (const property of numericEffectProperties(layer.effects))
        if (layer.loop.tracks[property]?.length)
          stack[property] =
            Number(effectParameterValue(looped.effects, property)) -
            Number(effectParameterValue(base.effects, property));
      const modifiers: Record<string, number> = {};
      for (const property of numericModifierProperties(layer))
        if (layer.loop.tracks[property]?.length)
          modifiers[property] =
            (modifierParameterValue(looped.modifiers ?? [], property) ?? 0) -
            (modifierParameterValue(base.modifiers ?? [], property) ?? 0);
      layers.set(layer.id, { transform, effects, paint, stack, discreteShader, modifiers });
    }
    this.#loopExitCorrection =
      layers.size > 0 ? { startFrame: baseFrame, targetFrame, layers } : null;
  }

  #ensureLoopRendering(): void {
    if (
      this.#renderType !== 'realtime' ||
      this.#activeLoopEpochs.size === 0 ||
      this.#loopAnimationFrame !== null ||
      typeof requestAnimationFrame === 'undefined'
    ) {
      return;
    }
    const render = (now: number) => {
      this.#loopAnimationFrame = null;
      if (this.#activeLoopEpochs.size === 0 || this.#renderType !== 'realtime') return;
      this.#renderLoopSnapshot(now);
      this.#loopAnimationFrame = this.#requestFrame(render);
    };
    this.#loopAnimationFrame = this.#requestFrame(render);
  }

  #activateLoopsAtStep(step: number | undefined, epochMs: number, firstStep: boolean): void {
    const stepKeyframeId = step === undefined ? undefined : this.descriptor.stepKeyframeIds[step];
    for (const layer of this.activeDescriptor.layers) {
      const activation =
        layer.element.type === 'pattern' || layer.lighting
          ? { type: 'lifecycle' as const }
          : layer.loop?.activation;
      if (!activation) continue;
      if (activation.type === 'lifecycle') {
        if (firstStep || !this.#activeLoopEpochs.has(layer.id)) {
          this.#activeLoopEpochs.set(layer.id, epochMs);
        }
      } else if (activation.type === 'step' && activation.stepKeyframeId === stepKeyframeId) {
        this.#activeLoopEpochs.set(layer.id, epochMs);
      }
    }
    this.#ensureLoopRendering();
  }

  #deactivateStepLoops(): void {
    for (const layer of this.activeDescriptor.layers) {
      if (layer.loop?.activation.type === 'step') this.#activeLoopEpochs.delete(layer.id);
    }
  }

  #deactivateAllLoops(): void {
    this.#stopLoopRendering();
  }

  #documentFontsReady: Promise<void> = Promise.resolve();

  #buildDom(): void {
    this.#disposeClocks();
    const shadow = this.shadowRoot;
    if (!shadow) return;
    const descriptor = this.descriptor;
    this.#documentFontsReady = registerDocumentFonts(this.ownerDocument, descriptor.fonts ?? []);
    const expanded = expandRuntimeCollections(descriptor);
    // This instance's own layer copies: rule output is published per layer object, and several
    // instances of one graphic may share the static descriptor.
    this.#renderDescriptor = {
      ...expanded,
      layers: expanded.layers.map((layer) => ({ ...layer })),
    };
    const renderDescriptor = this.activeDescriptor;
    this.#disposeRulePointer?.();
    this.#disposeRulePointer = null;
    this.#clearRuleTimers();
    this.#ruleFadingLayers.clear();
    this.#rules = new RuntimeVisualRules(
      renderDescriptor.layers,
      descriptor.frameRate,
      (layer, at) => {
        const epoch = this.#activeLoopEpochs.get(layer.id);
        const elapsed =
          epoch === undefined || !Number.isFinite(at)
            ? undefined
            : Math.max(0, ((at - epoch) / 1000) * descriptor.frameRate);
        return sampleCompiledLayerVisualState(
          layer,
          this.#timeline?.frame() ?? 0,
          elapsed,
          this.#lastData,
          { skipRulePose: true },
        ).transform;
      },
    );
    this.#rules.update(this.#lastData, Number.NEGATIVE_INFINITY);
    this.#rules.publish(Number.POSITIVE_INFINITY);
    for (const timer of this.#clickTimers.values()) clearTimeout(timer);
    this.#clickTimers.clear();
    for (const element of this.#layerEls.values()) disposeElementContent(element);
    this.#mediaCueRuntime?.dispose();
    this.#mediaCueRuntime = null;
    shadow.replaceChildren();
    this.#clearContentAnimationFrames();

    const style = document.createElement('style');
    const fontFaces = (descriptor.fonts ?? [])
      .map((font) => {
        const family = font.family.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
        const source = font.source.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
        const format =
          font.mimeType === 'font/woff2'
            ? 'woff2'
            : font.mimeType === 'font/woff'
              ? 'woff'
              : font.mimeType === 'font/otf'
                ? 'opentype'
                : 'truetype';
        return `@font-face { font-family: "${family}"; src: url("${source}") format("${format}"); font-style: ${font.style || 'normal'}; font-weight: ${font.weight || '100 900'}; font-display: block; }`;
      })
      .join('\n');
    style.textContent = `${fontFaces}\n:host { display: block; position: relative; overflow: hidden; isolation: isolate; }\n:host([${PRESENTATION_SUSPENDED_ATTRIBUTE}]) { opacity: 0; }`;
    shadow.appendChild(style);

    const mediaCueHost = document.createElement('div');
    mediaCueHost.dataset.ografMediaCues = 'true';
    mediaCueHost.style.display = 'none';
    shadow.appendChild(mediaCueHost);
    this.#mediaCueRuntime = new MediaCueRuntime(
      mediaCueHost,
      descriptor,
      (cue, source, timestampMs) => this.#switchMediaCueVisual(cue, source, timestampMs),
    );

    this.style.width = `${descriptor.crop?.width ?? descriptor.width}px`;
    this.style.height = `${descriptor.crop?.height ?? descriptor.height}px`;
    this.#disposeRulePointer = bindRuntimePointerPosition({
      target: this,
      viewport: this,
      descriptor,
      enabled: () => this.#renderType === 'realtime',
      changed: (pointer) => {
        this.#logicFunctions?.pointerChanged(this.#renderType === 'realtime' ? pointer : null);
        if (this.#renderType !== 'realtime' || !this.#rules) return;
        const fired = this.#rules.pointerChanged(pointer, this.#lastData);
        if (!pointer || this.#rules.hasMouseConditions) this.#runRules(fired);
      },
    });
    const backdropRootRequired = compositionHasBackdropBlur(renderDescriptor.layers);
    this.style.backgroundColor = backdropRootRequired ? 'transparent' : descriptor.backgroundColor;

    let sceneRoot: ShadowRoot | HTMLDivElement = shadow;
    if (descriptor.crop || backdropRootRequired) {
      const surface = document.createElement('div');
      if (descriptor.crop) surface.dataset.ografCanvasCrop = 'true';
      surface.dataset.ografCompositionLayers = 'true';
      Object.assign(surface.style, {
        position: 'absolute',
        left: `${-(descriptor.crop?.x ?? 0)}px`,
        top: `${-(descriptor.crop?.y ?? 0)}px`,
        width: `${descriptor.width}px`,
        height: `${descriptor.height}px`,
        overflow: 'hidden',
        isolation: 'isolate',
        backgroundColor: backdropRootRequired ? descriptor.backgroundColor : 'transparent',
      });
      setCompositionBackdropRoot(surface, backdropRootRequired);
      shadow.appendChild(surface);
      sceneRoot = surface;
    }

    this.#layerEls.clear();
    for (const layer of renderDescriptor.layers) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      el.style.boxSizing = 'border-box';
      el.style.display = this.#visualRuleVisible(layer) ? '' : 'none';
      const pointerTriggers = pointerVisualRuleTriggers(layer, this.#rules.engine);
      el.style.pointerEvents = pointerTriggers.size > 0 ? 'auto' : 'none';
      if (
        pointerTriggers.has('click') ||
        pointerTriggers.has('double-click') ||
        pointerTriggers.has('pointer-down') ||
        pointerTriggers.has('pointer-up')
      )
        el.style.cursor = 'pointer';
      if (pointerTriggers.size > 0) {
        el.addEventListener('pointerenter', (event) => {
          if (event.pointerType !== 'touch')
            this.#pointerHover(layer, true, runtimeRelatedLayerId(event, this.#layerEls));
        });
        el.addEventListener('pointerleave', (event) => {
          if (event.pointerType !== 'touch')
            this.#pointerHover(layer, false, runtimeRelatedLayerId(event, this.#layerEls));
        });
        el.addEventListener('click', (event) => {
          if (event.detail > 1) return;
          if (pointerTriggers.has('double-click')) {
            const pending = this.#clickTimers.get(layer.id);
            if (pending) clearTimeout(pending);
            this.#clickTimers.set(
              layer.id,
              setTimeout(() => {
                this.#clickTimers.delete(layer.id);
                this.#triggerPointerRule(layer, 'click');
              }, 500),
            );
          } else {
            this.#triggerPointerRule(layer, 'click');
          }
        });
        el.addEventListener('dblclick', () => {
          const pending = this.#clickTimers.get(layer.id);
          if (pending) clearTimeout(pending);
          this.#clickTimers.delete(layer.id);
          this.#triggerPointerRule(layer, 'double-click');
        });
        el.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          this.#pressedLayers.add(layer.id);
          // A release off the layer still belongs to the press that started on it.
          if (pointerTriggers.has('pointer-up')) el.setPointerCapture?.(event.pointerId);
          this.#triggerPointerRule(layer, 'pointer-down');
        });
        el.addEventListener('pointerup', (event) => {
          if (event.button !== 0 || !this.#pressedLayers.delete(layer.id)) return;
          this.#triggerPointerRule(layer, 'pointer-up');
        });
        el.addEventListener('pointercancel', () => this.#pressedLayers.delete(layer.id));
      }
      if (layer.collectionItem) {
        el.dataset.ografCollectionId = layer.collectionItem.collectionId;
        el.dataset.ografCollectionIndex = String(layer.collectionItem.slot);
        el.dataset.ografCollectionDataKey = layer.collectionItem.dataKey;
      }
      el.dataset.ografLayerId = layer.id;
      if (typeof layer.exportKey === 'string' && layer.exportKey && !layer.collectionItem)
        el.dataset.ografLayerKey = layer.exportKey;
      el.dataset.ografLayerName = layer.name ?? 'Ticker';
      el.style.mixBlendMode =
        !layer.blendMode || layer.blendMode === 'normal' ? '' : layer.blendMode;
      const firstTransform = [...layer.keyframes].sort((a, b) => a.frame - b.frame)[0]?.transform;
      if (firstTransform) {
        el.style.width = `${firstTransform.width}px`;
        el.style.height = `${firstTransform.height}px`;
      }
      sceneRoot.appendChild(el);
      renderElementContent(
        el,
        this.#resolveLayerElement(layer),
        0,
        contentOptions(layer, descriptor.frameRate, descriptor.rendererPlugins),
      );
      applyLayerEffectsFilter(el, layer.effects, 0);
      this.#layerEls.set(layer.id, el);
    }

    this.#syncCollectionVisibility();

    this.#timeline?.dispose();
    this.#timeline = buildRuntimeTimeline(
      renderDescriptor,
      this.#layerEls,
      () => this.#lastData,
      () => ({ timestampMs: this.#contentElapsedMs, clockText: this.#clockText }),
    );
    this.#timeline.setClockOwner(this.ownerDocument.defaultView);
    this.#initializeClocks();
  }

  #setContentRenderingMode(): void {
    const root = this.shadowRoot;
    if (root) setLottieDeterministicRendering(root, this.#renderType === 'non-realtime');
  }

  async #switchMediaCueVisual(
    cue: NonNullable<CompiledGraphicDescriptor['mediaCues']>[number],
    source: NonNullable<CompiledGraphicDescriptor['mediaCues']>[number]['sources'][number],
    timestampMs: number,
  ): Promise<void> {
    const targetLayerId = cue.visual.targetLayerId;
    if (!targetLayerId || (source.kind === 'clip' && source.mediaType === 'audio')) return;
    const layer = this.activeDescriptor.layers.find((candidate) => candidate.id === targetLayerId);
    const element = this.#layerEls.get(targetLayerId);
    if (!layer || !element || !('fill' in layer.element)) return;

    let outgoing: HTMLCanvasElement | null = null;
    const currentCanvas = element.querySelector<HTMLCanvasElement>(
      'canvas[data-ograf-media-canvas="true"]',
    );
    if (cue.transition.type === 'crossfade' && currentCanvas) {
      outgoing = element.ownerDocument.createElement('canvas');
      outgoing.width = currentCanvas.width;
      outgoing.height = currentCanvas.height;
      outgoing.getContext('2d')?.drawImage(currentCanvas, 0, 0);
      Object.assign(outgoing.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '20',
      });
    }

    const nextElement = {
      ...layer.element,
      fill: {
        type: 'media' as const,
        source:
          source.kind === 'clip'
            ? { kind: 'clip' as const, src: source.src }
            : {
                kind: 'live' as const,
                tag: source.tag,
                ...(source.fallback ? { fallback: source.fallback } : {}),
              },
        fit: cue.visual.fit,
        ...(cue.visual.crop ? { crop: cue.visual.crop } : {}),
        positionX: cue.visual.positionX,
        positionY: cue.visual.positionY,
        loop: cue.loop,
        speed: cue.speed,
        offsetMs: cue.trimStartMs,
        trimEndMs: cue.trimEndMs,
        timelineStartMs: timestampMs,
        muted: true as const,
      },
    };
    renderElementContent(
      element,
      nextElement,
      0,
      contentOptions(layer, this.activeDescriptor.frameRate, this.activeDescriptor.rendererPlugins),
    );
    await waitForElementContentReady(element);
    if (!outgoing) return;
    element.appendChild(outgoing);
    const durationMs =
      (Math.max(1, cue.transition.durationFrames) / this.descriptor.frameRate) * 1000;
    if (typeof outgoing.animate !== 'function') {
      outgoing.remove();
      return;
    }
    const animation = outgoing.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: durationMs,
      easing: 'linear',
      fill: 'forwards',
    });
    await animation.finished.catch(() => undefined);
    outgoing.remove();
  }

  async #awaitContentReady(): Promise<void> {
    const root = this.shadowRoot;
    await this.#documentFontsReady;
    if (root) await waitForElementContentReady(root);
    if (this.#contentPlaybackError) throw this.#contentPlaybackError;
  }

  #remountAnimatedCanvasContent(): void {
    for (const layer of this.activeDescriptor.layers) {
      if (
        layer.element.type !== 'ticker' &&
        !hasElementShaderPaint(layer.element) &&
        !hasElementMediaPaint(layer.element) &&
        (layer.element.type !== 'lottie' || !layer.element.animationData)
      )
        continue;
      const element = this.#layerEls.get(layer.id);
      if (!element) continue;
      renderElementContent(
        element,
        this.#clockText.get(layer.id) ?? this.#resolveLayerElement(layer),
        0,
        contentOptions(
          layer,
          this.activeDescriptor.frameRate,
          this.activeDescriptor.rendererPlugins,
        ),
      );
    }
  }

  #startRealtimeContentAnimations(): void {
    this.#clearContentAnimationFrames();
    const layers = this.activeDescriptor.layers.filter(
      (layer) =>
        layer.element.type === 'ticker' ||
        (layer.element.type === 'image-sequence' && layer.element.frames.length > 0) ||
        (layer.element.type === 'lottie' && !!layer.element.animationData) ||
        (layer.element.type === 'text' && !!layer.element.crawl) ||
        hasElementShaderPaint(layer.element) ||
        hasElementMediaPaint(layer.element) ||
        getEffectStack(layer.effects).some(
          (effect) => effect.type === 'shader' && effectEnabled(effect, layer.effects),
        ),
    );
    if (
      (layers.length === 0 && (this.activeDescriptor.mediaCues?.length ?? 0) === 0) ||
      typeof requestAnimationFrame === 'undefined'
    )
      return;
    const epoch = performance.now();
    const render = (now: number) => {
      this.#contentAnimationFrame = null;
      const elapsedMs = Math.max(0, now - epoch);
      try {
        this.#renderAnimatedContentAt(elapsedMs, true);
      } catch (error) {
        if (error instanceof ShaderContextLostError) {
          this.#contentAnimationFrame = this.#requestFrame(render);
          return;
        }
        this.#contentPlaybackError = error instanceof Error ? error : new Error(String(error));
        return;
      }
      const shouldContinue =
        (this.activeDescriptor.mediaCues?.length ?? 0) > 0 ||
        layers.some((layer) => {
          const element = layer.element;
          if (
            element.type === 'ticker' ||
            element.type === 'lottie' ||
            (element.type === 'text' && !!element.crawl) ||
            hasElementShaderPaint(element) ||
            hasElementMediaPaint(element) ||
            getEffectStack(layer.effects).some(
              (effect) => effect.type === 'shader' && effectEnabled(effect, layer.effects),
            )
          )
            return true;
          if (element.type !== 'image-sequence') return false;
          return (
            element.loop || elapsedMs / 1000 < element.frames.length / Math.max(1, element.fps)
          );
        });
      if (shouldContinue) this.#contentAnimationFrame = this.#requestFrame(render);
    };
    this.#contentAnimationFrame = this.#requestFrame(render);
  }

  #renderAnimatedContentAt(
    timestampMs: number,
    playing = false,
    chartMarkFrame = this.#chartMarkFrame(),
  ): void {
    this.#contentElapsedMs = timestampMs;
    this.#mediaCueRuntime?.renderAtTime(timestampMs, { includeAudio: false });
    for (const layer of this.activeDescriptor.layers) {
      const shaderEffect = getEffectStack(layer.effects).some(
        (effect) => effect.type === 'shader' && effectEnabled(effect, layer.effects),
      );
      if (
        layer.element.type !== 'ticker' &&
        layer.element.type !== 'image-sequence' &&
        layer.element.type !== 'lottie' &&
        !(layer.element.type === 'text' && layer.element.crawl) &&
        !hasElementShaderPaint(layer.element) &&
        !hasElementMediaPaint(layer.element) &&
        !shaderEffect
      )
        continue;
      const el = this.#layerEls.get(layer.id);
      if (!el) continue;
      // A lost shader will redraw on webglcontextrestored. Skip its realtime work
      // while allowing the other layers to continue; exact seeks still fail honestly.
      if (
        playing &&
        shaderContextCounts().lost &&
        (el.dataset.ografShaderPaused === 'true' ||
          el.querySelectorAll('[data-ograf-shader-paused]').length)
      )
        continue;
      // Shader uniforms belong to the mounted, data-resolved element. Frame ticks only advance
      // time; passing the authored descriptor here must never reset a live parameter binding.
      if (
        layer.element.type === 'ticker' ||
        layer.element.type === 'image-sequence' ||
        layer.element.type === 'lottie' ||
        (layer.element.type === 'text' && !!layer.element.crawl) ||
        hasElementShaderPaint(layer.element) ||
        hasElementMediaPaint(layer.element)
      )
        renderAnimatedElementAtTime(
          el,
          this.#clockText.get(layer.id) ?? layer.element,
          timestampMs,
          { playing, chartMarkFrame },
        );
      if (shaderEffect) {
        const state = sampleCompiledLayerVisualState(
          layer,
          this.#timeline?.frame() ?? 0,
          undefined,
          this.#lastData,
        );
        applyLayerEffectsFilter(el, state.effects, timestampMs);
      }
    }
  }

  #refreshBoundLayers(): void {
    for (const layer of this.activeDescriptor.layers) {
      if (!layerHasRuntimeVisualInputs(layer) && !this.#rules?.targeted.has(layer.id)) continue;
      const el = this.#layerEls.get(layer.id);
      if (el) {
        const element = this.#resolveLayerElement(layer);
        if (element.type === 'text' && element.clock) {
          this.#clocks.get(layer.id)?.configure(element, this.activeDescriptor.frameRate);
        } else if (el.dataset.ografRenderedElement !== JSON.stringify(element)) {
          renderElementContent(el, element, 0, {
            ...contentOptions(
              layer,
              this.activeDescriptor.frameRate,
              this.activeDescriptor.rendererPlugins,
            ),
            timestampMs: this.#contentElapsedMs,
          });
          setLottieDeterministicRendering(el, this.#renderType === 'non-realtime');
        }
        const state = sampleCompiledLayerVisualState(
          layer,
          this.#timeline?.frame() ?? 0,
          undefined,
          this.#lastData,
        );
        applyLayerEffectsFilter(
          el,
          state.effects,
          ((this.#timeline?.frame() ?? 0) / this.activeDescriptor.frameRate) * 1000,
        );
        applyAnimatedPaint(el, layer.animationTracks, this.#timeline?.frame() ?? 0);
        if (element.type === 'text' && !element.clock) {
          if (this.#textAnimationEpochs.has(layer.id))
            setTextAnimationPrevious(el, this.#textAnimationPrevious.get(layer.id) ?? null);
          const replayFrame = Number(el.dataset.ografTextAnimationFrame);
          renderTextAnimationAtFrame(
            el,
            element,
            Number.isFinite(replayFrame) ? replayFrame : (this.#timeline?.frame() ?? 0),
          );
        }
        if (element.type === 'chart') {
          renderChartAnimationAtFrame(
            el,
            element,
            this.#timeline?.frame() ?? 0,
            this.#chartMarkFrame(),
          );
        }
      }
    }
    this.#syncCollectionVisibility();
  }

  #syncCollectionVisibility(): void {
    const previousSlots = new Map<string, number>();
    for (const layer of this.activeDescriptor.layers) {
      const el = this.#layerEls.get(layer.id);
      const key = el?.dataset.ografCollectionKey;
      if (key && layer.collectionItem)
        previousSlots.set(
          `${layer.collectionItem.collectionId}\u0000${key}`,
          layer.collectionItem.slot,
        );
    }
    for (const layer of this.activeDescriptor.layers) {
      const el = this.#layerEls.get(layer.id);
      if (!el) continue;
      const active = isRuntimeCollectionLayerActive(layer, this.#lastData);
      el.style.display = this.#visualRuleVisible(layer) && active ? '' : 'none';
      const fade = visualRuleEffectFor(layer, this.#lastData)?.contentOpacity;
      const fadeContent = el.firstElementChild as HTMLElement | null;
      if (fade !== undefined) {
        if (fadeContent) fadeContent.style.opacity = String(fade);
        this.#ruleFadingLayers.add(layer.id);
      } else if (this.#ruleFadingLayers.delete(layer.id) && fadeContent)
        fadeContent.style.opacity = '';
      if (!layer.collectionItem || !active) {
        delete el.dataset.ografCollectionKey;
        continue;
      }
      const selection = runtimeCollectionItemSelection(layer, this.#lastData);
      if (!selection) continue;
      const previousSlot = previousSlots.get(
        `${layer.collectionItem.collectionId}\u0000${selection.key}`,
      );
      const previousKey = el.dataset.ografCollectionKey;
      el.dataset.ografCollectionKey = selection.key;
      if (previousSlot === undefined || previousSlot === layer.collectionItem.slot || !previousKey)
        continue;
      const content = el.firstElementChild as HTMLElement | null;
      const dx = layer.collectionItem.offsetPerItem.x * (previousSlot - layer.collectionItem.slot);
      const dy = layer.collectionItem.offsetPerItem.y * (previousSlot - layer.collectionItem.slot);
      content?.animate(
        [
          { translate: `${dx}px ${dy}px`, opacity: 0.65 },
          { translate: '0px 0px', opacity: 1 },
        ],
        { duration: 240, easing: 'ease-out' },
      );
    }
  }

  /** Package subclasses enforce public data access; Studio keeps local fields editable. */
  protected resolveExternalData(data: unknown, _current: Record<string, unknown>): unknown {
    return data;
  }

  protected filterPublicData(data: unknown, current: Record<string, unknown>): unknown {
    return filterExposedData(data, this.descriptor.dataExposure, current);
  }

  #applyData(data: unknown, depth = 0): void {
    if (!data || typeof data !== 'object') return;
    const previousData = this.#lastData;
    const nextData = { ...this.#lastData, ...(data as Record<string, unknown>) };
    this.#validateShaderData(nextData);
    const fired = this.#rules?.dataChanged(previousData, nextData) ?? [];
    this.#lastData = nextData;
    this.#runRules(fired, depth);
    this.#logicFunctions?.dataChanged(previousData, this.#lastData);
  }

  #reportFunctionError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const EventClass = this.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
    this.dispatchEvent(
      new EventClass('ograf-function-error', {
        detail: { message },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #disposeLogicFunctions(): void {
    this.#functionGeneration++;
    this.#logicFunctions?.dispose();
    this.#logicFunctions = null;
  }

  async #initializeLogicFunctions(): Promise<void> {
    const definitions = this.activeDescriptor.functions?.filter((fn) => fn.enabled) ?? [];
    if (!definitions.length) return;
    const generation = this.#functionGeneration;
    this.#logicFunctions = createLogicFunctionRuntime({
      host: this,
      definitions,
      readData: () => this.#lastData,
      commitData: (patch, depth, context) => {
        if (this.#functionGeneration !== generation) return;
        const merged = { ...this.#lastData, ...patch };
        // Validate bound shader values before changing the committed data or firing Rules.
        this.#validateShaderData(merged);
        const previousText = this.#captureTextAnimationElements();
        if (context.event.type === 'load' || !context.onAir) {
          const previousData = this.#lastData;
          // Establish baseline visuals without executing data-triggered action/media effects.
          if (context.event.type === 'load') this.#replaceData(merged);
          else {
            // Out cleanup must not reset an authored Taken out rule or its delayed actions.
            this.#lastData = merged;
            this.#refreshRuleOutput();
          }
          this.#logicFunctions?.dataChanged(previousData, this.#lastData);
        } else this.#applyData(patch, depth);
        // A nested output object can change without every bound label changing. Replay only
        // changed glyphs, so the game clock never restarts the score's update animation.
        this.#triggerTextAnimationReplays(
          (layer) => {
            const before = previousText.get(layer.id);
            if (!before) return false;
            const after = this.#resolveLayerElement(layer);
            return (
              after.type === 'text' &&
              normalizeTextAnimation(after.textAnimation).replayOnUpdate &&
              (before.content !== after.content ||
                JSON.stringify(before.runs) !== JSON.stringify(after.runs))
            );
          },
          undefined,
          previousText,
        );
      },
      invokeAction: async (id, payload, depth = 0) => {
        if (this.#functionGeneration !== generation) return;
        const result = await this.#customActionUnlocked(
          { id, payload: payload ?? {}, skipAnimation: false },
          depth,
          false,
        );
        if (result && typeof result.statusCode === 'number' && result.statusCode >= 400)
          throw new Error(result.statusMessage ?? `Function action ${id} failed.`);
      },
      media: () => this.#mediaCueRuntime,
      onError: (error) => {
        if (this.#functionGeneration === generation) this.#reportFunctionError(error);
      },
    });
    await this.#logicFunctions.ready;
  }

  #pointerHover(
    layer: CompiledGraphicDescriptor['layers'][number],
    hovered: boolean,
    relatedHostLayerId?: string,
  ): void {
    if (this.#renderType !== 'realtime' || !this.#rules) return;
    this.#rules.hoverChanged(layer.id, hovered, this.#lastData, relatedHostLayerId);
    if (hovered) this.#runRules(this.#rules.hoverEntered(layer.id, this.#lastData));
    this.#triggerPointerRule(
      layer,
      hovered ? 'pointer-enter' : 'pointer-leave',
      relatedHostLayerId,
    );
  }

  #triggerPointerRule(
    layer: CompiledGraphicDescriptor['layers'][number],
    trigger:
      'click' | 'double-click' | 'pointer-enter' | 'pointer-leave' | 'pointer-down' | 'pointer-up',
    relatedHostLayerId?: string,
  ): void {
    if (this.#renderType !== 'realtime' || !this.#rules) return;
    this.#runRules(
      this.#rules.eventFired(trigger, this.#lastData, {
        hostLayerId: layer.id,
        ...(relatedHostLayerId ? { relatedHostLayerId } : {}),
      }),
    );
  }

  /** The data change requested by fired `set-data` actions; `null` when there is none. */
  #setDataPatch(
    actions: readonly VisualRuleAction[],
    current: Record<string, unknown>,
  ): Record<string, unknown> | null {
    let patch: Record<string, unknown> | null = null;
    for (const action of actions) {
      if (action.type !== 'set-data' || !action.dataKey) continue;
      patch ??= {};
      const key = action.dataKey;
      patch[key] = visualRuleSetDataValue(
        action,
        Object.hasOwn(patch, key) ? patch[key] : current[key],
      );
    }
    return patch;
  }

  #runVisualRuleEventActions(triggered: VisualRuleAction[], depth = 0): void {
    // Rules may answer the data they change, but not endlessly.
    const patch = this.#setDataPatch(triggered, this.#lastData);
    if (patch && depth < MAX_RULE_CUSTOM_ACTION_DEPTH) this.#applyData(patch, depth + 1);
    const eventKeys = new Set<string>();
    for (const action of triggered) {
      const eventKey = JSON.stringify(action);
      if (eventKeys.has(eventKey)) continue;
      eventKeys.add(eventKey);
      if (action.type === 'custom-action' || action.type === 'shader-animation') {
        void this.#customActionUnlocked(
          { id: action.actionId, payload: {}, skipAnimation: false },
          depth + 1,
        );
        continue;
      }
      if (action.type !== 'play-sound' && action.type !== 'take-media') continue;
      const cue = this.activeDescriptor.mediaCues?.find(
        (candidate) => candidate.id === action.cueId,
      );
      if (!cue) continue;
      const sourceId =
        action.type === 'take-media' && action.sourceId ? action.sourceId : cue.activeSourceId;
      void this.#mediaCueRuntime?.take(
        cue.id,
        sourceId,
        ((this.#timeline?.frame() ?? 0) / this.activeDescriptor.frameRate) * 1000,
      );
    }
  }

  #replaceData(data: unknown): void {
    const nextData =
      data && typeof data === 'object' ? { ...(data as Record<string, unknown>) } : {};
    this.#validateShaderData(nextData);
    this.#clearRuleTimers();
    this.#rules?.reset();
    this.#lastData = nextData;
    this.#rules?.update(nextData, Number.NEGATIVE_INFINITY);
    this.#rules?.publish(Number.POSITIVE_INFINITY);
    this.#refreshBoundLayers();
  }

  #validateShaderData(data: Record<string, unknown>): void {
    for (const layer of this.activeDescriptor.layers) {
      const element = resolveBoundElement(layer, data);
      for (const { paint } of getElementShaderPaints(element)) resolveShaderParameters(paint);
    }
  }

  async #seekToKeyframeId(
    keyframeId: string | null,
    skipAnimation?: boolean,
    durationSeconds?: number,
    includeAudio = true,
  ): Promise<void> {
    const keyframe = this.descriptor.keyframes.find((k) => k.id === keyframeId);
    const tl = this.#timeline;
    if (!keyframe || !tl) return;
    const targetSeconds = keyframe.frame / this.descriptor.frameRate;
    this.#activeTransition?.cancel();
    this.#activeTransition = null;
    if (skipAnimation) {
      this.#loopExitCorrection = null;
      this.#directLifecycleTransition = null;
      tl.seek(keyframe.frame, true);
      if (includeAudio) this.#mediaCueRuntime?.renderAtTime(targetSeconds * 1000);
    } else {
      const fromFrame = tl.frame();
      const directOut =
        this.#directLifecycleTransition !== null && keyframe.id === this.descriptor.endKeyframeId;
      // A direct Out interpolates from the current pose and skips the intervening Steps.
      const cueStart = directOut ? keyframe.frame - exitDurationFrames(this.descriptor) : fromFrame;
      const includeStart =
        !directOut &&
        this.descriptor.keyframes.some(
          (key) => key.id === this.descriptor.startKeyframeId && key.frame === fromFrame,
        );
      const cues =
        this.#renderType === 'realtime' && keyframe.frame > fromFrame && durationSeconds !== 0
          ? (this.activeDescriptor.frameCues ?? [])
              .filter(
                (cue) =>
                  (cue.frame > cueStart || (includeStart && cue.frame === cueStart)) &&
                  cue.frame <= keyframe.frame,
              )
              .sort((a, b) => a.frame - b.frame)
          : [];
      let nextCue = 0;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          this.#activeTransition = null;
          this.#loopExitCorrection = null;
          this.#directLifecycleTransition = null;
          try {
            this.#renderLoopSnapshot(
              typeof performance !== 'undefined' ? performance.now() : Date.now(),
            );
            if (includeAudio)
              this.#mediaCueRuntime?.renderAtTime(
                (tl.frame() / this.activeDescriptor.frameRate) * 1000,
              );
            resolve();
          } catch (cause) {
            reject(cause);
          }
        };
        const transition = tl.animateTo(keyframe.frame, {
          ...(durationSeconds !== undefined ? { durationMs: durationSeconds * 1000 } : {}),
          onUpdate: () => {
            this.#renderLoopSnapshot(
              typeof performance !== 'undefined' ? performance.now() : Date.now(),
            );
            if (includeAudio)
              this.#mediaCueRuntime?.renderAtTime(
                (tl.frame() / this.activeDescriptor.frameRate) * 1000,
              );
            if (nextCue < cues.length) {
              const frame = tl.frame();
              const cueFrame = directOut
                ? cueStart +
                  ((frame - fromFrame) / (keyframe.frame - fromFrame)) * (keyframe.frame - cueStart)
                : frame;
              while (nextCue < cues.length && cues[nextCue]!.frame <= cueFrame) {
                const cue = cues[nextCue++]!;
                dispatchStudioFrameCue(this, cue, { instanceId: SINGLE_INSTANCE_ID });
              }
            }
          },
          onComplete: finish,
          onInterrupt: finish,
        });
        if (!settled) this.#activeTransition = transition;
      });
    }
  }

  async load(params: LoadParams): Promise<ReturnPayload | undefined> {
    return this.#serializeOperation(() => this.#loadUnlocked(params));
  }

  async #loadUnlocked(params: LoadParams): Promise<ReturnPayload | undefined> {
    this.#disposeLogicFunctions();
    this.#keyboardOnAir = false;
    this.#loaded = false;
    this.#disposeKeyboard?.();
    this.#disposeKeyboard = null;
    try {
      if (params.renderType !== 'realtime' && this.descriptor.functions?.some((fn) => fn.enabled))
        throw new Error('Template Functions require real-time interactive playback.');
      if (
        [
          ...this.descriptor.layers,
          ...(this.descriptor.collections ?? []).flatMap(
            (collection) => collection.prototypeLayers,
          ),
        ].some((layer) =>
          layer.visualRules?.some(
            (rule) => rule.enabled && rule.actions.some((action) => action.type === 'playout'),
          ),
        )
      )
        throw new Error('Rules playout actions require a coordinated template-set graphic.');
      for (const timer of this.#clickTimers.values()) clearTimeout(timer);
      this.#clickTimers.clear();
      this.#clearRuleTimers();
      this.#abandonRunningUpdate();
      this.#stopLoopRendering();
      this.#clearContentAnimationFrames();
      this.#clearTextAnimationFrames();
      this.#clearChartAnimationFrames();
      this.#contentPlaybackError = null;
      this.#mediaCueRuntime?.reset();
      this.#renderType = params.renderType;
      this.#loopPlayback.clear();
      if (!this.#timeline) this.#buildDom();
      const defaults = this.descriptor.dataDefaults ?? {};
      const externalData = this.resolveExternalData(params.data, defaults);
      this.#replaceData({
        ...defaults,
        ...(externalData && typeof externalData === 'object' ? externalData : {}),
      });
      await this.#initializeLogicFunctions();
      this.#remountAnimatedCanvasContent();
      this.#setContentRenderingMode();
      this.#renderAnimatedContentAt(0);
      await this.#awaitContentReady();
      this.#renderAnimatedContentAt(0);
      this.#schedule = [];
      this.#scheduleBaseData = { ...this.#lastData };
      this.#currentStep = undefined;
      this.#directLifecycleTransition = null;
      await this.#seekToKeyframeId(this.descriptor.startKeyframeId, true, undefined, false);
      this.#renderLoopSnapshot(0, new Map());
      this.#initializeClocks();
      await this.#awaitContentReady();
      if (this.#renderType === 'realtime') {
        this.#startRealtimeContentAnimations();
        for (const clock of this.#clocks.values()) clock.startRealtime();
        this.#disposeKeyboard = bindRuntimeKeyboard(
          this,
          hasRuntimeKeyboardRules(this.activeDescriptor.layers),
          (trigger, input) => this.handleKeyboardInput(trigger, input),
        );
      }
      this.#loaded = true;
      return { statusCode: 200 };
    } catch (err) {
      this.#disposeLogicFunctions();
      return errorPayload(err);
    }
  }

  async dispose(): Promise<ReturnPayload | undefined> {
    return this.#serializeOperation(() => this.#disposeUnlocked());
  }

  async #disposeUnlocked(): Promise<ReturnPayload | undefined> {
    this.#disposeLogicFunctions();
    this.#keyboardOnAir = false;
    this.#loaded = false;
    this.#disposeKeyboard?.();
    this.#disposeKeyboard = null;
    try {
      this.#loopPlayback.clear();
      this.#timeline?.dispose();
      this.#timeline = null;
      this.#activeTransition?.cancel();
      this.#activeTransition = null;
      this.#clearContentAnimationFrames();
      this.#clearTextAnimationFrames();
      this.#clearChartAnimationFrames();
      this.#stopLoopRendering();
      this.#abandonRunningUpdate();
      this.#schedule = [];
      this.#directLifecycleTransition = null;
      for (const timer of this.#clickTimers.values()) clearTimeout(timer);
      this.#clickTimers.clear();
      this.#clearRuleTimers();
      for (const element of this.#layerEls.values()) disposeElementContent(element);
      this.#layerEls.clear();
      this.#mediaCueRuntime?.dispose();
      this.#mediaCueRuntime = null;
      this.#renderDescriptor = null;
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  async updateAction(params: UpdateActionParams): Promise<ReturnPayload | undefined> {
    if ((this.descriptor.updateInterruption ?? 'queue') === 'replace') {
      return this.#replaceRunningUpdate(params);
    }
    return this.#serializeOperation(() =>
      this.#updateActionUnlocked(params, ++this.#updateGeneration),
    );
  }

  /**
   * Scheduled replay draws the same thing: a repeat of the data leaves the running fade alone, and
   * a real change ends that fade with its data on air before starting the next one. Discarding the
   * older data instead would hold every value back while updates arrive faster than the fade.
   */
  async #replaceRunningUpdate(params: UpdateActionParams): Promise<ReturnPayload | undefined> {
    try {
      const target = { ...this.#lastData, ...this.#unappliedUpdateData };
      const data = this.resolveExternalData(params.data, target);
      if (data && typeof data === 'object') {
        this.#validateShaderData({ ...target, ...(data as Record<string, unknown>) });
      }
      if (
        this.#runningUpdate &&
        !params.skipAnimation &&
        changedDataKeys(data, target).size === 0
      ) {
        return this.#runningUpdate;
      }
      const generation = ++this.#updateGeneration;
      this.#settleRunningUpdate();
      this.#unappliedUpdateData = data && typeof data === 'object' ? (data as typeof target) : null;
      const update = this.#updateActionUnlocked({ ...params, data }, generation).finally(() => {
        if (this.#runningUpdate === update) this.#runningUpdate = null;
      });
      this.#runningUpdate = update;
      return update;
    } catch (err) {
      return errorPayload(err);
    }
  }

  /** Ends the running fade at once, as `skipAnimation` would, with its data on air. */
  #settleRunningUpdate(): void {
    this.#cancelUpdateAnimations();
    const data = this.#unappliedUpdateData;
    this.#unappliedUpdateData = null;
    if (!data) return;
    const changedKeys = changedDataKeys(data, this.#lastData);
    this.#applyData(data);
    this.#settleUpdatedText(changedKeys);
    this.#startChartAnimations(true, changedKeys);
  }

  /** Stops an update whose graphic is going away, so that nothing of it lands afterwards. */
  #abandonRunningUpdate(): void {
    this.#updateGeneration++;
    this.#runningUpdate = null;
    this.#unappliedUpdateData = null;
    this.#cancelUpdateAnimations();
  }

  async #updateActionUnlocked(
    params: UpdateActionParams,
    generation = this.#updateGeneration,
  ): Promise<ReturnPayload | undefined> {
    try {
      await this.#awaitContentReady();
      if (generation !== this.#updateGeneration) return { statusCode: 200 };
      params = { ...params, data: this.resolveExternalData(params.data, this.#lastData) };
      if (params.data && typeof params.data === 'object') {
        this.#validateShaderData({
          ...this.#lastData,
          ...(params.data as Record<string, unknown>),
        });
      }
      this.#cancelUpdateAnimations();
      const changedKeys = changedDataKeys(params.data, this.#lastData);
      const keys = this.#changedBindingKeys(changedKeys);
      const hasTransition = this.activeDescriptor.layers.some((layer) => {
        const transition = layer.updateTransition;
        return (
          (transition?.style ?? 'inherit') !== 'none' &&
          ((transition?.durationFrames ?? 0) > 0 ||
            (this.descriptor.updateTransitionFrames ?? 0) > 0)
        );
      });
      if (params.skipAnimation || !hasTransition || keys.size === 0) {
        this.#unappliedUpdateData = null;
        const previousText = this.#captureTextAnimationElements();
        this.#applyData(params.data);
        if (!params.skipAnimation) this.#replayUpdatedText(changedKeys, previousText);
        else this.#settleUpdatedText(changedKeys);
        this.#startChartAnimations(Boolean(params.skipAnimation), changedKeys);
        await this.#awaitContentReady();
        return { statusCode: 200 };
      }
      await this.#animateBoundContent(keys, 'out');
      if (generation !== this.#updateGeneration) return { statusCode: 200 };
      this.#unappliedUpdateData = null;
      const previousText = this.#captureTextAnimationElements();
      this.#applyData(params.data);
      this.#replayUpdatedText(changedKeys, previousText);
      this.#startChartAnimations(false, changedKeys);
      // A re-render replaces the content node, so the fade-out's hold no longer hides the new value.
      await this.#animateBoundContent(keys, 'hold');
      await this.#awaitContentReady();
      if (generation !== this.#updateGeneration) return { statusCode: 200 };
      await this.#animateBoundContent(keys, 'in');
      if (generation !== this.#updateGeneration) return { statusCode: 200 };
      await this.#awaitContentReady();
      return { statusCode: 200 };
    } catch (err) {
      // Whoever replaced this update has already dealt with its data and its fades.
      if (generation === this.#updateGeneration) {
        this.#unappliedUpdateData = null;
        // A failure between the two phases must not leave its layers held invisible.
        if (this.#updateAnimations.length) this.#cancelUpdateAnimations();
      }
      return errorPayload(err);
    }
  }

  #resolvePlayTarget(currentStep: number | undefined, params: PlayActionParams) {
    return resolvePlayTarget(
      this.descriptor.stepKeyframeIds,
      this.descriptor.startKeyframeId,
      this.descriptor.endKeyframeId,
      currentStep,
      params,
    );
  }

  async playAction(params: PlayActionParams): Promise<PlayActionReturnPayload> {
    this.#mediaCueRuntime?.resumeBlocked();
    return this.#serializeOperation(() => this.#playActionUnlocked(params));
  }

  async #playActionUnlocked(params: PlayActionParams): Promise<PlayActionReturnPayload> {
    try {
      await this.#awaitContentReady();
      const previousStep = this.#currentStep;
      if (
        previousStep === undefined &&
        this.#timeline &&
        this.#timeline.frame() >= this.#timeline.durationFrames() - 0.000_001
      ) {
        // A new IN after completing OUT is a new playout cycle, so one-shot sounds may arm again.
        this.#mediaCueRuntime?.reset();
      }
      const target = this.#resolvePlayTarget(this.#currentStep, params);
      this.#keyboardOnAir = target.currentStep !== undefined;
      void this.#logicFunctions
        ?.setOnAir(target.currentStep !== undefined)
        .catch((error) => this.#reportFunctionError(error));
      for (const clock of this.#clocks.values()) clock.setOnAir(target.currentStep !== undefined);
      const targetFrame =
        this.descriptor.keyframes.find((keyframe) => keyframe.id === target.keyframeId)?.frame ?? 0;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const exitsToEnd =
        previousStep !== undefined && target.keyframeId === this.descriptor.endKeyframeId;
      if (previousStep === undefined && target.currentStep !== undefined)
        this.#startChartAnimations(Boolean(params.skipAnimation));
      if (exitsToEnd) this.#beginDirectLifecycleTransition(targetFrame, now);
      else {
        this.#beginLoopExit(
          targetFrame,
          now,
          (layer) => target.currentStep === undefined || layer.loop?.activation.type === 'step',
        );
      }
      this.#deactivateStepLoops();
      if (target.currentStep === undefined) {
        this.#deactivateAllLoops();
        this.#fireLifecycleRules('stop');
      }
      const exitDurationSeconds = exitsToEnd
        ? exitDurationFrames(this.descriptor) / this.descriptor.frameRate
        : undefined;
      await this.#seekToKeyframeId(target.keyframeId, params.skipAnimation, exitDurationSeconds);
      await this.#awaitContentReady();
      this.#currentStep = target.currentStep;
      if (this.#currentStep !== undefined) {
        this.#activateLoopsAtStep(
          this.#currentStep,
          typeof performance !== 'undefined' ? performance.now() : Date.now(),
          previousStep === undefined,
        );
        if (previousStep === undefined) this.#fireLifecycleRules('play');
        this.#fireLifecycleRules('step', this.descriptor.stepKeyframeIds[this.#currentStep]);
      }
      return {
        statusCode: 200,
        ...(this.#currentStep !== undefined ? { currentStep: this.#currentStep } : {}),
      };
    } catch (err) {
      return {
        ...errorPayload(err),
        ...(this.#currentStep !== undefined ? { currentStep: this.#currentStep } : {}),
      };
    }
  }

  async stopAction(params: StopActionParams): Promise<ReturnPayload | undefined> {
    return this.#serializeOperation(() => this.#stopActionUnlocked(params));
  }

  async #stopActionUnlocked(params: StopActionParams): Promise<ReturnPayload | undefined> {
    this.#keyboardOnAir = false;
    void this.#logicFunctions?.setOnAir(false).catch((error) => this.#reportFunctionError(error));
    try {
      await this.#awaitContentReady();
      for (const clock of this.#clocks.values()) clock.setOnAir(false);
      const targetFrame =
        this.descriptor.keyframes.find((keyframe) => keyframe.id === this.descriptor.endKeyframeId)
          ?.frame ?? 0;
      this.#beginDirectLifecycleTransition(
        targetFrame,
        typeof performance !== 'undefined' ? performance.now() : Date.now(),
      );
      this.#deactivateAllLoops();
      this.#fireLifecycleRules('stop');
      const durationSeconds = exitDurationFrames(this.descriptor) / this.descriptor.frameRate;
      await this.#seekToKeyframeId(
        this.descriptor.endKeyframeId,
        params.skipAnimation,
        durationSeconds,
      );
      await this.#awaitContentReady();
      this.#currentStep = undefined;
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  async customAction(params: CustomActionParams): Promise<ReturnPayload | undefined> {
    return this.#serializeOperation(() =>
      this.#customActionUnlocked({
        ...params,
        payload: params.id.startsWith('loop.')
          ? params.payload
          : this.resolveExternalData(params.payload, this.#lastData),
      }),
    );
  }

  async #customActionUnlocked(
    params: CustomActionParams,
    ruleDepth = 0,
    applyPayload = true,
  ): Promise<ReturnPayload | undefined> {
    try {
      if (
        ['loop.pause', 'loop.resume', 'loop.next'].includes(params.id) &&
        this.activeDescriptor.layers.some((layer) => layer.loop?.timing)
      ) {
        const payload = params.payload;
        if (
          !payload ||
          typeof payload !== 'object' ||
          Array.isArray(payload) ||
          Object.keys(payload).some((key) => key !== 'groupId') ||
          typeof (payload as Record<string, unknown>).groupId !== 'string'
        )
          throw new TypeError('Loop action requires a groupId.');
        const now = this.#ruleClock();
        this.#renderLoopSnapshot(now);
        if (
          !this.#loopPlayback.control(
            params.id.slice(5) as LoopPlaybackAction,
            (payload as { groupId: string }).groupId,
            (now * this.descriptor.frameRate) / 1000,
          )
        )
          return { statusCode: 404, statusMessage: 'No active loop group.' };
        this.#renderLoopSnapshot(now);
        return { statusCode: 200 };
      }
      const action = this.descriptor.customActions.find((candidate) => candidate.id === params.id);
      if (!action) {
        return { statusCode: 404, statusMessage: `Unknown customAction id: "${params.id}"` };
      }
      await this.#awaitContentReady();
      const previousAlarmDepth = this.#clockAlarmRuleDepth;
      this.#clockAlarmRuleDepth = ruleDepth;
      try {
        for (const [layerId, clock] of this.#clocks) {
          const command = this.#clockCommandFor(layerId, params.id);
          if (command) clock.command(command);
        }
      } finally {
        this.#clockAlarmRuleDepth = previousAlarmDepth;
      }
      const previousText =
        applyPayload && params.payload && typeof params.payload === 'object'
          ? this.#captureTextAnimationElements()
          : undefined;
      if (applyPayload && params.payload && typeof params.payload === 'object') {
        this.#validateShaderData({
          ...this.#lastData,
          ...(params.payload as Record<string, unknown>),
        });
        const chartKeys = changedDataKeys(params.payload, this.#lastData);
        this.#applyData(params.payload, ruleDepth);
        this.#startChartAnimations(Boolean(params.skipAnimation), chartKeys);
        await this.#awaitContentReady();
      }
      await this.#logicFunctions?.customAction(params.id, params.payload, ruleDepth);
      // A rule that runs this custom action may be answered by rules again, but not endlessly.
      if (ruleDepth < MAX_RULE_CUSTOM_ACTION_DEPTH)
        this.#fireLifecycleRules('custom-action', params.id, ruleDepth);

      const layers = this.activeDescriptor.layers.filter(
        (layer) =>
          layer.loop?.activation.type === 'customAction' &&
          layer.loop.activation.customActionId === params.id,
      );
      const textLayers = this.activeDescriptor.layers.filter(
        (layer) =>
          layer.element.type === 'text' &&
          hasTextAnimationSettings(layer.element.textAnimation) &&
          normalizeTextAnimation(layer.element.textAnimation).customActionId === params.id,
      );
      const epoch = typeof performance !== 'undefined' ? performance.now() : Date.now();
      await this.#mediaCueRuntime?.triggerCustomAction(params.id, params.payload);
      if (!params.skipAnimation && textLayers.length > 0) {
        const textLayerIds = new Set(textLayers.map((layer) => layer.id));
        this.#triggerTextAnimationReplays(
          (layer) => textLayerIds.has(layer.id),
          epoch,
          previousText,
        );
      }
      if (
        params.skipAnimation ||
        (layers.length === 0 && textLayers.length === 0) ||
        action.durationFrames <= 0
      ) {
        return { statusCode: 200 };
      }

      for (const layer of layers) this.#activeLoopEpochs.set(layer.id, epoch);
      this.#renderLoopSnapshot(epoch);
      this.#ensureLoopRendering();
      const durationMs = (action.durationFrames / this.descriptor.frameRate) * 1000;
      await new Promise<void>((resolve) => {
        const owner = this.ownerDocument?.defaultView;
        if (owner) owner.setTimeout(resolve, durationMs);
        else setTimeout(resolve, durationMs);
      });
      for (const layer of layers) {
        if (this.#activeLoopEpochs.get(layer.id) === epoch) {
          this.#activeLoopEpochs.delete(layer.id);
        }
      }
      this.#renderLoopSnapshot(typeof performance !== 'undefined' ? performance.now() : Date.now());
      await this.#awaitContentReady();
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  /**
   * Re-derives the full logical state (keyframe position + bound data) implied by every scheduled
   * action at or before `timestamp`, from the `#scheduleBaseData`/keyframe-0 baseline forward —
   * NOT an incremental cursor. Replaying the full prefix every call (rather than only newly-passed
   * entries) is what makes scrubbing backward correct: a key set by an action that's since fallen
   * out of the qualifying prefix reverts to the baseline instead of staying stuck at its old value.
   */
  #applySchedule(timestamp: number): number {
    const due = this.#schedule.filter((a) => a.timestamp <= timestamp);
    const clockEvents = new Map<string, ClockTimerEvent[]>(
      [...this.#clocks.keys()].map((layerId) => [layerId, []]),
    );
    const recordManualClockValues = (
      data: Record<string, unknown>,
      at: number,
    ): ClockTimerEvent[] => {
      const recorded: ClockTimerEvent[] = [];
      for (const layer of this.activeDescriptor.layers) {
        const events = clockEvents.get(layer.id);
        if (!events) continue;
        const element = this.#resolveLayerElement(layer, data);
        if (element.type === 'text' && element.clock?.source === 'manual') {
          const event: ClockTimerEvent = {
            timestamp: at,
            command: 'set-value',
            value: element.clock.manualValue,
          };
          events.push(event);
          recorded.push(event);
        }
      }
      return recorded;
    };
    recordManualClockValues(this.#scheduleBaseData, 0);
    this.#directLifecycleTransition = null;
    this.#loopExitCorrection = null;
    for (const host of this.#layerEls.values()) delete host.dataset.ografChartAnimationFrame;

    let step: number | undefined;
    let targetKeyframeId = this.descriptor.startKeyframeId;
    let data: Record<string, unknown> = { ...this.#scheduleBaseData };
    let displayData: Record<string, unknown> = { ...data };
    let updateSamples = new Map<string, UpdateMotionSample>();
    let dataAnimation:
      | {
          startTimestamp: number;
          /** When the data changes: the slowest layer has finished leaving. */
          switchTimestamp: number;
          /** When the slowest layer has arrived back. */
          endTimestamp: number;
          oldData: Record<string, unknown>;
          newData: Record<string, unknown>;
          motions: Map<string, UpdateMotion>;
          /** The data work and manual values still waiting for this update's swap. */
          commit: { ruleWork: PendingRuleWork; clocks: ClockTimerEvent[] };
          /** What the update replays once its data changes; null once that has started. */
          replays: { changedKeys: Set<string>; previousData: Record<string, unknown> } | null;
        }
      | undefined;
    const keyframeSeconds = (keyframeId: string) =>
      (this.descriptor.keyframes.find((keyframe) => keyframe.id === keyframeId)?.frame ?? 0) /
      this.descriptor.frameRate;
    let positionSeconds = keyframeSeconds(this.descriptor.startKeyframeId);
    let animation:
      | {
          startTimestamp: number;
          startSeconds: number;
          targetSeconds: number;
          durationMs: number;
          directTransition?: DirectLifecycleTransition;
        }
      | undefined;
    let directSample: { transition: DirectLifecycleTransition; progress: number } | undefined;
    let stepArrivalTimestamp: number | undefined;
    let lifecycleEpoch: number | undefined;
    const customActionEpochs = new Map<string, number>();
    this.#loopPlayback.clear();
    const textAnimationEpochs = new Map<string, number>();
    const textAnimationPrevious = new Map<string, TextElement>();
    const textAnimationSkipped = new Set<string>();
    const chartAnimationEpochs = new Map<string, { timestamp: number; skip: boolean }>();
    const chartAnimationHistory = new Map<string, ChartAnimationHistoryEntry[]>();
    const tickerInitial = new Map<string, TickerElement>();
    const tickerHistory = new Map<string, TickerPlaybackUpdate[]>();
    const recordChartHistory = (
      values: Record<string, unknown>,
      at: number,
      reset = false,
      skip = false,
    ) => {
      for (const layer of this.activeDescriptor.layers)
        if (layer.element.type === 'ticker') {
          const element = this.#resolveLayerElement(layer, values);
          if (element.type !== 'ticker') continue;
          if (!tickerInitial.has(layer.id)) tickerInitial.set(layer.id, element);
          const entries = tickerHistory.get(layer.id) ?? [];
          const previous = entries.at(-1)?.element ?? tickerInitial.get(layer.id);
          if (JSON.stringify(previous) !== JSON.stringify(element))
            entries.push({ timestamp: at, element });
          tickerHistory.set(layer.id, entries);
        }
      for (const layer of this.activeDescriptor.layers) {
        if (layer.element.type !== 'chart' || layer.element.animation?.updateMode !== 'morph')
          continue;
        const element = this.#resolveLayerElement(layer, values);
        if (element.type !== 'chart') continue;
        const entries = chartAnimationHistory.get(layer.id) ?? [];
        if (
          !reset &&
          entries.length &&
          JSON.stringify(entries.at(-1)!.element.data) === JSON.stringify(element.data)
        )
          continue;
        const epoch = chartAnimationEpochs.get(layer.id);
        entries.push({
          frame: (at * this.activeDescriptor.frameRate) / 1000,
          element,
          reset,
          skip: skip || Boolean(epoch?.timestamp === at && epoch.skip),
        });
        chartAnimationHistory.set(layer.id, entries);
      }
    };
    recordChartHistory(this.#scheduleBaseData, 0, true);

    // Rule state is rebuilt from the schedule on every seek, like data and loop epochs: data
    // changes, lifecycle events and delayed rules are queued at their OGraf time and replayed in
    // order, so delays and rule transitions land on the same frame however the playhead arrives.
    const rules = this.#rules;
    this.#clearRuleTimers();
    rules?.reset();
    let ruleData: Record<string, unknown> = { ...this.#scheduleBaseData };
    rules?.update(ruleData, Number.NEGATIVE_INFINITY);
    type PendingRuleWork =
      | {
          kind: 'data';
          previous: Record<string, unknown>;
          current: Record<string, unknown>;
          /** How many rule-driven data changes led here; bounds set-data chains. */
          depth?: number;
        }
      | {
          kind: 'event';
          trigger: 'play' | 'step' | 'stop' | 'custom-action' | 'timer-alarm';
          eventId?: string;
          hostLayerId?: string;
          timerAlarmOwnerLayerId?: string;
          alarmRun?: number;
          depth?: number;
        }
      | { kind: 'rule'; fired: FiredRuntimeVisualRule; depth?: number };
    const pendingRules: Array<{ at: number; order: number; work: PendingRuleWork }> = [];
    let pendingOrder = 0;
    const queueRuleWork = (at: number, work: PendingRuleWork) =>
      pendingRules.push({ at, order: pendingOrder++, work });
    const queuedAlarms = new Set<string>();
    const queueTimerAlarms = (until: number, depth = 0): void => {
      for (const layer of this.activeDescriptor.layers) {
        const events = clockEvents.get(layer.id);
        if (!events) continue;
        const base = this.#resolveLayerElement(layer, this.#scheduleBaseData);
        if (base.type !== 'text' || !base.clock) continue;
        for (const alarm of clockTimerAlarmEventsAtTime(
          normalizeClockTimerSettings(base.clock),
          compiledTimerAlarms(this.activeDescriptor.layers, layer.id),
          until,
          events,
          true,
        )) {
          const key = JSON.stringify([
            layer.id,
            alarm.ownerLayerId,
            alarm.id,
            alarm.run,
            alarm.timestamp,
          ]);
          if (queuedAlarms.has(key)) continue;
          queuedAlarms.add(key);
          queueRuleWork(alarm.timestamp, {
            kind: 'event',
            trigger: 'timer-alarm',
            hostLayerId: layer.id,
            eventId: alarm.id,
            ...(alarm.ownerLayerId === undefined
              ? {}
              : { timerAlarmOwnerLayerId: alarm.ownerLayerId }),
            alarmRun: alarm.run,
            depth,
          });
        }
      }
    };
    const flushRules = (until: number): void => {
      if (!rules) return;
      for (;;) {
        let next = -1;
        for (let index = 0; index < pendingRules.length; index++) {
          const entry = pendingRules[index]!;
          const best = pendingRules[next];
          if (
            entry.at <= until &&
            (!best || entry.at < best.at || (entry.at === best.at && entry.order < best.order))
          )
            next = index;
        }
        if (next < 0) return;
        const [{ at, work }] = pendingRules.splice(next, 1) as [(typeof pendingRules)[number]];
        if (work.kind === 'data') {
          recordChartHistory(work.current, at);
          recordManualClockValues(work.current, at);
          queueTimerAlarms(until);
          ruleData = work.current;
          for (const fired of rules.dataChanged(work.previous, work.current))
            queueRuleWork(at + rules.delayMs(fired), {
              kind: 'rule',
              fired,
              ...(work.depth ? { depth: work.depth } : {}),
            });
        } else if (work.kind === 'event') {
          if (work.trigger === 'timer-alarm') {
            const layer = this.activeDescriptor.layers.find(
              (layer) => layer.id === work.hostLayerId,
            );
            const base = layer && this.#resolveLayerElement(layer, this.#scheduleBaseData);
            const valid =
              base?.type === 'text' &&
              base.clock &&
              clockTimerAlarmEventsAtTime(
                normalizeClockTimerSettings(base.clock),
                compiledTimerAlarms(this.activeDescriptor.layers, layer!.id),
                at,
                clockEvents.get(layer!.id),
                true,
              ).some(
                (alarm) =>
                  alarm.id === work.eventId &&
                  alarm.ownerLayerId === work.timerAlarmOwnerLayerId &&
                  alarm.run === work.alarmRun &&
                  alarm.timestamp === at,
              );
            if (!valid) continue;
          }
          for (const fired of rules.eventFired(work.trigger, ruleData, {
            ...(work.eventId === undefined ? {} : { eventId: work.eventId }),
            ...(work.hostLayerId === undefined ? {} : { hostLayerId: work.hostLayerId }),
            ...(work.timerAlarmOwnerLayerId === undefined
              ? {}
              : { timerAlarmOwnerLayerId: work.timerAlarmOwnerLayerId }),
          }))
            queueRuleWork(at + rules.delayMs(fired), {
              kind: 'rule',
              fired,
              ...(work.depth === undefined ? {} : { depth: work.depth }),
            });
        } else {
          const depth = work.depth ?? 0;
          const actions = rules.run(work.fired);
          const patch = this.#setDataPatch(actions, ruleData);
          if (depth < MAX_RULE_CUSTOM_ACTION_DEPTH)
            for (const action of actions) {
              if (action.type !== 'custom-action' && action.type !== 'shader-animation') continue;
              for (const [layerId, events] of clockEvents) {
                const command = this.#clockCommandFor(layerId, action.actionId);
                if (command) events.push({ timestamp: at, command });
              }
              customActionEpochs.set(action.actionId, at);
              for (const layer of this.activeDescriptor.layers) {
                if (
                  layer.element.type !== 'text' ||
                  layer.element.clock ||
                  normalizeTextAnimation(layer.element.textAnimation).customActionId !==
                    action.actionId
                )
                  continue;
                textAnimationSkipped.delete(layer.id);
                textAnimationEpochs.set(layer.id, at);
                textAnimationPrevious.delete(layer.id);
              }
              queueRuleWork(at, {
                kind: 'event',
                trigger: 'custom-action',
                eventId: action.actionId,
                depth: depth + 1,
              });
              queueTimerAlarms(until, depth + 1);
            }
          if (patch && depth < MAX_RULE_CUSTOM_ACTION_DEPTH) {
            // A rule's data change shows at once and is what later controller updates build on.
            data = { ...data, ...patch };
            displayData = { ...displayData, ...patch };
            if (dataAnimation) dataAnimation.newData = { ...dataAnimation.newData, ...patch };
            queueRuleWork(at, {
              kind: 'data',
              previous: ruleData,
              current: { ...ruleData, ...patch },
              depth: depth + 1,
            });
          }
        }
        rules.update(ruleData, at, (layer) => {
          const progress = animation
            ? Math.max(0, Math.min(1, (at - animation.startTimestamp) / animation.durationMs))
            : 1;
          const position = animation
            ? animation.startSeconds + (animation.targetSeconds - animation.startSeconds) * progress
            : positionSeconds;
          const epoch = loopEpochsAt(at).get(layer.id);
          return sampleCompiledLayerVisualState(
            layer,
            position * this.descriptor.frameRate,
            epoch === undefined
              ? undefined
              : Math.max(0, ((at - epoch) / 1000) * this.descriptor.frameRate),
            ruleData,
            { skipRulePose: true },
          ).transform;
        });
      }
    };

    const loopEpochsAt = (atTimestamp: number): Map<string, number> => {
      const epochs = new Map<string, number>();
      const stepKeyframeId = step === undefined ? undefined : this.descriptor.stepKeyframeIds[step];
      for (const layer of this.activeDescriptor.layers) {
        const activation =
          layer.element.type === 'pattern' || layer.lighting
            ? { type: 'lifecycle' as const }
            : layer.loop?.activation;
        if (
          activation?.type === 'lifecycle' &&
          lifecycleEpoch !== undefined &&
          atTimestamp >= lifecycleEpoch
        )
          epochs.set(layer.id, lifecycleEpoch);
        else if (
          activation?.type === 'step' &&
          !animation &&
          stepArrivalTimestamp !== undefined &&
          atTimestamp >= stepArrivalTimestamp &&
          activation.stepKeyframeId === stepKeyframeId
        )
          epochs.set(layer.id, stepArrivalTimestamp);
        else if (activation?.type === 'customAction' && layer.loop) {
          const epoch = customActionEpochs.get(activation.customActionId);
          const durationMs =
            ((layer.loop.durationFrames * (layer.loop.repeatCount ?? 1)) /
              this.descriptor.frameRate) *
            1000;
          if (epoch !== undefined && atTimestamp >= epoch && atTimestamp - epoch < durationMs) {
            epochs.set(layer.id, epoch);
          }
        }
      }
      return epochs;
    };

    const advanceTo = (atTimestamp: number): number => {
      if (!animation) return positionSeconds;
      const progress = Math.min(
        1,
        Math.max(0, (atTimestamp - animation.startTimestamp) / animation.durationMs),
      );
      directSample = animation.directTransition
        ? { transition: animation.directTransition, progress }
        : undefined;
      positionSeconds =
        animation.startSeconds + (animation.targetSeconds - animation.startSeconds) * progress;
      if (progress >= 1) {
        animation = undefined;
        directSample = undefined;
      }
      return positionSeconds;
    };

    /** Starts the chart and text animations an update replays, on the frame its data changes. */
    const startUpdateReplays = (
      atTimestamp: number,
      changedKeys: Set<string>,
      previousData: Record<string, unknown>,
      skipAnimation: boolean,
    ): void => {
      for (const layer of this.activeDescriptor.layers) {
        if (layer.element.type !== 'chart') continue;
        const chartAnimation = normalizeChartAnimation(layer.element.animation);
        if (
          chartAnimation.type === 'none' ||
          !chartAnimation.replayOnUpdate ||
          !(layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
            (binding) => binding.targetProperty === 'data' && changedKeys.has(binding.dataKey),
          )
        )
          continue;
        chartAnimationEpochs.set(layer.id, { timestamp: atTimestamp, skip: skipAnimation });
      }
      for (const layer of this.activeDescriptor.layers) {
        if (layer.element.type !== 'text') continue;
        const textAnimation = normalizeTextAnimation(layer.element.textAnimation);
        if (
          hasTextAnimationSettings(textAnimation) &&
          textAnimation.replayOnUpdate &&
          (layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
            (binding) => binding.targetProperty === 'content' && changedKeys.has(binding.dataKey),
          )
        ) {
          if (skipAnimation) {
            textAnimationEpochs.delete(layer.id);
            textAnimationPrevious.delete(layer.id);
            textAnimationSkipped.add(layer.id);
            continue;
          }
          textAnimationSkipped.delete(layer.id);
          textAnimationEpochs.set(layer.id, atTimestamp);
          const previousText = this.#resolveLayerElement(layer, previousData);
          if (previousText.type === 'text') textAnimationPrevious.set(layer.id, previousText);
        }
      }
    };

    const startPendingUpdateReplays = (atTimestamp: number, skipAnimation = false): void => {
      if (!dataAnimation?.replays) return;
      const { changedKeys, previousData } = dataAnimation.replays;
      dataAnimation.replays = null;
      startUpdateReplays(atTimestamp, changedKeys, previousData, skipAnimation);
    };

    const advanceDataTo = (atTimestamp: number): void => {
      updateSamples = new Map();
      if (!dataAnimation) return;
      const { startTimestamp, switchTimestamp, endTimestamp, motions } = dataAnimation;
      if (atTimestamp < switchTimestamp) displayData = dataAnimation.oldData;
      else {
        displayData = dataAnimation.newData;
        startPendingUpdateReplays(switchTimestamp);
      }
      if (atTimestamp >= endTimestamp) {
        dataAnimation = undefined;
        return;
      }
      for (const [layerId, motion] of motions)
        updateSamples.set(
          layerId,
          sampleUpdateMotion(
            motion,
            atTimestamp - startTimestamp,
            switchTimestamp - startTimestamp,
          ),
        );
    };

    /** Newer data settles a running update, including FX which had not yet reached their swap. */
    const cutDataAnimation = (atTimestamp: number): void => {
      if (!dataAnimation) return;
      startPendingUpdateReplays(atTimestamp, true);
      if (atTimestamp < dataAnimation.switchTimestamp) {
        // The live replace path applies its pending data now, including its Rule side effects and
        // manual clock values. Move that same commit instead of leaving it at the abandoned swap.
        const pending = pendingRules.find((entry) => entry.work === dataAnimation?.commit.ruleWork);
        if (pending) pending.at = atTimestamp;
        for (const event of dataAnimation.commit.clocks) event.timestamp = atTimestamp;
        queueTimerAlarms(atTimestamp);
        flushRules(atTimestamp);
      }
      displayData = { ...data };
      updateSamples = new Map();
      dataAnimation = undefined;
    };

    const finishesFadeFirst = (this.descriptor.updateInterruption ?? 'queue') === 'queue';
    const deferredUpdates = new WeakSet<object>();
    /**
     * On air, a change waits for the fade in front of it. Replay moves it to when that fade ends, so
     * its rule work, replays and clock values move with it, and each seek works this out afresh. An
     * update still waiting at the time being drawn simply hasn't happened yet.
     */
    const deferUpdate = (scheduled: (typeof due)[number], until: number): void => {
      if (until > timestamp) return;
      const later = { ...scheduled, timestamp: until };
      deferredUpdates.add(later);
      if (this.#externalSchedule.has(scheduled)) this.#externalSchedule.add(later);
      const after = due.indexOf(scheduled);
      // Behind anything else already waiting for that moment, but ahead of what arrives only then.
      const next = due.findIndex(
        (entry, index) =>
          index > after &&
          (entry.timestamp > until || (entry.timestamp === until && !deferredUpdates.has(entry))),
      );
      due.splice(next < 0 ? due.length : next, 0, later);
    };

    // A deferred update joins this list while it is being walked.
    for (const scheduled of due) {
      queueTimerAlarms(scheduled.timestamp);
      flushRules(scheduled.timestamp);
      advanceTo(scheduled.timestamp);
      advanceDataTo(scheduled.timestamp);
      for (const layer of this.activeDescriptor.layers) {
        const epoch = loopEpochsAt(scheduled.timestamp).get(layer.id);
        this.#loopPlayback.sample(
          layer,
          epoch === undefined
            ? undefined
            : Math.max(0, ((scheduled.timestamp - epoch) * this.descriptor.frameRate) / 1000),
          data,
          (scheduled.timestamp * this.descriptor.frameRate) / 1000,
        );
      }
      const { type } = scheduled.action;
      const originalParams = scheduled.action.params;
      const params = this.#externalSchedule.has(scheduled)
        ? type === 'updateAction'
          ? {
              ...(originalParams as UpdateActionParams),
              data: this.resolveExternalData((originalParams as UpdateActionParams).data, data),
            }
          : type === 'customAction' &&
              !(originalParams as CustomActionParams).id.startsWith('loop.')
            ? {
                ...(originalParams as CustomActionParams),
                payload: this.resolveExternalData(
                  (originalParams as CustomActionParams).payload,
                  data,
                ),
              }
            : originalParams
        : originalParams;
      if (type === 'updateAction') {
        const updateParams = params as UpdateActionParams;
        if (updateParams.data && typeof updateParams.data === 'object') {
          if (dataAnimation && finishesFadeFirst) {
            deferUpdate(scheduled, dataAnimation.endTimestamp);
            continue;
          }
          const changedKeys = changedDataKeys(updateParams.data, data);
          // A repeat changes nothing, so it must not cut the running fade short.
          if (dataAnimation && changedKeys.size === 0) continue;
          cutDataAnimation(scheduled.timestamp);
          const previousRuleData = data;
          data = { ...data, ...(updateParams.data as Record<string, unknown>) };
          const keys = this.#changedBindingKeys(changedKeys);
          // Worked out from the descriptor alone, never from what an earlier seek left mounted.
          const motions = new Map<string, UpdateMotion>();
          if (!updateParams.skipAnimation)
            for (const layer of this.activeDescriptor.layers) {
              if (!this.#contentFadeKeys(layer).some((key) => keys.has(key))) continue;
              const motion = this.#updateMotion(layer);
              if (motion) motions.set(layer.id, motion);
            }
          const halfMs = Math.max(0, ...[...motions.values()].map((motion) => motion.halfMs));
          const switchTimestamp = scheduled.timestamp + halfMs;
          const clocks = recordManualClockValues(data, switchTimestamp);
          const ruleWork: PendingRuleWork = {
            kind: 'data',
            previous: previousRuleData,
            current: data,
          };
          queueRuleWork(switchTimestamp, ruleWork);
          if (motions.size === 0) {
            displayData = { ...data };
            startUpdateReplays(
              scheduled.timestamp,
              changedKeys,
              previousRuleData,
              Boolean(updateParams.skipAnimation),
            );
          } else {
            dataAnimation = {
              startTimestamp: scheduled.timestamp,
              switchTimestamp,
              endTimestamp: switchTimestamp + halfMs,
              oldData: { ...displayData },
              newData: { ...data },
              motions,
              commit: { ruleWork, clocks },
              replays: { changedKeys, previousData: previousRuleData },
            };
          }
        }
      } else if (type === 'playAction') {
        const playParams = params as PlayActionParams;
        const previousStep = step;
        const outgoingEpochs = loopEpochsAt(scheduled.timestamp);
        const target = this.#resolvePlayTarget(step, playParams);
        if (target.currentStep === undefined || previousStep === undefined) {
          for (const events of clockEvents.values())
            events.push({
              timestamp: scheduled.timestamp,
              command: target.currentStep === undefined ? 'take-out' : 'take-in',
            });
        }
        if (previousStep === undefined && target.currentStep !== undefined) {
          recordChartHistory(data, scheduled.timestamp, true, Boolean(playParams.skipAnimation));
          for (const layer of this.activeDescriptor.layers) {
            if (
              layer.element.type === 'chart' &&
              normalizeChartAnimation(layer.element.animation).type !== 'none'
            )
              chartAnimationEpochs.set(layer.id, {
                timestamp: scheduled.timestamp,
                skip: Boolean(playParams.skipAnimation),
              });
          }
        }
        step = target.currentStep;
        targetKeyframeId = target.keyframeId;
        const targetSeconds = keyframeSeconds(targetKeyframeId);
        const exitsToEnd =
          previousStep !== undefined && targetKeyframeId === this.descriptor.endKeyframeId;
        const durationMs = exitsToEnd
          ? (exitDurationFrames(this.descriptor) / this.descriptor.frameRate) * 1000
          : Math.abs(targetSeconds - positionSeconds) * 1000;
        if (!exitsToEnd) {
          this.#beginLoopExit(
            targetSeconds * this.descriptor.frameRate,
            scheduled.timestamp,
            (layer) => target.currentStep === undefined || layer.loop?.activation.type === 'step',
            positionSeconds * this.descriptor.frameRate,
            outgoingEpochs,
            displayData,
          );
        } else this.#loopExitCorrection = null;
        animation =
          playParams.skipAnimation || durationMs === 0
            ? undefined
            : {
                startTimestamp: scheduled.timestamp,
                startSeconds: positionSeconds,
                targetSeconds,
                durationMs,
                ...(exitsToEnd
                  ? {
                      directTransition: this.#createDirectLifecycleTransition(
                        positionSeconds * this.descriptor.frameRate,
                        targetSeconds * this.descriptor.frameRate,
                        scheduled.timestamp,
                        outgoingEpochs,
                        displayData,
                      ),
                    }
                  : {}),
              };
        directSample = undefined;
        if (!animation) positionSeconds = targetSeconds;
        if (target.currentStep === undefined) {
          lifecycleEpoch = undefined;
          stepArrivalTimestamp = undefined;
          queueRuleWork(scheduled.timestamp, { kind: 'event', trigger: 'stop' });
        } else {
          const arrival = scheduled.timestamp + (animation?.durationMs ?? 0);
          stepArrivalTimestamp = arrival;
          lifecycleEpoch ??= arrival;
          if (previousStep === undefined)
            queueRuleWork(arrival, { kind: 'event', trigger: 'play' });
          const stepKeyframeId = this.descriptor.stepKeyframeIds[target.currentStep];
          queueRuleWork(arrival, {
            kind: 'event',
            trigger: 'step',
            ...(stepKeyframeId === undefined ? {} : { eventId: stepKeyframeId }),
          });
        }
      } else if (type === 'stopAction') {
        for (const events of clockEvents.values())
          events.push({ timestamp: scheduled.timestamp, command: 'take-out' });
        const stopParams = params as StopActionParams;
        const outgoingEpochs = loopEpochsAt(scheduled.timestamp);
        this.#loopExitCorrection = null;
        step = undefined;
        targetKeyframeId = this.descriptor.endKeyframeId;
        const targetSeconds = keyframeSeconds(targetKeyframeId);
        const durationMs = (exitDurationFrames(this.descriptor) / this.descriptor.frameRate) * 1000;
        animation =
          stopParams.skipAnimation || durationMs === 0
            ? undefined
            : {
                startTimestamp: scheduled.timestamp,
                startSeconds: positionSeconds,
                targetSeconds,
                durationMs,
                directTransition: this.#createDirectLifecycleTransition(
                  positionSeconds * this.descriptor.frameRate,
                  targetSeconds * this.descriptor.frameRate,
                  scheduled.timestamp,
                  outgoingEpochs,
                  displayData,
                ),
              };
        directSample = undefined;
        if (!animation) positionSeconds = targetSeconds;
        lifecycleEpoch = undefined;
        stepArrivalTimestamp = undefined;
        queueRuleWork(scheduled.timestamp, { kind: 'event', trigger: 'stop' });
      } else if (type === 'customAction') {
        const customParams = params as CustomActionParams;
        if (
          ['loop.pause', 'loop.resume', 'loop.next'].includes(customParams.id) &&
          this.activeDescriptor.layers.some((layer) => layer.loop?.timing)
        ) {
          const payload = customParams.payload as { groupId?: string } | undefined;
          if (typeof payload?.groupId !== 'string')
            throw new TypeError('Loop action requires a groupId.');
          this.#loopPlayback.control(
            customParams.id.slice(5) as LoopPlaybackAction,
            payload.groupId,
            (scheduled.timestamp * this.descriptor.frameRate) / 1000,
          );
          continue;
        }
        for (const [layerId, events] of clockEvents) {
          const command = this.#clockCommandFor(layerId, customParams.id);
          if (command) events.push({ timestamp: scheduled.timestamp, command });
        }
        const previousCustomData = data;
        if (customParams.payload && typeof customParams.payload === 'object') {
          cutDataAnimation(scheduled.timestamp);
          const previousRuleData = data;
          data = { ...data, ...(customParams.payload as Record<string, unknown>) };
          const changedKeys = changedDataKeys(customParams.payload, previousRuleData);
          for (const layer of this.activeDescriptor.layers) {
            if (layer.element.type !== 'chart') continue;
            const chartAnimation = normalizeChartAnimation(layer.element.animation);
            if (
              chartAnimation.type !== 'none' &&
              chartAnimation.replayOnUpdate &&
              (layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
                (binding) => binding.targetProperty === 'data' && changedKeys.has(binding.dataKey),
              )
            )
              chartAnimationEpochs.set(layer.id, {
                timestamp: scheduled.timestamp,
                skip: Boolean(customParams.skipAnimation),
              });
          }
          displayData = { ...data };
          recordManualClockValues(data, scheduled.timestamp);
          queueRuleWork(scheduled.timestamp, {
            kind: 'data',
            previous: previousRuleData,
            current: data,
          });
        }
        queueRuleWork(scheduled.timestamp, {
          kind: 'event',
          trigger: 'custom-action',
          eventId: customParams.id,
        });
        if (!customParams.skipAnimation) {
          customActionEpochs.set(customParams.id, scheduled.timestamp);
          for (const layer of this.activeDescriptor.layers) {
            if (layer.element.type !== 'text') continue;
            const textAnimation = normalizeTextAnimation(layer.element.textAnimation);
            if (
              hasTextAnimationSettings(textAnimation) &&
              textAnimation.customActionId === customParams.id
            ) {
              textAnimationSkipped.delete(layer.id);
              textAnimationEpochs.set(layer.id, scheduled.timestamp);
              const previousText = this.#resolveLayerElement(layer, previousCustomData);
              if (customParams.payload && previousText.type === 'text')
                textAnimationPrevious.set(layer.id, previousText);
              else textAnimationPrevious.delete(layer.id);
            }
          }
        }
      }
    }

    advanceDataTo(timestamp);
    queueTimerAlarms(timestamp);
    flushRules(timestamp);
    rules?.publish(timestamp);
    this.#lastData = displayData;
    this.#refreshBoundLayers();
    for (const [id, initial] of tickerInitial) {
      const host = this.#layerEls.get(id);
      if (host) renderTickerHistory(host, initial, tickerHistory.get(id) ?? [], timestamp);
    }
    this.#setUpdateMotionSamples(updateSamples);
    this.#currentStep = step;
    advanceTo(timestamp);
    this.#renderClocksAt(timestamp, clockEvents);
    this.#timeline?.seek(positionSeconds * this.activeDescriptor.frameRate, true);
    const chartMarkFrame = this.#chartMarkFrame(
      positionSeconds * this.activeDescriptor.frameRate,
      directSample?.transition ?? null,
    );
    const epochs = loopEpochsAt(timestamp);
    if (directSample) {
      this.#renderDirectLifecycleTransition(directSample.transition, directSample.progress);
    } else {
      this.#renderLoopSnapshot(timestamp, epochs);
    }
    for (const layer of this.activeDescriptor.layers) {
      if (layer.element.type !== 'text' || layer.element.clock) continue;
      const host = this.#layerEls.get(layer.id);
      const element = this.#resolveLayerElement(layer, displayData);
      if (!host || element.type !== 'text') continue;
      const epoch = textAnimationEpochs.get(layer.id);
      const frame = textAnimationSkipped.has(layer.id)
        ? textAnimationTotalFrames(element.textAnimation)
        : epoch === undefined
          ? positionSeconds * this.activeDescriptor.frameRate
          : Math.max(0, ((timestamp - epoch) / 1000) * this.activeDescriptor.frameRate);
      host.dataset.ografTextAnimationFrame = String(frame);
      setTextAnimationPrevious(host, textAnimationPrevious.get(layer.id) ?? null);
      renderTextAnimationAtFrame(host, element, frame);
    }
    for (const layer of this.activeDescriptor.layers) {
      if (layer.element.type !== 'chart') continue;
      const host = this.#layerEls.get(layer.id);
      const element = this.#resolveLayerElement(layer, displayData);
      if (!host || element.type !== 'chart') continue;
      const epoch = chartAnimationEpochs.get(layer.id);
      const frame =
        epoch === undefined
          ? positionSeconds * this.activeDescriptor.frameRate
          : epoch.skip
            ? chartAnimationEndFrame(element)
            : Math.max(0, ((timestamp - epoch.timestamp) / 1000) * this.activeDescriptor.frameRate);
      host.dataset.ografChartAnimationFrame = String(frame);
      const history = chartAnimationHistory.get(layer.id);
      if (
        history &&
        renderChartAnimationHistoryAtFrame(
          host,
          history,
          (timestamp * this.activeDescriptor.frameRate) / 1000,
          chartMarkFrame,
        )
      )
        continue;
      renderChartAnimationAtFrame(host, element, frame, chartMarkFrame);
    }
    return chartMarkFrame;
  }

  async goToTime(params: GoToTimeParams): Promise<ReturnPayload | undefined> {
    return this.#serializeOperation(() => this.#goToTimeUnlocked(params));
  }

  async #goToTimeUnlocked(params: GoToTimeParams): Promise<ReturnPayload | undefined> {
    try {
      for (const clock of this.#clocks.values()) clock.stopRealtime();
      this.#clearContentAnimationFrames();
      this.#stopLoopRendering();
      this.#clearChartAnimationFrames();
      this.#clearTextAnimationFrames();
      for (const layer of this.activeDescriptor.layers) {
        if (layer.element.type !== 'text' || layer.element.clock) continue;
        const host = this.#layerEls.get(layer.id);
        if (host) setTextAnimationPrevious(host, null);
      }
      this.#timeline?.pause();
      this.#activeTransition?.cancel();
      this.#activeTransition = null;
      this.#directLifecycleTransition = null;
      this.#loopExitCorrection = null;
      this.#timeline?.seek((params.timestamp / 1000) * this.activeDescriptor.frameRate, true);
      this.#mediaCueRuntime?.reset();
      this.#mediaCueRuntime?.renderAtTime(params.timestamp);
      let chartMarkFrame: number | undefined;
      if (this.#schedule.length > 0) chartMarkFrame = this.#applySchedule(params.timestamp);
      else {
        this.#renderClocksAt(params.timestamp);
        this.#renderLoopSnapshot(params.timestamp, new Map());
      }
      this.#renderAnimatedContentAt(params.timestamp, false, chartMarkFrame);
      await this.#awaitContentReady();
      this.#renderAnimatedContentAt(params.timestamp, false, chartMarkFrame);
      if (this.#schedule.length > 0) this.#applySchedule(params.timestamp);
      else {
        this.#renderClocksAt(params.timestamp);
        this.#renderLoopSnapshot(params.timestamp, new Map());
      }
      await this.#awaitContentReady();
      // The final schedule pass can rebuild ticker children after the prior
      // native-content sample. Settle those children at the requested frame.
      for (const layer of this.activeDescriptor.layers) {
        if (layer.element.type !== 'ticker') continue;
        const host = this.#layerEls.get(layer.id);
        if (host)
          renderAnimatedElementAtTime(host, layer.element, params.timestamp, { playing: false });
      }
      if (this.activeDescriptor.layers.some((layer) => layer.element.type === 'ticker'))
        await this.#awaitContentReady();
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  async setActionsSchedule(params: SetActionsScheduleParams): Promise<ReturnPayload | undefined> {
    return this.#serializeOperation(() => this.#setActionsScheduleUnlocked(params));
  }

  async #setActionsScheduleUnlocked(
    params: SetActionsScheduleParams,
  ): Promise<ReturnPayload | undefined> {
    try {
      this.#schedule = [...params.schedule].sort((a, b) => a.timestamp - b.timestamp);
      this.#externalSchedule = new WeakSet(this.#schedule);
      this.#clearChartAnimationFrames();
      this.#scheduleBaseData = { ...this.#lastData };
      if (this.#schedule.length === 0) {
        for (const host of this.#layerEls.values()) delete host.dataset.ografTextAnimationFrame;
        // Later seeks skip replay, which would otherwise be what clears a sampled update.
        this.#setUpdateMotionSamples(new Map());
      }
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }
}
