import type { CSSProperties } from 'react';

const CHECKER_LIGHT = '#d7d9de';
const CHECKER_DARK = '#aeb2ba';
const CHECKER_TILE_PX = 24;

export function colorPickerValue(backgroundColor: string): string {
  const fullHex = /^#([0-9a-f]{6})$/i.exec(backgroundColor);
  if (fullHex) return `#${fullHex[1]!.toLowerCase()}`;

  const shortHex = /^#([0-9a-f]{3})$/i.exec(backgroundColor);
  if (shortHex) {
    const [r, g, b] = shortHex[1]!.toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  return '#000000';
}

/** Keeps checker squares a readable screen size even though the composition itself is zoomed. */
export function transparencyCheckerboardStyle(
  zoom: number,
  mode: 'dark' | 'light' | 'solid' = 'light',
  solidColor = '#30343b',
): CSSProperties {
  if (mode === 'solid') return { backgroundColor: solidColor, backgroundImage: 'none' };
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const tileSize = CHECKER_TILE_PX / safeZoom;
  const light = mode === 'dark' ? '#4d535c' : CHECKER_LIGHT;
  const dark = mode === 'dark' ? '#343a43' : CHECKER_DARK;

  return {
    backgroundColor: light,
    backgroundImage: `conic-gradient(${dark} 25%, ${light} 0 50%, ${dark} 0 75%, ${light} 0)`,
    backgroundSize: `${tileSize}px ${tileSize}px`,
  };
}
