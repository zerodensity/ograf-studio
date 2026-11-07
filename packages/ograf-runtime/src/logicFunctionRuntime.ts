import {
  DEFAULT_LOGIC_FUNCTION_TIMEOUT_MS,
  MAX_LOGIC_FUNCTIONS,
  logicFunctionJsonErrors,
  type LogicFunctionContext,
  type LogicFunctionEvent,
  type LogicFunctionResult,
  type LogicJsonValue,
} from '@ograf-editor/scene-model';
import type { CompiledLogicFunctionDefinition } from '@ograf-editor/ograf-types';
import type { MediaCueRuntime } from './mediaCueRuntime';
import {
  createLogicFunctionSandbox,
  isLogicFunctionExecutionTimeout,
} from './logicFunctionSandbox';

export interface LogicFunctionSandboxHandle {
  ready: Promise<void>;
  invoke(context: LogicFunctionContext): Promise<LogicFunctionResult>;
  dispose(): void;
}
export interface LogicFunctionRuntimeOptions {
  host: HTMLElement;
  definitions: readonly CompiledLogicFunctionDefinition[];
  readData(): Record<string, unknown>;
  /** Commit this already-validated complete patch atomically; never write source/project state. */
  commitData(
    patch: Record<string, LogicJsonValue>,
    depth: number,
    context: { event: LogicFunctionEvent; onAir: boolean },
  ): void | Promise<void>;
  invokeAction(id: string, payload?: LogicJsonValue, depth?: number): void | Promise<unknown>;
  media(): Pick<
    MediaCueRuntime,
    'play' | 'restart' | 'pause' | 'resume' | 'stop' | 'setAudio'
  > | null;
  onError(error: Error): void;
  sandboxFactory?: (
    owner: Document,
    options: { source: string; name: string; timeoutMs?: number },
  ) => LogicFunctionSandboxHandle;
  clock?: {
    now(): number;
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(timer: unknown): void;
  };
}
interface Entry {
  definition: CompiledLogicFunctionDefinition;
  state: LogicJsonValue;
  sandbox: LogicFunctionSandboxHandle | null;
  failed: boolean;
  wakeAt: number | null;
  wakeVersion: number;
  wakeInvocationStartMs: number;
  cancelTimer: (() => void) | undefined;
  suspended: boolean;
  recovering: Promise<void> | null;
  pendingPlay: boolean;
  pendingOut: boolean;
  deferredData: { changed: Record<string, LogicJsonValue>; depth: number } | null;
}
interface Effects {
  entry: Entry;
  result: LogicFunctionResult;
  event: LogicFunctionEvent;
  generation: number;
  depth: number;
  sandbox: LogicFunctionSandboxHandle;
}
const MAX_DEPTH = 16,
  MAX_PENDING = 64,
  MAX_EFFECTS = 64;
const MAX_RESULT_BYTES = 512 * 1024,
  MAX_DATA_BYTES = 64 * 1024;
