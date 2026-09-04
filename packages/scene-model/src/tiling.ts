import { createId } from './id';
import { createLayerOfKind, createLayerKeyframe, createDefaultTransform } from './factory';
import { computeKeyframeFrames } from './keyframeTiming';
import type { Composition, Element, TilingPattern } from './types';
import {
  createPatternLighting,
  layerLightingErrors,
  patternLightingErrors,
  type TilingPatternPatch,
} from './patternLighting';

export function createTilingPattern(overrides: Partial<TilingPattern> = {}): TilingPattern {
  return {
    id: createId('pattern'),
    name: 'Procedural pattern',
    width: 1920,
    height: 1080,
    rows: 7,
    rowHeight: 144,
    fitRows: true,
    rowGap: 10,
    gap: 18,
    spacingVariation: 0.3,
    seed: 1,
    offsetX: 0,
    offsetY: 6,
    direction: 'alternate',
    cycleFrames: 4800,
    cyclesPerLoop: 3,
    speedVariation: 0.35,
    phase: 0,
    rowPhaseStep: 0.137,
    symbols: [
      {
        key: 'O',
        d: 'M50 0 A50 50 0 1 1 49.99 0 Z M50 25 A25 25 0 1 1 49.99 25 Z',
        viewBoxWidth: 100,
        viewBoxHeight: 100,
        width: 138,
        height: 144,
        fillRule: 'evenodd',
      },
      {
        key: 'D',
        d: 'M0 0 H35 A73 72 0 0 1 35 144 H0 Z',
        viewBoxWidth: 108,
        viewBoxHeight: 144,
        width: 108,
        height: 144,
        fillRule: 'nonzero',
      },
    ],
    sequence: ['O', 'D', 'O', 'D', 'O'].map((symbolKey) => ({ symbolKey, gapScale: 1 })),
    rowOverrides: [],
    ...overrides,
  };
}

