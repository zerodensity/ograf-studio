export type DurationUnit = 'seconds' | 'frames' | 'timecode';

export interface ParsedDuration {
  frames: number;
  exactFrames: number;
  rounded: boolean;
}

/** Do not re-interpret a rounded display when focus leaves an untouched frame value. */
export function resolveFrameDurationDraft(
  draft: string,
  displayed: string,
  frameRate: number,
  unit: DurationUnit,
): ParsedDuration | null | undefined {
  return draft === displayed ? undefined : parseDurationInput(draft, frameRate, unit);
}

/** Parse explicit units or use the displayed preference for bare numbers. Timecode is non-drop-frame. */
export function parseDurationInput(
  input: string,
  frameRate: number,
  unit: DurationUnit,
): ParsedDuration | null {
  if (!Number.isFinite(frameRate) || frameRate <= 0) return null;
  const value = input.trim();
  const timecode = /^(\d+):([0-5]\d):([0-5]\d):(\d{2})$/.exec(value);
  let exactFrames: number;
  if (timecode) {
    const nominal = Math.round(frameRate);
    const frames = Number(timecode[4]);
    if (nominal < 1 || frames >= nominal) return null;
    exactFrames =
      (Number(timecode[1]) * 3600 + Number(timecode[2]) * 60 + Number(timecode[3])) * nominal +
      frames;
  } else {
    const match = /^(\d+(?:\.\d+)?|\.\d+)\s*(ms|s|f)?$/i.exec(value);
    if (!match) return null;
    const number = Number(match[1]);
    const suffix = match[2]?.toLowerCase();
    if (!Number.isFinite(number)) return null;
    const kind = suffix ?? (unit === 'seconds' ? 's' : 'f');
    exactFrames =
      kind === 'f' ? number : kind === 'ms' ? (number * frameRate) / 1000 : number * frameRate;
  }
  if (!Number.isFinite(exactFrames) || exactFrames > Number.MAX_SAFE_INTEGER) return null;
  const frames = Math.round(exactFrames);
  return { frames, exactFrames, rounded: Math.abs(frames - exactFrames) > 1e-7 };
}

export function formatDurationInput(frames: number, frameRate: number, unit: DurationUnit): string {
  const safeFrames = Math.max(0, Math.round(Number.isFinite(frames) ? frames : 0));
  if (unit === 'frames') return `${safeFrames}f`;
  if (unit === 'seconds') return `${(frameRate > 0 ? safeFrames / frameRate : 0).toFixed(2)}s`;
  const nominal = Math.max(1, Math.round(frameRate || 1));
  const hours = Math.floor(safeFrames / (nominal * 3600));
  const minutes = Math.floor(safeFrames / (nominal * 60)) % 60;
  const seconds = Math.floor(safeFrames / nominal) % 60;
  const remainder = safeFrames % nominal;
  return [hours, minutes, seconds, remainder]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

/** Millisecond-backed media timing remains sub-frame accurate; only explicit edits convert units. */
export function parseMillisecondDuration(
  input: string,
  frameRate: number,
  unit: DurationUnit,
): number | null {
  if (!Number.isFinite(frameRate) || frameRate <= 0) return null;
  // Preserve an explicitly authored millisecond value exactly. Going through frames first
  // can introduce floating-point noise even when the input is already in milliseconds.
  const match = /^(\d+(?:\.\d+)?|\.\d+)\s*(ms|s|f)?$/i.exec(input.trim());
  if (match) {
    const kind = match[2]?.toLowerCase() ?? (unit === 'seconds' ? 's' : 'f');
    if (kind === 'ms' || kind === 's') {
      const milliseconds = Number(kind === 's' ? `${match[1]}e3` : match[1]);
      return Number.isFinite(milliseconds) && milliseconds <= Number.MAX_SAFE_INTEGER
        ? milliseconds
        : null;
    }
  }
  const parsed = parseDurationInput(input, frameRate, unit);
  return parsed ? (parsed.exactFrames / frameRate) * 1000 : null;
}

export function formatMillisecondDuration(
  milliseconds: number,
  frameRate: number,
  unit: DurationUnit,
): string {
  const safe = Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0);
  if (unit === 'seconds') return `${Number((safe / 1000).toFixed(6))}s`;
  if (unit === 'frames') return `${Number(((safe * frameRate) / 1000).toFixed(4))}f`;
  return formatDurationInput((safe * frameRate) / 1000, frameRate, 'timecode');
}

/** No-op on an untouched rounded display; null is distinct from an invalid draft. */
export function resolveMillisecondDraft(
  draft: string,
  displayed: string,
  frameRate: number,
  unit: DurationUnit,
  allowNull: boolean,
  minMs: number,
  maxMs: number,
): { kind: 'unchanged' } | { kind: 'invalid' } | { kind: 'value'; value: number | null } {
  if (draft === displayed) return { kind: 'unchanged' };
  if (!draft.trim() && allowNull) return { kind: 'value', value: null };
  const parsed = parseMillisecondDuration(draft, frameRate, unit);
  return parsed === null
    ? { kind: 'invalid' }
    : { kind: 'value', value: Math.min(maxMs, Math.max(minMs, parsed)) };
}
