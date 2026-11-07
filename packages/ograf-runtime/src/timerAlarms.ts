import {
  normalizeClockTimerSettings,
  parseClockTimerManualValue,
  type ClockTimerSettings,
} from '@ograf-editor/scene-model';
import type { ClockTimerEvent } from './clockTimerRuntime';
import type { CompiledLayer } from '@ograf-editor/ograf-types';

export interface ClockTimerAlarmDefinition {
  id: string;
  ownerLayerId?: string;
  thresholdMs: number;
  direction: 'up' | 'down';
}

export interface ClockTimerAlarmEvent {
  id: string;
  ownerLayerId?: string;
  timestamp: number;
  valueMs: number;
  /** Reset/Restart and every completed loop create independent alarm runs. */
  run: number;
}

export function compiledTimerAlarms(
  layers: readonly CompiledLayer[],
  sourceLayerId: string,
): ClockTimerAlarmDefinition[] {
  return layers.flatMap((layer) =>
    (layer.visualRules ?? []).flatMap((rule) =>
      rule.enabled &&
      rule.trigger === 'timer-alarm' &&
      rule.timerAlarm?.sourceLayerId === sourceLayerId
        ? [
            {
              id: rule.id,
              ownerLayerId: layer.id,
              thresholdMs: rule.timerAlarm.thresholdMs,
              direction: rule.timerAlarm.direction,
            },
          ]
        : [],
    ),
  );
}