function random(seed: number, row: number, index: number): number {
  let x = (seed ^ Math.imul(row + 1, 0x9e3779b9) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
export interface PatternRowLayout {
  row: number;
  y: number;
  height: number;
  period: number;
  cycles: number;
  direction: 1 | -1;
  phase: number;
  blur: number;
  opacity: number;
  entries: Array<{ key: string; x: number; width: number; height: number }>;
}
export function patternRows(pattern: TilingPattern): PatternRowLayout[] {
  const symbols = new Map(pattern.symbols.map((symbol) => [symbol.key, symbol]));
  const rowHeight = pattern.fitRows
    ? (pattern.height - pattern.offsetY * 2 - pattern.rowGap * (pattern.rows - 1)) / pattern.rows
    : pattern.rowHeight;
  return Array.from({ length: pattern.rows }, (_, row) => {
    const override = pattern.rowOverrides.find((item) => item.row === row);
    const widthScale = override?.widthScale ?? 1;
    let x = 0;
    const entries = pattern.sequence.map((entry, index) => {
      const symbol = symbols.get(entry.symbolKey);
      if (!symbol) throw new Error(`Pattern symbol is missing: ${entry.symbolKey}`);
      const width = ((symbol.width * rowHeight) / symbol.height) * widthScale;
      const result = { key: symbol.key, x, width, height: rowHeight };
      x +=
        width +
        pattern.gap *
          entry.gapScale *
          widthScale *
          (1 + (random(pattern.seed, row, index) * 2 - 1) * pattern.spacingVariation);
      return result;
    });
    const direction =
      override?.direction ??
      (pattern.direction === 'alternate' ? (row % 2 ? 'left' : 'right') : pattern.direction);
    return {
      row,
      y: pattern.offsetY + row * (rowHeight + pattern.rowGap),
      height: rowHeight,
      period: x,
      cycles:
        override?.cycles ??
        (pattern.cyclesPerLoop === 0
          ? 0
          : Math.max(
              1,
              Math.round(
                pattern.cyclesPerLoop *
                  (1 + (random(pattern.seed, row, 999) * 2 - 1) * pattern.speedVariation),
              ),
            )),
      direction: direction === 'right' ? 1 : -1,
      phase: pattern.phase + (override?.phase ?? row * pattern.rowPhaseStep),
      blur: override?.blur ?? 0,
      opacity: override?.opacity ?? 1,
      entries,
    };
  });
}
export function patternRowOffset(
  pattern: TilingPattern,
  row: PatternRowLayout,
  elapsedFrames: number,
): number {
  const turns = (elapsedFrames / pattern.cycleFrames) * row.cycles + row.phase;
  return pattern.offsetX + (((turns % 1) + 1) % 1) * row.period * row.direction;
}
export function resolvePatternElement(
  element: Element,
  patterns: readonly TilingPattern[],
): Element {
  if (element.type !== 'pattern') return element;
  const definition = patterns.find((pattern) => pattern.id === element.patternId);
  const resolved = { ...element };
  delete resolved.definition;
  if (definition) resolved.definition = definition;
  return resolved;
}

export function tilingPatternErrors(pattern: TilingPattern): string[] {
  const errors: string[] = [];
  if (pattern.lighting != null) errors.push(...patternLightingErrors(pattern.lighting));
  if (
    !Array.isArray(pattern.symbols) ||
    !Array.isArray(pattern.sequence) ||
    !Array.isArray(pattern.rowOverrides)
  )
    return ['Symbols, sequence and rowOverrides must be arrays.'];
  if (typeof pattern.fitRows !== 'boolean') errors.push('fitRows must be a boolean.');
  const bounded = (key: keyof TilingPattern, min: number, max: number, integer = false) => {
    const value = pattern[key];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      errors.push(`${String(key)} must be ${integer ? 'an integer ' : ''}from ${min} to ${max}.`);
  };
  bounded('width', 1, 16384);
  bounded('height', 1, 16384);
  bounded('rows', 1, 32, true);
  bounded('rowHeight', 1, 4096);
  bounded('rowGap', 0, 4096);
  bounded('gap', 0, 4096);
  bounded('spacingVariation', 0, 1);
  bounded('speedVariation', 0, 1);
  bounded('cyclesPerLoop', 0, 32, true);
  bounded('cycleFrames', 1, 1000000, true);
  bounded('seed', 0, 2147483647, true);
  for (const key of ['offsetX', 'offsetY', 'phase', 'rowPhaseStep'] as const)
    bounded(key, -16384, 16384);
  if (typeof pattern.name !== 'string' || !pattern.name.trim())
    errors.push('Name cannot be empty.');
  if (
    pattern.fitRows &&
    (pattern.height - 2 * pattern.offsetY - (pattern.rows - 1) * pattern.rowGap) / pattern.rows < 1
  )
    errors.push('The rows and gaps must fit within the pattern height.');
  if (pattern.symbols.length < 1 || pattern.symbols.length > 32)
    errors.push('Use 1–32 source symbols.');
  if (pattern.sequence.length < 1 || pattern.sequence.length > 64)
    errors.push('Use 1–64 sequence entries.');
  const keys = new Set<string>();
  for (const symbol of pattern.symbols) {
    if (!symbol || typeof symbol !== 'object') {
      errors.push('Symbols must be objects.');
      continue;
    }
    if (
      Object.keys(symbol).some(
        (key) =>
          !['key', 'd', 'viewBoxWidth', 'viewBoxHeight', 'width', 'height', 'fillRule'].includes(
            key,
          ),
      )
    )
      errors.push('Unknown source-symbol property.');
    if (
      typeof symbol.key !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(symbol.key) ||
      keys.has(symbol.key)
    )
      errors.push('Symbol keys must be unique simple identifiers.');
    keys.add(symbol.key);
    if (typeof symbol.d !== 'string' || !symbol.d.trim())
      errors.push(`Symbol ${symbol.key} needs path data.`);
    if (!['evenodd', 'nonzero'].includes(symbol.fillRule))
      errors.push(`Symbol ${symbol.key} has invalid fillRule.`);
    for (const value of [symbol.width, symbol.height, symbol.viewBoxWidth, symbol.viewBoxHeight])
      if (!Number.isFinite(value) || value <= 0 || value > 16384)
        errors.push(`Symbol ${symbol.key} has invalid dimensions.`);
  }
  for (const entry of pattern.sequence) {
    if (!entry || typeof entry !== 'object') {
      errors.push('Sequence entries must be objects.');
      continue;
    }
    if (!keys.has(entry.symbolKey)) errors.push(`Unknown sequence symbol ${entry.symbolKey}.`);
    if (!Number.isFinite(entry.gapScale) || entry.gapScale < 0 || entry.gapScale > 100)
      errors.push('Gap scales must be 0–100.');
  }
  const rows = new Set<number>();
  if (pattern.rowOverrides.length > 32) errors.push('Use at most 32 row overrides.');
  for (const override of pattern.rowOverrides) {
    if (!override || typeof override !== 'object') {
      errors.push('Row overrides must be objects.');
      continue;
    }
    if (
      Object.keys(override).some(
        (key) =>
          !['row', 'direction', 'cycles', 'phase', 'widthScale', 'blur', 'opacity'].includes(key),
      )
    )
      errors.push('Unknown row override property.');
    if (
      !Number.isInteger(override.row) ||
      override.row < 0 ||
      override.row >= pattern.rows ||
      rows.has(override.row)
    )
      errors.push('Row overrides must reference unique active row indexes.');
    rows.add(override.row);
    if (
      override.cycles !== undefined &&
      (!Number.isInteger(override.cycles) || override.cycles < 0 || override.cycles > 64)
    )
      errors.push('Row cycles must be an integer from 0 to 64.');
    if (
      override.widthScale !== undefined &&
      (!Number.isFinite(override.widthScale) ||
        override.widthScale < 0.05 ||
        override.widthScale > 20)
    )
      errors.push('Row widthScale must be 0.05–20.');
    if (override.phase !== undefined && !Number.isFinite(override.phase))
      errors.push('Row phase must be finite.');
    if (
      override.blur !== undefined &&
      (!Number.isFinite(override.blur) || override.blur < 0 || override.blur > 100)
    )
      errors.push('Row blur must be 0–100.');
    if (
      override.opacity !== undefined &&
      (!Number.isFinite(override.opacity) || override.opacity < 0 || override.opacity > 1)
    )
      errors.push('Row opacity must be 0–1.');
    if (override.direction !== undefined && !['left', 'right'].includes(override.direction))
      errors.push('Invalid row direction.');
  }
  if (!['left', 'right', 'alternate'].includes(pattern.direction))
    errors.push('Invalid pattern direction.');
  if (
    errors.length === 0 &&
    patternRows(pattern).some(
      (row) => !Number.isFinite(row.period) || row.period < 8 || row.period > 65536,
    )
  )
    errors.push('Resulting motif periods must be 8–65536 pixels.');
  return errors;
}
export function assertTilingPattern(pattern: TilingPattern): void {
  const errors = tilingPatternErrors(pattern);
  if (errors.length) throw new Error(errors.join(' '));
}
export function removeTilingPattern(composition: Composition, id: string): void {
  const layers = [...composition.layers, ...composition.components.flatMap((c) => c.layers)];
  if (
    layers.some(
      (layer) =>
        (layer.element.type === 'pattern' && layer.element.patternId === id) ||
        layer.lighting?.patternId === id,
    )
  )
    throw new Error('Remove or relink pattern instances before deleting their shared definition.');
  composition.patterns = composition.patterns.filter((pattern) => pattern.id !== id);
}

export function setTilingPattern(
  composition: Composition,
  patch: TilingPatternPatch,
  patternId?: string,
  id?: string,
): TilingPattern {
  const current = patternId ? composition.patterns.find((p) => p.id === patternId) : undefined;
  if (patternId && !current) throw new Error(`Pattern not found: ${patternId}`);
  const { lighting, ...rest } = patch;
  const normalizedPatch: Partial<Omit<TilingPattern, 'id'>> = structuredClone(rest);
  if (lighting !== undefined)
    normalizedPatch.lighting =
      lighting === null
        ? null
        : {
            ...(current?.lighting ??
              createPatternLighting(
                (patch.cycleFrames ?? current?.cycleFrames ?? composition.frameRate * 96) / 8,
              )),
            ...lighting,
          };
  const next = current
    ? { ...current, ...normalizedPatch }
    : createTilingPattern({
        width: composition.width,
        height: composition.height,
        cycleFrames: Math.round(composition.frameRate * 96),
        ...normalizedPatch,
        ...(id ? { id } : {}),
      });
  if (patch.rows !== undefined && patch.rowOverrides === undefined)
    next.rowOverrides = next.rowOverrides.filter((row) => row.row < next.rows);
  assertTilingPattern(next);
  const patterns = [...composition.patterns.filter((p) => p.id !== next.id), next];
  for (const layer of [...composition.layers, ...composition.components.flatMap((c) => c.layers)]) {
    if (layer.lighting?.patternId !== next.id) continue;
    const errors = layerLightingErrors(layer, patterns);
    if (errors.length) throw new Error(errors.join(' '));
  }
  if (current) composition.patterns[composition.patterns.indexOf(current)] = next;
  else composition.patterns.push(next);
  return next;
}
export function addTilingPatternLayer(composition: Composition, patternId: string): string {
  const definition = composition.patterns.find((pattern) => pattern.id === patternId);
  if (!definition) throw new Error(`Pattern not found: ${patternId}`);
  const layer = createLayerOfKind('pattern');
  if (layer.element.type !== 'pattern') throw new Error('Expected pattern layer');
  layer.element.patternId = patternId;
  layer.name = definition.name;
  layer.keyframes = computeKeyframeFrames(composition).map(({ frame }) =>
    createLayerKeyframe(
      frame,
      createDefaultTransform({ x: 0, y: 0, width: definition.width, height: definition.height }),
    ),
  );
  layer.semantics = {
    role: 'background',
    tags: ['procedural-pattern'],
    description: 'Shared vector motif and row motion controller.',
  };
  composition.layers.push(layer);
  return layer.id;
}
