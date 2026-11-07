import type { ClockTimerSettings, Layer } from './types';

export type ClockTimerCommand = 'start' | 'pause' | 'reset' | 'restart';
export const MAX_TIMER_VALUE_MS = 100 * 366 * 24 * 60 * 60 * 1000;
const MAX_DATE_MS = 8.64e15;
const FORMAT_PARTS = /\[[^\]]*\]|SSS|hh|mm|ss|dd|[hmsdAa]|./gs;
const TIME_TOKEN = /^(?:SSS|hh|mm|ss|dd|[hmsd])$/;
const formatters = new Map<string, Intl.DateTimeFormat>();
const timeZoneValidity = new Map<string, boolean>();

export function isClockTimeZoneValid(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 128) return false;
  if (timeZone === 'local') return true;
  const cached = timeZoneValidity.get(timeZone);
  if (cached !== undefined) return cached;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    if (timeZoneValidity.size >= 64) timeZoneValidity.clear();
    timeZoneValidity.set(timeZone, true);
    return true;
  } catch {
    if (timeZoneValidity.size >= 64) timeZoneValidity.clear();
    timeZoneValidity.set(timeZone, false);
    return false;
  }
}

export function isClockTimerFormatValid(format: unknown): format is string {
  if (typeof format !== 'string' || !format.trim() || format.length > 128) return false;
  const parts = format.match(FORMAT_PARTS) ?? [];
  return (
    parts.some((part) => TIME_TOKEN.test(part)) &&
    !parts.some((part) => part === '[' || part === ']')
  );
}

export function normalizeClockTimerSettings(value?: unknown): ClockTimerSettings {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const mode = source.mode === 'count-up' || source.mode === 'count-down' ? source.mode : 'clock';
  const boolean = (key: string, fallback: boolean): boolean =>
    typeof source[key] === 'boolean' ? (source[key] as boolean) : fallback;
  const finite = (key: string, fallback: number, min: number, max: number): number =>
    typeof source[key] === 'number' && Number.isFinite(source[key])
      ? Math.min(max, Math.max(min, source[key] as number))
      : fallback;
  return {
    mode,
    source: source.source === 'manual' ? 'manual' : 'automatic',
    manualValue:
      typeof source.manualValue === 'string'
        ? source.manualValue.slice(0, 256)
        : typeof source.manualValue === 'number' && Number.isFinite(source.manualValue)
          ? source.manualValue
          : 0,
    format: isClockTimerFormatValid(source.format) ? source.format : 'hh:mm:ss',
    hourCycle: source.hourCycle === '12' ? '12' : '24',
    timeZone: isClockTimeZoneValid(source.timeZone) ? source.timeZone : 'local',
    padHours: boolean('padHours', true),
    padMinutes: boolean('padMinutes', true),
    padSeconds: boolean('padSeconds', true),
    showAmPm: boolean('showAmPm', false),
    uppercaseAmPm: boolean('uppercaseAmPm', true),
    initialValueMs: finite(
      'initialValueMs',
      mode === 'count-down' ? 60000 : 0,
      0,
      MAX_TIMER_VALUE_MS,
    ),
    limitMs:
      typeof source.limitMs === 'number' && Number.isFinite(source.limitMs) && source.limitMs >= 0
        ? Math.min(MAX_TIMER_VALUE_MS, source.limitMs)
        : null,
    endBehavior:
      source.endBehavior === 'continue' || source.endBehavior === 'loop'
        ? source.endBehavior
        : 'stop',
    autoStart: boolean('autoStart', true),
    pauseWhenOffAir: boolean('pauseWhenOffAir', true),
    referenceTimeMs: finite('referenceTimeMs', 0, -MAX_DATE_MS, MAX_DATE_MS),
    prefix: typeof source.prefix === 'string' ? source.prefix.slice(0, 256) : '',
    suffix: typeof source.suffix === 'string' ? source.suffix.slice(0, 256) : '',
  };
}

/** Clock and timer settings a data field can drive, as `clock.<setting>` binding targets. */
export const CLOCK_DATA_SETTINGS = [
  'timeZone',
  'hourCycle',
  'showAmPm',
  'format',
  'initialValueMs',
  'endBehavior',
] as const;
export type ClockDataSetting = (typeof CLOCK_DATA_SETTINGS)[number];

