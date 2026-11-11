import { hasTextAnimationSettings, textAnimationTotalFrames } from '@ograf-editor/scene-model';
import { applyCompiledAutoLayout } from './autoLayoutRendering';
import { animatesItsOwnUpdate, classifyElementDataChange } from './inPlaceData';
import {
  resolveUpdateMotion,
  sampleUpdateMotion,
  type UpdateMotion,
  type UpdateMotionSample,
} from './updateMotion';
import { inheritTickerPlayback, tickerReadinessScope } from './tickerRendering';
import { applyCompiledMasks } from './maskRendering';
import { LoopPlaybackController } from './loopPlayback';
import { applyCompiledMotionPaths } from './motionPathRendering';
import { applyCompiledTextPaths } from './textPathRendering';
import { applyCompiledModifiers } from './modifierRendering';
import { compositionHasBackdropBlur, setCompositionBackdropRoot } from './backdropEffectRendering';
import { waitForLayerEffectsReady } from './effectCompositing';
import { expandRuntimeCollections, isRuntimeCollectionLayerActive } from './runtimeCollections';
import {
  bindRuntimePointerPosition,
  runtimePointerPosition,
  runtimeRelatedLayerId,
  type RuntimePointerPosition,
} from './runtimePointer';
import { claimsRuntimeKeyboardInput } from './runtimeKeyboard';
import {
  RuntimeVisualRules,
  pointerVisualRuleTriggers,
  visualRuleEffectFor,
  visualRuleLayerVisible,
  type FiredRuntimeVisualRule,
  type RuntimeVisualRuleEffect,
} from './runtimeVisualRules';
import { shaderBackingSizeForLayer, waitForShadersComplete } from './shaderRendering';
import { shaderStrokePaddingForLayer } from './shaderPaintRendering';
import { renderTextAnimationAtFrame, setTextAnimationPrevious } from './textAnimationRendering';
import {
  chartAnimationEndFrame,
  renderChartAnimationAtFrame,
  renderChartAnimationHistoryAtFrame,
  compactSettledChartAnimationHistory,
  chartUpdateChangesDataOnly,
  type ChartAnimationHistoryEntry,
} from './chartRendering';
import {
  applyCompiledClipPaths,
  applyCompiledLayerVisualState,
  sampleCompiledLayerVisualState,
} from './loopRendering';
import {
  sampleTransitionLogicLayerVisualState,
  sampleTransitionLogicLifecycle,
  type TransitionLogicLifecyclePose,
} from './transitionLogicLifecycle';
export type { TransitionLogicLifecyclePose } from './transitionLogicLifecycle';
import {
  disposeElementContent,
  lottieBackingSizeForLayer,
  renderAnimatedElementAtTime,
  renderElementContent,
  setLottieDeterministicRendering,
  resolveBoundElement,
  waitForElementContentReady,
} from './renderElement';
import type {
  CompiledFontResource,
  CompiledGraphicDescriptor,
  SharedGraphicPointerEdge,
} from '@ograf-editor/ograf-types';
import {
  hasElementMediaPaint,
  hasElementShaderPaint,
  type Element as SceneElement,
  type LayerTransform,
  normalizeClockTimerSettings,
  clockTimerActionId,
  parseClockTimerActionId,
  normalizeTextAnimation,
  normalizeChartAnimation,
  layerTransformBindingChannel,
  visualRuleSetDataValue,
  type TextElement,
  type TransitionLogicSharedValue,
  type VisualRuleAction,
} from '@ograf-editor/scene-model';
import {
  clockTimerSettingsAtTime,
  clockTimerStateAtTime,
  clockTimerTextAnimationAtTime,
  resolveClockTimerText,
  type ClockTimerEvent,
} from './clockTimerRuntime';
import {
  compiledTimerAlarms,
  createClockTimerAlarmTracker,
  type ClockTimerAlarmDefinition,
  type ClockTimerAlarmEvent,
} from './timerAlarms';

const fontLoads = new WeakMap<Document, Map<string, Promise<unknown>>>();
const mountedRules = new WeakMap<TransitionLogicMount, RuntimeVisualRules>();
const mountedLoops = new WeakMap<TransitionLogicMount, LoopPlaybackController>();
const mountedTickers = new WeakMap<
  TransitionLogicMount,
  { layers: Map<string, HTMLElement>; origin: () => number }
>();
const mountedCharts = new WeakMap<
  TransitionLogicMount,
  Map<string, ChartAnimationHistoryEntry[]>
>();
interface MountedClock {
  base: TextElement;
  events: ClockTimerEvent[];
  signature: string;
  /** Absolute coordinator frame at the beginning of this clock's event history. */
  originFrame: number;
  inherited?: boolean;
  onAir: boolean;
  firedAlarms: Map<string, { run: number; timestamp: number }>;
  alarmPlayback?: {
    tracker: ReturnType<typeof createClockTimerAlarmTracker>;
    eventIndex: number;
    timestamp: number;
    eventCount: number;
  };
}
const mountedClocks = new WeakMap<TransitionLogicMount, Map<string, MountedClock>>();

async function waitForImage(image: HTMLImageElement, signal: AbortSignal): Promise<void> {
  if (!image.complete)
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        image.removeEventListener('load', loaded);
        image.removeEventListener('error', failed);
        signal.removeEventListener('abort', failed);
      };
      const loaded = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error('An image failed to load or was disposed.'));
      };
      image.addEventListener('load', loaded, { once: true });
      image.addEventListener('error', failed, { once: true });
      signal.addEventListener('abort', failed, { once: true });
      if (signal.aborted) failed();
    });
  if (!image.naturalWidth) throw new Error('An image failed to decode.');
  await image.decode?.();
}

async function waitForImages(root: ParentNode, signal: AbortSignal): Promise<void> {
  await Promise.all(
    [...root.querySelectorAll('img')].map(async (image) => {
      if (image.getAttribute('src')) await waitForImage(image, signal);
    }),
  );
}

function loadFonts(document: Document, fonts: CompiledFontResource[]): Promise<unknown> {
  let entries = fontLoads.get(document);
  if (!entries) fontLoads.set(document, (entries = new Map()));
  const owner = document.defaultView as (Window & typeof globalThis) | null;
  return Promise.all(
    fonts.map((font) => {
      const key = JSON.stringify(font);
      let pending = entries!.get(key);
      if (!pending && owner?.FontFace) {
        const face = new owner.FontFace(font.family, `url(${JSON.stringify(font.source)})`, {
          weight: font.weight || '100 900',
          style: font.style || 'normal',
          display: 'block',
        });
        document.fonts.add(face);
        pending = face.load().catch((cause: unknown) => {
          document.fonts.delete(face);
          entries!.delete(key);
          throw new Error(`Unable to prepare font ${font.family}: ${String(cause)}`);
        });
        entries!.set(key, pending);
      }
      return pending;
    }),
  );
}

/** Moves changed layers out and back in around one data change. */
export interface TransitionLogicUpdateMotion {
  /** The length of a layer whose update transition and template name no length of their own. */
  fallbackFrames: number;
}

/** What a mounted template needs before it can show new data without a blank frame. */
export interface TransitionLogicDataStage {
  /** This change has to load something only a separate template host can prepare. */
  takeRequired: boolean;
  /** Images are still loading. `ready` settles when they finish, and rejects if one fails. */
  loading: boolean;
  ready: Promise<void>;
}

export interface TransitionLogicMount {
  host: HTMLDivElement;
  layerElement(id: string): HTMLElement | undefined;
  ready: Promise<void>;
  startFrame: number;
  /** Rebase an unused, Off-air resource probe before handing it to a real request. */
  prepareForTake?(frame: number, previousData?: Record<string, unknown>): void;
  setData(
    data: Record<string, unknown>,
    frame: number,
    skipAnimation?: boolean,
    motion?: TransitionLogicUpdateMotion,
  ): void;
  /** Load the resources this data needs while the current pixels stay on air. */
  stageData?(data: Record<string, unknown>): TransitionLogicDataStage;
  /** Settles when the data change and every layer's arrival have finished. */
  updateSettled?(): Promise<void>;
  /** Apply data still waiting for its layers to leave, and end their motion now. */
  finishUpdate?(frame: number): void;
  setOnAir(onAir: boolean, frame: number): void;
  handleKeyboardInput?(
    trigger: import('./runtimeKeyboard').RuntimeKeyboardTrigger,
    input: import('@ograf-editor/scene-model').VisualRuleKeyboardInput,
    frame: number,
  ): boolean;
  applySharedPointerPosition?(event: Pick<MouseEvent, 'clientX' | 'clientY'> | null): void;
  applySharedPointerEdge?(input: SharedGraphicPointerEdge, frame: number): boolean;
  inheritRules(
    previous: TransitionLogicMount,
    previousData: Record<string, unknown>,
    frame?: number,
  ): void;
  fireLifecycle(trigger: 'play' | 'step' | 'stop', frame: number, eventId?: string): void;
  customAction?(
    actionId: string,
    frame: number,
    skipAnimation?: boolean,
    executeTimer?: boolean,
  ): void;
  settleText(): void;
  waitReady(): Promise<void>;
  render(
    frame: number,
    shared: TransitionLogicSharedValue[],
    playing: boolean,
    lifecycle?: TransitionLogicLifecyclePose,
  ): void;
  controlLoop?(action: 'pause' | 'resume' | 'next', groupId: string, frame: number): boolean;
  getLoopGroups?(): { groupId: string; name: string; paused: boolean }[];
  /** Upcoming timer thresholds are replay boundaries, just like delayed Rules. */
  nextAlarmFrame?(after: number): number | undefined;
  observeTimerAlarms?(
    sourceLayerId: string,
    registrationId: string,
    alarms: readonly ClockTimerAlarmDefinition[],
    receive: (alarm: ClockTimerAlarmEvent, frame: number) => void,
  ): () => void;
  bindTimerAlarmSource?(
    proxyLayerId: string,
    canonical: TransitionLogicMount,
    sourceLayerId: string,
    registrationId: string,
  ): void;
  dispose(): void;
}

