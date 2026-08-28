export const NUMERIC_SCRUB_DRAG_THRESHOLD_PX = 3;
export const NUMERIC_SCRUB_PIXELS_PER_STEP = 2;

export interface NumericScrubValueOptions {
  startValue: number;
  startClientX: number;
  currentClientX: number;
  step: number;
  min?: number;
  max?: number;
  shiftKey?: boolean;
  altKey?: boolean;
}

function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const text = value.toString().toLowerCase();
  if (text.includes('e-')) return Number(text.split('e-')[1] ?? 0);
  return text.includes('.') ? (text.split('.')[1]?.length ?? 0) : 0;
}

export function numericScrubMultiplier(shiftKey = false, altKey = false): number {
  return (shiftKey ? 10 : 1) * (altKey ? 0.1 : 1);
}

export function numericScrubValue({
  startValue,
  startClientX,
  currentClientX,
  step,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  shiftKey = false,
  altKey = false,
}: NumericScrubValueOptions): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const pixelSteps = Math.trunc((currentClientX - startClientX) / NUMERIC_SCRUB_PIXELS_PER_STEP);
  const multiplier = numericScrubMultiplier(shiftKey, altKey);
  const unclamped = startValue + pixelSteps * safeStep * multiplier;
  const clamped = Math.max(min, Math.min(max, unclamped));
  const precision = Math.min(
    10,
    Math.max(decimalPlaces(startValue), decimalPlaces(safeStep) + (altKey ? 1 : 0)),
  );
  return Number(clamped.toFixed(precision));
}
