import type { LottieAnimationData, LottieElement } from './types';

export const MAX_LOTTIE_JSON_BYTES = 20 * 1024 * 1024;

export interface LottieInspection {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Validate the subset needed for safe, self-contained deterministic playback. */
export function inspectLottieAnimationData(value: unknown): LottieInspection {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value))
    return { valid: false, errors: ['Lottie JSON must be an object.'], warnings };

  if (!positiveFinite(value.fr)) errors.push('Lottie frame rate (fr) must be positive.');
  if (typeof value.ip !== 'number' || !Number.isFinite(value.ip))
    errors.push('Lottie in-point (ip) must be a finite number.');
  if (typeof value.op !== 'number' || !Number.isFinite(value.op))
    errors.push('Lottie out-point (op) must be a finite number.');
  if (typeof value.ip === 'number' && typeof value.op === 'number' && value.op <= value.ip)
    errors.push('Lottie out-point (op) must be greater than its in-point (ip).');
  if (!positiveFinite(value.w) || !positiveFinite(value.h))
    errors.push('Lottie width (w) and height (h) must be positive.');
  if (!Array.isArray(value.layers)) errors.push('Lottie JSON must contain a layers array.');

  const assets = Array.isArray(value.assets) ? value.assets : [];
  for (const asset of assets) {
    if (!isRecord(asset) || typeof asset.p !== 'string' || !asset.p) continue;
    if (!asset.p.startsWith('data:image/')) {
      errors.push(
        `External Lottie image asset "${asset.p}" is not supported; embed images in the JSON.`,
      );
    }
  }
  const fonts = isRecord(value.fonts) && Array.isArray(value.fonts.list) ? value.fonts.list : [];
  for (const font of fonts) {
    if (!isRecord(font) || typeof font.fPath !== 'string' || !font.fPath) continue;
    if (!font.fPath.startsWith('data:')) {
      errors.push(
        `External Lottie font asset "${font.fPath}" is not supported; use glyphs or an embedded font.`,
      );
    }
  }
  if (JSON.stringify(value).length > MAX_LOTTIE_JSON_BYTES) {
    errors.push(
      `Lottie JSON exceeds the ${MAX_LOTTIE_JSON_BYTES / (1024 * 1024)} MB import limit.`,
    );
  }
  if (JSON.stringify(value).includes('"x":"')) {
    warnings.push('Lottie expressions are disabled and will be ignored.');
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function parseLottieJson(source: string): LottieAnimationData {
  if (new Blob([source]).size > MAX_LOTTIE_JSON_BYTES) {
    throw new Error(
      `Lottie JSON exceeds the ${MAX_LOTTIE_JSON_BYTES / (1024 * 1024)} MB import limit.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  const inspection = inspectLottieAnimationData(parsed);
  if (!inspection.valid) throw new Error(inspection.errors.join(' '));
  return parsed as LottieAnimationData;
}

/** Raw Lottie frame for an absolute elapsed time; independent of callback cadence. */
export function lottieFrameAtTime(element: LottieElement, elapsedMs: number): number {
  const data = element.animationData;
  if (!data) return 0;
  const duration = data.op - data.ip;
  if (!(duration > 0) || !(data.fr > 0)) return data.ip;
  const elapsedFrames = Math.max(0, elapsedMs) * 0.001 * data.fr * Math.max(0, element.speed);
  return data.ip + (((elapsedFrames % duration) + duration) % duration);
}