export function clockDataSetting(property: string): ClockDataSetting | null {
  const name = property.startsWith('clock.') ? property.slice('clock.'.length) : '';
  return (CLOCK_DATA_SETTINGS as readonly string[]).includes(name)
    ? (name as ClockDataSetting)
    : null;
}

/**
 * The settings with one data value applied, or null when the setting can't take that value, so a
 * bad feed leaves the authored setting on air. Durations are milliseconds, or `mm:ss`/`hh:mm:ss`.
 */
export function clockSettingsWithData(
  settings: ClockTimerSettings,
  setting: ClockDataSetting,
  value: unknown,
): ClockTimerSettings | null {
  switch (setting) {
    case 'timeZone':
      return isClockTimeZoneValid(value) ? { ...settings, timeZone: value } : null;
    case 'hourCycle': {
      const hourCycle = String(value);
      return hourCycle === '12' || hourCycle === '24' ? { ...settings, hourCycle } : null;
    }
    case 'showAmPm': {
      const text = String(value);
      return text === 'true' || text === 'false'
        ? { ...settings, showAmPm: text === 'true' }
        : null;
    }
    case 'format':
      return isClockTimerFormatValid(value) ? { ...settings, format: value } : null;
    case 'initialValueMs': {
      const ms = parseClockTimerManualValue({ ...settings, mode: 'count-down' }, value);
      return ms !== null && ms >= 0 && ms <= MAX_TIMER_VALUE_MS
        ? { ...settings, initialValueMs: ms }
        : null;
    }
    case 'endBehavior':
      return value === 'stop' || value === 'continue' || value === 'loop'
        ? { ...settings, endBehavior: value }
        : null;
  }
}

/** Validate authored settings before normalization; malformed files still render safely. */
export function validateClockTimerSettings(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['Clock settings must be an object.'];
  const input = value as Record<string, unknown>;
  const errors: string[] = [];
  if (!['clock', 'count-up', 'count-down'].includes(String(input.mode)))
    errors.push('Clock mode must be clock, count-up or count-down.');
  if (!['automatic', 'manual'].includes(String(input.source)))
    errors.push('Clock source must be automatic or manual.');
  if (
    (typeof input.manualValue !== 'string' || input.manualValue.length > 256) &&
    (typeof input.manualValue !== 'number' || !Number.isFinite(input.manualValue))
  )
    errors.push('Manual time must be finite milliseconds or time text of at most 256 characters.');
  else if (
    input.source === 'manual' &&
    parseClockTimerManualValue(normalizeClockTimerSettings(input), input.manualValue) === null
  )
    errors.push(
      'Manual time must be milliseconds, a valid time string, or an ISO date/time for clock mode.',
    );
  if (!isClockTimerFormatValid(input.format))
    errors.push(
      'Time format must contain a time token and use balanced literal brackets (maximum 128 characters).',
    );
  if (!['12', '24'].includes(String(input.hourCycle)))
    errors.push('Clock hour cycle must be 12 or 24.');
  if (!isClockTimeZoneValid(input.timeZone))
    errors.push('Clock time zone must be local, UTC or a valid IANA time zone.');
  for (const key of [
    'padHours',
    'padMinutes',
    'padSeconds',
    'showAmPm',
    'uppercaseAmPm',
    'autoStart',
    'pauseWhenOffAir',
  ]) {
    if (typeof input[key] !== 'boolean') errors.push(`Clock ${key} must be a boolean.`);
  }
  if (!['stop', 'continue', 'loop'].includes(String(input.endBehavior)))
    errors.push('Timer end behavior must be stop, continue or loop.');
  for (const key of ['initialValueMs', 'limitMs']) {
    if (key === 'limitMs' && input[key] === null) continue;
    if (
      typeof input[key] !== 'number' ||
      !Number.isFinite(input[key]) ||
      input[key] < 0 ||
      input[key] > MAX_TIMER_VALUE_MS
    )
      errors.push(`Timer ${key} must be a non-negative finite duration of at most 100 years.`);
  }
  if (
    typeof input.referenceTimeMs !== 'number' ||
    !Number.isFinite(input.referenceTimeMs) ||
    Math.abs(input.referenceTimeMs) > MAX_DATE_MS
  )
    errors.push('Clock reference time must be a valid epoch in milliseconds.');
  for (const key of ['prefix', 'suffix'])
    if (typeof input[key] !== 'string' || input[key].length > 256)
      errors.push(`Clock ${key} must be text with at most 256 characters.`);
  return errors;
}

