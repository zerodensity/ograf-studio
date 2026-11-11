import type {
  CompiledGraphicDescriptor,
  CompiledTransitionLogicDescriptor,
  CompiledTransitionLogicTemplate,
  CoordinatedPlayoutSnapshot,
  CoordinatedPrepareSlotParams,
  CoordinatedPreparedSlot,
  CoordinatedTakePreparedSlotParams,
  CustomActionParams,
  GoToTimeParams,
  Graphic,
  LoadParams,
  PlayActionParams,
  PlayActionReturnPayload,
  ReturnPayload,
  ScheduledAction,
  SetActionsScheduleParams,
  StopActionParams,
  TransitionLogicControlData,
  UpdateActionParams,
} from '@ograf-editor/ograf-types';
import { filterExposedData } from './dataExposure';
import { getTickerUpdateStatuses, setTickerOutputActive } from './tickerRendering';
import { resolveBoundElement } from './renderElement';
import {
  bindRuntimeKeyboard,
  hasRuntimeKeyboardRules,
  type RuntimeKeyboardTrigger,
} from './runtimeKeyboard';
import type { VisualRuleKeyboardInput } from '@ograf-editor/scene-model';
import {
  clockTimerActionId,
  parseClockTimerActionId,
  remapClockTimerActionId,
  createTransitionLogicSession,
  prepareTransitionLogicDefinition,
  hasElementMediaPaint,
  hasElementShaderPaint,
  reduceTransitionLogic,
  sampleTransitionLogic,
  transitionLogicAdmissionError,
  transitionLogicOutSlotIds,
  transitionLogicUpdateRecipe,
  planTransitionLogicPlay,
  safeTransitionLogicStartupStates,
  visualRulePlayoutActionErrors,
  type FrameCue,
  type TransitionLogicDefinition,
  type TransitionLogicEvent,
  type TransitionLogicPlan,
  type TransitionLogicSelection,
  type TransitionLogicSession,
  type TransitionLogicSlotSample,
} from '@ograf-editor/scene-model';
import { FramePlayer } from './framePlayer';
import {
  collectExportedLayers,
  dispatchStudioFrameCue,
  type GraphicInstance,
  type GraphicInstances,
} from './graphicInstances';
import {
  PreparedInstanceCache,
  DEFAULT_PREPARED_INSTANCE_BYTES,
  DEFAULT_PREPARED_INSTANCE_LIMIT,
} from './PreparedInstanceCache';
import { resolvePlayTarget } from './lifecycle';
import {
  mountTransitionLogicComposition,
  sharedLayerKey,
  type TransitionLogicDataStage,
  type TransitionLogicMount,
  type TransitionLogicRuleWork,
  type TransitionLogicUpdateMotion,
  type RuntimePlayoutRuleAction,
} from './transitionLogicRendering';
import {
  sampleTransitionLogicLifecycle,
  type TransitionLogicLifecyclePose,
} from './transitionLogicLifecycle';
import {
  applyTransitionLogicContentPose,
  sampleTransitionLogicContentAnimation,
} from './transitionLogicContentAnimation';

const TIMEOUT_MS = 30_000;
const MAX_SCHEDULE = 10_000;
const MAX_RULE_CHAIN = 32;
const MAX_PENDING_RULES = 10_000;

interface CoordinatedFrameCueWindow {
  planId: string;
  laneId: string;
  selection: TransitionLogicSelection;
  cues: Array<{ at: number; cue: FrameCue }>;
  next: number;
}
/**
 * Pose a template's content during a transition. Visibility runs 0..1: fade changes opacity, slide
 * also moves content up out of and into place, and wipe reveals the incoming content from the left
 * while the outgoing content is wiped away.
 */
function contentPose(
  host: HTMLElement,
  visibility: number,
  motion: 'fade' | 'slide' | 'wipe' | 'authored',
  leaving: boolean,
  height: number,
): void {
  const hidden = 1 - visibility;
  const opacity =
    motion === 'wipe' || motion === 'authored' ? (visibility > 0 ? 1 : 0) : visibility;
  const transform =
    motion === 'slide' && hidden > 0
      ? `translateY(${(leaving ? -1 : 1) * hidden * height * 0.06}px)`
      : '';
  const clipPath =
    motion === 'wipe' && hidden > 0
      ? leaving
        ? `inset(0 0 0 ${hidden * 100}%)`
        : `inset(0 ${hidden * 100}% 0 0)`
      : '';
  if (host.style.opacity !== String(opacity)) host.style.opacity = String(opacity);
  if (host.style.transform !== transform) host.style.transform = transform;
  if (host.style.clipPath !== clipPath) host.style.clipPath = clipPath;
  if (host.style.transformOrigin) host.style.transformOrigin = '';
  if (host.style.filter) host.style.filter = '';
}

class SupersededOperation extends Error {}
class AdmissionDenied extends Error {}
interface PreparedSlotResources {
  snapshot: CoordinatedPreparedSlot;
  mount: TransitionLogicMount | null;
  shared: TransitionLogicMount[];
}
interface CachedPreparedInstance {
  key: string;
  mount: TransitionLogicMount;
  estimatedBytes: number;
  ready: boolean;
}
interface WarmCandidate {
  key: string;
  estimatedBytes: number;
  selection: TransitionLogicSelection;
  sharedInstanceId?: string;
  data: Record<string, unknown>;
  descriptor: CompiledGraphicDescriptor;
}
interface CoordinatedPlayBatch {
  id: number;
  generation: number;
  controls: TransitionLogicControlData;
  stages: Array<{ outSlotIds: string[]; takeSlotIds: string[] }>;
  resources: Map<string, PreparedSlotResources>;
  requestIds: Set<string>;
  index: number;
  waiting: Array<{ slotId: string; stateId: string | null }> | null;
  preparing: boolean;
  presentationPending: boolean;
  committed: boolean;
  finished: boolean;
  skipAnimation: boolean;
  cause: string[];
  pointer: boolean;
  work: Promise<void> | null;
  completion: Promise<void>;
  resolve(): void;
  reject(cause: unknown): void;
  failure?: unknown;
}
const snapshotKey = (selection: TransitionLogicSelection) =>
  JSON.stringify([selection.instanceId, selection.requestId]);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function ownsClock(descriptor: CompiledGraphicDescriptor, layerId: string): boolean {
  return [
    ...descriptor.layers,
    ...(descriptor.collections ?? []).flatMap((collection) =>
      collection.capacity > 0 ? collection.prototypeLayers : [],
    ),
  ].some((layer) => layer.id === layerId && layer.element.type === 'text' && layer.element.clock);
}

/** JSON data must retain its meaning when replayed or copied into a package. */
function jsonCopy<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === null || ancestors.has(value))
    throw new TypeError('Transition data must contain finite, acyclic JSON values.');
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== null &&
    Object.getPrototypeOf(Object.getPrototypeOf(value)) !== null
  )
    throw new TypeError('Transition data must contain plain JSON objects.');
  ancestors.add(value);
  const result = Array.isArray(value)
    ? value.map((entry) => jsonCopy(entry, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, jsonCopy(entry, ancestors)]),
      );
  ancestors.delete(value);
  return result as T;
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (!object(value)) throw new TypeError('Transition data must be an object.');
  return jsonCopy(value);
}

/** Feed patches are bounded before recursive cloning, including cross-document controller data. */
function boundedPatchData(value: unknown): Record<string, unknown> {
  if (!object(value)) throw new TypeError('transition.patch requires a data object.');
  let values = 0;
  const ancestors = new Set<object>();
  const visit = (entry: unknown, depth: number): boolean => {
    if (++values > 4096 || depth > 16) return false;
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return true;
    if (typeof entry === 'number') return Number.isFinite(entry);
    if (!entry || typeof entry !== 'object' || ancestors.has(entry)) return false;
    if (
      !Array.isArray(entry) &&
      Object.getPrototypeOf(entry) !== null &&
      Object.getPrototypeOf(Object.getPrototypeOf(entry)) !== null
    )
      return false;
    if (Reflect.ownKeys(entry).length > 4097 || Object.getOwnPropertySymbols(entry).length)
      return false;
    if (
      Object.values(Object.getOwnPropertyDescriptors(entry)).some(
        (descriptor) => !('value' in descriptor),
      )
    )
      return false;
    ancestors.add(entry);
    if (Array.isArray(entry) && entry.length > 4096) return false;
    const valid = Array.isArray(entry)
      ? Array.from(entry).every((child) => visit(child, depth + 1))
      : Object.values(entry).every((child) => visit(child, depth + 1));
    ancestors.delete(entry);
    return valid;
  };
  if (!visit(value, 0))
    throw new TypeError(
      'Patch data must contain finite, acyclic JSON with at most 4096 values and 16 nested levels.',
    );
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 64 * 1024)
    throw new TypeError('Patch data must not exceed 64 KiB.');
  return dataRecord(value);
}

function errorPayload(cause: unknown): ReturnPayload {
  return { statusCode: 550, statusMessage: cause instanceof Error ? cause.message : String(cause) };
}

function freezeCopy<T>(value: T): T {
  const copy = jsonCopy(value);
  const freeze = (entry: unknown): void => {
    if (entry && typeof entry === 'object') {
      for (const child of Object.values(entry)) freeze(child);
      Object.freeze(entry);
    }
  };
  freeze(copy);
  return copy;
}

/**
 * One OGraf graphic coordinates every slot, with retained shared DOM and request-scoped content.
 * Realtime requests reach the planner immediately; non-realtime schedules replay the load snapshot.
 */
