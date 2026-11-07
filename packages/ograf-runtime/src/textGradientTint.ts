import { paintToCss, readColor, type GradientPaint } from '@ograf-editor/scene-model';
const sources = new WeakMap<HTMLElement, GradientPaint>();
export function setTextGradientSource(content: HTMLElement, paint: GradientPaint): void {
  sources.set(content, paint);
}
export function getTextGradientSource(content: HTMLElement): GradientPaint | undefined {
  return sources.get(content);
}
/** Tint stops while retaining each stop's original alpha and opacity. */
export function tintGradientCss(
  paint: GradientPaint,
  tints: ReadonlyArray<{ color: string; weight: number }>,
): string {
  const stops = paint.stops.map((stop) => {
    const source = readColor(stop.color);
    if (!source) return stop;
    let [r, g, b] = source.rgb;
    for (const tint of tints) {
      const target = readColor(tint.color);
      if (!target) continue;
      const amount = Math.max(0, Math.min(1, tint.weight * target.alpha));
      r = r! + (target.rgb[0]! - r!) * amount;
      g = g! + (target.rgb[1]! - g!) * amount;
      b = b! + (target.rgb[2]! - b!) * amount;
    }
    const color = `rgba(${Math.round(r!)}, ${Math.round(g!)}, ${Math.round(b!)}, ${source.alpha})`;
    return { ...stop, color };
  });
  return paintToCss({ ...paint, stops });
}
