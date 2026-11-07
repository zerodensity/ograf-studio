import { hasTextAnimationSettings, textAnimationTotalFrames } from '@ograf-editor/scene-model';
import {
  formatClockTimerValue,
  normalizeClockTimerSettings,
  normalizeTextAnimation,
  parseClockTimerManualValue,
  type ClockDataSetting,
  type ClockTimerSettings,
  type TextElement,
} from '@ograf-editor/scene-model';
import {
  createClockTimerAlarmTracker,
  type ClockTimerAlarmDefinition,
  type ClockTimerAlarmEvent,
} from './timerAlarms';

export type ClockTimerCommand = 'start' | 'pause' | 'reset' | 'restart';
export interface ClockTimerEvent {
  timestamp: number;
  command: ClockTimerCommand | 'take-in' | 'take-out' | 'set-value' | 'set-settings';
  value?: string | number;
  /** Data-driven settings take effect at this event, never retroactively. */
  settings?: Partial<Pick<ClockTimerSettings, ClockDataSetting>>;
}
export interface ClockTimerState {
  valueMs: number;
  running: boolean;
}
interface TimerState extends ClockTimerState {
  timestamp: number;
}

function initialState(settings: ClockTimerSettings, running: boolean): TimerState {
  return { valueMs: settings.initialValueMs, running, timestamp: 0 };
}

/** Integrate elapsed time from an absolute anchor; dropped frames never lose timer time. */
function advance(settings: ClockTimerSettings, state: TimerState, timestamp: number): TimerState {
  if (settings.source === 'manual')
    return {
      valueMs: parseClockTimerManualValue(settings, settings.manualValue) ?? Number.NaN,
      running: false,
      timestamp,
    };
  if (!state.running) return { ...state, timestamp };
  const direction = settings.mode === 'count-down' ? -1 : 1;
  let valueMs = state.valueMs + Math.max(0, timestamp - state.timestamp) * direction;
  const boundary = direction < 0 ? 0 : settings.limitMs;
  let running = true;
  if (boundary !== null && (valueMs - boundary) * direction >= 0) {
    if (
      settings.endBehavior !== 'continue' &&
      (boundary - settings.initialValueMs) * direction <= 0
    ) {
      valueMs = settings.initialValueMs;
      running = false;
    } else if (settings.endBehavior === 'stop') {
      valueMs = boundary;
      running = false;
    } else if (settings.endBehavior === 'loop') {
      const span = (boundary - settings.initialValueMs) * direction;
      if (span > 0) {
        const travelled = (valueMs - settings.initialValueMs) * direction;
        valueMs = settings.initialValueMs + (travelled % span) * direction;
      } else {
        valueMs = boundary;
        running = false;
      }
    }
  }
  return { valueMs, running, timestamp };
}

function applyCommand(
  settings: ClockTimerSettings,
  state: TimerState,
  command: ClockTimerEvent['command'],
  timestamp: number,
): TimerState {
  const next = advance(settings, state, timestamp);
  switch (command) {
    case 'start':
      return { ...next, running: true };
    case 'pause':
      return { ...next, running: false };
    case 'reset':
      return { ...initialState(settings, false), timestamp };
    case 'restart':
      return { ...initialState(settings, true), timestamp };
    case 'take-in':
      return { ...next, running: next.running || settings.autoStart };
    case 'take-out':
      return settings.pauseWhenOffAir ? { ...next, running: false } : next;
    case 'set-value':
    case 'set-settings':
      return next;
  }
}

/** Replay the complete prefix so backward seeks and repeated captures have identical results. */
export function clockTimerStateAtTime(
  settings: ClockTimerSettings,
  timestamp: number,
  events: readonly ClockTimerEvent[] = [],
  lifecycleDriven = false,
): ClockTimerState {
  const at = Math.max(0, timestamp);
  let current = settings;
  let state = initialState(settings, settings.autoStart && !lifecycleDriven);
  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    if (event.timestamp > at) break;
    const eventAt = Math.max(0, event.timestamp);
    if (event.command === 'set-settings' && event.settings) {
      state = advance(current, state, eventAt);
      const next = normalizeClockTimerSettings({ ...current, ...event.settings });
      // A duration update starts a new run at its own timestamp but retains Start/Pause.
      if (next.initialValueMs !== current.initialValueMs)
        state = { ...initialState(next, state.running), timestamp: eventAt };
      current = next;
    } else if (
      event.command === 'set-value' &&
      current.source === 'manual' &&
      event.value !== undefined
    ) {
      current = { ...current, manualValue: event.value };
    } else state = applyCommand(current, state, event.command, eventAt);
  }
  if (current.mode === 'clock' && current.source !== 'manual')
    return { valueMs: current.referenceTimeMs + at, running: true };
  return advance(current, state, at);
}