const clone = <T>(value: T): T => structuredClone(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Stateful function orchestration. User code is executed only by the isolated sandbox. */
export function createLogicFunctionRuntime(options: LogicFunctionRuntimeOptions) {
  if (options.definitions.length > MAX_LOGIC_FUNCTIONS)
    throw new Error('Too many logic functions.');
  let owner = options.host.ownerDocument;
  const absoluteNow = () => {
    if (options.clock) return options.clock.now();
    const performance = owner.defaultView?.performance ?? globalThis.performance;
    return performance ? performance.timeOrigin + performance.now() : Date.now();
  };
  const epoch = absoluteNow();
  let lastNow = 0;
  const now = () => {
    const value = absoluteNow() - epoch;
    if (Number.isFinite(value)) lastNow = Math.max(lastNow, value, 0);
    return lastNow;
  };
  let disposed = false,
    ownerClosing = false,
    onAir = false,
    generation = 0;
  let pointer: LogicFunctionContext['pointer'] = null;
  let requestedOnAir = false,
    airRequest = 0;
  let lifecycle = Promise.resolve();
  let queue = Promise.resolve();
  let currentDepth: number | null = null;
  let blurPending: Promise<void> | null = null;
  let focused = true,
    focusVersion = 0;
  const pending = new Set<symbol>();
  const pendingData = new Map<
    Entry,
    { generation: number; changed: Record<string, LogicJsonValue>; depth: number }
  >();
  const entries: Entry[] = options.definitions
    .filter((definition) => definition.enabled)
    .map((definition) => ({
      definition: clone(definition),
      state: clone(definition.initialState ?? null),
      sandbox: null,
      failed: false,
      wakeAt: null,
      wakeVersion: 0,
      wakeInvocationStartMs: 0,
      cancelTimer: undefined,
      suspended: false,
      recovering: null,
      pendingPlay: false,
      pendingOut: false,
      deferredData: null,
    }));
  const factory = options.sandboxFactory ?? createLogicFunctionSandbox;
  const hasPointerFunctions = entries.some((entry) => entry.definition.pointer === true);
  const cancelTimer = (entry: Entry) => {
    entry.cancelTimer?.();
    entry.cancelTimer = undefined;
  };
  const stopMedia = (entry?: Entry) => {
    const media = options.media();
    if (!media) return;
    const cues = new Set(
      (entry ? [entry] : entries).flatMap((item) => Object.values(item.definition.media ?? {})),
    );
    for (const cue of cues) {
      try {
        media.stop(cue);
      } catch {
        /* Retain the original failure while cleaning up. */
      }
    }
  };
  const fail = (entry: Entry, cause: unknown) => {
    if (disposed || entry.failed) return;
    entry.failed = true;
    cancelTimer(entry);
    entry.wakeAt = null;
    entry.wakeVersion++;
    pendingData.delete(entry);
    stopMedia(entry);
    const message = cause instanceof Error ? cause.message : String(cause);
    try {
      options.onError(new Error(`Function "${entry.definition.name}": ${message}`));
    } catch {
      /* Reporting must not create a second failure. */
    }
  };
  const inputData = (entry: Entry): Record<string, LogicJsonValue> => {
    const source = options.readData();
    const result = Object.fromEntries(
      Object.entries(entry.definition.inputs).flatMap(([alias, key]) =>
        Object.hasOwn(source, key) && source[key] !== undefined ? [[alias, source[key]]] : [],
      ),
    );
    const errors = logicFunctionJsonErrors(result, MAX_DATA_BYTES);
    if (errors.length) throw new Error(`Invalid input: ${errors.join(' ')}`);
    return clone(result as Record<string, LogicJsonValue>);
  };
  function validate(entry: Entry, raw: unknown): LogicFunctionResult {
    if (
      !object(raw) ||
      Object.keys(raw).some((key) => !['state', 'data', 'actions', 'media', 'wakeAt'].includes(key))
    )
      throw new Error(
        'Return a function result object with state, data, actions, media or wakeAt.',
      );
    const errors = logicFunctionJsonErrors(raw, MAX_RESULT_BYTES);
    if (errors.length) throw new Error(`Invalid result: ${errors.join(' ')}`);
    if (Object.hasOwn(raw, 'state')) {
      const stateErrors = logicFunctionJsonErrors(raw.state);
      if (stateErrors.length) throw new Error(`Invalid state: ${stateErrors.join(' ')}`);
    }
    if (raw.data !== undefined) {
      const dataErrors = logicFunctionJsonErrors(raw.data, MAX_DATA_BYTES);
      if (dataErrors.length) throw new Error(`Invalid output: ${dataErrors.join(' ')}`);
    }
    if (
      raw.data !== undefined &&
      (!object(raw.data) ||
        Object.keys(raw.data).some((alias) => !Object.hasOwn(entry.definition.outputs, alias)))
    )
      throw new Error('Function data can write only its declared output aliases.');
    if (
      raw.wakeAt !== undefined &&
      raw.wakeAt !== null &&
      (typeof raw.wakeAt !== 'number' || !Number.isFinite(raw.wakeAt) || raw.wakeAt < 0)
    )
      throw new Error('wakeAt must be a finite nonnegative timestamp or null.');
    if (raw.actions !== undefined) {
      if (!Array.isArray(raw.actions) || raw.actions.length > MAX_EFFECTS)
        throw new Error('Too many emitted actions.');
      for (const action of raw.actions)
        if (
          !object(action) ||
          typeof action.name !== 'string' ||
          !Object.hasOwn(entry.definition.emits ?? {}, action.name) ||
          Object.keys(action).some((key) => !['name', 'payload'].includes(key))
        )
          throw new Error('Function actions must use declared emit aliases.');
    }
    if (raw.media !== undefined) {
      if (!Array.isArray(raw.media) || raw.media.length > MAX_EFFECTS)
        throw new Error('Too many media commands.');
      for (const command of raw.media)
        if (
          !object(command) ||
          typeof command.name !== 'string' ||
          !Object.hasOwn(entry.definition.media ?? {}, command.name) ||
          !['play', 'restart', 'pause', 'resume', 'stop', 'controls'].includes(
            String(command.command),
          ) ||
          Object.keys(command).some((key) => !['name', 'command', 'gain', 'muted'].includes(key)) ||
          (command.gain !== undefined &&
            (typeof command.gain !== 'number' || command.gain < 0 || command.gain > 1)) ||
          (command.muted !== undefined && typeof command.muted !== 'boolean')
        )
          throw new Error('Function media must use declared aliases and valid controls.');
    }
    return clone(raw as unknown as LogicFunctionResult);
  }
  function schedule(entry: Entry) {
    if (
      disposed ||
      !onAir ||
      entry.failed ||
      entry.suspended ||
      entry.recovering ||
      entry.cancelTimer ||
      entry.wakeAt === null
    )
      return;
    if (entry.definition.pointer && frameOwner) return; // Paint-paced pointer ticks are consumed below.
    // Count the 16 ms floor from the call that requested this deadline, not its completion.
    // Events omitting wakeAt retain the existing deadline without pushing it back.
    const at = Math.max(entry.wakeAt, entry.wakeInvocationStartMs + 16),
      version = entry.wakeVersion,
      scheduledGeneration = generation;
    // Browser timers truncate fractional milliseconds; round up to avoid an early callback
    // followed by a nested 4 ms timer just to wait for the remainder of the same deadline.
    const delay = Math.max(0, Math.min(2_147_483_647, Math.ceil(at - now())));
    const callback = () => {
      entry.cancelTimer = undefined;
      if (
        disposed ||
        !onAir ||
        entry.failed ||
        generation !== scheduledGeneration ||
        entry.wakeVersion !== version
      )
        return;
      if (now() + 0.001 < at) {
        schedule(entry);
        return;
      }
      entry.wakeAt = null; // A tick consumes its deadline; omission cannot create a busy loop.
      void dispatch(entry, { type: 'tick' }, 0, version).catch(() => undefined);
    };
    if (options.clock) {
      const timer = options.clock.setTimeout(callback, delay);
      entry.cancelTimer = () => options.clock!.clearTimeout(timer);
    } else if (owner.defaultView) {
      const window = owner.defaultView,
        timer = window.setTimeout(callback, delay);
      entry.cancelTimer = () => window.clearTimeout(timer);
    } else {
      const timer = setTimeout(callback, delay);
      entry.cancelTimer = () => clearTimeout(timer);
    }
  }
  async function applyEffects(effects: Effects) {
    const { entry, result, event, generation: requestGeneration, depth } = effects;
    const active = () =>
      !disposed &&
      !entry.failed &&
      !entry.suspended &&
      entry.sandbox === effects.sandbox &&
      generation === requestGeneration;
    if (!active() || event.type === 'load') return;
    const restricted = event.type === 'blur' || event.type === 'out';
    if (!onAir && !restricted) return;
    const media = options.media();
    for (const command of result.media ?? []) {
      if (!active()) return;
      if (restricted && !['pause', 'stop'].includes(command.command)) continue;
      if (!media) throw new Error('Media is unavailable for this function.');
      const cueId = entry.definition.media![command.name]!;
      if (!restricted && (command.gain !== undefined || command.muted !== undefined))
        media.setAudio(cueId, {
          ...(command.gain === undefined ? {} : { gain: command.gain }),
          ...(command.muted === undefined ? {} : { muted: command.muted }),
        });
      if (command.command === 'play') await media.play(cueId);
      else if (command.command === 'restart') await media.restart(cueId);
      else if (command.command === 'pause') media.pause(cueId);
      else if (command.command === 'resume') media.resume(cueId);
      else if (command.command === 'stop') media.stop(cueId);
    }
    if (restricted) return;
    for (const action of result.actions ?? []) {
      if (!active() || !onAir) return;
      await options.invokeAction(entry.definition.emits![action.name]!, action.payload, depth + 1);
    }
  }
  function dispatch(
    entry: Entry,
    event: LogicFunctionEvent,
    depth = 0,
    wakeVersion?: number,
  ): Promise<boolean> {
    if (disposed || entry.failed) return Promise.resolve(false);
    if (entry.suspended) {
      retainDataEvent(entry, event, depth);
      return Promise.resolve(false);
    }
    if (entry.definition.pointer && frameOwner && onAir && event.type !== 'load' && paintStale()) {
      retainDataEvent(entry, event, depth);
      suspendPointerFunctions();
      return Promise.resolve(false);
    }
    if (depth > MAX_DEPTH || pending.size >= MAX_PENDING) {
      const error = new Error(
        depth > MAX_DEPTH
          ? 'Function action/data cycle limit exceeded.'
          : 'Too many pending function calls.',
      );
      fail(entry, error);
      return Promise.reject(error);
    }
    const requestGeneration = generation,
      sandbox = entry.sandbox,
      token = Symbol('function-call');
    pending.add(token);
    const invocation = queue.then(async (): Promise<Effects | null> => {
      if (
        disposed ||
        entry.failed ||
        requestGeneration !== generation ||
        sandbox !== entry.sandbox ||
        !sandbox ||
        (wakeVersion !== undefined && entry.wakeVersion !== wakeVersion)
      ) {
        if (entry.suspended) retainDataEvent(entry, event, depth);
        return null;
      }
      if (
        (event.type === 'tick' ||
          event.type === 'custom-action' ||
          event.type === 'play' ||
          event.type === 'focus') &&
        !onAir
      )
        return null;
      await sandbox.ready;
      if (disposed || requestGeneration !== generation || sandbox !== entry.sandbox) {
        if (entry.suspended) retainDataEvent(entry, event, depth);
        return null;
      }
      if (
        entry.definition.pointer &&
        frameOwner &&
        onAir &&
        event.type !== 'load' &&
        paintStale()
      ) {
        retainDataEvent(entry, event, depth);
        suspendPointerFunctions();
        return null;
      }
      const invocationStart = now();
      const context: LogicFunctionContext = {
        state: clone(entry.state),
        data: inputData(entry),
        event: clone(event),
        nowMs: event.type === 'load' ? 0 : invocationStart,
        ...(entry.definition.pointer === true
          ? {
              pointer:
                onAir &&
                focused &&
                event.type !== 'blur' &&
                event.type !== 'out' &&
                event.type !== 'load' &&
                pointer
                  ? { ...pointer }
                  : null,
            }
          : {}),
      };
      const raw = await sandbox.invoke(context);
      if (
        disposed ||
        entry.failed ||
        requestGeneration !== generation ||
        sandbox !== entry.sandbox
      ) {
        if (entry.suspended) retainDataEvent(entry, event, depth);
        return null;
      }
      const result = validate(entry, raw);
      const current = options.readData();
      const patch = Object.fromEntries(
        Object.entries(result.data ?? {}).flatMap(([alias, value]) => {
          const key = entry.definition.outputs[alias]!;
          return equal(current[key], value) ? [] : [[key, value]];
        }),
      );
      const previousDepth = currentDepth;
      currentDepth = depth;
      let commit: void | Promise<void> = undefined;
      try {
        if (Object.keys(patch).length)
          commit = options.commitData(patch, depth, {
            event,
            onAir: event.type === 'out' ? false : onAir,
          });
      } finally {
        currentDepth = previousDepth;
      }
      if (commit) await commit;
      if (disposed || entry.failed || requestGeneration !== generation || sandbox !== entry.sandbox)
        return null;
      if (Object.hasOwn(result, 'state')) entry.state = clone(result.state!);
      if (Object.hasOwn(result, 'wakeAt')) {
        cancelTimer(entry);
        entry.wakeAt = result.wakeAt!;
        entry.wakeInvocationStartMs = invocationStart;
        entry.wakeVersion++;
      }
      schedule(entry);
      return { entry, result, event, generation: requestGeneration, depth, sandbox };
    });
    queue = invocation.then(
      () => undefined,
      () => undefined,
    );
    return invocation
      .then(async (effects) => {
        if (!effects) return false;
        await applyEffects(effects);
        return true;
      })
      .catch((cause: unknown) => {
        if (!disposed && requestGeneration === generation && sandbox === entry.sandbox) {
          if (
            entry.definition.pointer &&
            frameOwner &&
            paintStale() &&
            isLogicFunctionExecutionTimeout(cause)
          ) {
            retainDataEvent(entry, event, depth);
            suspendPointerFunctions();
            return false;
          }
          fail(entry, cause);
          throw cause;
        }
        return false;
      })
      .finally(() => {
        pending.delete(token);
      });
  }
  const invalidate = () => {
    generation++;
    pointer = null;
    for (const entry of entries) {
      cancelTimer(entry);
      entry.wakeVersion++;
    }
    pendingData.clear();
    pending.clear();
  };
  let unbindFocus = () => {};
  let focusAvailable = () => false;
  let frameOwner: Window | null = null;
  let frameRequest: number | null = null;
  let cancelPaintWatch: (() => void) | null = null;
  let lastPaint = 0,
    healthyFrames = 0,
    paintSuspended = false;
  const paintStale = () => owner.hidden || now() - lastPaint > 150;
  function holdData(entry: Entry, changed: Record<string, LogicJsonValue>, depth: number) {
    if (entry.deferredData) {
      Object.assign(entry.deferredData.changed, changed);
      entry.deferredData.depth = Math.max(entry.deferredData.depth, depth);
    } else entry.deferredData = { changed: { ...changed }, depth };
  }
  function retainDataEvent(entry: Entry, event: LogicFunctionEvent, depth: number) {
    if (disposed || event.type !== 'data' || !event.changed) return;
    const data = options.readData();
    holdData(
      entry,
      Object.fromEntries(
        Object.keys(event.changed).map((alias) => {
          const value = data[entry.definition.inputs[alias]!];
          return [alias, value === undefined ? null : clone(value)];
        }),
      ) as Record<string, LogicJsonValue>,
      depth,
    );
  }
  function suspendPointerFunctions() {
    if (!onAir || disposed) return;
    paintSuspended = true;
    healthyFrames = 0;
    pointer = null;
    focused = false;
    focusVersion++;
    for (const entry of entries) {
      if (!entry.definition.pointer || entry.failed) continue;
      entry.suspended = true;
      cancelTimer(entry);
      entry.wakeVersion++;
      const data = pendingData.get(entry);
      if (data) holdData(entry, data.changed, data.depth);
      pendingData.delete(entry);
      const previous = entry.sandbox;
      entry.sandbox = null; // A disposed invocation is obsolete, not a source failure.
      previous?.dispose();
      pauseMedia(entry);
    }
  }
  function recoverPointer(entry: Entry): Promise<void> {
    if (
      !entry.suspended ||
      entry.recovering ||
      entry.failed ||
      disposed ||
      !onAir ||
      paintSuspended ||
      paintStale() ||
      !focusAvailable()
    )
      return entry.recovering ?? Promise.resolve();
    let replacement: LogicFunctionSandboxHandle | null = null;
    const recovery = (async () => {
      replacement = factory(owner, {
        source: entry.definition.source,
        name: entry.definition.name,
        timeoutMs: entry.definition.timeoutMs ?? DEFAULT_LOGIC_FUNCTION_TIMEOUT_MS,
      });
      entry.sandbox = replacement;
      await replacement.ready;
      if (disposed || !onAir || entry.sandbox !== replacement || paintSuspended || paintStale()) {
        if (entry.sandbox === replacement) {
          entry.sandbox = null;
          replacement.dispose();
        }
        return;
      }
      entry.suspended = false;
      const current = () =>
        !disposed &&
        onAir &&
        !entry.suspended &&
        entry.sandbox === replacement &&
        !paintSuspended &&
        !paintStale();
      if (!(await dispatch(entry, { type: 'blur' })) || !current()) return;
      if (entry.pendingOut) {
        if (!(await dispatch(entry, { type: 'out' })) || !current()) return;
        entry.pendingOut = false;
      }
      if (entry.pendingPlay) {
        if (!(await dispatch(entry, { type: 'play' })) || !current()) return;
        entry.pendingPlay = false;
      }
      const deferred = entry.deferredData;
      entry.deferredData = null;
      if (deferred) {
        if (!(await dispatch(entry, { type: 'data', changed: deferred.changed }, deferred.depth))) {
          retainDataEvent(entry, { type: 'data', changed: deferred.changed }, deferred.depth);
          return;
        }
        if (!current()) return;
      }
      if (
        disposed ||
        !onAir ||
        entry.sandbox !== replacement ||
        paintSuspended ||
        paintStale() ||
        !focusAvailable()
      )
        return;
      focused = true;
      await dispatch(entry, { type: 'focus' });
    })()
      .catch((cause: unknown) => {
        if (!disposed && entry.sandbox === replacement && !paintSuspended && !paintStale())
          fail(entry, cause);
      })
      .finally(() => {
        if (entry.recovering !== recovery) return;
        entry.recovering = null;
        if (!entry.suspended && !entry.failed && !disposed) {
          const deferred = entry.deferredData;
          entry.deferredData = null;
          if (deferred)
            void dispatch(entry, { type: 'data', changed: deferred.changed }, deferred.depth).catch(
              () => undefined,
            );
          schedule(entry);
        }
      });
    entry.recovering = recovery;
    return recovery;
  }
  function stopPaintObserver() {
    if (frameRequest !== null) frameOwner?.cancelAnimationFrame(frameRequest);
    frameRequest = null;
    cancelPaintWatch?.();
    cancelPaintWatch = null;
    frameOwner = null;
  }
  function startPaintObserver() {
    stopPaintObserver();
    const window = owner.defaultView;
    if (
      !hasPointerFunctions ||
      !onAir ||
      ownerClosing ||
      typeof window?.requestAnimationFrame !== 'function'
    )
      return;
    frameOwner = window;
    lastPaint = now();
    healthyFrames = 0;
    paintSuspended = entries.some((entry) => entry.definition.pointer && entry.suspended);
    const paint = () => {
      frameRequest = null;
      if (disposed || !onAir || frameOwner !== window) return;
      const current = now(),
        gap = current - lastPaint;
      lastPaint = current;
      if (owner.hidden || gap > 150) suspendPointerFunctions();
      if (!owner.hidden && gap <= 75 && focusAvailable()) healthyFrames++;
      else healthyFrames = 0;
      if (paintSuspended && healthyFrames >= 3) paintSuspended = false;
      if (!paintSuspended)
        for (const entry of entries) {
          if (!entry.definition.pointer || entry.failed) continue;
          if (entry.suspended) {
            void recoverPointer(entry);
            continue;
          }
          if (entry.recovering || entry.wakeAt === null) continue;
          if (current + 0.001 < Math.max(entry.wakeAt, entry.wakeInvocationStartMs + 16)) continue;
          const version = entry.wakeVersion;
          entry.wakeAt = null;
          void dispatch(entry, { type: 'tick' }, 0, version).catch(() => undefined);
        }
      frameRequest = window.requestAnimationFrame(paint);
    };
    const watch = () => {
      cancelPaintWatch = null;
      if (disposed || !onAir || frameOwner !== window) return;
      if (!paintSuspended && paintStale()) suspendPointerFunctions();
      const timer = options.clock
        ? options.clock.setTimeout(watch, 50)
        : window.setTimeout(watch, 50);
      cancelPaintWatch = () =>
        options.clock ? options.clock.clearTimeout(timer) : window.clearTimeout(timer as number);
    };
    frameRequest = window.requestAnimationFrame(paint);
    watch();
  }
  function suspendClosingOwner() {
    if (disposed || ownerClosing) return;
    ownerClosing = true;
    focused = false;
    focusVersion++;
    stopPaintObserver();
    // A detached pane returns to Studio on the next owner-window task. Invalidate now,
    // before its sandbox pagehide handler rejects any active invocation, so that owner
    // destruction cannot become a permanent user-code failure during that interval.
    for (const entry of entries) {
      const data = pendingData.get(entry);
      if (data) holdData(entry, data.changed, data.depth);
      if (!entry.failed) entry.suspended = true;
    }
    invalidate();
    for (const entry of entries) {
      const previous = entry.sandbox;
      entry.sandbox = null;
      entry.recovering = null;
      previous?.dispose();
    }
    queue = Promise.resolve();
    blurPending = null;
    pauseMedia();
  }
  let scope: HTMLElement | null = null;
  function bindFocus() {
    unbindFocus();
    if (!entries.length) return;
    scope = options.host.closest?.<HTMLElement>('[data-ograf-keyboard-scope]') ?? options.host;
    const activeScope = scope,
      document = owner,
      window = owner.defaultView;
    let active = true;
    const editable = (target: EventTarget | null) => {
      if (!target || typeof target !== 'object' || !('nodeType' in target) || target.nodeType !== 1)
        return false;
      const element = target as HTMLElement;
      return (
        element.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) ||
        ['textbox', 'combobox', 'spinbutton'].includes(element.getAttribute('role') ?? '')
      );
    };
    const editing = () => {
      let element = document.activeElement;
      while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
      return editable(element);
    };
    focusAvailable = () =>
      active &&
      !ownerClosing &&
      !document.hidden &&
      (typeof document.hasFocus !== 'function' || document.hasFocus()) &&
      !editing();
    const focus = () => {
      if (focusAvailable()) void requestFocus().catch(() => undefined);
    };
    const blur = () => {
      if (active) void requestBlur().catch(() => undefined);
    };
    const focusout = (event: Event) => {
      const next = (event as FocusEvent).relatedTarget;
      if (!next || !activeScope.contains(next as Node) || editable(next)) blur();
    };
    const focusin = (event: Event) => {
      if (editable(event.target) || event.composedPath?.().some(editable)) blur();
      else focus();
    };
    const visibility = () => {
      if (document.hidden) blur();
      else focus();
    };
    activeScope.addEventListener('focusout', focusout);
    activeScope.addEventListener('focusin', focusin);
    window?.addEventListener('blur', blur);
    window?.addEventListener('focus', focus);
    // bindFocus runs before sandbox creation, so this listener owns the pagehide race.
    window?.addEventListener('pagehide', suspendClosingOwner);
    owner.addEventListener('visibilitychange', visibility);
    unbindFocus = () => {
      active = false;
      activeScope.removeEventListener('focusout', focusout);
      activeScope.removeEventListener('focusin', focusin);
      window?.removeEventListener('blur', blur);
      window?.removeEventListener('focus', focus);
      window?.removeEventListener('pagehide', suspendClosingOwner);
      document.removeEventListener('visibilitychange', visibility);
    };
  }
  function requestBlur(): Promise<void> {
    if (disposed || !onAir) return Promise.resolve();
    focused = false;
    focusVersion++;
    if (blurPending) return blurPending;
    invalidate();
    pauseMedia();
    const work = Promise.all(entries.map((entry) => dispatch(entry, { type: 'blur' }))).then(
      () => undefined,
    );
    blurPending = work;
    void work
      .finally(() => {
        if (blurPending === work) blurPending = null;
      })
      .catch(() => undefined);
    return work;
  }
  function requestFocus(): Promise<void> {
    if (disposed || !onAir || focused || !hasPointerFunctions) return Promise.resolve();
    focused = true;
    const version = ++focusVersion,
      requestGeneration = generation;
    // Do not race a still-running blur cleanup or deliver a gain superseded by another blur/Out.
    return Promise.resolve(blurPending)
      .catch(() => undefined)
      .then(async () => {
        if (
          disposed ||
          !onAir ||
          !focused ||
          focusVersion !== version ||
          generation !== requestGeneration
        )
          return;
        if (!focusAvailable()) {
          focused = false;
          return;
        }
        await Promise.all(
          entries
            .filter((entry) => entry.definition.pointer === true && !entry.failed)
            .map((entry) => dispatch(entry, { type: 'focus' })),
        );
      });
  }
  function pauseMedia(selected?: Entry) {
    const media = options.media();
    if (!media) return;
    for (const entry of selected ? [selected] : entries)
      for (const cue of new Set(Object.values(entry.definition.media ?? {}))) {
        try {
          media.pause(cue);
        } catch (cause) {
          fail(entry, cause);
        }
      }
  }
  function initialize(event: 'load' | 'blur'): Promise<void> {
    const initializationGeneration = generation;
    const jobs = entries.map(async (entry) => {
      if (entry.failed) return;
      try {
        const errors = logicFunctionJsonErrors(entry.state);
        if (errors.length) throw new Error(errors.join(' '));
        entry.sandbox = factory(owner, {
          source: entry.definition.source,
          name: entry.definition.name,
          timeoutMs: entry.definition.timeoutMs ?? DEFAULT_LOGIC_FUNCTION_TIMEOUT_MS,
        });
        await entry.sandbox.ready;
        if (disposed || initializationGeneration !== generation) return;
        await dispatch(entry, { type: event });
      } catch (cause) {
        if (!disposed && initializationGeneration === generation) {
          fail(entry, cause);
          throw cause;
        }
      }
    });
    const result = Promise.all(jobs).then(() => undefined);
    void result.catch(() => undefined);
    return result;
  }
  bindFocus();
  let ready = initialize('load');
  return {
    get ready() {
      return ready;
    },
    /** Capture-phase input updates only the latest snapshot, never the function work queue. */
    pointerChanged(position: { x: number; y: number } | null): void {
      pointer =
        !disposed &&
        onAir &&
        hasPointerFunctions &&
        position &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y)
          ? { x: position.x, y: position.y }
          : null;
    },
    async customAction(actionId: string, payload?: unknown, depth = 0): Promise<boolean> {
      if (disposed || ownerClosing || !onAir) return false;
      const listeners = entries.filter(
        (entry) => !entry.failed && entry.definition.actions.includes(actionId),
      );
      if (!listeners.length) return false;
      if (!Number.isInteger(depth) || depth < 0) throw new Error('Invalid function action depth.');
      if (payload !== undefined) {
        const errors = logicFunctionJsonErrors(payload);
        if (errors.length) throw new Error(errors.join(' '));
      }
      await ready;
      for (const entry of listeners) {
        if (entry.suspended) await recoverPointer(entry);
        if (entry.recovering) await entry.recovering;
        if (entry.suspended) continue;
        await dispatch(
          entry,
          {
            type: 'custom-action',
            actionId,
            ...(payload === undefined ? {} : { payload: clone(payload as LogicJsonValue) }),
          },
          depth,
        );
      }
      return true;
    },
    setOnAir(next: boolean): Promise<void> {
      if (disposed || next === requestedOnAir) return lifecycle;
      pointer = null;
      requestedOnAir = next;
      const request = ++airRequest;
      if (!next) {
        focused = false;
        focusVersion++;
        const wasOnAir = onAir;
        onAir = false;
        stopPaintObserver();
        if (wasOnAir) invalidate();
        stopMedia();
      }
      const operation = lifecycle.then(async () => {
        await ready;
        if (disposed) return;
        if (next) {
          if (!requestedOnAir || request !== airRequest) return;
          onAir = true;
          startPaintObserver();
          for (const entry of entries) {
            if (entry.suspended) entry.pendingPlay = true;
            else await dispatch(entry, { type: 'play' });
          }
          if (focusAvailable()) await requestFocus();
        } else
          for (const entry of entries) {
            if (entry.suspended || !entry.sandbox) entry.pendingOut = true;
            else await dispatch(entry, { type: 'out' });
          }
      });
      lifecycle = operation.catch(() => undefined);
      return operation;
    },
    dataChanged(previous: Record<string, unknown>, next: Record<string, unknown>): void {
      if (disposed) return;
      for (const entry of entries) {
        if (entry.failed) continue;
        const changed = Object.fromEntries(
          Object.entries(entry.definition.inputs).flatMap(([alias, key]) =>
            !equal(previous[key], next[key])
              ? [[alias, next[key] === undefined ? null : clone(next[key])]]
              : [],
          ),
        ) as Record<string, LogicJsonValue>;
        if (!Object.keys(changed).length) continue;
        const existing = pendingData.get(entry);
        const depth = currentDepth === null ? 0 : currentDepth + 1;
        if (entry.suspended || entry.recovering) {
          holdData(entry, changed, depth);
          continue;
        }
        if (existing && existing.generation === generation) {
          Object.assign(existing.changed, changed);
          existing.depth = Math.max(existing.depth, depth);
          continue;
        }
        const task = { generation, changed, depth };
        pendingData.set(entry, task);
        queueMicrotask(() => {
          if (pendingData.get(entry) !== task) return;
          pendingData.delete(entry);
          if (disposed || task.generation !== generation) return;
          void ready
            .then(() => {
              if (disposed || task.generation !== generation) return;
              return dispatch(entry, { type: 'data', changed: task.changed }, task.depth);
            })
            .catch(() => undefined);
        });
      }
    },
    rebindOwnerDocument(): void {
      if (disposed) return;
      const next = options.host.ownerDocument;
      const nextScope =
        options.host.closest?.<HTMLElement>('[data-ograf-keyboard-scope]') ?? options.host;
      if (next === owner && nextScope === scope && !ownerClosing) return;
      focused = false;
      focusVersion++;
      invalidate();
      stopPaintObserver();
      unbindFocus();
      pauseMedia();
      for (const entry of entries) {
        entry.recovering = null;
        entry.sandbox?.dispose();
        entry.sandbox = null;
        entry.suspended = false;
      }
      // Old sandboxes have been terminated. Their queued work need not block the new owner;
      // ordinary blur/Out retain the tail so a one-shot worker is never invoked concurrently.
      queue = Promise.resolve();
      owner = next;
      ownerClosing = false;
      bindFocus();
      const adoptionGeneration = generation,
        adoptionOwner = owner,
        initialization = initialize('blur'),
        adoptedSandboxes = new Map(entries.map((entry) => [entry, entry.sandbox]));
      const current = (entry: Entry) =>
        !disposed &&
        !ownerClosing &&
        generation === adoptionGeneration &&
        owner === adoptionOwner &&
        !entry.failed &&
        !entry.suspended &&
        entry.sandbox === adoptedSandboxes.get(entry);
      ready = initialization.then(async () => {
        for (const entry of entries) {
          if (!current(entry)) continue;
          if (entry.pendingOut) {
            if (!(await dispatch(entry, { type: 'out' })) || !current(entry)) continue;
            entry.pendingOut = false;
          }
          if (entry.pendingPlay) {
            if (onAir && (!(await dispatch(entry, { type: 'play' })) || !current(entry))) continue;
            entry.pendingPlay = false;
          }
          const deferred = entry.deferredData;
          if (
            deferred &&
            (await dispatch(entry, { type: 'data', changed: deferred.changed }, deferred.depth)) &&
            current(entry) &&
            entry.deferredData === deferred
          )
            entry.deferredData = null;
        }
      });
      if (onAir) startPaintObserver();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopPaintObserver();
      invalidate();
      unbindFocus();
      stopMedia();
      for (const entry of entries) {
        entry.sandbox?.dispose();
        entry.sandbox = null;
      }
    },
  };
}