function clockParts(
  valueMs: number,
  timeZone: string,
): { hours: number; minutes: number; seconds: number; days: number; millis: number } {
  const date = new Date(Math.max(-MAX_DATE_MS, Math.min(MAX_DATE_MS, valueMs)));
  const millis = date.getUTCMilliseconds();
  if (timeZone === 'local')
    return {
      hours: date.getHours(),
      minutes: date.getMinutes(),
      seconds: date.getSeconds(),
      days: date.getDate(),
      millis,
    };
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: 'numeric',
    });
    if (formatters.size >= 64) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    hours: Number(parts.hour) % 24,
    minutes: Number(parts.minute),
    seconds: Number(parts.second),
    days: Number(parts.day),
    millis,
  };
}

/** Parse manual clock/timer feeds. Invalid values return null so feeds can retain their fallback. */
export function parseClockTimerManualValue(
  settings: ClockTimerSettings,
  value: unknown,
): number | null {
  const normalized = normalizeClockTimerSettings(settings);
  const max = normalized.mode === 'clock' ? MAX_DATE_MS : MAX_TIMER_VALUE_MS;
  if (typeof value === 'number')
    return Number.isFinite(value) && Math.abs(value) <= max ? value : null;
  if (typeof value !== 'string' || value.length > 256 || !value.trim()) return null;
  const text = value.trim();
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) && Math.abs(numeric) <= max ? numeric : null;
  }
  if (normalized.mode === 'clock') {
    const time = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(AM|PM)?$/i.exec(text);
    if (time) {
      let hours = Number(time[1]);
      const minutes = Number(time[2]);
      const seconds = Number(time[3] ?? 0);
      const millis = Number((time[4] ?? '').padEnd(3, '0'));
      if (minutes > 59 || seconds > 59 || (time[5] ? hours < 1 || hours > 12 : hours > 23))
        return null;
      if (time[5]) hours = (hours % 12) + (time[5].toUpperCase() === 'PM' ? 12 : 0);
      if (normalized.timeZone === 'local')
        return new Date(2000, 0, 2, hours, minutes, seconds, millis).getTime();
      let epoch = Date.UTC(2000, 0, 2, hours, minutes, seconds, millis);
      // A fixed middle day avoids missing/ambiguous wall times around DST transitions.
      for (let attempt = 0; attempt < 3; attempt++) {
        const actual = clockParts(epoch, normalized.timeZone);
        const delta =
          (2 - actual.days) * 86400000 +
          (hours - actual.hours) * 3600000 +
          (minutes - actual.minutes) * 60000 +
          (seconds - actual.seconds) * 1000;
        epoch += delta;
        if (delta === 0) return epoch;
      }
      return epoch;
    }
    // Require an explicit offset for date/time feeds so a browser's local zone cannot reinterpret them.
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
    )
      return null;
    const epoch = Date.parse(text);
    return Number.isFinite(epoch) ? epoch : null;
  }
  const duration = /^([+-]?)(\d+):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/.exec(text);
  if (!duration) return null;
  const first = Number(duration[2]);
  const second = Number(duration[3]);
  const third = duration[4] === undefined ? null : Number(duration[4]);
  if (second > 59 || (third !== null && third > 59)) return null;
  const seconds = third === null ? first * 60 + second : first * 3600 + second * 60 + third;
  const millis = Number((duration[5] ?? '').padEnd(3, '0'));
  const result = (seconds * 1000 + millis) * (duration[1] === '-' ? -1 : 1);
  return Number.isFinite(result) && Math.abs(result) <= max ? result : null;
}

/** The layer and command a built-in clock/timer action id names; `null` for other ids. */
export function parseClockTimerActionId(
  actionId: string,
): { layerId: string; command: ClockTimerCommand } | null {
  const match = /^clock:([^:]+):(start|pause|reset|restart)$/.exec(actionId);
  if (!match) return null;
  try {
    return { layerId: decodeURIComponent(match[1]!), command: match[2] as ClockTimerCommand };
  } catch {
    return null;
  }
}

/** Remap generated public timer command references when a layer is copied or instanced. */
export function remapClockTimerActionId(
  actionId: string,
  layerIds: ReadonlyMap<string, string>,
): string {
  const match = /^clock:([^:]+):(start|pause|reset|restart)$/.exec(actionId);
  if (!match) return actionId;
  try {
    const layerId = layerIds.get(decodeURIComponent(match[1]!));
    return layerId ? clockTimerActionId(layerId, match[2] as ClockTimerCommand) : actionId;
  } catch {
    return actionId;
  }
}

