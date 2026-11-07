import {
  normalizeClockTimerSettings,
  MAX_TIMER_VALUE_MS,
  parseClockTimerManualValue,
  type ClockTimerSettings,
  type Layer,
  type TimerAlarmTrigger,
} from '@ograf-editor/scene-model';

/** Alarms are ordinary rules. Their explicit source survives changing the rule owner. */
export function timerAlarmRules(layers: readonly Layer[], sourceLayerId: string) {
  return layers.flatMap((owner) =>
    (owner.visualRules ?? []).flatMap((rule) =>
      rule.trigger === 'timer-alarm' && rule.timerAlarm?.sourceLayerId === sourceLayerId
        ? [{ owner, rule, alarm: rule.timerAlarm }]
        : [],
    ),
  );
}

/** Reading order follows the timer's travel; canonical Rules/action order stays untouched. */
export function sortedTimerAlarmRules(
  layers: readonly Layer[],
  sourceLayerId: string,
  mode: ClockTimerSettings['mode'],
) {
  const direction = mode === 'count-down' ? -1 : 1;
  return timerAlarmRules(layers, sourceLayerId).sort(
    (left, right) =>
      direction * (left.alarm.thresholdMs - right.alarm.thresholdMs) ||
      `${left.owner.id}:${left.rule.id}`.localeCompare(`${right.owner.id}:${right.rule.id}`),
  );
}

export function nextTimerAlarm(
  layers: readonly Layer[],
  sourceLayerId: string,
  settings: ClockTimerSettings,
): TimerAlarmTrigger {
  const clock = normalizeClockTimerSettings(settings);
  const direction = clock.mode === 'count-up' ? 'up' : 'down';
  const existing = timerAlarmRules(layers, sourceLayerId)
    .filter(({ alarm }) => alarm.direction === direction)
    .map(({ alarm }) => alarm.thresholdMs);
  const preferred =
    direction === 'down'
      ? [0, ...(clock.initialValueMs > 5_000 ? [5_000] : [])]
      : [clock.limitMs ?? 5_000];
  let thresholdMs = preferred.find((candidate) => !existing.includes(candidate));
  if (thresholdMs === undefined) {
    thresholdMs = 5_000;
    while (existing.includes(thresholdMs)) thresholdMs += 5_000;
  }
  return { sourceLayerId, thresholdMs, direction };
}

export function formatTimerAlarmThreshold(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const seconds = Math.floor(total / 1_000) % 60;
  const minutes = Math.floor(total / 60_000) % 60;
  const hours = Math.floor(total / 3_600_000);
  const base = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const fraction = total % 1_000;
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${base}${fraction ? `.${String(fraction).padStart(3, '0')}` : ''}`;
}

export function parseTimerAlarmThreshold(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = /^\d+(?:\.\d+)?$/.test(trimmed)
    ? Number(trimmed) * 1_000
    : parseClockTimerManualValue(normalizeClockTimerSettings({ mode: 'count-down' }), trimmed);
  return typeof parsed === 'number' &&
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    parsed <= MAX_TIMER_VALUE_MS
    ? parsed
    : null;
}