const MAX_STAGED_IMAGES = 8;
const MEDIA_CANVAS_SELECTOR = 'canvas[data-ograf-media-canvas="true"]';

function dataDrivenClockSettings(clock: NonNullable<TextElement['clock']>) {
  return {
    format: clock.format,
    timeZone: clock.timeZone,
    hourCycle: clock.hourCycle,
    showAmPm: clock.showAmPm,
    initialValueMs: clock.initialValueMs,
    endBehavior: clock.endBehavior,
  };
}

interface UpdatingLayer {
  motion: UpdateMotion;
  outStart: number;
  /** A layer interrupted while arriving leaves from where it was. */
  from: UpdateMotionSample;
  inStart: number | null;
}

export type RuntimePlayoutRuleAction = Extract<VisualRuleAction, { type: 'playout' }>;

/** Work is timed by the coordinator clock, including non-realtime schedule replay. */
export interface TransitionLogicRuleWork {
  id: string;
  frame: number;
  data: Record<string, unknown>;
  /** Pointer/hover cannot be regenerated by a non-realtime schedule. Record their commands. */
  pointer?: boolean;
  run(): RuntimePlayoutRuleAction[];
}

export function sharedLayerKey(instanceId: string, layerId: string): string {
  return JSON.stringify([instanceId, layerId]);
}