export abstract class CoordinatedGraphicElement extends HTMLElement implements Graphic {
  static transitionDescriptor: CompiledTransitionLogicDescriptor;
  #descriptor: CompiledTransitionLogicDescriptor | null = null;
  #definition: TransitionLogicDefinition | null = null;
  #session: TransitionLogicSession | null = null;
  #surface: HTMLDivElement | null = null;
  #player: FramePlayer | null = null;
  #mounts = new Map<string, TransitionLogicMount>();
  #renderedSlots: readonly Pick<TransitionLogicSlotSample, 'slotId' | 'incoming' | 'outgoing'>[] =
    [];
  #frameCueInstances: { selection: TransitionLogicSelection; slotId: string }[] = [];
  #instanceCache = new PreparedInstanceCache<CachedPreparedInstance>({
    dispose: (entry) => entry.mount.dispose(),
  });
  #mountBindings = new WeakMap<TransitionLogicMount, { selection: TransitionLogicSelection }>();
  #probeCacheEntries = new WeakMap<TransitionLogicMount, CachedPreparedInstance>();
  #probeReleases = new Set<CachedPreparedInstance>();
  #warmCancel: (() => void) | null = null;
  #warmInFlight: CachedPreparedInstance | null = null;
  #warmToken = 0;
  #warmNumber = 0;
  #warmRecent: string[] = [];
  #warmFailed = new Set<string>();
  #shared = new Map<string, TransitionLogicMount>();
  #activeShared = new Set<TransitionLogicMount>();
  #sharedDataCache = new Map<string, Map<string, Record<string, unknown>>>();
  #sharedDataIdentity = new WeakMap<TransitionLogicMount, Record<string, unknown>>();
  #starts = new Map<string, number>();
  #loopStarts = new WeakMap<TransitionLogicMount, number>();
  #controls: TransitionLogicControlData = { slots: {} };
  #retainedData = new Map<string, Record<string, unknown>>();
  #retainedSelection = new Map<string, string>();
  #loadControls: TransitionLogicControlData = { slots: {} };
  #schedule: ScheduledAction[] = [];
  #externalSchedule = new WeakSet<ScheduledAction>();
  #currentStep: number | undefined;
  #disposeKeyboard: (() => void) | null = null;
  #renderType: 'realtime' | 'non-realtime' = 'realtime';
  #epoch = 0;
  #useClockEpoch = false;
  #frame = 0;
  #requestNumber = 0;
  #generation = 0;
  #queue: Promise<unknown> = Promise.resolve();
  #loaded = false;
  #renderError: Error | null = null;
  #waiters = new Map<
    string,
    { slotId: string; outSlotIds?: string[]; resolve(): void; reject(cause: unknown): void }
  >();
  #cancellations = new Set<() => void>();
  #preparations = new Map<string, () => void>();
  #prepared = new Map<string, PreparedSlotResources>();
  #listeners = new Set<(snapshot: CoordinatedPlayoutSnapshot) => void>();
  #lastPublishTime = Number.NEGATIVE_INFINITY;
  #paused = false;
  #recordedActions: ScheduledAction[] = [];
  #recordingTruncated = false;
  #skipRequests = new Map<string, boolean>();
  #hasFrameCues = false;
  #frameCueWindows: CoordinatedFrameCueWindow[] = [];
  #takeovers = new Map<string, string[]>();
  #takeoverOutRequests = new Set<string>();
  #ruleWork: Array<TransitionLogicRuleWork & { cause: string[]; order: number }> = [];
  #ruleOrder = 0;
  #activeRuleCause: string[] = [];
  #activePointerRule = false;
  #pointerRuleRequests = new Set<string>();
  #requestRuleCauses = new Map<string, string[]>();
  #mountRuleCauses = new WeakMap<TransitionLogicMount, string[]>();
  #drainingRules = false;
  #rulePreparationCount = 0;
  #ruleMicrotaskPending = false;
  #playBatch: CoordinatedPlayBatch | null = null;
  #startupPlay: { batch: CoordinatedPlayBatch; preparation: Promise<void> } | null = null;
  #playBatchNumber = 0;
  #playBatchMicrotaskPending = false;
  #realtimeAdvance: Promise<void> | null = null;
  #realtimeFrameTarget = 0;
  /** The latest Take of each lane. An in-place update still loading stands down for a newer one. */
  #laneTakes = new Map<string, number>();
  /** Patches wait for this, so they stay in order while an update on the lane loads an image. */
  #laneStaging = new Map<string, Promise<void>>();

  get transitionDescriptor(): CompiledTransitionLogicDescriptor {
    return (this.constructor as typeof CoordinatedGraphicElement).transitionDescriptor;
  }

  /** Snapshot the mounted layer wrappers when a host reads the lookup. */
  get instances(): GraphicInstances {
    const instances: Record<string, GraphicInstance> = Object.create(null);
    const add = (selection: TransitionLogicSelection | null, laneId: string) => {
      if (!selection || Object.hasOwn(instances, selection.instanceId)) return;
      const mount = this.#mounts.get(snapshotKey(selection));
      if (!mount) return;
      const template = this.#template(selection.templateId);
      const sharedLayers = new Map(template.sharedLayers.map((link) => [link.layerId, link]));
      const layers = collectExportedLayers(template.descriptor.layers, (id) => {
        const shared = sharedLayers.get(id);
        return shared
          ? this.#shared.get(shared.instanceId)?.layerElement(shared.sourceLayerId)
          : mount.layerElement(id);
      });
      instances[selection.instanceId] = Object.freeze({
        instanceId: selection.instanceId,
        templateId: selection.templateId,
        laneId,
        layers: Object.freeze(layers),
      });
    };
    for (const slot of this.#renderedSlots) {
      // Same-state updates can render two snapshots of one logical instance.
      add(slot.incoming, slot.slotId);
      add(slot.outgoing, slot.slotId);
    }
    for (const { selection, slotId } of this.#frameCueInstances) add(selection, slotId);
    return Object.freeze(instances);
  }

  #withFrameCueInstance(
    selection: TransitionLogicSelection,
    slotId: string,
    emit: () => void,
  ): void {
    const rendered = this.#renderedSlots.some(
      (slot) =>
        slot.incoming?.instanceId === selection.instanceId ||
        slot.outgoing?.instanceId === selection.instanceId,
    );
    if (rendered || !this.#mounts.has(snapshotKey(selection))) {
      emit();
      return;
    }
    // A terminal cue is delivered while its mount is still available, before pruning.
    const instances = this.#frameCueInstances;
    instances.push({ selection, slotId });
    try {
      emit();
    } finally {
      instances.pop();
    }
  }

  handleKeyboardInput(trigger: RuntimeKeyboardTrigger, input: VisualRuleKeyboardInput): boolean {
    if (
      !this.#loaded ||
      this.#renderType !== 'realtime' ||
      !this.#session ||
      !this.#definition ||
      input.isComposing
    )
      return false;
    const recipients = new Set<TransitionLogicMount>();
    const slots = [...this.#definition.slots].sort(
      (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    );
    for (const definition of slots) {
      const slot = this.#session.slots[definition.id];
      // Pending/prepared replacements and outgoing snapshots do not own keyboard input.
      const selection = slot?.transition ? slot.transition.to : slot?.settled;
      if (!selection) continue;
      const mount = this.#mounts.get(snapshotKey(selection));
      if (mount) recipients.add(mount);
      const template = this.#template(selection.templateId);
      for (const shared of this.#definition.sharedInstances) {
        if (shared.slotId && shared.slotId !== definition.id) continue;
        if (
          !template.sharedLayers.some((layer) => layer.instanceId === shared.id) &&
          !template.sharedDataBindings.some((binding) => binding.instanceId === shared.id)
        )
          continue;
        const source = this.#shared.get(shared.id);
        if (source && this.#activeShared.has(source)) recipients.add(source);
      }
    }
    let claimed = false;
    for (const mount of recipients)
      claimed = mount.handleKeyboardInput?.(trigger, input, this.#frame) || claimed;
    return claimed;
  }

  /** Package subclasses resolve only resource-bearing data paths after state selection. */
  protected resolveTemplateData(
    _templateId: string,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    return data;
  }

  /** Exported packages enforce the public field policy; Studio authoring retains all fields. */
  protected resolveExternalTemplateData(
    _templateId: string,
    data: Record<string, unknown>,
    _current: Record<string, unknown>,
  ): Record<string, unknown> {
    return data;
  }

  protected filterPublicTemplateData(
    templateId: string,
    data: Record<string, unknown>,
    current: Record<string, unknown>,
  ): Record<string, unknown> {
    const descriptor = this.transitionDescriptor.templates.find(
      (template) => template.id === templateId,
    )?.descriptor;
    return filterExposedData(data, descriptor?.dataExposure, current) as Record<string, unknown>;
  }

  #externalStateData(
    stateId: string | null,
    data: unknown,
    current: Record<string, unknown>,
  ): Record<string, unknown> {
    const values = dataRecord(data);
    const state = this.#definition!.states.find((entry) => entry.id === stateId);
    return state ? this.resolveExternalTemplateData(state.templateId, values, current) : values;
  }

  adoptedCallback(): void {
    this.#cancelWarmup();
    this.#instanceCache.clear();
    for (const entry of this.#probeReleases) entry.mount.dispose();
    this.#probeReleases.clear();
    this.#cancelStartupPlay();
    this.#player?.setClockOwner(this.ownerDocument.defaultView);
    const generation = this.#generation;
    void Promise.all(
      [
        ...this.#mounts.values(),
        ...this.#shared.values(),
        ...[...this.#prepared.values()].flatMap((entry) => [
          ...(entry.mount ? [entry.mount] : []),
          ...entry.shared,
        ]),
      ].map((mount) => mount.waitReady()),
    ).catch((cause: unknown) => {
      if (!this.#loaded || generation !== this.#generation) return;
      this.#renderError = cause instanceof Error ? cause : new Error(String(cause));
      this.#player?.dispose();
      for (const waiter of this.#waiters.values()) waiter.reject(this.#renderError);
      this.#waiters.clear();
      this.#publish(true);
    });
  }

  getTickerUpdates() {
    return this.shadowRoot ? getTickerUpdateStatuses(this.shadowRoot) : [];
  }

  getPlayoutSnapshot(): CoordinatedPlayoutSnapshot {
    const sample =
      this.#definition && this.#session
        ? sampleTransitionLogic(this.#definition, this.#session, this.#frame)
        : null;
    return freezeCopy({
      loaded: this.#loaded,
      definitionId: this.#session?.definitionId ?? null,
      definitionRevision: this.#session?.definitionRevision ?? null,
      frame: this.#frame,
      frameRate: this.#descriptor?.frameRate ?? 0,
      renderType: this.#renderType,
      paused: this.#paused,
      recordingTruncated: this.#recordingTruncated,
      clockEpochMs: this.#loaded && this.#useClockEpoch ? this.#epoch : null,
      error: this.#renderError?.message ?? null,
      slots: Object.fromEntries(
        (sample?.slots ?? []).map((value) => {
          const slot = this.#session!.slots[value.slotId]!;
          const transition = slot.transition;
          return [
            value.slotId,
            {
              slotId: value.slotId,
              name: this.#definition!.slots.find((entry) => entry.id === value.slotId)!.name,
              current: slot.settled,
              desired: slot.desired,
              outgoing: value.outgoing,
              incoming: value.incoming,
              pending: slot.pending
                ? {
                    requestId: slot.pending.request.requestId,
                    stateId: slot.pending.request.stateId,
                    data: slot.pending.request.data ?? {},
                    ready: slot.pending.ready,
                  }
                : null,
              readiness: slot.readiness,
              error: slot.error,
              transition: transition
                ? {
                    id: transition.id,
                    requestId: transition.requestId,
                    transitionId: transition.transitionId,
                    startFrame: transition.startFrame,
                    endFrame: transition.endFrame,
                    progress: value.progress,
                  }
                : null,
            },
          ];
        }),
      ),
      prepared: Object.fromEntries([...this.#prepared].map(([id, value]) => [id, value.snapshot])),
      loops: [
        ...new Map(
          (sample?.slots ?? []).flatMap((slot) =>
            this.#slotLoopMounts(slot.slotId).flatMap((mount) =>
              (mount.getLoopGroups?.() ?? []).map(
                (group) =>
                  [
                    JSON.stringify([slot.slotId, group.groupId]),
                    { slotId: slot.slotId, ...group },
                  ] as const,
              ),
            ),
          ),
        ).values(),
      ],
    });
  }

  subscribePlayout(listener: (snapshot: CoordinatedPlayoutSnapshot) => void): () => void {
    this.#listeners.add(listener);
    try {
      listener(this.getPlayoutSnapshot());
    } catch {
      /* Observers cannot stop playout. */
    }
    return () => {
      this.#listeners.delete(listener);
    };
  }

  pausePlayout(): void {
    this.#assertLive();
    if (this.#renderType !== 'realtime') return;
    this.#paused = true;
    this.#player?.pause();
    this.#render(this.#frame);
    this.#publish(true);
  }

  resumePlayout(): void {
    this.#assertLive();
    if (this.#renderType !== 'realtime') return;
    this.#paused = false;
    this.#render(this.#frame);
    this.#player?.play();
    this.#publish(true);
  }

  getRecordedActions(): ScheduledAction[] {
    if (this.#recordingTruncated)
      throw new Error(
        'Playout recording exceeded 10000 actions. Reload the session to record a new rehearsal.',
      );
    return freezeCopy(this.#recordedActions);
  }

  #record(action: ScheduledAction['action'], frame: number): void {
    if (this.#renderType !== 'realtime') return;
    if (this.#recordedActions.length >= MAX_SCHEDULE) {
      this.#recordingTruncated = true;
      return;
    }
    this.#recordedActions.push({
      timestamp: (frame * 1000) / this.#descriptor!.frameRate,
      action: jsonCopy(action),
    });
  }

  #publish(force = false): void {
    if (!this.#listeners.size) return;
    const now = performance.now();
    if (!force && now - this.#lastPublishTime < 100) return;
    this.#lastPublishTime = now;
    const snapshot = this.getPlayoutSnapshot();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        /* Observers cannot stop playout. */
      }
    }
  }

  #cancelPrepared(slotId?: string, publish = true): void {
    for (const [id, prepared] of this.#prepared) {
      if (slotId !== undefined && id !== slotId) continue;
      this.#prepared.delete(id);
      this.#preparations.get(prepared.snapshot.requestId)?.();
      this.#preparations.delete(prepared.snapshot.requestId);
      prepared.mount?.dispose();
      for (const mount of prepared.shared) this.#releaseProbe(mount);
    }
    if (publish) this.#publish(true);
  }

  async cancelPreparedSlot(slotId?: string): Promise<ReturnPayload> {
    return this.#action(async () => {
      if (slotId !== undefined) this.#validateState(slotId, null);
      this.#cancelPlayBatch('Preparation cancellation superseded Coordinated Play.');
      this.#cancelPrepared(slotId);
      return { statusCode: 200 };
    });
  }

  #assertLive(generation = this.#generation): void {
    if (!this.#loaded || generation !== this.#generation)
      throw new Error('Graphic is not loaded or the operation was disposed.');
    if (this.#renderError) throw this.#renderError;
  }

  #enqueue<T extends ReturnPayload>(operation: () => Promise<T>): Promise<T> {
    const generation = this.#generation;
    const result = this.#queue.then(async () => {
      try {
        this.#assertLive(generation);
        return await operation();
      } catch (cause) {
        return errorPayload(cause) as T;
      }
    });
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #action<T extends ReturnPayload>(operation: () => Promise<T>): Promise<T> {
    if (this.#renderType === 'non-realtime') return this.#enqueue(operation);
    try {
      this.#assertLive();
      this.#cancelWarmup();
      return await operation();
    } catch (cause) {
      return errorPayload(cause) as T;
    } finally {
      this.#scheduleWarmup();
    }
  }

  #reset(): void {
    this.#disposeKeyboard?.();
    this.#disposeKeyboard = null;
    this.#cancelWarmup();
    this.#cancelPlayBatch('Graphic was disposed or reloaded.');
    ++this.#generation;
    this.#loaded = false;
    this.#renderedSlots = [];
    this.#frameCueInstances = [];
    this.#cancelPrepared(undefined, false);
    for (const entry of this.#probeReleases) entry.mount.dispose();
    this.#probeReleases.clear();
    this.#instanceCache.clear();
    this.#warmFailed.clear();
    this.#warmRecent = [];
    this.#warmNumber = 0;
    this.#mountBindings = new WeakMap();
    this.#probeCacheEntries = new WeakMap();
    this.#player?.dispose();
    this.#player = null;
    for (const cancel of this.#cancellations) cancel();
    this.#cancellations.clear();
    this.#preparations.clear();
    for (const waiter of this.#waiters.values()) waiter.reject(new Error('Graphic was disposed.'));
    this.#waiters.clear();
    for (const mount of this.#mounts.values()) mount.dispose();
    for (const mount of this.#shared.values()) mount.dispose();
    this.#mounts.clear();
    this.#shared.clear();
    this.#activeShared.clear();
    this.#sharedDataCache.clear();
    this.#starts.clear();
    this.#surface?.remove();
    this.#surface = null;
    this.#session = null;
    this.#definition = null;
    this.#descriptor = null;
    this.#frame = 0;
    this.#currentStep = undefined;
    this.#renderError = null;
    this.#queue = Promise.resolve();
    this.#paused = false;
    this.#recordedActions = [];
    this.#recordingTruncated = false;
    this.#skipRequests.clear();
    this.#hasFrameCues = false;
    this.#frameCueWindows = [];
    this.#takeovers.clear();
    this.#takeoverOutRequests.clear();
    this.#retainedData.clear();
    this.#retainedSelection.clear();
    this.#ruleWork = [];
    this.#ruleOrder = 0;
    this.#activeRuleCause = [];
    this.#activePointerRule = false;
    this.#pointerRuleRequests.clear();
    this.#requestRuleCauses.clear();
    this.#mountRuleCauses = new WeakMap();
    this.#drainingRules = false;
    this.#rulePreparationCount = 0;
    this.#ruleMicrotaskPending = false;
    this.#playBatchMicrotaskPending = false;
    this.#playBatchNumber = 0;
    this.#realtimeAdvance = null;
    this.#realtimeFrameTarget = 0;
    this.#laneTakes.clear();
    this.#laneStaging.clear();
    this.#publish(true);
  }

  async #bounded<T>(
    promise: Promise<T>,
    generation = this.#generation,
    requestId?: string,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        cancel = () => reject(new Error('Graphic preparation was disposed.'));
        this.#cancellations.add(cancel);
        if (requestId)
          this.#preparations.set(requestId, () =>
            reject(new SupersededOperation('Preparation superseded.')),
          );
        timeout = setTimeout(
          () => reject(new Error('Graphic resources did not become ready within 30 seconds.')),
          TIMEOUT_MS,
        );
      });
      const result = await Promise.race([promise, aborted]);
      this.#assertLive(generation);
      return result;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (cancel) this.#cancellations.delete(cancel);
      if (requestId && generation === this.#generation) this.#preparations.delete(requestId);
    }
  }

  #template(id: string): CompiledTransitionLogicTemplate {
    const template = this.#descriptor!.templates.find((entry) => entry.id === id);
    if (!template) throw new Error(`Missing compiled template ${id}.`);
    return template;
  }

  #queueRule(sourceId: string, mount: TransitionLogicMount, work: TransitionLogicRuleWork): void {
    if (!this.#loaded || this.#renderError) return;
    const id = `${sourceId}/${work.id}`;
    const cause = work.pointer
      ? []
      : this.#activeRuleCause.length
        ? this.#activeRuleCause
        : (this.#mountRuleCauses.get(mount) ?? []);
    if (cause.includes(id) || cause.length >= MAX_RULE_CHAIN) {
      this.#failRules(new Error(`Rules playout cycle stopped at ${id}.`));
      return;
    }
    if (this.#ruleWork.length >= MAX_PENDING_RULES) {
      this.#failRules(new Error('Rules playout exceeded 10000 pending events.'));
      return;
    }
    this.#ruleWork.push({ ...work, id, cause: [...cause, id], order: this.#ruleOrder++ });
    this.#kickRules();
  }

  #failRules(cause: unknown): void {
    this.#renderError = cause instanceof Error ? cause : new Error(String(cause));
    this.#failPlayBatch(this.#renderError);
    this.#ruleWork = [];
    this.#player?.pause();
    for (const waiter of this.#waiters.values()) waiter.reject(this.#renderError);
    this.#waiters.clear();
    this.#publish(true);
  }

  #kickRules(): void {
    if (
      this.#renderType !== 'realtime' ||
      this.#ruleMicrotaskPending ||
      this.#drainingRules ||
      !this.#ruleWork.some((work) => work.frame <= this.#frame)
    )
      return;
    const generation = this.#generation;
    this.#ruleMicrotaskPending = true;
    queueMicrotask(() => {
      if (generation !== this.#generation) return;
      this.#ruleMicrotaskPending = false;
      if (!this.#loaded || this.#renderError || this.#rulePreparationCount) return;
      void this.#drainRules(this.#frame).catch((cause: unknown) => {
        if (generation === this.#generation) this.#failRules(cause);
      });
    });
  }

  async #drainRules(until: number): Promise<void> {
    if (this.#drainingRules || this.#playBatch?.presentationPending) return;
    const generation = this.#generation;
    this.#drainingRules = true;
    let count = 0;
    try {
      for (;;) {
        this.#assertLive(generation);
        this.#ruleWork.sort((a, b) => a.frame - b.frame || a.order - b.order);
        const work = this.#ruleWork[0];
        if (!work || work.frame > until) return;
        this.#ruleWork.shift();
        if (++count > MAX_PENDING_RULES) throw new Error('Rules playout event limit exceeded.');
        const caused = <T>(operation: () => T): T => {
          const previousCause = this.#activeRuleCause;
          const previousPointer = this.#activePointerRule;
          this.#activeRuleCause = work.cause;
          this.#activePointerRule = Boolean(work.pointer);
          try {
            return operation();
          } finally {
            this.#activeRuleCause = previousCause;
            this.#activePointerRule = previousPointer;
          }
        };
        const actions = caused(() => work.run());
        for (const action of actions) {
          // Local set-data/custom-action rules can synchronously enqueue further work, too.
          // Release the causal scope before awaiting resources so unrelated commands stay independent.
          const command = caused(() => this.#runPlayoutRule(action, work.data));
          const result = await command;
          this.#assertLive(generation);
          if (result.statusCode !== 200)
            throw new Error(result.statusMessage ?? 'A Rules playout action failed.');
        }
        this.#render(this.#frame);
        if (this.#renderType === 'realtime') until = this.#frame;
      }
    } finally {
      if (generation === this.#generation) {
        this.#drainingRules = false;
        this.#kickRules();
      }
    }
  }

  async #runPlayoutRule(
    action: RuntimePlayoutRuleAction,
    effectiveData: Record<string, unknown>,
  ): Promise<ReturnPayload> {
    const errors = visualRulePlayoutActionErrors(action);
    if (errors.length) throw new Error(errors.join(' '));
    this.#validateState(action.slotId, null);
    if (action.operation === 'update') {
      const slot = this.#session!.slots[action.slotId]!;
      const selection = slot.transition ? slot.transition.to : slot.settled;
      if (!selection)
        throw new Error(`Cannot Update lane ${action.slotId} while it is Off or leaving.`);
      if (action.stateId !== undefined && action.stateId !== selection.stateId)
        throw new Error(`Update expected template ${action.stateId} in lane ${action.slotId}.`);
      const target = this.#template(selection.templateId);
      const knownKeys = new Set([
        ...Object.keys(target.dataDefaults ?? {}),
        ...target.descriptor.layers.flatMap((layer) =>
          (layer.bindings ?? []).map((binding) => binding.dataKey),
        ),
      ]);
      const patch =
        action.data === undefined
          ? Object.fromEntries(Object.entries(effectiveData).filter(([key]) => knownKeys.has(key)))
          : dataRecord(action.data);
      const data = { ...selection.data, ...patch };
      if (JSON.stringify(data) === JSON.stringify(selection.data)) return { statusCode: 200 };
      return this.#custom(
        {
          id: 'transition.take',
          payload: { slotId: action.slotId, stateId: selection.stateId, data },
        },
        false,
      );
    }
    return this.#custom(
      {
        id: `transition.${action.operation}`,
        payload: {
          slotId: action.slotId,
          ...(action.operation === 'take'
            ? {
                stateId: action.stateId,
                ...(action.data === undefined ? {} : { data: action.data }),
              }
            : {}),
        },
      },
      false,
    );
  }

  /** Visit transition boundaries before delayed rule frames so replay never fires in the future. */
  async #advanceWithRules(target: number): Promise<void> {
    let visits = 0;
    for (;;) {
      if (++visits > MAX_PENDING_RULES) throw new Error('Rules replay event limit exceeded.');
      const next = Math.min(
        target,
        ...this.#ruleWork.filter((entry) => entry.frame >= this.#frame).map((entry) => entry.frame),
        ...[...this.#mounts.values(), ...this.#shared.values()].flatMap((mount) => {
          const alarm = mount.nextAlarmFrame?.(this.#frame);
          return alarm === undefined ? [] : [alarm];
        }),
        ...Object.values(this.#session!.slots).flatMap((slot) =>
          slot.transition && slot.transition.endFrame > this.#frame
            ? [slot.transition.endFrame]
            : [],
        ),
      );
      this.#advanceAndRender(next);
      await this.#readyVisible();
      await this.#drainRules(next);
      await this.#progressPlayBatch();
      if (next >= target) return;
    }
  }

  #validateState(slotId: string, stateId: unknown): asserts stateId is string | null {
    if (!this.#definition!.slots.some((slot) => slot.id === slotId))
      throw new Error(`Unknown slot ${slotId}.`);
    if (
      stateId !== null &&
      (typeof stateId !== 'string' ||
        !this.#definition!.states.some((state) => state.slotId === slotId && state.id === stateId))
    )
      throw new Error(`State ${String(stateId)} does not belong to slot ${slotId}.`);
  }

  #timerActionRoutes(
    slotId: string,
    selection: TransitionLogicSelection,
    actionId: string,
  ): Map<TransitionLogicMount, string> | null {
    const timer = parseClockTimerActionId(actionId);
    if (!timer) return null;
    const template = this.#template(selection.templateId);
    const routes = new Map<TransitionLogicMount, string>();
    const shared = this.#definition!.sharedInstances.flatMap((instance) => {
      const mount = this.#shared.get(instance.id);
      const related = instance.slotId
        ? instance.slotId === slotId
        : this.#sharedData(instance.id, selection) !== null;
      const source = this.#descriptor!.sharedInstances.find((entry) => entry.id === instance.id);
      return mount && source && related && this.#activeShared.has(mount)
        ? [{ instance, mount, descriptor: source.descriptor }]
        : [];
    });
    let qualified: string[] | undefined;
    try {
      const value: unknown = JSON.parse(timer.layerId);
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        value.every((part) => typeof part === 'string')
      )
        qualified = value;
    } catch {
      // Ordinary layer IDs are not instance-qualified shared keys.
    }
    const aliases = template.sharedLayers.filter((link) => link.layerId === timer.layerId);
    if (qualified) {
      const target = shared.find((entry) => entry.instance.id === qualified[0]);
      if (target && ownsClock(target.descriptor, qualified[1]!))
        routes.set(target.mount, clockTimerActionId(qualified[1]!, timer.command));
    } else if (aliases.length) {
      for (const link of aliases) {
        const target = shared.find((entry) => entry.instance.id === link.instanceId);
        if (target && ownsClock(target.descriptor, link.sourceLayerId))
          routes.set(
            target.mount,
            remapClockTimerActionId(actionId, new Map([[link.layerId, link.sourceLayerId]])),
          );
      }
    } else if (ownsClock(template.descriptor, timer.layerId)) {
      const mount = this.#mounts.get(snapshotKey(selection));
      if (mount) routes.set(mount, actionId);
    } else {
      const targets = shared.filter((entry) => ownsClock(entry.descriptor, timer.layerId));
      if (targets.length > 1)
        throw new Error(
          `Timer action ${actionId} is ambiguous in lane ${slotId}. Select an instance-specific action.`,
        );
      if (targets[0]) routes.set(targets[0].mount, actionId);
    }
    if (!routes.size)
      throw new Error(`Unknown or inactive timer action ${actionId} in lane ${slotId}.`);
    return routes;
  }

  #slotLoopMounts(slotId: string): TransitionLogicMount[] {
    if (!this.#session || !this.#definition) return [];
    const slot = this.#session.slots[slotId];
    if (!slot) return [];
    const selections = [slot.settled, slot.transition?.from, slot.transition?.to].filter(
      (value): value is TransitionLogicSelection => !!value,
    );
    if (!selections.length) return [];
    const mounts = selections
      .map((selection) => this.#mounts.get(snapshotKey(selection)))
      .filter((mount): mount is TransitionLogicMount => !!mount);
    for (const [instanceId, mount] of this.#shared) {
      const instance = this.#definition.sharedInstances.find((entry) => entry.id === instanceId);
      if (
        instance?.slotId === slotId ||
        (instance &&
          !instance.slotId &&
          selections.some((selection) => this.#sharedData(instanceId, selection) !== null))
      )
        mounts.push(mount);
    }
    return [...new Set(mounts)];
  }

  #defaultData(stateId: string | null): Record<string, unknown> {
    const state = this.#definition!.states.find((entry) => entry.id === stateId);
    return state
      ? jsonCopy({
          ...this.#template(state.templateId).descriptor.dataDefaults,
          ...this.#template(state.templateId).dataDefaults,
          ...state.dataDefaults,
          ...this.#retainedData.get(state.id),
        })
      : {};
  }

  #validateActivation(slotId: string, stateId: string | null, checkAdmission = true): void {
    if (stateId === null) return;
    const admissionError = transitionLogicAdmissionError(
      this.#definition!,
      this.#session!,
      slotId,
      stateId,
      [...this.#prepared].flatMap(([id, entry]) =>
        entry.snapshot.stateId !== null && entry.snapshot.status !== 'failed' ? [id] : [],
      ),
    );
    if (checkAdmission && admissionError) throw new AdmissionDenied(admissionError);
    const replaces = new Set(
      (
        this.#definition!.states.find((state) => state.id === stateId)?.takeOutSlotIds ?? []
      ).flatMap((id) => transitionLogicOutSlotIds(this.#definition!, id)),
    );
    for (const [parentId, parent] of Object.entries(this.#session!.slots)) {
      if (parent.takeover?.outSlotIds.includes(slotId) && !replaces.has(parentId))
        throw new Error(
          `Slot ${slotId} cannot Take while slot ${parentId} is taking over; Take it explicitly after the takeover finishes.`,
        );
      if (!parent.outCascade?.slotIds.includes(slotId)) continue;
      if (
        [parentId, ...parent.outCascade.slotIds].some((id) => {
          const slot = this.#session!.slots[id]!;
          return (
            (slot.transition !== null && slot.transition.to === null) ||
            (slot.pending !== null && slot.pending.selection === null)
          );
        })
      )
        throw new Error(
          `Slot ${slotId} cannot Take while parent ${parentId} is exiting; Take it explicitly after the parent returns.`,
        );
    }
  }

  #releasePlayResources(batch: CoordinatedPlayBatch): void {
    const mounted = new Set(this.#mounts.values());
    for (const resource of batch.resources.values()) {
      if (resource.mount && !mounted.has(resource.mount)) resource.mount.dispose();
      for (const probe of resource.shared) this.#releaseProbe(probe);
    }
    batch.resources.clear();
  }

  #cancelStartupPlay(): void {
    const startup = this.#startupPlay;
    if (!startup) return;
    this.#startupPlay = null;
    for (const requestId of startup.batch.requestIds) this.#preparations.get(requestId)?.();
    this.#releasePlayResources(startup.batch);
    startup.batch.reject(new SupersededOperation('Startup preparation was superseded.'));
  }

  #cancelPlayBatch(message = 'Coordinated Play was superseded.'): void {
    this.#cancelStartupPlay();
    const batch = this.#playBatch;
    if (!batch) return;
    this.#playBatch = null;
    for (const requestId of batch.requestIds) this.#preparations.get(requestId)?.();
    this.#releasePlayResources(batch);
    batch.reject(new SupersededOperation(message));
  }

  #failPlayBatch(cause: unknown): void {
    const batch = this.#playBatch;
    if (!batch) return;
    this.#playBatch = null;
    batch.failure = cause;
    for (const requestId of batch.requestIds) this.#preparations.get(requestId)?.();
    this.#releasePlayResources(batch);
    batch.reject(cause);
  }

  /** One pending absolute frame target; async stage readiness cannot overlap or rewind RAFs. */
  #advanceRealtimeBatch(frame: number, generation: number): void {
    this.#realtimeFrameTarget = Math.max(this.#realtimeFrameTarget, frame);
    if (this.#playBatch?.presentationPending) return;
    if (this.#realtimeAdvance) return;
    const work = (async () => {
      while (this.#loaded && generation === this.#generation && !this.#renderError) {
        if (this.#playBatch?.presentationPending) return;
        const target = this.#realtimeFrameTarget;
        if (target <= this.#frame) return;
        if (this.#playBatch && !this.#playBatch.preparing) await this.#advanceWithRules(target);
        else this.#advanceAndRender(target);
      }
    })();
    this.#realtimeAdvance = work;
    void work
      .catch((cause: unknown) => {
        if (!this.#loaded || generation !== this.#generation) return;
        this.#renderError = cause instanceof Error ? cause : new Error(String(cause));
        this.#failPlayBatch(this.#renderError);
        this.#player?.dispose();
        for (const waiter of this.#waiters.values()) waiter.reject(this.#renderError);
        this.#waiters.clear();
        this.#publish(true);
      })
      .finally(() => {
        if (this.#realtimeAdvance !== work) return;
        this.#realtimeAdvance = null;
        if (
          this.#loaded &&
          generation === this.#generation &&
          !this.#renderError &&
          !this.#playBatch?.presentationPending &&
          this.#realtimeFrameTarget > this.#frame
        )
          this.#advanceRealtimeBatch(this.#realtimeFrameTarget, generation);
      });
  }

  #assertPlayBatch(batch: CoordinatedPlayBatch): void {
    this.#assertLive(batch.generation);
    if (this.#playBatch !== batch && this.#startupPlay?.batch !== batch)
      throw new SupersededOperation('Coordinated Play was superseded.');
  }

  #createPlayBatch(
    stages: CoordinatedPlayBatch['stages'],
    skipAnimation = false,
  ): CoordinatedPlayBatch {
    let resolve = () => {};
    let reject = (_cause: unknown) => {};
    const completion = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void completion.catch(() => {});
    return {
      id: ++this.#playBatchNumber,
      generation: this.#generation,
      controls: jsonCopy(this.#controls),
      stages,
      resources: new Map(),
      requestIds: new Set(),
      index: 0,
      waiting: null,
      preparing: true,
      presentationPending: false,
      committed: false,
      finished: false,
      skipAnimation,
      cause: [...this.#activeRuleCause],
      pointer: this.#activePointerRule,
      work: null,
      completion,
      resolve,
      reject,
    };
  }

  /** Prepare only the initially selected Play, without publishing Prepare or changing occupancy. */
  async #prepareStartupPlay(): Promise<void> {
    const requested = Object.fromEntries(
      Object.entries(this.#controls.slots).map(([id, value]) => [id, value.stateId]),
    );
    const planned = planTransitionLogicPlay(this.#definition!, this.#session!, requested, []);
    // Invalid/conflicting operator selections retain their existing Play-time validation.
    if (!planned.valid) return;
    const batch = this.#createPlayBatch(planned.stages);
    const startup = { batch, preparation: Promise.resolve() };
    this.#startupPlay = startup;
    startup.preparation = this.#preparePlayResources(batch).catch((cause: unknown) => {
      if (this.#startupPlay === startup) this.#cancelStartupPlay();
      throw cause;
    });
    try {
      await startup.preparation;
    } catch {
      // A cold local renderer previously failed on Play, not Load. Release the hidden probe;
      // a later Play retries through its ordinary resource/error barrier.
    }
  }

  #completePlayBatch(batch: CoordinatedPlayBatch): void {
    if (this.#playBatch !== batch || batch.finished) return;
    batch.finished = true;
    this.#playBatch = null;
    this.#releasePlayResources(batch);
    batch.resolve();
    this.#scheduleWarmup();
  }

  #acknowledgeFinalPlayBarrier(): void {
    const batch = this.#playBatch;
    if (
      !batch ||
      batch.preparing ||
      batch.presentationPending ||
      !batch.waiting ||
      batch.index !== batch.stages.length - 1 ||
      !this.#playTargetsSettled(this.#session!, batch.waiting)
    )
      return;
    this.#completePlayBatch(batch);
  }

  #playTargetsSettled(
    session: TransitionLogicSession,
    targets: Array<{ slotId: string; stateId: string | null }>,
  ): boolean {
    return targets.every(({ slotId, stateId }) => {
      const slot = session.slots[slotId]!;
      if (slot.transition || slot.pending) return false;
      return stateId === null ? !slot.settled && !slot.desired : slot.settled?.stateId === stateId;
    });
  }

  #samePlaySelection(
    session: TransitionLogicSession,
    slotId: string,
    stateId: string | null,
    data: Record<string, unknown>,
  ): boolean {
    const slot = session.slots[slotId]!;
    if (slot.pending) return false;
    const incoming = slot.transition ? slot.transition.to : slot.settled;
    return (
      stateId !== null &&
      incoming?.stateId === stateId &&
      JSON.stringify(incoming.data) === JSON.stringify(data)
    );
  }

  #playStageTargets(batch: CoordinatedPlayBatch, stage: CoordinatedPlayBatch['stages'][number]) {
    const values = new Map<string, string | null>();
    for (const slotId of stage.outSlotIds)
      for (const id of transitionLogicOutSlotIds(this.#definition!, slotId)) values.set(id, null);
    for (const slotId of stage.takeSlotIds)
      values.set(slotId, batch.controls.slots[slotId]!.stateId);
    return [...values].map(([slotId, stateId]) => ({ slotId, stateId }));
  }

  #deferSkippedStagePresentation(
    batch: CoordinatedPlayBatch,
    stage: CoordinatedPlayBatch['stages'][number],
  ): boolean {
    if (this.#renderType !== 'realtime' || !batch.skipAnimation || this.#drainingRules)
      return false;
    let requests = stage.outSlotIds.filter((id) => {
      const slot = this.#session!.slots[id]!;
      return slot.settled || slot.transition || slot.pending;
    }).length;
    for (const id of stage.takeSlotIds) {
      const value = batch.controls.slots[id]!;
      const state = this.#definition!.states.find((entry) => entry.id === value.stateId);
      const data = state
        ? dataRecord(this.resolveTemplateData(state.templateId, value.data))
        : value.data;
      if (this.#samePlaySelection(this.#session!, id, value.stateId, data)) continue;
      if (!batch.resources.has(id)) return false;
      requests++;
    }
    return requests > 1;
  }

  /** Simulate the complete intent on a copy, then prepare its exact resource snapshots Off air. */
  async #preparePlayResources(batch: CoordinatedPlayBatch): Promise<void> {
    let projected = jsonCopy(this.#session!);
    let frame = this.#frame;
    for (const stage of batch.stages) {
      for (const slotId of [...stage.outSlotIds, ...stage.takeSlotIds]) {
        this.#assertPlayBatch(batch);
        const stateId = stage.outSlotIds.includes(slotId)
          ? null
          : batch.controls.slots[slotId]!.stateId;
        const state = this.#definition!.states.find((state) => state.id === stateId);
        const values = batch.controls.slots[slotId]!.data;
        const data = state
          ? dataRecord(this.resolveTemplateData(state.templateId, values))
          : values;
        const current = projected.slots[slotId]!;
        if (this.#samePlaySelection(projected, slotId, stateId, data)) continue;
        if (
          !current.transition &&
          !current.pending &&
          (stateId === null
            ? current.settled === null
            : current.settled?.stateId === stateId &&
              JSON.stringify(current.settled.data) === JSON.stringify(data))
        )
          continue;
        const requestId = `play-${batch.id}-${++this.#requestNumber}`;
        batch.requestIds.add(requestId);
        const requested = reduceTransitionLogic(this.#definition!, projected, {
          type: 'request',
          frame,
          requestId,
          slotId,
          stateId,
          data,
        });
        const rejected = requested.effects.find((effect) => effect.type === 'rejected');
        if (rejected?.type === 'rejected') throw new AdmissionDenied(rejected.message);
        projected = requested.session;
        const selection = projected.slots[slotId]!.pending?.selection;
        if (selection) {
          this.#requestRuleCauses.set(requestId, [...batch.cause]);
          const mount = this.#mountSelection(selection, true);
          this.#mounts.delete(snapshotKey(selection));
          mount.host.style.visibility = 'hidden';
          const resource: PreparedSlotResources = {
            snapshot: {
              slotId,
              stateId,
              templateId: selection.templateId,
              data,
              requestId,
              status: 'ready',
              error: null,
            },
            mount,
            shared: [],
          };
          batch.resources.set(slotId, resource);
          resource.shared = this.#stageShared(slotId, selection);
          projected = reduceTransitionLogic(this.#definition!, projected, {
            type: 'ready',
            frame,
            requestId,
            slotId,
          }).session;
        }
      }
      const targets = this.#playStageTargets(batch, stage);
      let visits = 0;
      while (!this.#playTargetsSettled(projected, targets)) {
        if (++visits > MAX_PENDING_RULES)
          throw new Error('Coordinated Play planning limit exceeded.');
        const boundaries = Object.values(projected.slots).flatMap((slot) =>
          slot.transition && slot.transition.endFrame > frame ? [slot.transition.endFrame] : [],
        );
        if (!boundaries.length)
          throw new Error('Coordinated Play cannot satisfy its dependency barrier.');
        frame = Math.min(...boundaries);
        projected = reduceTransitionLogic(this.#definition!, projected, {
          type: 'advance',
          frame,
        }).session;
      }
    }
    await this.#waitForPlayResources(batch);
  }

  async #waitForPlayResources(batch: CoordinatedPlayBatch): Promise<void> {
    await Promise.all(
      [...batch.resources.values()].map((resource) =>
        this.#bounded(
          (async () => {
            const mounts = [...(resource.mount ? [resource.mount] : []), ...resource.shared];
            await Promise.all(mounts.map((mount) => mount.ready));
            this.#assertPlayBatch(batch);
            // Finish the renderer's current draw/decode readiness while every probe is hidden.
            await Promise.all(mounts.map((mount) => mount.waitReady()));
          })(),
          batch.generation,
          resource.snapshot.requestId,
        ),
      ),
    );
    this.#assertPlayBatch(batch);
  }

  #kickPlayBatch(): void {
    if (
      this.#renderType !== 'realtime' ||
      !this.#playBatch ||
      this.#playBatch.preparing ||
      this.#playBatchMicrotaskPending
    )
      return;
    this.#playBatchMicrotaskPending = true;
    const generation = this.#generation;
    queueMicrotask(() => {
      if (generation !== this.#generation) return;
      this.#playBatchMicrotaskPending = false;
      void this.#progressPlayBatch().catch(() => {});
    });
  }

  /** Starts the next stage at the actual barrier frame; never advances the clock itself. */
  #progressPlayBatch(): Promise<void> {
    const batch = this.#playBatch;
    if (!batch || batch.preparing) return Promise.resolve();
    if (batch.work) return batch.work;
    let deferredPresentation = false;
    const work = (async () => {
      for (;;) {
        if (batch.finished) return;
        this.#assertPlayBatch(batch);
        if (batch.waiting) {
          if (!this.#playTargetsSettled(this.#session!, batch.waiting)) return;
          batch.waiting = null;
          batch.index++;
        }
        const stage = batch.stages[batch.index];
        if (!stage) {
          if (!batch.committed) this.#currentStep = 0;
          this.#completePlayBatch(batch);
          return;
        }
        if (!batch.committed) {
          const checked = planTransitionLogicPlay(
            this.#definition!,
            this.#session!,
            Object.fromEntries(
              Object.entries(batch.controls.slots).map(([id, value]) => [id, value.stateId]),
            ),
            [...this.#prepared].flatMap(([id, value]) =>
              value.snapshot.stateId !== null && value.snapshot.status !== 'failed' ? [id] : [],
            ),
          );
          if (!checked.valid) throw new AdmissionDenied(checked.errors.join(' '));
          batch.committed = true;
          this.#currentStep = 0;
        }
        batch.waiting = this.#playStageTargets(batch, stage);
        const deferPresentation = this.#deferSkippedStagePresentation(batch, stage);
        if (deferPresentation) {
          deferredPresentation = true;
          batch.presentationPending = true;
          this.#rulePreparationCount++;
        }
        const previousCause = this.#activeRuleCause;
        const previousPointer = this.#activePointerRule;
        try {
          this.#activeRuleCause = batch.cause;
          this.#activePointerRule = batch.pointer;
          const requests: Promise<void>[] = [];
          try {
            for (const id of stage.outSlotIds) {
              if (batch.finished) break;
              this.#assertPlayBatch(batch);
              const request = this.#take(
                id,
                null,
                {},
                batch.skipAnimation,
                undefined,
                false,
                deferPresentation,
              );
              void request.catch(() => {});
              requests.push(request);
            }
            for (const id of stage.takeSlotIds) {
              if (batch.finished) break;
              this.#assertPlayBatch(batch);
              const value = batch.controls.slots[id]!;
              const selectedState = this.#definition!.states.find(
                (state) => state.id === value.stateId,
              );
              const resolved = selectedState
                ? dataRecord(this.resolveTemplateData(selectedState.templateId, value.data))
                : value.data;
              if (this.#samePlaySelection(this.#session!, id, value.stateId, resolved)) continue;
              const request = this.#take(
                id,
                value.stateId,
                value.data,
                batch.skipAnimation,
                batch.resources.get(id),
                false,
                deferPresentation,
              );
              void request.catch(() => {});
              requests.push(request);
            }
          } finally {
            this.#activeRuleCause = previousCause;
            this.#activePointerRule = previousPointer;
          }
          await Promise.all(requests);
          if (deferPresentation) {
            this.#assertPlayBatch(batch);
            // Each request retains its planner/lifecycle events. Present the complete skipped
            // stage once, with Rules held until every resulting visible renderer is ready.
            this.#render(this.#frame, true);
            await this.#readyVisible();
            this.#assertPlayBatch(batch);
            for (const id of stage.takeSlotIds) batch.resources.delete(id);
            batch.presentationPending = false;
            // A final Played In Rule may Clear its own lane after On has been acknowledged.
            this.#acknowledgeFinalPlayBarrier();
          }
        } finally {
          if (deferPresentation) {
            batch.presentationPending = false;
            if (batch.generation === this.#generation) {
              --this.#rulePreparationCount;
              this.#kickRules();
            }
          }
        }
        if (batch.finished) return;
        this.#assertPlayBatch(batch);
        for (const id of stage.takeSlotIds) batch.resources.delete(id);
        if (deferPresentation) {
          // Preserve dependency barriers: due parent Rules can cancel planned children before
          // the next stage issues any request, including when all stages share one frame.
          try {
            await this.#drainRules(this.#frame);
          } catch (cause) {
            this.#failRules(cause);
            throw cause;
          }
          this.#assertPlayBatch(batch);
        }
      }
    })();
    batch.work = work;
    void work
      .catch((cause: unknown) => {
        if (this.#playBatch !== batch) return;
        this.#playBatch = null;
        for (const requestId of batch.requestIds) this.#preparations.get(requestId)?.();
        this.#releasePlayResources(batch);
        batch.reject(cause);
      })
      .finally(() => {
        if (batch.work === work) batch.work = null;
        if (
          deferredPresentation &&
          this.#renderType === 'realtime' &&
          this.#loaded &&
          batch.generation === this.#generation &&
          !this.#renderError &&
          !this.#playBatch?.presentationPending &&
          this.#realtimeFrameTarget > this.#frame
        )
          this.#advanceRealtimeBatch(this.#realtimeFrameTarget, batch.generation);
      });
    return work;
  }

  #defaultControls(): TransitionLogicControlData {
    const startup = safeTransitionLogicStartupStates(this.#definition!);
    const slots = Object.fromEntries(
      this.#definition!.slots.map((slot) => {
        const stateId = startup[slot.id] ?? null;
        return [slot.id, { stateId, data: this.#defaultData(stateId) }];
      }),
    );
    return this.#mergeControls({ slots }, this.#descriptor!.dataDefaults);
  }

  #mergeControls(
    base: TransitionLogicControlData,
    patch: unknown,
    external = false,
  ): TransitionLogicControlData {
    if (patch === undefined) return jsonCopy(base);
    if (
      !object(patch) ||
      Object.keys(patch).some((key) => key !== 'slots') ||
      (patch.slots !== undefined && !object(patch.slots))
    )
      throw new TypeError('Coordinated data must be an object containing slots.');
    const next = jsonCopy(base);
    for (const [slotId, value] of Object.entries(patch.slots ?? {})) {
      if (!object(value) || Object.keys(value).some((key) => key !== 'stateId' && key !== 'data'))
        throw new TypeError(`Slot ${slotId} accepts stateId and data.`);
      const chosen = Object.hasOwn(value, 'stateId') ? value.stateId : next.slots[slotId]?.stateId;
      const stateId = chosen === '' ? null : chosen;
      this.#validateState(slotId, stateId);
      const before = next.slots[slotId];
      const previousData = before?.stateId === stateId ? before.data : this.#defaultData(stateId);
      next.slots[slotId] = {
        stateId,
        data: {
          ...previousData,
          ...(value.data === undefined
            ? {}
            : external
              ? this.#externalStateData(stateId, value.data, previousData)
              : dataRecord(value.data)),
        },
      };
    }
    return next;
  }

  #validateAction(
    type: ScheduledAction['action']['type'],
    value: unknown,
    controls = this.#controls,
    external = false,
  ): TransitionLogicControlData {
    if (!object(value)) throw new TypeError('Action parameters must be an object.');
    if (value.skipAnimation !== undefined && typeof value.skipAnimation !== 'boolean')
      throw new TypeError('skipAnimation must be a boolean.');
    const allowed =
      type === 'updateAction'
        ? ['data', 'skipAnimation']
        : type === 'playAction'
          ? ['goto', 'delta', 'skipAnimation']
          : type === 'customAction'
            ? ['id', 'payload', 'skipAnimation']
            : ['skipAnimation'];
    if (Object.keys(value).some((key) => !allowed.includes(key)))
      throw new Error(`Unknown ${type} parameter.`);
    if (type === 'updateAction') {
      if (!object(value.data)) throw new TypeError('updateAction requires data.');
      return this.#mergeControls(controls, value.data, external);
    }
    if (type === 'playAction') {
      for (const key of ['goto', 'delta'])
        if (value[key] !== undefined && !Number.isSafeInteger(value[key]))
          throw new Error(`${key} must be an integer.`);
      if (value.goto !== undefined && value.delta !== undefined)
        throw new Error('Use either goto or delta.');
    }
    if (type === 'customAction') {
      if (value.id === 'transition.patch') {
        const payload = value.payload;
        if (
          !object(payload) ||
          Object.keys(payload).some((key) => !['slotId', 'stateId', 'data'].includes(key)) ||
          typeof payload.slotId !== 'string'
        )
          throw new TypeError('Data patch requires slotId, optional stateId guard and data.');
        this.#validateState(payload.slotId, null);
        if (payload.stateId !== undefined && typeof payload.stateId !== 'string')
          throw new TypeError('The optional patch stateId guard must be a string.');
        if (payload.stateId !== undefined && payload.stateId !== '')
          this.#validateState(payload.slotId, payload.stateId);
        boundedPatchData(payload.data);
        return controls;
      }
      if (value.id === 'template.action') {
        if (
          !object(value.payload) ||
          Object.keys(value.payload).some((key) => !['slotId', 'actionId', 'data'].includes(key)) ||
          typeof value.payload.slotId !== 'string' ||
          typeof value.payload.actionId !== 'string' ||
          !value.payload.actionId.trim()
        )
          throw new TypeError('Template action requires slotId and actionId.');
        this.#validateState(value.payload.slotId, null);
        if (value.payload.data !== undefined) dataRecord(value.payload.data);
        return controls;
      }
      if (['loop.pause', 'loop.resume', 'loop.next'].includes(String(value.id))) {
        if (
          !object(value.payload) ||
          Object.keys(value.payload).some((key) => !['slotId', 'groupId'].includes(key)) ||
          typeof value.payload.slotId !== 'string' ||
          typeof value.payload.groupId !== 'string' ||
          !value.payload.groupId.trim()
        )
          throw new TypeError('Loop action requires slotId and groupId.');
        this.#validateState(value.payload.slotId, null);
        return controls;
      }
      if (!['transition.take', 'transition.out', 'transition.clear'].includes(String(value.id)))
        throw new Error(`Unknown custom action ${String(value.id)}.`);
      if (!object(value.payload))
        throw new TypeError('Transition action payload must be an object.');
      const payload = value.payload;
      const keys = value.id === 'transition.take' ? ['slotId', 'stateId', 'data'] : ['slotId'];
      if (Object.keys(payload).some((key) => !keys.includes(key)))
        throw new Error('Unknown transition action payload field.');
      if (value.id === 'transition.clear' && payload.slotId === undefined) return controls;
      if (typeof payload.slotId !== 'string') throw new Error('slotId is required.');
      const stateId =
        value.id !== 'transition.take' || payload.stateId === '' ? null : payload.stateId;
      this.#validateState(payload.slotId, stateId);
      if (payload.data !== undefined) dataRecord(payload.data);
      if (value.id === 'transition.take')
        return this.#mergeControls(
          controls,
          {
            slots: {
              [payload.slotId]: {
                stateId,
                ...(payload.data === undefined ? {} : { data: payload.data }),
              },
            },
          },
          external,
        );
    }
    return controls;
  }

  #bindSelectionTimerAlarms(
    selection: TransitionLogicSelection,
    mount: TransitionLogicMount,
  ): void {
    const template = this.#template(selection.templateId);
    const slotId = this.#definition!.states.find((state) => state.id === selection.stateId)!.slotId;
    for (const link of template.sharedLayers) {
      const canonical = this.#shared.get(link.instanceId);
      if (canonical)
        mount.bindTimerAlarmSource?.(
          link.layerId,
          canonical,
          link.sourceLayerId,
          JSON.stringify([slotId, selection.instanceId, template.id, link.layerId]),
        );
    }
  }

  #clockOptions(): { clockEpoch?: number; getClockEpoch?: () => number } {
    if (!this.#useClockEpoch) return {};
    return this.#renderType === 'realtime'
      ? { clockEpoch: this.#epoch, getClockEpoch: () => this.#epoch }
      : { clockEpoch: this.#epoch };
  }

  /** Diagnostic counts only; prepared resources never become an operator selection. */
  getPreparationCacheSnapshot() {
    return {
      ...this.#instanceCache.stats,
      maxEntries: DEFAULT_PREPARED_INSTANCE_LIMIT,
      maxEstimatedBytes: DEFAULT_PREPARED_INSTANCE_BYTES,
      preparing: this.#warmInFlight !== null,
      enabled: this.#loaded && this.#renderType === 'realtime',
    };
  }

  #cancelWarmup(): void {
    ++this.#warmToken;
    this.#warmCancel?.();
    this.#warmCancel = null;
    this.#warmInFlight?.mount.dispose();
    this.#warmInFlight = null;
  }

  #instanceKey(selection: TransitionLogicSelection): string {
    // A new Take gets a new request/instance identity; dormant resources have neither yet.
    return JSON.stringify(['template', selection.stateId, selection.templateId, selection.data]);
  }

  #sharedProbeKey(instanceId: string, data: Record<string, unknown>): string {
    return JSON.stringify(['shared', instanceId, data]);
  }

  #estimatePreparedBytes(descriptor: CompiledGraphicDescriptor): number {
    // Deliberately conservative backing-surface estimate, not a claim about driver VRAM.
    const pixels = Math.max(1, descriptor.width) * Math.max(1, descriptor.height);
    const canvasLayers = descriptor.layers.filter(
      (layer) =>
        hasElementShaderPaint(layer.element) ||
        hasElementMediaPaint(layer.element) ||
        layer.element.type === 'chart' ||
        layer.element.type === 'lottie' ||
        (layer.effects.stack ?? []).some((effect) => effect.type === 'shader'),
    ).length;
    return pixels * 4 * (1 + canvasLayers * 2) + descriptor.layers.length * 4096;
  }

  #warmBusy(): boolean {
    return (
      !this.#loaded ||
      this.#renderType !== 'realtime' ||
      !!this.#renderError ||
      !!this.#playBatch ||
      this.#rulePreparationCount > 0 ||
      this.#drainingRules ||
      Object.values(this.#session?.slots ?? {}).some((slot) => slot.transition || slot.pending)
    );
  }

  #warmCandidates(): WarmCandidate[] {
    if (!this.#definition || !this.#descriptor) return [];
    const states = this.#definition.states;
    const recentSlots = new Set(
      this.#warmRecent.flatMap((id) => states.find((state) => state.id === id)?.slotId ?? []),
    );
    const ordered = [
      ...this.#warmRecent.flatMap((id) => states.find((state) => state.id === id) ?? []),
      ...states.filter((state) => recentSlots.has(state.slotId)),
      ...states,
    ];
    const candidates = new Map<string, WarmCandidate>();
    for (const state of ordered) {
      if (
        [...(this.#startupPlay?.batch.resources.values() ?? [])].some(
          (entry) => entry.snapshot.stateId === state.id,
        )
      )
        continue;
      const template = this.#template(state.templateId);
      const control = this.#controls.slots[state.slotId];
      const data = dataRecord(
        this.resolveTemplateData(
          state.templateId,
          control?.stateId === state.id ? control.data : this.#defaultData(state.id),
        ),
      );
      const selection: TransitionLogicSelection = {
        requestId: 'warm',
        instanceId: 'warm',
        stateId: state.id,
        templateId: state.templateId,
        data,
      };
      const live = this.#session!.slots[state.slotId]!;
      const active = live.transition?.to ?? live.settled;
      const local = template.descriptor.layers.some(
        (layer) => !template.sharedLayers.some((link) => link.layerId === layer.id),
      );
      if (local && active?.stateId !== state.id) {
        const key = this.#instanceKey(selection);
        candidates.set(key, {
          key,
          selection,
          data,
          descriptor: template.descriptor,
          estimatedBytes: this.#estimatePreparedBytes(template.descriptor),
        });
      }
      for (const instance of this.#definition.sharedInstances) {
        if (instance.slotId && instance.slotId !== state.slotId) continue;
        const values = this.#sharedData(instance.id, selection, false);
        if (!values || !this.#needsSharedProbe(instance.id, values)) continue;
        const source = this.#descriptor.sharedInstances.find((entry) => entry.id === instance.id)!;
        const key = this.#sharedProbeKey(instance.id, values);
        candidates.set(key, {
          key,
          selection,
          data: values,
          descriptor: source.descriptor,
          sharedInstanceId: instance.id,
          estimatedBytes: this.#estimatePreparedBytes(source.descriptor),
        });
      }
    }
    const admitted: WarmCandidate[] = [];
    let bytes = 0;
    for (const candidate of candidates.values()) {
      if (
        this.#warmFailed.has(candidate.key) ||
        bytes + candidate.estimatedBytes > DEFAULT_PREPARED_INSTANCE_BYTES
      )
        continue;
      admitted.push(candidate);
      bytes += candidate.estimatedBytes;
      if (admitted.length === DEFAULT_PREPARED_INSTANCE_LIMIT) break;
    }
    return admitted;
  }

  #scheduleWarmup(): void {
    if (this.#warmCancel || this.#warmInFlight || this.#warmBusy()) return;
    const owner = this.ownerDocument.defaultView;
    // Do not manufacture a new clock/realm; detached previews use their document's scheduler.
    if (!owner) return;
    const candidates = this.#warmCandidates();
    // Older exact-data entries remain useful for a return Take. Let the bounded LRU evict
    // them when a new candidate needs space, rather than destroying a probe just released.
    const candidate = candidates.find((entry) => !this.#instanceCache.has(entry.key));
    if (!candidate) return;
    const token = this.#warmToken;
    const generation = this.#generation;
    const run = () => {
      this.#warmCancel = null;
      if (token !== this.#warmToken || generation !== this.#generation || this.#warmBusy()) return;
      let entry: CachedPreparedInstance;
      try {
        const selection = {
          ...candidate.selection,
          requestId: `warm-${++this.#warmNumber}`,
          instanceId: `warm-${this.#warmNumber}`,
        };
        const mount = candidate.sharedInstanceId
          ? mountTransitionLogicComposition({
              parent: this.#surface!,
              descriptor: candidate.descriptor,
              data: candidate.data,
              startFrame: this.#frame,
              ...this.#clockOptions(),
            })
          : this.#mountSelection(selection, true, true);
        this.#mounts.delete(snapshotKey(selection));
        entry = {
          key: candidate.key,
          mount,
          estimatedBytes: candidate.estimatedBytes,
          ready: false,
        };
        this.#warmInFlight = entry;
      } catch {
        this.#warmFailed.add(candidate.key);
        this.#scheduleWarmup();
        return;
      }
      void (async () => {
        try {
          await entry.mount.ready;
          await entry.mount.waitReady();
          if (token !== this.#warmToken || generation !== this.#generation || this.#warmBusy()) {
            entry.mount.dispose();
            return;
          }
          entry.ready = true;
          this.#instanceCache.put(entry.key, entry, entry.estimatedBytes);
        } catch {
          entry.mount.dispose();
          if (token === this.#warmToken && generation === this.#generation)
            this.#warmFailed.add(entry.key);
        } finally {
          if (this.#warmInFlight === entry) this.#warmInFlight = null;
          if (token === this.#warmToken && generation === this.#generation) this.#scheduleWarmup();
        }
      })();
    };
    if (owner.requestIdleCallback) {
      const id = owner.requestIdleCallback((deadline) => {
        if (deadline.timeRemaining() < 2) {
          this.#warmCancel = null;
          this.#scheduleWarmup();
        } else run();
      });
      this.#warmCancel = () => owner.cancelIdleCallback(id);
    } else {
      const id = owner.setTimeout(run, 100);
      this.#warmCancel = () => owner.clearTimeout(id);
    }
  }

  #releaseProbe(mount: TransitionLogicMount): void {
    const entry = this.#probeCacheEntries.get(mount);
    this.#probeCacheEntries.delete(mount);
    if (!entry?.ready || !this.#loaded || this.#renderType !== 'realtime' || this.#renderError) {
      mount.dispose();
      return;
    }
    const generation = this.#generation;
    this.#probeReleases.add(entry);
    void mount
      .waitReady()
      .then(
        () => {
          if (
            this.#probeReleases.has(entry) &&
            generation === this.#generation &&
            this.#loaded &&
            !this.#renderError
          )
            this.#instanceCache.put(entry.key, entry, entry.estimatedBytes);
          else mount.dispose();
        },
        () => {
          mount.dispose();
        },
      )
      .finally(() => {
        this.#probeReleases.delete(entry);
      });
  }

  #mountSelection(
    selection: TransitionLogicSelection,
    resourceProbe = false,
    warming = false,
  ): TransitionLogicMount {
    const key = snapshotKey(selection);
    const existing = this.#mounts.get(key);
    if (existing) return existing;
    const template = this.#template(selection.templateId);
    const slotId = this.#definition!.states.find((state) => state.id === selection.stateId)!.slotId;
    const slot = this.#session!.slots[slotId]!;
    const previous = warming ? null : slot.transition ? slot.transition.to : slot.settled;
    const binding = { selection };
    const cached =
      !warming && this.#renderType === 'realtime'
        ? this.#instanceCache.take(this.#instanceKey(selection))
        : undefined;
    let mount: TransitionLogicMount;
    if (cached) {
      mount = cached.mount;
      this.#mountBindings.get(mount)!.selection = selection;
      mount.prepareForTake?.(
        this.#starts.get(key) ?? this.#frame,
        previous?.templateId === selection.templateId ? previous.data : undefined,
      );
    } else {
      mount = mountTransitionLogicComposition({
        parent: this.#surface!,
        descriptor: template.descriptor,
        data: selection.data,
        startFrame: this.#starts.get(key) ?? this.#frame,
        ...this.#clockOptions(),
        deterministic: this.#renderType === 'non-realtime',
        sharedKeys: new Map(
          template.sharedLayers.map((link) => [
            link.layerId,
            sharedLayerKey(link.instanceId, link.sourceLayerId),
          ]),
        ),
        hiddenLayers: new Set(template.sharedLayers.map((link) => link.layerId)),
        ...(previous?.templateId === selection.templateId ? { previousData: previous.data } : {}),
        scheduleRule: (work) => this.#queueRule(`template:${template.id}`, mount, work),
        ruleDataChanged: (patch, frame) =>
          this.#patchSelectionData(slotId, snapshotKey(binding.selection), patch, frame),
      });
      this.#mountBindings.set(mount, binding);
    }
    if (!warming) {
      this.#warmRecent = [
        selection.stateId,
        ...this.#warmRecent.filter((id) => id !== selection.stateId),
      ];
    }
    this.#mountRuleCauses.set(mount, this.#requestRuleCauses.get(selection.requestId) ?? []);
    if (!resourceProbe) this.#bindSelectionTimerAlarms(selection, mount);
    if (
      previous?.templateId === selection.templateId &&
      previous.instanceId === selection.instanceId
    ) {
      const previousMount = this.#mounts.get(snapshotKey(previous));
      if (previousMount) {
        mount.inheritRules(previousMount, previous.data, this.#frame);
        const loopStart = this.#loopStarts.get(previousMount);
        if (loopStart !== undefined) this.#loopStarts.set(mount, loopStart);
      }
    }
    mount.host.dataset.ografTransitionTemplate = template.id;
    mount.host.dataset.ografTransitionState = selection.stateId;
    mount.host.dataset.ografTransitionSnapshot = selection.requestId;
    mount.host.style.opacity = '0';
    setTickerOutputActive(mount.host, false);
    mount.host.style.zIndex = String(
      (this.#definition!.slots.find((slot) => slot.id === slotId)?.order ?? 0) * 2 + 1,
    );
    this.#mounts.set(key, mount);
    void mount.ready.catch(() => undefined);
    return mount;
  }

  /** Local Rules update the selected data in place; they do not create an Update transition. */
  #patchSelectionData(
    slotId: string,
    key: string,
    patch: Record<string, unknown>,
    frame = this.#frame,
    skipAnimation = false,
    inPlace?: { motion: TransitionLogicUpdateMotion | undefined },
  ): void {
    const slot = this.#session!.slots[slotId]!;
    const current = slot.pending?.selection ?? slot.transition?.to ?? slot.settled;
    let updated: TransitionLogicSelection | null = null;
    const replace = (
      selection: TransitionLogicSelection | null,
    ): TransitionLogicSelection | null => {
      if (!selection || snapshotKey(selection) !== key) return selection;
      // A Take names the whole data set, so an in-place one replaces rather than merges.
      updated = {
        ...selection,
        data: inPlace ? jsonCopy(patch) : { ...selection.data, ...jsonCopy(patch) },
      };
      return updated;
    };
    const next = {
      ...slot,
      desired: replace(slot.desired),
      settled: replace(slot.settled),
      transition: slot.transition
        ? {
            ...slot.transition,
            from: replace(slot.transition.from),
            to: replace(slot.transition.to),
          }
        : null,
      pending: slot.pending
        ? { ...slot.pending, selection: replace(slot.pending.selection) }
        : null,
    };
    if (!updated) return;
    this.#session = { ...this.#session!, slots: { ...this.#session!.slots, [slotId]: next } };
    for (const cache of this.#sharedDataCache.values()) cache.delete(key);
    const synchronized = [
      next.settled,
      next.transition?.to,
      next.transition?.from,
      next.pending?.selection,
    ].find((selection) => selection && snapshotKey(selection) === key);
    if (synchronized) {
      const mount = this.#mounts.get(key);
      if (inPlace?.motion) mount?.setData(synchronized.data, frame, skipAnimation, inPlace.motion);
      else mount?.setData(synchronized.data, frame, skipAnimation);
    }
    if (current && snapshotKey(current) === key) {
      const selected = replace(current)!;
      this.#controls.slots[slotId] = { stateId: selected.stateId, data: jsonCopy(selected.data) };
      this.#retainedData.set(selected.stateId, jsonCopy(selected.data));
    }
    this.#publish(true);
  }

  #patchSharedRuleData(instanceId: string, patch: Record<string, unknown>, frame: number): void {
    for (const [slotId, slot] of Object.entries(this.#session!.slots)) {
      const selection = slot.transition?.to ?? slot.settled;
      if (!selection) continue;
      const template = this.#template(selection.templateId);
      const binding = template.sharedDataBindings.find((entry) => entry.instanceId === instanceId);
      if (!binding) continue;
      const mapped = Object.fromEntries(
        Object.entries(patch).flatMap(([key, value]) =>
          binding.fields[key] ? [[binding.fields[key]!, value]] : [],
        ),
      );
      if (Object.keys(mapped).length)
        this.#patchSelectionData(slotId, snapshotKey(selection), mapped, frame);
    }
  }

  #sharedData(
    instanceId: string,
    selection: TransitionLogicSelection,
    cacheResult = true,
  ): Record<string, unknown> | null {
    const template = this.#template(selection.templateId);
    const binding = template.sharedDataBindings.find((entry) => entry.instanceId === instanceId);
    if (!binding && !template.sharedLayers.some((entry) => entry.instanceId === instanceId))
      return null;
    const selectionKey = snapshotKey(selection);
    const cached = cacheResult
      ? this.#sharedDataCache.get(instanceId)?.get(selectionKey)
      : undefined;
    if (cached) return cached;
    const values = jsonCopy(
      this.#descriptor!.sharedInstances.find((entry) => entry.id === instanceId)!.dataDefaults ??
        {},
    );
    for (const [source, target] of Object.entries(binding?.fields ?? {}))
      if (Object.hasOwn(selection.data, target)) values[source] = selection.data[target];
    if (cacheResult) {
      let cache = this.#sharedDataCache.get(instanceId);
      if (!cache) this.#sharedDataCache.set(instanceId, (cache = new Map()));
      cache.set(selectionKey, values);
    }
    return values;
  }

  #needsSharedProbe(instanceId: string, values: Record<string, unknown>): boolean {
    const source = this.#descriptor!.sharedInstances.find((entry) => entry.id === instanceId)!;
    const active = this.#shared.get(instanceId);
    const previous =
      active && this.#activeShared.has(active) ? this.#sharedDataIdentity.get(active) : undefined;
    if (!previous) return true;
    const plainTextKeys = new Set(
      source.descriptor.layers.flatMap((layer) => [
        ...layer.bindings
          .filter(
            (binding) =>
              binding.targetProperty === 'content' ||
              binding.targetProperty === 'clock.manualValue',
          )
          .map((binding) => binding.dataKey),
        ...(layer.loop?.holdDataKey ? [layer.loop.holdDataKey] : []),
      ]),
    );
    for (const layer of source.descriptor.layers)
      for (const binding of layer.bindings)
        if (binding.targetProperty !== 'content' && binding.targetProperty !== 'clock.manualValue')
          plainTextKeys.delete(binding.dataKey);
    return [...new Set([...Object.keys(previous), ...Object.keys(values)])].some(
      (key) =>
        JSON.stringify(previous[key]) !== JSON.stringify(values[key]) && !plainTextKeys.has(key),
    );
  }

  #stageShared(slotId: string, selection: TransitionLogicSelection): TransitionLogicMount[] {
    const staged: TransitionLogicMount[] = [];
    try {
      for (const instance of this.#definition!.sharedInstances) {
        if (instance.slotId && instance.slotId !== slotId) continue;
        const values = this.#sharedData(instance.id, selection);
        if (!values) continue;
        const source = this.#descriptor!.sharedInstances.find((entry) => entry.id === instance.id)!;
        if (!this.#needsSharedProbe(instance.id, values)) continue;
        const key = this.#sharedProbeKey(instance.id, values);
        const cached = this.#renderType === 'realtime' ? this.#instanceCache.take(key) : undefined;
        const mount =
          cached?.mount ??
          mountTransitionLogicComposition({
            parent: this.#surface!,
            descriptor: source.descriptor,
            data: values,
            startFrame: 0,
            ...this.#clockOptions(),
            deterministic: this.#renderType === 'non-realtime',
          });
        const entry = cached ?? {
          key,
          mount,
          estimatedBytes: this.#estimatePreparedBytes(source.descriptor),
          ready: false,
        };
        this.#probeCacheEntries.set(mount, entry);
        void mount.ready.then(
          () => {
            entry.ready = true;
          },
          () => {},
        );
        if (mount.host.style.visibility !== 'hidden') mount.host.style.visibility = 'hidden';
        staged.push(mount);
        void mount.ready.catch(() => undefined);
      }
      return staged;
    } catch (cause) {
      for (const mount of staged) this.#releaseProbe(mount);
      throw cause;
    }
  }

  async prepareSlot(params: CoordinatedPrepareSlotParams): Promise<ReturnPayload> {
    return this.#action(async () => {
      if (Object.keys(params).some((key) => !['slotId', 'stateId', 'data'].includes(key)))
        throw new Error('Unknown preparation parameter.');
      const { slotId } = params;
      const stateId = params.stateId === '' ? null : params.stateId;
      this.#validateState(slotId, stateId);
      this.#validateActivation(slotId, stateId);
      this.#cancelPlayBatch('A preparation superseded Coordinated Play.');
      const state = this.#definition!.states.find((entry) => entry.id === stateId);
      const previous = this.#controls.slots[slotId]!;
      const data = {
        ...(previous.stateId === stateId ? previous.data : this.#defaultData(stateId)),
        ...(params.data === undefined
          ? {}
          : this.#externalStateData(
              stateId,
              params.data,
              previous.stateId === stateId ? previous.data : this.#defaultData(stateId),
            )),
      };
      const resolved = state ? dataRecord(this.resolveTemplateData(state.templateId, data)) : data;
      const requestId = `prepare-${++this.#requestNumber}`;
      const generation = this.#generation;
      this.#cancelPrepared(slotId, false);
      const entry: PreparedSlotResources = {
        snapshot: {
          slotId,
          stateId,
          templateId: state?.templateId ?? null,
          data: resolved,
          requestId,
          status: 'preparing',
          error: null,
        },
        mount: null,
        shared: [],
      };
      this.#prepared.set(slotId, entry);
      // A newly prepared conflicting lane can invalidate an older Take queued behind an
      // existing transition. Reject that pending request now rather than reviving it later.
      for (const [id, slot] of Object.entries(this.#session!.slots)) {
        if (!slot.pending?.ready || !slot.pending.selection) continue;
        const reason = transitionLogicAdmissionError(
          this.#definition!,
          this.#session!,
          id,
          slot.pending.selection.stateId,
          [...this.#prepared].flatMap(([preparedId, value]) =>
            value.snapshot.stateId !== null && value.snapshot.status !== 'failed'
              ? [preparedId]
              : [],
          ),
        );
        if (!reason) continue;
        const requestId = slot.pending.request.requestId;
        this.#waiters.get(requestId)?.reject(new AdmissionDenied(reason));
        this.#waiters.delete(requestId);
        this.#dispatch({
          type: 'failed',
          frame: this.#frame,
          slotId: id,
          requestId,
          message: reason,
        });
      }
      this.#publish(true);
      try {
        // Probe a copy so resource preparation cannot affect the on-air planner or data.
        const staged = reduceTransitionLogic(this.#definition!, this.#session!, {
          type: 'request',
          frame: this.#frame,
          requestId,
          slotId,
          stateId,
          data: resolved,
        });
        const selection = staged.session.slots[slotId]!.pending?.selection;
        if (selection) {
          entry.mount = this.#mountSelection(selection, true);
          this.#mounts.delete(snapshotKey(selection));
          entry.mount.host.style.visibility = 'hidden';
          entry.shared = this.#stageShared(slotId, selection);
          await this.#bounded(
            Promise.all([entry.mount.ready, ...entry.shared.map((mount) => mount.ready)]),
            generation,
            requestId,
          );
        }
        this.#assertLive(generation);
        if (this.#prepared.get(slotId) !== entry)
          throw new SupersededOperation('Preparation superseded.');
        this.#validateActivation(slotId, stateId);
        entry.snapshot.status = 'ready';
        this.#publish(true);
        return { statusCode: 200 };
      } catch (cause) {
        if (this.#prepared.get(slotId) !== entry || generation !== this.#generation)
          return { statusCode: 409, statusMessage: 'Preparation superseded or disposed.' };
        entry.mount?.dispose();
        entry.mount = null;
        for (const mount of entry.shared) this.#releaseProbe(mount);
        entry.shared = [];
        entry.snapshot.status = 'failed';
        entry.snapshot.error = cause instanceof Error ? cause.message : String(cause);
        this.#publish(true);
        return errorPayload(cause);
      }
    });
  }

  async takePreparedSlot(params: CoordinatedTakePreparedSlotParams): Promise<ReturnPayload> {
    return this.#action(async () => {
      if (Object.keys(params).some((key) => !['slotId', 'skipAnimation'].includes(key)))
        throw new Error('Unknown prepared take parameter.');
      if (params.skipAnimation !== undefined && typeof params.skipAnimation !== 'boolean')
        throw new Error('skipAnimation must be a boolean.');
      this.#validateState(params.slotId, null);
      const prepared = this.#prepared.get(params.slotId);
      if (!prepared || prepared.snapshot.status !== 'ready')
        return {
          statusCode: 409,
          statusMessage: 'Prepare this slot and wait for readiness before taking it.',
        };
      this.#validateActivation(params.slotId, prepared.snapshot.stateId);
      this.#cancelPlayBatch('A prepared Take superseded Coordinated Play.');
      this.#prepared.delete(params.slotId);
      const { stateId, data } = prepared.snapshot;
      const previous = this.#controls.slots[params.slotId]!;
      if (previous.stateId && previous.stateId !== stateId)
        this.#retainedData.set(previous.stateId, jsonCopy(previous.data));
      this.#controls.slots[params.slotId] = { stateId, data: jsonCopy(data) };
      await this.#take(params.slotId, stateId, data, Boolean(params.skipAnimation), prepared);
      this.#currentStep = Object.values(this.#session!.slots).some((slot) =>
        slot.pending ? slot.pending.selection : slot.transition ? slot.transition.to : slot.settled,
      )
        ? 0
        : undefined;
      return { statusCode: 200 };
    });
  }

  #armFrameCues(plan: TransitionLogicPlan): void {
    if (
      !this.#hasFrameCues ||
      this.#renderType !== 'realtime' ||
      this.#skipRequests.get(plan.requestId) ||
      plan.endFrame <= plan.startFrame ||
      plan.from?.instanceId === plan.to?.instanceId
    )
      return;
    const recipe = this.#definition!.transitions.find((entry) => entry.id === plan.transitionId)!;
    for (const phase of ['out', 'in'] as const) {
      const outgoing = phase === 'out';
      const selection = outgoing ? plan.from : plan.to;
      const durationFrames = outgoing ? recipe.outgoingFrames : recipe.incomingFrames;
      const choice = outgoing ? recipe.outgoingAnimation : recipe.incomingAnimation;
      // A wrapper preset holds the authored pose, and a cut does not traverse it at all.
      if (!selection || durationFrames <= 0 || (choice && choice.type !== 'template')) continue;
      const descriptor = this.#template(selection.templateId).descriptor;
      if (!descriptor.frameCues?.length) continue;
      const startFrame = plan.startFrame + (outgoing ? 0 : recipe.incomingStartFrame);
      const lifecycle = { phase, startFrame, durationFrames };
      const from = sampleTransitionLogicLifecycle(
        descriptor,
        startFrame,
        startFrame,
        lifecycle,
      ).frame;
      const to = sampleTransitionLogicLifecycle(
        descriptor,
        startFrame + durationFrames,
        startFrame,
        lifecycle,
      ).frame;
      if (to <= from) continue;
      const cues = descriptor.frameCues
        .filter((cue) => (cue.frame > from || (!outgoing && cue.frame === from)) && cue.frame <= to)
        .map((cue) => ({
          at: startFrame + ((cue.frame - from) / (to - from)) * durationFrames,
          cue,
        }))
        .sort((a, b) => a.at - b.at);
      if (cues.length)
        this.#frameCueWindows.push({
          planId: plan.id,
          laneId: plan.slotId,
          selection,
          cues,
          next: 0,
        });
    }
  }

  #discardUnplayedCueWindows(): void {
    if (!this.#frameCueWindows.length) return;
    const plans = new Set(Object.values(this.#session!.slots).map((slot) => slot.transition?.id));
    this.#frameCueWindows = this.#frameCueWindows.filter(
      (window) => window.next < window.cues.length && plans.has(window.planId),
    );
  }

  #emitFrameCues(frame: number, generation: number): void {
    const crossed: Array<{ window: CoordinatedFrameCueWindow; at: number; cue: FrameCue }> = [];
    for (const window of this.#frameCueWindows) {
      while (window.next < window.cues.length && window.cues[window.next]!.at <= frame) {
        const hit = window.cues[window.next++]!;
        crossed.push({ window, ...hit });
      }
    }
    crossed.sort((a, b) => a.at - b.at);
    for (const { window, cue } of crossed) {
      if (!this.#loaded || generation !== this.#generation) break;
      const { selection, laneId } = window;
      this.#withFrameCueInstance(selection, laneId, () =>
        dispatchStudioFrameCue(this, cue, {
          instanceId: selection.instanceId,
          templateId: selection.templateId,
          laneId,
        }),
      );
    }
  }

  #advanceAndRender(frame: number): void {
    if (this.#renderType === 'realtime' && frame < this.#frame) return;
    const generation = this.#generation;
    const cues = this.#hasFrameCues && this.#renderType === 'realtime' && frame > this.#frame;
    try {
      this.#dispatch({ type: 'advance', frame }, cues);
      this.#render(frame);
      if (cues) this.#emitFrameCues(frame, generation);
    } finally {
      if (cues && generation === this.#generation && this.#session) {
        this.#discardUnplayedCueWindows();
        this.#prune();
      }
    }
  }

  #dispatch(event: TransitionLogicEvent, retainCueMounts = false): void {
    if (event.type !== 'advance') this.#cancelWarmup();
    const beforeSelections = new Map(
      Object.entries(this.#session!.slots).map(([id, slot]) => [
        id,
        slot.transition?.to ?? slot.transition?.from ?? slot.settled,
      ]),
    );
    const plans = new Map(
      Object.entries(this.#session!.slots).flatMap(([id, slot]) =>
        slot.transition ? [[id, slot.transition] as const] : [],
      ),
    );
    const result = reduceTransitionLogic(this.#definition!, this.#session!, event);
    this.#session = result.session;
    this.#frame = event.frame;
    if (event.type === 'clear' || (event.type === 'request' && event.stateId === null)) {
      const ids =
        event.slotId === undefined
          ? this.#definition!.slots.map((slot) => slot.id)
          : transitionLogicOutSlotIds(this.#definition!, event.slotId);
      const dependenciesConfigured = this.#definition!.slots.some(
        (slot) => slot.parentSlotId !== undefined,
      );
      for (const id of ids) {
        this.#cancelPrepared(id, false);
        // Keep the ordinary Out button repeatable, but never retain dependent activation intent.
        if (event.type !== 'clear' && id === event.slotId) continue;
        if (event.type === 'clear' && !dependenciesConfigured) continue;
        const control = this.#controls.slots[id]!;
        if (control.stateId) {
          this.#retainedData.set(control.stateId, jsonCopy(control.data));
          this.#retainedSelection.set(id, control.stateId);
        }
        this.#controls.slots[id] = { stateId: null, data: jsonCopy(control.data) };
      }
    }
    if (event.type === 'clear' && (!this.#activeRuleCause.length || this.#activePointerRule))
      this.#record(
        {
          type: 'customAction',
          params: {
            id: 'transition.clear',
            payload: event.slotId === undefined ? {} : { slotId: event.slotId },
          },
        },
        event.frame,
      );
    for (const effect of result.effects) {
      if (effect.type === 'rejected') {
        this.#waiters.get(effect.requestId)?.reject(new AdmissionDenied(effect.message));
        this.#waiters.delete(effect.requestId);
      }
      if (effect.type === 'takeover') {
        this.#takeovers.set(effect.requestId, effect.outSlotIds);
        const cause = this.#requestRuleCauses.get(effect.requestId) ?? [];
        for (const requestId of effect.outRequestIds) {
          this.#takeoverOutRequests.add(requestId);
          this.#requestRuleCauses.set(requestId, [...cause]);
          if (this.#pointerRuleRequests.has(effect.requestId))
            this.#pointerRuleRequests.add(requestId);
        }
        for (const id of effect.outSlotIds) {
          this.#cancelPrepared(id, false);
          const control = this.#controls.slots[id]!;
          if (control.stateId) {
            this.#retainedData.set(control.stateId, jsonCopy(control.data));
            this.#retainedSelection.set(id, control.stateId);
          }
          this.#controls.slots[id] = { stateId: null, data: jsonCopy(control.data) };
        }
        // Record the prepared request once, before its authored Out barrier. Replaying the
        // derived exits as independent commands would lose the takeover's cancellation semantics.
        const slot = this.#session.slots[effect.slotId]!;
        const incoming = [slot.pending?.selection, slot.transition?.to, slot.settled].find(
          (selection) => selection?.requestId === effect.requestId,
        );
        if (incoming && (!cause.length || this.#pointerRuleRequests.has(effect.requestId)))
          this.#record(
            {
              type: 'customAction',
              params: {
                id: 'transition.take',
                payload: {
                  slotId: effect.slotId,
                  stateId: incoming.stateId,
                  data: incoming.data,
                },
                skipAnimation: this.#skipRequests.get(effect.requestId) ?? false,
              },
            },
            effect.frame,
          );
      }
      if (effect.type === 'started') {
        if (
          !this.#takeovers.has(effect.plan.requestId) &&
          !this.#takeoverOutRequests.has(effect.plan.requestId) &&
          (!this.#requestRuleCauses.get(effect.plan.requestId)?.length ||
            this.#pointerRuleRequests.has(effect.plan.requestId))
        )
          this.#record(
            {
              type: 'customAction',
              params: {
                id: effect.plan.to ? 'transition.take' : 'transition.out',
                payload: {
                  slotId: effect.slotId,
                  ...(effect.plan.to
                    ? {
                        stateId: effect.plan.to.stateId,
                        data: effect.plan.to.data,
                      }
                    : {}),
                },
                skipAnimation: this.#skipRequests.get(effect.plan.requestId) ?? false,
              },
            },
            effect.plan.startFrame,
          );
        plans.set(effect.slotId, effect.plan);
        this.#armFrameCues(effect.plan);
        if (effect.plan.to) {
          const key = snapshotKey(effect.plan.to);
          this.#starts.set(key, effect.plan.startFrame);
          const mount = this.#mountSelection(effect.plan.to);
          const entryRecipe = this.#definition!.transitions.find(
            (recipe) => recipe.id === effect.plan.transitionId,
          )!;
          const loopStart =
            effect.plan.startFrame +
            (this.#skipRequests.get(effect.plan.requestId)
              ? 0
              : entryRecipe.incomingStartFrame + entryRecipe.incomingFrames);
          if (!effect.plan.from || effect.plan.from.instanceId !== effect.plan.to.instanceId)
            this.#loopStarts.set(mount, loopStart);
          if (
            effect.plan.from?.templateId === effect.plan.to.templateId &&
            effect.plan.from.instanceId === effect.plan.to.instanceId
          ) {
            const previousMount = this.#mounts.get(snapshotKey(effect.plan.from));
            // Preparation may have started before a later click changed an event override.
            // Carry the latest instance state at commit, without sharing either rules engine.
            if (previousMount) {
              mount.inheritRules(previousMount, effect.plan.from.data, effect.plan.startFrame);
              const loopStart = this.#loopStarts.get(previousMount);
              if (loopStart !== undefined) this.#loopStarts.set(mount, loopStart);
            }
          }
          mount.startFrame = effect.plan.startFrame;
          mount.setOnAir(true, effect.plan.startFrame);
          for (const instance of this.#definition!.sharedInstances) {
            if (instance.slotId && instance.slotId !== effect.slotId) continue;
            const values = this.#sharedData(instance.id, effect.plan.to);
            if (!values) continue;
            const shared = this.#shared.get(instance.id)!;
            if (!effect.plan.from) this.#loopStarts.set(shared, loopStart);
            this.#mountRuleCauses.set(
              shared,
              this.#requestRuleCauses.get(effect.plan.requestId) ?? [],
            );
            shared.setData(values, effect.plan.startFrame);
            shared.setOnAir(true, effect.plan.startFrame);
          }
        }
      }
      if (effect.type === 'settled') {
        const plan = plans.get(effect.slotId);
        const at = event.type === 'clear' ? event.frame : (plan?.endFrame ?? event.frame);
        const previous = plan?.from ?? beforeSelections.get(effect.slotId);
        if (previous && previous.requestId !== effect.selection?.requestId) {
          const outgoing = this.#mounts.get(snapshotKey(previous));
          // Same-state updates are data events, rather than an artificial Out and Take.
          if (outgoing && (!effect.selection || effect.selection.stateId !== previous.stateId)) {
            this.#mountRuleCauses.set(
              outgoing,
              event.type === 'clear'
                ? [...this.#activeRuleCause]
                : (this.#requestRuleCauses.get(plan?.requestId ?? '') ?? []),
            );
            outgoing?.fireLifecycle('stop', at);
          }
        }
        if (effect.selection && (!previous || previous.stateId !== effect.selection.stateId)) {
          const incoming = this.#mountSelection(effect.selection);
          incoming.fireLifecycle('play', at);
          incoming.fireLifecycle(
            'step',
            at,
            this.#template(effect.selection.templateId).descriptor.stepKeyframeIds[0],
          );
          for (const instance of this.#definition!.sharedInstances)
            if (!instance.slotId || instance.slotId === effect.slotId) {
              const shared = this.#shared.get(instance.id)!;
              shared.fireLifecycle('play', at);
              shared.fireLifecycle(
                'step',
                at,
                this.#descriptor!.sharedInstances.find((source) => source.id === instance.id)!
                  .descriptor.stepKeyframeIds[0],
              );
            }
        }
        if (!effect.selection)
          for (const instance of this.#definition!.sharedInstances) {
            if (
              instance.slotId === effect.slotId ||
              (!instance.slotId &&
                !Object.values(this.#session.slots).some(
                  (slot) => slot.settled || slot.transition?.from || slot.transition?.to,
                ))
            ) {
              const shared = this.#shared.get(instance.id)!;
              this.#mountRuleCauses.set(
                shared,
                event.type === 'clear'
                  ? [...this.#activeRuleCause]
                  : (this.#requestRuleCauses.get(plan?.requestId ?? '') ?? []),
              );
              shared.fireLifecycle('stop', at);
              this.#shared
                .get(instance.id)!
                .setOnAir(
                  false,
                  event.type === 'clear'
                    ? event.frame
                    : (plans.get(effect.slotId)?.endFrame ?? event.frame),
                );
            }
          }
        for (const [requestId, waiter] of this.#waiters) {
          const slot = this.#session.slots[effect.slotId]!;
          if (
            waiter.outSlotIds
              ? waiter.outSlotIds.every((id) => {
                  const entry = this.#session!.slots[id]!;
                  return (
                    !entry.settled &&
                    (!entry.transition || (id === waiter.slotId && !entry.transition.from)) &&
                    (!entry.pending || (id === waiter.slotId && !!entry.pending.selection))
                  );
                })
              : waiter.slotId === effect.slotId &&
                (effect.selection?.requestId === requestId ||
                  (!effect.selection && slot.transition === null && slot.pending === null))
          ) {
            waiter.resolve();
            this.#waiters.delete(requestId);
          }
        }
      }
    }
    if (!retainCueMounts) {
      this.#discardUnplayedCueWindows();
      this.#prune();
    }
    this.#acknowledgeFinalPlayBarrier();
    this.#publish(event.type !== 'advance' || result.effects.length > 0);
    this.#kickRules();
    this.#kickPlayBatch();
    if (result.effects.length) this.#scheduleWarmup();
  }

  #prune(): void {
    const pending = new Set(
      Object.values(this.#session!.slots).flatMap((slot) =>
        slot.pending ? [slot.pending.request.requestId] : [],
      ),
    );
    for (const entry of this.#prepared.values()) pending.add(entry.snapshot.requestId);
    for (const requestId of this.#playBatch?.requestIds ?? []) pending.add(requestId);
    for (const requestId of this.#startupPlay?.batch.requestIds ?? []) pending.add(requestId);
    for (const [id, cancel] of this.#preparations)
      if (!pending.has(id)) {
        cancel();
        this.#preparations.delete(id);
      }
    const liveRequests = new Set(
      Object.values(this.#session!.slots).flatMap((slot) => [
        slot.settled?.requestId,
        slot.transition?.requestId,
        slot.transition?.from?.requestId,
        slot.pending?.request.requestId,
      ]),
    );
    for (const [id, waiter] of this.#waiters)
      if (
        !liveRequests.has(id) &&
        !waiter.outSlotIds?.some((slotId) => {
          const slot = this.#session!.slots[slotId]!;
          return slot.settled || slot.transition || slot.pending;
        })
      ) {
        waiter.resolve();
        this.#waiters.delete(id);
      }
    for (const id of this.#skipRequests.keys())
      if (!liveRequests.has(id)) this.#skipRequests.delete(id);
    for (const id of this.#takeovers.keys()) if (!liveRequests.has(id)) this.#takeovers.delete(id);
    for (const id of this.#takeoverOutRequests)
      if (!liveRequests.has(id)) this.#takeoverOutRequests.delete(id);
    for (const id of this.#requestRuleCauses.keys())
      if (!liveRequests.has(id)) this.#requestRuleCauses.delete(id);
    for (const id of this.#pointerRuleRequests)
      if (!liveRequests.has(id)) this.#pointerRuleRequests.delete(id);
    const retained = new Set(
      Object.values(this.#session!.slots).flatMap((slot) =>
        [slot.settled, slot.transition?.from, slot.transition?.to, slot.pending?.selection]
          .filter((selection): selection is TransitionLogicSelection => !!selection)
          .map(snapshotKey),
      ),
    );
    for (const [key, mount] of this.#mounts)
      if (!retained.has(key)) {
        mount.dispose();
        this.#mounts.delete(key);
        this.#starts.delete(key);
      }
    for (const cache of this.#sharedDataCache.values())
      for (const key of cache.keys()) if (!retained.has(key)) cache.delete(key);
  }

  #render(
    frame: number,
    skipAnimation = false,
    skipDataAnimationKey?: string,
    dataMotion?: { key: string; motion: TransitionLogicUpdateMotion },
  ): void {
    const sample = sampleTransitionLogic(this.#definition!, this.#session!, frame);
    for (const [instanceId, mount] of this.#shared) {
      const instance = this.#definition!.sharedInstances.find((entry) => entry.id === instanceId)!;
      const candidates = sample.slots
        .filter((slot) => !instance.slotId || slot.slotId === instance.slotId)
        .map((slot) => slot.incoming ?? slot.outgoing)
        .filter((entry): entry is TransitionLogicSelection => !!entry)
        .filter((entry) => this.#sharedData(instanceId, entry) !== null)
        .sort(
          (a, b) =>
            (this.#starts.get(snapshotKey(b)) ?? 0) - (this.#starts.get(snapshotKey(a)) ?? 0),
        );
      if (!candidates.length) {
        mount.host.style.visibility = 'hidden';
        if (this.#activeShared.delete(mount)) mount.setOnAir(false, frame);
        this.#loopStarts.delete(mount);
        continue;
      }
      let data: Record<string, unknown> | null = null;
      let dataSelectionKey: string | undefined;
      for (const candidate of candidates) {
        data = this.#sharedData(instanceId, candidate);
        if (data) {
          dataSelectionKey = snapshotKey(candidate);
          break;
        }
      }
      if (data && (this.#sharedDataIdentity.get(mount) !== data || skipAnimation)) {
        const skipData =
          skipAnimation ||
          (skipDataAnimationKey !== undefined && dataSelectionKey === skipDataAnimationKey);
        if (dataMotion && dataSelectionKey === dataMotion.key)
          mount.setData(data, frame, skipData, dataMotion.motion);
        else mount.setData(data, frame, skipData);
        this.#sharedDataIdentity.set(mount, data);
      }
      if (!this.#activeShared.has(mount)) {
        mount.setOnAir(true, frame);
        this.#activeShared.add(mount);
      }
      const ownerSlotId =
        instance.slotId ??
        this.#definition!.states.find((state) => state.id === candidates[0]?.stateId)?.slotId;
      const slot = ownerSlotId ? this.#session!.slots[ownerSlotId] : undefined;
      const plan = slot?.transition;
      const recipe = plan
        ? this.#definition!.transitions.find((entry) => entry.id === plan.transitionId)
        : undefined;
      const lifecycle: TransitionLogicLifecyclePose =
        plan && recipe && !plan.from && plan.to
          ? {
              phase: 'in',
              startFrame: plan.startFrame + recipe.incomingStartFrame,
              durationFrames: recipe.incomingFrames,
            }
          : plan && recipe && plan.from && !plan.to
            ? { phase: 'out', startFrame: plan.startFrame, durationFrames: recipe.outgoingFrames }
            : { phase: 'hold', startFrame: frame, durationFrames: 0 };
      if (lifecycle.phase === 'in')
        this.#loopStarts.set(mount, lifecycle.startFrame + lifecycle.durationFrames);
      if (!candidates.length) this.#loopStarts.delete(mount);
      lifecycle.loopStartFrame = this.#loopStarts.get(mount) ?? mount.startFrame;
      const sharedVisible =
        lifecycle.phase === 'in'
          ? frame >= lifecycle.startFrame
          : lifecycle.phase === 'out'
            ? frame < lifecycle.startFrame + lifecycle.durationFrames
            : true;
      const sharedChoice =
        lifecycle.phase === 'in' ? recipe?.incomingAnimation : recipe?.outgoingAnimation;
      const sharedOpacity =
        recipe?.contentMotion === 'authored' || sharedChoice?.type === 'template'
          ? sharedVisible
            ? '1'
            : '0'
          : '';
      if (mount.host.style.opacity !== sharedOpacity) mount.host.style.opacity = sharedOpacity;
      setTickerOutputActive(mount.host, sharedVisible);
      if (skipAnimation) mount.settleText();
      mount.render(
        frame,
        sample.sharedValues,
        this.#renderType === 'realtime' && !this.#paused,
        lifecycle,
      );
      if (mount.host.style.visibility) mount.host.style.visibility = '';
    }
    const activeContent = new Set(
      sample.slots.flatMap((slot) =>
        [slot.outgoing, slot.incoming]
          .filter((entry): entry is TransitionLogicSelection => !!entry)
          .map(snapshotKey),
      ),
    );
    for (const [key, mount] of this.#mounts)
      if (!activeContent.has(key)) {
        contentPose(mount.host, 0, 'fade', false, 0);
        setTickerOutputActive(mount.host, false);
        if (mount.host.style.visibility !== 'hidden') mount.host.style.visibility = 'hidden';
      }
    for (const slot of sample.slots) {
      const motion =
        this.#definition!.transitions.find((recipe) => recipe.id === slot.transitionId)
          ?.contentMotion ?? 'fade';
      for (const [selection, opacity, leaving] of [
        [slot.outgoing, slot.outgoingOpacity, true],
        [slot.incoming, slot.incomingOpacity, false],
      ] as const) {
        if (!selection) continue;
        const mount = this.#mountSelection(selection);
        const plan = this.#session!.slots[slot.slotId]!.transition;
        const recipe = plan
          ? this.#definition!.transitions.find((entry) => entry.id === plan.transitionId)
          : undefined;
        const sameInstance = plan?.from?.instanceId === plan?.to?.instanceId;
        const lifecycle: TransitionLogicLifecyclePose =
          plan && recipe && !sameInstance
            ? leaving
              ? { phase: 'out', startFrame: plan.startFrame, durationFrames: recipe.outgoingFrames }
              : {
                  phase: 'in',
                  startFrame: plan.startFrame + recipe.incomingStartFrame,
                  durationFrames: recipe.incomingFrames,
                }
            : { phase: 'hold', startFrame: frame, durationFrames: 0 };
        if (lifecycle.phase === 'in')
          this.#loopStarts.set(mount, lifecycle.startFrame + lifecycle.durationFrames);
        lifecycle.loopStartFrame = this.#loopStarts.get(mount) ?? mount.startFrame;
        const choice = leaving ? recipe?.outgoingAnimation : recipe?.incomingAnimation;
        if (!sameInstance && choice && lifecycle.phase !== 'hold') {
          const shown =
            lifecycle.phase === 'in'
              ? frame >= lifecycle.startFrame
              : frame < lifecycle.startFrame + lifecycle.durationFrames;
          if (choice.type === 'template' || lifecycle.durationFrames <= 0)
            contentPose(mount.host, shown ? 1 : 0, 'authored', leaving, this.#descriptor!.height);
          else {
            const animation =
              this.#descriptor!.contentAnimations?.[recipe!.id]?.[
                leaving ? 'outgoing' : 'incoming'
              ];
            if (!animation)
              throw new Error(
                `Missing compiled ${leaving ? 'outgoing' : 'incoming'} animation for ${recipe!.id}.`,
              );
            applyTransitionLogicContentPose(
              mount.host,
              sampleTransitionLogicContentAnimation(
                animation,
                lifecycle,
                frame,
                this.#descriptor!.width,
                this.#descriptor!.height,
              ),
            );
          }
          if (choice.type !== 'template') lifecycle.contentAtHold = true;
        } else
          contentPose(
            mount.host,
            opacity,
            sameInstance && choice ? 'fade' : motion,
            leaving,
            this.#descriptor!.height,
          );
        setTickerOutputActive(mount.host, mount.host.style.opacity !== '0');
        if (skipAnimation) mount.settleText();
        mount.render(
          frame,
          sample.sharedValues,
          this.#renderType === 'realtime' && !this.#paused,
          lifecycle,
        );
        if (mount.host.style.visibility) mount.host.style.visibility = '';
      }
    }
    this.#renderedSlots = sample.slots;
    if (this.#surface) this.#surface.style.visibility = '';
  }

  async #readyVisible(): Promise<void> {
    const visible = new Set(
      Object.values(this.#session!.slots).flatMap((slot) =>
        [slot.settled, slot.transition?.from, slot.transition?.to]
          .filter((selection): selection is TransitionLogicSelection => !!selection)
          .map(snapshotKey),
      ),
    );
    await this.#bounded(
      Promise.all(
        [
          ...this.#activeShared,
          ...[...this.#mounts].filter(([key]) => visible.has(key)).map(([, mount]) => mount),
        ].map((mount) => mount.waitReady()),
      ).then(() => undefined),
    );
  }

  async #take(
    slotId: string,
    stateId: string | null,
    data: Record<string, unknown>,
    skipAnimation: boolean,
    prepared?: PreparedSlotResources,
    waitForCompletion = true,
    deferPresentation = false,
  ): Promise<void> {
    this.#validateState(slotId, stateId);
    this.#validateActivation(slotId, stateId);
    this.#cancelPrepared(slotId, false);
    const take = (this.#laneTakes.get(slotId) ?? 0) + 1;
    this.#laneTakes.set(slotId, take);
    const state = this.#definition!.states.find((entry) => entry.id === stateId);
    const resolved = prepared
      ? data
      : state
        ? dataRecord(this.resolveTemplateData(state.templateId, data))
        : data;
    const currentSlot = this.#session!.slots[slotId]!;
    if (
      !prepared &&
      !currentSlot.pending &&
      !currentSlot.transition &&
      (stateId === null
        ? currentSlot.settled === null
        : currentSlot.settled?.stateId === stateId &&
          JSON.stringify(currentSlot.settled.data) === JSON.stringify(resolved))
    ) {
      return;
    }
    // Read before any await, which would leave the Rule's causal scope. Lanes that are not in place
    // never await here, so a default Take still dispatches synchronously.
    const causes = [...this.#activeRuleCause];
    const pointer = this.#activePointerRule;
    if (
      !prepared &&
      !deferPresentation &&
      this.#inPlaceSelection(slotId, stateId, skipAnimation) &&
      (await this.#takeInPlace(slotId, stateId, resolved, skipAnimation, waitForCompletion, take))
    )
      return;
    const generation = this.#generation;
    const requestId = prepared?.snapshot.requestId ?? `take-${++this.#requestNumber}`;
    this.#requestRuleCauses.set(requestId, causes);
    if (pointer) this.#pointerRuleRequests.add(requestId);
    this.#skipRequests.set(requestId, skipAnimation);
    let completed = Promise.resolve();
    if (this.#renderType === 'realtime' && waitForCompletion) {
      completed = new Promise<void>((resolve, reject) =>
        this.#waiters.set(requestId, {
          slotId,
          ...(stateId === null
            ? { outSlotIds: transitionLogicOutSlotIds(this.#definition!, slotId) }
            : {}),
          resolve,
          reject,
        }),
      );
      void completed.catch(() => undefined);
    }
    const staged = prepared?.shared ?? [];
    this.#rulePreparationCount++;
    let preparingRules = true;
    try {
      this.#dispatch({
        type: 'request',
        frame: this.#frame,
        requestId,
        slotId,
        stateId,
        data: resolved,
      });
      const selection = this.#session!.slots[slotId]!.pending?.selection;
      if (selection) {
        if (prepared?.mount) {
          // The planner may retain a newer instance identity since Prepare; adopt its already
          // loaded content under the committed request rather than allocating a second renderer.
          this.#mounts.set(snapshotKey(selection), prepared.mount);
          const binding = this.#mountBindings.get(prepared.mount);
          if (binding) binding.selection = selection;
          prepared.mount.host.dataset.ografTransitionSnapshot = selection.requestId;
          this.#mountRuleCauses.set(
            prepared.mount,
            this.#requestRuleCauses.get(selection.requestId) ?? [],
          );
          this.#bindSelectionTimerAlarms(selection, prepared.mount);
        }
        const mount = this.#mountSelection(selection);
        if (!prepared) staged.push(...this.#stageShared(slotId, selection));
        await this.#bounded(
          Promise.all([mount.ready, ...staged.map((entry) => entry.ready)]),
          generation,
          requestId,
        );
        if (this.#session!.slots[slotId]?.pending?.request.requestId !== requestId) return;
        this.#validateActivation(slotId, stateId);
        this.#dispatch({ type: 'ready', frame: this.#frame, requestId, slotId });
      }
      const skippedSlots = () =>
        stateId === null
          ? transitionLogicOutSlotIds(this.#definition!, slotId)
          : [slotId, ...(this.#takeovers.get(requestId) ?? [])];
      while (skipAnimation && skippedSlots().some((id) => this.#session!.slots[id]!.transition)) {
        // Collapse this exit group; unrelated slot clocks keep their frame.
        for (const id of skippedSlots())
          if (this.#session!.slots[id]!.transition)
            this.#session!.slots[id]!.transition!.endFrame = this.#frame;
        this.#dispatch({ type: 'advance', frame: this.#frame });
      }
      if (!deferPresentation) {
        this.#render(this.#frame, skipAnimation);
        await this.#readyVisible();
      }
      if (generation === this.#generation) {
        --this.#rulePreparationCount;
        preparingRules = false;
        this.#kickRules();
      }
      if (this.#renderType === 'realtime' && waitForCompletion) {
        await completed;
        this.#assertLive(generation);
      }
    } catch (cause) {
      if (cause instanceof SupersededOperation) return;
      if (
        !(cause instanceof AdmissionDenied) &&
        this.#loaded &&
        generation === this.#generation &&
        !Object.values(this.#session!.slots).some((slot) =>
          [
            slot.settled?.requestId,
            slot.transition?.requestId,
            slot.transition?.from?.requestId,
            slot.pending?.request.requestId,
          ].includes(requestId),
        )
      )
        return;
      if (
        this.#loaded &&
        generation === this.#generation &&
        this.#session!.slots[slotId]?.pending?.request.requestId === requestId
      )
        this.#dispatch({
          type: 'failed',
          frame: this.#frame,
          slotId,
          requestId,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      throw cause;
    } finally {
      if (preparingRules && generation === this.#generation) {
        --this.#rulePreparationCount;
        this.#kickRules();
      }
      if (generation === this.#generation) this.#waiters.delete(requestId);
      for (const mount of staged) this.#releaseProbe(mount);
      if (prepared?.mount && ![...this.#mounts.values()].includes(prepared.mount))
        prepared.mount.dispose();
      this.#scheduleWarmup();
    }
  }

  /** The selection an update can change where it stands, or null if this needs a real Take. */
  #inPlaceSelection(
    slotId: string,
    stateId: string | null,
    skipAnimation: boolean,
  ): TransitionLogicSelection | null {
    if (this.#definition!.slots.find((slot) => slot.id === slotId)?.updateMode !== 'in-place')
      return null;
    const slot = this.#session!.slots[slotId]!;
    if (slot.pending || stateId === null) return null;
    // A skip must also collapse a running transition, and only a real Take does that.
    if (skipAnimation && slot.transition) return null;
    const selection = slot.transition ? slot.transition.to : slot.settled;
    return selection?.stateId === stateId ? selection : null;
  }

  /** Each active shared instance this lane's data reaches, with the values it would receive. */
  #laneSharedData(
    slotId: string,
    selection: TransitionLogicSelection,
    data: Record<string, unknown>,
  ): { mount: TransitionLogicMount; values: Record<string, unknown>; instanceId: string }[] {
    return this.#definition!.sharedInstances.flatMap((instance) => {
      const mount = this.#shared.get(instance.id);
      if (
        !mount ||
        !this.#activeShared.has(mount) ||
        (instance.slotId && instance.slotId !== slotId)
      )
        return [];
      const values = this.#sharedData(instance.id, { ...selection, data }, false);
      return values ? [{ mount, values, instanceId: instance.id }] : [];
    });
  }

  /** A binding that cannot resolve would otherwise throw at render and stop the whole graphic. */
  #validateLaneData(
    slotId: string,
    selection: TransitionLogicSelection,
    data: Record<string, unknown>,
  ): void {
    const validate = (descriptor: CompiledGraphicDescriptor, values: Record<string, unknown>) => {
      for (const layer of [
        ...descriptor.layers,
        ...(descriptor.collections ?? []).flatMap((collection) => collection.prototypeLayers),
      ])
        resolveBoundElement(layer, values);
    };
    validate(this.#template(selection.templateId).descriptor, data);
    for (const { instanceId, values } of this.#laneSharedData(slotId, selection, data))
      validate(
        this.#descriptor!.sharedInstances.find((entry) => entry.id === instanceId)!.descriptor,
        values,
      );
  }

  #stageLaneData(
    slotId: string,
    selection: TransitionLogicSelection,
    data: Record<string, unknown>,
  ): TransitionLogicDataStage {
    const stages = [
      this.#mounts.get(snapshotKey(selection))?.stageData?.(data),
      ...this.#laneSharedData(slotId, selection, data).map(({ mount, values }) =>
        mount.stageData?.(values),
      ),
    ].filter((stage): stage is TransitionLogicDataStage => !!stage);
    return {
      takeRequired: stages.some((stage) => stage.takeRequired),
      loading: stages.some((stage) => stage.loading),
      ready: Promise.all(stages.map((stage) => stage.ready)).then(() => undefined),
    };
  }

  #holdLaneStaging(slotId: string): () => void {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#laneStaging.set(slotId, turn);
    return () => {
      if (this.#laneStaging.get(slotId) === turn) this.#laneStaging.delete(slotId);
      release();
    };
  }

  /**
   * Change a lane's data on its mounted template, with no second host. Rules fire when the data
   * changes on the template, and the lane's layout occupancy never moves. Returns false when a real
   * Take has to do this instead.
   */
  async #takeInPlace(
    slotId: string,
    stateId: string | null,
    resolved: Record<string, unknown>,
    skipAnimation: boolean,
    waitForCompletion: boolean,
    take: number,
  ): Promise<boolean> {
    let selection = this.#inPlaceSelection(slotId, stateId, skipAnimation);
    if (!selection) return false;
    const generation = this.#generation;
    const state = this.#definition!.states.find((entry) => entry.id === stateId)!;
    const data = jsonCopy({ ...state.dataDefaults, ...resolved });
    if (JSON.stringify(selection.data) === JSON.stringify(data)) return true;
    // Causes are read now, because awaiting resources leaves the Rule's causal scope.
    const causes = [...this.#activeRuleCause];
    const pointer = this.#activePointerRule;
    this.#validateLaneData(slotId, selection, data);
    const stage = this.#stageLaneData(slotId, selection, data);
    if (stage.takeRequired) return false;
    let release: (() => void) | undefined;
    try {
      if (stage.loading) {
        release = this.#holdLaneStaging(slotId);
        try {
          await this.#bounded(stage.ready, generation);
        } catch (cause) {
          if (generation !== this.#generation) throw cause;
          if (this.#laneTakes.get(slotId) !== take) return true;
          // The request failed before it reached the screen, so Controls must not keep claiming a
          // value that is not on air.
          const onAir = this.#inPlaceSelection(slotId, stateId, false);
          if (onAir) {
            this.#controls.slots[slotId] = { stateId: onAir.stateId, data: jsonCopy(onAir.data) };
            this.#retainedData.set(onAir.stateId, jsonCopy(onAir.data));
            this.#publish(true);
          }
          throw cause;
        }
        // A newer Take owns this lane now, and its Controls already say so.
        if (this.#laneTakes.get(slotId) !== take) return true;
        selection = this.#inPlaceSelection(slotId, stateId, skipAnimation);
        // The lane moved on during the load. A real Take decides from where it is now.
        if (!selection) {
          this.#validateActivation(slotId, stateId);
          return false;
        }
      }
      const key = snapshotKey(selection);
      const slot = this.#session!.slots[slotId]!;
      const mount = this.#mounts.get(key);
      const shared = this.#laneSharedData(slotId, selection, data).map((entry) => entry.mount);
      for (const target of [...(mount ? [mount] : []), ...shared])
        this.#mountRuleCauses.set(target, causes);
      // While entering, the host's own fade covers the change. While paused, no frame would run.
      const recipe = transitionLogicUpdateRecipe(this.#definition!, slotId, selection);
      const motion =
        skipAnimation || slot.transition || this.#paused
          ? undefined
          : { fallbackFrames: recipe.durationFrames > 1 ? recipe.durationFrames : 0 };
      this.#rulePreparationCount++;
      try {
        this.#patchSelectionData(slotId, key, data, this.#frame, skipAnimation, { motion });
        release?.();
        release = undefined;
        this.#retainedData.set(selection.stateId, jsonCopy(data));
        if (!causes.length || pointer)
          this.#record(
            {
              type: 'customAction',
              params: {
                id: 'transition.take',
                payload: { slotId, stateId: selection.stateId, data },
                skipAnimation,
              },
            },
            this.#frame,
          );
        this.#render(
          this.#frame,
          false,
          skipAnimation ? key : undefined,
          motion ? { key, motion } : undefined,
        );
        await this.#readyVisible();
      } finally {
        if (generation === this.#generation) {
          --this.#rulePreparationCount;
          this.#kickRules();
        }
      }
      this.#publish(true);
      if (this.#renderType === 'realtime' && waitForCompletion && motion) {
        await Promise.all(
          [...(mount ? [mount] : []), ...shared].map((target) => target.updateSettled?.()),
        );
        this.#assertLive(generation);
      }
      return true;
    } finally {
      release?.();
    }
  }

  #initializeDom(): void {
    const descriptor = this.#descriptor!;
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const surface = this.ownerDocument.createElement('div');
    surface.style.cssText = `position:relative;isolation:isolate;overflow:hidden;visibility:hidden;width:${descriptor.width}px;height:${descriptor.height}px;background:transparent;`;
    root.replaceChildren(surface);
    this.#surface = surface;
    this.style.display = 'block';
    this.style.width = `${descriptor.width}px`;
    this.style.height = `${descriptor.height}px`;
    for (const instance of this.#definition!.sharedInstances) {
      const source = descriptor.sharedInstances.find((entry) => entry.id === instance.id);
      if (!source) throw new Error(`Missing shared instance ${instance.id}.`);
      let mount: TransitionLogicMount;
      mount = mountTransitionLogicComposition({
        parent: surface,
        descriptor: source.descriptor,
        data: source.dataDefaults ?? {},
        startFrame: 0,
        ...this.#clockOptions(),
        deterministic: this.#renderType === 'non-realtime',
        sharedKeys: new Map(
          source.descriptor.layers.map((layer) => [
            layer.id,
            sharedLayerKey(instance.id, layer.id),
          ]),
        ),
        scheduleRule: (work) => this.#queueRule(`shared:${instance.id}`, mount, work),
        ruleDataChanged: (patch, frame) => this.#patchSharedRuleData(instance.id, patch, frame),
      });
      mount.host.dataset.ografTransitionShared = instance.id;
      mount.host.style.zIndex = String(
        (this.#definition!.slots.find((slot) => slot.id === instance.slotId)?.order ?? -1) * 2,
      );
      this.#shared.set(instance.id, mount);
      void mount.ready.catch(() => undefined);
    }
  }

  async load(params: LoadParams): Promise<ReturnPayload> {
    this.#reset();
    const generation = this.#generation;
    try {
      if (params.renderType !== 'realtime' && params.renderType !== 'non-realtime')
        throw new Error('Unsupported render type.');
      if (
        params.v_ografReplayClockEpochMs !== undefined &&
        (!Number.isFinite(params.v_ografReplayClockEpochMs) ||
          Math.abs(params.v_ografReplayClockEpochMs) > 8_640_000_000_000_000)
      )
        throw new Error('Replay clock epoch must be a finite JavaScript date timestamp.');
      this.#descriptor = jsonCopy(this.transitionDescriptor);
      this.#hasFrameCues = this.#descriptor.templates.some(
        (template) => !!template.descriptor.frameCues?.length,
      );
      if (
        this.#descriptor.version !== 1 ||
        !Number.isFinite(this.#descriptor.frameRate) ||
        this.#descriptor.frameRate <= 0
      )
        throw new Error('Invalid coordinated graphic descriptor.');
      this.#definition = prepareTransitionLogicDefinition(this.#descriptor.definition);
      for (const state of this.#definition.states) this.#template(state.templateId);
      this.#controls = this.#mergeControls(this.#defaultControls(), params.data, true);
      this.#loadControls = jsonCopy(this.#controls);
      this.#renderType = params.renderType;
      this.#useClockEpoch =
        params.renderType === 'realtime' || params.v_ografReplayClockEpochMs !== undefined;
      this.#epoch =
        params.renderType === 'realtime' ? Date.now() : (params.v_ografReplayClockEpochMs ?? 0);
      this.#frame = 0;
      this.#requestNumber = 0;
      this.#schedule = [];
      this.#session = createTransitionLogicSession(this.#definition);
      this.#loaded = true;
      this.#initializeDom();
      for (const recipe of this.#definition.transitions)
        for (const side of ['incoming', 'outgoing'] as const) {
          const choice = recipe[`${side}Animation`];
          if (
            choice &&
            choice.type !== 'template' &&
            recipe[`${side}Frames`] > 0 &&
            !this.#descriptor.contentAnimations?.[recipe.id]?.[side]
          )
            throw new Error(`Missing compiled ${side} animation for ${recipe.id}.`);
        }
      await this.#bounded(
        Promise.all([...this.#shared.values()].map((mount) => mount.ready)),
        generation,
      );
      this.#render(0);
      await this.#readyVisible();
      if (params.renderType === 'realtime') {
        await this.#prepareStartupPlay();
        this.#assertLive(generation);
      }
      if (params.renderType === 'realtime') {
        // Realtime frame zero starts after resource preparation. Hidden clock mounts read this
        // epoch lazily; warmup must not leave system clocks behind the actual wall clock.
        this.#epoch = Date.now();
        this.#player = new FramePlayer({
          frameRate: this.#descriptor.frameRate,
          durationFrames: this.#descriptor.frameRate * 60 * 60 * 24 * 365,
          renderFrame: (frame) => {
            if (!this.#loaded || generation !== this.#generation || this.#renderError) return;
            if (this.#playBatch?.presentationPending) {
              this.#realtimeFrameTarget = Math.max(this.#realtimeFrameTarget, frame);
              return;
            }
            if (this.#realtimeAdvance || (this.#playBatch && !this.#playBatch.preparing)) {
              this.#advanceRealtimeBatch(frame, generation);
              return;
            }
            this.#realtimeFrameTarget = frame;
            try {
              this.#advanceAndRender(frame);
            } catch (cause) {
              this.#renderError = cause instanceof Error ? cause : new Error(String(cause));
              this.#failPlayBatch(this.#renderError);
              this.#player?.dispose();
              for (const waiter of this.#waiters.values()) waiter.reject(this.#renderError);
              this.#waiters.clear();
              this.#publish(true);
            }
          },
        })
          .setClockOwner(this.ownerDocument.defaultView)
          .play();
      }
      this.#publish(true);
      this.#scheduleWarmup();
      if (this.#renderType === 'realtime') {
        const layers = [
          ...this.#descriptor.templates.flatMap((template) => template.descriptor.layers),
          ...this.#descriptor.sharedInstances.flatMap((instance) => instance.descriptor.layers),
        ];
        this.#disposeKeyboard = bindRuntimeKeyboard(
          this,
          hasRuntimeKeyboardRules(layers),
          (trigger, input) => this.handleKeyboardInput(trigger, input),
        );
      }
      return { statusCode: 200 };
    } catch (cause) {
      if (generation === this.#generation) this.#reset();
      return errorPayload(cause);
    }
  }

  async dispose(): Promise<ReturnPayload> {
    this.#reset();
    this.#listeners.clear();
    return { statusCode: 200 };
  }

  async #update(params: UpdateActionParams, external = false): Promise<ReturnPayload> {
    const next = this.#validateAction('updateAction', params, this.#controls, external);
    const changed = Object.keys(next.slots).filter(
      (id) => JSON.stringify(next.slots[id]) !== JSON.stringify(this.#controls.slots[id]),
    );
    for (const id of changed) {
      const slot = this.#session!.slots[id]!;
      // Editing an Off lane's data/selector is not a request to Take it.
      this.#validateActivation(
        id,
        next.slots[id]!.stateId,
        !!(slot.settled || slot.transition || slot.pending),
      );
      const value = next.slots[id]!;
      const state = this.#definition!.states.find((entry) => entry.id === value.stateId);
      if (state) {
        const data = dataRecord(this.resolveTemplateData(state.templateId, value.data));
        const descriptor = this.#template(state.templateId).descriptor;
        for (const layer of [
          ...descriptor.layers,
          ...(descriptor.collections ?? []).flatMap((collection) => collection.prototypeLayers),
        ]) {
          if (layer.textPath) resolveBoundElement(layer, data);
        }
      }
    }
    if (changed.length) {
      this.#cancelWarmup();
      this.#cancelPlayBatch('A control update superseded Coordinated Play.');
    }
    for (const id of changed) {
      const previous = this.#controls.slots[id]!;
      if (previous.stateId && previous.stateId !== next.slots[id]!.stateId)
        this.#retainedData.set(previous.stateId, jsonCopy(previous.data));
    }
    this.#controls = next;
    for (const id of changed) {
      const value = next.slots[id]!;
      const retained = value.stateId ?? this.#retainedSelection.get(id);
      if (retained) this.#retainedData.set(retained, jsonCopy(value.data));
    }
    for (const id of changed) this.#cancelPrepared(id, false);
    this.#publish(true);
    await Promise.all(
      changed
        .filter((id) => {
          const slot = this.#session!.slots[id]!;
          return !!(slot.settled || slot.transition || slot.pending);
        })
        .map((id) => {
          const value = next.slots[id]!;
          return this.#take(id, value.stateId, value.data, Boolean(params.skipAnimation));
        }),
    );
    this.#scheduleWarmup();
    return { statusCode: 200 };
  }

  async updateAction(params: UpdateActionParams): Promise<ReturnPayload> {
    return this.#action(() => this.#update(params, true));
  }

  async #play(params: PlayActionParams): Promise<PlayActionReturnPayload> {
    this.#validateAction('playAction', params);
    const target = resolvePlayTarget(['on-air'], 'off', 'off', this.#currentStep, params);
    if (target.currentStep === undefined) {
      this.#cancelPlayBatch();
      this.#currentStep = undefined;
      await Promise.all(
        this.#definition!.slots.map((slot) =>
          this.#take(slot.id, null, {}, Boolean(params.skipAnimation)),
        ),
      );
      return { statusCode: 200 };
    }
    const requested = Object.fromEntries(
      Object.entries(this.#controls.slots).map(([id, value]) => [id, value.stateId]),
    );
    const planned = planTransitionLogicPlay(
      this.#definition!,
      this.#session!,
      requested,
      [...this.#prepared]
        .filter(
          ([, value]) => value.snapshot.stateId !== null && value.snapshot.status !== 'failed',
        )
        .map(([id]) => id),
    );
    if (!planned.valid) throw new AdmissionDenied(planned.errors.join(' '));
    const startup = this.#startupPlay;
    const reuse =
      startup && JSON.stringify(startup.batch.controls) === JSON.stringify(this.#controls);
    if (reuse) this.#startupPlay = null;
    this.#cancelPlayBatch();
    // Keep the preparation's request identities: Rules callbacks belong to those snapshots.
    const batch = reuse ? startup.batch : this.#createPlayBatch(planned.stages);
    batch.preparing = true;
    batch.skipAnimation = Boolean(params.skipAnimation);
    batch.cause = [...this.#activeRuleCause];
    batch.pointer = this.#activePointerRule;
    this.#playBatch = batch;
    try {
      if (reuse) {
        await startup.preparation;
        await this.#waitForPlayResources(batch);
      } else await this.#preparePlayResources(batch);
      this.#assertPlayBatch(batch);
      batch.preparing = false;
      await this.#progressPlayBatch();
      if (this.#renderType === 'realtime') await batch.completion;
    } catch (cause) {
      const failure = batch.failure === undefined ? cause : batch.failure;
      if (this.#playBatch === batch) {
        this.#playBatch = null;
        for (const requestId of batch.requestIds) this.#preparations.get(requestId)?.();
        this.#releasePlayResources(batch);
        batch.reject(failure);
      }
      if (failure instanceof SupersededOperation)
        return { statusCode: 409, statusMessage: failure.message };
      throw failure;
    }
    return {
      statusCode: 200,
      ...(this.#currentStep === undefined ? {} : { currentStep: this.#currentStep }),
    };
  }

  async playAction(params: PlayActionParams): Promise<PlayActionReturnPayload> {
    return this.#action(() => this.#play(params));
  }

  async #stop(params: StopActionParams): Promise<ReturnPayload> {
    this.#validateAction('stopAction', params);
    this.#cancelPlayBatch('Stop superseded Coordinated Play.');
    this.#currentStep = undefined;
    await Promise.all(
      this.#definition!.slots.map((slot) =>
        this.#take(slot.id, null, {}, Boolean(params.skipAnimation)),
      ),
    );
    return { statusCode: 200 };
  }

  async stopAction(params: StopActionParams): Promise<ReturnPayload> {
    return this.#action(() => this.#stop(params));
  }

  async #custom(
    params: CustomActionParams,
    waitForCompletion = true,
    external = false,
  ): Promise<ReturnPayload> {
    this.#validateAction('customAction', params, this.#controls, external);
    if (params.id === 'transition.patch') {
      const payload = params.payload as {
        slotId: string;
        stateId?: string;
        data: Record<string, unknown>;
      };
      const generation = this.#generation;
      let selection: TransitionLogicSelection;
      let data: Record<string, unknown>;
      let release: (() => void) | undefined;
      try {
        // Stage first, so a slow image never blanks and a failed one leaves the old one on air.
        // Then decide again from the lane as it stands once the image has loaded.
        for (;;) {
          while (!release && this.#laneStaging.has(payload.slotId)) {
            await this.#laneStaging.get(payload.slotId);
            this.#assertLive(generation);
          }
          const slot = this.#session!.slots[payload.slotId]!;
          const onAir = slot.transition ? slot.transition.to : slot.settled;
          if (!onAir)
            throw new Error(
              `Cannot patch lane ${payload.slotId} while it is Off, preparing without visible output, or leaving.`,
            );
          if (payload.stateId && payload.stateId !== onAir.stateId)
            throw new Error(
              'The on-air state changed. Patch the current state or omit the state guard.',
            );
          const patch = external
            ? this.#externalStateData(onAir.stateId, payload.data, onAir.data)
            : boundedPatchData(payload.data);
          selection = onAir;
          data = dataRecord(
            this.resolveTemplateData(onAir.templateId, { ...onAir.data, ...patch }),
          );
          if (JSON.stringify(data) === JSON.stringify(onAir.data)) {
            release?.();
            return { statusCode: 200 };
          }
          this.#validateLaneData(payload.slotId, onAir, data);
          const stage = this.#stageLaneData(payload.slotId, onAir, data);
          if (!stage.loading) break;
          release ??= this.#holdLaneStaging(payload.slotId);
          await this.#bounded(stage.ready, generation);
        }
      } catch (cause) {
        release?.();
        throw cause;
      }
      this.#rulePreparationCount++;
      try {
        this.#patchSelectionData(
          payload.slotId,
          snapshotKey(selection),
          data,
          this.#frame,
          Boolean(params.skipAnimation),
        );
        release?.();
        this.#retainedData.set(selection.stateId, jsonCopy(data));
        this.#record({ type: 'customAction', params }, this.#frame);
        // Render selects the actual owner of global shared sources. Never transiently write
        // a losing lane's data and fire Rules before replacing it with the winning lane again.
        this.#render(this.#frame, false, params.skipAnimation ? snapshotKey(selection) : undefined);
        await this.#readyVisible();
      } finally {
        release?.();
        if (generation === this.#generation) {
          --this.#rulePreparationCount;
          this.#kickRules();
        }
      }
      this.#publish(true);
      return { statusCode: 200 };
    }
    if (params.id === 'template.action') {
      const payload = params.payload as {
        slotId: string;
        actionId: string;
        data?: Record<string, unknown>;
      };
      const slot = this.#session!.slots[payload.slotId]!;
      const selection = slot.transition ? slot.transition.to : slot.settled;
      if (!selection)
        throw new Error(
          `Cannot run a template action while lane ${payload.slotId} is Off or leaving.`,
        );
      const template = this.#template(selection.templateId);
      const timerRoutes = this.#timerActionRoutes(payload.slotId, selection, payload.actionId);
      if (
        !timerRoutes &&
        !template.descriptor.customActions.some((action) => action.id === payload.actionId)
      )
        throw new Error(
          `Unknown template custom action ${payload.actionId} in lane ${payload.slotId}.`,
        );
      if (payload.data) {
        const data = this.resolveTemplateData(template.id, {
          ...selection.data,
          ...(external
            ? this.#externalStateData(selection.stateId, payload.data, selection.data)
            : dataRecord(payload.data)),
        });
        this.#patchSelectionData(payload.slotId, snapshotKey(selection), data);
        this.#mounts
          .get(snapshotKey(selection))
          ?.setData(data, this.#frame, Boolean(params.skipAnimation));
        this.#render(this.#frame);
        await this.#readyVisible();
      }
      const mounts = new Set<TransitionLogicMount>([
        ...(timerRoutes?.keys() ?? []),
        ...[this.#mounts.get(snapshotKey(selection))].filter(
          (mount): mount is TransitionLogicMount => !!mount,
        ),
        ...template.sharedLayers.flatMap((link) => {
          const mount = this.#shared.get(link.instanceId);
          return mount && this.#activeShared.has(mount) ? [mount] : [];
        }),
      ]);
      for (const mount of mounts) {
        const target = timerRoutes?.get(mount);
        if (timerRoutes && !target)
          mount.customAction?.(payload.actionId, this.#frame, Boolean(params.skipAnimation), false);
        else
          mount.customAction?.(
            target ?? payload.actionId,
            this.#frame,
            Boolean(params.skipAnimation),
          );
      }
      this.#record({ type: 'customAction', params }, this.#frame);
      this.#render(this.#frame);
      this.#publish(true);
      return { statusCode: 200 };
    }
    if (['loop.pause', 'loop.resume', 'loop.next'].includes(params.id)) {
      const payload = params.payload as { slotId: string; groupId: string };
      const mounts = this.#slotLoopMounts(payload.slotId).filter((mount) =>
        mount.getLoopGroups?.().some((group) => group.groupId === payload.groupId),
      );
      if (!mounts.length)
        throw new Error(`No active loop group ${payload.groupId} in slot ${payload.slotId}.`);
      for (const mount of mounts)
        mount.controlLoop?.(
          params.id.slice(5) as 'pause' | 'resume' | 'next',
          payload.groupId,
          this.#frame,
        );
      this.#record({ type: 'customAction', params }, this.#frame);
      this.#render(this.#frame);
      this.#publish(true);
      return { statusCode: 200 };
    }
    if (!object(params.payload))
      throw new TypeError('Transition action payload must be an object.');
    const payload = params.payload;
    const slotId = payload.slotId;
    const allowed = params.id === 'transition.take' ? ['slotId', 'stateId', 'data'] : ['slotId'];
    if (Object.keys(payload).some((key) => !allowed.includes(key)))
      throw new Error('Unknown transition action payload field.');
    if (!['transition.take', 'transition.out', 'transition.clear'].includes(params.id))
      throw new Error(`Unknown custom action ${params.id}.`);
    if (params.id === 'transition.clear') {
      if (slotId !== undefined && typeof slotId !== 'string')
        throw new Error('slotId must be a string.');
      if (typeof slotId === 'string') this.#validateState(slotId, null);
      this.#cancelPlayBatch('Clear superseded Coordinated Play.');
      this.#cancelPrepared(typeof slotId === 'string' ? slotId : undefined, false);
      this.#dispatch({
        type: 'clear',
        frame: this.#frame,
        ...(typeof slotId === 'string' ? { slotId } : {}),
      });
      this.#render(this.#frame, true);
      if (!Object.values(this.#session!.slots).some((slot) => slot.settled || slot.transition))
        this.#currentStep = undefined;
      await this.#readyVisible();
      return { statusCode: 200 };
    }
    if (typeof slotId !== 'string') throw new Error('slotId is required.');
    const stateId =
      params.id === 'transition.out' || payload.stateId === '' ? null : payload.stateId;
    this.#validateState(slotId, stateId);
    this.#validateActivation(slotId, stateId);
    this.#cancelPlayBatch('A lane command superseded Coordinated Play.');
    const previous = this.#controls.slots[slotId]!;
    const data = {
      ...(previous.stateId === stateId ? previous.data : this.#defaultData(stateId)),
      ...(payload.data === undefined
        ? {}
        : external
          ? this.#externalStateData(
              stateId,
              payload.data,
              previous.stateId === stateId ? previous.data : this.#defaultData(stateId),
            )
          : dataRecord(payload.data)),
    };
    if (params.id === 'transition.take') {
      if (previous.stateId && previous.stateId !== stateId)
        this.#retainedData.set(previous.stateId, jsonCopy(previous.data));
      this.#controls.slots[slotId] = { stateId, data };
    }
    await this.#take(
      slotId,
      stateId,
      data,
      Boolean(params.skipAnimation),
      undefined,
      waitForCompletion,
    );
    this.#currentStep = Object.values(this.#session!.slots).some((slot) =>
      slot.pending ? slot.pending.selection : slot.transition ? slot.transition.to : slot.settled,
    )
      ? 0
      : undefined;
    return { statusCode: 200 };
  }

  async customAction(params: CustomActionParams): Promise<ReturnPayload> {
    return this.#action(() => this.#custom(params, true, true));
  }

  async setActionsSchedule(params: SetActionsScheduleParams): Promise<ReturnPayload> {
    return this.#enqueue(async () => {
      if (this.#renderType !== 'non-realtime')
        return { statusCode: 400, statusMessage: 'Schedules require non-realtime rendering.' };
      if (!Array.isArray(params.schedule) || params.schedule.length > MAX_SCHEDULE)
        throw new Error('Schedule must contain at most 10000 actions.');
      const schedule = jsonCopy(params.schedule);
      for (const entry of schedule) {
        if (
          !Number.isFinite(entry.timestamp) ||
          entry.timestamp < 0 ||
          !object(entry.action) ||
          !['updateAction', 'playAction', 'stopAction', 'customAction'].includes(
            entry.action.type,
          ) ||
          !object(entry.action.params)
        )
          throw new Error('Invalid scheduled action.');
      }
      const ordered = schedule
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => a.entry.timestamp - b.entry.timestamp || a.index - b.index)
        .map(({ entry }) => entry);
      let controls = this.#loadControls;
      for (const entry of ordered)
        controls = this.#validateAction(entry.action.type, entry.action.params, controls, true);
      this.#schedule = ordered;
      this.#externalSchedule = new WeakSet(this.#schedule);
      return { statusCode: 200 };
    });
  }

  async goToTime(params: GoToTimeParams): Promise<ReturnPayload> {
    return this.#enqueue(async () => {
      if (this.#renderType !== 'non-realtime')
        return { statusCode: 400, statusMessage: 'goToTime requires non-realtime rendering.' };
      if (!Number.isFinite(params.timestamp) || params.timestamp < 0)
        throw new Error('timestamp must be a finite, nonnegative millisecond value.');
      this.#cancelPlayBatch('Schedule replay superseded Coordinated Play.');
      this.#playBatchNumber = 0;
      // Recreate render histories so rewinding timers, text updates and GPU/media content does
      // not depend on the previous capture. Realtime shared instances are never recreated.
      this.#cancelPrepared(undefined, false);
      for (const mount of this.#mounts.values()) mount.dispose();
      for (const mount of this.#shared.values()) mount.dispose();
      this.#mounts.clear();
      this.#shared.clear();
      this.#activeShared.clear();
      this.#sharedDataCache.clear();
      this.#starts.clear();
      this.#session = createTransitionLogicSession(this.#definition!);
      this.#controls = jsonCopy(this.#loadControls);
      this.#retainedData.clear();
      this.#retainedSelection.clear();
      this.#ruleWork = [];
      this.#ruleOrder = 0;
      this.#activeRuleCause = [];
      this.#activePointerRule = false;
      this.#requestRuleCauses.clear();
      this.#pointerRuleRequests.clear();
      this.#takeovers.clear();
      this.#takeoverOutRequests.clear();
      this.#mountRuleCauses = new WeakMap();
      this.#currentStep = undefined;
      this.#requestNumber = 0;
      this.#frame = 0;
      this.#initializeDom();
      await this.#bounded(Promise.all([...this.#shared.values()].map((mount) => mount.ready)));
      this.#render(0);
      for (const entry of this.#schedule) {
        if (entry.timestamp > params.timestamp) break;
        await this.#advanceWithRules((entry.timestamp * this.#descriptor!.frameRate) / 1000);
        const value = entry.action.params;
        switch (entry.action.type) {
          case 'updateAction':
            await this.#update(value as UpdateActionParams, this.#externalSchedule.has(entry));
            break;
          case 'playAction':
            await this.#play(value as PlayActionParams);
            break;
          case 'stopAction':
            await this.#stop(value as StopActionParams);
            break;
          case 'customAction':
            await this.#custom(
              value as CustomActionParams,
              true,
              this.#externalSchedule.has(entry),
            );
            break;
        }
      }
      await this.#advanceWithRules((params.timestamp * this.#descriptor!.frameRate) / 1000);
      await this.#readyVisible();
      this.#render(this.#frame);
      await this.#readyVisible();
      return { statusCode: 200 };
    });
  }
}