/** Generated timer actions are owned by the copied layer, like layer/field references. */
export function remapClockTimerLayerActions(
  layer: Layer,
  layerIds: ReadonlyMap<string, string>,
): void {
  if (layer.loop?.activation.type === 'customAction')
    layer.loop.activation.customActionId = remapClockTimerActionId(
      layer.loop.activation.customActionId,
      layerIds,
    );
  if (layer.element.type === 'text' && layer.element.textAnimation.customActionId)
    layer.element.textAnimation.customActionId = remapClockTimerActionId(
      layer.element.textAnimation.customActionId,
      layerIds,
    );
}

/** Epoch milliseconds for system clocks; a signed duration for count-up/down timers. */
export function formatClockTimerValue(settings: ClockTimerSettings, valueMs: number): string {
  const normalized = normalizeClockTimerSettings(settings);
  const safeValue = Number.isFinite(valueMs) ? valueMs : 0;
  const tokens: string[] = normalized.format.match(FORMAT_PARTS) ?? [];
  const hasDays = tokens.some((part) => part === 'd' || part === 'dd');
  const hasHours = tokens.some((part) => part === 'h' || part === 'hh');
  const hasMinutes = tokens.some((part) => part === 'm' || part === 'mm');
  const isClock = normalized.mode === 'clock';
  const abs = Math.min(MAX_TIMER_VALUE_MS, Math.abs(safeValue));
  const elapsedSeconds =
    normalized.mode === 'count-down' && safeValue > 0 && !tokens.includes('SSS')
      ? Math.ceil(abs / 1000)
      : Math.floor(abs / 1000);
  const parts = isClock
    ? clockParts(safeValue, normalized.timeZone)
    : {
        days: Math.floor(elapsedSeconds / 86400),
        hours: hasDays ? Math.floor(elapsedSeconds / 3600) % 24 : Math.floor(elapsedSeconds / 3600),
        minutes:
          hasHours || hasDays
            ? Math.floor(elapsedSeconds / 60) % 60
            : Math.floor(elapsedSeconds / 60),
        seconds: hasMinutes || hasHours || hasDays ? elapsedSeconds % 60 : elapsedSeconds,
        millis: Math.floor(abs % 1000),
      };
  const amPm = parts.hours >= 12 ? 'PM' : 'AM';
  const hours = isClock && normalized.hourCycle === '12' ? parts.hours % 12 || 12 : parts.hours;
  const pad = (value: number, enabled: boolean): string =>
    enabled ? String(value).padStart(2, '0') : String(value);
  const content = tokens
    .map((token) => {
      if (token.startsWith('[')) return token.slice(1, -1);
      switch (token) {
        case 'hh':
          return pad(hours, normalized.padHours);
        case 'h':
          return String(hours);
        case 'mm':
          return pad(parts.minutes, normalized.padMinutes);
        case 'm':
          return String(parts.minutes);
        case 'ss':
          return pad(parts.seconds, normalized.padSeconds);
        case 's':
          return String(parts.seconds);
        case 'dd':
          return pad(parts.days, true);
        case 'd':
          return String(parts.days);
        case 'SSS':
          return String(parts.millis).padStart(3, '0');
        case 'A':
          return isClock && normalized.hourCycle === '12' ? amPm : '';
        case 'a':
          return isClock && normalized.hourCycle === '12' ? amPm.toLowerCase() : '';
        default:
          return token;
      }
    })
    .join('');
  const suffix =
    isClock &&
    normalized.hourCycle === '12' &&
    normalized.showAmPm &&
    !tokens.includes('A') &&
    !tokens.includes('a')
      ? ` ${normalized.uppercaseAmPm ? amPm : amPm.toLowerCase()}`
      : '';
  return `${normalized.prefix}${!isClock && safeValue < 0 ? '-' : ''}${content}${suffix}${normalized.suffix}`;
}

export function clockTimerActionId(layerId: string, command: ClockTimerCommand): string {
  return `clock:${encodeURIComponent(layerId)}:${command}`;
}

export function isClockTimerActionId(layers: readonly Layer[], actionId: string): boolean {
  return layers.some(
    (layer) =>
      !layer.isGuide &&
      layer.element.type === 'text' &&
      layer.element.clock &&
      (['start', 'pause', 'reset', 'restart'] as const).some(
        (command) => clockTimerActionId(layer.id, command) === actionId,
      ),
  );
}
