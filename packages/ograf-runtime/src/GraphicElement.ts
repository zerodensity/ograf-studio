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
import { resolvePlayTarget } from './lifecycle';
import {
  applyAnimatedPaint,
  disposeElementContent,
  renderAnimatedElementAtTime,
  renderElementContent,
  resolveBoundElement,
} from './renderElement';
import { layerEffectsToCssFilter } from '@ograf-editor/scene-model';
import {
  EFFECT_ANIMATION_PROPERTIES,
  isGradientStopOffsetProperty,
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

function errorPayload(err: unknown): ReturnPayload {
  return {
    statusCode: GRAPHIC_ERROR_STATUS_CODE,
    statusMessage: err instanceof Error ? err.message : String(err),
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
 * which is what guarantees the two can never diverge (see docs/PLAN.md, "Runtime is interpreted,
 * not templated per-project").
 *
 * Custom Elements can't take constructor arguments (the browser calls `new SubClass()` with no
 * args when upgrading/creating one), so the descriptor is read via a `static descriptor` on the
 * concrete subclass instead: `class Foo extends GraphicElement { static descriptor = {...} }`.
 * The in-app preview harness dynamically declares one such subclass per compile and registers it
 * under a fresh tag name; an exported package's main.js does the same thing once, statically.
 */
export abstract class GraphicElement extends HTMLElement implements Graphic {
  static descriptor: CompiledGraphicDescriptor;

  #layerEls = new Map<string, HTMLElement>();
  #timeline: ReturnType<typeof buildRuntimeTimeline> | null = null;
  #activeTween: { kill(): void } | null = null;
  /** Index into `descriptor.stepKeyframeIds` — the OGraf "current step", not a keyframe index. */
  #currentStep: number | undefined;
  #lastData: Record<string, unknown> = {};
  #schedule: ScheduledAction[] = [];
  /** Snapshot of `#lastData` taken when `setActionsSchedule` is called — the baseline `goToTime`
   * replays scheduled `updateAction` entries on top of, so scrubbing backward past a scheduled
   * update correctly reverts keys that update doesn't touch, instead of leaving them stuck. */
  #scheduleBaseData: Record<string, unknown> = {};
  /** Realtime self-animated-content redraw requests. Phase is derived from absolute elapsed time. */
  #contentAnimationFrames = new Map<string, number>();
  #renderType: LoadParams['renderType'] = 'realtime';
  /** Absolute clock epochs for active layer-local loops. Values use performance.now() in realtime
   * and the scheduled OGraf timestamp in non-realtime; sampling always derives phase absolutely. */
  #activeLoopEpochs = new Map<string, number>();
  #loopAnimationFrame: number | null = null;
  #loopExitCorrection: LoopExitCorrection | null = null;
  #directLifecycleTransition: DirectLifecycleTransition | null = null;
  #updateAnimations: Animation[] = [];

  private get descriptor(): CompiledGraphicDescriptor {
    return (this.constructor as typeof GraphicElement).descriptor;
  }

  connectedCallback(): void {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.#buildDom();
  }

  disconnectedCallback(): void {
    this.#activeTween?.kill();
    this.#timeline?.kill();
    this.#clearContentAnimationFrames();
    this.#stopLoopRendering();
    this.#cancelUpdateAnimations();
    for (const element of this.#layerEls.values()) disposeElementContent(element);
    this.#layerEls.clear();
  }

  #clearContentAnimationFrames(): void {
    if (typeof cancelAnimationFrame !== 'undefined') {
      for (const id of this.#contentAnimationFrames.values()) cancelAnimationFrame(id);
    }
    this.#contentAnimationFrames.clear();
  }

  #cancelUpdateAnimations(): void {
    for (const animation of this.#updateAnimations) animation.cancel();
    this.#updateAnimations = [];
    for (const layer of this.descriptor.layers) {
      const content = this.#layerEls.get(layer.id)?.firstElementChild as HTMLElement | null;
      if (content) content.style.opacity = '';
    }
  }

  #changedBindingKeys(data: unknown): Set<string> {
    if (!data || typeof data !== 'object') return new Set();
    const patch = data as Record<string, unknown>;
    return new Set(
      this.descriptor.layers
        .flatMap((layer) =>
          (layer.bindings ?? (layer.binding ? [layer.binding] : [])).map(
            (binding) => binding.dataKey,
          ),
        )
        .filter((key): key is string => key !== undefined && Object.hasOwn(patch, key)),
    );
  }

  #setBoundContentOpacity(dataKeys: Set<string>, opacity: number): void {
    for (const layer of this.descriptor.layers) {
      const bindings = layer.bindings ?? (layer.binding ? [layer.binding] : []);
      if (!bindings.some((binding) => dataKeys.has(binding.dataKey))) continue;
      const content = this.#layerEls.get(layer.id)?.firstElementChild as HTMLElement | null;
      if (content) content.style.opacity = String(opacity);
    }
  }

  async #animateBoundContent(
    dataKeys: Set<string>,
    from: number,
    to: number,
    durationMs: number,
  ): Promise<void> {
    if (durationMs <= 0 || dataKeys.size === 0) return;
    const animations: Animation[] = [];
    for (const layer of this.descriptor.layers) {
      const bindings = layer.bindings ?? (layer.binding ? [layer.binding] : []);
      if (!bindings.some((binding) => dataKeys.has(binding.dataKey))) continue;
      const content = this.#layerEls.get(layer.id)?.firstElementChild as HTMLElement | null;
      if (!content) continue;
      const animation = content.animate([{ opacity: from }, { opacity: to }], {
        duration: durationMs,
        easing: 'ease-in-out',
        fill: 'forwards',
      });
      animations.push(animation);
    }
    this.#updateAnimations = animations;
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
    if (this.#updateAnimations === animations) this.#updateAnimations = [];
  }

  #stopLoopRendering(): void {
    if (this.#loopAnimationFrame !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.#loopAnimationFrame);
    }
    this.#loopAnimationFrame = null;
    this.#activeLoopEpochs.clear();
  }

  #renderLoopSnapshot(clockMs: number, epochs = this.#activeLoopEpochs): void {
    const baseFrame = (this.#timeline?.time() ?? 0) * this.descriptor.frameRate;
    const states = new Map<string, ReturnType<typeof sampleCompiledLayerVisualState>>();
    for (const layer of this.descriptor.layers) {
      const direct = this.#directLifecycleTransition;
      const directLayer = direct?.layers.get(layer.id);
      const directDistance = direct ? Math.abs(direct.targetFrame - direct.startFrame) : 0;
      const directProgress =
        !direct || directDistance === 0
          ? 1
          : Math.min(1, Math.abs(baseFrame - direct.startFrame) / directDistance);
      const epoch = epochs.get(layer.id);
      const elapsedFrames =
        epoch === undefined
          ? undefined
          : Math.max(0, ((clockMs - epoch) / 1000) * this.descriptor.frameRate);
      const state =
        direct && directLayer
          ? interpolateCompiledLayerVisualState(
              layer,
              directLayer.source,
              directLayer.target,
              directProgress,
              direct.targetFrame,
            )
          : sampleCompiledLayerVisualState(layer, baseFrame, elapsedFrames);
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
        for (const [property, delta] of Object.entries(correction.paint) as [
          AnimatableLayerProperty,
          number,
        ][]) {
          const sampled = state.paintTracks[property]?.[0];
          if (sampled) sampled.value += delta * remaining;
        }
      }
      states.set(layer.id, state);
      const element = this.#layerEls.get(layer.id);
      if (element) applyCompiledLayerVisualState(element, state);
    }
    applyCompiledClipPaths(this.descriptor, this.#layerEls, states);
  }

  #createDirectLifecycleTransition(
    startFrame: number,
    targetFrame: number,
    clockMs: number,
    epochs = this.#activeLoopEpochs,
  ): DirectLifecycleTransition {
    const layers = new Map<
      string,
      DirectLifecycleTransition['layers'] extends Map<string, infer V> ? V : never
    >();
    for (const layer of this.descriptor.layers) {
      const epoch = epochs.get(layer.id);
      const elapsedFrames =
        epoch === undefined
          ? undefined
          : Math.max(0, ((clockMs - epoch) / 1000) * this.descriptor.frameRate);
      layers.set(layer.id, {
        source: sampleCompiledLayerVisualState(layer, startFrame, elapsedFrames),
        target: sampleCompiledLayerVisualState(layer, targetFrame),
      });
    }
    return { startFrame, targetFrame, layers };
  }

  #renderDirectLifecycleTransition(transition: DirectLifecycleTransition, progress: number): void {
    const states = new Map<string, ReturnType<typeof sampleCompiledLayerVisualState>>();
    for (const layer of this.descriptor.layers) {
      const resolved = transition.layers.get(layer.id);
      if (!resolved) continue;
      const state = interpolateCompiledLayerVisualState(
        layer,
        resolved.source,
        resolved.target,
        progress,
        transition.targetFrame,
      );
      states.set(layer.id, state);
      const element = this.#layerEls.get(layer.id);
      if (element) applyCompiledLayerVisualState(element, state);
    }
    applyCompiledClipPaths(this.descriptor, this.#layerEls, states);
  }

  #beginDirectLifecycleTransition(targetFrame: number, clockMs: number): void {
    const startFrame = (this.#timeline?.time() ?? 0) * this.descriptor.frameRate;
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
  ): void {
    this.#directLifecycleTransition = null;
    const baseFrame = (this.#timeline?.time() ?? 0) * this.descriptor.frameRate;
    const layers = new Map<
      string,
      LoopExitCorrection['layers'] extends Map<string, infer V> ? V : never
    >();
    for (const layer of this.descriptor.layers) {
      const epoch = this.#activeLoopEpochs.get(layer.id);
      if (epoch === undefined || !layer.loop || !shouldExit(layer)) continue;
      const elapsed = Math.max(0, ((clockMs - epoch) / 1000) * this.descriptor.frameRate);
      const looped = sampleCompiledLayerVisualState(layer, baseFrame, elapsed);
      const base = sampleCompiledLayerVisualState(layer, baseFrame);
      const transform: Partial<LayerTransform> = {};
      const effects: Partial<Record<(typeof EFFECT_ANIMATION_PROPERTIES)[number], number>> = {};
      const paint: Partial<Record<AnimatableLayerProperty, number>> = {};
      for (const property of Object.keys(layer.loop.tracks) as AnimatableLayerProperty[]) {
        if (TRANSFORM_ANIMATION_PROPERTIES.includes(property as keyof LayerTransform)) {
          const key = property as keyof LayerTransform;
          transform[key] = looped.transform[key] - base.transform[key];
        } else if (EFFECT_ANIMATION_PROPERTIES.some((candidate) => candidate === property)) {
          const key = property as (typeof EFFECT_ANIMATION_PROPERTIES)[number];
          effects[key] = looped.effects[key] - base.effects[key];
        } else if (isGradientStopOffsetProperty(property)) {
          paint[property] =
            (looped.paintTracks[property]?.[0]?.value ?? 0) -
            (base.paintTracks[property]?.[0]?.value ?? 0);
        }
      }
      layers.set(layer.id, { transform, effects, paint });
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
      this.#loopAnimationFrame = requestAnimationFrame(render);
    };
    this.#loopAnimationFrame = requestAnimationFrame(render);
  }

  #activateLoopsAtStep(step: number | undefined, epochMs: number, firstStep: boolean): void {
    const stepKeyframeId = step === undefined ? undefined : this.descriptor.stepKeyframeIds[step];
    for (const layer of this.descriptor.layers) {
      const activation = layer.loop?.activation;
      if (!activation) continue;
      if (activation.type === 'lifecycle') {
        if (firstStep || !this.#activeLoopEpochs.has(layer.id)) {
          this.#activeLoopEpochs.set(layer.id, epochMs);
        }
      } else if (activation.stepKeyframeId === stepKeyframeId) {
        this.#activeLoopEpochs.set(layer.id, epochMs);
      }
    }
    this.#ensureLoopRendering();
  }

  #deactivateStepLoops(): void {
    for (const layer of this.descriptor.layers) {
      if (layer.loop?.activation.type === 'step') this.#activeLoopEpochs.delete(layer.id);
    }
  }

  #deactivateAllLoops(): void {
    this.#stopLoopRendering();
  }

  #buildDom(): void {
    const shadow = this.shadowRoot;
    if (!shadow) return;
    const descriptor = this.descriptor;
    for (const element of this.#layerEls.values()) disposeElementContent(element);
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
    style.textContent = `${fontFaces}\n:host { display: block; position: relative; overflow: hidden; isolation: isolate; }`;
    shadow.appendChild(style);

    this.style.width = `${descriptor.width}px`;
    this.style.height = `${descriptor.height}px`;
    this.style.backgroundColor = descriptor.backgroundColor;

    this.#layerEls.clear();
    for (const layer of descriptor.layers) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      el.style.boxSizing = 'border-box';
      el.style.display = layer.isVisible ? '' : 'none';
      el.style.mixBlendMode = layer.blendMode ?? 'normal';
      el.style.filter = layerEffectsToCssFilter(layer.effects);
      const firstTransform = [...layer.keyframes].sort((a, b) => a.frame - b.frame)[0]?.transform;
      if (firstTransform) {
        el.style.width = `${firstTransform.width}px`;
        el.style.height = `${firstTransform.height}px`;
      }
      renderElementContent(el, resolveBoundElement(layer, this.#lastData));
      shadow.appendChild(el);
      this.#layerEls.set(layer.id, el);

      this.#startContentPlayback(layer, el);
    }

    this.#timeline?.kill();
    this.#timeline = buildRuntimeTimeline(descriptor, this.#layerEls);
  }

  #startContentPlayback(layer: CompiledGraphicDescriptor['layers'][number], el: HTMLElement): void {
    const element = layer.element;
    if (
      (element.type !== 'image-sequence' && element.type !== 'lottie') ||
      (element.type === 'image-sequence' && element.frames.length === 0) ||
      (element.type === 'lottie' && !element.animationData)
    ) {
      return;
    }
    if (typeof requestAnimationFrame === 'undefined') return;
    const epoch = performance.now();
    const render = (now: number) => {
      const elapsedMs = Math.max(0, now - epoch);
      renderAnimatedElementAtTime(el, element, elapsedMs);
      if (
        element.type === 'image-sequence' &&
        !element.loop &&
        elapsedMs / 1000 >= element.frames.length / Math.max(1, element.fps)
      ) {
        this.#contentAnimationFrames.delete(layer.id);
        return;
      }
      const request = requestAnimationFrame(render);
      this.#contentAnimationFrames.set(layer.id, request);
    };
    this.#contentAnimationFrames.set(layer.id, requestAnimationFrame(render));
  }

  #startRealtimeContentAnimations(): void {
    this.#clearContentAnimationFrames();
    for (const layer of this.descriptor.layers) {
      const el = this.#layerEls.get(layer.id);
      if (el) this.#startContentPlayback(layer, el);
    }
  }

  #renderAnimatedContentAt(timestampMs: number): void {
    for (const layer of this.descriptor.layers) {
      if (layer.element.type !== 'image-sequence' && layer.element.type !== 'lottie') continue;
      const el = this.#layerEls.get(layer.id);
      if (!el) continue;
      renderAnimatedElementAtTime(el, layer.element, timestampMs);
    }
  }

  #refreshBoundLayers(): void {
    for (const layer of this.descriptor.layers) {
      if ((layer.bindings ?? (layer.binding ? [layer.binding] : [])).length === 0) continue;
      const el = this.#layerEls.get(layer.id);
      if (el) {
        renderElementContent(el, resolveBoundElement(layer, this.#lastData));
        applyAnimatedPaint(
          el,
          layer.animationTracks,
          (this.#timeline?.time() ?? 0) * this.descriptor.frameRate,
        );
      }
    }
  }

  #applyData(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    this.#lastData = { ...this.#lastData, ...(data as Record<string, unknown>) };
    this.#refreshBoundLayers();
  }

  #replaceData(data: unknown): void {
    this.#lastData =
      data && typeof data === 'object' ? { ...(data as Record<string, unknown>) } : {};
    this.#refreshBoundLayers();
  }

  async #seekToKeyframeId(
    keyframeId: string | null,
    skipAnimation?: boolean,
    durationSeconds?: number,
  ): Promise<void> {
    const keyframe = this.descriptor.keyframes.find((k) => k.id === keyframeId);
    const tl = this.#timeline;
    if (!keyframe || !tl) return;
    const targetSeconds = keyframe.frame / this.descriptor.frameRate;
    this.#activeTween?.kill();
    this.#activeTween = null;
    if (skipAnimation) {
      this.#loopExitCorrection = null;
      this.#directLifecycleTransition = null;
      tl.seek(targetSeconds, true);
    } else {
      await new Promise<void>((resolve) => {
        const finish = () => {
          this.#activeTween = null;
          this.#loopExitCorrection = null;
          this.#directLifecycleTransition = null;
          this.#renderLoopSnapshot(
            typeof performance !== 'undefined' ? performance.now() : Date.now(),
          );
          resolve();
        };
        this.#activeTween = tl.tweenTo(targetSeconds, {
          ...(durationSeconds !== undefined ? { duration: durationSeconds, ease: 'none' } : {}),
          onUpdate: () =>
            this.#renderLoopSnapshot(
              typeof performance !== 'undefined' ? performance.now() : Date.now(),
            ),
          onComplete: finish,
          onInterrupt: finish,
        });
      });
    }
  }

  async load(params: LoadParams): Promise<ReturnPayload | undefined> {
    try {
      this.#cancelUpdateAnimations();
      this.#replaceData(params.data);
      this.#stopLoopRendering();
      this.#renderType = params.renderType;
      if (this.#renderType === 'realtime') this.#startRealtimeContentAnimations();
      else {
        this.#clearContentAnimationFrames();
        this.#renderAnimatedContentAt(0);
      }
      this.#schedule = [];
      this.#scheduleBaseData = { ...this.#lastData };
      this.#currentStep = undefined;
      this.#directLifecycleTransition = null;
      await this.#seekToKeyframeId(this.descriptor.startKeyframeId, true);
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  async dispose(): Promise<ReturnPayload | undefined> {
    try {
      this.#timeline?.kill();
      this.#timeline = null;
      this.#activeTween?.kill();
      this.#activeTween = null;
      this.#clearContentAnimationFrames();
      this.#stopLoopRendering();
      this.#cancelUpdateAnimations();
      this.#schedule = [];
      this.#directLifecycleTransition = null;
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  async updateAction(params: UpdateActionParams): Promise<ReturnPayload | undefined> {
    try {
      this.#cancelUpdateAnimations();
      const keys = this.#changedBindingKeys(params.data);
      const durationMs =
        params.skipAnimation || (this.descriptor.updateTransitionFrames ?? 0) <= 0
          ? 0
          : ((this.descriptor.updateTransitionFrames ?? 0) / this.descriptor.frameRate) * 1000;
      if (durationMs <= 0 || keys.size === 0) {
        this.#applyData(params.data);
        return { statusCode: 200 };
      }
      await this.#animateBoundContent(keys, 1, 0, durationMs / 2);
      this.#applyData(params.data);
      this.#setBoundContentOpacity(keys, 0);
      await this.#animateBoundContent(keys, 0, 1, durationMs / 2);
      this.#setBoundContentOpacity(keys, 1);
      return { statusCode: 200 };
    } catch (err) {
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
    try {
      const previousStep = this.#currentStep;
      const target = this.#resolvePlayTarget(this.#currentStep, params);
      const targetFrame =
        this.descriptor.keyframes.find((keyframe) => keyframe.id === target.keyframeId)?.frame ?? 0;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const exitsToEnd =
        previousStep !== undefined && target.keyframeId === this.descriptor.endKeyframeId;
      if (exitsToEnd) this.#beginDirectLifecycleTransition(targetFrame, now);
      else {
        this.#beginLoopExit(
          targetFrame,
          now,
          (layer) => target.currentStep === undefined || layer.loop?.activation.type === 'step',
        );
      }
      this.#deactivateStepLoops();
      if (target.currentStep === undefined) this.#deactivateAllLoops();
      const exitDurationSeconds = exitsToEnd
        ? (this.descriptor.transitions.find(
            (transition) => transition.toKeyframeId === this.descriptor.endKeyframeId,
          )?.durationFrames ?? 0) / this.descriptor.frameRate
        : undefined;
      await this.#seekToKeyframeId(target.keyframeId, params.skipAnimation, exitDurationSeconds);
      this.#currentStep = target.currentStep;
      if (this.#currentStep !== undefined) {
        this.#activateLoopsAtStep(
          this.#currentStep,
          typeof performance !== 'undefined' ? performance.now() : Date.now(),
          previousStep === undefined,
        );
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
    try {
      const targetFrame =
        this.descriptor.keyframes.find((keyframe) => keyframe.id === this.descriptor.endKeyframeId)
          ?.frame ?? 0;
      this.#beginDirectLifecycleTransition(
        targetFrame,
        typeof performance !== 'undefined' ? performance.now() : Date.now(),
      );
      this.#deactivateAllLoops();
      const durationSeconds =
        (this.descriptor.transitions.find(
          (transition) => transition.toKeyframeId === this.descriptor.endKeyframeId,
        )?.durationFrames ?? 0) / this.descriptor.frameRate;
      await this.#seekToKeyframeId(
        this.descriptor.endKeyframeId,
        params.skipAnimation,
        durationSeconds,
      );
      this.#currentStep = undefined;
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  async customAction(params: CustomActionParams): Promise<ReturnPayload | undefined> {
    try {
      const known = this.descriptor.customActions.some((a) => a.id === params.id);
      if (!known) {
        return { statusCode: 404, statusMessage: `Unknown customAction id: "${params.id}"` };
      }
      // Phase 4 MVP: custom actions are declarative metadata authored in the Data panel with no
      // scripted payload/behavior yet — acknowledge receipt of a known action id.
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
  #applySchedule(timestamp: number): void {
    const due = this.#schedule.filter((a) => a.timestamp <= timestamp);

    let step: number | undefined;
    let targetKeyframeId = this.descriptor.startKeyframeId;
    let data: Record<string, unknown> = { ...this.#scheduleBaseData };
    let displayData: Record<string, unknown> = { ...data };
    let updateOpacity = 1;
    let updateKeys = new Set<string>();
    let dataAnimation:
      | {
          startTimestamp: number;
          durationMs: number;
          oldData: Record<string, unknown>;
          newData: Record<string, unknown>;
          keys: Set<string>;
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

    const advanceDataTo = (atTimestamp: number): void => {
      if (!dataAnimation) {
        updateOpacity = 1;
        updateKeys = new Set();
        return;
      }
      const progress = Math.min(
        1,
        Math.max(0, (atTimestamp - dataAnimation.startTimestamp) / dataAnimation.durationMs),
      );
      displayData = progress < 0.5 ? dataAnimation.oldData : dataAnimation.newData;
      updateOpacity = progress < 0.5 ? 1 - progress * 2 : (progress - 0.5) * 2;
      updateKeys = dataAnimation.keys;
      if (progress >= 1) {
        displayData = dataAnimation.newData;
        updateOpacity = 1;
        updateKeys = new Set();
        dataAnimation = undefined;
      }
    };

    for (const scheduled of due) {
      advanceTo(scheduled.timestamp);
      advanceDataTo(scheduled.timestamp);
      const { type, params } = scheduled.action;
      if (type === 'updateAction') {
        const updateParams = params as UpdateActionParams;
        if (updateParams.data && typeof updateParams.data === 'object') {
          if (dataAnimation) {
            displayData = { ...data };
            updateOpacity = 1;
            updateKeys = new Set();
            dataAnimation = undefined;
          }
          data = { ...data, ...(updateParams.data as Record<string, unknown>) };
          const durationMs =
            ((this.descriptor.updateTransitionFrames ?? 0) / this.descriptor.frameRate) * 1000;
          const keys = this.#changedBindingKeys(updateParams.data);
          if (updateParams.skipAnimation || durationMs <= 0 || keys.size === 0) {
            displayData = { ...data };
          } else {
            dataAnimation = {
              startTimestamp: scheduled.timestamp,
              durationMs,
              oldData: { ...displayData },
              newData: { ...data },
              keys,
            };
          }
        }
      } else if (type === 'playAction') {
        const playParams = params as PlayActionParams;
        const previousStep = step;
        const target = this.#resolvePlayTarget(step, playParams);
        step = target.currentStep;
        targetKeyframeId = target.keyframeId;
        const targetSeconds = keyframeSeconds(targetKeyframeId);
        const exitsToEnd =
          previousStep !== undefined && targetKeyframeId === this.descriptor.endKeyframeId;
        const durationMs = exitsToEnd
          ? ((this.descriptor.transitions.find(
              (transition) => transition.toKeyframeId === this.descriptor.endKeyframeId,
            )?.durationFrames ?? 0) /
              this.descriptor.frameRate) *
            1000
          : Math.abs(targetSeconds - positionSeconds) * 1000;
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
                        new Map(),
                      ),
                    }
                  : {}),
              };
        directSample = undefined;
        if (!animation) positionSeconds = targetSeconds;
        if (target.currentStep === undefined) {
          lifecycleEpoch = undefined;
          stepArrivalTimestamp = undefined;
        } else {
          const arrival = scheduled.timestamp + (animation?.durationMs ?? 0);
          stepArrivalTimestamp = arrival;
          lifecycleEpoch ??= arrival;
        }
      } else if (type === 'stopAction') {
        const stopParams = params as StopActionParams;
        step = undefined;
        targetKeyframeId = this.descriptor.endKeyframeId;
        const targetSeconds = keyframeSeconds(targetKeyframeId);
        const durationMs =
          ((this.descriptor.transitions.find(
            (transition) => transition.toKeyframeId === this.descriptor.endKeyframeId,
          )?.durationFrames ?? 0) /
            this.descriptor.frameRate) *
          1000;
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
                  new Map(),
                ),
              };
        directSample = undefined;
        if (!animation) positionSeconds = targetSeconds;
        lifecycleEpoch = undefined;
        stepArrivalTimestamp = undefined;
      }
      // 'customAction' has no observable runtime state to replay (declarative ack only).
    }

    advanceDataTo(timestamp);
    this.#lastData = displayData;
    this.#refreshBoundLayers();
    this.#setBoundContentOpacity(updateKeys, updateOpacity);
    this.#currentStep = step;
    advanceTo(timestamp);
    this.#timeline?.seek(positionSeconds, true);
    const epochs = new Map<string, number>();
    const settled = animation === undefined;
    const stepKeyframeId = step === undefined ? undefined : this.descriptor.stepKeyframeIds[step];
    for (const layer of this.descriptor.layers) {
      const activation = layer.loop?.activation;
      if (!activation) continue;
      if (
        activation.type === 'lifecycle' &&
        lifecycleEpoch !== undefined &&
        timestamp >= lifecycleEpoch
      ) {
        epochs.set(layer.id, lifecycleEpoch);
      } else if (
        activation.type === 'step' &&
        settled &&
        stepArrivalTimestamp !== undefined &&
        activation.stepKeyframeId === stepKeyframeId
      ) {
        epochs.set(layer.id, stepArrivalTimestamp);
      }
    }
    if (directSample) {
      this.#renderDirectLifecycleTransition(directSample.transition, directSample.progress);
    } else {
      this.#renderLoopSnapshot(timestamp, epochs);
    }
  }

  async goToTime(params: GoToTimeParams): Promise<ReturnPayload | undefined> {
    try {
      this.#timeline?.pause();
      this.#activeTween?.kill();
      this.#activeTween = null;
      this.#timeline?.seek(params.timestamp / 1000, true);
      if (this.#schedule.length > 0) this.#applySchedule(params.timestamp);
      else this.#renderLoopSnapshot(params.timestamp, new Map());
      this.#renderAnimatedContentAt(params.timestamp);
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }

  async setActionsSchedule(params: SetActionsScheduleParams): Promise<ReturnPayload | undefined> {
    try {
      this.#schedule = [...params.schedule].sort((a, b) => a.timestamp - b.timestamp);
      this.#scheduleBaseData = { ...this.#lastData };
      return { statusCode: 200 };
    } catch (err) {
      return errorPayload(err);
    }
  }
}
