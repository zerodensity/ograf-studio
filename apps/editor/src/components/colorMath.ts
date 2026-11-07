export type RGB = [number, number, number];
export type HSV = [number, number, number];
export const byte = (value: number) =>
  Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, '0');
export function rgbToHsv([r, g, b]: RGB): HSV {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h =
    d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (((h * 60) % 360) + 360) % 360;
  return [h, max === 0 ? 0 : d / max, max];
}
export function hsvToRgb([h, s, v]: HSV): RGB {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  v = Math.max(0, Math.min(1, v));
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [Math.round((r! + m) * 255), Math.round((g! + m) * 255), Math.round((b! + m) * 255)];
}
export function formatColor(rgb: RGB, opacity: number, alpha: boolean, original: string): string {
  const a = Math.max(0, Math.min(1, opacity));
  if (/^rgba?\(/i.test(original.trim()))
    return alpha && a < 1
      ? `rgba(${rgb.join(', ')}, ${Number(a.toFixed(3))})`
      : `rgb(${rgb.join(', ')})`;
  return `#${rgb.map(byte).join('')}${alpha ? byte(a * 255) : ''}`;
}
