import { createTilingPattern } from './tiling';
import type { PatternSymbol, TilingPattern } from './types';

export type PatternPresetId =
  'dots' | 'stripes' | 'chevrons' | 'diamonds' | 'checkerboard' | 'monogram';
export interface PatternPresetDescriptor {
  id: PatternPresetId;
  name: string;
  description: string;
}

export const DEFAULT_PATTERN_PRESET_ID: PatternPresetId = 'dots';
export const PATTERN_PRESETS: readonly PatternPresetDescriptor[] = [
  { id: 'dots', name: 'Dots', description: 'Small circles in an even grid.' },
  { id: 'stripes', name: 'Stripes', description: 'Continuous diagonal bands.' },
  { id: 'chevrons', name: 'Chevrons', description: 'Repeating zigzag bands.' },
  { id: 'diamonds', name: 'Diamonds', description: 'An evenly spaced diamond grid.' },
  {
    id: 'checkerboard',
    name: 'Checkerboard',
    description: 'Alternating filled and transparent squares.',
  },
  { id: 'monogram', name: 'Monogram', description: 'The original O/D motif.' },
];

export type PatternPresetLayout = Pick<
  TilingPattern,
  | 'width'
  | 'height'
  | 'rows'
  | 'rowHeight'
  | 'fitRows'
  | 'rowGap'
  | 'gap'
  | 'spacingVariation'
  | 'seed'
  | 'offsetX'
  | 'offsetY'
  | 'direction'
  | 'cycleFrames'
  | 'cyclesPerLoop'
  | 'speedVariation'
  | 'phase'
  | 'rowPhaseStep'
  | 'rowOverrides'
>;

/** Neutral layout for a new preset/custom motif; existing patterns are never modified implicitly. */
export function getPatternPresetLayout(
  width: number,
  height: number,
  frameRate: number,
): PatternPresetLayout {
  for (const [name, value] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (!Number.isFinite(value) || value < 1 || value > 16384)
      throw new Error(`Pattern ${name} must be from 1 to 16384.`);
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0)
    throw new Error('Pattern frame rate must be positive and finite.');
  // Roughly twelve cells across the shorter axis, with square cells independent of aspect ratio.
  const cellSize = Math.max(8, Math.min(width, height) / 12);
  const rows = Math.max(1, Math.min(32, Math.floor(height / cellSize)));
  const rowHeight = height / rows;
  return {
    width,
    height,
    rows,
    rowHeight: Math.max(1, Math.min(4096, rowHeight)),
    fitRows: true,
    rowGap: 0,
    // The existing tiling contract requires an eight-pixel minimum horizontal period.
    gap: Math.max(0, 8 - rowHeight),
    spacingVariation: 0,
    seed: 1,
    offsetX: 0,
    offsetY: 0,
    direction: 'right',
    cycleFrames: Math.max(1, Math.min(1000000, Math.round(frameRate * 8))),
    cyclesPerLoop: 0,
    speedVariation: 0,
    phase: 0,
    rowPhaseStep: 0,
    rowOverrides: [],
  };
}

function symbol(key: string, d: string): PatternSymbol {
  return {
    key,
    d,
    viewBoxWidth: 100,
    viewBoxHeight: 100,
    width: 100,
    height: 100,
    fillRule: 'nonzero',
  };
}

/** A deliberate visual reset; carries no resource identity or lighting configuration. */
export function getPatternPresetPatch(
  id: string,
  width: number,
  height: number,
  frameRate: number,
): Partial<TilingPattern> {
  const preset = PATTERN_PRESETS.find((entry) => entry.id === id);
  if (!preset) throw new Error(`Unknown pattern preset: ${id}.`);
  const layout = getPatternPresetLayout(width, height, frameRate);
  if (preset.id === 'monogram') {
    const legacy = createTilingPattern();
    return { ...layout, name: preset.name, symbols: legacy.symbols, sequence: legacy.sequence };
  }
  const paths: Record<Exclude<PatternPresetId, 'monogram'>, string> = {
    dots: 'M68 50 A18 18 0 1 1 32 50 A18 18 0 1 1 68 50 Z',
    // Wrapped corner triangles continue each diagonal across both tile boundaries.
    stripes: 'M0 0 H18 L100 82 V100 H82 L0 18 Z M82 0 H100 V18 Z M0 82 V100 H18 Z',
    chevrons: 'M0 15 L50 65 L100 15 V35 L50 85 L0 35 Z',
    diamonds: 'M50 10 L90 50 L50 90 L10 50 Z',
    checkerboard: 'M0 0 H50 V50 H0 Z M50 50 H100 V100 H50 Z',
  };
  return {
    ...layout,
    name: preset.name,
    symbols: [symbol(preset.id, paths[preset.id])],
    sequence: [{ symbolKey: preset.id, gapScale: 1 }],
  };
}