/** An independent raw-value latch; formatted display updates never drive alarms. */
export function createClockTimerAlarmTracker(
  settings: ClockTimerSettings,
  initialAlarms: readonly ClockTimerAlarmDefinition[],
  lifecycleDriven = false,
) {
  let alarms = initialAlarms;
  let value =
    settings.source === 'manual'
      ? (parseClockTimerManualValue(settings, settings.manualValue) ?? Number.NaN)
      : settings.initialValueMs;
  let running = settings.source !== 'manual' && settings.autoStart && !lifecycleDriven;
  let timestamp = 0;
  let run = 0;
  let fired = new Set<string>();
  let pendingStart = running;
  const alarmKey = (alarm: Pick<ClockTimerAlarmDefinition, 'id' | 'ownerLayerId'>) =>
    JSON.stringify([alarm.ownerLayerId ?? null, alarm.id]);
  const identity = (alarm: ClockTimerAlarmDefinition) => ({
    id: alarm.id,
    ...(alarm.ownerLayerId === undefined ? {} : { ownerLayerId: alarm.ownerLayerId }),
  });

  function startAlarms(at: number): ClockTimerAlarmEvent[] {
    if (!pendingStart || settings.mode === 'clock' || settings.source === 'manual') return [];
    pendingStart = false;
    const direction = settings.mode === 'count-down' ? 'down' : 'up';
    return alarms.flatMap((alarm) => {
      if (
        alarm.direction !== direction ||
        alarm.thresholdMs !== value ||
        fired.has(alarmKey(alarm))
      )
        return [];
      fired.add(alarmKey(alarm));
      return [{ ...identity(alarm), timestamp: at, valueMs: value, run }];
    });
  }

  function crossing(from: number, to: number, start: number, end: number): ClockTimerAlarmEvent[] {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return [];
    const result: ClockTimerAlarmEvent[] = [];
    for (const alarm of alarms) {
      if (fired.has(alarmKey(alarm)) || !Number.isFinite(alarm.thresholdMs)) continue;
      const crossed =
        alarm.direction === 'down'
          ? from > alarm.thresholdMs && to <= alarm.thresholdMs
          : from < alarm.thresholdMs && to >= alarm.thresholdMs;
      if (!crossed) continue;
      fired.add(alarmKey(alarm));
      const progress = (alarm.thresholdMs - from) / (to - from);
      result.push({
        ...identity(alarm),
        timestamp: start + (end - start) * progress,
        valueMs: alarm.thresholdMs,
        run,
      });
    }
    return result.sort(
      (a, b) => a.timestamp - b.timestamp || (a.valueMs - b.valueMs) * Math.sign(to - from),
    );
  }

  function advanceTo(at: number, coalesceExpired = false): ClockTimerAlarmEvent[] {
    at = Math.max(timestamp, at);
    if (settings.mode === 'clock' || settings.source === 'manual' || !running) {
      timestamp = at;
      return [];
    }
    const direction = settings.mode === 'count-down' ? -1 : 1;
    const boundary = direction < 0 ? 0 : settings.limitMs;
    const result: ClockTimerAlarmEvent[] = startAlarms(timestamp);
    let cursor = timestamp;
    // A loop cannot contain an unbounded zero-duration cycle.
    if (
      boundary !== null &&
      settings.endBehavior !== 'continue' &&
      (boundary - settings.initialValueMs) * direction <= 0
    ) {
      running = false;
      value = settings.initialValueMs;
      timestamp = at;
      return result;
    }
    // Alarm-free clocks still need their current phase for definitions added later.
    // Integrate that phase arithmetically rather than replaying empty loop cycles.
    if (!alarms.length) {
      const destination = value + (at - timestamp) * direction;
      if (
        boundary !== null &&
        settings.endBehavior !== 'continue' &&
        (destination - boundary) * direction >= 0
      ) {
        if (settings.endBehavior === 'loop') {
          const span = (boundary - settings.initialValueMs) * direction;
          const travelled = (destination - settings.initialValueMs) * direction;
          run += Math.floor(travelled / span);
          value = settings.initialValueMs + (travelled % span) * direction;
          fired.clear();
        } else {
          value = boundary;
          running = false;
        }
      } else value = destination;
      timestamp = at;
      return [];
    }
    // Live resumption only needs the latest cycle; skip arbitrarily many old cycles arithmetically.
    if (coalesceExpired && settings.endBehavior === 'loop' && boundary !== null) {
      const span = (boundary - settings.initialValueMs) * direction;
      const firstBoundary = Math.max(0, (boundary - value) * direction);
      const skipped = Math.floor((at - cursor - firstBoundary) / span);
      if (span > 0 && skipped > 0) {
        cursor += firstBoundary + (skipped - 1) * span;
        value = settings.initialValueMs;
        run += skipped;
        fired = new Set();
        pendingStart = true;
        result.length = 0;
      }
    }
    let segments = 0;
    while (cursor < at && running) {
      result.push(...startAlarms(cursor));
      if (++segments > 10000 || result.length > 10000)
        throw new Error('Timer alarm replay exceeded 10000 events.');
      const destination = value + (at - cursor) * direction;
      if (
        boundary === null ||
        settings.endBehavior === 'continue' ||
        (destination - boundary) * direction < 0
      ) {
        result.push(...crossing(value, destination, cursor, at));
        value = destination;
        cursor = at;
      } else {
        const arrival = cursor + Math.max(0, (boundary - value) * direction);
        result.push(...crossing(value, boundary, cursor, arrival));
        cursor = arrival;
        value = boundary;
        if (settings.endBehavior === 'loop') {
          run += 1;
          fired = new Set();
          value = settings.initialValueMs;
          pendingStart = true;
        } else running = false;
      }
    }
    timestamp = at;
    if (!coalesceExpired || !result.length) return result;
    // A suspended live renderer must not replay obsolete warnings after time is up.
    const latestRun = result.at(-1)!.run;
    const latest = result.filter((event) => event.run === latestRun);
    const zero = latest.filter(
      (event) =>
        event.valueMs === 0 &&
        alarms.some((alarm) => alarmKey(alarm) === alarmKey(event) && alarm.direction === 'down'),
    );
    return zero.length ? zero : latest;
  }

  function command(event: ClockTimerEvent, coalesceExpired = false): ClockTimerAlarmEvent[] {
    const result = advanceTo(event.timestamp, coalesceExpired);
    const at = Math.max(timestamp, event.timestamp);
    if (event.command === 'set-settings' && event.settings) {
      const next = normalizeClockTimerSettings({ ...settings, ...event.settings });
      if (next.initialValueMs !== settings.initialValueMs) {
        run += 1;
        fired = new Set();
        if (next.source !== 'manual') value = next.initialValueMs;
        pendingStart = running && next.source !== 'manual';
      }
      settings = next;
      timestamp = at;
      return [...result, ...startAlarms(at)];
    }
    if (settings.mode === 'clock') return [];
    if (event.command === 'reset' || event.command === 'restart') {
      run += 1;
      fired = new Set();
      if (settings.source !== 'manual') value = settings.initialValueMs;
      running = settings.source !== 'manual' && event.command === 'restart';
      pendingStart = running;
    } else if (
      event.command === 'set-value' &&
      settings.source === 'manual' &&
      event.value !== undefined
    ) {
      const next = parseClockTimerManualValue(settings, event.value) ?? Number.NaN;
      const crossed = crossing(value, next, at, at);
      value = next;
      if (
        coalesceExpired &&
        crossed.some(
          (alarm) =>
            alarm.valueMs === 0 &&
            alarms.some(
              (definition) =>
                alarmKey(definition) === alarmKey(alarm) && definition.direction === 'down',
            ),
        )
      )
        result.push(...crossed.filter((alarm) => alarm.valueMs === 0));
      else result.push(...crossed);
    } else if (settings.source !== 'manual') {
      if (event.command === 'start') {
        pendingStart = !running;
        running = true;
      } else if (event.command === 'pause') {
        running = false;
        pendingStart = false;
      } else if (event.command === 'take-in') {
        pendingStart = !running && settings.autoStart;
        running ||= settings.autoStart;
      } else if (event.command === 'take-out' && settings.pauseWhenOffAir) running = false;
    }
    timestamp = at;
    return [...result, ...startAlarms(at)];
  }

  return {
    advanceTo,
    command,
    setAlarms(next: readonly ClockTimerAlarmDefinition[], pruneReleasedSubscriptions = false) {
      alarms = next;
      if (pruneReleasedSubscriptions) {
        const active = new Set(next.map(alarmKey));
        for (const key of fired) if (!active.has(key)) fired.delete(key);
      }
    },
    configureSettings(next: ClockTimerSettings) {
      settings = next;
    },
    nextAlarmTimestamp(): number | undefined {
      if (!running || settings.source === 'manual' || settings.mode === 'clock') return;
      const direction = settings.mode === 'count-down' ? -1 : 1;
      const boundary = direction < 0 ? 0 : settings.limitMs;
      const span = boundary === null ? 0 : (boundary - settings.initialValueMs) * direction;
      let next: number | undefined;
      for (const alarm of alarms) {
        if (alarm.direction !== (direction < 0 ? 'down' : 'up')) continue;
        let distance = (alarm.thresholdMs - value) * direction;
        const withinBoundary =
          boundary === null ||
          settings.endBehavior === 'continue' ||
          (alarm.thresholdMs - boundary) * direction <= 0;
        if (!withinBoundary) continue;
        if (fired.has(alarmKey(alarm)) || distance < 0 || (distance === 0 && !pendingStart)) {
          if (settings.endBehavior !== 'loop' || boundary === null || span <= 0) continue;
          const nextDistance = (alarm.thresholdMs - settings.initialValueMs) * direction;
          if (nextDistance < 0 || nextDistance > span) continue;
          distance = (boundary - value) * direction + nextDistance;
        }
        const at = timestamp + distance;
        if (next === undefined || at < next) next = at;
      }
      return next;
    },
  };
}

/** Exact schedule replay, including every warning before the final alarm. */
export function clockTimerAlarmEventsAtTime(
  settings: ClockTimerSettings,
  alarms: readonly ClockTimerAlarmDefinition[],
  timestamp: number,
  events: readonly ClockTimerEvent[] = [],
  lifecycleDriven = false,
): ClockTimerAlarmEvent[] {
  if (!alarms.length || settings.mode === 'clock') return [];
  const tracker = createClockTimerAlarmTracker(settings, alarms, lifecycleDriven);
  const result: ClockTimerAlarmEvent[] = [];
  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    if (event.timestamp > timestamp) break;
    result.push(...tracker.command({ ...event, timestamp: Math.max(0, event.timestamp) }));
  }
  return [...result, ...tracker.advanceTo(Math.max(0, timestamp))];
}