/** Display settings follow the same immutable event prefix as timer state during backward seeks. */
export function clockTimerSettingsAtTime(
  settings: ClockTimerSettings,
  timestamp: number,
  events: readonly ClockTimerEvent[] = [],
): ClockTimerSettings {
  let current = settings;
  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    if (event.timestamp > Math.max(0, timestamp)) break;
    if (event.command === 'set-settings' && event.settings)
      current = normalizeClockTimerSettings({ ...current, ...event.settings });
  }
  return current;
}

/** Dynamic text is a render value, never a mutation of the authored text or component source. */
export function resolveClockTimerText(
  element: TextElement,
  valueMs: number,
  settings = normalizeClockTimerSettings(element.clock),
): TextElement {
  const { clock, ...text } = element;
  if (!clock) return element;
  return {
    ...text,
    content: Number.isFinite(valueMs)
      ? formatClockTimerValue(settings, valueMs)
      : `${settings.prefix}\u2014${settings.suffix}`,
    runs: [],
  };
}

export interface ClockTimerTextAnimationSnapshot {
  frame: number;
  /** The value immediately before this transition, independent of the last sampled frame. */
  previous: TextElement | null;
}

export function clockTimerTextAnimationAtTime(
  element: TextElement,
  timeMs: number,
  frameRate: number,
  events: readonly ClockTimerEvent[] = [],
  lifecycleDriven = false,
): ClockTimerTextAnimationSnapshot {
  const settings = normalizeClockTimerSettings(element.clock);
  const animation = normalizeTextAnimation(element.textAnimation);
  if (!hasTextAnimationSettings(animation) || !animation.replayOnUpdate || timeMs <= 0)
    return { frame: textAnimationTotalFrames(animation), previous: null };
  if (settings.source === 'manual') {
    let lastChange: number | undefined;
    let previous: TextElement | null = null;
    let text = resolveClockTimerText(
      element,
      parseClockTimerManualValue(settings, settings.manualValue) ?? Number.NaN,
      settings,
    );
    let current = settings;
    for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
      if (event.timestamp > timeMs) break;
      if (event.command === 'set-settings' && event.settings)
        current = normalizeClockTimerSettings({ ...current, ...event.settings });
      else if (event.command === 'set-value' && event.value !== undefined)
        current = { ...current, manualValue: event.value };
      else continue;
      const nextText = resolveClockTimerText(
        element,
        parseClockTimerManualValue(current, current.manualValue) ?? Number.NaN,
        current,
      );
      if (nextText.content !== text.content) {
        lastChange = event.timestamp;
        previous = text;
      }
      text = nextText;
    }
    return {
      frame:
        lastChange === undefined
          ? textAnimationTotalFrames(animation)
          : Math.min(
              textAnimationTotalFrames(animation),
              ((timeMs - lastChange) * frameRate) / 1000,
            ),
      previous,
    };
  }
  const textAt = (at: number) =>
    resolveClockTimerText(
      element,
      clockTimerStateAtTime(settings, at, events, lifecycleDriven).valueMs,
      clockTimerSettingsAtTime(settings, at, events),
    );
  const content = textAt(timeMs).content;
  const windowMs = Math.max(1, (textAnimationTotalFrames(animation) * 1000) / frameRate);
  let low = Math.max(0, timeMs - windowMs);
  let high = timeMs;
  if (textAt(low).content === content)
    return { frame: textAnimationTotalFrames(animation), previous: null };
  while (high - low > 0.25) {
    const midpoint = (low + high) / 2;
    if (textAt(midpoint).content === content) high = midpoint;
    else low = midpoint;
  }
  return {
    frame: ((timeMs - high) * frameRate) / 1000,
    previous: textAt(low),
  };
}

export function clockTimerAnimationFrameAtTime(
  element: TextElement,
  timeMs: number,
  frameRate: number,
  events: readonly ClockTimerEvent[] = [],
  lifecycleDriven = false,
): number {
  return clockTimerTextAnimationAtTime(element, timeMs, frameRate, events, lifecycleDriven).frame;
}

export interface ClockTimerRuntimeOptions {
  element: TextElement;
  frameRate: number;
  render: (resolvedText: TextElement, timeMs: number) => void;
  animate?: (resolvedText: TextElement, frame: number, previous?: TextElement | null) => void;
  onState?: (state: ClockTimerState) => void;
  alarms?: readonly ClockTimerAlarmDefinition[];
  /** Live threshold crossings only; deterministic renderAtTime is deliberately silent. */
  onAlarm?: (event: ClockTimerAlarmEvent) => void;
  owner?: Window | null;
  /** Exported graphics arm auto-start on Take In; editor previews start immediately. */
  lifecycleDriven?: boolean;
}

