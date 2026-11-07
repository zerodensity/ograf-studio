import { COMPOSITION_PRESETS } from '../panels/compositionPresets';

/** Reuse Studio's broadcast formats while preserving the exact NTSC clock values. */
export const STARTUP_SIZES = [
  ...new Map(
    COMPOSITION_PRESETS.map(
      ({ width, height }) => [`${width}x${height}`, { width, height }] as const,
    ),
  ).values(),
];

export const STARTUP_FRAME_RATES = [
  ...new Set(COMPOSITION_PRESETS.map((preset) => preset.frameRate)),
];

export function startupRateLabel(rate: number): string {
  return Number(rate.toFixed(3)).toString();
}

/** Keep invalid drafts out of the project; no custom value is silently clamped. */
export function resolveStartupSettings(
  width: string,
  height: string,
  rate: string,
): {
  width: number;
  height: number;
  frameRate: number;
} | null {
  if (!width.trim() || !height.trim() || !rate.trim()) return null;
  const parsedWidth = Number(width);
  const parsedHeight = Number(height);
  const frameRate = Number(rate);
  if (
    !Number.isSafeInteger(parsedWidth) ||
    parsedWidth < 1 ||
    !Number.isSafeInteger(parsedHeight) ||
    parsedHeight < 1 ||
    !Number.isFinite(frameRate) ||
    frameRate <= 0
  )
    return null;
  return { width: parsedWidth, height: parsedHeight, frameRate };
}