/** Each snapshot owns its DOM, rules and masks. Layer IDs never address another snapshot. */
export function mountTransitionLogicComposition(options: {
  parent: HTMLElement;
  descriptor: CompiledGraphicDescriptor;
  data: Record<string, unknown>;
  startFrame: number;
  clockEpoch?: number;
  /** A live coordinator can re-anchor its epoch after hidden startup resources become ready. */
  getClockEpoch?(): number;
  sharedKeys?: Map<string, string>;
  hiddenLayers?: Set<string>;
  deterministic?: boolean;
  previousData?: Record<string, unknown>;
  scheduleRule?(work: TransitionLogicRuleWork): void;
  /** Commit rule-driven data to the owning selection without replacing its animated DOM. */
  ruleDataChanged?(patch: Record<string, unknown>, frame: number): void;
  captureSharedPointer?(
    input: SharedGraphicPointerEdge,
    event: MouseEvent,
    position?: boolean,
  ): void;
}): TransitionLogicMount {
  const { parent, sharedKeys, hiddenLayers } = options;
  let data = options.data;
  let dataSignature = JSON.stringify(data);
  const document = parent.ownerDocument;
  const compiled = structuredClone(options.descriptor);
  const descriptor = expandRuntimeCollections(compiled);
  // A template made entirely of retained shared instances has no local pixels or geometry
  // dependants. Its real components already own masks, fonts, rules and animated content.
  // Do not build a second invisible copy on every Take or replay checkpoint.
  if (descriptor.layers.length && descriptor.layers.every((layer) => hiddenLayers?.has(layer.id))) {
    descriptor.layers = [];
    descriptor.fonts = [];
  }
  // A retained shared instance owns its rules; its invisible template proxies must not fire twice.
  for (const layer of descriptor.layers) if (hiddenLayers?.has(layer.id)) layer.visualRules = [];
  // Flat UI views have no hidden geometry dependencies. Keep the general path for scenes
  // containing layout, masks, paths or modifiers, and keep deterministic replay exhaustive.
  const skipHiddenSimpleVisuals =
    !options.deterministic &&
    descriptor.layers.every(
      (layer) =>
        !layer.clipParentId &&
        !layer.layoutParentId &&
        !layer.mask &&
        !layer.isMaskOnly &&
        !layer.motionPath &&
        !layer.modifiers?.length &&
        (!layer.autoLayout || layer.autoLayout.direction === 'none'),
    );
  const ids = new Set<string>();
  for (const layer of descriptor.layers) {
    if (ids.has(layer.id)) throw new Error(`Duplicate rendered layer ID: ${layer.id}`);
    ids.add(layer.id);
  }
  const host = document.createElement('div');
  host.className = 'ograf-transition-instance';
  host.style.cssText = `position:absolute;inset:0;isolation:isolate;overflow:hidden;pointer-events:none;width:${descriptor.crop?.width ?? descriptor.width}px;height:${descriptor.crop?.height ?? descriptor.height}px;`;
  // Preparation can await fonts for several frames. The coordinator reveals this host only
  // after its first authoritative active pose is rendered, never its constructor hold pose.
  host.style.visibility = 'hidden';
  const root = host.attachShadow({ mode: 'open' });
  const surface = document.createElement('div');
  surface.style.cssText = `position:absolute;left:${-(descriptor.crop?.x ?? 0)}px;top:${-(descriptor.crop?.y ?? 0)}px;width:${descriptor.width}px;height:${descriptor.height}px;overflow:hidden;pointer-events:none;background:${descriptor.backgroundColor};`;
  setCompositionBackdropRoot(surface, compositionHasBackdropBlur(descriptor.layers));
  root.append(surface);
  parent.append(host);
  const layerEls = new Map<string, HTMLElement>();
  const content = new Map<string, SceneElement>();
  const contentSignatures = new Map<string, string>();
  const deferredCharts = new Set<string>();
  const contentBindingKeys = new Map(
    descriptor.layers.map((layer) => [
      layer.id,
      (layer.bindings ?? (layer.binding ? [layer.binding] : [])).map((binding) => binding.dataKey),
    ]),
  );
  const contentInputs = new Map<
    string,
    {
      boundData: unknown[];
      collectionData?: Record<string, unknown>;
      effect: RuntimeVisualRuleEffect | undefined;
      startFrame: number;
      clockEpoch: number | undefined;
    }
  >();
  const systemClockLayers = new Set(
    descriptor.layers
      .filter(
        (layer) =>
          layer.element.type === 'text' &&
          layer.element.clock?.mode === 'clock' &&
          layer.element.clock.source !== 'manual',
      )
      .map((layer) => layer.id),
  );
  let contentVersion = 0;
  let readiness: { version: number; document: Document; promise: Promise<void> } | null = null;
  const animatedReadiness = descriptor.layers.some(
    (layer) =>
      layer.element.type === 'ticker' ||
      layer.element.type === 'lottie' ||
      layer.element.type === 'image-sequence' ||
      hasElementMediaPaint(layer.element),
  );
  const textStarts = new Map<string, number>();
  const chartHistory = new Map<string, ChartAnimationHistoryEntry[]>();
  const ownedChartEvents = new Map<string, ChartAnimationHistoryEntry>();
  const pendingChartReplay = new Set<string>();
  const customTextStarts = new Map<string, number>();
  const previousText = new Map<string, TextElement>();
  const clocks = new Map<string, MountedClock>();
  const ownedClockEvents = new Set<ClockTimerEvent>();
  const alarmObservers = new Map<
    string,
    {
      sourceLayerId: string;
      alarms: readonly ClockTimerAlarmDefinition[];
      receive: (alarm: ClockTimerAlarmEvent, frame: number) => void;
    }
  >();
  const unbindTimerAlarms: Array<() => void> = [];
  const canonicalClocks = new Map<string, { mount: TransitionLogicMount; sourceLayerId: string }>();
  let onAir = false;
  let everActivated = false;
  let dataActivated = false;
  let playedIn = false;
  let steppedIn = false;
  let previousRuleData = options.previousData;
  let currentFrame = options.startFrame;
  let settleTextRequested = false;
  const settledTexts = new Map<string, string>();
  const abort = new AbortController();
  // One data change at a time, driven by coordinator frames so that replay lands on the same pose.
  let dataUpdate: {
    pending: { data: Record<string, unknown>; signature: string } | null;
    /** The slowest changed layer has left, so the data changes for every layer here. */
    switchFrame: number;
    layers: Map<string, UpdatingLayer>;
    waiters: Array<() => void>;
  } | null = null;
  const stagedImages = new Map<
    string,
    { src: string; image: HTMLImageElement; loaded: boolean; ready: Promise<void> }
  >();
  const updateSampleHolds = new Map<string, Animation>();
  let startFrame = options.startFrame;
  let tickerOriginFrame = options.startFrame;
  let tickerInherited = false;
  const loopPlayback = new LoopPlaybackController();
  let currentLifecycle: TransitionLogicLifecyclePose | undefined;
  const holdFrame =
    descriptor.keyframes.find((key) => key.id === descriptor.stepKeyframeIds[0])?.frame ??
    descriptor.keyframes.find((key) => key.id === descriptor.startKeyframeId)?.frame ??
    0;
  const rules = new RuntimeVisualRules(
    descriptor.layers,
    descriptor.frameRate,
    (layer) =>
      sampleTransitionLogicLayerVisualState(
        descriptor,
        layer,
        sampleTransitionLogicLifecycle(descriptor, currentFrame, startFrame, currentLifecycle),
        data,
        { skipRulePose: true },
        (layer, elapsed, frame) =>
          onAir ? loopPlayback.sample(layer, elapsed, data, frame) : elapsed,
      ).transform,
  );
  rules.update(data, Number.NEGATIVE_INFINITY);
  rules.publish(Number.POSITIVE_INFINITY);
  let disposed = false;
  let fontDocument: Document | null = null;
  let fontsReady: Promise<unknown> = Promise.resolve();
  const clickTimers = new Set<ReturnType<typeof setTimeout>>();
  const sharedPointerEdges = new Map<string, (input: SharedGraphicPointerEdge) => boolean>();
  const updatePointer = (pointer: RuntimePointerPosition | null) => {
    if (disposed) return;
    const fired = rules.pointerChanged(onAir ? pointer : null, data);
    if (pointer && !rules.hasMouseConditions) return;
    const timestamp = (currentFrame * 1000) / descriptor.frameRate;
    rules.update(data, timestamp);
    rules.publish(timestamp);
    for (const layer of descriptor.layers) refreshContent(layer, layerEls.get(layer.id)!);
    if (onAir) scheduleRules(fired, currentFrame, true);
  };
  const disposePointer =
    !options.deterministic && options.scheduleRule
      ? bindRuntimePointerPosition({
          // The shared preview surface receives movement over both graphics and blank canvas.
          // Sibling on-air snapshots can read the same pointer without stealing each other's hits.
          target: parent,
          viewport: host,
          descriptor,
          enabled: () => !disposed && onAir && host.style.visibility !== 'hidden',
          changed: updatePointer,
        })
      : () => {};

  function scheduleRules(fired: FiredRuntimeVisualRule[], frame: number, pointer = false): void {
    if (!options.scheduleRule) return;
    const captured = structuredClone(data);
    for (const entry of fired) {
      const at = frame + (entry.rule.delayFrames ?? 0);
      options.scheduleRule({
        id: JSON.stringify([entry.hostLayerId, entry.rule.id]),
        frame: at,
        data: captured,
        ...(pointer ? { pointer: true } : {}),
        run() {
          // A delayed event must not act on a snapshot released by Out, Clear or replacement.
          if (disposed) return [];
          const actions = rules.run(entry);
          const latest = dataUpdate?.pending?.data ?? data;
          let patch: Record<string, unknown> | null = null;
          for (const action of actions) {
            if (action.type !== 'set-data' || !action.dataKey) continue;
            patch ??= {};
            patch[action.dataKey] = visualRuleSetDataValue(
              action,
              Object.hasOwn(patch, action.dataKey) ? patch[action.dataKey] : latest[action.dataKey],
            );
          }
          if (patch) {
            mount.setData({ ...latest, ...patch }, at);
            options.ruleDataChanged?.(patch, at);
          }
          const commands: RuntimePlayoutRuleAction[] = [];
          const actionIds = new Set<string>();
          for (const action of actions) {
            if (action.type === 'playout') commands.push(action);
            else if (action.type === 'custom-action') actionIds.add(action.actionId);
            else if (action.type !== 'set-data')
              throw new Error(`Coordinated Rules do not support ${action.type} actions.`);
          }
          rules.update(data, (at * 1000) / descriptor.frameRate);
          rules.publish((at * 1000) / descriptor.frameRate);
          for (const layer of descriptor.layers) refreshContent(layer, layerEls.get(layer.id)!);
          for (const actionId of actionIds) mount.customAction!(actionId, at);
          Object.assign(captured, data);
          return commands;
        },
      });
    }
  }

  function ensureFonts(): Promise<unknown> {
    // A docked preview can be adopted into a detached window. FontFaceSet belongs to its
    // document, so the original window's loaded fonts alone do not cover the new surface.
    const owner = host.ownerDocument;
    if (fontDocument !== owner) {
      fontDocument = owner;
      fontsReady = loadFonts(owner, descriptor.fonts ?? []).then(() => owner.fonts.ready);
    }
    return fontsReady;
  }

  function resolveContent(
    layer: (typeof descriptor.layers)[number],
    clockEpoch?: number,
  ): SceneElement {
    let resolved = resolveBoundElement(layer, data);
    if (
      resolved.type === 'text' &&
      resolved.clock?.mode === 'clock' &&
      resolved.clock.source !== 'manual'
    )
      resolved = {
        ...resolved,
        clock: {
          ...resolved.clock,
          referenceTimeMs:
            (clockEpoch ?? options.clockEpoch ?? resolved.clock.referenceTimeMs) +
            (mount.startFrame * 1000) / descriptor.frameRate,
        },
      };
    return resolved;
  }

  function refreshContent(layer: (typeof descriptor.layers)[number], element: HTMLElement): void {
    const effect = visualRuleEffectFor(layer, data);
    const inputs = contentInputs.get(layer.id);
    const clockEpoch = systemClockLayers.has(layer.id)
      ? (options.getClockEpoch?.() ?? options.clockEpoch)
      : undefined;
    const visible =
      visualRuleLayerVisible(layer, data) && isRuntimeCollectionLayerActive(layer, data);
    const revealChart = deferredCharts.has(layer.id) && visible;
    const boundData = (contentBindingKeys.get(layer.id) ?? []).map((key) => data[key]);
    // Published Rules retain their effect identity between changes; geometry-only frame
    // sampling does not require cloning bindings and serializing static text every tick.
    if (
      inputs &&
      (!layer.collectionItem || inputs.collectionData === data) &&
      inputs.boundData.length === boundData.length &&
      inputs.boundData.every((value, index) => Object.is(value, boundData[index])) &&
      inputs.effect === effect &&
      inputs.startFrame === startFrame &&
      inputs.clockEpoch === clockEpoch &&
      !revealChart
    )
      return;
    contentInputs.set(layer.id, {
      boundData,
      ...(layer.collectionItem ? { collectionData: data } : {}),
      effect,
      startFrame,
      clockEpoch,
    });
    const resolved = resolveContent(layer, clockEpoch);
    const signature = JSON.stringify(resolved);
    const changed = contentSignatures.get(layer.id) !== signature;
    if (!changed && !revealChart) return;
    const old =
      content.get(layer.id) ??
      (options.previousData ? resolveBoundElement(layer, options.previousData) : null);
    if (changed && old?.type === 'text' && resolved.type === 'text' && !resolved.clock) {
      previousText.set(layer.id, old);
      textStarts.set(layer.id, currentFrame);
      if (normalizeTextAnimation(resolved.textAnimation).replayOnUpdate)
        customTextStarts.set(layer.id, currentFrame);
    }
    if (changed && resolved.type === 'chart') {
      const history = chartHistory.get(layer.id) ?? [];
      const dataChanged =
        old?.type === 'chart' && JSON.stringify(old.data) !== JSON.stringify(resolved.data);
      if (!history.length) {
        const entry = { frame: startFrame, element: resolved, reset: true };
        history.push(entry);
        ownedChartEvents.set(layer.id, entry);
        chartHistory.set(layer.id, history);
      } else if (dataChanged) {
        const animation = normalizeChartAnimation(resolved.animation);
        const event = {
          frame: currentFrame,
          element: resolved,
          skip: settleTextRequested || !animation.replayOnUpdate || animation.type === 'none',
        };
        history.push(event);
        if (!options.deterministic) compactSettledChartAnimationHistory(history);
        ownedChartEvents.set(layer.id, event);
        if (animation.updateMode === 'morph') pendingChartReplay.add(layer.id);
      } else {
        // A hidden data update may still be waiting to replay when paint/style changes.
        // Keep its latest configuration with the original data-event timestamp, so reveal
        // cannot restore the older paint or restart the morph clock.
        history.at(-1)!.element = resolved;
      }
      if (
        old?.type === 'chart' &&
        (old.preset !== resolved.preset ||
          JSON.stringify(old.provider) !== JSON.stringify(resolved.provider))
      ) {
        // Geometry from another renderer/preset is not a valid morph origin for this one.
        // Keep the latest data pose and its time, and start reconstruction at this boundary.
        history.splice(0, history.length - 1);
        history[0]!.reset = true;
      }
    }
    if (changed && resolved.type === 'text' && resolved.clock && !hiddenLayers?.has(layer.id)) {
      // What the clock displays can change from data on air without restarting a running timer.
      const signature = JSON.stringify({
        ...resolved.clock,
        manualValue: undefined,
        format: undefined,
        timeZone: undefined,
        hourCycle: undefined,
        showAmPm: undefined,
        initialValueMs: undefined,
        endBehavior: undefined,
      });
      const existing = clocks.get(layer.id);
      const timestamp =
        (Math.max(0, currentFrame - mount.startFrame) * 1000) / descriptor.frameRate;
      if (!existing || existing.signature !== signature) {
        clocks.set(layer.id, {
          base: resolved,
          signature,
          originFrame: mount.startFrame,
          onAir,
          firedAlarms: new Map(),
          events: onAir ? [{ timestamp, command: 'take-in' }] : [],
        });
      } else {
        const timestamp =
          (Math.max(0, currentFrame - existing.originFrame) * 1000) / descriptor.frameRate;
        if (
          old?.type === 'text' &&
          old.clock &&
          JSON.stringify(dataDrivenClockSettings(old.clock)) !==
            JSON.stringify(dataDrivenClockSettings(resolved.clock))
        )
          existing.events.push({
            timestamp,
            command: 'set-settings',
            settings: dataDrivenClockSettings(resolved.clock),
          });
        if (old?.type === 'text' && old.clock?.manualValue !== resolved.clock.manualValue)
          existing.events.push({
            timestamp,
            command: 'set-value',
            value: resolved.clock.manualValue,
          });
      }
    }
    content.set(layer.id, resolved);
    contentSignatures.set(layer.id, signature);
    contentVersion += 1;
    // Keep data, Rules and animation history current, but do not redraw an already prepared
    // hidden chart on every feed update. A reveal flushes its latest content before painting.
    // Initial resource preparation and shared proxies retain their existing readiness paths.
    if (
      resolved.type === 'chart' &&
      old?.type === 'chart' &&
      !visible &&
      chartUpdateChangesDataOnly(old, resolved) &&
      !hiddenLayers?.has(layer.id)
    ) {
      deferredCharts.add(layer.id);
      return;
    }
    deferredCharts.delete(layer.id);
    const stagedKey =
      resolved.type === 'image' && resolved.src ? stagedImageKey(layer.id, resolved.src) : '';
    const staged = stagedImages.get(stagedKey);
    if (staged?.loaded) stagedImages.delete(stagedKey);
    renderElementContent(element, resolved, 0, {
      timestampMs: (Math.max(0, currentFrame - tickerOriginFrame) * 1000) / descriptor.frameRate,
      frameRate: descriptor.frameRate,
      rendererPlugins: descriptor.rendererPlugins,
      chartMarkAnimations: layer.chartMarkAnimations,
      ...(staged?.loaded ? { stagedImage: staged } : {}),
      ...(resolved.type === 'lottie'
        ? { lottieBackingSize: lottieBackingSizeForLayer(layer) }
        : {}),
      ...(hasElementShaderPaint(resolved) || hasElementMediaPaint(resolved)
        ? {
            shaderBackingSize: shaderBackingSizeForLayer(layer),
            shaderStrokePadding: shaderStrokePaddingForLayer(layer),
          }
        : {}),
    });
  }

  function stagedImageKey(layerId: string, src: string): string {
    return JSON.stringify([layerId, src]);
  }

  function applyData(
    next: Record<string, unknown>,
    signature: string,
    frame: number,
    skipAnimation: boolean,
  ): void {
    const previous = data;
    data = next;
    currentFrame = frame;
    settleTextRequested = skipAnimation;
    dataSignature = signature;
    // A data edit releases only overrides whose conditions stopped matching. Other event
    // overrides remain on the retained instance, just as they do in a standalone graphic.
    const fired = rules.dataChanged(previous, data);
    rules.update(data, (frame * 1000) / descriptor.frameRate);
    rules.publish((frame * 1000) / descriptor.frameRate);
    for (const layer of descriptor.layers) refreshContent(layer, layerEls.get(layer.id)!);
    if (onAir) scheduleRules(fired, frame);
  }

  /** The layers an update moves and how. Layers that only read the data in a Rule stay at rest. */
  function changedLayerMotions(
    next: Record<string, unknown>,
    fallbackFrames: number,
  ): Map<string, UpdateMotion> {
    const motions = new Map<string, UpdateMotion>();
    for (const layer of descriptor.layers) {
      if (hiddenLayers?.has(layer.id)) continue;
      const after = resolveBoundElement(layer, next);
      if (after.type === 'audio') continue;
      const collectionChanged =
        isRuntimeCollectionLayerActive(layer, data) !== isRuntimeCollectionLayerActive(layer, next);
      if (!collectionChanged && !visualRuleLayerVisible(layer, data)) continue;
      const change = classifyElementDataChange(resolveBoundElement(layer, data), after);
      const transition = layer.updateTransition;
      const changed =
        collectionChanged ||
        change === 'content' ||
        change === 'image' ||
        change === 'resource' ||
        (change === 'uniforms' && !!transition && transition.style !== 'inherit') ||
        (layer.bindings ?? (layer.binding ? [layer.binding] : [])).some(
          (binding) =>
            layerTransformBindingChannel(binding.targetProperty) &&
            JSON.stringify(data[binding.dataKey]) !== JSON.stringify(next[binding.dataKey]),
        );
      if (!changed) continue;
      const motion = resolveUpdateMotion(
        transition,
        descriptor.updateTransitionFrames || (animatesItsOwnUpdate(after) ? 0 : fallbackFrames),
        descriptor.frameRate,
      );
      if (motion) motions.set(layer.id, motion);
    }
    return motions;
  }

  function updatePose(state: UpdatingLayer, frame: number): UpdateMotionSample {
    const elapsed = (start: number) => ((frame - start) * 1000) / descriptor.frameRate;
    if (state.inStart !== null) return sampleUpdateMotion(state.motion, elapsed(state.inStart), 0);
    const leaving = sampleUpdateMotion(
      state.motion,
      elapsed(state.outStart),
      Number.POSITIVE_INFINITY,
    );
    const away = 1 - leaving.opacity;
    return {
      opacity: state.from.opacity * leaving.opacity,
      x: state.from.x + (state.motion.x - state.from.x) * away,
      y: state.from.y + (state.motion.y - state.from.y) * away,
    };
  }

  /** Start changed layers leaving. Layers already leaving keep going; false if none has to move. */
  function startLeaving(frame: number, motions: Map<string, UpdateMotion>): boolean {
    if (!motions.size) return !!dataUpdate?.pending;
    dataUpdate ??= { pending: null, switchFrame: frame, layers: new Map(), waiters: [] };
    if (!dataUpdate.pending) dataUpdate.switchFrame = frame;
    for (const [id, motion] of motions) {
      const existing = dataUpdate.layers.get(id);
      if (existing && existing.inStart === null) continue;
      dataUpdate.layers.set(id, {
        motion,
        outStart: frame,
        from: existing ? updatePose(existing, frame) : { opacity: 1, x: 0, y: 0 },
        inStart: null,
      });
      dataUpdate.switchFrame = Math.max(
        dataUpdate.switchFrame,
        frame + (motion.halfMs * descriptor.frameRate) / 1000,
      );
    }
    return true;
  }

  function updateContent(id: string): HTMLElement | undefined {
    return [...(layerEls.get(id)?.children ?? [])].find(
      (child) => child.getAttribute('data-ograf-runtime-auxiliary') !== 'true',
    ) as HTMLElement | undefined;
  }

  function clearUpdatePose(id: string): void {
    const content = updateContent(id);
    if (content) {
      // A shader stack owns its hidden input's inline opacity, including after an update ends.
      if (updateMotionTargets(id).includes(content)) content.style.opacity = '';
      // `translate` composes with the squeeze and baseline shift text keeps in `transform`.
      content.style.translate = '';
    }
    updateSampleHolds.get(id)?.cancel();
    updateSampleHolds.delete(id);
  }

  function updateMotionTargets(id: string): HTMLElement[] {
    const host = layerEls.get(id);
    const content = updateContent(id);
    if (!host || !content) return [];
    const output = ([...host.children] as HTMLElement[]).find(
      (child) => child.dataset.ografShaderEffectOutput === 'true',
    );
    if (!output) return [content];
    // Media captures its canvas directly, so its visible stroke/base content moves too. Other
    // stacks capture the content itself: changing that input's opacity would capture a blank.
    return host.querySelectorAll(MEDIA_CANVAS_SELECTOR).length ? [content, output] : [output];
  }

  function finishDataUpdate(frame: number, skipAnimation: boolean): void {
    if (!dataUpdate) return;
    const update = dataUpdate;
    dataUpdate = null;
    for (const id of update.layers.keys()) clearUpdatePose(id);
    if (update.pending)
      applyData(update.pending.data, update.pending.signature, frame, skipAnimation);
    for (const resolve of update.waiters) resolve();
  }

  function applyDueData(frame: number): void {
    if (!dataUpdate?.pending || frame < dataUpdate.switchFrame) return;
    const { data: next, signature } = dataUpdate.pending;
    const at = dataUpdate.switchFrame;
    dataUpdate.pending = null;
    for (const state of dataUpdate.layers.values()) state.inStart ??= at;
    applyData(next, signature, at, false);
  }

  function poseDataUpdate(frame: number): void {
    if (!dataUpdate) return;
    for (const [id, state] of dataUpdate.layers) {
      const arrived =
        state.inStart !== null &&
        ((frame - state.inStart) * 1000) / descriptor.frameRate >= state.motion.halfMs;
      if (arrived) {
        clearUpdatePose(id);
        dataUpdate.layers.delete(id);
        continue;
      }
      const content = updateContent(id);
      if (!content) continue;
      const pose = updatePose(state, frame);
      const targets = updateMotionTargets(id);
      const translate = `${pose.x}px ${pose.y}px`;
      if (targets.includes(content)) content.style.opacity = String(pose.opacity);
      content.style.translate = targets.includes(content) ? translate : '';
      updateSampleHolds.get(id)?.cancel();
      updateSampleHolds.delete(id);
      const output = targets.find((target) => target !== content);
      if (output) {
        // Effect commits refresh inline output opacity asynchronously. A sampled animation hold
        // keeps the coordinator's pose above those writes, while retaining the effect's blend.
        const sample = { opacity: Number(output.style.opacity || 1) * pose.opacity, translate };
        updateSampleHolds.set(
          id,
          output.animate([sample, sample], { duration: 0, fill: 'forwards' }),
        );
      }
    }
    if (!dataUpdate.pending && !dataUpdate.layers.size) finishDataUpdate(frame, false);
  }

  function mountContent(): void {
    for (const layer of descriptor.layers) {
      const element = document.createElement('div');
      element.style.cssText =
        'position:absolute;left:0;top:0;box-sizing:border-box;pointer-events:none;';
      element.dataset.transitionLayerId = layer.id;
      element.dataset.ografLayerName = layer.name ?? 'Ticker';
      element.style.mixBlendMode = layer.blendMode ?? 'normal';
      const pose = sampleCompiledLayerVisualState(layer, holdFrame, undefined, data);
      element.style.width = `${pose.transform.width}px`;
      element.style.height = `${pose.transform.height}px`;
      surface.append(element);
      layerEls.set(layer.id, element);
      refreshContent(layer, element);
      const triggers = pointerVisualRuleTriggers(layer, rules.engine);
      const hasHover = triggers.has('hover');
      if (options.scheduleRule && !options.deterministic && (triggers.size || hasHover)) {
        element.style.pointerEvents = 'auto';
        if (
          triggers.has('click') ||
          triggers.has('double-click') ||
          triggers.has('pointer-down') ||
          triggers.has('pointer-up')
        )
          element.style.cursor = 'pointer';
        const interactive = () =>
          !disposed &&
          onAir &&
          host.style.opacity !== '0' &&
          element.style.opacity !== '0' &&
          element.style.display !== 'none' &&
          element.style.visibility !== 'hidden';
        const fire = (
          trigger:
            | 'click'
            | 'double-click'
            | 'pointer-enter'
            | 'pointer-leave'
            | 'pointer-down'
            | 'pointer-up',
          relatedHostLayerId?: string,
          replay = false,
        ) => {
          if (!replay && !interactive()) return;
          scheduleRules(
            rules.eventFired(trigger, data, {
              hostLayerId: layer.id,
              ...(relatedHostLayerId ? { relatedHostLayerId } : {}),
            }),
            currentFrame,
            true,
          );
        };
        const capture = (
          type: SharedGraphicPointerEdge['type'],
          event: MouseEvent,
          relatedLayerId?: string,
          position?: boolean,
        ) => {
          if (interactive())
            options.captureSharedPointer?.(
              {
                type,
                target: { layerId: layer.id },
                ...(relatedLayerId ? { relatedLayerId } : {}),
              },
              event,
              position,
            );
        };
        element.addEventListener('click', (event) => {
          if (event.detail > 1) return;
          if (!triggers.has('click')) return;
          if (triggers.has('double-click')) {
            const timer = setTimeout(() => {
              clickTimers.delete(timer);
              capture('click', event, undefined, false);
              fire('click');
            }, 500);
            clickTimers.add(timer);
          } else {
            capture('click', event);
            fire('click');
          }
        });
        element.addEventListener('dblclick', (event) => {
          for (const timer of clickTimers) clearTimeout(timer);
          clickTimers.clear();
          capture('double-click', event);
          fire('double-click');
        });
        let hovered = false;
        const hover = (next: boolean, relatedHostLayerId?: string) => {
          if (hovered === next || (next && !hasHover)) return;
          hovered = next;
          rules.hoverChanged(layer.id, next, data, relatedHostLayerId);
          rules.update(data, (currentFrame * 1000) / descriptor.frameRate);
          if (next) scheduleRules(rules.hoverEntered(layer.id, data), currentFrame, true);
        };
        element.addEventListener('pointerenter', (event) => {
          if (!interactive()) return;
          const relatedHostLayerId = runtimeRelatedLayerId(event, layerEls);
          capture('pointer-enter', event, relatedHostLayerId);
          hover(true, relatedHostLayerId);
          fire('pointer-enter', relatedHostLayerId);
        });
        element.addEventListener('pointerleave', (event) => {
          const relatedHostLayerId = runtimeRelatedLayerId(event, layerEls);
          capture('pointer-exit', event, relatedHostLayerId, false);
          hover(false, relatedHostLayerId);
          fire('pointer-leave', relatedHostLayerId);
        });
        let pressed = false;
        element.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          pressed = true;
          if (triggers.has('pointer-up')) element.setPointerCapture?.(event.pointerId);
          capture('pointer-down', event);
          fire('pointer-down');
        });
        element.addEventListener('pointerup', (event) => {
          if (event.button !== 0 || !pressed) return;
          pressed = false;
          capture('pointer-up', event);
          fire('pointer-up');
        });
        element.addEventListener('pointercancel', (event) => {
          if (pressed) capture('pointer-cancel', event, undefined, false);
          pressed = false;
        });
        sharedPointerEdges.set(layer.id, (input) => {
          switch (input.type) {
            case 'pointer-enter':
            case 'pointer-exit':
              hover(input.type === 'pointer-enter', input.relatedLayerId);
              fire(
                input.type === 'pointer-enter' ? 'pointer-enter' : 'pointer-leave',
                input.relatedLayerId,
                true,
              );
              break;
            case 'pointer-down':
              pressed = true;
              fire(input.type, undefined, true);
              break;
            case 'pointer-up':
              if (!pressed) return false;
              pressed = false;
              fire(input.type, undefined, true);
              break;
            case 'pointer-cancel':
              pressed = false;
              break;
            default:
              fire(input.type, undefined, true);
          }
          return true;
        });
      }
    }
  }

  function sampleTimerAlarms(frame: number): void {
    if (onAir && options.scheduleRule)
      for (const [id, clock] of clocks) {
        const settings = normalizeClockTimerSettings(clock.base.clock);
        const elapsed = (Math.max(0, frame - clock.originFrame) * 1000) / descriptor.frameRate;
        const forwarded = [...alarmObservers.entries()]
          .filter(([, observer]) => observer.sourceLayerId === id)
          .flatMap(([registration, observer]) =>
            observer.alarms.map((alarm) => ({
              ...alarm,
              id: JSON.stringify([registration, alarm.id]),
              originalId: alarm.id,
              receive: observer.receive,
            })),
          );
        const alarms = [...compiledTimerAlarms(descriptor.layers, id), ...forwarded];
        const active = new Set(
          alarms.map((alarm) => JSON.stringify([alarm.ownerLayerId, alarm.id])),
        );
        for (const key of clock.firedAlarms.keys())
          if (!active.has(key)) clock.firedAlarms.delete(key);
        if (!alarms.length) {
          clock.alarmPlayback?.tracker.setAlarms([], true);
          continue;
        }
        let playback = clock.alarmPlayback;
        const previousTime = playback?.timestamp ?? 0;
        if (
          !playback ||
          playback.timestamp > elapsed ||
          clock.events.slice(playback.eventCount).some((event) => event.timestamp < previousTime)
        ) {
          playback = clock.alarmPlayback = {
            tracker: createClockTimerAlarmTracker(settings, alarms, true),
            eventIndex: 0,
            timestamp: 0,
            eventCount: clock.events.length,
          };
        }
        playback.tracker.setAlarms(alarms, true);
        const crossings = [];
        while (
          playback.eventIndex < clock.events.length &&
          clock.events[playback.eventIndex]!.timestamp <= elapsed
        )
          crossings.push(
            ...playback.tracker.command(
              clock.events[playback.eventIndex++]!,
              !options.deterministic,
            ),
          );
        crossings.push(...playback.tracker.advanceTo(elapsed, !options.deterministic));
        playback.timestamp = elapsed;
        playback.eventCount = clock.events.length;
        const newlyCrossed = crossings.filter((alarm) => {
          const identity = JSON.stringify([alarm.ownerLayerId, alarm.id]);
          const previous = clock.firedAlarms.get(identity);
          if (
            previous &&
            (previous.run > alarm.run ||
              (previous.run === alarm.run && previous.timestamp >= alarm.timestamp))
          )
            return false;
          clock.firedAlarms.set(identity, { run: alarm.run, timestamp: alarm.timestamp });
          return true;
        });
        const zero =
          !options.deterministic &&
          newlyCrossed.some(
            (alarm) =>
              alarm.valueMs === 0 &&
              alarms.some(
                (definition) => definition.id === alarm.id && definition.direction === 'down',
              ),
          );
        for (const alarm of newlyCrossed) {
          if (zero && alarm.valueMs !== 0) continue;
          const at = clock.originFrame + (alarm.timestamp * descriptor.frameRate) / 1000;
          const subscriber = forwarded.find(
            (entry) => entry.id === alarm.id && entry.ownerLayerId === alarm.ownerLayerId,
          );
          if (subscriber) {
            subscriber.receive({ ...alarm, id: subscriber.originalId }, at);
            continue;
          }
          scheduleRules(
            rules.eventFired('timer-alarm', data, {
              hostLayerId: id,
              eventId: alarm.id,
              ...(alarm.ownerLayerId === undefined
                ? {}
                : { timerAlarmOwnerLayerId: alarm.ownerLayerId }),
            }),
            at,
          );
        }
      }
  }

  const mount: TransitionLogicMount = {
    host,
    layerElement: (id) => layerEls.get(id),
    applySharedPointerPosition(event) {
      if (!disposed && onAir && !options.deterministic && options.scheduleRule)
        updatePointer(event ? runtimePointerPosition(host, descriptor, event) : null);
    },
    applySharedPointerEdge(input, frame) {
      if (disposed || !onAir || options.deterministic || !options.scheduleRule) return false;
      currentFrame = frame;
      return sharedPointerEdges.get(input.target.layerId)?.(input) ?? false;
    },
    get startFrame() {
      return startFrame;
    },
    set startFrame(frame) {
      const delta = frame - startFrame;
      startFrame = frame;
      currentFrame = frame;
      for (const [id, start] of textStarts) textStarts.set(id, start + delta);
      for (const entry of ownedChartEvents.values()) entry.frame += delta;
      for (const clock of clocks.values()) if (!clock.inherited) clock.originFrame += delta;
      if (!tickerInherited) tickerOriginFrame += delta;
      for (const event of ownedClockEvents)
        event.timestamp += (delta * 1000) / descriptor.frameRate;
      for (const layer of descriptor.layers) refreshContent(layer, layerEls.get(layer.id)!);
    },
    ready: Promise.resolve(),
    prepareForTake(frame, before) {
      if (disposed || everActivated)
        throw new Error('Only an unused prepared instance can be adopted.');
      previousRuleData = before;
      mount.startFrame = frame;
      // A speculative mount has no predecessor. Supply the actual predecessor now so text
      // update FX and data-entry Rules match an ordinary request made at this same frame.
      if (before)
        for (const layer of descriptor.layers) {
          const previous = resolveBoundElement(layer, before);
          const next = content.get(layer.id);
          if (
            previous.type === 'text' &&
            next?.type === 'text' &&
            !next.clock &&
            JSON.stringify(previous) !== JSON.stringify(next)
          ) {
            previousText.set(layer.id, previous);
            textStarts.set(layer.id, frame);
            if (normalizeTextAnimation(next.textAnimation).replayOnUpdate)
              customTextStarts.set(layer.id, frame);
          }
        }
    },
    inheritRules(previous, previousData, committedFrame = currentFrame) {
      // The successor inherits a finished state, not one still waiting for its layers to leave.
      previous.finishUpdate?.(committedFrame);
      const previousTickers = mountedTickers.get(previous);
      if (previousTickers) {
        tickerOriginFrame = previousTickers.origin();
        tickerInherited = true;
        for (const layer of descriptor.layers)
          if (layer.element.type === 'ticker') {
            const before = previousTickers.layers.get(layer.id);
            const after = layerEls.get(layer.id);
            if (before && after)
              inheritTickerPlayback(
                before,
                after,
                (Math.max(0, committedFrame - tickerOriginFrame) * 1000) / descriptor.frameRate,
              );
          }
        contentVersion++;
      }
      const previousLoops = mountedLoops.get(previous);
      if (previousLoops) loopPlayback.inherit(previousLoops);
      const previousClocks = mountedClocks.get(previous);
      for (const [id, clock] of clocks) {
        const before = previousClocks?.get(id);
        if (!before || before.signature !== clock.signature || clock.base.clock?.mode === 'clock')
          continue;
        clock.events = before.events.map((event) => ({ ...event }));
        clock.originFrame = before.originFrame;
        clock.inherited = true;
        clock.onAir = before.onAir;
        clock.firedAlarms = new Map(before.firedAlarms);
        // Settings and manual values share the command history. Preserve its original baseline
        // while keeping the successor's current artwork and timed data updates.
        clock.base = {
          ...clock.base,
          clock: { ...before.base.clock! },
        };
        const nextValue = content.get(id);
        const previousValue = resolveBoundElement(
          descriptor.layers.find((layer) => layer.id === id)!,
          previousData,
        );
        if (
          nextValue?.type === 'text' &&
          nextValue.clock &&
          previousValue.type === 'text' &&
          previousValue.clock &&
          JSON.stringify(dataDrivenClockSettings(nextValue.clock)) !==
            JSON.stringify(dataDrivenClockSettings(previousValue.clock))
        ) {
          const event: ClockTimerEvent = {
            timestamp: (Math.max(0, startFrame - clock.originFrame) * 1000) / descriptor.frameRate,
            command: 'set-settings',
            settings: dataDrivenClockSettings(nextValue.clock),
          };
          clock.events.push(event);
          ownedClockEvents.add(event);
        }
        if (
          nextValue?.type === 'text' &&
          previousValue.type === 'text' &&
          nextValue.clock?.manualValue !== previousValue.clock?.manualValue
        ) {
          const event: ClockTimerEvent = {
            timestamp: (Math.max(0, startFrame - clock.originFrame) * 1000) / descriptor.frameRate,
            command: 'set-value',
            value: nextValue.clock!.manualValue,
          };
          clock.events.push(event);
          ownedClockEvents.add(event);
        }
      }
      const previousCharts = mountedCharts.get(previous);
      for (const layer of descriptor.layers) {
        const element = content.get(layer.id);
        const history = previousCharts?.get(layer.id);
        if (
          element?.type !== 'chart' ||
          element.animation?.updateMode !== 'morph' ||
          !history?.length
        )
          continue;
        const entries = history.map((entry) => ({
          ...entry,
          element: structuredClone(entry.element),
        }));
        if (JSON.stringify(entries.at(-1)!.element.data) !== JSON.stringify(element.data)) {
          const entry = { frame: startFrame, element };
          entries.push(entry);
          ownedChartEvents.set(layer.id, entry);
        }
        chartHistory.set(layer.id, entries);
        if (!options.deterministic) compactSettledChartAnimationHistory(entries);
        pendingChartReplay.add(layer.id);
      }
      const previousRules = mountedRules.get(previous);
      if (!previousRules || disposed) return;
      rules.inheritEventOverrides(previousRules, previousData, data);
      rules.update(data, Number.NEGATIVE_INFINITY);
      rules.publish(Number.POSITIVE_INFINITY);
      for (const layer of descriptor.layers) refreshContent(layer, layerEls.get(layer.id)!);
    },
    setData(next, frame, skipAnimation = false, motion) {
      const signature = JSON.stringify(next);
      if (disposed) return;
      if (skipAnimation) finishDataUpdate(frame, true);
      if ((dataUpdate?.pending?.signature ?? dataSignature) === signature) return;
      // Validate bound charts and guarded path text before committing any operator update.
      for (const layer of descriptor.layers)
        if (layer.element.type === 'chart' || layer.textPath) resolveBoundElement(layer, next);
      // Data that arrives while layers are leaving takes the place of what they are leaving for.
      if (
        !skipAnimation &&
        startLeaving(
          frame,
          motion && onAir ? changedLayerMotions(next, motion.fallbackFrames) : new Map(),
        )
      ) {
        dataUpdate!.pending = { data: next, signature };
        currentFrame = frame;
        return;
      }
      applyData(next, signature, frame, skipAnimation);
    },
    stageData(next) {
      const stage = { takeRequired: false, loading: false, ready: Promise.resolve() };
      if (disposed) return stage;
      const latest = dataUpdate?.pending?.data ?? data;
      const loads: Promise<void>[] = [];
      const changes = descriptor.layers.map((layer) => {
        const before = resolveBoundElement(layer, latest);
        const after = resolveBoundElement(layer, next);
        const change = classifyElementDataChange(before, after);
        return { layer, after, change };
      });
      // A single update can change more than eight images. Keep its entire batch, plus images an
      // earlier pending data swap still needs, until rendering adopts them. The fixed cache cap
      // applies to obsolete candidates, not resources required by the current transaction.
      const requiredImages = new Set(
        changes.flatMap(({ layer, after, change }) =>
          change === 'image' && after.type === 'image' && after.src
            ? [stagedImageKey(layer.id, after.src)]
            : [],
        ),
      );
      if (dataUpdate?.pending)
        for (const layer of descriptor.layers) {
          const pending = resolveBoundElement(layer, dataUpdate.pending.data);
          if (pending.type === 'image' && pending.src)
            requiredImages.add(stagedImageKey(layer.id, pending.src));
        }
      for (const { layer, after, change } of changes) {
        // A hidden proxy shows nothing. Its shared instance answers for the same resources.
        if (change === 'resource' && !hiddenLayers?.has(layer.id)) stage.takeRequired = true;
        if (change !== 'image' || after.type !== 'image' || !after.src) continue;
        const key = stagedImageKey(layer.id, after.src);
        let staged = stagedImages.get(key);
        if (!staged) {
          const image = host.ownerDocument.createElement('img');
          image.src = after.src;
          const entry = { src: after.src, image, loaded: false, ready: Promise.resolve() };
          entry.ready = waitForImage(image, abort.signal).then(
            () => {
              entry.loaded = true;
            },
            (cause: unknown) => {
              // A later attempt loads it afresh, because the source may recover.
              if (stagedImages.get(key) === entry) stagedImages.delete(key);
              throw cause;
            },
          );
          void entry.ready.catch(() => undefined);
          stagedImages.set(key, entry);
          staged = entry;
        }
        if (!staged.loaded) loads.push(staged.ready);
      }
      const limit = Math.max(
        MAX_STAGED_IMAGES,
        [...stagedImages.keys()].filter((key) => requiredImages.has(key)).length,
      );
      for (const key of stagedImages.keys()) {
        if (stagedImages.size <= limit) break;
        if (!requiredImages.has(key)) stagedImages.delete(key);
      }
      if (loads.length) {
        stage.loading = true;
        stage.ready = Promise.all(loads).then(() => undefined);
      }
      return stage;
    },
    updateSettled() {
      const update = dataUpdate;
      return update
        ? new Promise<void>((resolve) => update.waiters.push(resolve))
        : Promise.resolve();
    },
    finishUpdate(frame) {
      finishDataUpdate(frame, false);
    },
    setOnAir(next, frame) {
      if (next === onAir || disposed) return;
      onAir = next;
      if (next) everActivated = true;
      for (const clock of clocks.values()) {
        if (clock.onAir === next) continue;
        clock.onAir = next;
        clock.events.push({
          timestamp: (Math.max(0, frame - clock.originFrame) * 1000) / descriptor.frameRate,
          command: next ? 'take-in' : 'take-out',
        });
      }
      if (!next) {
        finishDataUpdate(frame, false);
        loopPlayback.clear();
        rules.pointerChanged(null, data);
        rules.update(data, (frame * 1000) / descriptor.frameRate);
        rules.publish((frame * 1000) / descriptor.frameRate);
        dataActivated = false;
        playedIn = false;
        steppedIn = false;
      }
      if (next && !dataActivated) {
        dataActivated = true;
        scheduleRules(
          previousRuleData ? rules.dataChanged(previousRuleData, data) : rules.dataEntered(data),
          frame,
        );
        previousRuleData = undefined;
      }
    },
    handleKeyboardInput(trigger, input, frame) {
      if (
        disposed ||
        !onAir ||
        host.style.visibility === 'hidden' ||
        host.style.opacity === '0' ||
        options.deterministic ||
        !options.scheduleRule ||
        !claimsRuntimeKeyboardInput(descriptor.layers, trigger, input)
      )
        return false;
      currentFrame = frame;
      const fired = rules.eventFired(trigger, data, { keyboard: input });
      // Like a pointer event, each physical key is a fresh external cause rather than a
      // continuation of the Rule that originally took this template on air.
      if (fired.length) scheduleRules(fired, frame, true);
      return true;
    },
    fireLifecycle(trigger, frame, eventId) {
      if (disposed || !options.scheduleRule || !onAir) return;
      // Updates replace content snapshots but must not impersonate a fresh Played in event.
      if (trigger === 'play') {
        if (playedIn) return;
        playedIn = true;
      }
      if (trigger === 'step') {
        if (steppedIn) return;
        steppedIn = true;
      }
      scheduleRules(
        rules.eventFired(trigger, data, eventId === undefined ? {} : { eventId }),
        frame,
      );
    },
    customAction(actionId, frame, skipAnimation = false, executeTimer = true) {
      if (disposed || !onAir) return;
      currentFrame = frame;
      const clockAction = executeTimer ? parseClockTimerActionId(actionId) : null;
      if (clockAction) {
        const canonical = canonicalClocks.get(clockAction.layerId);
        canonical?.mount.customAction?.(
          clockTimerActionId(canonical.sourceLayerId, clockAction.command),
          frame,
          skipAnimation,
        );
      }
      if (clockAction)
        for (const layer of descriptor.layers) {
          if (
            hiddenLayers?.has(layer.id) ||
            (clockAction.layerId !== layer.id &&
              clockAction.layerId !== layer.collectionItem?.prototypeLayerId)
          )
            continue;
          const clock = clocks.get(layer.id);
          if (clock) {
            const timestamp =
              (Math.max(0, frame - clock.originFrame) * 1000) / descriptor.frameRate;
            clock.events.push({
              timestamp,
              command: clockAction.command,
            });
            if (skipAnimation) {
              const resolved = content.get(layer.id)! as TextElement;
              const base = {
                ...resolved,
                clock: normalizeClockTimerSettings(clock.base.clock),
              };
              const value = clockTimerStateAtTime(
                normalizeClockTimerSettings(base.clock),
                timestamp,
                clock.events,
                true,
              );
              settledTexts.set(
                layer.id,
                JSON.stringify(
                  resolveClockTimerText(
                    base,
                    value.valueMs,
                    clockTimerSettingsAtTime(base.clock, timestamp, clock.events),
                  ),
                ),
              );
            }
          }
        }
      sampleTimerAlarms(frame);
      scheduleRules(rules.eventFired('custom-action', data, { eventId: actionId }), frame);
      for (const layer of descriptor.layers) {
        const resolved = content.get(layer.id);
        if (resolved?.type !== 'text' || resolved.clock) continue;
        const fx = normalizeTextAnimation(resolved.textAnimation);
        if (!hasTextAnimationSettings(fx) || fx.customActionId !== actionId) continue;
        customTextStarts.set(
          layer.id,
          skipAnimation ? frame - textAnimationTotalFrames(fx) : frame,
        );
        settledTexts.delete(layer.id);
        if (textStarts.get(layer.id) !== frame) previousText.delete(layer.id);
      }
    },
    settleText() {
      finishDataUpdate(currentFrame, true);
      settleTextRequested = true;
    },
    controlLoop(action, groupId, frame) {
      return loopPlayback.control(action, groupId, frame);
    },
    getLoopGroups() {
      const visible = new Set(
        descriptor.layers
          .filter((layer) => !hiddenLayers?.has(layer.id))
          .flatMap((layer) => (layer.loop?.timing ? [layer.loop.timing.groupId] : [])),
      );
      return loopPlayback.groups().filter((group) => visible.has(group.groupId));
    },
    nextAlarmFrame(after) {
      if (disposed) return;
      // Replay stops here too, because the data change can fire Rules.
      let next =
        dataUpdate?.pending && dataUpdate.switchFrame > after ? dataUpdate.switchFrame : undefined;
      if (!onAir) return next;
      for (const clock of clocks.values()) {
        const at = clock.alarmPlayback?.tracker.nextAlarmTimestamp();
        if (at === undefined) continue;
        const frame = clock.originFrame + (at * descriptor.frameRate) / 1000;
        if (frame > after && (next === undefined || frame < next)) next = frame;
      }
      return next;
    },
    observeTimerAlarms(sourceLayerId, registrationId, alarms, receive) {
      const observer = { sourceLayerId, alarms, receive };
      alarmObservers.set(registrationId, observer);
      return () => {
        if (alarmObservers.get(registrationId) === observer) alarmObservers.delete(registrationId);
      };
    },
    bindTimerAlarmSource(proxyLayerId, canonical, sourceLayerId, registrationId) {
      canonicalClocks.set(proxyLayerId, { mount: canonical, sourceLayerId });
      const alarms = compiledTimerAlarms(descriptor.layers, proxyLayerId);
      if (!alarms.length || !canonical.observeTimerAlarms) return;
      unbindTimerAlarms.push(
        canonical.observeTimerAlarms(sourceLayerId, registrationId, alarms, (alarm, frame) => {
          if (disposed || !onAir || frame < startFrame) return;
          scheduleRules(
            rules.eventFired('timer-alarm', data, {
              hostLayerId: proxyLayerId,
              eventId: alarm.id,
              ...(alarm.ownerLayerId === undefined
                ? {}
                : { timerAlarmOwnerLayerId: alarm.ownerLayerId }),
            }),
            frame,
          );
        }),
      );
    },
    async waitReady() {
      if (disposed) return;
      const owner = host.ownerDocument;
      if (
        !animatedReadiness &&
        readiness?.version === contentVersion &&
        readiness.document === owner
      ) {
        try {
          await readiness.promise;
          if (disposed) return;
          // Content identity can remain unchanged while a later shader frame is submitted.
          // Cached decoding/font readiness must not acknowledge that frame before its GPU work.
          await waitForLayerEffectsReady(root);
          if (disposed) return;
          await waitForShadersComplete(tickerReadinessScope(root));
        } catch (cause) {
          // Out/Clear can release this mount while a realtime frame awaits its GPU fence.
          // The discarded frame is no longer output; its cancellation must not poison the
          // coordinator or subsequent Takes. Failures on a still-owned mount remain fatal.
          if (!disposed) throw cause;
        }
        return;
      }
      const next = { version: contentVersion, document: owner, promise: Promise.resolve() };
      next.promise = (async () => {
        await ensureFonts();
        if (disposed) return;
        await waitForElementContentReady(root);
        await waitForImages(tickerReadinessScope(root), abort.signal);
      })();
      readiness = next;
      try {
        await next.promise;
      } catch (cause) {
        if (readiness === next) readiness = null;
        if (!disposed) throw cause;
      }
    },
    render(frame, shared, playing, lifecycle) {
      if (disposed) return;
      applyDueData(frame);
      currentFrame = frame;
      currentLifecycle = lifecycle;
      sampleTimerAlarms(frame);
      rules.publish((frame * 1000) / descriptor.frameRate);
      for (const layer of descriptor.layers) refreshContent(layer, layerEls.get(layer.id)!);
      const elapsedFrames = Math.max(0, frame - mount.startFrame);
      const elapsedMs = (elapsedFrames * 1000) / descriptor.frameRate;
      const timing = sampleTransitionLogicLifecycle(descriptor, frame, startFrame, lifecycle);
      const dormant = skipHiddenSimpleVisuals
        ? new Set(
            descriptor.layers
              .filter(
                (layer) =>
                  !hiddenLayers?.has(layer.id) &&
                  !layer.loop?.timing &&
                  !hasElementMediaPaint(layer.element) &&
                  (layer.element.type === 'chart' ||
                    layer.element.type === 'rectangle' ||
                    layer.element.type === 'ellipse' ||
                    layer.element.type === 'path' ||
                    (layer.element.type === 'text' &&
                      !layer.element.clock &&
                      !layer.element.crawl)) &&
                  (!visualRuleLayerVisible(layer, data) ||
                    !isRuntimeCollectionLayerActive(layer, data)),
              )
              .map((layer) => layer.id),
          )
        : new Set<string>();
      // Tracks, reveal masks, effect parameters and paths share the same authored lifecycle
      // frame. Retained state morphs and data-only updates stay on their on-air Step.
      const states = new Map(
        descriptor.layers
          .filter((layer) => !dormant.has(layer.id))
          .map((layer) => [
            layer.id,
            sampleTransitionLogicLayerVisualState(
              descriptor,
              layer,
              timing,
              data,
              {},
              (layer, elapsed, frame) =>
                onAir ? loopPlayback.sample(layer, elapsed, data, frame) : elapsed,
            ),
          ]),
      );
      const values = new Map(
        shared.map((value) => [
          `${sharedLayerKey(value.instanceId, value.sourceLayerId)}/${value.property}`,
          value.value,
        ]),
      );
      for (const [id, state] of states) {
        const key = sharedKeys?.get(id);
        if (!key) continue;
        const authoredHold =
          lifecycle && lifecycle.phase !== 'hold'
            ? sampleCompiledLayerVisualState(
                descriptor.layers.find((layer) => layer.id === id)!,
                timing.holdFrame,
                undefined,
                data,
                {},
              ).transform
            : undefined;
        for (const property of Object.keys(state.transform) as (keyof LayerTransform)[]) {
          const value = values.get(`${key}/${property}`);
          if (typeof value !== 'number') continue;
          // A shared pin defines the current on-air baseline. During entry/exit, preserve
          // the authored local travel/reveal relative to that baseline; a pin must not
          // turn a staged bracket or mask into its fully revealed hold pose. Shared pins
          // retain absolute priority over local rules/loops during ordinary hold/morph.
          if (!authoredHold) state.transform[property] = value;
          else if (property === 'width' || property === 'height' || property === 'opacity')
            state.transform[property] =
              authoredHold[property] === 0
                ? value + state.transform[property] - authoredHold[property]
                : value * (state.transform[property] / authoredHold[property]);
          else state.transform[property] += value - authoredHold[property];
        }
      }
      const clockDisplays = new Map<string, TextElement>();
      const clockSnapshots = new Map<string, ReturnType<typeof clockTimerTextAnimationAtTime>>();
      for (const [id, clock] of clocks) {
        const resolved = content.get(id);
        if (resolved?.type !== 'text' || !resolved.clock) continue;
        const clockMs = (Math.max(0, frame - clock.originFrame) * 1000) / descriptor.frameRate;
        const initialSettings = normalizeClockTimerSettings(clock.base.clock);
        const base = {
          ...resolved,
          clock: initialSettings,
        };
        clockDisplays.set(
          id,
          resolveClockTimerText(
            base,
            clockTimerStateAtTime(initialSettings, clockMs, clock.events, true).valueMs,
            clockTimerSettingsAtTime(initialSettings, clockMs, clock.events),
          ),
        );
        clockSnapshots.set(
          id,
          clockTimerTextAnimationAtTime(base, clockMs, descriptor.frameRate, clock.events, true),
        );
      }
      const modifierContext = { timestampMs: elapsedMs, clockText: clockDisplays };
      applyCompiledAutoLayout(descriptor, states, data, layerEls, modifierContext);
      applyCompiledMotionPaths(descriptor, states);
      applyCompiledModifiers(descriptor, states, data, layerEls, modifierContext);
      for (const layer of descriptor.layers) {
        const element = layerEls.get(layer.id)!;
        const resolved = content.get(layer.id)!;
        // Skipping lifecycle animation settles hidden update FX too; omitting their pixels
        // must not postpone this logical state until the designer later opens that view.
        if (settleTextRequested) {
          if (resolved.type === 'chart') {
            const entry = chartHistory.get(layer.id)?.at(-1);
            if (entry) entry.skip = true;
          } else if (resolved.type === 'text' && !resolved.clock) {
            const signature = contentSignatures.get(layer.id);
            if (signature) settledTexts.set(layer.id, signature);
          }
        }
        if (dormant.has(layer.id)) {
          if (element.style.display !== 'none') element.style.display = 'none';
          continue;
        }
        const visible =
          visualRuleLayerVisible(layer, data) && isRuntimeCollectionLayerActive(layer, data);
        const display = visible ? '' : 'none';
        if (element.style.display !== display) element.style.display = display;
        if (resolved.type === 'chart' && !visible && !hiddenLayers?.has(layer.id)) {
          applyCompiledLayerVisualState(element, states.get(layer.id)!, elapsedMs);
          continue;
        }
        if (resolved.type === 'text' && resolved.clock && clocks.has(layer.id)) {
          const snapshot = clockSnapshots.get(layer.id)!;
          const text = clockDisplays.get(layer.id)!;
          if (element.dataset.ografRenderedElement !== JSON.stringify(text))
            renderElementContent(element, text, snapshot.frame, {
              frameRate: descriptor.frameRate,
              rendererPlugins: descriptor.rendererPlugins,
              shaderBackingSize: shaderBackingSizeForLayer(layer),
              shaderStrokePadding: shaderStrokePaddingForLayer(layer),
            });
          renderAnimatedElementAtTime(element, text, elapsedMs, { playing });
          setTextAnimationPrevious(element, snapshot.previous);
          const signature = JSON.stringify(text);
          if (settleTextRequested) settledTexts.set(layer.id, signature);
          renderTextAnimationAtFrame(
            element,
            text,
            settledTexts.get(layer.id) === signature
              ? textAnimationTotalFrames(text.textAnimation)
              : snapshot.frame,
          );
        } else if (resolved.type !== 'audio') {
          renderAnimatedElementAtTime(
            element,
            resolved,
            resolved.type === 'ticker'
              ? (Math.max(0, frame - tickerOriginFrame) * 1000) / descriptor.frameRate
              : elapsedMs,
            {
              playing,
              chartMarkFrame: timing.frame,
            },
          );
          if (resolved.type === 'chart') {
            const history = chartHistory.get(layer.id);
            const entry = history?.at(-1);
            if (entry && settleTextRequested) entry.skip = true;
            const animation = normalizeChartAnimation(resolved.animation);
            const localFrame = entry?.skip
              ? chartAnimationEndFrame(resolved)
              : Math.max(0, frame - (entry?.frame ?? startFrame));
            element.dataset.ografChartAnimationFrame = String(localFrame);
            if (
              history &&
              (options.deterministic || pendingChartReplay.has(layer.id)) &&
              animation.updateMode === 'morph'
            ) {
              if (renderChartAnimationHistoryAtFrame(element, history, frame, timing.frame))
                pendingChartReplay.delete(layer.id);
              else renderChartAnimationAtFrame(element, resolved, localFrame, timing.frame);
            } else renderChartAnimationAtFrame(element, resolved, localFrame, timing.frame);
          }
          if (resolved.type === 'text') {
            const previous = previousText.get(layer.id);
            const fx = normalizeTextAnimation(resolved.textAnimation);
            setTextAnimationPrevious(element, previous ?? null);
            const signature = JSON.stringify(resolved);
            if (settleTextRequested) settledTexts.set(layer.id, signature);
            const customStart = customTextStarts.get(layer.id);
            renderTextAnimationAtFrame(
              element,
              resolved,
              settledTexts.get(layer.id) === signature
                ? textAnimationTotalFrames(fx)
                : fx.customActionId && customStart !== undefined
                  ? Math.max(0, frame - customStart)
                  : (previous && !fx.replayOnUpdate) ||
                      fx.customActionId ||
                      (lifecycle?.contentAtHold && !previous)
                    ? textAnimationTotalFrames(fx)
                    : previous || !lifecycle || lifecycle.phase !== 'in'
                      ? Math.max(0, frame - (textStarts.get(layer.id) ?? mount.startFrame))
                      : Math.max(0, timing.frame - timing.startFrame),
            );
          }
        }
        applyCompiledLayerVisualState(element, states.get(layer.id)!, elapsedMs);
      }
      applyCompiledTextPaths(
        descriptor,
        states,
        layerEls,
        (layer) => content.get(layer.id) ?? layer.element,
      );
      applyCompiledClipPaths(descriptor, layerEls, states);
      applyCompiledMasks(descriptor, layerEls, states, data);
      // Shared proxies remain available to masks/layout, but are painted by their retained host.
      for (const id of hiddenLayers ?? []) {
        const element = layerEls.get(id);
        if (element) element.style.visibility = 'hidden';
      }
      poseDataUpdate(frame);
      settleTextRequested = false;
    },
    dispose() {
      for (const unbind of unbindTimerAlarms.splice(0)) unbind();
      alarmObservers.clear();
      canonicalClocks.clear();
      if (disposed) return;
      disposed = true;
      const update = dataUpdate;
      dataUpdate = null;
      for (const resolve of update?.waiters ?? []) resolve();
      for (const hold of updateSampleHolds.values()) hold.cancel();
      updateSampleHolds.clear();
      stagedImages.clear();
      mountedRules.delete(mount);
      mountedLoops.delete(mount);
      mountedTickers.delete(mount);
      mountedCharts.delete(mount);
      mountedClocks.delete(mount);
      disposePointer();
      for (const timer of clickTimers) clearTimeout(timer);
      clickTimers.clear();
      abort.abort();
      for (const element of layerEls.values()) disposeElementContent(element);
      layerEls.clear();
      contentSignatures.clear();
      contentInputs.clear();
      deferredCharts.clear();
      readiness = null;
      host.remove();
    },
  };
  mountedRules.set(mount, rules);
  mountedLoops.set(mount, loopPlayback);
  mountedTickers.set(mount, { layers: layerEls, origin: () => tickerOriginFrame });
  mountedCharts.set(mount, chartHistory);
  mountedClocks.set(mount, clocks);
  try {
    mountContent();
    setLottieDeterministicRendering(root, Boolean(options.deterministic));
    mount.render(options.startFrame, [], false);
    mount.ready = (async () => {
      await mount.waitReady();
    })();
  } catch (cause) {
    mount.dispose();
    throw cause;
  }
  return mount;
}