export interface ClockTimerRuntime {
  configure(element: TextElement, frameRate?: number): void;
  startRealtime(): void;
  stopRealtime(): void;
  setClockOwner(owner: Window | null): void;
  setOnAir(onAir: boolean): void;
  command(command: ClockTimerCommand): void;
  configureAlarms(alarms: readonly ClockTimerAlarmDefinition[]): void;
  renderAtTime(
    timeMs: number,
    events?: readonly ClockTimerEvent[],
    lifecycleDriven?: boolean,
  ): void;
  dispose(): void;
}

/** One independent timer per mounted layer. No document edits or React renders on every tick. */
export function createClockTimerRuntime(options: ClockTimerRuntimeOptions): ClockTimerRuntime {
  let element = options.element;
  let settings = normalizeClockTimerSettings(element.clock);
  let frameRate = Math.max(1, options.frameRate);
  let owner = options.owner ?? null;
  const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
  let alarmEpoch = now();
  let alarms = options.alarms ?? [];
  let alarmTracker = createClockTimerAlarmTracker(settings, alarms, options.lifecycleDriven);
  let state = {
    ...initialState(settings, settings.autoStart && !options.lifecycleDriven),
    timestamp: now(),
  };
  let onAir = !options.lifecycleDriven;
  let active = false;
  let disposed = false;
  let request: number | null = null;
  const visualIdentity = (text: TextElement) =>
    JSON.stringify({ ...text, content: '', runs: [], clock: undefined });
  let visual = visualIdentity(element);
  let renderedVisual = '';
  let previousContent: string | null = null;
  let previousText: TextElement | null = null;
  let animationPrevious: TextElement | null = null;
  let lastAnimationPrevious = '';
  let animationEpoch: number | null = null;
  let lastState: ClockTimerState | null = null;
  let lastAnimationFrame: number | null = null;
  let deterministicTime = 0;
  let deterministicEvents: readonly ClockTimerEvent[] = [];
  let deterministicLifecycle = false;

  function publishAlarms(events: readonly ClockTimerAlarmEvent[]): void {
    if (!active || !onAir || disposed) return;
    for (const event of events) options.onAlarm?.(event);
  }

  function publish(
    value: ClockTimerState,
    at: number,
    snapshot?: ClockTimerTextAnimationSnapshot,
  ): void {
    const resolved = resolveClockTimerText(element, value.valueMs, settings);
    const changed = previousContent !== null && previousContent !== resolved.content;
    const animation = normalizeTextAnimation(resolved.textAnimation);
    if (snapshot !== undefined) animationPrevious = snapshot.previous;
    else if (changed && animation.replayOnUpdate) {
      animationEpoch = at;
      animationPrevious = previousText;
    }
    const frame =
      snapshot?.frame ??
      (animationEpoch === null
        ? textAnimationTotalFrames(animation)
        : Math.min(
            textAnimationTotalFrames(animation),
            Math.max(0, ((at - animationEpoch) * frameRate) / 1000),
          ));
    const needsRender = previousContent !== resolved.content || visual !== renderedVisual;
    if (needsRender) {
      options.render(resolved, at);
      renderedVisual = visual;
    }
    const previousIdentity = animationPrevious ? JSON.stringify(animationPrevious) : '';
    if (
      hasTextAnimationSettings(animation) &&
      (needsRender || frame !== lastAnimationFrame || previousIdentity !== lastAnimationPrevious)
    )
      options.animate?.(resolved, frame, animationPrevious);
    lastAnimationFrame = frame;
    lastAnimationPrevious = previousIdentity;
    previousContent = resolved.content;
    previousText = resolved;
    if (!lastState || lastState.running !== value.running || changed) {
      lastState = value;
      options.onState?.({ valueMs: value.valueMs, running: value.running });
    }
  }

  function realtimeSnapshot(): void {
    const at = now();
    state = advance(settings, state, at);
    const alarmEvents = alarmTracker.advanceTo(at - alarmEpoch, true);
    publish(
      settings.mode === 'clock' && settings.source !== 'manual'
        ? { valueMs: Date.now(), running: true }
        : state,
      at,
    );
    publishAlarms(alarmEvents);
  }
  function schedule(): void {
    if (!active || disposed || request !== null) return;
    const animation = normalizeTextAnimation(element.textAnimation);
    const animating =
      animationEpoch !== null &&
      hasTextAnimationSettings(animation) &&
      now() - animationEpoch < (textAnimationTotalFrames(animation) * 1000) / frameRate;
    if (
      !(settings.source !== 'manual' && (settings.mode === 'clock' || state.running)) &&
      !animating
    )
      return;
    const requestFrame =
      owner?.requestAnimationFrame.bind(owner) ??
      (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined);
    if (!requestFrame) return;
    request = requestFrame(() => {
      request = null;
      if (!active || disposed) return;
      realtimeSnapshot();
      schedule();
    });
  }
  function stopRealtime(): void {
    active = false;
    if (request !== null) {
      if (owner) owner.cancelAnimationFrame(request);
      else if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(request);
    }
    request = null;
  }
  function renderAtTime(
    timeMs: number,
    events: readonly ClockTimerEvent[] = [],
    lifecycleDriven = false,
  ): void {
    stopRealtime();
    deterministicTime = Math.max(0, timeMs);
    deterministicEvents = events;
    deterministicLifecycle = lifecycleDriven;
    const value = clockTimerStateAtTime(settings, deterministicTime, events, lifecycleDriven);
    const snapshot = clockTimerTextAnimationAtTime(
      element,
      deterministicTime,
      frameRate,
      events,
      lifecycleDriven,
    );
    publish(value, deterministicTime, snapshot);
  }

  return {
    configure(nextElement, nextFrameRate) {
      if (disposed) return;
      const next = normalizeClockTimerSettings(nextElement.clock);
      const durationOnly =
        next.source === settings.source &&
        next.mode === settings.mode &&
        next.limitMs === settings.limitMs &&
        next.initialValueMs !== settings.initialValueMs;
      const restart =
        next.source !== settings.source ||
        next.mode !== settings.mode ||
        next.initialValueMs !== settings.initialValueMs ||
        next.limitMs !== settings.limitMs ||
        // An on-air update to overtime must not rewind a running timer; editor previews start over.
        (!options.lifecycleDriven && next.endBehavior !== settings.endBehavior);
      state = advance(settings, state, now());
      const wasRunning = state.running;
      element = nextElement;
      visual = visualIdentity(element);
      settings = next;
      frameRate = Math.max(1, nextFrameRate ?? frameRate);
      if (restart) {
        // A new duration from data keeps the operator's Pause; every other restart re-arms.
        const keepRunning = options.lifecycleDriven && durationOnly;
        const running = keepRunning ? wasRunning : settings.autoStart && onAir;
        state = { ...initialState(settings, running), timestamp: now() };
        alarmEpoch = now();
        alarmTracker = createClockTimerAlarmTracker(settings, alarms, !onAir);
        if (keepRunning && onAir)
          publishAlarms(
            alarmTracker.command({ timestamp: 0, command: running ? 'start' : 'pause' }, true),
          );
      } else {
        alarmTracker.configureSettings(settings);
      }
      if (!restart && settings.source === 'manual') {
        publishAlarms(
          alarmTracker.command(
            {
              timestamp: now() - alarmEpoch,
              command: 'set-value',
              value: settings.manualValue,
            },
            true,
          ),
        );
      }
      if (active) {
        realtimeSnapshot();
        schedule();
      } else renderAtTime(deterministicTime, deterministicEvents, deterministicLifecycle);
    },
    startRealtime() {
      if (disposed) return;
      active = true;
      realtimeSnapshot();
      schedule();
    },
    stopRealtime,
    setClockOwner(nextOwner) {
      const restart = active;
      stopRealtime();
      owner = nextOwner;
      if (restart) {
        active = true;
        schedule();
      }
    },
    setOnAir(nextOnAir) {
      if (disposed || nextOnAir === onAir) return;
      onAir = nextOnAir;
      publishAlarms(
        alarmTracker.command(
          {
            timestamp: now() - alarmEpoch,
            command: onAir ? 'take-in' : 'take-out',
          },
          true,
        ),
      );
      state = applyCommand(settings, state, onAir ? 'take-in' : 'take-out', now());
      if (active) {
        realtimeSnapshot();
        schedule();
      }
    },
    command(command) {
      if (disposed || settings.mode === 'clock') return;
      publishAlarms(alarmTracker.command({ timestamp: now() - alarmEpoch, command }, true));
      // Manual feeds remain authoritative. Reset/Restart only rearm their alarm latches.
      if (settings.source === 'manual') return;
      state = applyCommand(settings, state, command, now());
      realtimeSnapshot();
      schedule();
    },
    configureAlarms(next) {
      alarms = next;
      alarmTracker.setAlarms(next);
    },
    renderAtTime,
    dispose() {
      stopRealtime();
      disposed = true;
    },
  };
}
