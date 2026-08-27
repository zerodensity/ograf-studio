function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

/** Converts the authored 0–1 opacity value into a user-facing 0–100 alpha percentage. */
export function opacityToAlphaPercent(opacity: number): number {
  return Math.round(clamp(opacity, 0, 1) * 1000) / 10;
}

/** Converts a user-facing percentage back to the authored 0–1 opacity value. */
export function alphaPercentToOpacity(percent: number): number {
  return Math.round(clamp(percent, 0, 100) * 10) / 1000;
}
